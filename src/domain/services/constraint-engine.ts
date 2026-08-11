// domain/services/constraint-engine.ts — V2 worker/.../constraints/engine.py TS 移植（ISSUE-005 §3/§11）
// 约束引擎：电压兼容 / 引脚预算 / 总线冲突 / 保留引脚保护 / 确定性引脚分配。
// 测试 1:1 搬运（tests/unit/domain/services/constraint-engine.test.ts）为移植验收门。
// 扩展（Golden Journey）：strapping 引脚检查（ESP32-S3 IO12 冲突场景）。
import type { ComponentDefinition } from "@/src/domain/knowledge/components";
import type { PlatformDefinition } from "@/src/domain/knowledge/platforms";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  details: Record<string, unknown>;
}

export interface PinAssignment {
  instanceId: string;
  signal: string;
  physicalPin: string;
  interface: string;
}

export interface SharedBus {
  type: string;
  pins: Record<string, string>;
  participants: string[];
}

export interface PinAllocation {
  platformId: string;
  assignments: PinAssignment[];
  sharedBuses: SharedBus[];
  diagnostics: Diagnostic[];
}

export interface ConstraintResult {
  isFeasible: boolean;
  diagnostics: Diagnostic[];
  pinAllocation: PinAllocation | null;
  get errors(): Diagnostic[];
  get warnings(): Diagnostic[];
}

export class ConstraintEngine {
  private diagnostics: Diagnostic[] = [];

  constructor(
    private readonly platform: PlatformDefinition,
    private readonly components: Array<[string, ComponentDefinition]>,
  ) {}

  validate(): ConstraintResult {
    this.diagnostics = [];
    this.checkVoltage();
    this.checkPinBudget();
    this.checkBusConflicts();
    this.checkStrapping();

    const isFeasible = !this.diagnostics.some((d) => d.severity === "error");
    const allocation = isFeasible ? this.allocatePins() : null;

    const result: ConstraintResult = {
      isFeasible,
      diagnostics: this.diagnostics,
      pinAllocation: allocation,
      get errors() {
        return this.diagnostics.filter((d) => d.severity === "error");
      },
      get warnings() {
        return this.diagnostics.filter((d) => d.severity === "warning");
      },
    };
    return result;
  }

  private checkVoltage(): void {
    const platformVoltage = this.platform.logicVoltage;
    for (const [instanceId, comp] of this.components) {
      const maxSupply = comp.electrical.supplyVoltageMax;
      const minSupply = comp.electrical.supplyVoltageMin;
      const busOnly = comp.interfaces.every((iface) => iface.type === "i2c" || iface.type === "spi");

      if (platformVoltage > maxSupply + 0.5) {
        const severity: DiagnosticSeverity = busOnly ? "warning" : "error";
        this.diagnostics.push({
          code: "VOLTAGE_INCOMPATIBLE",
          severity,
          message:
            `${comp.displayName} (${instanceId}) max supply ${maxSupply}V ` +
            `is below platform logic ${platformVoltage}V` +
            (busOnly ? " (bus device: use 3V3 pin or level shifter)" : ""),
          details: { instance_id: instanceId, component_id: comp.id },
        });
      } else if (platformVoltage < minSupply) {
        // 显式声明 supported 的平台（如晶体管驱动的 5V 继电器接 3.3V MCU，外部供电）→ warning；
        // 否则保守 error（platform_compatibility 是工程显式声明，电压启发式是回退）
        const declaredSupported = comp.platformCompatibility[this.platform.id] === "supported";
        this.diagnostics.push({
          code: "VOLTAGE_TOO_LOW",
          severity: declaredSupported ? "warning" : "error",
          message:
            `${comp.displayName} (${instanceId}) requires min ${minSupply}V ` +
            `but platform provides ${platformVoltage}V` +
            (declaredSupported ? " (declared supported; verify external power)" : ""),
          details: { instance_id: instanceId, component_id: comp.id },
        });
      }
    }
  }

  private checkPinBudget(): void {
    const availDigital = this.platform.pins.digital.filter(
      (p) => !this.platform.reservedPins.some((rp) => rp.pin === p),
    );
    const availAnalog = this.platform.pins.analog.filter(
      (p) => !this.platform.reservedPins.some((rp) => rp.pin === p),
    );
    const availPwm = this.platform.pins.pwm.filter(
      (p) => !this.platform.reservedPins.some((rp) => rp.pin === p),
    );

    let digitalNeeded = 0;
    let analogNeeded = 0;
    let pwmNeeded = 0;

    for (const [, comp] of this.components) {
      for (const iface of comp.interfaces) {
        if (iface.type === "analog") analogNeeded += iface.signalCount;
        else if (iface.type === "pwm") pwmNeeded += iface.signalCount;
        else if (iface.type === "digital") digitalNeeded += iface.signalCount;
      }
    }

    if (analogNeeded > availAnalog.length) {
      this.diagnostics.push({
        code: "ANALOG_PIN_OVERFLOW",
        severity: "error",
        message: `Need ${analogNeeded} analog pins but only ${availAnalog.length} available`,
        details: { needed: analogNeeded, available: availAnalog.length },
      });
    }
    if (pwmNeeded > availPwm.length) {
      this.diagnostics.push({
        code: "PWM_PIN_SHORTAGE",
        severity: "error",
        message: `Need ${pwmNeeded} PWM pins but only ${availPwm.length} available`,
        details: { needed: pwmNeeded, available: availPwm.length },
      });
    }
    if (digitalNeeded > availDigital.length) {
      this.diagnostics.push({
        code: "DIGITAL_PIN_OVERFLOW",
        severity: "error",
        message: `Need ${digitalNeeded} digital pins but only ${availDigital.length} available`,
        details: { needed: digitalNeeded, available: availDigital.length },
      });
    }
  }

