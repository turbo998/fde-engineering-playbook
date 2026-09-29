import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? "4317");
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT");
mkdirSync(resolve(".local"), { recursive: true });
const app = await buildServer({
  database: resolve(".local", "seed.sqlite"),
  webRoot: resolve("dist", "web")
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}
try {
  const address = await app.listen({ host: "127.0.0.1", port });
  console.log(`Neutral seed only: ${address}; inference=disabled; benchmark=not-run`);
} catch (error) {
  await app.close();
  throw error;
}
