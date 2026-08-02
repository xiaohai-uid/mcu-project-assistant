"""Idempotency: prevents duplicate artifacts on crash/retry.

idempotency_key = sha256(run_id + stage_name + stage_version + input_hash + attempt)

Before executing a stage, check if a succeeded StageRun with the same key exists.
If yes, reuse its output instead of re-executing.
"""

from __future__ import annotations

import hashlib
import json


def compute_idempotency_key(
    run_id: str,
    stage_name: str,
    stage_version: str,
    input_hash: str,
    attempt: int,
) -> str:
    """Compute a deterministic idempotency key for a stage execution.

    The key uniquely identifies a specific stage execution context.
    Same inputs -> same key -> reuse previous result.
    """
    payload = f"{run_id}:{stage_name}:{stage_version}:{input_hash}:{attempt}"
    return hashlib.sha256(payload.encode()).hexdigest()


def compute_input_hash(artifacts: dict) -> str:
    """Compute a canonical hash of the input artifacts for a stage.

    Used to detect when upstream inputs change (invalidating downstream).
    """
    # Sort keys for deterministic serialization
    canonical = json.dumps(
        {k: v.content_hash if hasattr(v, "content_hash") else str(v)
         for k, v in sorted(artifacts.items())},
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()
