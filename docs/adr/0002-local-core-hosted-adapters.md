# 0002 — Complete Local Core with Hosted Adapters

The open-source product will run the complete design and local-verification core without an account or server, while hosted execution, paid data sources, team features, and managed simulation attach through adapters at explicit seams. Local and hosted modes share the same DesignSpec, generators, verification profiles, and evidence rules; RabbitMQ remains a hosted execution detail rather than a requirement of the domain core. This preserves a trustworthy local product and lets the commercial service compete on managed scale, data quality, collaboration, and convenience instead of incompatible or intentionally crippled logic.

## Status

accepted

## Consequences

- A local run cannot require Postgres, Redis, RabbitMQ, a hosted account, or a vendor API token for its core verification profile.
- Optional Wokwi and live distributor data adapters may report `not-run` or `unavailable`, but cannot fabricate a pass.
- The hosted product may add execution capacity and proprietary operational modules without forking the domain model.
- The open-source core will use the Apache-2.0 license; hosted control-plane and proprietary data products remain separately licensable.
