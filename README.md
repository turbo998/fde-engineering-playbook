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

最后一条**应以非零状态退出**：草稿不能授权实测。即使填满 manifest，当前执行器也仍拒绝 live，因为逐模型请求控制、操作系统隔离、私有脚本和正式授权尚未完成。

`packages/lab` 提供模拟资源接口、持久效果账本、外部评估原语、额度准入原语和 SDK 协议映射。新增通用 HTTP episode 驱动只接收显式 `127.0.0.1:端口` 测试源，禁自动 redirect；候选适配器直接拒绝。公开 known-good/bad 子进程仅为 `offline-test-double`，用于证明事件、审批命令、重启、故障与独立 oracle 对接，不是四组应用或未公开留出场景。

## 种子导出与私有准备材料校验

```powershell
New-Item -ItemType Directory -Force .local | Out-Null
npm run seed:export -- .local\neutral-seed
# 将上一条返回的 manifestHash 存入 $env:FDE_SEED_HASH，再独立核验：
npm run seed:verify -- .local\neutral-seed $env:FDE_SEED_HASH
# 私有文件只读校验；路径/hash 由外部提供，不写入仓库：
node --import tsx scripts\validate-private.ts $env:FDE_PRIVATE_FIXTURE $env:FDE_PRIVATE_FIXTURE_SHA256
```

导出目标必须不存在、父目录必须已存在且无链接；导出 20 个明确 allowlist 文件及一份 hash manifest，重建精简 package/lock，不复制 `.git`、`node_modules`、`.local`、研究、方法配置、评测器或测试双。核验在安装依赖**之前**进行；使用独立保存的可信 hash，不能信任可同时篡改的目录内 manifest。它是制品边界，不是 OS 沙箱，也不能证明零全局规则。

私有校验器只输出数量、原始字节 SHA256 与静态错误/覆盖代码，不打印文件路径、标题、正文或 Zod 细节；非零退出表示校验失败。自然语言 `episode` 只作为数据，不 eval/exec、不转交模型。schema/引用通过仍表示 `executedEpisodes=0`；`additionalAssertions`、业务审批绑定与语义事实支持均未因此通过。详见[架构边界](docs/architecture.md)及[实际状态](docs/status.md)。

## 公开与共享边界

仅公开原创文档、业务空白代码、通用合成测试和清洗后的状态。原始材料、凭据、完整会话、隐藏推理、数据库、具体 holdout 与未冻结候选均不发布。`.gitignore` 和启发式扫描只是辅助措施，不是安全沙箱。

新创作内容采用 [MIT](LICENSE)。[第三方说明](THIRD_PARTY_NOTICES.md) 保留上游引用与许可区别；不打包上游方法库。本文及本仓库文档由 AI 辅助撰写，未声称已完成人工验收。
