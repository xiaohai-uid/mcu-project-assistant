"""RequirementParse Stage: parses user description into DesignSpec.

V2 key change: outputs capability needs, NOT hardware model answers.
"""

from __future__ import annotations

from mcu_worker.domain.models.design_spec import DesignSpec
from mcu_worker.domain.models.stage import ArtifactPayload, StageResult, StageStatus
from mcu_worker.runtime.context import RunContext


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
            # Deterministic fallback for testing without LLM
            spec = DesignSpec(
                title=description[:50],
                description=description,
                target_platform=platform,
                experience_level=experience,
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
