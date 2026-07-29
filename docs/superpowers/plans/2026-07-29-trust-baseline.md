# Trust Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current repository into an honestly described, reproducible open-source baseline whose local checks and CI report what was actually tested and never present heuristic generation checks as compilation, simulation, ERC, or hardware verification.

**Architecture:** Preserve the existing Pipeline while introducing truthful transitional semantics at its interfaces: structure and pin comparisons are inspections, `ready` means exportable, and verified claims remain false until later verification adapters produce evidence. Deterministic tests run without network access; live supplier smoke tests are isolated; the same test, lint, and build gates run locally and in GitHub Actions.

**Tech Stack:** Python 3.12, pytest 9.1.1, TypeScript 5.9, Next.js 14.2, React 18.3, Vitest 4.1, ESLint 10, GitHub Actions, Docker Compose.

## Global Constraints

- The supported local core must not require Postgres, Redis, RabbitMQ, a hosted account, or paid credentials merely to run its deterministic quality checks.
- `ready` is a legacy Pipeline completion state meaning artifacts are exportable; it is not a verification result.
- Missing tools, credentials, network access, or unsupported targets must never be reported as passed.
- Live network tests must not run in the default pytest suite or pull-request CI.
- Existing user changes in `AGENTS.md`, `.claude/`, `CLAUDE.md`, `gateway/tsconfig.tsbuildinfo`, and `trial-output/` are out of scope and must not be staged.
- Run GitNexus upstream impact analysis before editing an existing symbol and `detect_changes` before every task commit, as required by the repository instructions.
- Every implementation task follows RED → GREEN → COMMIT and stages only the paths listed for that task.

---

## File Map

- `LICENSE` — Apache-2.0 grant for the open-source core.
- `README.md` — public promise, current capability matrix, limitations, local commands, and roadmap.
- `shared/tests/test_repository_contract.py` — executable assertions that public claims remain honest.
- `services/websearch-service/tests/conftest.py` — isolated loader fixture for the hyphenated service directory.
- `services/websearch-service/tests/test_import.py` — import and circuit-breaker tests without process-global module pollution.
- `services/websearch-service/tests/test_real_data.py` — deterministic captured-data tests.
- `services/websearch-service/tests/test_live_crawl.py` — explicitly marked network smoke tests.
- `pytest.ini` — deterministic default suite and registered `live` marker.
- `shared/domain/codegen_helpers.py` — heuristic code-structure inspection with explicit non-verification semantics.
- `services/codegen-service/main.py` — emits the inspection record without a `valid` claim.
- `services/codegen-service/test_codegen.py` — inspection contract tests.
- `gateway/src/lib/stage-types.ts` — typed transitional inspection payload.
- `gateway/src/lib/verification-copy.ts` — one source for user-facing verification disclaimers.
- `gateway/__tests__/verification-copy.test.ts` — copy contract preventing unsupported claims.
- `gateway/src/app/projects/[id]/progress/page.tsx` — generation-complete wording.
- `gateway/src/app/projects/[id]/result/page.tsx` — visible unverified-state banner.
- `trial_run.py` — trial output that distinguishes inspections from verification.
- `services/websearch-service/main.py` — currency-safe aggregation and timezone-aware timestamps.
- `gateway/eslint.config.js` and listed TypeScript files — zero-warning lint baseline without disabling rules.
- `requirements-test.txt` — deterministic Python test dependency entrypoint.
- `.github/workflows/ci.yml` — pull-request quality gates matching local commands.
- `.github/workflows/live-websearch.yml` — scheduled/manual network smoke test isolated from merge gates.
- `docs/verification/2026-07-29-trust-baseline.md` — measured before/after evidence.

---

### Task 1: Publish an Honest Open-source Contract

**Files:**
- Create: `LICENSE`
- Create: `README.md`
- Create: `shared/tests/test_repository_contract.py`

**Interfaces:**
- Consumes: accepted ADR `docs/adr/0002-local-core-hosted-adapters.md` and the verified baseline measurements in the design spec.
- Produces: Apache-2.0 licensing and stable README headings `Current status`, `What is actually verified`, `Local development`, and `Roadmap`.

