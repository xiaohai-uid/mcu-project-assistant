"""PostgreSQL-backed StageRunRepository.

Replaces FakeStageRunRepository for production use.
Persists stage runs, artifacts, and run status to PostgreSQL.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import psycopg

from mcu_worker.runtime.pipeline import StageRunRepository

logger = logging.getLogger(__name__)


class PgStageRunRepository(StageRunRepository):
    """Production repository using PostgreSQL via psycopg3."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self._conn: psycopg.Connection | None = None

    def _get_conn(self) -> psycopg.Connection:
        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(self._database_url, autocommit=False)
        return self._conn

    def load_run(self, run_id: str) -> dict | None:
        """Load a design run from the database."""
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, design_draft_id, input_snapshot, status FROM design_runs WHERE id = %s",
                (run_id,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            return {
                "id": str(row[0]),
                "design_draft_id": str(row[1]),
                "input_snapshot": row[2] if isinstance(row[2], dict) else json.loads(row[2] or "{}"),
                "status": row[3],
            }

    def update_run_status(
        self,
        run_id: str,
        status: str,
        current_stage: str | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> None:
        """Update the design run status."""
        conn = self._get_conn()
        now = datetime.now(timezone.utc)
        with conn.cursor() as cur:
            if status in ("succeeded", "failed", "cancelled"):
                cur.execute(
                    """UPDATE design_runs
                       SET status = %s, current_stage = %s, error_code = %s,
                           error_message = %s, finished_at = %s
                       WHERE id = %s""",
                    (status, current_stage, error_code, error_message, now, run_id),
                )
            else:
                cur.execute(
                    """UPDATE design_runs
                       SET status = %s, current_stage = %s, started_at = COALESCE(started_at, %s)
                       WHERE id = %s""",
                    (status, current_stage, now, run_id),
                )
        conn.commit()

    def create_stage_run(
        self, run_id: str, stage_name: str, stage_version: str, attempt: int
    ) -> str:
        """Create a stage_run record, return its id."""
        conn = self._get_conn()
        idempotency_key = f"{run_id}:{stage_name}:{stage_version}:{attempt}"
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO stage_runs (design_run_id, stage_name, stage_version, attempt, status, idempotency_key)
                   VALUES (%s, %s, %s, %s, 'pending', %s)
                   ON CONFLICT (idempotency_key) DO UPDATE SET status = stage_runs.status
                   RETURNING id""",
                (run_id, stage_name, stage_version, attempt, idempotency_key),
            )
            row = cur.fetchone()
        conn.commit()
        return str(row[0])

    def mark_running(self, stage_run_id: str) -> None:
        conn = self._get_conn()
        now = datetime.now(timezone.utc)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE stage_runs SET status = 'running', started_at = %s WHERE id = %s",
                (now, stage_run_id),
            )
        conn.commit()

    def mark_succeeded(self, stage_run_id: str, output_json: dict | None) -> None:
        conn = self._get_conn()
        now = datetime.now(timezone.utc)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE stage_runs SET status = 'succeeded', output_json = %s, finished_at = %s WHERE id = %s",
                (json.dumps(output_json) if output_json else None, now, stage_run_id),
            )
        conn.commit()

    def mark_failed(
        self, stage_run_id: str, error_code: str | None, error_message: str | None
    ) -> None:
        conn = self._get_conn()
        now = datetime.now(timezone.utc)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE stage_runs SET status = 'failed',"
                " error_code = %s, error_message = %s, finished_at = %s WHERE id = %s",
                (error_code, error_message, now, stage_run_id),
            )
        conn.commit()

    def find_succeeded_by_idempotency_key(self, key: str) -> dict | None:
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT output_json FROM stage_runs WHERE idempotency_key = %s AND status = 'succeeded'",
                (key,),
            )
            row = cur.fetchone()
            if row and row[0]:
                return row[0] if isinstance(row[0], dict) else json.loads(row[0])
        return None
