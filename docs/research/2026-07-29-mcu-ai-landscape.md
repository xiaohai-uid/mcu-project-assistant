# MCU/embedded AI landscape and baseline audit

Date: 2026-07-29

Scope: primary sources only: vendor documentation, official project documentation, official repositories, and release pages.

## What the project is trying to do

MCU Project Assistant promises to turn a natural-language hardware idea into a downloadable design package through a `Requirement -> Recommendation -> WebSearch -> Codegen -> Schematic` pipeline. The intended output is more ambitious than a coding chatbot: component selection, pricing, firmware, pin assignment, wiring, and export for Arduino, ESP32, and STM32.

The current implementation is a convincing UI/demo shell, but its acceptance checks measure internal consistency rather than real hardware usability.

## Current ecosystem signals

### AI coding is already table stakes

Arduino launched its Cloud AI Assistant on 2025-04-17. Arduino says the assistant has project and board context, generates sketches, fixes code, explains functions, and lets users upload generated code from the Cloud Editor. Arduino also says it is grounded in Arduino documentation, libraries, and examples. A standalone product whose main differentiator is “prompt to sketch” is therefore behind the official platform experience. Source: [Arduino announcement](https://blog.arduino.cc/2025/04/17/code-faster-with-the-new-arduino-ai-assistant/).

### Agent-operated simulation is now practical

Wokwi documents an experimental MCP server in its CLI that lets AI agents simulate embedded systems, run automated tests, monitor serial output, and interact with virtual hardware. Source: [Wokwi MCP support](https://docs.wokwi.com/wokwi-ci/mcp-support).

Wokwi automation scenarios can drive buttons and sensors, assert pin values, wait for serial output, compare screenshots, and run in CI. The documentation shows PlatformIO compilation followed by `wokwi-cli` scenario execution and notes that the scenario API is still alpha. Source: [Wokwi automation scenarios](https://docs.wokwi.com/wokwi-ci/automation-scenarios).

This creates a defensible opportunity: generate not only firmware and a diagram, but also a runnable simulation plus machine-verifiable acceptance scenario.

### Real EDA artifacts can be checked automatically

KiCad 10 exposes `kicad-cli` commands for schematic ERC, PCB DRC, BOM and netlist export, SVG/PDF rendering, and jobsets. Its current 10.0 documentation says it is based on KiCad 10.0.5. Source: [KiCad 10 CLI reference](https://docs.kicad.org/10.0/en/cli/cli.html).

KiCad announced the 10.0.1 bug-fix release on 2026-04-15. Source: [KiCad 10.0.1 release](https://www.kicad.org/blog/2026/04/KiCad-10.0.1-Release/).

The project’s current SVG is therefore the wrong source of truth. It should generate a real KiCad schematic, run ERC, and derive preview SVG/BOM/netlist from that checked artifact.

### Relevant toolchains are actively maintained

Official latest-release checks performed on 2026-07-29:

| Tool | Verified release | Published | Source |
| --- | --- | --- | --- |
| Arduino CLI | v1.5.1 | 2026-06-05 | [release](https://github.com/arduino/arduino-cli/releases/tag/v1.5.1) |
| ESP-IDF | v6.0.2 | 2026-06-29 | [release](https://github.com/espressif/esp-idf/releases/tag/v6.0.2) |
| Zephyr | v4.4.1 | 2026-06-10 | [release](https://github.com/zephyrproject-rtos/zephyr/releases/tag/v4.4.1) |
| PlatformIO Core | v6.1.19 | 2026-02-04 | [release](https://github.com/platformio/platformio-core/releases/tag/v6.1.19) |
| Wokwi CLI | v0.26.1 | 2026-02-23 | [release](https://github.com/wokwi/wokwi-cli/releases/tag/v0.26.1) |
| Renode | v1.16.1 | 2026-02-16 | [release](https://github.com/renode/renode/releases/tag/v1.16.1) |

These provide executable validation surfaces. Support should be defined by a pinned toolchain profile and a passing compile/simulation contract, not by a string enum alone.

## Measured baseline

All measurements used the GitHub `main` snapshot at `38f8c930b492ce3592f04dec7fd051365d21e2e7`.

| Check | Result | Time | What it proves |
| --- | --- | ---: | --- |
| `npm ci` | success; 196 packages | 14.4 s | dependencies install |
| `npm test` | 16 files, 254 tests passed | 2.34 s | gateway unit tests pass |
| `npm run lint` | exit 0; 33 warnings | 2.71 s | no lint errors, but not warning-free |
| `npm run build` | exit 0; Edge-runtime warnings | 15.85 s | production bundle builds, but not warning-free |
| CI-targeted pytest | 69 passed | 0.40 s | the exact Python selection in CI passes |
| Full pytest | 77 passed, 3 failed, 8 warnings | 19.52 s | test isolation is broken when all tests run together |
| Websearch tests alone | 11 passed, 8 warnings | 24.72 s | isolated suite passes |
| Live websearch test | 3 passed; DigiKey returned HTTP 403 and 0 results | 10.94 s | tests tolerate an empty blocked supplier result |
| Trial pipeline | exit 0, “Valid: YES” | 0.25 s | deterministic demo pipeline completes |

`npm ci` also reported four known dependency vulnerabilities: one moderate and three high. The public CI workflow does not run lint or `next build`, despite the deployment documentation claiming those gates. It also excludes requirement-service, recommendation-service, and websearch tests.

## False-positive trial result

Input: “智能浇花系统，土壤湿度低于 28% 时自动浇水，并在 OLED 显示温湿度”.

The trial reported success, but inspection found:

- OLED was replaced with LCD1602.
- The requested 28% threshold became raw ADC threshold 400 without calibration or conversion.
- The water pump received a direct Arduino signal pin even though a pump requires a driver/relay and separate power design.
- The code declares both relay and pump pins but only drives the relay.
- The “schematic” is a 257-byte placeholder SVG containing only a title.
- Validation still returned “all pins consistent” and “code structure valid” because it compares generated strings and checks for `setup()`/`loop()`; it never compiles or simulates.

## Product opportunity

The strongest credible positioning is not “AI generates an MCU project.” It is:

> An evidence-first embedded design agent that produces a reproducible, downloadable project bundle and proves what it can: board-specific firmware compiles, simulated behavior passes scenarios, the electrical schematic passes ERC, components have dated source evidence, and every unsupported assumption is visible.

## Recommended measurable outcomes

1. **Requirement fidelity:** exact requested devices, constraints, and thresholds preserved or explicitly clarified; score on a versioned golden set.
2. **Firmware compile rate:** clean builds for pinned board/toolchain/library matrices; report binary size and warnings.
3. **Simulation pass rate:** generated Wokwi/Renode scenarios exercise stated behavior and assert pins/serial/output.
4. **Electrical validity:** generated KiCad schematic parses and passes ERC with zero unwaived errors; power/current constraints are modeled.
5. **Evidence coverage:** every recommended component has manufacturer part number, datasheet, voltage/current/interface facts, source URL, retrieval timestamp, region/currency, and confidence.
6. **Reproducibility:** exported bundle contains manifests, lockfiles, tool versions, commands, logs, and machine-readable validation report.
7. **Honesty:** unsupported boards/components or unverified claims block “ready” status rather than silently falling back.

## Capabilities to avoid

- More pricing pages before currency, stock, source provenance, and supplier access are trustworthy.
- More platforms represented only as labels while the pin allocator remains Arduino-specific.
- A prettier SVG that is not backed by a real EDA netlist/ERC result.
- “AI success” based on self-consistency between outputs generated from the same faulty function.
- Green tests whose assertions allow empty live data or only check that a function did not crash.
