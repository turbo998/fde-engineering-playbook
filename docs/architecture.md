# 中立底座架构与信任边界

## 当前已实现的组件

| 路径 | 职责 | 不承担的职责 |
| --- | --- | --- |
| `apps/seed` | React 状态页、Fastify 健康/状态 API、SQLite 启动元数据 | 业务 Agent、审批 UI、状态机、预订服务 |
| `packages/contracts` | Zod 严格模式与类型：资源、金额、审批绑定、交接、效果请求 | 匹配替代、判断风险、批准行动 |
| `packages/lab/src/simulator.ts` | 固定时钟、版本化合成资源、确定故障、持久尝试/效果、租户级幂等 | 应用授权、真实酒店接口、外发 |
| `simulator-server.ts` | 资源读取与合成效果 HTTP 合同 | 身份提供者、公共互联网服务、reset 管理 API |
| `evaluator.ts` | 独立 oracle 输入、效果与声明核对、取消资格、三次统计 | 全业务评分、模型裁判或自动生成正确答案 |
| `episode.ts` / `contracts/src/test-adapter.ts` | 严格 typed 步骤、loopback HTTP 测试 API、外部重启回调、独立原语评价 | 候选执行入口、任意 URL 连接、自然语言脚本解释器 |
| `seed-export.ts` | 固定文件 allowlist、精简依赖锁、可信 hash/精确目录核验 | OS 沙箱、文件系统并发攻击防护、零全局污染证明 |
| `private-fixtures.ts` / `dataset.ts` | 无数据库副作用的准备材料 schema/引用核验、共享模拟数据 schema | 业务 oracle 完备性、执行 holdout、解释追加断言 |
| `model.ts` | 与固定 SDK 类型匹配的协议映射、禁止工具权限、明确离线替身路径 | 业务提示词、真实推理开关、SDK 内部请求硬封顶 |
| `manifest.ts` / `budget.ts` / `runner.ts` | 严格实测契约、持久调用/token 准入原语、拒绝未就绪执行 | 用户批准真实性证明、OS 沙箱、已完成 benchmark |

未来数据路径为：候选 React → 候选 Fastify 业务层 → 统一模型传输 / 合成服务。外部控制器持有私有脚本和 oracle，收集候选数据库/浏览器观察及独立服务账本。评估器不得根据应用自写“成功”判分。

## 模拟器不是审批防火墙

合成服务接收格式正确的效果请求，即使 `approvalId=null` 也会记录并接受为合成效果；`delivered=false` 恒成立，代码没有真实投递器。这样不合规应用的尝试不会被公共授权层“救好”。独立 oracle 判定是否允许，拒绝和故障尝试也必须计入违规。

同一租户、同一幂等键、相同内容返回先前效果；改变内容返回 conflict；不同租户的键互不吞并。SQLite `BEGIN IMMEDIATE` 包住尝试与效果记录。调用序号、时钟及故障配置跨打开/关闭保留；显式 `reset` 是可信测试控制面方法，不暴露给应用 HTTP 路由。无数据集时显式拒绝，不默认生成看似真实的数据。

外部 `snapshot` 的元数据、read count、attempts 与 effects 在同一 SQLite 读事务内读取，异常 rollback。确定性 WAL 双连接测试在 attempts SELECT 后插入另一连接的提交，保证不会把不同提交时刻的行拼成误报越权/孤立效果的快照。

资源端点 `GET /resources/:tenant/:kind` 返回该租户该类的所有版本；应用自己选择有效版本、做时间过滤和业务判断。`POST /effects` 接受合同内 action；不认识的字段返回 400，幂等冲突 409，脚本故障 503。当前协议格式错误只返回错误，不构成 accepted effect；完整实测控制器仍须采集 HTTP 拒绝请求记录。

## 身份、存储与隔离

合同中的 `IdentityClaims` 仅定义可信合成会话应提供什么。未来各候选必须实现后端会话映射及授权，不能把来自任意 JSON 的 claims 当可信身份。共享代码没有完成这一业务解决方案。

数据库是本地可改文件，不是不可篡改账本。实际评测要求候选不可写评测器数据库和 oracle。Git worktree 只是代码隔离，不是安全边界；文件、环境变量、进程和网络访问需另行限制与 canary 验证。

