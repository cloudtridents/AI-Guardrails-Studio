"""Local DistilBERT-based classifier for fast guardrail pre-filtering.

Uses Hugging Face zero-shot classification pipeline for configurable categories.
Runs locally with no API calls — typical inference: 10-50ms on CPU.
"""

import json
import logging
import os
import time
from pathlib import Path
from typing import Optional
from functools import lru_cache

from app.services.performance_monitor import get_monitor, PerformanceMetrics

logger = logging.getLogger(__name__)

# Persist custom categories so they survive restarts (consistent with the
# file-backed stores used elsewhere in the backend).
_CATEGORIES_FILE = Path(__file__).resolve().parents[2] / "classifier_categories.json"

# Lazy-loaded pipeline instances
_classifier = None
_model_name = "typeform/distilbert-base-uncased-mnli"


def _get_classifier():
    """Lazy-load the classification pipeline."""
    global _classifier
    if _classifier is None:
        from transformers import pipeline
        logger.info(f"Loading local classifier model: {_model_name}")
        _classifier = pipeline(
            "zero-shot-classification",
            model=_model_name,
            device=-1,  # CPU
        )
        logger.info("Local classifier loaded successfully")
    return _classifier


# ─── Default Categories ──────────────────────────────────────────────────────────

DEFAULT_CATEGORIES = {
    "harmful_content": {
        "labels": ["violence", "weapons", "illegal activity", "self-harm", "terrorism"],
        "threshold": 0.7,
        "action": "block",
        "description": "Detects requests about violence, weapons, illegal activities",
    },
    "profanity": {
        "labels": ["profanity", "offensive language", "hate speech", "slur"],
        "threshold": 0.75,
        "action": "block",
        "description": "Detects profanity, offensive language, and slurs",
    },
    "pii_sharing": {
        "labels": ["sharing personal information", "credit card number", "social security number", "password sharing"],
        "threshold": 0.65,
        "action": "block",
        "description": "Detects when users share PII like SSN, credit cards",
    },
    "jailbreak": {
        "labels": ["prompt injection", "bypassing restrictions", "ignoring instructions", "role-playing as unrestricted AI"],
        "threshold": 0.7,
        "action": "block",
        "description": "Detects jailbreak and prompt injection attempts",
    },
    "political_content": {
        "labels": ["political opinion", "election endorsement", "partisan statement", "policy debate"],
        "threshold": 0.65,
        "action": "flag",
        "description": "Detects political opinions and election-related content",
    },
    "legal_advice": {
        "labels": ["legal advice request", "asking for legal interpretation", "lawsuit guidance"],
        "threshold": 0.6,
        "action": "flag",
        "description": "Detects requests for legal advice",
    },
    "emergency": {
        "labels": ["emergency situation", "someone is hurt", "fire", "threat to safety", "suicide"],
        "threshold": 0.6,
        "action": "escalate",
        "description": "Detects emergency situations requiring immediate escalation",
    },
}

# Custom categories, loaded from disk on first access and persisted on change.
_custom_categories: Optional[dict] = None


def _load_custom_categories() -> dict:
    """Load custom categories from disk, caching in the module global."""
    global _custom_categories
    if _custom_categories is None:
        if _CATEGORIES_FILE.exists():
            try:
                _custom_categories = json.loads(_CATEGORIES_FILE.read_text())
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(f"Could not read custom categories file: {e}")
                _custom_categories = {}
        else:
            _custom_categories = {}
    return _custom_categories


def _save_custom_categories() -> None:
    """Persist the current custom categories to disk."""
    try:
        _CATEGORIES_FILE.write_text(json.dumps(_custom_categories or {}, indent=2))
    except OSError as e:
        logger.error(f"Could not persist custom categories: {e}")


# ─── Classification API ──────────────────────────────────────────────────────────


