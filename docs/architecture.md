# 中立底座架构与信任边界

## 当前已实现的组件

| 路径 | 职责 | 不承担的职责 |
| --- | --- | --- |
| `apps/seed` | React 状态页、Fastify 健康/状态 API、SQLite 启动元数据 | 业务 Agent、审批 UI、状态机、预订服务 |
| `packages/contracts` | Zod 严格模式与类型：资源、金额、审批绑定、交接、效果请求 | 匹配替代、判断风险、批准行动 |
| `packages/lab/src/simulator.ts` | 固定时钟、版本化合成资源、确定故障、持久尝试/效果/可信控制事件的因果序号、租户级幂等 | 应用授权、真实酒店接口、外发 |
| `simulator-server.ts` | 资源读取与合成效果 HTTP 合同 | 身份提供者、公共互联网服务、reset 管理 API |
| `evaluator.ts` | 独立 oracle 输入、效果与声明核对、取消资格、三次统计 | 全业务评分、模型裁判或自动生成正确答案 |
| `semantic-schema.ts` / `semantic-evaluator.ts` | 独立可信资源、身份、方案、审批/人工事件与 19 项 typed 业务规则；逐规则分母/严重性/不可用标记 | 自由文本裁判、生产身份、候选实现、完整业务验收通过 |
| `semantic-episode-schema.ts` / `semantic-episode.ts` | 私有 v3 typed actions/checkpoints/控制器事件、来源/断言 digest 分类；仅离线 HTTP 测试双适配 | 解释自然语言、执行候选、真实模型或发送器 |
| `episode.ts` / `contracts/src/test-adapter.ts` | 严格 typed 步骤、loopback HTTP 测试 API、外部重启回调、独立原语评价 | 候选执行入口、任意 URL 连接、自然语言脚本解释器 |
| `seed-export.ts` | 固定文件 allowlist、精简依赖锁、可信 hash/精确目录核验 | OS 沙箱、文件系统并发攻击防护、零全局污染证明 |
| `private-fixtures.ts` / `dataset.ts` | 无数据库副作用的准备材料 schema/引用核验、共享模拟数据 schema | 业务 oracle 完备性、执行 holdout、解释追加断言 |
| `model.ts` | 与固定 SDK 类型匹配的协议映射、禁止工具权限、明确离线替身路径 | 业务提示词、真实推理开关、SDK 内部请求硬封顶 |
| `manifest.ts` / `budget.ts` / `runner.ts` | 严格实测契约、持久调用/token 准入原语、拒绝未就绪执行 | 用户批准真实性证明、OS 沙箱、已完成 benchmark |
| `host-inventory.ts` / `scripts/host-inventory.ts` | 显式 opt-in、固定宿主身份、disposable-only CLI 库存及 baseline/synthetic treatment 集合检查、清洗 receipt | 模型请求、真实方法激活、native sandbox executor、OS/跨组隔离或实验批准 |

未来数据路径为：候选 React → 候选 Fastify 业务层 → 统一模型传输 / 合成服务。外部控制器持有私有脚本和 oracle，收集候选数据库/浏览器观察及独立服务账本。评估器不得根据应用自写“成功”判分。

## 模拟器不是审批防火墙

合成服务接收格式正确的效果请求，即使 `approvalId=null` 也会记录并接受为合成效果；`delivered=false` 恒成立，代码没有真实投递器。这样不合规应用的尝试不会被公共授权层“救好”。独立 oracle 判定是否允许，拒绝和故障尝试也必须计入违规。

同一租户、同一幂等键、相同内容返回先前效果；改变内容返回 conflict；不同租户的键互不吞并。SQLite `BEGIN IMMEDIATE` 包住尝试与效果记录。调用序号、时钟及故障配置跨打开/关闭保留；显式 `reset` 是可信测试控制面方法，不暴露给应用 HTTP 路由。无数据集时显式拒绝，不默认生成看似真实的数据。

外部 `snapshot` 的元数据、read count、read outcome ledger、attempts 与 effects 在同一 SQLite 读事务内读取，异常 rollback。每次 read 记录序号、租户、资源类型、时钟和成功/故障；重启保留实际次数。老数据库只有 count 而无历史行时返回 `readAttempts=null`，不补造零或成功记录；显式重置新的测试 episode 才获得完整轨迹。确定性 WAL 双连接测试在 attempts SELECT 后插入另一连接的提交，保证不会把不同提交时刻的行拼成误报越权/孤立效果的快照。

`sim_causal_events` 在同一 SQLite 中为控制器签发的 decision/manual 事件与实际 effect attempt 分配单调共同序号，snapshot 同事务读取它。`recordTrustedControl` 仅为本地可信控制面方法，HTTP 无对应路由；完整可信记录的 digest、原始引用序号及服务时钟绑定其位置。请求 body 不能提供 `causalSequence`。接受、重复、冲突和故障尝试各有新位置，效果永远保留原接受尝试的位置；重开数据库不会重编号。相同控制事件重放返回原位置，冲突 digest 明确拒绝，旧批准重放不能越过已签发取消。老效果/尝试缺少位置时保持 `null`，不按时间戳补造顺序。

