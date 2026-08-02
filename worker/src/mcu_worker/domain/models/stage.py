"""Stage execution result types."""

from enum import StrEnum

from pydantic import BaseModel, Field

from mcu_worker.domain.models.common import Diagnostic


class StageStatus(StrEnum):
    SUCCEEDED = "succeeded"
    WAITING_FOR_USER = "waiting_for_user"
    FAILED = "failed"


class ArtifactPayload(BaseModel):
    """A typed artifact produced by a stage."""

    artifact_type: str = Field(
        ...,
        description=(
            "One of: design_spec, component_selection, bom, firmware_source, "
            "compile_result, circuit_ir, wiring_svg, wiring_checklist, "
            "upload_instructions, price_snapshot"
        ),
    )
    schema_version: str = Field(default="1")
    content_json: dict[str, object] | None = None
    content_text: str | None = None
    content_hash: str = Field(default="", description="SHA-256 of serialized content")


class StageResult(BaseModel):
    """Result returned by every Stage.execute() call."""

    status: StageStatus
    outputs: dict[str, ArtifactPayload] = Field(default_factory=dict)
    warnings: list[Diagnostic] = Field(default_factory=list)
    next_action: str | None = None
    retryable: bool = False
    error_code: str | None = None