- [ ] **Step 1: Write the failing repository-contract test**

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_public_contract_is_honest_and_open_source():
    license_text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")

    assert "Apache License" in license_text
    assert "Version 2.0, January 2004" in license_text
    assert "## Current status" in readme
    assert "## What is actually verified" in readme
    assert "generated, not compiled" in readme.lower()
    assert "Arduino UNO" in readme
    assert "Wokwi" in readme and "optional" in readme.lower()
```

- [ ] **Step 2: Run the test and confirm the missing public contract**

Run: `.venv\Scripts\python.exe -m pytest shared/tests/test_repository_contract.py -v`

Expected: FAIL because `LICENSE` and `README.md` do not exist.

- [ ] **Step 3: Add the exact Apache-2.0 license and README claims**

Use the unmodified Apache License 2.0 text from <https://www.apache.org/licenses/LICENSE-2.0.txt>. The README must include this capability table:

```markdown
| Capability | Current status |
| --- | --- |
| Requirement/component/code generation | Available; output must be reviewed |
| Firmware compilation | Not implemented yet |
| KiCad ERC | Not implemented yet |
| Wokwi simulation | Planned optional adapter |
| Physical hardware verification | Planned Reference Kit process |
| Local trial runner | Available; generated, not compiled or simulated |
```

Document these exact local commands:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-test.txt
.\.venv\Scripts\python.exe -m pytest
Set-Location gateway
npm ci
npm test
npm run lint
npm run build
```

State that the existing Docker/RabbitMQ Pipeline is a hosted-style development path, while the complete broker-free local design core is the next architecture milestone. Do not add badges for checks that are not yet running on GitHub.

- [ ] **Step 4: Re-run the contract test**

Run: `.venv\Scripts\python.exe -m pytest shared/tests/test_repository_contract.py -v`

Expected: PASS.

- [ ] **Step 5: Commit the public contract**

```powershell
git add -- LICENSE README.md shared/tests/test_repository_contract.py
git commit -m "docs: publish honest open-source baseline"
```

---

### Task 2: Isolate Deterministic Python Tests from Live Network Tests

**Files:**
- Create: `services/websearch-service/tests/conftest.py`
- Modify: `services/websearch-service/tests/test_import.py`
- Modify: `services/websearch-service/tests/test_real_data.py`
- Modify: `services/websearch-service/tests/test_live_crawl.py`
- Modify: `pytest.ini`

**Interfaces:**
- Consumes: `services/websearch-service/main.py` as a module loaded from a hyphenated directory.
- Produces: pytest fixture `websearch_module`; marker `live`; default `pytest` suite that does not access the network or leak fake `shared` modules.

- [ ] **Step 1: Add a regression test proving `shared` remains a package**

Append to `services/websearch-service/tests/test_import.py`:

```python
def test_websearch_loader_does_not_replace_shared_package(websearch_module):
    from shared.logging_config import get_logger

    assert callable(get_logger)
    assert websearch_module.CircuitBreaker is not None
```

- [ ] **Step 2: Run the full deterministic suite and observe the leaked module failure**

Run: `.venv\Scripts\python.exe -m pytest -m "not live" -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'shared.logging_config'; 'shared' is not a package`.

- [ ] **Step 3: Create an isolated loader fixture**

Create `services/websearch-service/tests/conftest.py` with this fixture shape:

```python
import importlib.util
import sys
import types
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import pytest

SERVICE_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture
def websearch_module(monkeypatch):
    queues = types.ModuleType("shared.rabbitmq.queues")
    bootstrap = types.ModuleType("shared.bootstrap")
    bootstrap.run_service = MagicMock()
    bootstrap.QueueBinding = MagicMock()
    bootstrap.make_rabbitmq_client = MagicMock(return_value=MagicMock())
    monkeypatch.setitem(sys.modules, "shared.rabbitmq.queues", queues)
    monkeypatch.setitem(sys.modules, "shared.bootstrap", bootstrap)

    module_name = f"websearch_main_test_{uuid.uuid4().hex}"
    spec = importlib.util.spec_from_file_location(module_name, SERVICE_DIR / "main.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, module_name, module)
    spec.loader.exec_module(module)
    return module
```

