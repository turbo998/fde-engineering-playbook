# 能力与执行预检

截至 2026-10-15（保留 9 月历史能力及 10 月协调会话证据，新增可复用无推理库存诊断）。**文档支持、已安装、已登录、元数据可见、真实推理成功、实验获准是不同状态。** 没有进行任何实测编码或 live inference。

## 本机能力证据

| 能力 | 状态 | 已有证据与限制 |
| --- | --- | --- |
| Node / npm | 已运行 | Node 24.13.1、npm 11.8.0；本工作树离线构建与测试另见状态报告 |
| Copilot CLI | 宿主版本需要精确路径固定 | 历史 help 为 1.0.87-0；10 月无推理预检中 app 入口为 1.0.95-3，npm shim 却为 1.0.72-1；不能只固定 wrapper 名称 |
| Copilot SDK | 本地固定依赖 | npm 1.0.15；TypeScript 适配仅离线协议测试，不启动推理 |
| SDK auth / models 元数据 | 已查询 | 仅 start → getAuthStatus → listModels → stop；authenticated=true、有 enabled 模型；未 createSession/send |
| SDK 运行时版本 | 待正式固定 | 元数据查询用 SDK bundled runtime，不把它假定为 PATH 中 CLI 1.0.87-0 |
| Codex | 已有只读认证证据 | 协调会话的 `codex login status` 成功且已登录；不证明具体模型/额度/推理可用 |
| Bun / Claude CLI / Docker | 未就绪 | 既有预检未发现；本阶段未全局安装，不靠它们运行离线底座 |
| OS/跨组隔离 | 未验证，有具体污染线索 | 干净 home/白名单环境仍发现 36 inherited + 2 builtin skills；个人 skill canary 增至 39，`--no-custom-instructions` 未排除它。发现不等于激活，仍不能证明隔离 |
| 可复用库存诊断 | 已无推理验证，仅 discovery | 独立观察 baseline 2 enabled / 0 nonbuiltin；synthetic treatment 3 / 1；官方 temporary disable 生效；receipt 清洗与失败/unknown 处理；所有临时 fixture 已删除 |
| Native 平台支持检测 | 协调会话已检测，非 executor | 内部版本绑定 detector 在 Windows 26200.9457 / CLI 1.0.95-3 返回 true；仅版本阈值/支持检查，无 process/filesystem/network canary。本仓库诊断不调用它，support 为 null |
| 新公开 SDK 元数据访问 | TLS 阻塞，未绕过 | 协调会话的 npm 与 OS HTTPS TLS 均失败；未改变 trust/TLS、替换 SDK 或发模型请求；旧 authenticated 元数据不是当前完整链路证明 |
| seed-only 制品边界 | 已离线验证 | 固定 allowlist、链接/穿越拒绝、可信 hash、合成污染 canary、导出副本独立安装/构建/启动；不是 OS 隔离 |
| 私有准备 schema/引用/分类 | v1/v2 保留，v3 已离线准备 | 12 cases / 40 源步骤 / 77 typed 步骤（含 13 控制事件）/ 35 全量分类；18 机器规则、10 未执行集成、6 rubric、1 unsupported；0 私有执行 |
| 独立 typed 语义 oracle | 合成确定性测试已覆盖 | 19 规则、角色/版本/批准/手工事件/账本/边界/恢复；不证明自由文本、真实身份、浏览器或完整私有候选通过 |
| 通用 episode 驱动 | 已离线验证 | 仅 loopback HTTP 测试双，事件/审批/重启/故障/独立 oracle；候选执行仍禁用 |
| 精确模型与额度批准 | 缺失 | manifest 的模型/限额/approval 保持未填写 |

仅元数据查询通过不等于“仍未接入任何网络”：公开源码/依赖下载和官方元数据访问使用了网络，但没有发推理请求或真实业务请求。账户标识、原始响应及详细模型目录不发布。`scripts/copilot-metadata.ts --metadata-only` 不是 CI 的一部分，后续执行须明确授权，不自动作为 smoke。

新库存 receipt 与历史协调会话 receipt 的环境不同，不能拼成同一实验：历史保留 AppData，发现 36 inherited + 2 builtin；本仓库诊断还把 APPDATA/LOCALAPPDATA/temp/XDG config/cache 指向 disposable home，clean 初始只发现 2 builtin / 0 inherited。两者都观察到 `--no-custom-instructions` 不移除个人 skill canary。新的五文件身份 pin 是后来只读观察并重新核验，不是旧 receipt 原本包含的证据。较窄环境中的非 builtin 零发现不证明 activation、host 投影规则、hooks/memory、真实方法加载或跨组/私有隔离已完成；源代码的 synthetic inherited-skill 测试仍验证不能默认 home 重定向会清除继承。

`host:inventory -- --inventory-only` 要求私有 pin 输入，固定支持 1.0.95-3，不自动探测 PATH/npm shim。只允许 list/version/temporary canary disable，严格已知 JSON、静态来源 map、1 MiB 输出、30 秒单进程/90 秒整体 CLI 截止；未知返回 unavailable/null，不读取 goldens 或模型 session。非空 plugin/MCP 等形状未支持，不能作为空集合通过。baseline/treatment exclusivity 仅指库存集合；未授权真实方法处理或 measured arms。原生 API、TLS trust 和 SDK 公共元数据恢复不在此 bounded 增量中实现。

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
4. 当前可信 typed 脚本准备与 typed 语义规则已经补充；仍需候选后端/持久状态/UI 的私有集成、rubric 和 unsupported 维度、完整跨租户内容追踪、冻结/封存种子与脚本/评分锚点/盲评方案/顺序及哈希，取得绑定版本的批准后再实现正式 live runner。上述不是“全部仅差支出”：0 个私有 episode、业务执行与完整验收仍未完成。

10 月 1.0.95-3 的无推理 CLI help 证据表明 `--max-ai-credits` 最低为 30，仍是 response 后软上限；隐藏 compaction 消耗额度，子 agent 共享会话额度。旧假设的 20-credit CLI cap 不可复用，当前持久 admission 原语不是 SDK/CLI 内部模型请求控制。sandbox help 也明确 built-in 文件编辑不在 OS sandbox 内，默认规则允许用户目录、开发缓存/配置和 outbound；开启开关不构成跨组或私有 holdout 隔离证明。本实现会话的运行模型只是宿主恢复选择，不是四臂实验模型批准。

原生观察轨道选择已经明确，不再作为待用户决定项。当前 `preflight` 提供诊断而不产生成功 benchmark 记录；填满字段也不能绕过 live-disabled 代码。

## 固定官方来源

- [C1 SDK README](https://github.com/github/copilot-sdk/blob/f5d9685f55286061e12763ed15a73c4469609881/README.md)
- [C2 认证](https://github.com/github/copilot-sdk/blob/f5d9685f55286061e12763ed15a73c4469609881/docs/auth/README.md)
- [C3 用量与计费](https://github.com/github/copilot-sdk/blob/f5d9685f55286061e12763ed15a73c4469609881/docs/features/usage-and-billing.md)
- [C4 SDK/CLI 能力差异](https://github.com/github/copilot-sdk/blob/f5d9685f55286061e12763ed15a73c4469609881/docs/troubleshooting/compatibility.md)
- [C5 Node SDK 配置和生命周期](https://github.com/github/copilot-sdk/blob/f5d9685f55286061e12763ed15a73c4469609881/nodejs/README.md)

*AI 辅助整理；这里的批准字段不替代真实授权证据。*
