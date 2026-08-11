# 0005 — Cloud Persistence: Relational Metadata + Object/Blob Content Storage

## Status

accepted

## Context

Cloud 是增强（P-7），不是真相源。ArtifactVersion 语义（P-2 不可变 + D2 版本/Build 分离）要求内容与元数据分离。旧 Postgres schema 有漂移且无版本模型，不沿用（指令 §十一）。

## Considered Options

- **Relational metadata + object/blob content storage（chosen）**: 关系表（projects/artifacts/versions/proposals/records/stale marks）+ 内容经 **ArtifactContentPort** 存入对象/blob 存储（ADR-0006）。
- 纯 relational: 大内容（固件/图）膨胀、不可变靠约定。
- Postgres + JSONB 全量: 查询弱、内容层无 diff。

## Consequences

- ArtifactVersion 行 = 结构化 metadata（版本号/状态/内容引用/来源提案/时间）；内容经 ArtifactContentPort 存储。
- **Content-addressable 存储（CAS）不是核心架构硬约束**：允许保存 content hash / integrity hash / version identity hash，但 hash ≠ 必须 CAS；去重/不可变 blob 复用仅在证明需要（大量重复内容/存储成本/分发）时作为 Adapter 实现选择采用。
- 云/本地内容格式一致（同一 ArtifactContentPort 语义），同步协议只搬运内容 + 合并元数据（ADR-0011）。
- 不继承旧 schema；迁移见 ADR-0011。
