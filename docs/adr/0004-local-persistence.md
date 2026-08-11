# 0004 — Local Persistence: Hybrid (SQLite + Workspace Files)

## Status

accepted

## Context

Local-first（P-6）要求核心流程零外部依赖；Windows 安装零摩擦（P-8）；QA-2 事务性离线、QA-3 审计、QA-7 崩溃恢复。候选：A 纯 SQLite、B 纯 Git-friendly 文件、C 本地 Postgres、D Hybrid。比较见 architecture-options §1。

## Considered Options

- **Hybrid（chosen）**: SQLite 承载 metadata / relationships / operational state（projects、artifacts、versions、proposals、decisions、build/validation records、stale marks、preferences）；workspace files 承载 human-readable artifacts（firmware、config、SVG、docs）。
- 纯 SQLite: 内容不可 diff、用户不可读、Git 不友好。
- 纯文件: 无事务、崩溃半写、关系查询弱。
- Local PostgreSQL: Windows 安装成本高（需服务/权限），违背 P-8。

## Consequences

- 内容文件按版本目录/内容哈希组织 → 天然 git-friendly、可 diff、用户可读（P-2 不可变版本）。
- 关系/依赖/Stale 查询走 SQLite（含 WAL 事务，崩溃安全）。
- 备份 = 复制工作区目录 + SQLite 文件；云同步 = 内容文件同步 + 元数据合并（P-7）。
- 任务表持久化于 SQLite → 本地任务崩溃可恢复（ADR-0007）。
