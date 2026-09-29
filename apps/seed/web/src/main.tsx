import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SeedStatus } from "../../../../packages/contracts/src/index.js";
import "./style.css";

function App() {
  const [status, setStatus] = useState<SeedStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: unknown = await response.json();
        setStatus(SeedStatus.parse(data));
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "未知 API 错误");
        }
      });
    return () => controller.abort();
  }, []);
  return (
    <main>
      <p className="eyebrow">FDE ENGINEERING PLAYBOOK</p>
      <h1>离线研究与实验底座</h1>
      <p className="notice">实验尚未运行 · not-run</p>
      <p>这是 React / Fastify / SQLite 的业务空白种子，不是旅行运营应用，也不是任一方法组的实现。</p>
      <section aria-labelledby="state-heading">
        <h2 id="state-heading">底座状态</h2>
        {error ? <p role="alert">读取失败：{error}</p> : !status ? <p role="status">正在读取本地 API…</p> : (
          <dl>
            <dt>真实模型调用</dt><dd>已禁用</dd>
            <dt>业务工作流</dt><dd>未实现</dd>
            <dt>本地存储</dt><dd>{status.storage}</dd>
            <dt>持久化启动次数</dt><dd>{status.bootCount}</dd>
          </dl>
        )}
      </section>
      <section aria-labelledby="boundary-heading">
        <h2 id="boundary-heading">运行边界</h2>
        <p>没有预订、审批、对外通知或供应商承诺按钮。精确模型、使用额度和隔离验证未就绪时，不允许开始实测。</p>
        <p>模拟服务和评估器的确定性测试只证明工具自身的行为，不构成模型能力或业务验收结果。</p>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<App />);
