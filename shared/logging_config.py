"""Structured JSON logging for Python microservices.

Replaces print() calls with proper structured logging.
In production: outputs JSON lines for log aggregation.
In development: outputs human-readable format.
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    """Emit structured JSON log lines (NDJSON)."""

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "level": record.levelname.lower(),
            "time": datetime.now(timezone.utc).isoformat(),
            "msg": record.getMessage(),
            "logger": record.name,
        }
        if record.exc_info and record.exc_info[0]:
            entry["exception"] = self.formatException(record.exc_info)
        # Merge extra fields
        for key in ("stage", "design_draft_id", "service", "request_id"):
            val = getattr(record, key, None)
            if val is not None:
                entry[key] = val
        return json.dumps(entry, ensure_ascii=False)


class DevFormatter(logging.Formatter):
    """Human-readable format for local development."""

    COLORS = {
        "DEBUG": "\033[36m",
        "INFO": "\033[32m",
        "WARNING": "\033[33m",
        "ERROR": "\033[31m",
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        ts = datetime.now().strftime("%H:%M:%S")
        msg = record.getMessage()
        base = f"[{ts}] {color}{record.levelname[:3]}{self.RESET} {record.name}: {msg}"
        if record.exc_info and record.exc_info[0]:
            base += "\n" + self.formatException(record.exc_info)
        return base


def setup_logging(service_name: str) -> logging.Logger:
    """Configure and return the root logger for a service."""
    logger = logging.getLogger(service_name)
    if logger.handlers:
        return logger  # Already configured

    logger.setLevel(logging.DEBUG)
    handler = logging.StreamHandler(sys.stdout)

    is_prod = os.getenv("ENV", "development") == "production"
    if is_prod:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(DevFormatter())

    logger.addHandler(handler)
    logger.propagate = False
    return logger


def get_logger(name: str) -> logging.Logger:
    """Get a named child logger."""
    return logging.getLogger(name)
