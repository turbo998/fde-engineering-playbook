# 实际交付状态

更新日期：2026-09-29。**当前离线阶段有可运行交付，端到端 benchmark 仍为 `not-run`，整体为 partial。** 下面没有模型成绩、四组候选或虚构调用记录。

## 完成、部分完成与阻塞范围

| 范围 | 状态 | 交付与边界 |
| --- | --- | --- |
| 中文匿名规格与研究 | completed（文档） | 场景、验收、架构、协议、3 个深研、2 个规格工具补充、对比、手册和 5 个原创模板 |
| 业务空白种子 | completed（离线） | React/Fastify/SQLite 可构建并真实启动；无领域状态机或候选方案 |
| 合同与合成服务 | completed（当前原语） | 严格 schema、版本资源、确定时钟/故障、持久尝试/效果、幂等与重启测试 |
| 外部评测与额度 | partial | 效果/来源原语、三次统计及持久准入；不是完整 12 族 oracle 或完整计费器 |
| Copilot SDK 适配 | partial | 固定 SDK 类型映射、明确离线测试双、错误/用量/清理处理；live 入口硬性拒绝 |
| 账户元数据预检 | completed（无推理） | SDK 已登录及模型目录可见；Codex 只读认证状态已确认；详细目录不公开 |
| 方法安装/有效隔离 | blocked for measurement | 未安装方法包，未通过 canary、进程隔离和全工具链核验 |
| 编码组、应用推理、业务验收 | not-run | 精确模型、数值额度、批准、完整执行器与私有评测集成未就绪 |

## 实际执行验证

本机为 Windows、Node 24.13.1、npm 11.8.0。初次依赖安装使用 `npm install --ignore-scripts --no-audit --no-fund`；没有全局工具安装。

| 实际命令/入口 | 结果 | 所证明的范围 |
| --- | --- | --- |
| `npm run typecheck` | passed | 应用、合同、工具、脚本与测试的严格 TS 类型 |
| `npm run lint` | passed | ESLint，max-warnings=0 |
| `npm test` | passed：47 tests，0 failed/skipped | 6 个测试文件；合同、模拟器、评估器、manifest/额度、SDK 离线双、空白 API |
| `npm run build` | passed | tsc 服务端与 Vite React 产物 |
| `npm run smoke:offline` | passed | 真子进程、loopback HTTP、页面/JS 资产、SQLite 状态、推理403、业务路由404；随后停止进程 |
| `npm run check:public` | passed：58 个公开文本文件 | allowlist、个人路径/常见凭据模式、Markdown 相对链接 |
| `npm run preflight` | 诊断成功，manifestReady=false | 明确缺少配置/批准，不写入成绩 |
| `npm run benchmark` | 按预期 exit 1 | MANIFEST_REJECTED；没有运行编码组或模型 |
| `node --import tsx --test tests\gates.test.ts` | passed：12 tests | 追加 token 超额持久阻塞断言后，重新验证全部准入边界 |
| `git diff --check` | passed | 公开文本统一 LF 后无空白错误 |
| SDK 元数据脚本（不在 CI） | passed | 仅 auth/model metadata RPC，无 createSession/send，无推理 |

开发过程中有两次 typecheck 失败：SDK reasoning 类型不接受 `none`/`minimal`；smoke 脚本的可选资产路径未充分收窄。均已修改并重跑通过，未用类型断言绕过。SQLite 的实验性 API 警告保留，没有隐藏。

测试数据仅为通用协议单元向量：`unit-*`、测试币种及测试小额限额不是已批准业务政策/实验预算；从未发送到模型。通过 47 项工具测试不能写成“12 个业务场景通过”，也不能证明可信身份、文本事实支持或浏览器用户路径已实测。

## 未做且不能冒充的工作

没有四组独立编码、真实推理 smoke、144 episodes、完整领域实现、已完成盲评、人工复核、生产身份、不可篡改审计或企业部署。本机通过不证明 Ubuntu CI 已通过。CI 仅配置离线检查，不包含元数据查询或推理调用。

私有 holdout 与候选代码不在公开仓库；准备向量不等于执行结果。实测前还需冻结/封存/授权、隔离验证、原生依赖及每模型请求控制。具体剩余决定见 [预检](preflight.md)，实验限制见 [协议](protocol.md)。

公开检查是 allowlist、常见凭据/个人路径模式和 Markdown 相对链接的启发式检查，不是完整独立安全审计。原始错误日志、身份目录与数据库不发布。