Remove every top-level assignment to `sys.modules["shared"]`, `sys.modules["shared.rabbitmq"]`, and `sys.modules["threading"]` from all three test files. Retrieve functions from the fixture inside tests instead of binding a globally loaded module.

- [ ] **Step 4: Register and apply the live marker**

Make `pytest.ini` contain:

```ini
[pytest]
testpaths = shared/tests services
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -m "not live"
markers =
    live: performs network requests and is excluded from deterministic checks
```

Add `pytestmark = pytest.mark.live` to `test_live_crawl.py`. Keep the captured-data tests unmarked.

- [ ] **Step 5: Verify isolation and both suite modes**

Run: `.venv\Scripts\python.exe -m pytest -q`

Expected: all deterministic tests PASS and 3 live tests are deselected.

Run: `.venv\Scripts\python.exe -m pytest -m live services/websearch-service/tests/test_live_crawl.py -q`

Expected: 3 tests PASS whether suppliers return results or gracefully return an empty list.

- [ ] **Step 6: Commit test isolation**

```powershell
git add -- pytest.ini services/websearch-service/tests
git commit -m "test: isolate websearch modules and live checks"
```

---

### Task 3: Replace False Validation Claims with Explicit Inspections

**Files:**
- Modify: `shared/domain/codegen_helpers.py`
- Modify: `services/codegen-service/main.py`
- Modify: `services/codegen-service/test_codegen.py`
- Modify: `gateway/src/lib/stage-types.ts`
- Create: `gateway/src/lib/verification-copy.ts`
- Create: `gateway/__tests__/verification-copy.test.ts`
- Modify: `gateway/src/app/projects/[id]/progress/page.tsx`
- Modify: `gateway/src/app/projects/[id]/result/page.tsx`
- Modify: `gateway/src/lib/handlers/schematic-handler.ts`
- Modify: `gateway/__tests__/pipeline-integration.test.ts`
- Modify: `trial_run.py`

**Interfaces:**
- Consumes: generated code and pin mappings from the existing Codegen Stage.
- Produces: `inspect_code_structure(code, pin_mappings) -> StructureInspection`; `LEGACY_GENERATION_NOTICE`; user-visible generated-but-unverified state.

- [ ] **Step 1: Write failing Python inspection tests**

Replace the two `validate_code` tests with:

```python
def test_structure_inspection_never_claims_verification():
    from shared.domain.codegen_helpers import inspect_code_structure

    result = inspect_code_structure("void setup() {}\nvoid loop() {}", [])
    assert result == {
        "kind": "heuristic",
        "status": "passed",
        "verified": False,
        "checks": ["setup-present", "loop-present"],
        "warnings": [],
    }


def test_structure_inspection_reports_missing_setup():
    from shared.domain.codegen_helpers import inspect_code_structure

    result = inspect_code_structure("void loop() {}", [])
    assert result["status"] == "warning"
    assert result["verified"] is False
    assert "setup-present" not in result["checks"]
```

- [ ] **Step 2: Run the Python tests and verify the old interface fails**

Run: `.venv\Scripts\python.exe -m pytest services/codegen-service/test_codegen.py -v`

Expected: FAIL because `inspect_code_structure` does not exist.

- [ ] **Step 3: Implement the inspection record and update the Codegen Stage**

Implement:

```python
def inspect_code_structure(code: str, pin_mappings: list[dict]) -> dict:
    checks: list[str] = []
    warnings: list[str] = []
    if "void setup()" in code:
        checks.append("setup-present")
    else:
        warnings.append("Missing setup() function")
    if "void loop()" in code:
        checks.append("loop-present")
    else:
        warnings.append("Missing loop() function")
    for pin in pin_mappings:
        if pin.get("connectionType") not in ("analog", "digital", "pwm"):
            continue
        component_name = pin["componentName"]
        pin_name = pin["microcontrollerPin"].split()[0]
        pin_variable = f"PIN_{sanitize_pin_name(component_name)}"
        if pin_variable in code or pin_name in code:
            checks.append(f"pin-referenced:{component_name}")
        else:
            warnings.append(
                f"Pin for {component_name} ({pin_name}) not referenced in code"
            )
    return {
        "kind": "heuristic",
        "status": "passed" if not warnings else "warning",
        "verified": False,
        "checks": checks,
        "warnings": warnings,
    }
```

Import this function in `services/codegen-service/main.py`, keep the transport field named `validation` for database compatibility, and log `inspection_status=<status>, verified=false` instead of `valid=<bool>`.

- [ ] **Step 4: Add a failing TypeScript copy contract**

Create `gateway/__tests__/verification-copy.test.ts`:

```typescript
import { LEGACY_GENERATION_NOTICE } from "@/lib/verification-copy";

describe("legacy generation notice", () => {
  it("names every verification step that has not run", () => {
    expect(LEGACY_GENERATION_NOTICE.state).toBe("unverified");
    expect(LEGACY_GENERATION_NOTICE.description).toContain("未编译");
    expect(LEGACY_GENERATION_NOTICE.description).toContain("未运行 KiCad ERC");
    expect(LEGACY_GENERATION_NOTICE.description).toContain("未仿真");
    expect(LEGACY_GENERATION_NOTICE.description).toContain("未实机验证");
  });
});
```

Run: `npm test -- verification-copy.test.ts`

Working directory: `gateway`

Expected: FAIL because the module does not exist.

- [ ] **Step 5: Implement one source of truthful UI copy**

Create `gateway/src/lib/verification-copy.ts`:

```typescript
export const LEGACY_GENERATION_NOTICE = {
  state: "unverified",
  title: "方案已生成，尚未验证",
  description: "当前固件未编译、未运行 KiCad ERC、未仿真、未实机验证；请勿直接连接高功率负载。",
} as const;
```

Render this notice persistently on the result page. On the progress page, keep “方案生成完成” but add “生成完成不代表验证通过” before navigation. Rename `validateConsistency` to `inspectConsistency`; its warnings remain useful but must not affect a verified claim. Update integration test names from “to ready” to “to exportable state”.

In `trial_run.py`, rename `stage_validate` to `stage_inspect`, print `HEURISTIC INSPECTION`, and end with these exact lines:

```text
    Structure:  PASS|WARNINGS (heuristic only)
    Compile:    NOT RUN
    KiCad ERC:  NOT RUN
    Simulation: NOT RUN
    Hardware:   NOT RUN
```

- [ ] **Step 6: Run focused and full tests**

Run: `.venv\Scripts\python.exe -m pytest services/codegen-service/test_codegen.py -v`

Expected: PASS.

Run: `npm test -- verification-copy.test.ts pipeline-integration.test.ts`

Working directory: `gateway`

Expected: PASS.

Run: `.venv\Scripts\python.exe trial_run.py "智能浇花系统"`

Expected: exit 0 and the summary contains all four `NOT RUN` verification lines.

- [ ] **Step 7: Commit honest verification semantics**

```powershell
git add -- shared/domain/codegen_helpers.py services/codegen-service/main.py services/codegen-service/test_codegen.py gateway/src/lib/stage-types.ts gateway/src/lib/verification-copy.ts gateway/__tests__/verification-copy.test.ts 'gateway/src/app/projects/[id]/progress/page.tsx' 'gateway/src/app/projects/[id]/result/page.tsx' gateway/src/lib/handlers/schematic-handler.ts gateway/__tests__/pipeline-integration.test.ts trial_run.py
git commit -m "fix: distinguish generation checks from verification"
```

Do not stage files regenerated under `trial-output/`.

---

### Task 4: Make Price Aggregation Currency-safe

