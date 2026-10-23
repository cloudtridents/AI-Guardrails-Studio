"""Client for the strands-decider decision model.

strands-decider (https://github.com/strands-labs/strands-decider) is a small,
fast "decision model" that answers typed questions about a piece of text:
  - noul   → a calibrated yes/no value in [0, 1] (closer to 1 == yes)
  - choice → picks one of a set of labels, with a confidence
  - score  → rates on a scale, with a confidence

We integrate it as an HTTP decision service rather than importing it in-process,
because the package pulls heavy dependencies (torch>=2.7, transformers>=5.15)
that conflict with this backend's pinned stack. Run it alongside the backend:

    pip install strands-decider
    strands-decider serve StrandsAgents/strands-decider-2B-hobson-v19 --port 8100

and point STRANDS_DECIDER_URL at it (default http://localhost:8100).

For each guardrail category we ask one `noul` question derived from the
category description, e.g. "Does this text involve violence, weapons, or
illegal activity?". The returned noul value plays the same role as the local
classifier's zero-shot score and is compared against the category threshold.
"""

import logging
import os
import time
from typing import Optional

try:  # requests is widely available; fall back to urllib if absent
    import requests  # type: ignore
    _HAS_REQUESTS = True
except Exception:  # pragma: no cover
    _HAS_REQUESTS = False
    import json as _json
    import urllib.request as _urllib

logger = logging.getLogger(__name__)


def get_decider_url() -> str:
    """Base URL of the strands-decider server (read at call time)."""
    return os.getenv("STRANDS_DECIDER_URL", "http://localhost:8100").rstrip("/")


def get_decider_model() -> str:
    """Model name reported for info endpoints (does not affect the server)."""
    return os.getenv(
        "STRANDS_DECIDER_MODEL",
        "strands-decider-2B-hobson-v19",
    )


def _timeout() -> float:
    try:
        return float(os.getenv("STRANDS_DECIDER_TIMEOUT", "30"))
    except ValueError:
        return 30.0


class StrandsDeciderError(RuntimeError):
    """Raised when the strands-decider server cannot be reached or errors."""


def _post_systemone(state: str, questions: dict) -> dict:
    """POST to the server's /v1/systemone endpoint and return the parsed JSON."""
    url = f"{get_decider_url()}/v1/systemone"
    payload = {"state": state, "questions": questions}

    if _HAS_REQUESTS:
        try:
            resp = requests.post(url, json=payload, timeout=_timeout())
        except requests.RequestException as e:  # type: ignore
            raise StrandsDeciderError(f"Could not reach strands-decider at {url}: {e}") from e
        if resp.status_code != 200:
            raise StrandsDeciderError(
                f"strands-decider returned {resp.status_code}: {resp.text[:200]}"
            )
        return resp.json()

    # urllib fallback
    data = _json.dumps(payload).encode("utf-8")
    req = _urllib.Request(url, data=data, headers={"content-type": "application/json"})
    try:
        with _urllib.urlopen(req, timeout=_timeout()) as r:  # noqa: S310 (configured URL)
            return _json.loads(r.read().decode("utf-8"))
    except Exception as e:  # pragma: no cover
        raise StrandsDeciderError(f"Could not reach strands-decider at {url}: {e}") from e


def _question_for_category(cat_name: str, cat_config: dict) -> str:
    """Build a noul question for a category from its labels/description.

    Prefers the category's labels (concrete topics) over the human-facing
    description, which is often phrased as "Detects ..." and reads awkwardly
    inside a yes/no question. An explicit `question` field, if present, wins.
    """
    explicit = (cat_config.get("question") or "").strip()
    if explicit:
        return explicit

    labels = cat_config.get("labels") or []
    if labels:
        return f"Does this text involve {', '.join(labels)}?"

    description = (cat_config.get("description") or "").strip()
    if description:
        return f"Does this text involve {description.rstrip('.').lower()}?"

    return f"Does this text match the category '{cat_name}'?"


def classify_categories(text: str, categories: dict) -> dict:
    """Score every category via strands-decider noul questions.

    Returns a dict shaped like the local classifier output so the two backends
    can be merged:
        {
            "category_scores": {cat_name: float in [0,1], ...},
            "latency_ms": float,
            "model": str,
        }

    Raises StrandsDeciderError if the server is unreachable.
    """
    start = time.time()

    # Map a safe question key per category (the server echoes keys back).
    questions: dict[str, dict] = {}
    key_to_cat: dict[str, str] = {}
    for i, (cat_name, cat_config) in enumerate(categories.items()):
        key = f"q{i}"
        key_to_cat[key] = cat_name
        questions[key] = {
            "type": "noul",
            "instructions": _question_for_category(cat_name, cat_config),
        }

    category_scores: dict[str, float] = {name: 0.0 for name in categories}

    if questions:
        result = _post_systemone(text, questions)
        answers = result.get("answers", {})
        for key, answer in answers.items():
            cat_name = key_to_cat.get(key)
            if cat_name is None:
                continue
            # noul answers carry a "noul" float in [0, 1]
            score = answer.get("noul")
            if score is None:
                # tolerate other answer shapes (choice/score) defensively
                score = answer.get("confidence", 0.0)
            category_scores[cat_name] = float(score)

    return {
        "category_scores": category_scores,
        "latency_ms": round((time.time() - start) * 1000, 1),
        "model": get_decider_model(),
    }


def health() -> dict:
    """Report whether the configured strands-decider server is reachable."""
    url = get_decider_url()
    info: dict = {
        "url": url,
        "model": get_decider_model(),
        "available": False,
    }
    probe = {"__healthcheck__": {"type": "noul", "instructions": "Is this a test?"}}
    try:
        _post_systemone("ping", probe)
        info["available"] = True
    except StrandsDeciderError as e:
        info["error"] = str(e)
    return info
