"""Tests for execution observability."""

import pytest

from mcu_worker.observability.logging import ExecutionLogger


class TestExecutionLogger:
    def test_tracks_stage_duration(self):
        logger = ExecutionLogger(run_id="test_run")
        with logger.stage("stage_a") as metrics:
            pass  # instant
        assert metrics.duration_ms >= 0
        assert metrics.success is True

    def test_tracks_failure(self):
        logger = ExecutionLogger(run_id="test_run")
        with pytest.raises(ValueError):
            with logger.stage("bad_stage") as metrics:
                raise ValueError("oops")
        assert metrics.success is False
        assert metrics.error_code == "ValueError"

    def test_summary(self):
        logger = ExecutionLogger(run_id="test_run")
        with logger.stage("a"):
            pass
        with logger.stage("b"):
            pass
        summary = logger.summary()
        assert summary["total_stages"] == 2
        assert summary["succeeded"] == 2
        assert summary["failed"] == 0

    def test_metrics_stored(self):
        logger = ExecutionLogger(run_id="r1")
        with logger.stage("x") as m:
            m.llm_provider = "openai"
            m.llm_model = "gpt-4o"
        assert logger.all_metrics[0].llm_provider == "openai"
