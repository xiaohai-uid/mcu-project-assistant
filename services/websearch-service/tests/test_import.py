"""Verify websearch-service main module imports cleanly (no missing deps)."""
import sys
import os
import types
from unittest.mock import MagicMock

_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(os.path.dirname(_SERVICE_DIR))
sys.path.insert(0, _SERVICE_DIR)
sys.path.insert(0, _REPO_ROOT)

_shared = types.ModuleType("shared")
_shared.rabbitmq = types.ModuleType("shared.rabbitmq")
_shared.rabbitmq.queues = MagicMock()
_shared.bootstrap = types.ModuleType("shared.bootstrap")
_shared.bootstrap.run_service = MagicMock()
_shared.bootstrap.QueueBinding = MagicMock()
_shared.bootstrap.make_rabbitmq_client = MagicMock()
sys.modules["shared"] = _shared
sys.modules["shared.rabbitmq"] = _shared.rabbitmq
sys.modules["shared.rabbitmq.queues"] = _shared.rabbitmq.queues
sys.modules["shared.bootstrap"] = _shared.bootstrap

import threading as _threading
sys.modules["threading"] = _threading

# This should NOT raise ImportError / NameError (main.py now imports threading itself)
try:
    import importlib.util
    _main_path = os.path.join(_SERVICE_DIR, "main.py")
    _spec = importlib.util.spec_from_file_location("websearch_main_clean", _main_path)
    _mod = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    IMPORT_OK = True
    IMPORT_ERROR = None
except Exception as e:
    IMPORT_OK = False
    IMPORT_ERROR = str(e)


def test_main_module_imports_without_threading_error():
    """main.py uses threading.Lock() and must import threading itself."""
    assert IMPORT_OK, f"Import failed: {IMPORT_ERROR}"


def test_circuit_breaker_initializes():
    """CircuitBreaker should be instantiable after import."""
    assert IMPORT_OK
    import importlib.util
    _main_path = os.path.join(_SERVICE_DIR, "main.py")
    _spec = importlib.util.spec_from_file_location("websearch_main_cb", _main_path)
    _mod = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    cb = _mod.CircuitBreaker()
    assert cb is not None
