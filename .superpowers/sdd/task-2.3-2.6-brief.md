# Tasks 2.3–2.6 — RequirementService Business Logic

## Acceptance Criteria
1. **2.3:** Enhanced LLM prompt + JSON parsing + validation against Requirement model + retry on parse failure
2. **2.4:** Vague description detection → publish CLARIFICATION_REQUEST queue; listener on CLARIFICATION_RESPONSE → re-analyze with enhanced context
3. **2.5:** Language detection (Chinese/English) with prompt adaptation
4. **2.6:** Durable consumer loop with error handling, retry, DLQ pattern

## Context
- Existing scaffold: `services/requirement-service/main.py` — basic `call_llm()`, `analyze_requirement()` callback
- Shared models: `shared/models/requirement.py` — `Requirement` Pydantic model
- Queue names: `shared/rabbitmq/queues.py`
- RabbitMQ client: `shared/rabbitmq/client.py` — publish/consume

## Implementation

### Shared: Add clarification queues to `shared/rabbitmq/queues.py`
```
CLARIFICATION_INPUT = "requirement.clarification.input"
CLARIFICATION_OUTPUT = "requirement.clarification.output"
```
(Actually since this is Gateway-facing, let's use clearer names)
```
CLARIFICATION_REQUEST = "requirement.clarification.request"
CLARIFICATION_RESPONSE = "requirement.clarification.response"
```

### `services/requirement-service/main.py` — Rewrite with:

1. `detect_language(text: str) -> str` — checks for Chinese chars (U+4E00–U+9FFF), returns "zh" or "en"
2. `build_prompt(description: str, lang: str) -> str` — language-adapted prompt
3. `parse_llm_response(raw: str, retries=2) -> dict` — JSON extraction + parse + validate against Requirement model
4. `is_vague(description: str) -> bool` — heuristic: <10 chars, or generic keywords
5. `analyze_requirement()` — enhanced: detect lang → build prompt → call LLM → parse → validate → if vague → publish clarification request → else → publish result
6. `handle_clarification_response()` — consumes CLARIFICATION_RESPONSE, re-analyzes with enhanced description
7. Error handling: try/except around LLM call + parse; on failure → publish to DLQ or retry

Write the file at `C:\Users\Administrator\Desktop\opencode\mcu-project-assistant\services\requirement-service\main.py`.

Also update `C:\Users\Administrator\Desktop\opencode\mcu-project-assistant\shared\rabbitmq\queues.py` to add:
```
CLARIFICATION_REQUEST = "requirement.clarification.request"
CLARIFICATION_RESPONSE = "requirement.clarification.response"
```

PLACEHOLDER for things that can't run without Gateway wiring (e.g., clarification response listener won't be wired until Gateway pipeline is done). The main flow (analyze → LLM → structured output) should be fully functional.

Test: since there's no Python test framework set up, just verify the file is syntactically valid with `python -c "import ast; ast.parse(open('...').read())"`.

## Output
Return modified file contents and validation result.