# MCU Project Assistant

## Language

**DesignDraft**:
A user's project through the pipeline lifecycle — from initial description to ready-for-download schematic and code.
_Avoid_: Project, draft

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

**Platform**:
The target MCU architecture for code generation and pin assignment: `arduino`, `esp32`, or `stm32`.

**Membership**:
The user's access tier — `free` (shared API key, limited), `byo_key` (user's own API key, unlimited) or `subscription` (premium model, web search, unlimited).

**Model Config**:
The resolved AI model configuration (provider, model name, API key source) for a given user + membership.

**Tier**:
Component price category in recommendations — `budget` (<$3), `standard` ($3-15), `premium` (>$15).
