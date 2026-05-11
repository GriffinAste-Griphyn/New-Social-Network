import { spawnSync } from "node:child_process";

const audits = [
  ["web", "npm", ["audit", "--omit=dev"]],
  ["mobile", "npm", ["--prefix", "apps/mobile", "audit", "--omit=dev"]],
];

let failed = false;

for (const [name, command, args] of audits) {
  console.log(`\n=== ${name} production audit ===`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
