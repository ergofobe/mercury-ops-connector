#!/usr/bin/env node
/**
 * Grok Bot box secrets launcher for Mercury Ops.
 *
 * The stdio server reads MERCURY_API_TOKEN only. This wrapper maps
 * OFORICA_MERCURY_API_TOKEN → MERCURY_API_TOKEN when the org-scoped
 * box secret is set (see README “Multi-org install example”).
 * Never print either value.
 *
 * Spend tools are listed; execute stays off unless MERCURY_OPS_ALLOW_SPEND=1.
 * Do **not** Marketplace-publish. Register as mercury-ops (or
 * mercury-ops-oforica when sharing a host with stock Mercury OAuth).
 *
 * Usage:
 *   node scripts/run-mcp-from-box-secrets.mjs
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  applyOforicaTokenAlias,
  missingTokenVars,
  safeErrorMessage,
} from "../src/secrets.js";

const env = applyOforicaTokenAlias(process.env);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const missing = missingTokenVars(env);
if (missing.length > 0) {
  process.stderr.write(
    "mercury-ops: MERCURY_API_TOKEN is not set. The box secrets launcher maps OFORICA_MERCURY_API_TOKEN → MERCURY_API_TOKEN. Do not Marketplace-publish.\n"
  );
  process.exit(1);
}

const child = spawn(process.execPath, [path.join(root, "src", "index.js")], {
  cwd: root,
  stdio: "inherit",
  env,
});

child.on("error", (err) => {
  process.stderr.write(`${safeErrorMessage(err, env)}\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
