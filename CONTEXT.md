# MCU Project Assistant

## Language

**Project**:
A long-term workspace container owning a set of artifacts. Lifecycle: create → edit → archive → delete. Archiving/deleting never cascades physical deletes of content (I-10; archive semantics).
_Avoid_: DesignSpec, design bundle

**Artifact**:
A container for one kind of engineering asset — `requirements`, `hardware`, `pinmap`, `wiring`, `firmware`, `validation`, `build`, `debug`. Holds a "current version" pointer; never holds mutable content itself. Build/validation are boundary evidence, not artifact kinds that can go stale on their own.
_Avoid_: Stage, pipeline output

**ArtifactVersion**:
An immutable content snapshot plus state. Version numbers increase monotonically per artifact; content cannot be modified in place (I-2); state machine `draft → accepted → validated/stale/error/warning`. One version = one "content identity".
_Avoid_: DesignSpec revision, generated config

**Proposal**:
A first-class pending-change record — `{ baseVersion, kind, payload, diff, impacts[] }` — shown to the user for a decision. A proposal is not a version; Reject produces zero artifact change (I-3); Accept produces exactly one new ArtifactVersion. AI never writes accepted content directly (I-1); every AI modification path must pass through a proposal. A proposal has exactly one decision (pending → accepted | rejected); accepting twice is a no-op.
_Avoid_: Draft change, AI suggestion

**StaleMark**:
The runtime signal that a downstream artifact's current version no longer reflects an upstream semantic change. Level is evaluated from the impact of the actual change (D5), never hard-coded by artifact kind; six fixed dependency edges (DEPENDENCY_EDGES). Marks describe current state only (no history); resolving requires revalidation — no semantic change → Validated, semantic change → a new Proposal, never auto-accepted (D1).
_Avoid_: Validation flag, outdated flag

**BuildRecord**:
The execution evidence for one build of one specific ArtifactVersion. References the unique version + environment snapshot (toolchain, board target, options); the same version may be built many times (D2); result is `succeeded | failed | cancelled`; failures also persist a record.
_Avoid_: Build status, pipeline run

**ValidationRecord**:
The rule-validation execution evidence. References a version; result `pass | warn | fail`; an un-run validation is never reported as passing (I-7); a new version requires new validation.
_Avoid_: Validation flag, verified badge

**Capability**:
A command/query over the application boundary (e.g. `analyze_requirements`, `generate_firmware`, `run_build`, `flash_device`) — cancellable, idempotent where specified, emitting typed events. Implemented in `src/application/capabilities/` and exposed over the HTTP API.
_Avoid_: Service handler, pipeline stage

**DeviceSession**:
The companion runtime session: detect → connected → flashing → disconnected. Single active session; the session itself is transient runtime state (no `device_sessions` table — `preferences` persists `last_device` only); disconnect aborts in-flight operations; flash/telemetry evidence persists as DebugEvidence.
_Avoid_: Device record, hardware state table

**DebugEvidence**:
The persisted evidence of a device operation — `.evidence/<sessionId>.log` in the workspace, written only on success (no half-written evidence on abort/fail). Flash/telemetry evidence is versioned artifact content (debug kind).
_Avoid_: Log output, validation flag

**Preferences**:
Key/value workspace settings (`last_device`, `toolchain_info`). Not domain objects; no table growth per slice.
_Avoid_: Device config, settings table

**Execution Mode**:
`local` — single process, SQLite + workspace files, no account. `hosted` (cloud adapters, queued workers) is a future milestone; Execution Mode never changes artifact/evidence semantics.
_Avoid_: Edition, cloud feature set

**Platform**:
The target MCU architecture for pin assignment and firmware generation: `arduino`, `esp32`, or `stm32`.