def get_decision_backend() -> str:
    """The active decision backend: 'bert' | 'strands' | 'combined'.

    Controlled by the DECISION_BACKEND env var (default 'bert'); read at call
    time so it can be changed without a restart.
    """
    value = os.getenv("DECISION_BACKEND", "bert").strip().lower()
    return value if value in ("bert", "strands", "combined") else "bert"


def classify_text(
    text: str,
    categories: Optional[dict] = None,
    backend: Optional[str] = None,
) -> dict:
    """Classify text against guardrail categories.

    Args:
        text: the text to classify.
        categories: optional explicit category map (defaults to configured ones).
        backend: optional override for the decision backend
            ('bert' | 'strands' | 'combined'); defaults to DECISION_BACKEND.
    
    Returns:
        {
            "text": "input text",
            "results": [
                {"category": "harmful_content", "score": 0.92, "triggered": True, "action": "block"},
                {"category": "profanity", "score": 0.15, "triggered": False, "action": "block"},
                ...
            ],
            "blocked": True/False,
            "flagged": True/False,
            "escalate": True/False,
            "triggered_categories": ["harmful_content"],
            "latency_ms": 23.5,
            "performance": {
                "timing": {...},
                "system": {...},
                "device": {...},
                "efficiency": {...}
            }
        }
    """
    total_start = time.time()

    # Resolve the decision backend: bert | strands | combined
    backend = (backend or get_decision_backend()).strip().lower()
    if backend not in ("bert", "strands", "combined"):
        backend = "bert"

    # Get performance monitor and collect initial metrics
    monitor = get_monitor()
    metrics_start = monitor.get_system_metrics()

    cats = categories or {**DEFAULT_CATEGORIES, **_load_custom_categories()}

    # Measure inference time
    inference_start = time.time()

    bert_scores: dict[str, float] = {}
    strands_scores: dict[str, float] = {}
    strands_info: Optional[dict] = None
    strands_error: Optional[str] = None

    # ── BERT zero-shot scoring ──────────────────────────────────────────────
    if backend in ("bert", "combined"):
        bert_scores = _bert_category_scores(text, cats)

    # ── strands-decider scoring ─────────────────────────────────────────────
    if backend in ("strands", "combined"):
        from app.services import strands_decider

        try:
            strands_info = strands_decider.classify_categories(text, cats)
            strands_scores = strands_info.get("category_scores", {})
        except strands_decider.StrandsDeciderError as e:
            strands_error = str(e)
            logger.warning(f"strands-decider unavailable: {e}")
            # If strands was the only backend, there is nothing to score with.
            if backend == "strands":
                raise

    # ── Merge scores and evaluate thresholds ────────────────────────────────
    results = []
    blocked = False
    flagged = False
    escalate = False
    triggered = []

    for cat_name, cat_config in cats.items():
        b = bert_scores.get(cat_name, 0.0)
        s = strands_scores.get(cat_name, 0.0)

        if backend == "bert":
            score = b
        elif backend == "strands":
            score = s
        else:  # combined: trigger if either backend is confident
            score = max(b, s)

        threshold = cat_config["threshold"]
        is_triggered = score >= threshold
        action = cat_config["action"]

        if is_triggered:
            triggered.append(cat_name)
            if action == "block":
                blocked = True
            elif action == "flag":
                flagged = True
            elif action == "escalate":
                escalate = True

        results.append({
            "category": cat_name,
            "score": round(score, 4),
            "bert_score": round(b, 4),
            "strands_score": round(s, 4),
            "threshold": threshold,
            "triggered": is_triggered,
            "action": action,
            "description": cat_config.get("description", ""),
        })

    # Record inference time
    inference_time_ms = (time.time() - inference_start) * 1000

    # Collect end metrics
    metrics_end = monitor.get_system_metrics()
    total_time_ms = (time.time() - total_start) * 1000

    # Sort by score descending
    results.sort(key=lambda r: r["score"], reverse=True)

    # Create performance metrics object
    perf_metrics = PerformanceMetrics(
        inference_time_ms=inference_time_ms,
        total_time_ms=total_time_ms,
        system_metrics_start=metrics_start,
        system_metrics_end=metrics_end,
        tokens_processed=len(text.split()),  # Approximate token count
    )
    if perf_metrics.tokens_processed > 0:
        perf_metrics.throughput_tokens_per_sec = (perf_metrics.tokens_processed / inference_time_ms) * 1000

    # Format performance data
    performance_data = monitor.format_metrics(perf_metrics)

    # Describe the model(s) actually used for this classification
    if backend == "bert":
        model_label = _model_name
    elif backend == "strands":
        model_label = (strands_info or {}).get("model", get_decision_backend())
    else:
        model_label = f"{_model_name} + {(strands_info or {}).get('model', 'strands-decider')}"

    response = {
        "text": text[:200],  # Truncate for response
        "results": results,
        "blocked": blocked,
        "flagged": flagged,
        "escalate": escalate,
        "triggered_categories": triggered,
        "latency_ms": round(inference_time_ms, 1),
        "backend": backend,
        "model": model_label,
        "performance": performance_data,
    }
    if strands_info is not None:
        response["strands_latency_ms"] = strands_info.get("latency_ms")
    if strands_error is not None:
        response["strands_error"] = strands_error
    return response


