# Circuit-Level Simulation Evidence — Greenhouse Interfaces (2026-08-22)

Companion to `simulation-evidence-2026-08-22.md` (Wokwi functional sim). That run
validated firmware behavior on the virtual MCU; this analysis validates the
**analog/power interfaces** Wokwi models as ideal, at circuit level (SPICE-grade
first-order analyses, exact closed forms; component values from standard parts
matching the workspace peripheral IDs — assumptions listed per case).

Tooling note: NI Multisim 14.3 is installed locally but its MCU co-sim covers only
8051/PIC — it cannot execute ESP32 firmware (that layer stays with Wokwi). The
`.cir` netlists under `docs/audit/netlists/` open directly in
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

## SPICE cross-check (ngspice-47, same decks) — drift review

All three netlists were executed in ngspice-47 (batch, `.MEAS`) to verify the
closed-form values above. Results and corrections:

| Quantity | Analytical | ngspice | Drift |
| --- | --- | --- | --- |
| CASE1 ADC settle (<1 LSB after step @1.01 ms) | ≈3457 ns incl. ramp | **3452 ns** | <0.15 % |
| CASE3 t_r @Rp=4.7 k/200 pF | 796 ns | **796 ns** | 0 % |
| CASE3 t_r @2.2 k / 1 k | 373 / 169 ns | **373 / 169 ns** | 0 % |
| CASE3 t_r @10 k | 1694 ns | **1695 ns** | +0.06 % |
| CASE2 flyback clamp peak | ~5.7 V | **5.83 V** | +0.13 V (diode dynamics) |
| CASE2 collector spike w/o diode | "kV-class theoretical" | **272 V** (model-limited) | ≫ S8050 V_CEO 25 V → fatal either way |

### Correction to CASE 2 (self-review finding)

The original table called Rb=1 kΩ "saturation not guaranteed" from the
forced-β ≤ 20 rule of thumb. The SPICE sweep over β shows that was **over-
pessimistic**: worst-case BF=40 still saturates at Rb=1 kΩ (V_CE=141 mV). The
actual boundary sits near Rb≈1.4 kΩ for β_min=40:

| Rb \ hFE | 150 (typical) | 40 (worst-case) |
| --- | --- | --- |
| 470 Ω | 89 mV deep-sat | 89 mV deep-sat |
| 1 kΩ | 100 mV deep-sat | 141 mV deep-sat |
| 2.2 kΩ | 130 mV deep-sat | **2093 mV — linear region, driver heating** |
| 4.7 kΩ | 360 mV marginal | saturated-off territory |

Actionable rule stands corrected to: **Rb ≤ 1 kΩ guarantees saturation across
the transistor spread; 2.2 kΩ is acceptable only if the module's transistor β
is verified >60.**

### Tooling notes (for reproducibility)

- ngspice consumes the first deck line as title — a deck starting directly
  with an element line silently loses that element (this produced a bogus
  "no supply" run during bring-up).
- `.MEAS ... FROM/TO` with `M` suffixes parsed unreliably in this build;
  decimal seconds used throughout.
- A coil R∥L topology error in the first delivered netlist was caught by this
  cross-check loop and fixed (`case2_relay_driver.cir`: R and L now in series).

## Summary of actionable items before physical acceptance

1. Firmware/config: revisit `SOIL_DRY_THRESHOLD=1800` against real sensor calibration (CASE 1).
2. Hardware check: relay module base resistor ≤1 kΩ and flyback diode present (CASE 2).
3. Hardware check: I2C pull-up total ≤4.7 kΩ; add parallel resistor if 10k-only module (CASE 3).

These are pre-wiring checks meant to protect the physical board — they cost
nothing now and each corresponds to a classic way to damage hardware or burn
debug hours.
