# 能力与执行预检

截至 2026-09-29。**文档支持、已安装、已登录、元数据可见、真实推理成功、实验获准是不同状态。** 没有进行任何实测编码或 live inference。

## 本机能力证据

| 能力 | 状态 | 已有证据与限制 |
| --- | --- | --- |
| Node / npm | 已运行 | Node 24.13.1、npm 11.8.0；本工作树离线构建与测试另见状态报告 |
| Copilot CLI | 已确认版本及 help | 1.0.87-0；精确模型/reasoning/context、usage 输出入口有文档，不代表当前参数全可用 |
| Copilot SDK | 本地固定依赖 | npm 1.0.15；TypeScript 适配仅离线协议测试，不启动推理 |
| SDK auth / models 元数据 | 已查询 | 仅 start → getAuthStatus → listModels → stop；authenticated=true、有 enabled 模型；未 createSession/send |
| SDK 运行时版本 | 待正式固定 | 元数据查询用 SDK bundled runtime，不把它假定为 PATH 中 CLI 1.0.87-0 |
| Codex | 已有只读认证证据 | 协调会话的 `codex login status` 成功且已登录；不证明具体模型/额度/推理可用 |
| Bun / Claude CLI / Docker | 未就绪 | 既有预检未发现；本阶段未全局安装，不靠它们运行离线底座 |
| OS/跨组隔离 | 未验证 | worktree、干净目录或 help 不构成访问控制证据 |
| seed-only 制品边界 | 已离线验证 | 固定 allowlist、链接/穿越拒绝、可信 hash、合成污染 canary、导出副本独立安装/构建/启动；不是 OS 隔离 |
| 私有准备 schema/引用 | 已机器校验 | 只返回数量/hash/代码；自然语言 episode 不是可执行步骤，追加断言未覆盖 |
| 通用 episode 驱动 | 已离线验证 | 仅 loopback HTTP 测试双，事件/审批/重启/故障/独立 oracle；候选执行仍禁用 |
| 精确模型与额度批准 | 缺失 | manifest 的模型/限额/approval 保持未填写 |

仅元数据查询通过不等于“仍未接入任何网络”：公开源码/依赖下载和官方元数据访问使用了网络，但没有发推理请求或真实业务请求。账户标识、原始响应及详细模型目录不发布。`scripts/copilot-metadata.ts --metadata-only` 不是 CI 的一部分，后续执行须明确授权，不自动作为 smoke。

## 方法兼容矩阵

| 组/参考 | 计划宿主 | 文档/源码依据 | 本机完整链路 |
| --- | --- | --- | --- |
| baseline | Copilot | 不加载方法包；仍用同一中立业务/安全合同 | 尚未验证零全局规则、记忆、hooks 污染 |
| HVE | Copilot | 固定 README 有 CLI plugin 路径 | 未安装/未运行 |
| Superpowers | Copilot | 固定 README 有 plugin 路径；具体技能优先于过时摘要 | 未安装/未运行 |
| gstack | Codex 原生观察轨道 | README 与 hosts/codex.ts 有完整安装路径 | Bun/browser/setup/外部 Claude review 未验证 |
| gstack + Copilot | 不采用虚假适配 | 固定 host 清单无完整 Copilot；instruction-only 非 full-native | 不纳入受控排名 |
| Spec Kit / OpenSpec | 文档研究 | 固定规格/变更工作流 | 不启动第五/第六组 |

gstack 的外部 review 需要另一 CLI 的认证；本机 Codex 已登录不能替代它。不得省略依赖步骤后写“完整原生成功”。不能为了获得相同宿主而偷偷裁剪某方法的工具能力。

## Copilot 作为应用推理路径

官方 SDK 提供应用 → SDK → CLI JSON-RPC，支持已登录 CLI 用户的 OAuth，默认计费与 CLI 同路径 [C1][C2]。无需为本研究先创建另一个外部付费账户，但账户政策和可用模型仍需运行前核验。

固定 SDK 的 `assistant.usage` 可提供单模型调用的 token/计费数据，某些累积 RPC 仍标 experimental；需要同时固定 SDK 与运行时 [C3]。一次 turn 可能多次模型调用，权限回调并不是每模型请求的预算拦截器。CLI soft credit cap 可能在途超限；本阶段不实现虚假的硬货币封顶。

本地发现一个具体兼容边界：模型元数据可能列出 `none`，但 SDK 1.0.15 的公开 TypeScript reasoning 类型只覆盖 low/medium/high/xhigh/max。适配器对 `none`/`minimal` 显式拒绝，不 cast、不改用默认值。正式选择需要满足模型与 SDK 两端。

## 尚需的最小决定与工程闸门

1. 精确指定受控组编码模型、gstack 原生编码模型、统一应用运行模型及所有评审模型/类型、reasoning/context。
2. 明确每组和总体数值额度、调用/token/重试/时间界限，覆盖 smoke、评审与最终验证，并接受软上限风险。
3. 完成有效 OS/全局污染隔离清单和跨组访问 canary、Bun/browser 等原生依赖、逐模型请求准入/计量和终止语义的实际验证；现有 seed 导出 canary 不能替代。
4. 将私有自然语言准备材料另行实现为可信 typed 脚本及完整语义 oracle，补足合同未覆盖维度；冻结种子、脚本、评分锚点、盲评方案、顺序和哈希，取得绑定版本的批准后再实现正式 live runner。上述不是“全部仅差支出”：当前通用离线驱动/导出/校验已经完成，业务执行与语义集成仍未完成。

原生观察轨道选择已经明确，不再作为待用户决定项。当前 `preflight` 提供诊断而不产生成功 benchmark 记录；填满字段也不能绕过 live-disabled 代码。

## 固定官方来源

- [C1 SDK README](https://github.com/github/copilot-sdk/blob/f5d9685f55286061e12763ed15a73c4469609881/README.md)
- [C2 认证](https://github.com/github/copilot-sdk/blob/f5d9685f55286061e12763ed15a73c4469609881/docs/auth/README.md)
- [C3 用量与计费](https://github.com/github/copilot-sdk/blob/f5d9685f55286061e12763ed15a73c4469609881/docs/features/usage-and-billing.md)
- [C4 SDK/CLI 能力差异](https://github.com/github/copilot-sdk/blob/f5d9685f55286061e12763ed15a73c4469609881/docs/troubleshooting/compatibility.md)
- [C5 Node SDK 配置和生命周期](https://github.com/github/copilot-sdk/blob/f5d9685f55286061e12763ed15a73c4469609881/nodejs/README.md)

*AI 辅助整理；这里的批准字段不替代真实授权证据。*
