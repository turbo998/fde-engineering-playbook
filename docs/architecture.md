# 中立底座架构与信任边界

## 当前已实现的组件

| 路径 | 职责 | 不承担的职责 |
| --- | --- | --- |
| `apps/seed` | React 状态页、Fastify 健康/状态 API、SQLite 启动元数据 | 业务 Agent、审批 UI、状态机、预订服务 |
| `packages/contracts` | Zod 严格模式与类型：资源、金额、审批绑定、交接、效果请求 | 匹配替代、判断风险、批准行动 |
| `packages/lab/src/simulator.ts` | 固定时钟、版本化合成资源、确定故障、持久尝试/效果、租户级幂等 | 应用授权、真实酒店接口、外发 |
| `simulator-server.ts` | 资源读取与合成效果 HTTP 合同 | 身份提供者、公共互联网服务、reset 管理 API |
| `evaluator.ts` | 独立 oracle 输入、效果与声明核对、取消资格、三次统计 | 全业务评分、模型裁判或自动生成正确答案 |
| `model.ts` | 与固定 SDK 类型匹配的协议映射、禁止工具权限、明确离线替身路径 | 业务提示词、真实推理开关、SDK 内部请求硬封顶 |
| `manifest.ts` / `budget.ts` / `runner.ts` | 严格实测契约、持久调用/token 准入原语、拒绝未就绪执行 | 用户批准真实性证明、OS 沙箱、已完成 benchmark |

未来数据路径为：候选 React → 候选 Fastify 业务层 → 统一模型传输 / 合成服务。外部控制器持有私有脚本和 oracle，收集候选数据库/浏览器观察及独立服务账本。评估器不得根据应用自写“成功”判分。

## 模拟器不是审批防火墙

合成服务接收格式正确的效果请求，即使 `approvalId=null` 也会记录并接受为合成效果；`delivered=false` 恒成立，代码没有真实投递器。这样不合规应用的尝试不会被公共授权层“救好”。独立 oracle 判定是否允许，拒绝和故障尝试也必须计入违规。

同一租户、同一幂等键、相同内容返回先前效果；改变内容返回 conflict；不同租户的键互不吞并。SQLite `BEGIN IMMEDIATE` 包住尝试与效果记录。调用序号、时钟及故障配置跨打开/关闭保留；显式 `reset` 是可信测试控制面方法，不暴露给应用 HTTP 路由。无数据集时显式拒绝，不默认生成看似真实的数据。

资源端点 `GET /resources/:tenant/:kind` 返回该租户该类的所有版本；应用自己选择有效版本、做时间过滤和业务判断。`POST /effects` 接受合同内 action；不认识的字段返回 400，幂等冲突 409，脚本故障 503。当前协议格式错误只返回错误，不构成 accepted effect；完整实测控制器仍须采集 HTTP 拒绝请求记录。

## 身份、存储与隔离

合同中的 `IdentityClaims` 仅定义可信合成会话应提供什么。未来各候选必须实现后端会话映射及授权，不能把来自任意 JSON 的 claims 当可信身份。共享代码没有完成这一业务解决方案。

数据库是本地可改文件，不是不可篡改账本。实际评测要求候选不可写评测器数据库和 oracle。Git worktree 只是代码隔离，不是安全边界；文件、环境变量、进程和网络访问需另行限制与 canary 验证。

## 种子与评测资产分发

不能把整个本仓库 checkout 给编码组：其中有比较研究、评测器和通用测试。未来需从冻结 commit 制作无 Git 历史的 allowlist 种子，只包括空白 app、共同合同、已审定传输及必要构建文件，再附相同业务规格。评测器由外部进程运行，只暴露 API 合同；不共享比较研究、其他方法指令、其他候选源码或 holdout。

本阶段尚未实现防篡改种子导出与候选进程沙箱，manifest 中相关证明留空。不存在已推送的候选实现，具体留出材料不进入本仓库。

## SDK 边界

官方路径为 TypeScript 应用 → Copilot SDK → CLI JSON-RPC → 已登录账户的模型路由。它是 agent runtime，不保证一次 `send` 只有一次计费模型请求。当前禁止 live 构造流程；`BlockedCopilotTransport` 必定抛错。`wrapCopilotSdk` 只映射已有 client 的类型接口，构造不启动进程。

`exerciseOfflineSdkProtocol` 仅用于明确标识的测试双，返回类型始终是 `offline-test-double`。没有生产 fallback，也不自动重试。缺用量为 null，模型 ID 不符、空输出、超出观察到的输出上限或清理失败都显式报错。该事后检查不是远端 token 硬限制；真实接入前需核验逐请求 admission、超时取消效果和工具禁用是否实际生效。
