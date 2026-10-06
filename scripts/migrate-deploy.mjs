import { execFileSync } from "node:child_process";

function run(args) {
  try {
    execFileSync("npx", ["prisma", "migrate", ...args], { stdio: "inherit", env: process.env });
    return true;
  } catch {
    return false;
  }
}

if (run(["deploy"])) process.exit(0);

console.log("Prisma reported an existing non-empty database. Applying the recorded Hunt baseline markers once.");
execFileSync("npx", ["prisma", "migrate", "resolve", "--applied", "00000000000000_init"], { stdio: "inherit", env: process.env });
execFileSync("npx", ["prisma", "migrate", "resolve", "--applied", "20261006_admin_summary_and_access_tokens"], { stdio: "inherit", env: process.env });
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