## 种子与评测资产分发

不能把整个本仓库 checkout 给编码组：其中有比较研究、评测器和通用测试。`seedSourceFiles` 明确列出 16 个源文件；另生成 package、裁剪的 lock、忽略文件及空白种子说明，共 20 个文件和 `seed-manifest.json`。只保留空白 app、中立合同及构建依赖；SDK、lab、测试双、源 README/研究、方法配置、日志、其他实现、Git 历史和已装依赖都不复制。所有源路径与目标父路径逐层拒绝 symlink/junction；拒绝 `..`、已有目标与非普通文件。依赖锁沿所选固定依赖、可选/peer 依赖闭包裁剪，保留必要的两个 workspace。

`seed:verify` 需要从可信渠道保存的 manifest hash，验证精确文件/目录集合及全部内容 hash，拒绝额外文件、空目录、链接、删改内容和伪造收据。合成 canary 验证的是导出边界，**不是**全局规则/进程权限/网络隔离；不抵御检查与复制之间的恶意并发替换。只能从可信、静止且待冻结的源码制作。安装依赖前核验；安装/build 后目录自然不再是原始导出快照。正式分发还需绑定冻结 commit/hash 并单独附一致业务规格，不能把当前收据写为已批准实验种子。

候选进程沙箱仍未实现，manifest 中相关证明留空。评测器保持外部运行，不共享私有答案。不存在已推送的候选实现。

## 无模型 episode 与私有材料边界

`runOfflineEpisode` 只允许 `offline-test-double`；`candidate` 在任何调用前拒绝。每个独立 episode 由可信测试控制器提供全新的应用数据目录/实例；步骤内重启回调只重启该应用进程，保留其数据库。驱动重置独立模拟器、按序发送事件或审批命令、调整合成时钟并核对 HTTP 状态/确认 ID，最后读取观察并与独立效果账本/oracle 比较，不由测试应用生成正确答案。

HTTP 适配器只接受字面 `http://127.0.0.1:端口` 根源；拒绝用户信息、query/hash/path、外部地址、缩写/数字 host、HTTPS，且所有请求禁自动 redirect。重启返回的新地址再次检查。能力响应必须自报 `offline-test-double` / `inference=disabled`；这不是对任意本地进程的身份认证，也不应连接客户系统。测试双使用固定合成 session 标识，不是生产鉴权或完整审批绑定实现。

已证明的原语覆盖：重复/乱序事件、审批命令接受/拒绝、真实子进程重启、read/effect 故障及重试、效果幂等、unsafe 效果与虚假 booked 取消资格。结果始终带 `benchmarkStatus=not-run`。只有协议/原语成功且无额外断言才为该**单元协议测试**的 passed；只要存在 `additionalAssertions` 就最多 partial。

私有准备 bundle 的 singular `episode: string[]` 不等于 typed `steps`，不会转换、解释、运行或发给模型。只读入口检查 12 个 case 的 schema、重复 ID/故障槽、case/oracle 作用域、同租户证据/演员/酒店引用、省略资源与必要预订目标、policyVersion、required effect keys。只返回数量、原始字节 hash 和静态代码；资源不会复制进仓库或日志。`sourceRef`、不同 action 的 target/approval 关系缺少完整实体合同，不能据当前字段验证；同样未覆盖事实文本支持、业务时间/等价条件、完整审批生命周期与 UI 路径。不调整私有场景迎合已有原语。

## SDK 边界

官方路径为 TypeScript 应用 → Copilot SDK → CLI JSON-RPC → 已登录账户的模型路由。它是 agent runtime，不保证一次 `send` 只有一次计费模型请求。当前禁止 live 构造流程；`BlockedCopilotTransport` 必定抛错。`wrapCopilotSdk` 只映射已有 client 的类型接口，构造不启动进程。

`exerciseOfflineSdkProtocol` 仅用于明确标识的测试双，返回类型始终是 `offline-test-double`。没有生产 fallback，也不自动重试。缺用量为 null，模型 ID 不符、空输出、超出观察到的输出上限或清理失败都显式报错。该事后检查不是远端 token 硬限制；真实接入前需核验逐请求 admission、超时取消效果和工具禁用是否实际生效。
