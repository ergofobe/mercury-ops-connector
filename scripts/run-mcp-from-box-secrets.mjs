#!/usr/bin/env node
/**
 * Optional Grok Bot / Consola launcher note.
 *
 * Consola will wire MERCURY_API_TOKEN from box secrets later. Do **not**
 * install this MCP from this script. Do **not** print the token.
 *
 * This file is a thin wrapper so a future bot can `node` the stdio server
 * after secrets are already in the environment. It refuses to start when
 * MERCURY_API_TOKEN is missing, and it never echoes the value.
 *
 * Usage (later, after Consola wires secrets — not for local install):
 *   node scripts/run-mcp-from-box-secrets.mjs
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { missingTokenVars, safeErrorMessage } from "../src/secrets.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const missing = missingTokenVars(process.env);
if (missing.length > 0) {
  process.stderr.write(
    "mercury-ops: MERCURY_API_TOKEN is not set. Consola will wire box secrets later. Do not install this MCP from this script.\n"
  );
  process.exit(1);
}

const child = spawn(process.execPath, [path.join(root, "src", "index.js")], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("error", (err) => {
  process.stderr.write(`${safeErrorMessage(err, process.env)}\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
