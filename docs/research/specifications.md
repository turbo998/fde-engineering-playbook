# 规格驱动补充：Spec Kit 与 OpenSpec

两者仅作文档研究，不加入四组编码实验。检索日期 2026-09-29。固定 Spec Kit `8d3f64cdccc877b6a297bc8167131103bb5b8ca0`、OpenSpec `d4e1c77ebae0bd96a7c649fa35edef997989450a`。

## Spec Kit：从意图到实现，再检验未完成工作

README 将 toolkit 定义为给编码 Agent 的结构化过程、可复用模板和记录；SDD、bug fixing、idea assessment 是独立入口，不是三个必经阶段 [K1]。

SDD 的项目级 constitution 管理长期原则；每 feature 的 specify → plan → tasks → implement → converge 把行为需求和实现工作关联起来。规格先回答 what/why，技术计划再回答 how，不应把数据库表结构当作需求本身。

converge 模板以 spec、plan、tasks 为意图来源，检查当前代码状态，而不是 Git diff。它在 implement 之后运行，发现 missing、partial、contradicts、unrequested 等差距时，只向 tasks 尾部附加可追踪任务，禁止修改业务代码或重写已有任务；完全收敛时保持文件字节不变 [K2]。这能避免把勾选框当成实现证据，但评估仍依赖 Agent 正确阅读代码，不能替代执行验收。

对于 FDE，价值假设是长期保留需求到代码的追踪，并把“看似做完但缺失”的工作显式暴露。成本包括规格维护、反复收敛和上下文负担；不能只数输出文档。后端授权与模型运行预算并不由这些文档自动实现。

## OpenSpec：当前行为与在途变化分开

concepts 文档把 `specs` 作为当前行为来源，`changes` 保存拟议变更、设计、任务和增量。需求描述 what，scenario 描述可检验的 when/then；技术类名和实施步骤应放入 design/tasks，而不是行为规格 [O1]。

增量描述新增、修改和移除要求；与整份重写相比，变化范围更容易审查。这对已有供应商规则调整或审批规则演进有帮助。实际合并仍需处理语义冲突，不能因为文件分开就假定行为不冲突。

当前 core 工作流包括 explore、propose、apply、update、sync、archive；扩展 profile 才包含其他明确步骤。verify 可选，archive 不等于强制完成所有测试。文档区分 Agent archive 可能询问并允许跳过 sync，与 CLI archive 在验证后应用 delta 的路径 [O2]。因此“归档自动证明实现并无条件合并规格”是错误简化。

## 对比及方法组合边界

| 观察面 | Spec Kit | OpenSpec |
| --- | --- | --- |
| 主要组织单元 | 项目原则与 feature 的 spec/plan/tasks | 当前 capability spec 与独立 change |
| 闭环方式 | converge 暴露并附加未完成工作 | update/sync/archive 管理变化与现有规格 |
| 适用假设 | 新需求到实现需要严密追踪 | 存量系统的行为增量及多个变更需要清晰边界 |
| 不能保证 | 模型判断、实现正确、测试已运行 | 归档即验收、语义冲突自动消失 |

两者与 HVE/Superpowers/gstack 的焦点并不完全相同，可以研究组合价值，但当前实验不能临时加装组合包：否则“只改变一个方法包”的处理变量发生变化。公开模板保持原创，不复制上游命令文字或私有规格。

## 证据状态与来源

上述为实际文档/模板事实；适用假设是研究者解释；本项目没有两者的测量结果。两个主仓库 LICENSE 均为 MIT，外部参考内容仍遵守各自归属。

- [K1 Spec Kit README](https://github.com/github/spec-kit/blob/8d3f64cdccc877b6a297bc8167131103bb5b8ca0/README.md)
- [K2 converge 实际命令模板](https://github.com/github/spec-kit/blob/8d3f64cdccc877b6a297bc8167131103bb5b8ca0/templates/commands/converge.md)
- [O1 OpenSpec 概念、行为要求及 delta](https://github.com/Fission-AI/OpenSpec/blob/d4e1c77ebae0bd96a7c649fa35edef997989450a/docs/concepts.md)
- [O2 当前工作流与 archive 路径](https://github.com/Fission-AI/OpenSpec/blob/d4e1c77ebae0bd96a7c649fa35edef997989450a/docs/workflows.md)

*原创、AI 辅助研究；未经两者本机安装或实验验证。*
