# 升级演练取证：备份 → 数据销毁 → 恢复 → 新版本重启（issues/12 更新路径切片）

- 日期：2026-08-23
- 结论：**通过**。恢复后项目状态与升级前快照 `diff` 字节级一致；全程未触碰真实用户数据（全部在 `/tmp/mcu-upgrade-rehearsal` 隔离环境）。

## 环境

- 被测产物：`dist/server/server.js`（vite ssr 构建，含本轮 version 注入；`/healthz` 返回 `{status:"ok",version:"0.1.0"}`）。
- 存储：`MCU_DB_PATH=/tmp/mcu-upgrade-rehearsal/data/app.sqlite`，`MCU_WORKSPACE_DIR=/tmp/mcu-upgrade-rehearsal/workspace`。
- 服务配置：`MCU_PUBLIC_MODE=true` + Basic Auth + `MCU_DEVICE_PROVIDER=companion` + zhipu provider 显式哑键配置（演练不触发任何 AI 调用；仅满足生产的 fail-closed 启动校验）。注意：生产启动要求 AI provider / 设备 provider 显式声明，隐式回退一律拒绝——本演练同时验证了该启动契约。
- 端口 3787（避开另一窗口占用的 3000 实例）。

## 步骤与输出

1. **v1 写入状态**
   - `POST /api/v1/projects {"name":"Upgrade Rehearsal"}` → `201`
     `{"id":"0b0b81f6-2d3c-4be6-a0a6-92c7bc6b66a3","name":"Upgrade Rehearsal","createdAt":"2026-08-23T06:46:23.546Z",...}`
   - `GET /api/v1/projects` 快照存为 `pre-upgrade-projects.json`；落盘证据：`data/app.sqlite(+wal/shm/lock)`、`workspace/upgrade-rehearsal-0b0b81f6/project.json`。
2. **备份**：`npm run backup -- --db … --workspace … --output …/backups/rehearsal-01`
   - 产物：`database.sqlite` + `workspace/` + `manifest.json` + `BACKUP_COMPLETE` 哨兵。
   - manifest 关键字段：`formatVersion:1`、`application.version:"0.1.0"`、`schemaVersion:14`、db `sha256=6b4f60d5…c839 (200704B)`、workspace 文件逐个 `sha256`（project.json `53e07bdb…6653, authoritative:false`）。
   - 过程校验：在线 SQLite backup → 快照库 schema 校验 → 引用工件内容核验 → workspace manifest 哈希核对，任一不符即失败。
3. **破坏性清除**：`rm -rf data workspace` → 复核两目录均不存在。
4. **恢复**：`npm run restore -- --backup …/rehearsal-01 --db … --workspace …`
   - 输出：`{"projectCount":1,"artifactCount":0,"versionCount":0}`，db 与 workspace 文件全部重建。
5. **新版本重启验证**：同一 dist 以原数据路径重启（模拟"替换应用目录、保留数据目录"的升级语义）
   - `/healthz` → `{"status":"ok","version":"0.1.0"}`
   - `GET /api/v1/projects` 存为 `post-restore-projects.json`；`diff pre post` → **identical**（字节级一致，含 id/createdAt）。

## 对 issues/12 的意义

- 升级路径的安全语义已被实证：升级操作 = 备份 → 替换应用目录 → 重启；数据丢失场景下 restore 可完整重建并保持状态一致。
- D4（更新机制）无论最终选何种分发形态，此演练即可作为发布前必跑的回归步骤固化进打包脚本。
- 后续真实版本升级时重跑本演练（版本号递增后 diff 应仍 identical），作为 audit evidence 追加日期小节。
