"""Tests for reliability: idempotency, cancellation, resume, retry."""


from mcu_worker.runtime.cancellation import (
    CancellationChecker,
    compute_resume_point,
)
from mcu_worker.runtime.idempotency import compute_idempotency_key, compute_input_hash
from mcu_worker.runtime.retry import should_retry


class TestIdempotency:
    def test_deterministic_key(self):
        key1 = compute_idempotency_key("run1", "stage_a", "1", "hash_abc", 1)
        key2 = compute_idempotency_key("run1", "stage_a", "1", "hash_abc", 1)
        assert key1 == key2

    def test_different_inputs_different_key(self):
        key1 = compute_idempotency_key("run1", "stage_a", "1", "hash_abc", 1)
        key2 = compute_idempotency_key("run1", "stage_a", "1", "hash_xyz", 1)
        assert key1 != key2

    def test_different_attempt_different_key(self):
        key1 = compute_idempotency_key("run1", "stage_a", "1", "hash", 1)
        key2 = compute_idempotency_key("run1", "stage_a", "1", "hash", 2)
        assert key1 != key2

    def test_input_hash_deterministic(self):
        class FakeArtifact:
            content_hash = "abc"
        h1 = compute_input_hash({"a": FakeArtifact(), "b": FakeArtifact()})
        h2 = compute_input_hash({"b": FakeArtifact(), "a": FakeArtifact()})
        assert h1 == h2  # Order independent


class TestCancellation:
    def test_not_cancelled_by_default(self):
        checker = CancellationChecker()
        assert checker.is_cancelled("run1") is False

    def test_cancelled_with_fn(self):
        checker = CancellationChecker(check_fn=lambda run_id: run_id == "cancelled_run")
        assert checker.is_cancelled("cancelled_run") is True
        assert checker.is_cancelled("normal_run") is False


class TestResume:
    def test_resume_from_beginning(self):
        point = compute_resume_point(
            stage_names=["a", "b", "c"],
            succeeded_stages=[],
        )
        assert point.resume_from_index == 0
        assert point.last_succeeded_stage is None

    def test_resume_after_first(self):
        point = compute_resume_point(
            stage_names=["a", "b", "c"],
            succeeded_stages=["a"],
        )
        assert point.resume_from_index == 1
        assert point.last_succeeded_stage == "a"

    def test_resume_after_two(self):
        point = compute_resume_point(
            stage_names=["a", "b", "c"],
            succeeded_stages=["a", "b"],
        )
        assert point.resume_from_index == 2

    def test_invalidation_forces_rerun(self):
        point = compute_resume_point(
            stage_names=["a", "b", "c"],
            succeeded_stages=["a", "b"],
            invalidated=["b"],
        )
        # b is invalidated, so resume from b (index 1)
        assert point.resume_from_index == 1
        assert "b" in point.invalidated_stages


class TestRetry:
    def test_should_retry_within_limit(self):
        assert should_retry(1) is True
        assert should_retry(2) is True
        assert should_retry(3) is True

    def test_should_not_retry_over_limit(self):
        assert should_retry(4) is False
        assert should_retry(10) is False
