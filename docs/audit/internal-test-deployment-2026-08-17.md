# Internal-test deployment audit — 2026-08-17

## Scope

This audit covers the first protected online staging deployment of the current single-process MCU Project Assistant. It does not change the physical-release gate: `paid-release-ready` remains blocked until exact-board USB detection, upload verification, and `MCU_READY` serial evidence are recorded from a real ESP32-S3-DevKitC-1-N8R8 v1.1.

## Deployment

- Image: `mcu-project-assistant:staging`
- Image digest: `sha256:b8039421673b208c326ef258cd0925d34c0a2bc38bbfea9b74ed169c0371e4d0`
- Container: `937b9d31d5cb63288a030b02ebf6c1d0631b862ca93317524d3b82324ac44244`
- Runtime: Node 20 Bookworm Slim, Docker Desktop Linux engine
- Data: isolated named Docker volumes, not the repository's local `data` or `workspace`
- Device mode: `companion` for online review; no physical board is exposed through the tunnel
- AI mode: explicit SenseNova provider; no mock adapter in the container
- Perimeter: `MCU_PUBLIC_MODE=1`, Basic Auth, same-host public Origin validation
- Health: Docker healthcheck `healthy`

## Public smoke evidence

Temporary TryCloudflare URL created for the running process:

`https://tape-console-ivory-genius.trycloudflare.com`

The URL is disposable and is not a permanent release address. The local `cloudflared` process and staging container must remain running for it to work.

Verified over the public URL:

| Probe | Result |
| --- | --- |
| API without credentials | `401 authentication_required` |
| UI without credentials | `401` with Basic Auth challenge |
| Authenticated `/api/v1/health` | `200 {"status":"ok"}` |
| Authenticated React UI | `200 text/html` |
| Same-host Origin | `200`, CORS allow-origin matches request host |
| Cross-site Origin | `403 untrusted_origin` |
| Authenticated project creation | `201` |

One real AI analysis request reached the configured SenseNova provider but ended as `provider_rate_limited` / quota exceeded. This is an external provider-capacity failure, not a deployment or authentication failure; it must be cleared before a tester can complete an AI-backed journey.

## Regression evidence

- `npm test`: 100 files, 576 passed, 1 skipped
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed
- `docker build -t mcu-project-assistant:staging .`: passed
- `git diff --check`: passed

## Follow-up

1. Restore SenseNova quota or configure another real provider before formal AI-flow testing.
2. Replace the temporary URL with a managed tunnel/domain and a persistent host before calling the service a durable production deployment.
3. Attach the exact Reference Kit and complete physical acceptance; keep all readiness reports fail-closed until then.
