import { lstatSync, readFileSync } from "node:fs";
import { HostInventoryReceipt, runHostInventory } from "../packages/lab/src/host-inventory.js";

const [flag, targetPath, ...extra] = process.argv.slice(2);
if (flag !== "--inventory-only" || !targetPath || extra.length) {
  console.error("HOST_INVENTORY_ARGUMENTS_INVALID");
  process.exitCode = 1;
} else {
  let target: unknown;
  try {
    const stat = lstatSync(targetPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("TARGET_READ_INVALID");
    target = JSON.parse(readFileSync(targetPath, "utf8"));
  } catch {
    console.error("HOST_INVENTORY_TARGET_READ_FAILED");
    process.exitCode = 1;
  }
  if (process.exitCode !== 1) {
    const receipt = HostInventoryReceipt.parse(runHostInventory(target));
    console.log(JSON.stringify(receipt));
    if (receipt.status !== "observed") process.exitCode = 1;
  }
}
