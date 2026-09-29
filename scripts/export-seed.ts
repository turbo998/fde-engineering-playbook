import { exportSeed, verifySeed } from "../packages/lab/src/seed-export.js";

const [command, directory, expectedHash] = process.argv.slice(2);
if (!directory) throw new Error("SEED_DIRECTORY_REQUIRED");
if (command === "export") console.log(JSON.stringify(exportSeed(process.cwd(), directory)));
else if (command === "verify" && expectedHash) console.log(JSON.stringify(verifySeed(directory, expectedHash)));
else throw new Error("SEED_COMMAND_OR_TRUSTED_HASH_REQUIRED");