def _bert_category_scores(text: str, cats: dict) -> dict[str, float]:
    """Run the DistilBERT zero-shot classifier and return max score per category."""
    classifier = _get_classifier()

    all_labels: list[str] = []
    label_to_category: dict[str, str] = {}
    for cat_name, cat_config in cats.items():
        for label in cat_config["labels"]:
            all_labels.append(label)
            label_to_category[label] = cat_name

    category_scores: dict[str, float] = {name: 0.0 for name in cats}
    if not all_labels:
        return category_scores

    output = classifier(text, candidate_labels=all_labels, multi_label=True)
    for label, score in zip(output["labels"], output["scores"]):
        cat_name = label_to_category.get(label, "unknown")
        if cat_name in category_scores:
            category_scores[cat_name] = max(category_scores[cat_name], float(score))
    return category_scores


def get_categories() -> dict:
    """Get all configured categories (default + custom)."""
    return {**DEFAULT_CATEGORIES, **_load_custom_categories()}


def add_custom_category(name: str, config: dict):
    """Add or update a custom category and persist it."""
    custom = _load_custom_categories()
    custom[name] = config
    _save_custom_categories()


def remove_custom_category(name: str) -> bool:
    """Remove a custom category and persist the change."""
    custom = _load_custom_categories()
    if name in custom:
        del custom[name]
        _save_custom_categories()
        return True
    return False


def get_model_info() -> dict:
    """Get info about the loaded model(s) and the active decision backend."""
    from app.services import strands_decider

    backend = get_decision_backend()
    info = {
        "decision_backend": backend,
        "available_backends": ["bert", "strands", "combined"],
        "bert": {
            "model_name": _model_name,
            "loaded": _classifier is not None,
            "device": "cpu",
            "type": "zero-shot-classification",
            "framework": "DistilBERT (MNLI)",
            "description": "Local DistilBERT model fine-tuned on MNLI for zero-shot text classification. Runs on CPU with ~10-50ms inference time.",
        },
        "strands": {
            "model_name": strands_decider.get_decider_model(),
            "url": strands_decider.get_decider_url(),
            "type": "decision-model",
            "framework": "strands-decider (noul decisions)",
            "description": "Calibrated yes/no (noul) decision model served over HTTP. Enable via DECISION_BACKEND=strands|combined and run the strands-decider server.",
        },
        # Back-compat top-level fields (reflect the primary BERT model)
        "model_name": _model_name,
        "loaded": _classifier is not None,
        "device": "cpu",
        "type": "zero-shot-classification",
        "framework": "DistilBERT (MNLI)",
    }
    if backend in ("strands", "combined"):
        info["strands"]["health"] = strands_decider.health()
    return info
