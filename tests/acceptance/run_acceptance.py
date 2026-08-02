'''Acceptance Test Executor for V2 Pipeline.

Runs all JSON cases in tests/acceptance/cases/ through the live pipeline:
  1. Insert DesignRun into PostgreSQL
  2. Publish job to RabbitMQ
  3. Wait for Worker to process
  4. Verify: status, expected components, warnings
  5. Cleanup test data

Usage:
    python tests/acceptance/run_acceptance.py [--timeout 60] [--keep]

Requires:
    - docker compose up -d postgres rabbitmq design-worker
    - pip install pika psycopg
'''

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import pika
import psycopg

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DATABASE_URL = "postgresql://mcu:mcu_secret@localhost:5432/mcu_assistant"
RABBITMQ_URL = "amqp://mcu_service:mcu_mq_secret@localhost:5672/"
QUEUE = "design.run"
CASES_DIR = Path(__file__).parent / "cases"

EXPECTED_STAGES = [
    "requirement_parse",
    "component_resolution",
    "constraint_validation",
    "firmware_generation",
    "compile_validation",
    "circuit_generation",
    "artifact_render",
]


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class CaseResult:
    case_id: str
    description: str
    passed: bool
    checks: list[str] = field(default_factory=list)
    error: str | None = None
    elapsed_s: float = 0.0


# ---------------------------------------------------------------------------
# Core executor
# ---------------------------------------------------------------------------

