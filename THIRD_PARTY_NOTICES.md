# 第三方引用与许可边界

本仓库原创文档、合成协议样例和代码采用 MIT。研究对象的名字与商标归各自权利人所有；引用不意味着背书或合作关系。不复制上游方法包、原始研究材料或截图。

| 参考项目 | 核验版本 | 许可观察 |
| --- | --- | --- |
| Microsoft HVE Core | `180c85492b5a20380927200ddf926fd712e7d9d1` | 主体 MIT；部分 OWASP 衍生内容 CC BY-SA 4.0，其他引用见上游 notices，不能统称全仓库 MIT |
| obra/Superpowers | `8ca22dba9a94f28898bbce59f2537ff4d87c747d` | README 指向 MIT |
| garrytan/gstack | `65bfb0ce49da807698359ca033a05709e342c684` | 主仓库 MIT；不意味着所有工具依赖同一许可 |
| GitHub Spec Kit | `8d3f64cdccc877b6a297bc8167131103bb5b8ca0` | MIT |
| Fission-AI OpenSpec | `d4e1c77ebae0bd96a7c649fa35edef997989450a` | MIT |
| GitHub Copilot SDK | 文档 `f5d9685f55286061e12763ed15a73c4469609881`；npm `1.0.15` | MIT；文档快照与 npm 包版本分别记录，不推定一一对应 |

[HVE 第三方声明](https://github.com/microsoft/hve-core/blob/180c85492b5a20380927200ddf926fd712e7d9d1/THIRD-PARTY-NOTICES) 是许可区别的来源。本仓库不改写、移植 OWASP 衍生知识正文，也不将其重新许可为 MIT。

npm 依赖由 `package-lock.json` 固定，通过各包附带的许可分发。本文件是引用说明，不是所有传递依赖的法律意见或完整 SBOM。重新分发构建产物前需检查全部依赖及附带声明。
