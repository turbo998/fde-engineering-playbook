# FDE Engineering Playbook

以证据为基础的中文 AI 辅助工程研究：把匿名旅行运营需求变成可验收合同，比较工程方法，而不把宣传或测试替身当作模型成绩。

**当前状态：离线底座已实现，端到端实验 `not-run`。** 没有候选业务应用、实测编码组、真实推理结果或方法排名。精确模型及数值额度尚未获准。已有账户的 SDK 鉴权/模型目录元数据查询成功，但它不是推理验证。

## 内容导航

| 内容 | 入口 |
| --- | --- |
| 原创业务问题与验收 | [匿名场景](docs/scenario.md)、[验收映射](docs/acceptance.md) |
| 固定版本研究 | [HVE](docs/research/hve.md)、[Superpowers](docs/research/superpowers.md)、[gstack](docs/research/gstack.md)、[Spec Kit / OpenSpec](docs/research/specifications.md) |
| 方法比较与实践 | [对比](docs/comparison.md)、[FDE 手册](docs/fde-playbook.md) |
| 实验与能力边界 | [协议](docs/protocol.md)、[架构](docs/architecture.md)、[预检](docs/preflight.md)、[实际状态](docs/status.md) |
| 运行前质量/评审准备 | [中立量表与 receipt 契约](docs/quality-review.md)（draft、无评审执行或完整盲化证明） |
| 原创模板 | [发现](templates/discovery.md)、[计划](templates/plan.md)、[验收](templates/acceptance.md)、[交接](templates/handoff.md)、[评测](templates/evaluation.md) |

原定四组保持不变：baseline / HVE / Superpowers 是待验证的 Copilot 受控轨道；gstack + Codex 是原生观察轨道，不参与跨宿主方法增益排名。Spec Kit 与 OpenSpec 仅作补充文档研究。

## 本地启动

要求 Node.js **24.13.1–24.x** 与 npm。所有命令在仓库根目录运行；依赖固定在 lockfile，不安装全局方法包。

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm start
```

打开 `http://127.0.0.1:4317`。页面只显示真实的本地 API / SQLite 底座状态，没有预订、审批或供应商业务逻辑。SQLite 文件位于被忽略的 `.local` 目录，启动次数重启后保留。Node 24 的 `node:sqlite` 仍会输出实验性 API 警告；本项目不声称生产数据库适用性。

开发时可分别运行 `npm run dev:api` 与 `npm run dev:web`。`npm run smoke:offline` 会启动编译后的真实服务、读取页面及静态脚本、检查 API 和拒绝推理行为，然后停止该服务；不会调用模型。

