# Circuit-Level Simulation Evidence — Greenhouse Interfaces (2026-08-22)

Companion to `simulation-evidence-2026-08-22.md` (Wokwi functional sim). That run
validated firmware behavior on the virtual MCU; this analysis validates the
**analog/power interfaces** Wokwi models as ideal, at circuit level (SPICE-grade
first-order analyses, exact closed forms; component values from standard parts
matching the workspace peripheral IDs — assumptions listed per case).

Tooling note: NI Multisim 14.3 is installed locally but its MCU co-sim covers only
8051/PIC — it cannot execute ESP32 firmware (that layer stays with Wokwi). The
`.cir` netlists under `work/circuit-sim/multisim-netlists/` open directly in
Multisim (File ▸ Open) for interactive re-verification of every number below.

## CASE 1 — Capacitive soil sensor → GPIO4 ADC

Model: sensor v1.2 output span 1.36 V(air)…3.05 V(water), R_out = 10 kΩ,
pin capacitance ≈ 32 pF.

| Check | Result |
| --- | --- |
| Source impedance vs ESP32 ≤10 kΩ recommendation | **PASS, exactly at limit** |
| Pin voltage range 0–3.3 V across full moisture span | PASS (1688…3785 counts) |
| Firmware threshold 1800 counts (= 1.45 V) inside sensor span | **PASS but margin is only ~90 mV above the dry-end output (1.36 V)** |

⚠ Finding: the dry/wet decision threshold sits within 90 mV of the sensor's
air-calibrated output. Unit-to-unit offset and temperature drift of the v1.2
sensor easily exceed that. Recommend either raising `SOIL_DRY_THRESHOLD`
counts in firmware config or adding a one-point calibration step; otherwise
pump behavior may differ between units (never-on / always-on).

## CASE 2 — GPIO21 → SRD-05VDC-SL-C relay driver (low-side NPN S8050)

Coil 5 V / 71 mA (~70 Ω, L ≈ 30 mH).

| Check | Result |
| --- | --- |
| Base drive @Rb=1 kΩ | Ib=2.5 mA, forced-β≈28 → **saturation not guaranteed over β/temp spread** |
| Base drive @Rb=470 Ω | Ib=5.3 mA, forced-β≈13 → solid saturation, GPIO load still ≪20 mA |
| Turn-off without flyback diode | theoretical −L·di/dt spike ≈ kV-class → transistor destroyed; **1N4148 across coil mandatory** |
| With flyback diode | collector clamps at ≈5.7 V < S8050 V_CEO; current decays τ=L/R≈0.4 ms, no sustained arc |

⚠ Finding: if the relay module was built with Rb ≥ 2.2 kΩ the transistor may
run in linear region when hot/low-β — coil undervoltage and driver heating.
Verify module uses Rb ≤ 1 kΩ (prefer 470–680 Ω), and that a flyback diode is
physically present before first pump test.

## CASE 3 — I2C bus rise time (SSD1306 @ IO8/IO9)

Cbus ≈ 200 pF (module + wiring). Rise time t_r(30–70 %) = 0.847·Rp·Cbus;
I2C Fast-mode spec t_r ≤ 300 ns; Standard-mode ≤ 1000 ns. Firmware uses
`Wire.begin()` default clock = 100 kHz (Standard mode).

| Rp | t_r | Std-mode (≤1 µs) | Fast-mode (≤300 ns) |
| --- | --- | --- | --- |
| 10 kΩ | 1694 ns | **VIOLATION** | VIOLATION |
| 4.7 kΩ | 796 ns | PASS | VIOLATION |
| 2.2 kΩ | 373 ns | PASS | VIOLATION |
| 1.0 kΩ | 169 ns | PASS | PASS |

Rp_min from 3 mA sink limit ≈ 967 Ω.

⚠ Finding: with 10 kΩ module pull-ups and ~200 pF bus even Standard mode is
violated — expect intermittent NACK/garbled OLED at long cables. Keep total
pull-up ≤ 4.7 kΩ for 100 kHz operation; for 400 kHz fit external 2.2 kΩ in
parallel (effective ≈1.5 kΩ, t_r≈254 ns).

## Summary of actionable items before physical acceptance

1. Firmware/config: revisit `SOIL_DRY_THRESHOLD=1800` against real sensor calibration (CASE 1).
2. Hardware check: relay module base resistor ≤1 kΩ and flyback diode present (CASE 2).
3. Hardware check: I2C pull-up total ≤4.7 kΩ; add parallel resistor if 10k-only module (CASE 3).

These are pre-wiring checks meant to protect the physical board — they cost
nothing now and each corresponds to a classic way to damage hardware or burn
debug hours.