  private checkBusConflicts(): void {
    const uartUsers: string[] = [];
    for (const [instanceId, comp] of this.components) {
      for (const iface of comp.interfaces) {
        if (iface.type === "uart") uartUsers.push(instanceId);
      }
    }
    if (uartUsers.length > 1) {
      this.diagnostics.push({
        code: "UART_CONFLICT",
        severity: "error",
        message: `Multiple UART devices (${uartUsers.join(", ")}) but platform has only one hardware UART`,
        details: { devices: uartUsers },
      });
    }
  }

  /** Golden Journey 扩展：strapping 引脚占用检查（ESP32-S3 IO12 等；上电引导/电压配置风险） */
  private checkStrapping(): void {
    const allocation = this.allocatePinsPreview();
    for (const a of allocation.assignments) {
      const strapping = this.platform.strappingPins?.find((s) => s.pin === a.physicalPin);
      if (strapping) {
        this.diagnostics.push({
          code: "STRAPPING_PIN_USAGE",
          severity: "warning",
          message: `${a.physicalPin} is an ${this.platform.id} strapping pin: ${strapping.reason}.`,
          details: { pin: a.physicalPin, instance_id: a.instanceId, reason: strapping.reason },
        });
      }
    }
  }

  /** 只做分配预览（不重复跑完整 validate，避免递归）；供 strapping 检查使用 */
  private allocatePinsPreview(): PinAllocation {
    return this.doAllocate();
  }

  private allocatePins(): PinAllocation {
    return this.doAllocate();
  }

  private doAllocate(): PinAllocation {
    const assignments: PinAssignment[] = [];
    const sharedBuses: SharedBus[] = [];

    const usedDigital = new Set<string>();
    const usedAnalog = new Set<string>();
    const usedPwm = new Set<string>();

    const availableDigital = this.platform.pins.digital.filter(
      (p) => !this.platform.reservedPins.some((rp) => rp.pin === p),
    );
    const availableAnalog = this.platform.pins.analog.filter(
      (p) => !this.platform.reservedPins.some((rp) => rp.pin === p),
    );
    const availablePwm = this.platform.pins.pwm.filter(
      (p) => !this.platform.reservedPins.some((rp) => rp.pin === p),
    );

    const analogPool = [...availableAnalog];
    const pwmSet = new Set(this.platform.pins.pwm);
    const digitalNonPwm = [...availableDigital.filter((p) => !pwmSet.has(p))];
    const digitalPwm = [...availableDigital.filter((p) => pwmSet.has(p))];
    const pwmPool = [...availablePwm];

    const i2cParticipants: string[] = [];
    const spiParticipants: string[] = [];

    for (const [instanceId, comp] of this.components) {
      for (const iface of comp.interfaces) {
        if (iface.type === "analog") {
          for (let i = 0; i < iface.signalCount; i++) {
            const pin = analogPool.shift() ?? "N/A";
            usedAnalog.add(pin);
            assignments.push({
              instanceId,
              signal: iface.signalCount > 1 ? `analog_${i}` : "signal",
              physicalPin: pin,
              interface: "analog",
            });
          }
        } else if (iface.type === "digital") {
          for (let i = 0; i < iface.signalCount; i++) {
            const pin = digitalNonPwm.length ? digitalNonPwm.shift()! : digitalPwm.length ? digitalPwm.shift()! : "N/A";
            usedDigital.add(pin);
            assignments.push({
              instanceId,
              signal: iface.signalCount > 1 ? `digital_${i}` : "signal",
              physicalPin: pin,
              interface: "digital",
            });
          }
        } else if (iface.type === "pwm") {
          for (let i = 0; i < iface.signalCount; i++) {
            const pin = pwmPool.shift() ?? "N/A";
            usedPwm.add(pin);
            assignments.push({
              instanceId,
              signal: iface.signalCount > 1 ? `pwm_${i}` : "signal",
              physicalPin: pin,
              interface: "pwm",
            });
          }
        } else if (iface.type === "i2c") {
          i2cParticipants.push(instanceId);
        } else if (iface.type === "spi") {
          spiParticipants.push(instanceId);
        } else if (iface.type === "uart") {
          const rxPin = digitalNonPwm.length ? digitalNonPwm.shift()! : "D2";
          const txPin = digitalNonPwm.length ? digitalNonPwm.shift()! : "D3";
          assignments.push({ instanceId, signal: "rx", physicalPin: rxPin, interface: "uart" });
          assignments.push({ instanceId, signal: "tx", physicalPin: txPin, interface: "uart" });
        }
      }
    }

    if (i2cParticipants.length) {
      const i2cBus = this.platform.buses["i2c"];
      sharedBuses.push({
        type: "i2c",
        pins: i2cBus?.pins ?? { sda: "A4", scl: "A5" },
        participants: i2cParticipants,
      });
    }
    if (spiParticipants.length) {
      const spiBus = this.platform.buses["spi"];
      sharedBuses.push({
        type: "spi",
        pins: spiBus?.pins ?? { ss: "D10", mosi: "D11", miso: "D12", sck: "D13" },
        participants: spiParticipants,
      });
    }

    return {
      platformId: this.platform.id,
      assignments,
      sharedBuses,
      diagnostics: this.diagnostics,
    };
  }
}
