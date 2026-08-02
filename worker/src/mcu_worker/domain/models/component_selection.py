"""ComponentSelection: output of the ComponentResolution stage."""

from pydantic import BaseModel, Field

from mcu_worker.domain.models.common import Diagnostic


class SelectionItem(BaseModel):
    """A resolved component selection."""

    instance_id: str
    component_id: str = Field(..., description="Stable catalog id")
    quantity: int = Field(default=1, ge=1)
    matched_capabilities: list[str] = Field(default_factory=list)
    selection_reason: str = Field(default="")


class ComponentSelection(BaseModel):
    """V2 ComponentSelection: resolved components from registry."""

    schema_version: str = Field(default="1", frozen=True)
    platform_id: str = Field(default="arduino_uno")
    items: list[SelectionItem] = Field(default_factory=list)
    unresolved_capabilities: list[str] = Field(default_factory=list)
    warnings: list[Diagnostic] = Field(default_factory=list)
