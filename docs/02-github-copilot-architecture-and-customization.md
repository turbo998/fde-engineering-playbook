# Chapter 02 · GitHub Copilot Architecture, Harnesses & Customization (GitHub Copilot 架构、工程方法包与上下文定制)

> **Executive Summary / 核心结论概览**：在 FDE 高强度交付中，决定交付质量的往往不是底层大模型微小的分数差异，而是 **宿主管线（Copilot CLI / SDK / Coding Agent）之上的上下文工程与工作流约束（Harness Engineering）**。本章拆解指令分层（Repository Instructions / Path-Scoped Instructions / Progressive `SKILL.md`）、子代理上下文隔离，以及三大主流工程方法包（**HVE Core**、**Superpowers**、**gstack**）与规格驱动工具（**Spec Kit**、**OpenSpec**）的架构机制与适用边界。

![FDE 4-Stage Closed-Loop Delivery Architecture](../assets/svg/fde-closed-loop-architecture.svg)

## 1. 宿主、工程方法包与业务应用的三层解耦

在企业现场部署 AI 辅助工程时，必须严格区分以下三个正交层次（详见 [`comparison.md`](comparison.md)）：

| 层次 | 核心职责 | 本仓库对应实现与研究对象 |
| --- | --- | --- |
| **Layer 1 · 开发宿主与运行时** | 模型会话生命周期、工具调用权限、MCP 路由、Token 账本计量 | GitHub Copilot CLI / `@github/copilot-sdk`（见 [`packages/lab/src/model.ts`](../packages/lab/src/model.ts)） |
| **Layer 2 · 工程方法包 (Harness)** | 约束需求澄清、RPI 阶段流转、TDD 验证、多角色代码审查 | [HVE Core](research/hve.md)、[Superpowers](research/superpowers.md)、[gstack](research/gstack.md)、[Spec Kit / OpenSpec](research/specifications.md) |
| **Layer 3 · 被交付的业务系统** | 领域状态机、审批权限校验、幂等副作用与审计追踪 | 匿名旅行运营种子应用 [`apps/seed`](../apps/seed/src/server.ts) 与合同 [`packages/contracts`](../packages/contracts/src/index.ts) |

## 2. 上下文工程与渐进式技能披露 (Progressive Context Disclosure)

1. **仓库级红线（Always-On Invariants）**：仅将全局构建/测试命令、安全禁令（禁止越权副作用、禁止硬编码路径/密钥）与核心目录映射放在顶层常驻说明中，控制常驻 Token 预算。
2. **路径级规则（Path-Scoped Rules）**：针对合同层（`packages/contracts`）、评测层（`packages/lab`）和前端（`apps/seed`）按路径按需注入校验约束。
3. **按阶段渐进式加载（Stage-Scoped Skills & RPI）**：
   - **HVE Core**：强调先盘点组织既有证据，按缺口进入 `Research → Plan → Implement → Review`，把决策依据、验证证据与遗留项（Follow-ups）结构化串联（详见 [`research/hve.md`](research/hve.md)）。
   - **Superpowers**：通过可组合技能强制抑制模型“未澄清即写代码、未运行验证即宣称完成”的冲动（详见 [`research/superpowers.md`](research/superpowers.md)）。
   - **gstack**：引入产品、架构、QA 与真实浏览器验收角色化流水线（详见 [`research/gstack.md`](research/gstack.md)）。

## 3. 深度研究索引

- [AI 辅助工程方法对比总表 (`docs/comparison.md`)](comparison.md)
- [HVE Core 深度解析 (`docs/research/hve.md`)](research/hve.md)
- [Superpowers 深度解析 (`docs/research/superpowers.md`)](research/superpowers.md)
- [gstack 深度解析 (`docs/research/gstack.md`)](research/gstack.md)
- [Spec Kit / OpenSpec 规格与变更工作流 (`docs/research/specifications.md`)](research/specifications.md)
- **在线交互式完整实践书**：<https://turbo998.github.io/FDE-on-GitHub-Copilot-Practice-Book/>
