"""CompileResult: output of the CompileValidation stage."""

from pydantic import BaseModel, Field

from mcu_worker.domain.models.common import Diagnostic


class CompileDiagnostic(BaseModel):
    """A single compiler diagnostic entry."""

    code: str = Field(default="")
    file: str = Field(default="")
    line: int | None = None
    column: int | None = None
    message: str = Field(default="")
    category: str = Field(default="error", description="error | warning | info")


class CompileResult(BaseModel):
    """Result of an arduino-cli compile invocation."""

    schema_version: str = Field(default="1", frozen=True)
    compiler: str = Field(default="arduino-cli")
    compiler_version: str = Field(default="")
    fqbn: str = Field(default="arduino:avr:uno")
    success: bool
    exit_code: int
    duration_ms: int = Field(default=0, ge=0)
    stdout_excerpt: str = Field(default="")
    stderr_excerpt: str = Field(default="")
    diagnostics: list[CompileDiagnostic] = Field(default_factory=list)
    warnings: list[Diagnostic] = Field(default_factory=list)