**Files:**
- Modify: `services/websearch-service/main.py`
- Modify: `services/websearch-service/tests/test_real_data.py`
- Modify: `services/websearch-service/tests/test_live_crawl.py`

**Interfaces:**
- Consumes: deduplicated offers containing `price` and `currency`.
- Produces: each component summary with `priceGroups`, `comparable`, and legacy scalar fields only when one currency group exists.

- [ ] **Step 1: Write failing mixed-currency aggregation tests**

Add a fixture containing one `10 CNY` offer and one `2 USD` offer, then assert:

```python
summary = aggregate_prices(deduplicate_results(mixed_currency_data))["Sensor"]
assert summary["comparable"] is False
assert summary["cheapest"] is None
assert summary["average"] is None
assert summary["currency"] is None
assert summary["priceGroups"] == {
    "CNY": {"cheapest": 10.0, "average": 10.0, "offers": 1},
    "USD": {"cheapest": 2.0, "average": 2.0, "offers": 1},
}
```

Update the captured CNY-only expectations to retain `cheapest=10.0`, `average=10.0`, and `currency="CNY"`, never hardcoded USD.

- [ ] **Step 2: Run captured-data tests and verify the false USD behavior**

Run: `.venv\Scripts\python.exe -m pytest services/websearch-service/tests/test_real_data.py -v`

Expected: FAIL because `aggregate_prices` hardcodes USD and compares all numeric values together.

- [ ] **Step 3: Group prices by currency and use aware UTC timestamps**

Implement grouping by normalized uppercase currency. For exactly one non-empty currency group, populate legacy `cheapest`, `average`, and `currency`; for zero or multiple groups, set all three to `None`. Always return `priceGroups` and `comparable = len(priceGroups) <= 1`.

Replace `from datetime import datetime` with:

```python
from datetime import UTC, datetime
```

Replace every `datetime.utcnow().isoformat()` with:

```python
datetime.now(UTC).isoformat()
```

- [ ] **Step 4: Verify deterministic and live behavior**

Run: `.venv\Scripts\python.exe -m pytest services/websearch-service/tests/test_real_data.py -W error::DeprecationWarning -v`

Expected: PASS with no datetime deprecation warnings.

Run: `.venv\Scripts\python.exe -m pytest -m live services/websearch-service/tests/test_live_crawl.py -v`

Expected: PASS; the test must assert CNY for the static DHT11 group rather than USD.

- [ ] **Step 5: Commit currency-safe aggregation**

```powershell
git add -- services/websearch-service/main.py services/websearch-service/tests/test_real_data.py services/websearch-service/tests/test_live_crawl.py
git commit -m "fix: keep supplier prices currency-safe"
```

---

### Task 5: Reach Zero Production TypeScript Lint Warnings

**Files:**
- Modify: `gateway/src/app/api/projects/[id]/snapshots/route.ts`
- Modify: `gateway/src/app/api/projects/[id]/stream/route.ts`
- Modify: `gateway/src/app/api/projects/start/route.ts`
- Modify: `gateway/src/app/api/snapshots/[snapshotId]/restore/route.ts`
- Modify: `gateway/src/app/api/templates/route.ts`
- Modify: `gateway/src/app/keys/page.tsx`
- Modify: `gateway/src/app/projects/[id]/code/page.tsx`
- Modify: `gateway/src/app/projects/[id]/export/page.tsx`
- Modify: `gateway/src/app/projects/[id]/recommendations/page.tsx`
- Modify: `gateway/src/app/projects/[id]/result/page.tsx`
- Modify: `gateway/src/app/projects/[id]/review/page.tsx`
- Modify: `gateway/src/app/projects/new/page.tsx`
- Modify: `gateway/src/lib/orchestrator.ts`
- Modify: `gateway/src/lib/rabbitmq.ts`
- Modify: `gateway/src/lib/snapshot.ts`
- Modify: `gateway/src/lib/stage-handler.ts`
- Modify: `gateway/src/middleware/rate-limit.ts`
- Modify: `gateway/src/types/redis.d.ts`

