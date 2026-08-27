# Tasks 1.22–1.24 — ProjectTemplate 报告

## Status: DONE

## 实现内容

### 1.22 — Template 数据模型 API
- `GET /api/templates` — 返回所有公开模板 (id, title, description, tags, platform, experienceLevel)
- 公共接口，无需认证

### 1.23 — 8 个预制模板
- `scripts/seed-templates.ts` — 种子脚本
- 模板列表: 数字温度计, 智能灯控, 门禁系统, 循迹小车, 超声波测距仪, 蓝牙遥控车, 智能浇花系统, 环境监测站
- 含中文标题和描述，平台有 Arduino 和 ESP32

### 1.24 — 模板浏览
- GET /api/templates 查询 `project_templates` 表 `is_public=true`

## 新增文件
- `gateway/src/app/api/templates/route.ts`
- `gateway/scripts/seed-templates.ts`
- `gateway/__tests__/templates.test.ts` — 3 tests

## 验收标准
1. ✅ GET /api/templates 列出模板
2. ✅ 8 个种子模板 (seed script)
3. ✅ 3 tests, 总计 **125 tests passed**
