"""Minimal test to verify the worker package is importable."""

import mcu_worker


def test_version():
    assert mcu_worker.__version__ == "0.1.0"


def test_package_importable():
    assert hasattr(mcu_worker, "__version__")
