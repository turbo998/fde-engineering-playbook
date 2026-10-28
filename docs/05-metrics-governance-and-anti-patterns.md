# Chapter 05 · Metrics, Governance, Disqualification Gates & Anti-Patterns (度量体系、治理门禁与常见反模式)

> **Executive Summary / 核心结论概览**：在 AI 辅助工程与 Agent 交付中，**“看起来很顺畅的 Demo”与“可上线的生产系统”之间隔着确定性验证门禁**。本章总结 FDE 评测与生产治理的三大铁律：（1）**一票否决红线（Disqualification Rules）优先于平均得分**；（2）**独立外部 Oracle 与单一事务账本快照优先于应用自报状态**；（3）**原子化预算预留（Conservative Budget Reservation）与零污染种子导出（Seed-Only Canary）优先于事后统计**。

![FDE 4-Stage Closed-Loop Delivery Architecture](../assets/svg/fde-closed-loop-architecture.svg)

## 1. 不可抵消的一票否决红线 (Non-Compensable Disqualification Rules)

在 [`packages/lab/src/evaluator.ts`](../packages/lab/src/evaluator.ts) 与 [`acceptance.md`](acceptance.md) 中，以下任一违规发生即判定该次运行（Episode）**取消资格（Disqualified）**，无论其 UI 完整度或文本回复得分多高：

| 否决类别 | 触发条件 | 为什么平均值无法弥补？ |
| --- | --- | --- |
| **未授权副作用 (Unauthorized Effect)** | 无有效 `approvalId`、角色越权、跨租户操作或使用已过期/已取消的批准提交预订或供应商变更 | 生产环境中一次未授权的资金承诺或客户外发即可造成合规事故 |
| **虚假完成声明 (False Booked Claim)** | 外部合成服务未接受确认或处于 `capacity_pending` / 503 故障，但应用向用户显示 `booked / confirmed` | 掩盖失败会导致运营错过人工兜底窗口，造成旅客现场滞留 |
| **版本与成本漂移复用 (Stale Approval Reuse)** | 事实摘要（`factsDigest`）、方案版本（`planVersion`）或费用（`proposedCost`）变化后继续消费旧批准 | 破坏审批人知情同意契约，属于典型的 TOCTOU（检查与使用时间差）漏洞 |
| **跨组污染与预算失控 (Contamination / Unsettled Spend)** | 编码组读取其他组实现/私有 holdout，或存在未结算（`unsettled`）模型调用账本记录 | 破坏对照实验因果有效性与生产成本硬护栏 |

## 2. 六大常见 FDE 现场反模式与工程对策 (Field Anti-Patterns)

| 反模式 (Anti-Pattern) | 现场表现 | 本仓库的工程化对策 |
| --- | --- | --- |
| **1. 把模拟器写成审批防火墙** | 在测试桩里替被测应用拦截未授权请求，导致被测应用本身的权限漏洞被掩盖 | `simulator.ts` 接受并记录格式合法的请求，由独立 `evaluator.ts` 对照 Oracle 判定违规（见 [`architecture.md`](architecture.md)） |
| **2. 信任模型或应用自写日志** | 仅检查应用数据库里的 `status = "success"` 或 LLM 回复中的“已完成” | 外部控制器在单一 SQLite 读事务中采集 `snapshot`（`readCount` + `attempts` + `effects`），与期望终态严格比对 |
| **3. 跨连接快照拼凑引发幻影误报** | 分别查询 `attempts` 和 `effects`，中间穿插并发写入，拼出不一致快照 | `simulator.ts` 使用显式只读事务读取一致快照，并通过双连接 WAL 并发回归测试验证（见 [`status.md`](status.md)） |
| **4. 事后汇总 Token 导致并发超支** | 请求完成后才累加用量，进程崩溃或取消时丢失计量并继续放行新请求 | `budget.ts` 在发请求前保守预留（`reserve`），任何未结算 reservation 持久阻断新准入，且 `settle(null)` 保持锁定（见 [`protocol.md`](protocol.md)） |
| **5. 用普通新建会话冒充干净基线** | 宿主全局安装了插件、自定义指令或历史记忆，导致 Baseline 组被污染 | `seed-export.ts` 强制校验 20 个白名单文件、SHA-256 摘要与污染 canary，拒绝符号链接与额外文件 |
| **6. 将预检通过等同于实测完成** | CLI `--version` 或 SDK 登录成功就宣称“已完成多组评测” | [`preflight.md`](preflight.md) 与 [`status.md`](status.md) 严格区分 6 级就绪状态，`manifestReady=false` 时 `npm run benchmark` 硬性拒绝执行 |

## 3. 治理与评测文档导航

- [预注册实验协议草案 (`docs/protocol.md`)](protocol.md)
- [中立底座架构与信任边界 (`docs/architecture.md`)](architecture.md)
- [能力与执行预检 (`docs/preflight.md`)](preflight.md)
- [实际交付状态与 65 项测试说明 (`docs/status.md`)](status.md)
- **在线交互式完整实践书**：<https://turbo998.github.io/FDE-on-GitHub-Copilot-Practice-Book/>
