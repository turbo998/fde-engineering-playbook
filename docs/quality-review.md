# 中立质量量表与评审 receipt 准备契约

这是运行前的 **draft-only preparation**，不是 benchmark 报告、冻结量表、业务断言通过或已完成评审。`packages/lab/src/quality-rubric.ts` 提供原创通用锚点；`review-receipt.ts` 只检查严格结构及调用者另行持有的控制器 registry 绑定。没有评审执行器、模型 judge、浏览器执行器或 HTTP reviewer-authority endpoint。

## 覆盖范围

| ID | 维度 | 必需的独立持有证据 |
| --- | --- | --- |
| R01 | 风险叙述的校准 | rendered artifact、external oracle summary |
| R02 | 升级说明的清晰性 | rendered artifact、external oracle summary |
| R03 | 容量与确认状态措辞 | rendered artifact、external oracle summary、service ledger |
| R04 | 审批范围与金额 UI | browser trace、trusted approval history、external oracle summary |
| R05 | 因果备忘录的证据支撑 | rendered artifact、external oracle summary、versioned evidence |
| R06 | 失败与制品状态的诚实性 | rendered artifact、service ledger、model-attempt ledger |

每项有 `not-met` / `partial` / `met` 三个可观察锚点；没有数值加权或排行榜。三个 operations/itinerary/supply journey 只定义观察目标，不执行应用操作。七个 web screening 控制关联 WCAG 2.2 的 2.1.1、2.1.2、2.4.7、2.4.11、3.3.4、4.1.2、4.1.3，全部 pending，assistive-tech evidence 为空。3.3.4 需要先判断具体 consequential submission 是否适用；这个子集、自动零违规或 schema-valid 都不是 WCAG conformance 或完整工程质量覆盖。参考 [WCAG 2.2](https://www.w3.org/TR/WCAG22/) 与 [ARIA APG](https://www.w3.org/WAI/ARIA/apg/)；这里是原创意图释义，不复制规范正文。

`createDraftQualityRubric()` 每次返回独立的严格对象：`executionStatus=not-run`、`freezeStatus=draft-no-approved-manifest`、`completedReviews=0`；reviewer/configuration/assignment/budget 均为 null。`qualityRubricDigest()` 对严格解析后的对象作既有 canonical SHA256，变更锚点需要新的摘要及另行批准，不自动冻结或填入 manifest。

## 控制器与候选的边界

`validateReviewReceipt(rubric, receipt, controllerContext, now)` 不从 receipt 接受 reviewer approval、evidence independence 或 scope determination 布尔值。严格 `ReviewContext` 必须由外部控制器独立保管/提供，不能把候选提交的“trusted context”转交为权威输入；其来源认证、实际批准及证据真实性仍由未来执行器实现。schema 本身不认证控制器或 reviewer，字段中的 authority evidence hash 也不是签名或实际审批证明。

控制器 registry 分开保存 reviewer configuration、有效期/撤销状态的 grants、opaque candidate alias 与 artifact digest、逐 criterion 的证据、独立 scope determination 和 hard failures。grant 必须绑定 reviewer/configuration/rubric/candidate/criterion/artifact，id 非 null、有效且不重复。证据 hash 不重复、作用域匹配；oracle/ledger/approval/version/scope 证据仅接受独立 service registry origin，不能用候选声明或单独捕获的 prose 替代。模型配置仅是严格类型和独立 budget digest 的占位契约，不选择实际模型、批准预算或调用模型。

Reviewed receipt 必须有仍有效的批准 grant、所有必需证据、受支持 rating 与非空 justification。独立 hard failure 必须在 receipt 中保留，且 rating 只能为 `not-met`；不能省略或以正向质量评分抵消。`unavailable` 使用 null rating/grant/justification 与明确原因，不换成零或 passed，且仍保留已知 hard failure。`not-applicable` 必须有匹配的独立 scope-determination evidence、控制器 determination 与 `OUT_OF_SCOPE`，不能由候选自报，也不能隐藏已有 hard failure。

所有输入层拒绝未知字段；输出仅含静态 error codes 与 `schema-valid` / `rejected`。无论结构通过与否，`reviewPerformanceVerified`、`factualCorrectnessVerified`、`reviewerAuthorityAuthenticated`、`blindingAchieved`、`benchmarkResultCreated` 恒为 false。这不是运行前授权函数，不能解锁现有 live/candidate/benchmark 闸门。

## 盲包与尚未证明的工作

`prepareBlindReviewPacket()` 只投影 schema version、opaque alias、criterion、rubric/artifact digest 与必需证据的 kind/hash；不携带 method/arm/host labels、reviewer/config/grant、开发日志或 prior ratings。缺失必需证据则不生成包。`BlindReviewPacket` 拒绝额外 metadata 与非 opaque alias。

这只保证包的字段结构：实际 artifact 内容、代码风格或证据内容仍可能暴露方法，hash 也不证明已清洗或完整盲化。尚未访问制品、分配真实 reviewer、产生真实 review receipt、运行浏览器/assistive technology，或进行方法内容泄漏审查。

私有分类仍为 **18M / 10I / 6R / 1U**，`executedEpisodes=0`，六项 R 全部 unreviewed；v1/v2/v3 及 v3 的既有语义绑定不因本增量重写。通用 anchors 不包含私有 case/assertion 值或方法方案；生产代码不导入父会话 scratch JS。lab/contracts 不进入中立 seed。冻结/封存、controller/reviewer authority、盲化检查、完整业务/UI/persistence 集成、隔离、实验模型/预算与逐模型请求控制仍需另行验证和批准。
