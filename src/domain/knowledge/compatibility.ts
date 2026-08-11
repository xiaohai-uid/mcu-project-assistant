// domain/knowledge/compatibility.ts — V2 shared/domain/compatibility.py TS 移植（ISSUE-005 §3/§11）
// 纯函数；测试 1:1 搬运（tests/unit/domain/knowledge/compatibility.test.ts）。

export interface CompatibleComponent {
  name: string;
  price?: number;
  voltage?: number;
  compatible_platforms?: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  reasons: string[];
}

export function checkCompatibility(component: CompatibleComponent, platform: string): CompatibilityResult {
  const platforms = (component.compatible_platforms ?? "").toLowerCase();
  const compatible = platforms.includes(platform.toLowerCase());
  const reasons: string[] = [];
  if (!compatible) {
    reasons.push(`Component '${component.name}' not compatible with ${platform}`);
  }
  return { compatible, reasons };
}

export function allocateTiers(
  components: CompatibleComponent[],
  platform: string | null = null,
): { budget: CompatibleComponent[]; standard: CompatibleComponent[]; premium: CompatibleComponent[] } {
  const tiers: { budget: CompatibleComponent[]; standard: CompatibleComponent[]; premium: CompatibleComponent[] } = {
    budget: [],
    standard: [],
    premium: [],
  };
  for (const c of components) {
    if (platform !== null) {
      const compat = checkCompatibility(c, platform);
      if (!compat.compatible) continue;
    }
    const price = c.price ?? 0;
    if (price < 3) tiers.budget.push(c);
    else if (price < 15) tiers.standard.push(c);
    else tiers.premium.push(c);
  }
  return tiers;
}

export interface Conflict {
  type: string;
  severity: string;
  message: string;
}

export function detectConflicts(components: CompatibleComponent[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      const a = components[i]!;
      const b = components[j]!;
      const va = a.voltage;
      const vb = b.voltage;
      if (va !== undefined && vb !== undefined && Math.abs(va - vb) > 1.0) {
        conflicts.push({
          type: "voltage_mismatch",
          severity: "warning",
          message: `${a.name} (${va}V) and ${b.name} (${vb}V) voltage mismatch`,
        });
      }
    }
  }
  return conflicts;
}
