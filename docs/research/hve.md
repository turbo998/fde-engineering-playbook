# HVE 深入研究：证据连续性与组织约束

检索日期：2026-09-29。固定快照：`microsoft/hve-core@180c85492b5a20380927200ddf926fd712e7d9d1`。本文是源码/文档研究，不是安装或效果实测。

## 定位与证据分层

| 类型 | 核验内容 | 不能推出的结论 |
| --- | --- | --- |
| 上游主张 | README 将核心价值放在上下文、治理、组织知识复用及一致工程实践 [H1] | 本任务质量已提升、已获得生产认证 |
| 源码事实 | 分别提供 agents、prompts、instructions、skills；README 有 Copilot CLI plugin 安装入口 [H1] | 本机已加载成功，所有宿主行为一致 |
| 文档事实 | RPI 先判断 research readiness，已有证据足够可复用；Review 可选 [H2] | 任意任务必须完整走一条固定自动流水线 |
| 技能事实 | implement 按批准 scope 工作，完成勾选以实际证据为前提；变更分类后只暂停相关依赖 [H3] | 已执行命令一定成功或业务规则由框架保障 |
| 研究解释 | 稳定任务标识和证据路由可能改善多阶段交接 | 这是待验证机制，不是观测结果 |

## 工作机制

HVE 不等于一个大系统提示词。instructions 约束适用文件的工程惯例，skills 提供可复用任务能力，agent 是选择工作入口的组织方式，prompt 提供固定触发面。团队采用时应记录实际加载集，而不只写“用了 HVE”。

当前 RPI 文档区分 Research、Plan、Implement、Review、Follow-up，但不要求每次全部执行。关键变化是**证据是否充分**而非“任务文件多，所以必须再研究一次”。Research 是只读调查；Plan 把证据变为依赖与验收；Implement 记录实际变更与验证；Review 比较需求和结果；Follow-up 把缺陷、决策缺口、证据缺口及残余工作路由到不同责任。

计划使用稳定的 Pxx / Pxx-Txx 任务标识，任务具备 Goals、Requirements、Details、References、Dependencies。默认有计划 critique，但明确允许跳过；当前 implement 技能也说明缺失或跳过 critique 本身不必阻塞。存在未解决阻塞或不准备就绪的计划时，才按 scope 和既有授权处理。不能把旧版教程的强制 worker 链当成此快照定义。

Review 把执行状态 Complete/Partial/Blocked 与接受结论分开。这个区别适合 FDE：基础设施做完不代表业务验收通过，实验工具完成也不代表实验已运行。HVE 的当前说明本身提醒快速演进、可能不兼容，应作为模式来源而非稳定生产依赖 [H1]。

## 对匿名业务的潜在适配

UC03 的审批要求容易在长会话中被简化为“显示确认框”。结构化计划可以把可信身份、绑定版本、失效、持久化及重放分别追踪；Review 可以要求相应证据，而非仅看页面完成。这是方法层面的帮助，后端授权仍必须由该组独立实现。

UC04 的交接需要已确认事实与来源；HVE 的持久证据思路可用于工程上下文交接，但不能直接移植为业务实现。共享模板应只规定输入/输出和验收，不为 HVE 组预先写好业务状态机，否则比较被污染。

对小任务，过多文档和反复调查可能增加成本。当前 readiness 和最小入口原则试图控制这一负担；本实验应记录有没有真实复用证据、上下文消耗与人工澄清次数，不能只统计产出文档数量。

## 采用与实验风险

| 风险 | 预检或观测 |
| --- | --- |
| 全局 HVE 规则泄漏到 baseline | 干净状态、有效加载清单、无害 canary；普通 worktree 不足 |
| 引用的规范被误当作实际合规 | 区分指导、实现证据与正式评审，不能把文字声明当认证 |
| 快照漂移 | 固定 package revision、宿主版本和激活记录 |
| 多阶段证据过时 | 记录需求/计划版本与实际验证时间，不沿用先前成功 |
| 自动化掩盖人类判断缺失 | 批准、复核及残余风险的责任人明确；不得伪造人类签字 |

未来受控组只改变方法包，宿主、模型、工具、业务任务和运行评测保持一致。应记录实际使用的 RPI 入口、研究复用/跳过理由、计划变更、人工干预、首个可运行版本和最终版本，而不是从方法名称推定遵循情况。

## 局限与许可

没有安装 HVE、没有启动此组编码，也没有验证本机 plugin 隔离。源码行为与模型遵循能力是不同问题。本研究不能判断 HVE 是否更快、更便宜或更准确。

主体 MIT 不代表所有内容同许可。README 与 THIRD-PARTY-NOTICES 明确某些 OWASP 衍生技能为 CC BY-SA 4.0；其他外部标准和文档有独立权利归属 [H4]。本仓库只引用来源和原创分析，不复制知识包。

## 固定来源

- [H1 README 与生命周期警告](https://github.com/microsoft/hve-core/blob/180c85492b5a20380927200ddf926fd712e7d9d1/README.md)
- [H2 当前 RPI 生命周期](https://github.com/microsoft/hve-core/blob/180c85492b5a20380927200ddf926fd712e7d9d1/docs/rpi/README.md)
- [H3 实际 rpi-implement 技能](https://github.com/microsoft/hve-core/blob/180c85492b5a20380927200ddf926fd712e7d9d1/.github/skills/rpi/rpi-implement/SKILL.md)
- [H4 第三方声明](https://github.com/microsoft/hve-core/blob/180c85492b5a20380927200ddf926fd712e7d9d1/THIRD-PARTY-NOTICES)

*原创、AI 辅助研究；结论未经业务实验或独立人工评审确认。*
