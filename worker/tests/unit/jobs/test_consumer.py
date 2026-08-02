"""Tests for design.run consumer message handling."""

import json

import pytest

from mcu_worker.jobs.consumer import MAX_SYSTEM_RETRIES, DesignRunConsumer, RunJobMessage


class TestRunJobMessage:
    def test_valid_message(self):
        body = json.dumps({"run_id": "abc-123"}).encode()
        msg = RunJobMessage.from_body(body)
        assert msg.run_id == "abc-123"
        assert msg.delivery_attempt == 1

    def test_with_delivery_attempt(self):
        body = json.dumps({"run_id": "abc", "delivery_attempt": 2}).encode()
        msg = RunJobMessage.from_body(body)
        assert msg.delivery_attempt == 2

    def test_rejects_missing_run_id(self):
        body = json.dumps({"foo": "bar"}).encode()
        with pytest.raises(ValueError, match="run_id"):
            RunJobMessage.from_body(body)

    def test_rejects_business_payload(self):
        body = json.dumps({"run_id": "x", "requirement": {"title": "t"}, "components": []}).encode()
        with pytest.raises(ValueError, match="forbidden"):
            RunJobMessage.from_body(body)

    def test_rejects_invalid_json(self):
        with pytest.raises(ValueError, match="Invalid"):
            RunJobMessage.from_body(b"not json")

    def test_rejects_non_object(self):
        with pytest.raises(ValueError, match="JSON object"):
            RunJobMessage.from_body(b'"just a string"')


class TestDesignRunConsumer:
    def test_ack_valid_message(self):
        consumer = DesignRunConsumer(pipeline_executor=lambda run_id: None)
        body = json.dumps({"run_id": "test-run"}).encode()
        assert consumer.handle_message(body) is True

    def test_ack_invalid_message_no_requeue(self):
        consumer = DesignRunConsumer()
        assert consumer.handle_message(b"garbage") is True

    def test_nack_on_executor_failure(self):
        def failing_executor(run_id):
            raise RuntimeError("boom")

        consumer = DesignRunConsumer(pipeline_executor=failing_executor)
        body = json.dumps({"run_id": "test-run"}).encode()
        assert consumer.handle_message(body) is False

    def test_nack_exceeds_max_retries(self):
        consumer = DesignRunConsumer()
        body = json.dumps({"run_id": "x", "delivery_attempt": MAX_SYSTEM_RETRIES + 1}).encode()
        assert consumer.handle_message(body) is False
