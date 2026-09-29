# 实际交付状态

更新日期：2026-09-29。**当前离线阶段有可运行交付，端到端 benchmark 仍为 `not-run`，整体为 partial。** 下面没有模型成绩、四组候选或虚构调用记录。

## 完成、部分完成与阻塞范围

| 范围 | 状态 | 交付与边界 |
| --- | --- | --- |
| 中文匿名规格与研究 | completed（文档） | 场景、验收、架构、协议、3 个深研、2 个规格工具补充、对比、手册和 5 个原创模板 |
| 业务空白种子 | completed（离线） | React/Fastify/SQLite 可构建并真实启动；无领域状态机或候选方案 |
| 合同与合成服务 | completed（当前原语） | 严格 schema、版本资源、确定时钟/故障、持久尝试/效果、幂等与重启测试 |
| 外部评测与额度 | partial | 效果/来源原语、三次统计及持久准入；不是完整 12 族 oracle 或完整计费器 |
| 通用 episode 驱动/适配契约 | completed（离线协议） | known-good/bad HTTP 子进程、事件/审批/重启/故障/独立 oracle；非候选应用，无模型 |
| seed-only 导出/核验 | completed（制品边界） | 20 文件 + manifest、精简锁、可信 hash、穿越/链接拒绝、污染 canary；不等于 OS 沙箱 |
| 私有准备材料校验 | completed（schema/引用） | 只输出计数/hash/代码；12 个 case、0 个已执行 episode、35 个追加断言未覆盖 |
| 账本回归修复 | completed（离线） | 未结算 reservation 阻止新准入；snapshot 单一读事务；两项先复现再修复 |
| Copilot SDK 适配 | partial | 固定 SDK 类型映射、明确离线测试双、错误/用量/清理处理；live 入口硬性拒绝 |
| 账户元数据预检 | completed（无推理） | SDK 已登录及模型目录可见；Codex 只读认证状态已确认；详细目录不公开 |
| 方法安装/有效隔离 | blocked for measurement | 未安装方法包，未通过跨组访问 canary、进程隔离和全工具链核验；导出 canary 不能替代 |
| 编码组、应用推理、业务验收 | not-run | 精确模型、数值额度、批准、完整执行器与私有评测集成未就绪 |

## 实际执行验证

本机为 Windows、Node 24.13.1、npm 11.8.0。初次依赖安装使用 `npm install --ignore-scripts --no-audit --no-fund`；没有全局工具安装。

| 实际命令/入口 | 结果 | 所证明的范围 |
| --- | --- | --- |
| `npm run typecheck` | passed | 应用、合同、工具、脚本与测试的严格 TS 类型 |
| `npm run lint` | passed | ESLint，max-warnings=0 |
| `npm test` | passed：65 tests，0 failed/skipped | 9 个测试文件；原范围 + HTTP 驱动、导出边界、私有 schema、2 项账本回归 |
| `npm run build` | passed | tsc 服务端与 Vite React 产物 |
| `npm run smoke:offline` | passed | 真子进程、loopback HTTP、页面/JS 资产、SQLite 状态、推理403、业务路由404；随后停止进程 |
| `npm run check:public` | passed：69 个公开文本文件 | allowlist、个人路径/常见凭据模式、Markdown 相对链接 |
| `npm run preflight` | 诊断成功，manifestReady=false | 明确缺少配置/批准，不写入成绩 |
| `npm run benchmark` | 按预期 exit 1 | MANIFEST_REJECTED；没有运行编码组或模型 |
| `node --import tsx --test tests\episode.test.ts tests\seed-export.test.ts tests\private-fixtures.test.ts` | passed：16 tests | 本增量三类专用测试；随后又纳入完整 check |
| 两项 ledger 定向回归（修复前） | 如预期 2 failed | 不靠 sleep：孤儿 reservation 重开绕过；WAL 双连接在 SELECT 之间确定性提交导致撕裂快照 |
| 完整 `npm run check`（修复后） | passed | typecheck → lint → 65 tests → build → smoke → public scan；两项回归都通过 |
| `seed:export` / `seed:verify` | passed | 20 allowlist 文件 + manifest，可信 hash 核验；目标是工作树内忽略目录 |
| 导出副本：`npm ci --offline --ignore-scripts --no-audit --no-fund` | passed | 从本机缓存安装 208 个包，无模型/全局安装 |
| 导出副本：typecheck / lint / build / 外部 smoke | passed | 副本自己的依赖、React 资产、实际 Fastify 子进程、SQLite、推理403、业务404 |
| 私有只读校验 CLI | passed（schema/引用） | 24 资源、4 actors、12 cases、40 条文本步骤、35 未覆盖断言、0 已执行；errorCodes=[]，给定 SHA256 一致 |
| `git diff --check` | passed | 公开文本统一 LF 后无空白错误 |
| SDK 元数据脚本（不在 CI） | passed | 仅 auth/model metadata RPC，无 createSession/send，无推理 |

首阶段曾修复 SDK reasoning 类型与 smoke 可选资产路径的 typecheck 失败。本增量曾修复 SQLite 方法 mock 的重载类型，以及私有 CLI 因间接导入数据库而输出实验警告的问题：共享 schema 与数据库实现分离后，私有 CLI stderr 为空。普通 SQLite 测试/服务仍保留实验性警告，没有全局屏蔽。

测试数据仅为通用协议单元向量：`unit-*`、测试币种及测试小额限额不是已批准业务政策/实验预算；从未发送到模型。通过 65 项工具测试不能写成“12 个业务场景通过”，也不能证明生产可信身份、文本事实支持或浏览器用户路径已实测。私有材料仅经机器校验，未人工读取 golden、复制正文、执行自然语言或减少追加断言。

## 未做且不能冒充的工作

没有四组独立编码、真实推理 smoke、144 episodes、完整领域实现、已完成盲评、人工复核、生产身份、不可篡改审计或企业部署。本机通过不替代新提交的远端 CI 结果。CI 仅配置离线检查，不包含元数据查询或推理调用。

私有 holdout 与候选代码不在公开仓库；准备向量不等于执行结果。剩余不只是支出批准：仍需完整私有 typed 脚本和语义 oracle（审批/来源/action 关系绑定、时间/等价条件、文本支持、UI 路径）、冻结/封存/授权、OS/跨组隔离、原生方法依赖及每模型请求控制。精确编码/运行/评审模型与数值额度未选择，不能自动填入。具体剩余决定见 [预检](preflight.md)，实验限制见 [协议](protocol.md)。

公开检查是 allowlist、常见凭据/个人路径模式和 Markdown 相对链接的启发式检查，不是完整独立安全审计。原始错误日志、身份目录与数据库不发布。
