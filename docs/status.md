# 实际交付状态

更新日期：2026-10-15。**当前离线阶段有可运行交付，端到端 benchmark 仍为 `not-run`，整体为 partial。** 下面没有模型成绩、四组候选或虚构调用记录。

## 完成、部分完成与阻塞范围

| 范围 | 状态 | 交付与边界 |
| --- | --- | --- |
| 中文匿名规格与研究 | completed（文档） | 场景、验收、架构、协议、3 个深研、2 个规格工具补充、对比、手册和 5 个原创模板 |
| 业务空白种子 | completed（离线） | React/Fastify/SQLite 可构建并真实启动；无领域状态机或候选方案 |
| 合同与合成服务 | completed（当前原语） | 严格 schema、版本资源、确定时钟/故障、持久尝试/效果、幂等与重启测试 |
| 外部评测与额度 | partial | 原语 + 19 项独立 typed 语义规则、三次统计及持久准入；不是完整自然语言/UI 业务验收或 SDK 内部计费控制 |
| 通用 episode 驱动/适配契约 | completed（离线协议） | known-good/bad HTTP 子进程、事件/审批/重启/故障/独立 oracle；非候选应用，无模型 |
| seed-only 导出/核验 | completed（制品边界） | 20 文件 + manifest、精简锁、可信 hash、穿越/链接拒绝、污染 canary；不等于 OS 沙箱 |
| 私有准备材料与 v3 companion | completed（离线准备） | v1/v2 不变；12 cases、40 源步骤映射 77 typed 步骤（新增 13 控制事件）、35 全量分类；0 已执行 episode |
| 账本回归修复 | completed（离线） | 未结算 reservation 阻止新准入；snapshot 单一读事务；两项先复现再修复 |
| Copilot SDK 适配 | partial | 固定 SDK 类型映射、明确离线测试双、错误/用量/清理处理；live 入口硬性拒绝 |
| 账户元数据预检 | completed（无推理） | SDK 已登录及模型目录可见；Codex 只读认证状态已确认；详细目录不公开 |
| 方法安装/有效隔离 | blocked for measurement | 未安装方法包，未通过跨组访问 canary、进程隔离和全工具链核验；导出 canary 不能替代 |
| 编码组、应用推理、业务验收 | not-run | 精确模型、数值额度、批准、完整执行器与私有评测集成未就绪 |
| 可复用宿主库存诊断 | completed（无推理 discovery） | 固定五文件身份 pin、严格清洗 receipt、disposable home、baseline 2/0 与 synthetic treatment 3/1；不证明 activation/隔离 |

## 2026-10-14 语义增量的实际验证

因果修正时 `npm run check` passed：严格类型、lint、**155 tests / 0 failed / 0 skipped**、服务端/React build、实际 loopback 子进程 smoke、82 个公开文本文件的扫描/相对链接核验。首次语义增量为 141 tests；随后因果顺序修正增加 14 tests：1 项实际 HTTP execute-before-grant 回归、8 项同钟有序 HTTP episode、3 项因果可用性/隔离/篡改检查、2 项 SQLite 重开/旧数据回归。没有执行任何私有 case 或模型调用。

| 验证对象 | 实际结果与边界 |
| --- | --- |
| 业务边界与权限 | 499/500/501 米、等级/房型/人数/容量；72 小时与 30 天闭区间；角色/actor/租户/case/action/plan/policy/facts/cost/currency/expiry/status；零成本仍需批准；路径 B 人工事件顺序 |
| 账本与恢复 | 非授权故障尝试、重复/孤立效果、错误 booked、审批历史/尝试审计、交接字段/版本/证据篡改、未知容量/营业端点、未受影响行程、单独支出、供给权限、未发送草稿、稀疏 typed 根因、真实 read/effect 次数与无成功 fallback |
| 因果顺序修正 | 真实 HTTP execute → grant 同钟回归修复前 1 failed（误报 passed），修复后 passed（正确 disqualified）；控制器事件与服务尝试共同序号；取消前后/重试/人工核实顺序及低引用序号的后发取消均验证；原确认不因后发取消失效 |
| 老数据库与重开 | 有 count 无 read 历史、旧效果/尝试无因果位置均保持 `null`；重开保留 read 行、可信位置和原效果；控制事件重放幂等/冲突拒绝；旧批准不复活权限；WAL 单读事务与未结算额度回归仍通过 |
| 私有 companion | 新 v3 源 SHA 相符；12 cases、40 源步骤、77 typed 步骤、35 分类、0 执行；schema/script/implementation hashes 刷新，全部资源/身份/政策/故障映射无错误；本地 authoring script 严格 typecheck passed；v1/v2 原文件保留 |
| 35 项覆盖分类 | 18 `implemented-machine-rule`、10 `prepared-unexecuted-integration`、6 `rubric-required`、1 `unsupported`；18 不表示私有断言已通过 |
| 干净 seed-only 副本 | 原 20 文件 + manifest、可信 hash verified；离线缓存安装 208 包；副本自身 typecheck/lint/build 与实际 Fastify/React/SQLite smoke passed；lab/oracle/goldens 不进入种子 |
| 执行闸门 | preflight 仍 `manifestReady=false`；benchmark 按预期 exit 1 / `MANIFEST_REJECTED`；两条 episode 入口均在任何候选调用/reset 前拒绝；live transport 的硬性拒绝保留 |
| main 维护内容 | 保留现有 redaction、贡献/安全政策和 Dependabot 配置；发布 allowlist 仅补入这三个既有文件，未放开整个 `.github`；回归证明其他 `.github` 制品仍拒绝 |

