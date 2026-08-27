# Tasks 2.3–2.6 — RequirementService 报告

## Status: DONE

## 实现内容

### 2.3 — LLM 需求解析
- 增强 `build_prompt()` 含 JSON schema 约束
- `parse_llm_response()` 正则提取 JSON + 验证结构
- 解析失败时重试并返回错误消息

### 2.4 — 多轮追问
- `is_vague()` 检测模糊描述 (<15 字符或通用关键词)
- 模糊时发布到 `CLARIFICATION_REQUEST` 队列
- `handle_clarification_response()` 占位监听

### 2.5 — 语言检测
- `detect_language()` 基于中文字符比例检测 zh/en
- Prompt 根据语言自动适配

### 2.6 — 消息循环增强
- 手动 ACK (auto_ack=False)
- try/except 错误处理 + 日志
- 两个消费者: REQUIREMENT_INPUT + CLARIFICATION_RESPONSE

## 修改文件
- `services/requirement-service/main.py` — 重写
- `shared/rabbitmq/queues.py` — 新增 CLARIFICATION_REQUEST/RESPONSE
