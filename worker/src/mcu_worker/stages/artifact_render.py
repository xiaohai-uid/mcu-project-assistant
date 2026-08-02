"""ArtifactRender Stage: produces SVG wiring diagram and BOM from CircuitIR.

SVG and Checklist are Views derived from CircuitIR (not the other way).
"""

from __future__ import annotations

from mcu_worker.domain.models.circuit_ir import CircuitIR
from mcu_worker.domain.models.stage import ArtifactPayload, StageResult, StageStatus
from mcu_worker.runtime.context import RunContext


class ArtifactRenderStage:
    """Renders final user-facing artifacts from CircuitIR."""

    @property
    def name(self) -> str:
        return "artifact_render"

    @property
    def version(self) -> str:
        return "1"

    def execute(self, ctx: RunContext) -> StageResult:
        ir_artifact = ctx.get_artifact("circuit_ir")
        if not ir_artifact or not ir_artifact.content_json:
            return StageResult(status=StageStatus.FAILED, error_code="MISSING_CIRCUIT_IR")

        circuit = CircuitIR.model_validate(ir_artifact.content_json)

        # Generate SVG wiring diagram
        svg_content = self._render_svg(circuit)

        # Generate BOM
        bom_content = self._render_bom(circuit)

        # Generate wiring checklist
        checklist_content = self._render_checklist(circuit)

        return StageResult(
            status=StageStatus.SUCCEEDED,
            outputs={
                "wiring_svg": ArtifactPayload(
                    artifact_type="wiring_svg",
                    content_text=svg_content,
                    content_hash=f"svg_{ctx.run_id}",
                ),
                "bom": ArtifactPayload(
                    artifact_type="bom",
                    content_text=bom_content,
                    content_hash=f"bom_{ctx.run_id}",
                ),
                "wiring_checklist": ArtifactPayload(
                    artifact_type="wiring_checklist",
                    content_text=checklist_content,
                    content_hash=f"checklist_{ctx.run_id}",
                ),
            },
        )

    def _render_svg(self, circuit: CircuitIR) -> str:
        """Render a simple SVG wiring diagram from CircuitIR."""
        width = 800
        height = 400 + len(circuit.components) * 60

        lines = [
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
            f'  <rect width="{width}" height="{height}" fill="#f8f9fa"/>',
            f'  <text x="20" y="30" font-size="16" font-weight="bold">'
            f'Wiring Diagram - {circuit.platform_id}</text>',
        ]

        # Draw MCU box
        lines.append('  <rect x="350" y="60" width="100" height="200" '
                     'fill="#2196F3" rx="5"/>')
        lines.append('  <text x="370" y="160" fill="white" font-size="12">'
                     'Arduino UNO</text>')

        # Draw components
        y_offset = 300
        for i, comp in enumerate(circuit.components):
            x = 100 + (i % 4) * 180
            y = y_offset + (i // 4) * 80
            lines.append(f'  <rect x="{x}" y="{y}" width="140" height="50" '
                         f'fill="#4CAF50" rx="3"/>')
            lines.append(f'  <text x="{x+10}" y="{y+30}" fill="white" '
                         f'font-size="11">{comp.component_id}</text>')

        lines.append('</svg>')
        return "\n".join(lines)

    def _render_bom(self, circuit: CircuitIR) -> str:
        """Render a Bill of Materials table."""
        lines = ["# Bill of Materials", ""]
        lines.append("| # | Component ID | Instance | Qty |")
        lines.append("|---|---|---|---|")
        for i, comp in enumerate(circuit.components, 1):
            lines.append(
                f"| {i} | {comp.component_id} | {comp.instance_id} | {comp.quantity} |"
            )
        return "\n".join(lines)

    def _render_checklist(self, circuit: CircuitIR) -> str:
        """Render a wiring checklist from pin allocations."""
        lines = ["# Wiring Checklist", ""]
        for pa in circuit.pin_allocations:
            lines.append(
                f"- [ ] Connect {pa.instance_id} ({pa.signal}) "
                f"to pin {pa.physical_pin} [{pa.interface}]"
            )
        for bus in circuit.nets:
            if bus.signal_type in ("i2c", "spi"):
                for ep in bus.endpoints:
                    lines.append(
                        f"- [ ] Bus {bus.signal_type}: {ep.instance_id} "
                        f"-> {ep.physical_pin}"
                    )
        return "\n".join(lines)
