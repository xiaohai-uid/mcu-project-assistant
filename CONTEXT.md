# MCU Project Assistant

## Language

**DesignDraft**:
A user's project through the pipeline lifecycle — from initial description to ready-for-download schematic and code.
_Avoid_: Project, draft

**DesignSpec**:
The versioned, canonical statement of a design's requirements, selected board and parts, electrical constraints, pin assignments, and expected behaviours. Every generated artifact and verification run refers to one exact DesignSpec revision.
_Avoid_: Prompt, generated config, project JSON

**DesignBundle**:
The downloadable result for one DesignSpec revision: firmware, schematic, bill of materials, build metadata, and its Evidence Report.
_Avoid_: ZIP, output files

**Evidence Report**:
The machine-readable and human-readable record of what was actually checked, by which tool and version, with logs and timestamps. Readiness is derived from this evidence rather than asserted by a generator.
_Avoid_: Validation flag, success message

**Verification Profile**:
The named set of checks a DesignBundle must pass for a particular claim, such as local-ready or reference-kit-verified.
_Avoid_: Test mode, validation level

**Reference Kit**:
A versioned board-and-parts inventory with reproducible wiring and physical acceptance procedures used as the hardware truth set.
_Avoid_: Demo kit, example parts

**Pipeline**:
The async chain of processing stages (Requirement → Recommendation → WebSearch → Codegen → Schematic) connected by RabbitMQ queues. Each stage has an input and output queue, a service handler, and a message schema.
_Avoid_: Workflow, chain, flow

**Stage**:
A single step in the pipeline with an input queue, output queue, handler implementation, and typed message schemas for input/output.
_Avoid_: Step, phase

**Pipeline Definition**:
A declaration that groups each stage's queues, handler class, and message schemas in one place. The single source of truth for stage ordering and wiring.
_Avoid_: Pipeline config, pipeline setup

**Orchestrator**:
The RabbitMQ consumer living in the gateway that reads output queues and publishes to the next stage's input queue. Chains stages together.

**Execution Mode**:
The environment used to execute a design run: `local` in one process without an account, or `hosted` through queued server workers. Execution Mode does not change DesignSpec semantics or evidence rules.
_Avoid_: Edition, local feature set, cloud feature set

**Platform**:
The target MCU architecture for code generation and pin assignment: `arduino`, `esp32`, or `stm32`.

**Membership**:
The user's access tier — `free` (shared API key, limited), `byo_key` (user's own API key, unlimited) or `subscription` (premium model, web search, unlimited).

**Model Config**:
The resolved AI model configuration (provider, model name, API key source) for a given user + membership.

**Tier**:
Component price category in recommendations — `budget` (<$3), `standard` ($3-15), `premium` (>$15).
