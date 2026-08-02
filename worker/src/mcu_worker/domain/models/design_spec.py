"""DesignSpec: the canonical output of the Requirement stage.

Represents user capability needs, NOT hardware model answers.
"""

from enum import StrEnum

from pydantic import BaseModel, Field


class ExperienceLevel(StrEnum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class CapabilityRequirement(BaseModel):
    """A single capability the user needs (e.g. temperature_sensing)."""

    capability: str = Field(..., description="Stable capability identifier")
    quantity: int = Field(default=1, ge=1)
    required: bool = True
    constraints: dict[str, object] = Field(default_factory=dict)


class PowerConstraints(BaseModel):
    """Power supply constraints for the design."""

    source: str = Field(default="usb", description="e.g. usb, battery, external")
    max_voltage: float = Field(default=5.0, gt=0)
    max_current_ma: float = Field(default=500.0, gt=0)


class Budget(BaseModel):
    """Budget constraint."""

    currency: str = Field(default="CNY")
    max_amount: float = Field(default=100.0, gt=0)


class Clarification(BaseModel):
    """Clarification questions when input is vague."""

    required: bool = False
    questions: list[str] = Field(default_factory=list)


class DesignSpec(BaseModel):
    """V2 DesignSpec: capability-driven design specification.

    This is the output of RequirementParse stage.
    It describes WHAT the user needs, not WHICH components to use.
    """

    schema_version: str = Field(default="2.0", frozen=True)
    title: str
    description: str
    target_platform: str = Field(default="arduino_uno")
    experience_level: ExperienceLevel = ExperienceLevel.BEGINNER
    capabilities: list[CapabilityRequirement] = Field(default_factory=list)
    communication: list[str] = Field(default_factory=list)
    power_constraints: PowerConstraints = Field(default_factory=PowerConstraints)
    budget: Budget = Field(default_factory=Budget)
    user_constraints: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    clarification: Clarification = Field(default_factory=Clarification)
