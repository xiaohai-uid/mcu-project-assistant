"""Shared diagnostic types used across all stages."""

from enum import StrEnum

from pydantic import BaseModel, Field


class DiagnosticSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class DiagnosticSource(StrEnum):
    DOMAIN = "domain"
    COMPILER = "compiler"
    LLM = "llm"
    SUPPLIER = "supplier"
    RUNTIME = "runtime"


class Diagnostic(BaseModel):
    """Structured diagnostic message attached to stage results."""

    code: str = Field(..., description="Machine-readable code, e.g. PIN_BUDGET_EXCEEDED")
    severity: DiagnosticSeverity
    message: str = Field(..., description="Safe user-readable message")
    details: dict[str, object] = Field(default_factory=dict)
    source: DiagnosticSource = DiagnosticSource.DOMAIN
    retryable: bool = False