**Interfaces:**
- Consumes: existing route, queue, snapshot, and UI behavior.
- Produces: `npx eslint src/ --max-warnings 0` with no rule suppression and no behavior changes.

- [ ] **Step 1: Capture the failing production lint gate**

Run: `npx eslint src/ --max-warnings 0`

Working directory: `gateway`

Expected: FAIL on the current production warnings.

- [ ] **Step 2: Remove genuinely unused values**

Delete the unused `consumeDailyQuota`, `router`, `theme`, and `priceComp` bindings in their reported files. Rename intentionally unused callback parameters from `d` or `editable` to `_d` or `_editable`. Replace the empty catch in `projects/new/page.tsx` with `catch { /* draft restoration is best-effort */ }`.

- [ ] **Step 3: Replace production `any` with precise narrow types**

Apply this matrix rather than changing ESLint rules:

```text
snapshots routes       catch (error: unknown), then error instanceof Error
stream route           Record<string, unknown> for parsed JSON rows
templates route        TemplateRow interface matching selected columns
orchestrator           StageOutput union from stage-types.ts
rabbitmq               ConsumeMessage | null and ChannelModel types from amqplib
snapshot               JsonValue recursive type
stage-handler           unknown payload plus generic Output; comment the intentional no-op ack catch
rate-limit             RedisLike interface with incr/expire/ttl
redis.d.ts              unknown[] arguments and Promise<unknown> results
```

For error messages, use this exact narrowing pattern:

```typescript
const message = error instanceof Error ? error.message : "Unknown error";
```

- [ ] **Step 4: Verify production lint, tests, and build**

Run: `npx eslint src/ --max-warnings 0`

Expected: PASS with zero warnings.

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: exit 0 with no Next.js runtime warnings.

- [ ] **Step 5: Commit production lint cleanup**

```powershell
git add -- gateway/src
git commit -m "refactor: enforce typed production gateway code"
```

Before committing, confirm `gateway/tsconfig.tsbuildinfo` is not staged.

---

### Task 6: Reach Zero Test TypeScript Lint Warnings

**Files:**
- Modify: `gateway/__tests__/billing.test.ts`
- Modify: `gateway/__tests__/membership.test.ts`
- Modify: `gateway/__tests__/pipeline-integration.test.ts`
- Modify: `gateway/__tests__/pipeline.test.ts`
- Modify: `gateway/__tests__/templates.test.ts`
- Modify: `gateway/__tests__/tier-permissions.test.ts`
- Modify: `gateway/eslint.config.js`
- Modify: `gateway/package.json`

**Interfaces:**
- Consumes: existing Vitest behavior and Pipeline Definition types.
- Produces: `npm run lint` as a zero-warning merge gate.

- [ ] **Step 1: Capture the failing test lint gate**

Run: `npx eslint __tests__/ e2e/ --max-warnings 0`

Working directory: `gateway`

Expected: FAIL on unused fixtures and explicit `any` in Pipeline and template tests.

- [ ] **Step 2: Remove unused test setup and type mocks**

Delete unused `beforeAll`, `mockSubscription`, `updateCalls`, and `verifyToken`. Replace Pipeline test `any` casts with `unknown` followed by Zod parsing or with the concrete `PipelineDefinition`/stage output types exported from `src/lib/pipeline.ts` and `src/lib/stage-types.ts`. Replace template row `any` values with:

```typescript
interface TemplateFixture {
  id: string;
  name: string;
  platform: "arduino" | "esp32" | "stm32";
  difficulty: "beginner" | "intermediate" | "advanced";
}
```

Do not add eslint-disable comments.

- [ ] **Step 3: Make the package lint command fail on future warnings**

Change the script to:

```json
"lint": "eslint src/ __tests__/ e2e/ --max-warnings 0"
```

Keep the three existing warning-level rules in `eslint.config.js`; zero warnings must come from clean code, not downgraded coverage.

- [ ] **Step 4: Verify the full gateway gate**

Run: `npm run lint`

Expected: PASS with zero warnings.

Run: `npm test`