class AcceptanceExecutor:
    def __init__(self, database_url: str, rabbitmq_url: str, timeout: int = 60, keep: bool = False):
        self._db_url = database_url
        self._mq_url = rabbitmq_url
        self._timeout = timeout
        self._keep = keep
        self._conn: psycopg.Connection | None = None

    def _get_conn(self) -> psycopg.Connection:
        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(self._db_url, autocommit=True)
        return self._conn

    def run_case(self, case: dict) -> CaseResult:
        case_id = case["id"]
        description = case["description"]
        expected_components = case.get("expected_components", [])
        expected_compile = case.get("expected_compile", True)
        min_warnings = case.get("min_warnings", 0)

        result = CaseResult(case_id=case_id, description=description, passed=False)
        run_id = str(uuid.uuid4())
        draft_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())
        start = time.time()

        try:
            # --- Setup: insert test data ---
            conn = self._get_conn()
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO users (id, email, password_hash, created_at) "
                    "VALUES (%s, %s, %s, NOW()) ON CONFLICT (id) DO NOTHING",
                    (user_id, f"accept_{case_id}_{run_id[:8]}@test.local", "fake"),
                )
                cur.execute(
                    "INSERT INTO design_drafts (id, user_id, title, raw_description, status) "
                    "VALUES (%s, %s, %s, %s, 'analyzing')",
                    (draft_id, user_id, f"Acceptance: {case_id}", description),
                )
                cur.execute(
                    "INSERT INTO design_runs (id, design_draft_id, pipeline_version, status, input_snapshot) "
                    "VALUES (%s, %s, '2.0', 'queued', %s)",
                    (run_id, draft_id, json.dumps({
                        "description": description,
                        "target_platform": "arduino_uno",
                        "experience_level": "beginner",
                    })),
                )

            # --- Publish to RabbitMQ ---
            params = pika.URLParameters(self._mq_url)
            mq_conn = pika.BlockingConnection(params)
            channel = mq_conn.channel()
            channel.queue_declare(
                queue=QUEUE, durable=True,
                arguments={"x-dead-letter-exchange": "", "x-dead-letter-routing-key": "design.run.retry.5s"},
            )
            channel.basic_publish(
                exchange="", routing_key=QUEUE,
                body=json.dumps({"run_id": run_id}).encode(),
                properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
            )
            mq_conn.close()

            # --- Poll for completion ---
            final_status = None
            while time.time() - start < self._timeout:
                time.sleep(2)
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT status, error_code, error_message FROM design_runs WHERE id = %s",
                        (run_id,),
                    )
                    row = cur.fetchone()
                    if row and row[0] in ("succeeded", "failed", "cancelled"):
                        final_status = row[0]
                        break

            result.elapsed_s = time.time() - start

            if final_status is None:
                result.error = f"TIMEOUT after {self._timeout}s"
                return result

            # --- Verify: status ---
            if expected_compile:
                if final_status == "succeeded":
                    result.checks.append("[PASS] status=succeeded")
                else:
                    result.checks.append(f"[FAIL] expected succeeded, got {final_status}")
                    # Fetch error detail
                    with conn.cursor() as cur:
                        cur.execute(
                            "SELECT error_code, error_message FROM design_runs WHERE id = %s",
                            (run_id,),
                        )
                        err = cur.fetchone()
                        if err:
                            result.checks.append(f"       error: {err[0]} - {err[1]}")
            else:
                result.checks.append(f"[INFO] status={final_status} (compile not expected)")

            # --- Verify: stage_runs ---
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT stage_name, status FROM stage_runs "
                    "WHERE design_run_id = %s ORDER BY created_at",
                    (run_id,),
                )
                stages = cur.fetchall()

            stage_names = [s[0] for s in stages]
            if final_status == "succeeded":
                if stage_names == EXPECTED_STAGES:
                    result.checks.append(f"[PASS] all {len(EXPECTED_STAGES)} stages executed in order")
                else:
                    result.checks.append(f"[WARN] stages={stage_names}")

            # --- Verify: expected components ---
            if expected_components and final_status == "succeeded":
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT output_json FROM stage_runs "
                        "WHERE design_run_id = %s AND stage_name = 'component_resolution'",
                        (run_id,),
                    )
                    row = cur.fetchone()

                if row and row[0]:
                    output = row[0] if isinstance(row[0], dict) else json.loads(row[0])
                    selection = output.get("component_selection", {})
                    selected_ids = [
                        item.get("component_id", "")
                        for item in selection.get("items", [])
                    ]
                    missing = [c for c in expected_components if c not in selected_ids]
                    if not missing:
                        result.checks.append(
                            f"[PASS] components found: {expected_components}"
                        )
                    else:
                        result.checks.append(
                            f"[FAIL] missing components: {missing} (got: {selected_ids})"
                        )
                else:
                    result.checks.append("[WARN] no component_resolution output_json (stage output not persisted)")

            # --- Verify: warnings ---
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT warning_count FROM design_runs WHERE id = %s", (run_id,)
                )
                wrow = cur.fetchone()
            warning_count = wrow[0] if wrow else 0
            if warning_count >= min_warnings:
                result.checks.append(f"[PASS] warnings={warning_count} >= min={min_warnings}")
            else:
                result.checks.append(f"[FAIL] warnings={warning_count} < min={min_warnings}")

            # --- Overall pass/fail ---
            result.passed = all("[FAIL]" not in c for c in result.checks)
            if final_status == "succeeded" and expected_compile:
                result.passed = result.passed and True
            elif expected_compile and final_status != "succeeded":
                result.passed = False

        except Exception as e:
            result.error = str(e)
        finally:
            result.elapsed_s = time.time() - start
            # --- Cleanup ---
            if not self._keep:
                try:
                    conn = self._get_conn()
                    with conn.cursor() as cur:
                        cur.execute("DELETE FROM stage_runs WHERE design_run_id = %s", (run_id,))
                        cur.execute("DELETE FROM design_runs WHERE id = %s", (run_id,))
                        cur.execute("DELETE FROM design_drafts WHERE id = %s", (draft_id,))
                        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
                except Exception:
                    pass

        return result

    def close(self):
        if self._conn and not self._conn.closed:
            self._conn.close()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="V2 Pipeline Acceptance Test Executor")
    parser.add_argument("--timeout", type=int, default=60, help="Per-case timeout (seconds)")
    parser.add_argument("--keep", action="store_true", help="Keep test data in DB (for debugging)")
    parser.add_argument("--case", type=str, help="Run only a specific case by id")
    args = parser.parse_args()

    # Load cases
    cases = []
    for f in sorted(CASES_DIR.glob("*.json")):
        case = json.loads(f.read_text(encoding="utf-8"))
        if args.case and case["id"] != args.case:
            continue
        cases.append(case)

    if not cases:
        print("No cases found in", CASES_DIR)
        return 1

    print("=" * 70)
    print(f"  MCU V2 Acceptance Test Executor")
    print(f"  Cases: {len(cases)} | Timeout: {args.timeout}s | Keep: {args.keep}")
    print("=" * 70)

    executor = AcceptanceExecutor(DATABASE_URL, RABBITMQ_URL, timeout=args.timeout, keep=args.keep)
    results: list[CaseResult] = []

    for i, case in enumerate(cases, 1):
        print(f"\n[{i}/{len(cases)}] {case['id']}: {case['description']}")
        r = executor.run_case(case)
        results.append(r)
        for check in r.checks:
            print(f"    {check}")
        if r.error:
            print(f"    [ERROR] {r.error}")
        verdict = "PASS" if r.passed else "FAIL"
        print(f"    => {verdict} ({r.elapsed_s:.1f}s)")

    executor.close()

    # Summary
    passed = sum(1 for r in results if r.passed)
    failed = len(results) - passed
    print(f"\n{'=' * 70}")
    print(f"  RESULTS: {passed} passed, {failed} failed, {len(results)} total")
    print(f"{'=' * 70}")

    if failed:
        print("\n  Failed cases:")
        for r in results:
            if not r.passed:
                print(f"    - {r.case_id}: {r.error or 'assertion failure'}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
