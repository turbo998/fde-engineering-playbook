# gstack 深入研究：角色工作流与浏览器执行

检索日期：2026-09-29。固定快照：`garrytan/gstack@65bfb0ce49da807698359ca033a05709e342c684`，VERSION `1.91.6.0`。未安装 gstack，未执行原生组或真实浏览器业务实验。

## 从角色入口看能力

gstack 把产品澄清、CEO/工程/设计计划、review、QA、ship 与复盘组织为不同技能入口 [G1]。这些角色是工程工作方式，不是本场景的运营/审批/供给三个业务 Agent；不能因为名字相似就声称已经完成多 Agent 应用。

README 包含作者的生产力和交付叙述。这些是上游个人经验主张，不是随机对照结果，不用于推导本项目效率倍数。研究关注可核验机制：哪些文件生成技能、哪些工具执行浏览器、哪些步骤具有外部副作用、不同宿主保留了什么能力。

## 不只是 Markdown

| 层面 | 固定源码/文档事实 | 实验含义 |
| --- | --- | --- |
| 角色化流程 | office-hours、计划审查、review、QA、ship 等不同入口 [G1] | 要记录实际触发的步骤，不凭安装即认定使用 |
| 浏览器 | 优先使用 Aside；不可用时使用自有 browse daemon / bundled browser [G4] | Windows 仍有 fallback 路径，但需验证本机依赖 |
| 宿主转换 | `defineHost` 配置决定路径、frontmatter、工具重写、资产链接和 resolver [G2] | instruction-only 摘要不等于完整工具集 |
| Codex 配置 | `.agents` 本地侧车、生成 metadata、跳过自己的 Codex wrapper、抑制 Review Army [G3] | 原生也有宿主差异，不保证与 Claude 完全等价 |
| 外部审查 | Codex 上外部 review 指向 Claude Code，需独立 CLI 与鉴权 [G1][G3] | 依赖缺失不能无声降级后声称完整原生 |

浏览器文档包含真实 server、CDP、sidecar、状态和生命周期机制。这足以反驳“只是提示词包”，但不能因此认定工具在本机已可用，或将浏览器登录态、隧道能力自动授权给实验。

## 宿主与平台边界

该快照宿主清单包括 Claude、Codex、Factory、Kiro、OpenCode、Slate、Cursor、OpenClaw、Hermes、GBrain；没有完整 Copilot host。README 的通用 instruction-only tier 只搬运方法摘要，没有自动提供浏览器、工具重写、review 和安装链 [G1][G2]。

因此本项目不制作虚假的 gstack-Copilot 适配。原定第四组设计为 Codex 原生观察轨道，其他三组保留 Copilot 受控轨道。这是研究设计的分层，不是缺失一个方法包后改成五组。

上游要求 Bun、Git，Windows 还需要 Node；某些 CSO 路径需要特定 Bun build flags 和本机编译工具，运行扫描配置还可能涉及镜像 [G1]。本机 Bun/Claude CLI 等依赖尚未就绪，所以不能声称完整安装。Codex 自身已登录只能说明账户状态，不证明 gstack 工具链或模型可用。

setup-time 模型 profile 与 gstack-owned runtime 模型默认分离，README 明确可分别覆盖；不指定可能引入隐含模型差异。协议必须记录精确模型和 profile，不采纳上游默认值替用户作支出选择。

## 对 FDE 的假设与风险

office-hours 等问题发现步骤可能让需求更接近业务痛点；UI/浏览器 QA 可能发现 API 测试未覆盖的状态可见性问题；ship 可能强化验证与交付习惯。这些均为待测机制，不是已观测增益。

本场景可以检验：审批未完成时 UI 是否准确显示等待；未知容量是否被误标已订；交接来源能否被用户查看；后端是否抵御直接 API 绕过。浏览器只是其中一层，不能替代独立效果与授权核查。

风险包括计划阶段扩张产品范围、QA 自动修复修改冻结候选、ship 执行真实推送/部署、跨模型 review 产生额外用量、浏览器继承个人登录态。未来应固定范围和副作用权限：只用隔离本地应用，冻结后 `/qa` 的修复不覆盖原始测量；不能打开真实供应商站点执行交易。

## 实测前最小核验

核验 project-local 安装、Bun/browser 依赖、Codex 生成技能及资产、隔离会话的有效工具/skills、外部 review 的认证和允许程度。用无害的启动检查确认工具链，再在批准预算内做 live 验证。任何步骤不支持或被禁止，结果保留为 partial/blocked，不冒充 full-native。

当前没有 gstack 编码产物。原生观察轨道不得与 Copilot 受控轨道混算方法排名，即便统一应用运行模型，开发宿主差异仍在。

## 许可与固定来源

主仓库 MIT 已核验；依赖与浏览器组件需另看各自许可。本仓库不复制技能或工具。

- [G1 README：流程、依赖、宿主与模型设置](https://github.com/garrytan/gstack/blob/65bfb0ce49da807698359ca033a05709e342c684/README.md)
- [G2 宿主生成机制](https://github.com/garrytan/gstack/blob/65bfb0ce49da807698359ca033a05709e342c684/docs/ADDING_A_HOST.md)
- [G3 Codex 实际宿主配置](https://github.com/garrytan/gstack/blob/65bfb0ce49da807698359ca033a05709e342c684/hosts/codex.ts)
- [G4 浏览器内部实现边界](https://github.com/garrytan/gstack/blob/65bfb0ce49da807698359ca033a05709e342c684/docs/BROWSER_INTERNALS.md)
- [G5 VERSION](https://github.com/garrytan/gstack/blob/65bfb0ce49da807698359ca033a05709e342c684/VERSION)
- [G6 LICENSE](https://github.com/garrytan/gstack/blob/65bfb0ce49da807698359ca033a05709e342c684/LICENSE)

*原创、AI 辅助研究；未经 gstack 本机执行验证。*
