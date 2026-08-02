"""CompileValidation Stage: validates firmware with real compiler.

Repair loop: max 2 attempts for source-level errors.
Infrastructure errors (missing library, CLI not found) are NOT repairable.
"""

from __future__ import annotations

from mcu_worker.domain.models.common import Diagnostic, DiagnosticSeverity, DiagnosticSource
from mcu_worker.domain.models.compile_result import CompileResult
from mcu_worker.domain.models.stage import ArtifactPayload, StageResult, StageStatus
from mcu_worker.runtime.context import RunContext

MAX_REPAIR_ATTEMPTS = 2

# Error codes that are NOT repairable by LLM
NON_REPAIRABLE_CODES = {"CLI_NOT_FOUND", "TIMEOUT", "missing_library"}


class CompileValidationStage:
    """Compiles firmware and optionally repairs source errors."""

    @property
    def name(self) -> str:
        return "compile_validation"

    @property
    def version(self) -> str:
        return "1"

    def execute(self, ctx: RunContext) -> StageResult:
        fw_artifact = ctx.get_artifact("firmware_source")
        if not fw_artifact or not fw_artifact.content_text:
            return StageResult(status=StageStatus.FAILED, error_code="MISSING_FIRMWARE")

        source = fw_artifact.content_text
        compiler = self._get_compiler(ctx)

        if compiler is None:
            # No compiler available — this is a FAILURE per spec:
            # "Firmware 只有经过 arduino-cli compile success 才被标记为编译验证通过"
            return StageResult(
                status=StageStatus.FAILED,
                error_code="NO_COMPILER_AVAILABLE",
                warnings=[Diagnostic(
                    code="NO_COMPILER",
                    severity=DiagnosticSeverity.ERROR,
                    message="Arduino CLI compiler not available. Cannot validate firmware.",
                    source=DiagnosticSource.RUNTIME,
                )],
            )

        # First compile attempt
        result = compiler.compile(source)

        if result.success:
            return self._success_result(ctx, result)

        # Check if repairable
        if self._is_repairable(result):
            # Repair loop
            for attempt in range(1, MAX_REPAIR_ATTEMPTS + 1):
                repaired = self._attempt_repair(ctx, source, result)
                if repaired is None:
                    break
                source = repaired
                result = compiler.compile(source)
                if result.success:
                    return self._success_result(ctx, result)

        # Final failure
        return StageResult(
            status=StageStatus.FAILED,
            error_code="COMPILE_FAILED",
            warnings=[Diagnostic(
                code="COMPILE_FAILED",
                severity=DiagnosticSeverity.ERROR,
                message=f"Compilation failed: {result.stderr_excerpt[:200]}",
                source=DiagnosticSource.COMPILER,
            )],
        )

    def _get_compiler(self, ctx: RunContext):
        """Get compiler adapter from context (injected)."""
        return getattr(ctx, "compiler", None)

    def _is_repairable(self, result: CompileResult) -> bool:
        """Determine if compile errors are source-level and repairable."""
        for diag in result.diagnostics:
            if diag.code in NON_REPAIRABLE_CODES:
                return False
        return bool(result.diagnostics)

    def _attempt_repair(self, ctx: RunContext, source: str, result: CompileResult) -> str | None:
        """Ask LLM to repair source based on compiler diagnostics."""
        if not ctx.llm_provider:
            return None
        # In production: send diagnostics + source to LLM for targeted repair
        # For now: no repair without LLM
        return None

    def _success_result(self, ctx: RunContext, result: CompileResult) -> StageResult:
        return StageResult(
            status=StageStatus.SUCCEEDED,
            outputs={
                "compile_result": ArtifactPayload(
                    artifact_type="compile_result",
                    content_json=result.model_dump(),
                    content_hash=f"compile_{ctx.run_id}",
                )
            },
        )
