"""PROTOTYPE - E2E smoke test for V2 pipeline chain.

Question: Does the full chain work?
  Insert DesignRun -> publish to RabbitMQ -> Worker consumes -> Pipeline executes -> stage_runs in DB

Run: python worker/prototype_e2e_smoke.py
Wipe: This file is throwaway. Delete after validating.
"""

import json
import os
import sys
import time
import uuid

import pika
import psycopg

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://mcu:mcu_secret@localhost:5432/mcu_assistant",
)
RABBITMQ_URL = os.environ.get(
    "RABBITMQ_URL",
    "amqp://mcu_service:mcu_mq_secret@localhost:5672/",
)
QUEUE = "design.run"
TIMEOUT_SECONDS = 30


def main():
    print("=" * 60)
    print("PROTOTYPE: V2 E2E Smoke Test")
    print("=" * 60)

    run_id = str(uuid.uuid4())
    draft_id = str(uuid.uuid4())

    print(f"\n[1] Inserting test DesignRun: {run_id}")
    conn = psycopg.connect(DATABASE_URL, autocommit=True)

    user_id = str(uuid.uuid4())
    with conn.cursor() as cur:
        # Create test user (FK target)
        cur.execute(
            "INSERT INTO users (id, email, password_hash, created_at) "
            "VALUES (%s, %s, %s, NOW()) ON CONFLICT (id) DO NOTHING",
            (user_id, f"smoke_{run_id[:8]}@test.local", "fake_hash"),
        )
        cur.execute(
            "INSERT INTO design_drafts (id, user_id, title, raw_description, status) "
            "VALUES (%s, %s, %s, %s, 'analyzing') ON CONFLICT (id) DO NOTHING",
            (draft_id, user_id, "E2E Smoke Test", "Blink an LED"),
        )
        cur.execute(
            "INSERT INTO design_runs (id, design_draft_id, pipeline_version, status, input_snapshot) "
            "VALUES (%s, %s, '2.0', 'queued', %s)",
            (run_id, draft_id, json.dumps({
                "description": "Blink an LED on pin 13",
                "target_platform": "arduino_uno",
                "experience_level": "beginner",
            })),
        )
    print("    OK: DesignRun inserted (status=queued)")

    print(f"\n[2] Publishing job to '{QUEUE}' queue...")
    params = pika.URLParameters(RABBITMQ_URL)
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    channel.queue_declare(
        queue=QUEUE, durable=True,
        arguments={"x-dead-letter-exchange": "", "x-dead-letter-routing-key": "design.run.retry.5s"},
    )
    message = json.dumps({"run_id": run_id})
    channel.basic_publish(
        exchange="", routing_key=QUEUE, body=message.encode(),
        properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
    )
    print(f"    OK: Published: {message}")
    connection.close()

    print(f"\n[3] Waiting for worker (timeout={TIMEOUT_SECONDS}s)...")
    start = time.time()
    final_status = None

    while time.time() - start < TIMEOUT_SECONDS:
        time.sleep(2)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, current_stage, error_code FROM design_runs WHERE id = %s",
                (run_id,),
            )
            row = cur.fetchone()
            if row:
                status, stage, error = row
                elapsed = int(time.time() - start)
                print(f"    [{elapsed}s] status={status} stage={stage} error={error}")
                if status in ("succeeded", "failed", "cancelled"):
                    final_status = status
                    break

    print(f"\n[4] Results:")
    if final_status is None:
        print(f"    TIMEOUT: Run not terminal after {TIMEOUT_SECONDS}s")
        print(f"    Worker may not be consuming. Check: docker compose logs design-worker")
    else:
        print(f"    Final status: {final_status}")
        with conn.cursor() as cur:
            cur.execute(
                "SELECT stage_name, status, error_code FROM stage_runs "
                "WHERE design_run_id = %s ORDER BY created_at",
                (run_id,),
            )
            stages = cur.fetchall()
            if stages:
                print(f"    Stage runs ({len(stages)}):")
                for name, st, err in stages:
                    icon = "OK" if st == "succeeded" else "FAIL" if st == "failed" else "??"
                    print(f"      [{icon}] {name}: {st}" + (f" ({err})" if err else ""))
            else:
                print("    No stage_runs found (worker did not persist)")

    print(f"\n[5] Cleanup...")
    with conn.cursor() as cur:
        cur.execute("DELETE FROM stage_runs WHERE design_run_id = %s", (run_id,))
        cur.execute("DELETE FROM design_runs WHERE id = %s", (run_id,))
        cur.execute("DELETE FROM design_drafts WHERE id = %s", (draft_id,))
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
    conn.close()
    print("    OK: Cleaned up")

    print(f"\n{'=' * 60}")
    if final_status == "succeeded":
        print("VERDICT: E2E chain WORKS. Full pipeline executed.")
    elif final_status == "failed":
        print("VERDICT: Chain WIRED but pipeline FAILED at a stage.")
        print("  Expected: compile_validation fails (no arduino-cli).")
    else:
        print("VERDICT: Chain NOT WORKING. Worker did not process.")
    print("=" * 60)
    return 0 if final_status in ("succeeded", "failed") else 1


if __name__ == "__main__":
    sys.exit(main())
