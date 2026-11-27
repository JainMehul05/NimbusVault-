"""Process-local SDK instrumentation; no document data and no paid metric publishing."""
import os
import threading

_lock = threading.Lock()
_vector_queries = 0


def record_vector_query(**_):
    global _vector_queries
    with _lock:
        _vector_queries += 1


def snapshot():
    with _lock:
        return {'process_id': os.getpid(), 'vector_query_sdk_calls': _vector_queries}
