import { execFileSync } from "node:child_process";

// Never migrate the shared durable database from a preview deployment or local
// build. Only production deploys (or an explicit operator override) may migrate.
if (process.env.VERCEL_ENV !== "production" && process.env.HUNT_RUN_MIGRATIONS !== "1") {
  console.log("Skipping database migrations outside production; Prisma client generation/build continues.");
  process.exit(0);
}

function run(args) {
  try {
    execFileSync("npx", ["prisma", "migrate", ...args], { stdio: "inherit", env: process.env });
    return true;
  } catch {
    return false;
  }
}

if (run(["deploy"])) process.exit(0);

console.log("Prisma reported an existing non-empty database. Ensuring the recorded Hunt baseline markers are present.");

for (const migration of [
  "00000000000000_init",
  "20261006_admin_summary_and_access_tokens",
]) {
  try {
    execFileSync(
      "npx",
      ["prisma", "migrate", "resolve", "--applied", migration],
      { stdio: "inherit", env: process.env },
    );
  } catch {
    // P3008 means the migration is already recorded as applied; any other
    // error will be surfaced by the final migrate deploy below.
  }
}

execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
