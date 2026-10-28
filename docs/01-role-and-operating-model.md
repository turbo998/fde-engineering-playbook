# Chapter 01 · FDE Role & Closed-Loop Operating Model (FDE 角色定义与四阶段闭环运行模型)

> **Executive Summary / 核心结论概览**：前场部署工程师（Forward Deployed Engineer, FDE）的核心职责不是堆砌通用 Agent 框架，而是在 **2–4 周的客户试点窗口内** 将高摩擦、模糊的真实业务痛点转化为**可验证、有契约约束、带确定性验收门禁的生产闭环交付**。本章定义 FDE 的 4 阶段闭环架构（前场发现与价值锚定 → 契约优先的 RPI 规格 → 多代理上下文工程 → 确定性评测与生产遥测门禁），以及 FDE 与传统售前（Solution Architect）和平台研发（Core Product SWE）的职责边界。

![FDE 4-Stage Closed-Loop Delivery Architecture](../assets/svg/fde-closed-loop-architecture.svg)

*配图说明：FDE 四阶段闭环交付架构。从 Stage 01 业务痛点与行动边界切入，经 Stage 02 严格 Zod 契约与 RPI（Research → Plan → Implement）规格冻结、Stage 03 多代理并行实现，最终由 Stage 04 确定性 SQLite 模拟器与独立外部 Oracle 完成门禁验收，并将违规信号反馈至契约层。*

## 1. FDE 与传统工程角色的本质差异 (Role Positioning)

| 维度 | 传统售前 / PoC 工程师 | 平台产品工程师 (Core SWE) | 前场部署工程师 (FDE on GitHub Copilot) |
| --- | --- | --- | --- |
| **核心交付物** | 演示 Slide / Happy-Path 剧本 Demo | 通用平台特性与长期抽象组件 | **嵌入客户真实数据流与审批流的生产级最小闭环系统** |
| **交付周期** | 1–3 天演练展示 | 季度 / 半年版本迭代 | **2–4 周完成从痛点锚定到可审计上线（Funded Pilot）** |
| **面对模糊性的方式** | 绕开异常边界、仅演示理想路径 | 等待产品经理冻结 PRD | **现场拆解事实（Facts）与假设（Hypotheses），将未知政策显式建模为升级项** |
| **验收标准** | 干系人主观印象 | 单元测试与吞吐指标 | **业务契约一致性 + 零越权副作用 + 独立 Oracle 可重复验收（`S01–S12`）** |

## 2. 四阶段闭环交付模型 (4-Stage Closed-Loop Operating Model)

1. **Stage 01 · Forward Discovery & Value Anchoring（前场发现与价值锚定）**
   - 在编写任何 Prompt 或 Agent 之前，先用 [`../templates/discovery.md`](../templates/discovery.md) 将模糊诉求收束为可观察的业务时刻（Observable Business Moment）。
   - 明确划清**只读查询、草稿生成、人工审批、受控执行**四类动作边界。
2. **Stage 02 · Contract-First Specification — RPI（契约优先规格：Research → Plan → Implement）**
   - 拒绝“对话即需求”。在代码实现前先冻结 [`packages/contracts`](../packages/contracts/src/index.ts) 中的 Zod 严格模式与 [`acceptance.md`](acceptance.md) 中的 `S01–S12` 验收矩阵。
   - 每一项高风险变更必须绑定 `actor / tenant / action / case / planVersion / policyVersion / proposedCost / factsDigest`。
3. **Stage 03 · Multi-Agent Parallel Execution & Context Engineering（多代理协同与上下文工程）**
   - 按职责隔离研究（Research）、规划（Plan）、实现（Implement）与挑战者审查（Challenger Review），避免单一长会话上下文漂移。
   - 详见 [Chapter 02 · GitHub Copilot 架构与方法包定制](02-github-copilot-architecture-and-customization.md) 与 [AI 辅助工程方法对比](comparison.md)。
4. **Stage 04 · Deterministic Verification Harness & Production Telemetry Gate（确定性验证与生产遥测门禁）**
   - 永远不信任应用或模型自报的 `booked / confirmed` 状态；通过独立模拟器与外部 Oracle 校验真实账本副作用。
   - 详见 [Chapter 05 · 度量、治理与反模式](05-metrics-governance-and-anti-patterns.md) 与 [中立底座架构与信任边界](architecture.md)。

## 3. 本仓库配套文档与在线交互式实践书导航

- **在线交互式完整实践书（Full Interactive Practice Book）**：<https://turbo998.github.io/FDE-on-GitHub-Copilot-Practice-Book/>
- **本仓库实操指南与模板**：
  - [FDE 工程实践手册 (`docs/fde-playbook.md`)](fde-playbook.md)
  - [发现与问题定义模板 (`templates/discovery.md`)](../templates/discovery.md)
  - [实现与边界计划模板 (`templates/plan.md`)](../templates/plan.md)
