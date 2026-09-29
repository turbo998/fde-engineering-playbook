import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0").filter(Boolean);
const rootFiles = new Set([
  "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", ".gitignore", ".gitattributes",
  ".npmrc", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "eslint.config.js"
]);
const errors: string[] = [];
for (const file of files) {
  if (!rootFiles.has(file) && !/^(apps\/seed|packages\/(contracts|lab)|tests|scripts|docs|templates|experiment|\.github\/workflows)\//.test(file)) {
    errors.push(`Not in publication allowlist: ${file}`);
  }
  if (/(^|\/)(private|holdout|candidates|transcripts|\.local)(\/|$)|\.(sqlite|db|log|png|jpg|pdf)$/i.test(file)) {
    errors.push(`Private or binary artifact: ${file}`);
    continue;
  }
  const text = readFileSync(file, "utf8");
  if (/[A-Z]:[\\/](?:Users|home)[\\/]|\/Users\/[A-Za-z0-9]|\/home\/[A-Za-z0-9]/.test(text)) errors.push(`Personal absolute path: ${file}`);
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{24,})\b/.test(text)) errors.push(`Possible credential: ${file}`);
  if (file.endsWith(".md")) {
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const link = match[1];
      if (!link || /^(https?:|mailto:|#)/.test(link)) continue;
      const target = link.split("#")[0];
      if (target && !existsSync(resolve(dirname(file), target))) errors.push(`Broken local link: ${file} -> ${target}`);
    }
  }
}
if (errors.length) throw new Error(errors.join("\n"));
console.log(`PASS: ${files.length} allowlisted text artifacts; path/credential patterns and local Markdown links checked`);
console.log("This heuristic is not a comprehensive secret scan or an independent privacy review.");
