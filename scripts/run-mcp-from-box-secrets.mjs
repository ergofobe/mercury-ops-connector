#!/usr/bin/env node
/**
 * Grok Bot / Ori launcher.
 *
 * Suggested AddMcpServer name: mercury-ops-oforica
 *
 * The stdio server reads MERCURY_API_TOKEN only. Ori maps
 * OFORICA_MERCURY_API_TOKEN → MERCURY_API_TOKEN here so box secrets can use
 * the org-scoped name. Never print either value.
 *
 * Do **not** Marketplace-publish. Stock Cursor Mercury OAuth stays
 * OG Holdings-only; this process is the Oforica API-token org.
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
    "mercury-ops-oforica: MERCURY_API_TOKEN is not set. Ori maps OFORICA_MERCURY_API_TOKEN → MERCURY_API_TOKEN. Do not Marketplace-publish.\n"
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