## 离线验证与拒绝入口

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke:offline
npm run check:public
npm run preflight
npm run benchmark
```

最后一条**应以非零状态退出**：草稿不能授权实测。即使填满 manifest，当前执行器也仍拒绝 live，因为逐模型请求控制、操作系统隔离、私有候选集成和正式授权尚未完成。

`packages/lab` 提供模拟资源接口、持久效果账本、外部评估原语、额度准入原语和 SDK 协议映射。新增通用 HTTP episode 驱动只接收显式 `127.0.0.1:端口` 测试源，禁自动 redirect；候选适配器直接拒绝。公开 known-good/bad 子进程仅为 `offline-test-double`，用于证明事件、审批命令、重启、故障与独立 oracle 对接，不是四组应用或未公开留出场景。

独立 typed 语义 oracle 进一步核对 19 项业务规则、可信资源/身份/审批/人工事件、实际 read/effect 账本和 structured provenance，逐规则报告分母、严重性与不可用项，不评判任意 prose。v3 typed episode 用控制器专用步骤记录可信事件，服务端 SQLite 为其与效果尝试分配共同因果序号；冻结时钟相同不代表先后，缺少因果证据不能 passed。HTTP 接线仍仅允许离线测试双；私有准备、通用单元测试和完整 benchmark 是不同层次。

## 显式无推理宿主库存诊断

```powershell
# 私有输入文件包含绝对 Node/CLI/package 路径、固定版本及五个独立保存的 SHA256：
npm run host:inventory -- --inventory-only $env:FDE_HOST_TARGET
```

输入采用 `HostInventoryTarget`：`nodePath`、`entryPath`（package 内的 `index.js`）、`packageDirectory`、`expectedVersion`（仅支持 `1.0.95-3`），以及 `sha256` 的 `node` / `entry` / `package` / `cliMain` / `runtime`。路径和 pin 文件必须私有保存；不要通过 PATH/npm shim 自动选择宿主或把当前 hash 自动当成批准。诊断核对包与可执行身份、严格版本响应、最多 1 MiB 的已知 CLI JSON；每进程最多 30 秒，整体 CLI 阶段最多 90 秒。缺失/未知/失败保留 `null` 和静态代码，非零退出，不补造零或成功。

仅运行 version、instruction/skill/plugin/mcp list 和官方 synthetic skill disable；不创建模型 session、不发送请求、不调用候选。CLI home、profile、AppData、cache 和 temp 都指向工作树内独立临时目录，设置仅在那里改写，结束后删除该目录。库存验证只证明 baseline 的已启用集合为原 builtin 集合，synthetic treatment 恰好增加一个指定 workspace canary；不加载真实方法。receipt 只有固定标签、数量、hash 和验证标志，不含原路径、描述、环境或凭据。非空 plugin/MCP 等未支持的形状明确 unavailable，不自动放行。

**discovery 不是 activation 或隔离证明。** host 投影指令、hooks/memory、OS/网络/文件/跨组/holdout 隔离及真实方法加载仍未验证；native platform support 在此诊断中为 `null`，没有显式调用内部 sandbox support API 或运行沙箱 canary。该 lab 工具不进入中立种子，不填写模型、预算或批准字段。实际环境差异和剩余阻塞见[预检](docs/preflight.md)与[状态](docs/status.md)。

## 种子导出与私有准备材料校验

```powershell
New-Item -ItemType Directory -Force .local | Out-Null
npm run seed:export -- .local\neutral-seed
# 将上一条返回的 manifestHash 存入 $env:FDE_SEED_HASH，再独立核验：
npm run seed:verify -- .local\neutral-seed $env:FDE_SEED_HASH
# 私有文件只读校验；路径/hash 由外部提供，不写入仓库：
node --import tsx scripts\validate-private.ts $env:FDE_PRIVATE_FIXTURE $env:FDE_PRIVATE_FIXTURE_SHA256
# 另行编写的私有 v3 companion：全量步骤/断言映射、schema/script digests 与覆盖分类：
node --import tsx scripts\validate-semantic.ts $env:FDE_PRIVATE_FIXTURE $env:FDE_PRIVATE_COMPANION $env:FDE_PRIVATE_FIXTURE_SHA256
```

导出目标必须不存在、父目录必须已存在且无链接；导出 20 个明确 allowlist 文件及一份 hash manifest，重建精简 package/lock，不复制 `.git`、`node_modules`、`.local`、研究、方法配置、评测器或测试双。核验在安装依赖**之前**进行；使用独立保存的可信 hash，不能信任可同时篡改的目录内 manifest。它是制品边界，不是 OS 沙箱，也不能证明零全局规则。

私有校验器只输出数量、原始字节 SHA256、digests、覆盖类别及静态代码，不打印文件路径、标题、正文或 Zod 细节；非零退出表示校验失败。自然语言 `episode` 只作为数据，不 eval/exec、不转交模型。v1 源与既有 v2 材料不变，另行准备的 v3 有 12 cases / 77 typed 步骤，映射所有 40 源步骤和 35 追加断言，但仍为 `executedEpisodes=0`。机器规则存在不表示私有断言或候选已通过；自由文本、浏览器/人类质量及完整跨租户内容追踪仍需独立工作。详见[架构边界](docs/architecture.md)及[实际状态](docs/status.md)。

## 公开与共享边界

仅公开原创文档、业务空白代码、通用合成测试和清洗后的状态。原始材料、凭据、完整会话、隐藏推理、数据库、具体 holdout 与未冻结候选均不发布。`.gitignore` 和启发式扫描只是辅助措施，不是安全沙箱。

新创作内容采用 [MIT](LICENSE)。[第三方说明](THIRD_PARTY_NOTICES.md) 保留上游引用与许可区别；不打包上游方法库。本文及本仓库文档由 AI 辅助撰写，未声称已完成人工验收。
