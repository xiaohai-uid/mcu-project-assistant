## Why

单片机开发入门门槛高，用户需要自己选配件、查资料、写代码，耗费大量时间。本项目将 AI 能力引入单片机开发流程，用户只需描述想法，系统自动推荐配件并生成代码+接线图，大幅降低开发门槛。

## What Changes

- 创建一个 Web 服务，用户通过界面描述单片机项目想法
- 系统根据描述自动分析功能需求，推荐合适的单片机平台（Arduino/ESP32/STM32）
- 内置常用配件数据库 + AI 知识补充，根据需求、兼容性、成本推荐配件清单
- 支持多档位推荐（丐版/标准/旗舰版），用户可按预算选择
- 根据最终方案自动生成完整工程代码（含注释、引脚定义、核心逻辑）
- 生成接线示意图/电路图
- 提供项目导出功能（代码打包下载）

## Capabilities

### New Capabilities
- `idea-input`: 用户描述项目想法，系统通过 AI 解析功能需求、技术约束和使用场景
- `component-recommendation`: 基于需求分析 + 内置配件库 + AI 知识，自动推荐兼容配件，支持多档位成本方案
- `code-generation`: 根据选定的硬件方案，自动生成对应平台的完整单片机代码
- `schematic-generation`: 根据硬件连接方案，生成接线示意图和引脚映射说明
- `project-export`: 将生成的项目代码、接线图、配件清单打包导出

### Modified Capabilities
<!-- No existing capabilities to modify -->

## Impact

- 前端 Next.js + Gateway 编排层（Node.js），4 个 Python AI 微服务
- 引入 RabbitMQ 作为异步消息总线（docker-compose 部署）
- 共享 Postgres 存储 DesignDraft 状态和结果
- 每个微服务携带 SQLite 组件数据库（只读）
- 需要集成 AI API（如 OpenAI/Claude）进行需求分析和代码生成
- 需要代码模板引擎支持多平台代码生成
- 需要实现轮询机制和 DesignDraft 自动失效重算逻辑
