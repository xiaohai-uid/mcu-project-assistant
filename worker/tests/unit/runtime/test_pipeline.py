"""Tests for PipelineRuntime, Stage protocol, and RunContext."""


from mcu_worker.domain.models.stage import ArtifactPayload, StageResult, StageStatus
from mcu_worker.runtime.context import RunContext
from mcu_worker.runtime.pipeline import (
    FakeStageRunRepository,
    PipelineDefinition,
    PipelineRuntime,
)
from mcu_worker.runtime.stage import Stage


class SuccessStage:
    """A test stage that always succeeds."""

    def __init__(self, name: str = "test_stage"):
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    @property
    def version(self) -> str:
        return "1"

    def execute(self, ctx: RunContext) -> StageResult:
        return StageResult(
            status=StageStatus.SUCCEEDED,
            outputs={
                f"{self._name}_output": ArtifactPayload(
                    artifact_type="design_spec",
                    content_json={"stage": self._name},
                    content_hash="abc",
                )
            },
        )


class FailingStage:
    """A test stage that always fails."""

    @property
    def name(self) -> str:
        return "failing_stage"

    @property
    def version(self) -> str:
        return "1"

    def execute(self, ctx: RunContext) -> StageResult:
        return StageResult(
            status=StageStatus.FAILED,
            error_code="TEST_FAILURE",
            retryable=False,
        )


class WaitingStage:
    """A test stage that pauses for user input."""

    @property
    def name(self) -> str:
        return "waiting_stage"

    @property
    def version(self) -> str:
        return "1"

    def execute(self, ctx: RunContext) -> StageResult:
        return StageResult(status=StageStatus.WAITING_FOR_USER)


class ExplodingStage:
    """A test stage that raises an exception."""

    @property
    def name(self) -> str:
        return "exploding_stage"

    @property
    def version(self) -> str:
        return "1"

    def execute(self, ctx: RunContext) -> StageResult:
        raise RuntimeError("Unexpected boom")


def make_ctx(**kwargs) -> RunContext:
    return RunContext(run_id="run_1", design_draft_id="draft_1", **kwargs)


class TestStageProtocol:
    def test_success_stage_is_stage(self):
        assert isinstance(SuccessStage(), Stage)

    def test_failing_stage_is_stage(self):
        assert isinstance(FailingStage(), Stage)


class TestPipelineRuntime:
    def test_all_stages_succeed(self):
        definition = PipelineDefinition(stages=[
            SuccessStage("stage_a"),
            SuccessStage("stage_b"),
            SuccessStage("stage_c"),
        ])
        runtime = PipelineRuntime(definition)
        ctx = make_ctx()
        result = runtime.execute(ctx)

        assert result.status == StageStatus.SUCCEEDED
        assert result.completed_stages == ["stage_a", "stage_b", "stage_c"]
        assert result.failed_stage is None

    def test_artifacts_accumulated(self):
        definition = PipelineDefinition(stages=[
            SuccessStage("stage_a"),
            SuccessStage("stage_b"),
        ])
        runtime = PipelineRuntime(definition)
        ctx = make_ctx()
        runtime.execute(ctx)

        assert "stage_a_output" in ctx.artifacts
        assert "stage_b_output" in ctx.artifacts

    def test_failure_stops_pipeline(self):
        definition = PipelineDefinition(stages=[
            SuccessStage("stage_a"),
            FailingStage(),
            SuccessStage("stage_c"),
        ])
        runtime = PipelineRuntime(definition)
        ctx = make_ctx()
        result = runtime.execute(ctx)

        assert result.status == StageStatus.FAILED
        assert result.completed_stages == ["stage_a"]
        assert result.failed_stage == "failing_stage"
        assert result.error_code == "TEST_FAILURE"
        # stage_c should NOT have run
        assert "stage_c_output" not in ctx.artifacts

    def test_waiting_for_user_stops_pipeline(self):
        definition = PipelineDefinition(stages=[
            SuccessStage("stage_a"),
            WaitingStage(),
            SuccessStage("stage_c"),
        ])
        runtime = PipelineRuntime(definition)
        ctx = make_ctx()
        result = runtime.execute(ctx)

        assert result.status == StageStatus.WAITING_FOR_USER
        assert result.completed_stages == ["stage_a", "waiting_stage"]
        assert "stage_c_output" not in ctx.artifacts

    def test_cancellation_at_boundary(self):
        definition = PipelineDefinition(stages=[
            SuccessStage("stage_a"),
            SuccessStage("stage_b"),
        ])
        runtime = PipelineRuntime(definition)
        ctx = make_ctx(cancel_requested=True)
        result = runtime.execute(ctx)

        assert result.status == StageStatus.FAILED
        assert result.error_code == "CANCELLED"
        assert result.completed_stages == []

    def test_exception_handled_gracefully(self):
        definition = PipelineDefinition(stages=[ExplodingStage()])
        runtime = PipelineRuntime(definition)
        ctx = make_ctx()
        result = runtime.execute(ctx)

        assert result.status == StageStatus.FAILED
        assert result.error_code == "UNEXPECTED_ERROR"
        assert "boom" in (result.error_message or "")

    def test_stage_order_from_definition(self):
        """Stage order is determined solely by PipelineDefinition."""
        definition = PipelineDefinition(stages=[
            SuccessStage("z_first"),
            SuccessStage("a_second"),
        ])
        assert definition.stage_names == ["z_first", "a_second"]


class TestFakeRepository:
    def test_tracks_stage_runs(self):
        repo = FakeStageRunRepository()
        sr_id = repo.create_stage_run("run_1", "stage_a", "1", 1)
        repo.mark_running(sr_id)
        repo.mark_succeeded(sr_id, {"result": "ok"})

        assert len(repo.stage_runs) == 1
        assert repo.stage_runs[0]["status"] == "succeeded"
        assert repo.stage_runs[0]["output_json"] == {"result": "ok"}