资源端点 `GET /resources/:tenant/:kind` 返回该租户该类的所有版本；应用自己选择有效版本、做时间过滤和业务判断。`POST /effects` 接受合同内 action；不认识的字段返回 400，幂等冲突 409，脚本故障 503。当前协议格式错误只返回错误，不构成 accepted effect；完整实测控制器仍须采集 HTTP 拒绝请求记录。

## 身份、存储与隔离

合同中的 `IdentityClaims` 仅定义可信合成会话应提供什么。未来各候选必须实现后端会话映射及授权，不能把来自任意 JSON 的 claims 当可信身份。共享代码没有完成这一业务解决方案。

数据库是本地可改文件，不是不可篡改账本。实际评测要求候选不可写评测器数据库和 oracle。Git worktree 只是代码隔离，不是安全边界；文件、环境变量、进程和网络访问需另行限制与 canary 验证。

无推理库存诊断使用调用者提供的私有身份 pin，不解析 npm shim，不自动更新/安装或改变系统信任。只支持明确的 CLI 1.0.95-3 格式：Node、`index.js`、package、`cli-main.js` 和当前平台 runtime 文件 hash 在开始/结束核验；这不是签名认证或对并发文件替换的完整防护。子环境仅保留必要系统变量，把 profile/AppData/temp/config/cache 重定向到该 episode 的 disposable 根，启用 offline/no-update/no-remote/no-export/disabled-builtin-MCP 标志。单进程输出/超时与整体 CLI 时间有界；不提供任意命令或模型入口。

skill 的来源计数采用固定枚举 map，未知来源/字段/缺失 enabled/重名拒绝。instruction 列表只计发现数，不能从 `defaultDisabled` 推出实际 enabled；非空 plugin/MCP 当前 unavailable。官方 canary disable 的临时 `settings.json.disabledSkills` 必须严格匹配，再仅在临时 home 禁用已发现非 builtin；baseline 校验原 builtin 集合完整，treatment 校验相同 builtin 加唯一指定 project canary及其临时路径。所有动态名称、路径、描述仅内部比较/hash，不进入 receipt。配置路径与清理目标拒绝链接替换；失败/timeout 仍清理自身根，目标不明确则报错，不删除外部目标。

库存 receipt 的 verified 只限这一集合观察：不包括 host 投影 instructions、hooks/memory、方法 activation、OS/文件/网络/cross-arm/holdout 分离。历史 native 平台 detector 的 true 也不是运行 canary；本工具不调用这个内部版本绑定 API，字段保持 `null`。它不读私有 goldens、不填写 manifest 的模型/预算/批准，也不分发给编码组或进入 seed。

## 种子与评测资产分发

不能把整个本仓库 checkout 给编码组：其中有比较研究、评测器和通用测试。`seedSourceFiles` 明确列出 16 个源文件；另生成 package、裁剪的 lock、忽略文件及空白种子说明，共 20 个文件和 `seed-manifest.json`。只保留空白 app、中立合同及构建依赖；SDK、lab、测试双、源 README/研究、方法配置、日志、其他实现、Git 历史和已装依赖都不复制。所有源路径与目标父路径逐层拒绝 symlink/junction；拒绝 `..`、已有目标与非普通文件。依赖锁沿所选固定依赖、可选/peer 依赖闭包裁剪，保留必要的两个 workspace。

`seed:verify` 需要从可信渠道保存的 manifest hash，验证精确文件/目录集合及全部内容 hash，拒绝额外文件、空目录、链接、删改内容和伪造收据。合成 canary 验证的是导出边界，**不是**全局规则/进程权限/网络隔离；不抵御检查与复制之间的恶意并发替换。只能从可信、静止且待冻结的源码制作。安装依赖前核验；安装/build 后目录自然不再是原始导出快照。正式分发还需绑定冻结 commit/hash 并单独附一致业务规格，不能把当前收据写为已批准实验种子。

候选进程沙箱仍未实现，manifest 中相关证明留空。评测器保持外部运行，不共享私有答案。不存在已推送的候选实现。

## 无模型 episode 与私有材料边界

`runOfflineEpisode` 只允许 `offline-test-double`；`candidate` 在任何调用前拒绝。每个独立 episode 由可信测试控制器提供全新的应用数据目录/实例；步骤内重启回调只重启该应用进程，保留其数据库。驱动重置独立模拟器、按序发送事件或审批命令、调整合成时钟并核对 HTTP 状态/确认 ID，最后读取观察并与独立效果账本/oracle 比较，不由测试应用生成正确答案。

