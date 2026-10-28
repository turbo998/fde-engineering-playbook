# Chapter 03 · End-to-End FDE Delivery Playbooks (端到端 FDE 现场交付标准作业程序)

> **Executive Summary / 核心结论概览**：本章提供可直接用于客户现场的 **6 步端到端 FDE 标准作业程序（SOP）** 与 **5 份标准化交付工件模板**。通过将“需求澄清 → 动作风险分级 → 契约与状态分离 → 幂等与故障注入 → 审计证据映射 → 确定性交接”制度化，FDE 能够在引入 AI 生成加速的同时，确保所有不可逆业务动作 100% 处于受控审批与版本绑定之下。

![FDE 4-Stage Closed-Loop Delivery Architecture](../assets/svg/fde-closed-loop-architecture.svg)

## 1. 六步现场交付标准作业程序 (6-Step Field Delivery SOP)

| 步骤 | 阶段目标 | 关键工程动作 | 配套模板与代码约束 |
| --- | --- | --- | --- |
| **Step 1 · 业务时刻定义** | 剥离情绪化描述与预设方案 | 区分可观察信号（如“缺失酒店重确认”）与待验证推论（如“一定无法入住”）；将未知客户政策列为显式升级项 | [`templates/discovery.md`](../templates/discovery.md) |
| **Step 2 · 行动与权限分级** | 在写 Prompt 前划定安全边界 | 明确只读（Read）、草稿（Draft）、审批（Approval）与执行（Effect）边界；模拟环境物理移除真实外发器 | [`templates/plan.md`](../templates/plan.md) |
| **Step 3 · 事实/建议/决定三态建模** | 防止自然语言状态混淆 | 用严格 Schema 分别持久化事实（含证据 ID 与版本）、模型建议与人工批准决定 | [`packages/contracts/src/index.ts`](../packages/contracts/src/index.ts) |
| **Step 4 · 审批绑定与幂等执行** | 阻断重放、越权与陈旧批准 | 批准记录强绑定 `planVersion`、`policyVersion`、`proposedCost` 与 `factsDigest`；跨租户隔离幂等键 | [`packages/lab/src/simulator.ts`](../packages/lab/src/simulator.ts) |
| **Step 5 · 验收情景与红线冻结** | 建立不依赖模型自评的验收门 | 编写 Given / When / Then 验收矩阵（`S01–S12`）与一票否决项（Disqualification Rules） | [`templates/acceptance.md`](../templates/acceptance.md) · [`acceptance.md`](acceptance.md) |
| **Step 6 · 跨模块结构化交接** | 消除多 Agent 链路信息退化 | 仅交接已批准且实际确认的事实、未决风险与审计引用，禁止下游将未批准建议当既成事实 | [`templates/handoff.md`](../templates/handoff.md) · [`templates/evaluation.md`](../templates/evaluation.md) |

## 2. 配套手册与在线交互式实践书

- **完整现场手册**：[FDE 工程实践手册 (`docs/fde-playbook.md`)](fde-playbook.md)
- **在线交互式完整实践书**：<https://turbo998.github.io/FDE-on-GitHub-Copilot-Practice-Book/>