最初完整 check 在 main 已有的三个维护文件上暴露了旧 allowlist 的漂移，本增量修复后完整 check 已通过。准备 CLI 的一次 SQLite 间接导入回归也已修复：schema 与 HTTP runner 分离，两个私有 CLI 的成功/失败测试均要求 stderr 为空，不屏蔽全局 warning。普通 SQLite 服务保留实验警告。

原先仅按冻结时钟和审批历史序号授权的逻辑存在真实追认漏洞，141 tests 的历史通过不能证明它正确。当前 schema 明确升级（oracle v2、episode/companion v3），仅按实际服务因果账本核验审批/人工事件先后；缺失证据最多 partial，矛盾证据失败。控制器 marker 不是候选 claims 或 acknowledgment，未暴露为应用 HTTP 能力；prepared 的预期位置和 prior fixture 不是私有执行证明。服务重开测试真实关闭/重新打开 SQLite，语义 HTTP 的 restart 测试只调用适配器重启回调，不冒充私有应用进程重启。

独立语义报告只核验 typed 合同，逐规则列出 disposition、严重性和实际检查/失败/不可用分母，严重违规直接取消资格；恒列自由文本支持、真实体验预订、生产身份、不可篡改审计、浏览器/人类质量为未证明维度。完整跨租户响应内容追踪仍 unsupported。私有 companion 留在忽略的本地目录，不进入 Git、CI、编码组或模型上下文；脚本准备不是 benchmark 成绩。远端 exact-commit CI 必须另行从提交/PR 记录确认，不由本机通过推断。

## 2026-10-15 无推理库存增量

可复用 `host:inventory` 只运行固定宿主的 version/list 与官方 temporary canary disable，CLI JSON 严格解析、固定安全来源 count map、输出/时间有界，receipt 不含原始路径、说明、环境或凭据。五个后来观察的 Node/entry/package/CLI-main/runtime hash 在开始/结束核验，非 npm shim，不自动更新/安装。未显式调用内部 sandbox support API；字段为 `nativePlatformSupport=null`，未请求模型、候选、沙箱 canary 或全局配置操作。

本机实测 receipt 为 `observed` / inventory exclusivity `verified`：baseline **2 enabled / 0 nonbuiltin**，synthetic treatment **3 / 1**，零模型请求、零 errorCodes，temporary fixtures 全部 removed。比历史协调会话更严格的 AppData/temp/cache 重定向使 clean 初始只发现 2 builtins / 0 inherited；旧 36+2 仍是其原环境的有效观察，不作为新环境结论。个人 canary 在 `--no-custom-instructions` 下仍启用，official disable 及临时 disabledSkills 集合生效。此结果不证明 method activation、host 投影 instructions、hooks/memory、OS/网络/文件/cross-arm/holdout 分离。

新增 26 个离线测试覆盖实际 CLI double、未知/malformed instruction/skill/plugin/MCP、unsafe 来源键/缺失 enabled/重名、进程失败/超时/整体截止/输出超限、错误版本/可执行或 hash/运行中 drift、继承 persistence、无效 disable、额外/错路径 treatment、builtin 缺失、清洗 receipt/显式 opt-in、配置链接和清理链接替换。完整 `npm run check` passed：**181 tests / 0 failed / 0 skipped**、types/lint/build、真实离线 startup、86 个公开制品与相对链接扫描。测试只检查自身 fixture 清理，不以共享临时目录的全局数量判断，避免与其他安全 probe 竞争。精确提交 CI 证据另从最终提交/PR 确认；原语和合成库存测试仍不是四组或私有验收成绩。

## 2026-09-29 历史验证（非当前测试数量）

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

测试数据为原创合成单元向量：`unit-*`、测试币种及测试小额限额不是已批准业务政策/实验预算；从未发送到模型。历史 65/141/155 项或当前 181 项工具测试均不能写成“12 个业务场景通过”，也不能证明生产可信身份、任意文本事实支持或浏览器用户路径已实测。本增量 evaluator 开发者获准读取私有源来另行编写 companion；不复制正文到公开文件，不解释/执行自然语言，不删除断言。

## 未做且不能冒充的工作

没有四组独立编码、真实推理 smoke、144 episodes、完整领域实现、已完成盲评、人工复核、生产身份、不可篡改审计或企业部署。本机通过不替代新提交的远端 CI 结果。CI 仅配置离线检查，不包含元数据查询或推理调用。

私有 holdout 与候选代码不在公开仓库；准备向量不等于执行结果。剩余不只是支出批准：typed 脚本和机器语义规则已准备，但仍需私有候选/持久状态/浏览器集成、rubric/文本支持、完整跨租户内容追踪、冻结/封存/授权、OS/跨组隔离、原生方法依赖及每模型请求控制。精确编码/运行/评审模型与数值额度未选择，不能自动填入；本实现宿主模型的恢复选择不是实验批准。具体剩余决定见 [预检](preflight.md)，实验限制见 [协议](protocol.md)。

公开检查是 allowlist、常见凭据/个人路径模式和 Markdown 相对链接的启发式检查，不是完整独立安全审计。原始错误日志、身份目录与数据库不发布。
