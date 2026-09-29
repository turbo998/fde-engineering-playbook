import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { canonicalJson, digest } from "./encoding.js";

export const seedSourceFiles = [
  ".gitattributes", ".npmrc", "LICENSE", "eslint.config.js", "tsconfig.json", "tsconfig.build.json",
  "apps/seed/package.json", "apps/seed/src/main.ts", "apps/seed/src/server.ts",
  "apps/seed/vite.config.ts", "apps/seed/web/index.html",
  "apps/seed/web/src/main.tsx", "apps/seed/web/src/style.css",
  "packages/contracts/package.json", "packages/contracts/src/index.ts", "packages/contracts/src/test-adapter.ts"
] as const;
const generatedFiles = ["package.json", "package-lock.json", ".gitignore", "README.md"] as const;
const expectedFiles = [...seedSourceFiles, ...generatedFiles].sort();
const Versions = z.record(z.string(), z.string());
const Manifest = z.strictObject({
  kind: z.literal("neutral-seed-export"), version: z.literal(1),
  sourceSnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
});
const bytesHash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function assertNoLinks(path: string): void {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("SEED_LINK_REJECTED");
  }
}
function safeRead(root: string, file: string): Buffer {
  if (isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error("SEED_PATH_REJECTED");
  const target = resolve(root, file);
  if (relative(root, target).startsWith("..")) throw new Error("SEED_PATH_REJECTED");
  assertNoLinks(target);
  if (!lstatSync(target).isFile()) throw new Error("SEED_FILE_REQUIRED");
  return readFileSync(target);
}

function seedPackage(source: unknown) {
  const pkg = z.object({
    version: z.string(), engines: Versions, dependencies: Versions, devDependencies: Versions
  }).parse(source);
  const dependencyNames = ["@fastify/static", "fastify", "react", "react-dom", "zod"];
  const devNames = ["@types/node", "@types/react", "@types/react-dom", "eslint", "tsx", "typescript", "typescript-eslint", "vite"];
  const select = (names: string[], versions: Record<string, string>) => Object.fromEntries(names.map((name) => {
    const version = versions[name];
    if (!version) throw new Error("SEED_DEPENDENCY_VERSION_MISSING");
    return [name, version];
  }));
  return {
    name: "fde-neutral-seed", version: pkg.version, private: true, type: "module", license: "MIT",
    engines: pkg.engines, workspaces: ["apps/seed", "packages/contracts"],
    scripts: {
      typecheck: "tsc --noEmit", lint: "eslint . --max-warnings 0",
      build: "tsc -p tsconfig.build.json && vite build --config apps/seed/vite.config.ts",
      start: "node dist/apps/seed/src/main.js", "dev:api": "tsx apps/seed/src/main.ts",
      "dev:web": "vite --config apps/seed/vite.config.ts"
    },
    dependencies: select(dependencyNames, pkg.dependencies),
    devDependencies: select(devNames, pkg.devDependencies)
  };
}

function seedLock(source: unknown, pkg: ReturnType<typeof seedPackage>) {
  const Entry = z.looseObject({
    dependencies: Versions.optional(), optionalDependencies: Versions.optional(),
    peerDependencies: Versions.optional()
  });
  const lock = z.object({ lockfileVersion: z.literal(3), packages: z.record(z.string(), Entry) }).parse(source);
  const kept: Record<string, unknown> = {
    "": { name: pkg.name, version: pkg.version, license: pkg.license, engines: pkg.engines,
      workspaces: pkg.workspaces, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }
  };
  const queue: string[] = [];
  const locate = (from: string, name: string): string | undefined => {
    let prefix = from;
    for (;;) {
      const candidate = `${prefix ? `${prefix}/` : ""}node_modules/${name}`;
      if (lock.packages[candidate]) return candidate;
      if (!prefix) return undefined;
      const index = prefix.lastIndexOf("/node_modules/");
      prefix = index < 0 ? "" : prefix.slice(0, index);
    }
  };
  for (const name of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]) {
    const path = locate("", name);
    if (!path) throw new Error("SEED_LOCK_DEPENDENCY_MISSING");
    queue.push(path);
  }
  while (queue.length) {
    const path = queue.shift();
    if (!path || Object.hasOwn(kept, path)) continue;
    const entry = lock.packages[path];
    if (!entry) throw new Error("SEED_LOCK_DEPENDENCY_MISSING");
    kept[path] = entry;
    for (const [type, dependencies] of Object.entries({
      dependencies: entry.dependencies, optionalDependencies: entry.optionalDependencies, peerDependencies: entry.peerDependencies
    })) {
      for (const name of Object.keys(dependencies ?? {})) {
        const found = locate(path, name);
        if (found) queue.push(found);
        else if (type === "dependencies") throw new Error("SEED_LOCK_DEPENDENCY_MISSING");
      }
    }
  }
  for (const workspace of pkg.workspaces) {
    const entry = lock.packages[workspace];
    if (!entry || typeof entry.name !== "string") throw new Error("SEED_WORKSPACE_MISSING");
    kept[workspace] = entry;
    kept[`node_modules/${entry.name}`] = { resolved: workspace, link: true };
  }
  return { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: kept };
}

