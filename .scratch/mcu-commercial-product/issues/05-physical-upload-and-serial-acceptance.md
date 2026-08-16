# 05 — Real board upload and serial acceptance

**What to build:** When the user has the exact Reference Kit and a data-capable USB connection, the product can identify the board, upload the compiled artifact, verify the upload, capture the expected serial startup output, and mark physical acceptance only when all required evidence is present.

**Blocked by:** 03 — Reproducible Arduino build and local-ready result; 04 — Unified commercial readiness report.

**Status:** ready-for-agent

- [ ] Physical acceptance records the exact board and revision, detected USB device, selected port, firmware hash, upload result, verification result, and serial observation.
- [ ] Port discovery alone cannot mark the board accepted.
- [ ] Upload timeout, changed device, serial disconnect, unexpected output, or missing hardware remain failed or pending with a visible reason.
- [ ] The existing device, flash, and serial capabilities feed the same readiness report without merging their evidence into one boolean.
- [ ] Deterministic fixture tests cover the state machine, and a real-board acceptance record can be attached separately without being fabricated in CI.
