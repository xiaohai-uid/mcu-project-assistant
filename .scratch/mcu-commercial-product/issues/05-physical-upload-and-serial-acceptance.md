# 05 — Real board upload and serial acceptance

**What to build:** When the user has the exact Reference Kit and a data-capable USB connection, the product can identify the board, upload the compiled artifact, verify the upload, capture the expected serial startup output, and mark physical acceptance only when all required evidence is present.

**Blocked by:** 03 — Reproducible Arduino build and local-ready result; 04 — Unified commercial readiness report.

**Status:** resolved

- [x] Physical acceptance records the exact board and revision, detected USB device, selected port, firmware hash, upload result, verification result, and serial observation.
- [x] Port discovery alone cannot mark the board accepted.
- [x] Upload timeout, changed device, serial disconnect, unexpected output, or missing hardware remain failed or pending with a visible reason.
- [x] The existing device, flash, and serial capabilities feed the same readiness report without merging their evidence into one boolean.
- [x] Deterministic fixture tests cover the state machine, and a real-board acceptance record can be attached separately without being fabricated in CI.

**Resolution:**

- Added durable physical acceptance records with Reference Kit identity/revision, detected USB identity, port, firmware SHA-256, upload/verification/serial statuses, observed serial text, overall status, and reason.
- Persisted the actual flash result per project so the acceptance capability can validate build/version/hash/physical truth instead of trusting a client boolean.
- Added the deterministic acceptance evaluator: port discovery is pending, companion execution is not physical acceptance, mismatched hashes and unexpected serial output fail, and only complete physical evidence is accepted.
- Added POST/GET physical acceptance endpoints and a Delivery UI form that can reuse the live serial lines; the same record is consumed by the unified readiness report.
- Verified with state-machine unit tests, SQLite migration/persistence coverage through the HTTP fixture, physical adapter tests, and typecheck/lint.
