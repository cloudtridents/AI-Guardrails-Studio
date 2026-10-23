"""Performance monitoring for classifier inference.

Tracks CPU usage, memory usage, and system metrics during classification.
Useful for benchmarking CPU vs GPU performance.
"""

import logging
import psutil
import os
import time
from dataclasses import dataclass, asdict
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class SystemMetrics:
    """System metrics snapshot."""
    timestamp: float
    cpu_percent: float  # CPU usage percentage (0-100)
    memory_percent: float  # Memory usage percentage (0-100)
    memory_mb: float  # Memory used in MB
    memory_available_mb: float  # Memory available in MB
    memory_total_mb: float  # Total system memory in MB
    process_cpu_percent: float  # Process-specific CPU usage
    process_memory_mb: float  # Process-specific memory usage in MB
    is_gpu_available: bool  # Is GPU available for inference


@dataclass
class PerformanceMetrics:
    """Performance metrics for a classification run."""
    inference_time_ms: float  # Time spent in model inference
    total_time_ms: float  # Total time including all overhead
    system_metrics_start: SystemMetrics
    system_metrics_end: SystemMetrics
    tokens_processed: Optional[int] = None
    throughput_tokens_per_sec: Optional[float] = None
    

class PerformanceMonitor:
    """Monitors system performance during model inference."""
    
    def __init__(self):
        self.process = psutil.Process(os.getpid())
        self._gpu_available = self._check_gpu_availability()
    
    def _check_gpu_availability(self) -> bool:
        """Check if GPU is available for inference."""
        try:
            import torch
            return torch.cuda.is_available()
        except ImportError:
            return False
        except Exception as e:
            logger.debug(f"Could not check GPU availability: {e}")
            return False
    
    def get_system_metrics(self) -> SystemMetrics:
        """Get a snapshot of current system metrics."""
        try:
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            process_info = self.process.as_dict(attrs=['cpu_percent', 'memory_info'])
            
            return SystemMetrics(
                timestamp=time.time(),
                cpu_percent=cpu_percent,
                memory_percent=memory.percent,
                memory_mb=memory.used / (1024 ** 2),
                memory_available_mb=memory.available / (1024 ** 2),
                memory_total_mb=memory.total / (1024 ** 2),
                process_cpu_percent=process_info.get('cpu_percent', 0.0),
                process_memory_mb=process_info.get('memory_info').rss / (1024 ** 2) if process_info.get('memory_info') else 0.0,
                is_gpu_available=self._gpu_available,
            )
        except Exception as e:
            logger.error(f"Error collecting system metrics: {e}")
            # Return default metrics on error
            return SystemMetrics(
                timestamp=time.time(),
                cpu_percent=0.0,
                memory_percent=0.0,
                memory_mb=0.0,
                memory_available_mb=0.0,
                memory_total_mb=0.0,
                process_cpu_percent=0.0,
                process_memory_mb=0.0,
                is_gpu_available=False,
            )
    
    def get_metrics_delta(self, start: SystemMetrics, end: SystemMetrics) -> dict:
        """Calculate deltas between two metric snapshots."""
        return {
            "cpu_percent_delta": end.cpu_percent - start.cpu_percent,
            "memory_percent_delta": end.memory_percent - start.memory_percent,
            "memory_mb_delta": end.memory_mb - start.memory_mb,
            "process_cpu_percent_avg": (start.process_cpu_percent + end.process_cpu_percent) / 2,
            "process_memory_mb_delta": end.process_memory_mb - start.process_memory_mb,
        }
    
    def format_metrics(self, perf_metrics: PerformanceMetrics) -> dict:
        """Format performance metrics for API response."""
        metrics_delta = self.get_metrics_delta(
            perf_metrics.system_metrics_start,
            perf_metrics.system_metrics_end
        )
        
        return {
            "timing": {
                "inference_ms": round(perf_metrics.inference_time_ms, 2),
                "total_ms": round(perf_metrics.total_time_ms, 2),
                "overhead_ms": round(perf_metrics.total_time_ms - perf_metrics.inference_time_ms, 2),
            },
            "system": {
                "cpu_usage_percent": round(perf_metrics.system_metrics_end.cpu_percent, 1),
                "memory_usage_percent": round(perf_metrics.system_metrics_end.memory_percent, 1),
                "memory_used_mb": round(perf_metrics.system_metrics_end.memory_mb, 1),
                "memory_available_mb": round(perf_metrics.system_metrics_end.memory_available_mb, 1),
                "memory_total_mb": round(perf_metrics.system_metrics_end.memory_total_mb, 1),
                "process_cpu_percent": round(metrics_delta["process_cpu_percent_avg"], 1),
                "process_memory_mb": round(perf_metrics.system_metrics_end.process_memory_mb, 1),
                "process_memory_delta_mb": round(metrics_delta["process_memory_mb_delta"], 2),
                "cpu_percent_delta": round(metrics_delta["cpu_percent_delta"], 1),
                "memory_percent_delta": round(metrics_delta["memory_percent_delta"], 1),
            },
            "device": {
                "gpu_available": perf_metrics.system_metrics_end.is_gpu_available,
                "device_type": "gpu" if perf_metrics.system_metrics_end.is_gpu_available else "cpu",
            },
            "efficiency": {
                "tokens_processed": perf_metrics.tokens_processed or 0,
                "throughput_tokens_per_sec": round(perf_metrics.throughput_tokens_per_sec or 0, 1),
                "latency_per_token_ms": round(
                    perf_metrics.inference_time_ms / (perf_metrics.tokens_processed or 1), 2
                ) if perf_metrics.tokens_processed else 0,
            }
        }


# Global monitor instance
_monitor: Optional[PerformanceMonitor] = None


def get_monitor() -> PerformanceMonitor:
    """Get the global performance monitor instance."""
    global _monitor
    if _monitor is None:
        _monitor = PerformanceMonitor()
    return _monitor
