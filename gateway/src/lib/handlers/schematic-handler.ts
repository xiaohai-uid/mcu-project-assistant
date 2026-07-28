import { db } from "../database";
import { StageHandler } from "../stage-handler";
import type { SchematicOutput } from "../stage-types";

interface PinMapping {
  componentName: string;
  microcontrollerPin: string;
  connectionType: string;
}

/**
 * Cross-validate that schematic pinTable matches codegen pinMappings.
 * Returns an array of warning strings (empty = consistent).
 */
function validateConsistency(
  codegenPins: PinMapping[],
  schematicPins: PinMapping[]
): string[] {
  const warnings: string[] = [];

  if (!codegenPins.length && !schematicPins.length) return warnings;

  // Build lookup from schematic pins
  const schematicMap = new Map<string, string>();
  for (const p of schematicPins) {
    schematicMap.set(p.componentName, p.microcontrollerPin);
  }

  // Check every codegen pin appears in schematic with same assignment
  for (const cp of codegenPins) {
    const sp = schematicMap.get(cp.componentName);
    if (!sp) {
      warnings.push(
        `Component "${cp.componentName}" has pin ${cp.microcontrollerPin} in code but is missing from schematic`
      );
    } else if (sp !== cp.microcontrollerPin) {
      warnings.push(
        `Pin mismatch for "${cp.componentName}": code=${cp.microcontrollerPin}, schematic=${sp}`
      );
    }
  }

  return warnings;
}

export class SchematicHandler extends StageHandler<SchematicOutput> {
  constructor() {
    super("schematic", "Schematic generation failed", null);
  }

  protected async doUpdate(content: SchematicOutput, query: typeof db.query): Promise<void> {
    if (content.error) {
      await query(
        `UPDATE design_drafts SET status = $1, error_message = $2, failure_reason = $3, last_processed_stage = 'schematic', updated_at = NOW() WHERE id = $4`,
        ["failed", content.error, content.error, content.designDraftId]
      );
    } else {
      // Fetch codegen pin_mappings for consistency check
      const prev = await db.query(
        `SELECT pin_mappings FROM design_drafts WHERE id = $1`,
        [content.designDraftId]
      );
      const codegenPins: PinMapping[] = prev?.rows?.[0]?.pin_mappings
        ? (typeof prev.rows[0].pin_mappings === "string"
            ? JSON.parse(prev.rows[0].pin_mappings)
            : prev.rows[0].pin_mappings)
        : [];
      const schematicPins: PinMapping[] = (content.pinTable as PinMapping[]) || [];

      const warnings = validateConsistency(codegenPins, schematicPins);

      await query(
        `UPDATE design_drafts SET status = $1, svg_content = $2, pin_table = $3, validation_warnings = $4, last_processed_stage = 'schematic', updated_at = NOW() WHERE id = $5`,
        ["ready", content.svgContent, JSON.stringify(content.pinTable), JSON.stringify(warnings), content.designDraftId]
      );
    }
  }

  protected async doSelect(): Promise<Record<string, unknown> | undefined> {
    return undefined;
  }

  protected buildNextPayload(): unknown {
    return null;
  }
}
