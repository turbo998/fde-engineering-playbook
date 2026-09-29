import { validatePrivateFile } from "../packages/lab/src/private-fixtures.js";

const [path, expectedHash] = process.argv.slice(2);
if (!path) {
  console.log(JSON.stringify({ counts: {}, hash: null, errorCodes: ["FIXTURE_PATH_REQUIRED"] }));
  process.exitCode = 1;
} else {
  const report = validatePrivateFile(path, expectedHash);
  console.log(JSON.stringify(report));
  if (report.errorCodes.length) process.exitCode = 1;
}
