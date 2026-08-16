# Commercial Golden Journey — Reference Kit acceptance

Use this checklist with a real `ESP32-S3-DevKitC-1-N8R8 v1.1`. The report is accepted only from the saved evidence route; screenshots or a companion-local result do not replace the required records.

## 1. Confirm the approved design

- [ ] Create the project from the user requirement and wait for analysis to finish.
- [ ] Review every proposal and explicitly accept the proposals that belong in the project.
- [ ] Commit the accepted requirements before selecting hardware.
- [ ] Select `ESP32-S3` and confirm the report shows Reference Kit `esp32-s3-devkitc-1-n8r8-v1.1`.
- [ ] Confirm the board model is `ESP32-S3-DevKitC-1-N8R8`, revision `v1.1`, and the source link is the Espressif v1.1 guide.
- [ ] Confirm every required component is either exact or visible in the unresolved-risk list.

## 2. Confirm wiring and build evidence

- [ ] Generate the Pin Map and inspect strapping-pin diagnostics before wiring.
- [ ] Validate the current Pin Map after the final firmware proposal is accepted.
- [ ] Resolve all required wiring diagnostics; the report must show validation `pass`.
- [ ] Run the pinned Arduino build and confirm the report includes the resolved FQBN, Arduino CLI version, ESP32 core `3.3.11`, and `toolchainEvidence=real`.
- [ ] Confirm the report contains a non-empty binary output and its SHA-256 hash.
- [ ] Confirm the optional simulation state is `not-run` when no simulator was used; this must not change `local-ready`.

## 3. Upload and physical acceptance

- [ ] Connect only the exact Reference Kit and record the detected USB port, VID/PID, and serial number.
- [ ] Issue the one-time flash confirmation and upload the saved build to the detected device.
- [ ] Confirm upload and verification are physical and verified; companion-local evidence is not sufficient.
- [ ] Open serial and save observed startup/status lines containing the project firmware marker (for example `MCU_READY`, `BOOT`, `READY`, `STATUS`, or `HELLO`).
- [ ] Save the physical acceptance record and confirm it is `accepted` with matching build ID, firmware version, and firmware SHA-256.

## 4. Procurement evidence and final handoff

- [ ] Review the BOM generated from current requirements and the approved Reference Kit.
- [ ] Resolve every component needed for procurement to an exact manufacturer part number and LCSC supplier SKU, or leave the explicit unresolved risk visible.
- [ ] Add LCSC observations separately for quantity tiers 1, 10, and 100 where available.
- [ ] Confirm each observation has a source URL and observed-at timestamp; observations do not change compatibility or release gates.
- [ ] Export the BOM as CSV and Markdown and retain both with the handoff.
- [ ] Refresh Delivery and verify the conclusion, four gates, evidence references, physical record, BOM timestamps, and unresolved risks agree with the work just performed.
- [ ] `paid-release-ready` is allowed to be ready only when local-ready and physical-accepted are both ready.
