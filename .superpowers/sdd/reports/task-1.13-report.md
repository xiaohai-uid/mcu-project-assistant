# Task 1.13 — 平台权限控制 报告

## Status: DONE

## 实现内容

### 1. `gateway/src/lib/platform-permissions.ts` — 新建平台权限库

- **`checkPlatformAccess(tier, platform)`** — 检查某 tier 是否允许某 platform
  - free/hasKey: 仅允许 arduino
  - subscription/pay-as-you-go: 全部允许
- **`getAllowedPlatforms(tier)`** — 返回某 tier 允许的平台列表

### 2. `gateway/src/app/api/projects/start/route.ts` — 集成平台校验

- 接受可选 `platform` 字段（默认 `"arduino"`）
- 在配额检查之前进行平台权限检查
- 无权限返回 403 `{ error: "Platform not allowed", allowedPlatforms: [...] }`

### 3. `gateway/__tests__/platform-permissions.test.ts` — 20 个测试

| 测试组 | 测试数 |
|--------|--------|
| checkPlatformAccess table-driven (4 tiers × 3 platforms) | 12 |
| getAllowedPlatforms per-tier returns correct lists | 4 |
| POST start route 403 on free+esp32 | 1 |
| POST start route 403 on hasKey+stm32 | 1 |
| POST start route passes subscription+stm32 | 1 |
| POST start route defaults to arduino for free | 1 |
| **合计** | **20** |

## 验收标准完成情况

1. ✅ `checkPlatformAccess` 函数区分 free/hasKey vs subscription/pay-as-you-go
2. ✅ `getAllowedPlatforms` 返回对应平台的列表
3. ✅ projects/start 接受 platform 参数，默认 arduino
4. ✅ 403 错误格式含 allowedPlatforms 提示
5. ✅ 20 个测试全部通过

## 变更文件

- **New:** `gateway/src/lib/platform-permissions.ts` (16 lines)
- **Modified:** `gateway/src/app/api/projects/start/route.ts` (+7/-1 lines)
- **New:** `gateway/__tests__/platform-permissions.test.ts` (151 lines)

## 测试结果

全部 68 tests passed (20 new + 48 existing). 无失败，无警告。
