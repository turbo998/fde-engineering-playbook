import { validateSemanticCompanionFiles } from "../packages/lab/src/private-fixtures.js";

const [sourcePath, companionPath, expectedSourceHash] = process.argv.slice(2);
if (!sourcePath || !companionPath || !expectedSourceHash || !/^[a-f0-9]{64}$/.test(expectedSourceHash)) {
  console.log(JSON.stringify({ errorCodes: ["PREPARATION_ARGUMENTS_REQUIRED"] }));
  process.exitCode = 1;
} else {
  const report = validateSemanticCompanionFiles(sourcePath, companionPath, expectedSourceHash);
  console.log(JSON.stringify(report));
  if (report.errorCodes.length) process.exitCode = 1;
}