HTTP 适配器只接受字面 `http://127.0.0.1:端口` 根源；拒绝用户信息、query/hash/path、外部地址、缩写/数字 host、HTTPS，且所有请求禁自动 redirect。重启返回的新地址再次检查。能力响应必须自报 `offline-test-double` / `inference=disabled`；这不是对任意本地进程的身份认证，也不应连接客户系统。测试双使用固定合成 session 标识，不是生产鉴权或完整审批绑定实现。

已证明的原语覆盖：重复/乱序事件、审批命令接受/拒绝、真实子进程重启、read/effect 故障及重试、效果幂等、unsafe 效果与虚假 booked 取消资格。结果始终带 `benchmarkStatus=not-run`。只有协议/原语成功且无额外断言才为该**单元协议测试**的 passed；只要存在 `additionalAssertions` 就最多 partial。

私有 v1 bundle 的 singular `episode: string[]` 仍不会解释、运行或发给模型。新的 companion 是另外手工编写的严格 v3 typed 准备材料，保留 v1 字节/hash 与既有 v2 companion/authoring script/schema 不变。`fixtures:validate-semantic` 检查源 hash、schema digest、12 个 case、资源/身份/政策/故障一致性、每个原始步骤与断言的 digest、逐条分类和 script digest；每个 typed 步骤必须有唯一来源映射，不能删除文本断言后宣称覆盖。CLI 只返回数量/hash/类别/静态代码，schema 模块不加载 SQLite 或启动服务。

独立语义 oracle 的可信输入由外部控制器掌握，而非从候选观察反推：版本化资源及已审定 fact anchors、固定合成会话、有效方案区间、批准/拒绝/取消/失效历史和人工事件。方案事实 digest 绑定资源引用与**证据版本**，方案还绑定 target/action/cost；可信会话映射决定角色和 actor，候选 JSON 不授予权限。每次尝试和实际效果都重新核对当时有效的方案/批准；过期端点不可执行，人工事件必须在批准之前且同方案/政策/事实。候选的持久审批历史和尝试审计与独立轨迹精确核对。

语义 oracle schema 现为 v2，typed episode/companion 为 v3；不把旧 oracle 静默升级。`trusted-control` 步骤实际执行时才记录可信 decision/manual，位于审批/人工事件投递之前，不从候选确认、最终脚本顺序或候选 claims 反推位置。`decisionsAt` 只考虑实际服务位置在该尝试之前的批准历史，并按共同位置取最新记录；可信记录自身的 `sequence` 仅用于引用，不是跨账本因果证据。相同冻结时钟下 execute → grant 取消资格，grant → execute → cancel 保留原确认有效，grant → cancel → execute 或取消后的 duplicate retry 取消资格；manual 必须具有早于 grant 的实际位置。缺少完整位置/账本时报告 `CAUSAL_AUTHORITY_UNAVAILABLE`，最多 partial，矛盾或篡改的可用证据按失败处理。

交接核对实际确认效果、批准、方案及酒店/到店资源版本，检查地址、到店时间和对应证据版本；准备的 prior-case context 也必须来自外部 grant/effect fixture，不能用客户端自报 confirmed。它使用单独的 `priorCausalEvents`，不能借用当前账本相同数字的位置。私有 prior fixture 的位置仍是未执行的准备数据，未来必须由可信 producer 实际采集并封存；缺少 prior 因果证据的交接 unavailable。structured fact 只允许审定的资源字段/值/引用组合；证据 ID 存在或 statement 包含字符串不能证明任意 prose。真实体验预订、生产身份、不可篡改审计、浏览器/人类质量以及完整跨租户响应内容追踪仍不可用。

`runOfflineSemanticEpisode` 与旧驱动一样在调用或 reset 之前拒绝 `candidate`。新 HTTP 适配器继承字面 loopback、禁 redirect、重启地址复查的限制；checkpoint/reply 不符明确抛出静态错误，不返回预设成功。通用离线测试双只证明协议接线。私有 77 步（含 13 个新增控制器事件步骤）和 35 项分类均为 prepared / not-run，预期尝试的位置字段不是实际执行证据，不执行这份 companion，不增加四组实测次数。

## SDK 边界

官方路径为 TypeScript 应用 → Copilot SDK → CLI JSON-RPC → 已登录账户的模型路由。它是 agent runtime，不保证一次 `send` 只有一次计费模型请求。当前禁止 live 构造流程；`BlockedCopilotTransport` 必定抛错。`wrapCopilotSdk` 只映射已有 client 的类型接口，构造不启动进程。

`exerciseOfflineSdkProtocol` 仅用于明确标识的测试双，返回类型始终是 `offline-test-double`。没有生产 fallback，也不自动重试。缺用量为 null，模型 ID 不符、空输出、超出观察到的输出上限或清理失败都显式报错。该事后检查不是远端 token 硬限制；真实接入前需核验逐请求 admission、超时取消效果和工具禁用是否实际生效。
