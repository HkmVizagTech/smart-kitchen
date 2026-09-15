// Loads the repo-root .env (if present) then runs the given command with that
// environment. Dependency-free (uses Node's built-in process.loadEnvFile).
// On Railway/production the .env is absent — we just skip it and use the
// platform-injected environment. Invoking via `node` avoids the name clash
// with the Python `dotenv` CLI some machines have on PATH.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../.env", import.meta.url)); // <root>/.env
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (e) {
    console.warn(`[with-env] could not load ${envPath}:`, e.message);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("[with-env] usage: node scripts/with-env.mjs <command> [args...]");
  process.exit(1);
}

const result = spawnSync(cmd, args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
