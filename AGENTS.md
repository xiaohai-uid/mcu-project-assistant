<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tools** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them. `codegraph_node` returns one symbol's source + callers, or reads a whole file with line numbers. If the tools are listed but deferred, load them by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` and `codegraph node <symbol-or-file>` print the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## Storage Policy

NEVER write any files to C: drive. All files, scripts, downloads, and generated content MUST go to D: drive. This is a hard rule.

## ECC Integration

This workspace integrates ECC (Agent Harness Operating System, 226k⭐) via symbolic links.

### ECC Commands (prefix: `/ecc-`)

Use these OpenCode commands provided by ECC:

| Command | Purpose |
|---------|---------|
| `/ecc-plan` | Create detailed implementation plan |
| `/ecc-tdd` | Enforce TDD workflow (80%+ coverage) |
| `/ecc-code-review` | Review code for quality & security |
| `/ecc-security` | Comprehensive security review |
| `/ecc-build-fix` | Fix build/TypeScript errors |
| `/ecc-e2e` | Generate and run Playwright E2E tests |
| `/ecc-orchestrate` | Orchestrate multiple agents |
| `/ecc-refactor-clean` | Remove dead code, consolidate |
| `/ecc-learn` | Extract patterns and learnings |
| `/ecc-verify` | Run verification loop |
| `/ecc-checkpoint` | Save verification state |
| `/ecc-loop-start` | Start autonomous agent loop |

### ECC Agents (subagent dispatch)

- **planner** — implementation planning for complex features
- **architect** — system design and architecture
- **code-reviewer** — code quality review
- **security-reviewer** — security vulnerability detection
- **tdd-guide** — test-driven development enforcement
- **build-error-resolver** — build/TypeScript error fixes
- **e2e-runner** — Playwright E2E testing
- **refactor-cleaner** — dead code cleanup
- **doc-updater** — documentation and codemaps
- **database-reviewer** — PostgreSQL/SQL optimization
- **loop-operator** — autonomous agent loop control

### ECC Skills (277)

Available as discoverable skills under `.opencode/skills/ecc/`. Use OpenCode's skill discovery to browse them.

### OpenSpec Commands (prefix: `/opsx-`)

| Command | Purpose |
|---------|---------|
| `/opsx:propose` | Create new change with full artifacts |
| `/opsx:explore` | Explore ideas before committing |
| `/opsx:new` | Create empty change skeleton |
| `/opsx:ff` | Fast-forward: generate all artifacts |
| `/opsx:continue` | Incrementally continue artifacts |
| `/opsx:apply` | Execute implementation tasks |
| `/opsx:verify` | Verify implementation against specs |
| `/opsx:sync` | Sync spec status |
| `/opsx:archive` | Archive completed change |
| `/opsx:bulk-archive` | Batch archive changes |
| `/opsx:onboard` | Onboarding for new scenarios |

## Design Systems Reference

This workspace includes `awesome-design-md` (95.7k⭐) — 74 curated DESIGN.md files from top brand design systems.

- **Location:** `D:\awesome-design-md\design-md\`
- **Usage:** Copy any `DESIGN.md` into your project root and tell the AI agent to use it
- **Available brands:** Apple, Vercel, Stripe, Claude, Linear, Figma, Supabase, Nike, Spotify, Tesla, Ferrari, BMW, and 63 more

## Key Paths

- ECC source: `D:\Projects\ECC` (v2.0.0, 2,253 commits)
- ECC commands: `.opencode/commands/ecc-*.md` (symlinks)
- ECC skills: `.opencode/skills/ecc/` (277 skills, symlinks)
- ECC prompts: `.opencode/prompts/agents/` (25 agent prompts)
- ECC instructions: `.opencode/instructions/ecc-INSTRUCTIONS.md`
- OpenSpec: `openspec/` with `config.yaml`
- OpenSpec commands: `.opencode/commands/opsx-*.md`
- OpenSpec skills: `.opencode/skills/openspec-*/`
- Design systems: `D:\awesome-design-md\design-md\` (74 systems)