Expected: all gateway tests PASS.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 5: Commit the test lint gate**

```powershell
git add -- gateway/__tests__ gateway/eslint.config.js gateway/package.json
git commit -m "test: enforce zero-warning gateway lint"
```

---

### Task 7: Make CI Match the Measured Local Baseline

**Files:**
- Create: `requirements-test.txt`
- Modify: `services/codegen-service/requirements.txt`
- Modify: `services/recommendation-service/requirements.txt`
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/live-websearch.yml`
- Create: `docs/verification/2026-07-29-trust-baseline.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: deterministic pytest suite, zero-warning gateway lint, gateway build, Docker Compose build.
- Produces: merge-gating CI and an isolated scheduled/manual live supplier smoke workflow.

- [ ] **Step 1: Add the reproducible Python test entrypoint**

Create `requirements-test.txt`:

```text
pytest==9.1.1
-r services/codegen-service/requirements.txt
-r services/schematic-service/requirements.txt
-r services/websearch-service/requirements.txt
-r services/recommendation-service/requirements.txt
```

Pin `openai==2.50.0` in both requirements files that currently use `openai>=1.0.0` so the combined install is deterministic.

- [ ] **Step 2: Expand pull-request CI into truthful gates**

The gateway job must run, in order:

```yaml
- run: npm ci
- run: npm test
- run: npm run lint
- run: npm run build
```

The Python job must install `requirements-test.txt` and run:

```yaml
- run: python -m pip install --upgrade pip
- run: python -m pip install -r requirements-test.txt
- run: python -m pytest -q
```

Keep `docker-build` dependent on both jobs. Do not add Arduino compilation or KiCad ERC to this plan; their adapters and fixtures do not exist yet, and CI must not imply otherwise.

- [ ] **Step 3: Isolate live supplier smoke checks**

Create `.github/workflows/live-websearch.yml` with only `workflow_dispatch` and a weekly schedule. It installs `requirements-test.txt` and runs:

```yaml
- run: python -m pytest -m live services/websearch-service/tests/test_live_crawl.py -v
```

Name the job `non-gating-live-supplier-smoke`; do not attach it as a dependency of pull-request CI.

- [ ] **Step 4: Run the full local measurement**

Run from the repository root:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-test.txt
.\.venv\Scripts\python.exe -m pytest -q
Set-Location gateway
npm ci
npm test
npm run lint
npm run build
Set-Location ..
docker compose build
```

Expected: every command exits 0; pytest reports 3 live tests deselected; ESLint reports zero warnings. If Docker fails because of an external registry or daemon problem, record the exact error and do not mark Docker as passed.

- [ ] **Step 5: Record measured evidence and update README**

Write `docs/verification/2026-07-29-trust-baseline.md` with a table containing command, exit code, pass/fail counts, warnings, duration, tool versions, commit SHA, and timestamp. Replace README baseline numbers with those measured values and link the evidence document. The verified-capability table must still say firmware compilation, ERC, simulation, and hardware verification are not implemented.

- [ ] **Step 6: Verify documentation and workflow syntax**

Run: `.venv\Scripts\python.exe -m pytest shared/tests/test_repository_contract.py -v`

Expected: PASS.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 7: Commit the CI and measurement baseline**

```powershell
git add -- requirements-test.txt services/codegen-service/requirements.txt services/recommendation-service/requirements.txt .github/workflows/ci.yml .github/workflows/live-websearch.yml docs/verification/2026-07-29-trust-baseline.md README.md
git commit -m "ci: enforce the measured trust baseline"
```

---

## Completion Gate

This plan is complete only when the deterministic Python suite, all gateway tests, zero-warning lint, production build, and Docker build have fresh recorded results; the UI and trial runner explicitly say generated artifacts are unverified; mixed currencies are never compared as one amount; and the GitHub pull-request workflow runs the same deterministic gates. The next plan is the Canonical Design Core (`DesignSpec`, `BoardProfile`, `ComponentDefinition`, constraint results, and Evidence Report schema), not ESP32 expansion.
