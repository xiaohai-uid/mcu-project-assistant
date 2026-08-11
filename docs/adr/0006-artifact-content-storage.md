# 0006 — Artifact Content Storage: ArtifactContentPort (Immutable Version Content)

## Status

accepted

## Context

ArtifactVersion 不可变（P-2/I-2）+ 内容身份 = 版本身份（D2）+ 审计（Tier1 Auditability）。UI 需要结构化 diff（提案 Diff 视图、Revalidate 语义变化检测）。Domain / Application 不得依赖具体内容存储布局（指令修正三）。

## Considered Options

- **ArtifactContentPort（chosen）**: 内容层以 Port 隔离：`store(versionRef, content) → contentRef`、`load(contentRef) → content`、`hash(content) → digest`。**Local Adapter = Workspace Files**（版本目录，人读、Git-friendly）；**Cloud Adapter = Object/Blob Storage**。版本行只引用 contentRef。
  - 版本内容可保存 content hash / integrity hash / version identity hash（审计与完整性校验）——但 **hash ≠ 必须 CAS**；CAS / content deduplication 只有在未来证明（大量重复内容/存储成本/分发/immutable blob reuse）值得时再作为 Adapter 实现采用。
- 行内 JSONB 全量: 无内容身份、diff 需全量对比、人读内容不可见。
- 可变文件 + 版本行: 半写风险、不可靠（Tier1 Recoverability）。

## Consequences

- diff = contentRef 不同时做结构化对比（决策 D1 的"语义变化"判定基础）；同内容同 hash 可做完整性校验（去重与否是 Adapter 决策）。
- 版本创建 = 原子写内容（ArtifactContentPort）+ 写版本行（事务边界在 Persistence Port）。
- 人读内容与存储内容同源（Local Adapter 的工作区文件 = 内容本体，用户可 git；Cloud Adapter 可镜像）。
- Domain/Application 只依赖 Port 语义，不依赖具体布局（版本目录 or 对象键 or CAS 布局）。