export function exportSeed(sourceRoot: string, destination: string) {
  if (destination.split(/[\\/]/).includes("..")) throw new Error("SEED_PATH_REJECTED");
  const root = resolve(sourceRoot);
  const target = resolve(destination);
  assertNoLinks(root);
  assertNoLinks(dirname(target));
  const content = new Map<string, Buffer | string>();
  for (const file of seedSourceFiles) content.set(file, safeRead(root, file));
  const packageBytes = safeRead(root, "package.json");
  const lockBytes = safeRead(root, "package-lock.json");
  const pkg = seedPackage(JSON.parse(packageBytes.toString("utf8")));
  content.set("package.json", json(pkg));
  content.set("package-lock.json", json(seedLock(JSON.parse(lockBytes.toString("utf8")), pkg)));
  content.set(".gitignore", "node_modules/\ndist/\n.local/\n");
  content.set("README.md", "# Neutral offline seed\n\nBusiness implementation: absent. Inference: disabled. Benchmark: not-run.\n\nNode 24.13.1-24.x. Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run typecheck`, `npm run lint`, `npm run build`, then `npm start`.\n\nThis export contains no method packages, evaluation scripts, research, candidate sources or Git history. It is not an OS sandbox. Verify the trusted export hash before installing dependencies.\n");
  const files = Object.fromEntries([...content].map(([file, bytes]) => [file, bytesHash(bytes)] as const).sort(([a], [b]) =>
    a.localeCompare(b, "en")));
  const manifest = {
    kind: "neutral-seed-export" as const, version: 1 as const,
    sourceSnapshotDigest: digest({ files, packageHash: bytesHash(packageBytes), lockHash: bytesHash(lockBytes) }),
    files
  };
  // mkdir without recursive intentionally refuses every existing destination.
  mkdirSync(target);
  for (const [file, bytes] of content) {
    const output = join(target, file);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, bytes, { flag: "wx" });
  }
  writeFileSync(join(target, "seed-manifest.json"), json(manifest), { flag: "wx" });
  return { fileCount: content.size, manifestHash: digest(manifest), sourceSnapshotDigest: manifest.sourceSnapshotDigest };
}

export function verifySeed(directory: string, expectedManifestHash: string) {
  assertNoLinks(directory);
  const manifest = Manifest.parse(JSON.parse(safeRead(resolve(directory), "seed-manifest.json").toString("utf8")));
  if (digest(manifest) !== expectedManifestHash) throw new Error("SEED_MANIFEST_HASH_MISMATCH");
  if (canonicalJson(Object.keys(manifest.files).sort()) !== canonicalJson(expectedFiles)) throw new Error("SEED_ALLOWLIST_MISMATCH");
  const allowed = new Set([...expectedFiles, "seed-manifest.json"]);
  const allowedDirectories = new Set<string>();
  for (const file of allowed) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index++) allowedDirectories.add(parts.slice(0, index).join("/"));
  }
  const visit = (current: string, prefix = "") => {
    for (const name of readdirSync(current)) {
      const local = prefix ? `${prefix}/${name}` : name;
      const path = join(current, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) throw new Error("SEED_LINK_REJECTED");
      if (info.isDirectory()) {
        if (!allowedDirectories.has(local)) throw new Error("SEED_EXTRA_DIRECTORY");
        visit(path, local);
      } else if (!info.isFile() || !allowed.has(local)) throw new Error("SEED_EXTRA_FILE");
    }
  };
  visit(directory);
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (bytesHash(safeRead(resolve(directory), file)) !== hash) throw new Error("SEED_FILE_HASH_MISMATCH");
  }
  return { fileCount: expectedFiles.length, manifestHash: expectedManifestHash };
}
