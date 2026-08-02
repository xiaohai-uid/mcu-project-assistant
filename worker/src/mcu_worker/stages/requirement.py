"""RequirementParse Stage: parses user description into DesignSpec.

V2 key change: outputs capability needs, NOT hardware model answers.
"""

from __future__ import annotations

from mcu_worker.domain.models.design_spec import DesignSpec
from mcu_worker.domain.models.stage import ArtifactPayload, StageResult, StageStatus
from mcu_worker.runtime.context import RunContext

# Deterministic keyword -> capability mapping (no-LLM fallback)
_KEYWORD_CAPABILITIES: list[tuple[list[str], str]] = [
    (["temperature", "temp", "dht"], "temperature_sensing"),
    (["humidity"], "humidity_sensing"),
    (["bluetooth", "hc-05", "hc05"], "bluetooth_communication"),
    (["led strip", "rgb", "ws2812"], "rgb_lighting"),
    (["buzzer", "alarm", "beep"], "audio_alert"),
    (["lcd", "lcd1602", "character display"], "text_display"),
    (["oled", "graphical display"], "graphical_display"),
    (["rfid", "rc522", "card reader"], "rfid_reading"),
    (["relay", "high power", "mains"], "high_power_switching"),
    (["servo", "sg90", "angular"], "angular_control"),
    (["soil moisture", "water plant", "irrigation"], "soil_moisture_sensing"),
    (["water pump", "pump"], "water_pump_control"),
    (["ultrasonic", "hc-sr04", "hcsr04", "distance"], "distance_sensing"),
    (["pressure", "bmp280", "weather", "altitude", "barometric"], "pressure_sensing"),
    (["keypad", "4x4", "matrix keyboard"], "keypad_input"),
    (["light", "photoresistor", "ldr", "ambient light"], "light_sensing"),
    (["air quality", "gas", "mq135", "co2"], "air_quality_sensing"),
    (["sound", "microphone", "noise"], "sound_sensing"),
    (["water level", "tank level"], "water_level_sensing"),
    (["motor", "l298n", "dc motor", "stepper"], "motor_control"),
    (["line track", "ir tracker", "obstacle"], "line_tracking"),
    (["pir", "motion", "presence"], "obstacle_detection"),
]


def _extract_capabilities_from_description(description: str) -> list[str]:
    """Deterministic keyword-based capability extraction (no LLM needed)."""
    desc_lower = description.lower()
    found: list[str] = []
    for keywords, capability in _KEYWORD_CAPABILITIES:
        if any(kw in desc_lower for kw in keywords):
            if capability not in found:
                found.append(capability)
    return found


def _detect_component_mentions(description: str, ctx: "RunContext") -> list[str]:
    """Detect explicit component names/aliases in description for user_constraints.

    This allows ComponentResolutionStage._find_preferred() to select
    the exact component the user mentioned.
    """
    registry = getattr(ctx, "component_registry", None)
    if not registry:
        return []
    desc_lower = description.lower()
    mentions: list[str] = []
    for alias, comp_id in registry._by_alias.items():
        if alias in desc_lower:
            comp = registry.get(comp_id)
            if comp and comp.display_name not in mentions:
                mentions.append(comp.display_name)
    return mentions


class RequirementParseStage:
    """Parses user project description into a structured DesignSpec.

    In production, uses LLM structured output.
    The LLM must output DesignSpec schema — capability needs only.
    """

    @property
    def name(self) -> str:
        return "requirement_parse"

    @property
    def version(self) -> str:
        return "1"

    def execute(self, ctx: RunContext) -> StageResult:
        description = ctx.input_snapshot.get("description", "")
        platform = ctx.input_snapshot.get("target_platform", "arduino_uno")
        experience = ctx.input_snapshot.get("experience_level", "beginner")

        if not description or len(description.strip()) < 5:
            # Too vague — trigger clarification
            return StageResult(
                status=StageStatus.WAITING_FOR_USER,
                outputs={
                    "clarification": ArtifactPayload(
                        artifact_type="design_spec",
                        content_json={
                            "clarification": {
                                "required": True,
                                "questions": [
                                    "Please describe what you want your project to do.",
                                    "What sensors or outputs do you need?",
                                ],
                            }
                        },
                        content_hash="clarification",
                    )
                },
            )

        # In production: call LLM with structured output -> DesignSpec
        # For now: use LLM provider if available, else create minimal spec
        if ctx.llm_provider:
            spec = self._parse_with_llm(ctx, description, platform, experience)
        else:
            # Deterministic fallback: keyword-based capability extraction
            from mcu_worker.domain.models.design_spec import CapabilityRequirement
            caps = _extract_capabilities_from_description(description)
            # Detect explicit component mentions for user_constraints
            constraints = _detect_component_mentions(description, ctx)
            spec = DesignSpec(
                title=description[:50],
                description=description,
                target_platform=platform,
                experience_level=experience,
                capabilities=[
                    CapabilityRequirement(capability=c) for c in caps
                ],
                user_constraints=constraints,
            )

        return StageResult(
            status=StageStatus.SUCCEEDED,
            outputs={
                "design_spec": ArtifactPayload(
                    artifact_type="design_spec",
                    schema_version="2.0",
                    content_json=spec.model_dump(),
                    content_hash=f"spec_{ctx.run_id}",
                )
            },
        )

    def _parse_with_llm(
        self, ctx: RunContext, description: str, platform: str, experience: str
    ) -> DesignSpec:
        """Call LLM to parse description into DesignSpec.

        The LLM is instructed to output capability needs only,
        never specific component model numbers.
        """
        # This will be fully implemented when LLM adapter is wired
        # For now, delegate to provider's structured output
        result = ctx.llm_provider.generate_structured(
            schema=DesignSpec.model_json_schema(),
            prompt=(
                f"Parse this MCU project description into capability requirements. "
                f"Do NOT select specific component models. "
                f"Target platform: {platform}. "
                f"Description: {description}"
            ),
        )
        return DesignSpec.model_validate(result.data)
