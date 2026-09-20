/**
 * Minimal stdio MCP (newline-delimited JSON-RPC 2.0).
 * No @modelcontextprotocol/sdk — Mercury Ops: API-token org reads + gated writes.
 */

import { createMercuryClient } from "./mercury.js";
import { missingTokenVars, safeErrorMessage } from "./secrets.js";

export const PROTOCOL_VERSION = "2025-03-26";
export const SERVER_INFO = { name: "mercury-ops", version: "1.2.0" };

/** Money-moving tools. Implemented, but gated off until MERCURY_OPS_ALLOW_SPEND is set. */
export const SPEND_TOOL_NAMES = [
  "send_money",
  "request_send_money",
  "transfer_money",
  "request_transfer_money",
];

export const SPEND_FLAG_VAR = "MERCURY_OPS_ALLOW_SPEND";

const SPEND_TOOL_SET = new Set(SPEND_TOOL_NAMES);

/**
 * True only for 1 / true / yes / on (case-insensitive). Unset, 0, false → off.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isSpendAllowed(env = process.env) {
  const raw = String(env[SPEND_FLAG_VAR] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * @param {string} [name]
 */
export function spendDisabledMessage(name) {
  const tool = name || "Spend tools";
  return `${tool} disabled until ${SPEND_FLAG_VAR}=1 and operator has Jim's explicit green.`;
}

/**
 * Full capability is always advertised. Spend execute is gated separately.
 *
 * @param {NodeJS.ProcessEnv} [_env]
 */
export function advertisedTools(_env = process.env) {
  return TOOL_DEFS;
}

const PURPOSE_SCHEMA = {
  type: "object",
  description:
    "Payment purpose { simple: { category, additionalInfo? } }. Required for domesticWire and internationalWire. Linked external-bank sends typically use category transferToMyExternalAccount. additionalInfo is required for vendor, contractor, and other.",
  properties: {
    simple: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "employee",
            "landlord",
            "vendor",
            "contractor",
            "subsidiary",
            "transferToMyExternalAccount",
            "familyMemberOrFriend",
            "forGoodsOrServices",
            "angelInvestment",
            "savingsOrInvestments",
            "expenses",
            "travel",
            "other",
          ],
        },
        additionalInfo: {
          type: "string",
          description:
            "Required for vendor (vendor name), contractor (contractor name), other (description). Optional for subsidiary. Not accepted otherwise.",
        },
      },
    },
    category: {
      type: "string",
      description: "Convenience alias for simple.category",
    },
    additionalInfo: {
      type: "string",
      description: "Convenience alias for simple.additionalInfo",
    },
  },
};

const ADDRESS_SCHEMA = {
  type: "object",
  description: "Legal address of the recipient (not the bank).",
  properties: {
    address1: { type: "string" },
    address2: { type: "string" },
    city: { type: "string" },
    region: { type: "string", description: "State / region" },
    state: { type: "string", description: "Alias of region" },
    postalCode: { type: "string" },
    country: { type: "string", description: "ISO 3166-1 alpha-2 (e.g. US)" },
  },
  required: ["address1", "city", "postalCode", "country"],
};

const CURSOR_PAGE_PROPS = {
  limit: {
    type: "integer",
    minimum: 1,
    maximum: 1000,
    description: "Maximum results (1–1000). Mercury defaults to 1000; prefer 100–300 and paginate.",
  },
  order: { type: "string", enum: ["asc", "desc"] },
  start_after: {
    type: "string",
    description: "Exclusive cursor: start after this id (page.nextPage). Cannot combine with end_before.",
  },
  end_before: {
    type: "string",
    description: "Exclusive reverse cursor. Cannot combine with start_after.",
  },
};

export const TOOL_DEFS = [
  {
    name: "list_accounts",
    description:
      "GET /accounts (getAccounts). Paginated accounts for the MERCURY_API_TOKEN org: id, name, nickname, availableBalance, currentBalance, status, kind, type, legalBusinessName, routing/account numbers, dashboardLink. Cursor params: limit, order, start_after, end_before. Distinct from the stock Mercury OAuth MCP.",
    inputSchema: {
      type: "object",
      properties: { ...CURSOR_PAGE_PROPS },
    },
  },
  {
    name: "get_account",
    description:
      "GET /account/{accountId} (getAccount). One account by id in the API-token org (balances, status, kind, legalBusinessName, routing). Use list_accounts to discover ids.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Mercury account id" },
      },
      required: ["accountId"],
    },
  },
  {
    name: "list_transactions",
    description:
      "GET /transactions (listTransactions). Org-level paginated transactions for the token org; pass accountId to filter one or more accounts. Prefer postedStart/postedEnd for dashboard date ranges (postedAt); start/end filter createdAt. Repeat page.nextPage as start_after. Alternate Mercury path GET /account/{accountId}/transactions uses offset pagination and is not wrapped. Prefer a smaller limit (100–300) and paginate.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: {
          description:
            "Optional account id filter (string, comma-separated, or array). Omit for all accounts in this org.",
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        status: {
          description: "pending | sent | cancelled | failed | reversed | blocked (repeatable).",
          oneOf: [
            { type: "string" },
            {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "pending",
                  "sent",
                  "cancelled",
                  "failed",
                  "reversed",
                  "blocked",
                ],
              },
            },
          ],
        },
        search: { type: "string", description: "Search transaction descriptions" },
        start: {
          type: "string",
          description: "Earliest createdAt (YYYY-MM-DD or ISO 8601). Prefer postedStart for dashboard dates.",
        },
        end: {
          type: "string",
          description: "Latest createdAt (YYYY-MM-DD or ISO 8601).",
        },
        postedStart: {
          type: "string",
          description: "Earliest postedAt (YYYY-MM-DD or ISO 8601).",
        },
        postedEnd: {
          type: "string",
          description: "Latest postedAt (YYYY-MM-DD or ISO 8601).",
        },
        cardId: {
          description: "Optional card id filter (string, comma-separated, or array).",
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        mercuryCategory: {
          type: "string",
          description: "Mercury merchant-type category name (not custom categoryId).",
        },
        categoryId: {
          type: "string",
          description: "Custom category UUID from list_categories.",
        },
        start_at: {
          type: "string",
          description: "Inclusive start cursor. Cannot combine with start_after or end_before.",
        },
        ...CURSOR_PAGE_PROPS,
      },
    },
  },
  {
    name: "get_transaction",
    description:
      "GET /transaction/{transactionId} (getTransactionById). One transaction by id (attachments, check images, metadata). Alternate GET /account/{accountId}/transaction/{transactionId} is not wrapped — id is enough.",
    inputSchema: {
      type: "object",
      properties: {
        transactionId: { type: "string" },
      },
      required: ["transactionId"],
    },
  },
  {
    name: "list_recipients",
    description:
      "GET /recipients (getRecipients). Paginated payees for the token org. Prefer this over get_recipient when browsing. Cursor params: limit, order, start_after, end_before.",
    inputSchema: {
      type: "object",
      properties: { ...CURSOR_PAGE_PROPS },
    },
  },
  {
    name: "send_money",
    description:
      "POST /account/{accountId}/transactions (createTransaction). Always listed. Execute refuses unless MERCURY_OPS_ALLOW_SPEND=1 and Jim has explicitly greened spend. Sends ACH, check, or domesticWire immediately. Requires Send Money scope and an IP whitelist. Required: accountId, recipientId, amount, paymentMethod (ach|check|domesticWire), idempotencyKey. Optional: note, externalMemo, purpose (required for domesticWire). Does NOT accept categoryId — categorize AFTER the send with update_transaction_category. Prefer request_send_money. Human approval lives OUTSIDE this connector.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Source Mercury account id" },
        recipientId: { type: "string" },
        amount: {
          type: "number",
          minimum: 0.01,
          description: "Positive USD amount, whole cents (max 2 decimals)",
        },
        paymentMethod: {
          type: "string",
          enum: ["ach", "check", "domesticWire"],
        },
        idempotencyKey: {
          type: "string",
          description: "Required unique key. Retrying the same key will not create a duplicate.",
        },
        note: { type: "string", description: "Internal note (not shown to the recipient)" },
        externalMemo: { type: "string", description: "Memo visible to the recipient" },
        purpose: PURPOSE_SCHEMA,
      },
      required: [
        "accountId",
        "recipientId",
        "amount",
        "paymentMethod",
        "idempotencyKey",
      ],
    },
  },
  {
    name: "request_send_money",
    description:
      "POST /account/{accountId}/request-send-money. Always listed. Execute refuses unless MERCURY_OPS_ALLOW_SPEND=1 and Jim has explicitly greened spend. Queues a send for Mercury dashboard approval. Same money fields as send_money plus idempotencyKey. paymentMethod may include internationalWire (purpose required for domesticWire and internationalWire). Prefer this over send_money when proving a write path. Approval decisions are made in Mercury — not by this connector.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        recipientId: { type: "string" },
        amount: {
          type: "number",
          minimum: 0.01,
          description: "Positive USD amount, whole cents (max 2 decimals)",
        },
        paymentMethod: {
          type: "string",
          enum: ["ach", "check", "domesticWire", "internationalWire"],
        },
        idempotencyKey: { type: "string" },
        note: { type: "string" },
        externalMemo: { type: "string" },
        purpose: PURPOSE_SCHEMA,
      },
      required: [
        "accountId",
        "recipientId",
        "amount",
        "paymentMethod",
        "idempotencyKey",
      ],
    },
  },
  {
    name: "transfer_money",
    description:
      "POST /transfer (createInternalTransfer). Always listed. Execute refuses unless MERCURY_OPS_ALLOW_SPEND=1 and Jim has explicitly greened spend. Moves funds between two Mercury accounts in the same organization. Required: sourceAccountId, destinationAccountId, amount, idempotencyKey. Optional: note. QBO often auto-maps internal transfers as bank transfers.",
    inputSchema: {
      type: "object",
      properties: {
        sourceAccountId: { type: "string" },
        destinationAccountId: { type: "string" },
        amount: {
          type: "number",
          minimum: 0.01,
          description: "Positive USD amount, whole cents (max 2 decimals)",
        },
        idempotencyKey: { type: "string" },
        note: { type: "string" },
      },
      required: [
        "sourceAccountId",
        "destinationAccountId",
        "amount",
        "idempotencyKey",
      ],
    },
  },
  {
    name: "request_transfer_money",
    description:
      "POST /request-transfer (requestTransferMoney). Always listed. Execute refuses unless MERCURY_OPS_ALLOW_SPEND=1 and Jim has explicitly greened spend. Queues an internal transfer for Mercury dashboard approval. Same fields as transfer_money. Prefer this over transfer_money when proving a write path. Approval gates live OUTSIDE this connector.",
    inputSchema: {
      type: "object",
      properties: {
        sourceAccountId: { type: "string" },
        destinationAccountId: { type: "string" },
        amount: {
          type: "number",
          minimum: 0.01,
          description: "Positive USD amount, whole cents (max 2 decimals)",
        },
        idempotencyKey: { type: "string" },
        note: { type: "string" },
      },
      required: [
        "sourceAccountId",
        "destinationAccountId",
        "amount",
        "idempotencyKey",
      ],
    },
  },
  {
    name: "create_recipient",
    description:
      "POST /recipients. Create a payee. Required: name, emails. Optional: nickname, contactEmail, electronicRoutingInfo (ACH / linked external bank such as Chase), domesticWireRoutingInfo, checkInfo. International-wire recipients are typically created via recipient invite or the Mercury dashboard — this tool does not invent that endpoint. Use list_recipients to browse existing payees.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        emails: {
          description: "Recipient notification emails (array or comma-separated)",
          oneOf: [
            { type: "array", items: { type: "string" } },
            { type: "string" },
          ],
        },
        nickname: { type: "string" },
        contactEmail: { type: "string" },
        electronicRoutingInfo: {
          type: "object",
          description:
            "ACH routing. Typical shape for a linked external bank (e.g. Chase). Required when present: accountNumber, routingNumber, electronicAccountType, address.",
          properties: {
            accountNumber: { type: "string" },
            routingNumber: { type: "string" },
            electronicAccountType: {
              type: "string",
              enum: [
                "businessChecking",
                "businessSavings",
                "personalChecking",
                "personalSavings",
              ],
            },
            address: ADDRESS_SCHEMA,
          },
        },
        domesticWireRoutingInfo: {
          type: "object",
          properties: {
            accountNumber: { type: "string" },
            routingNumber: { type: "string" },
            address: ADDRESS_SCHEMA,
          },
        },
        checkInfo: {
          type: "object",
          properties: {
            address: ADDRESS_SCHEMA,
          },
        },
      },
      required: ["name", "emails"],
    },
  },
  {
    name: "get_recipient",
    description:
      "GET /recipient/{id} (getRecipient). One payee by id (confirm routing before send). Prefer list_recipients when browsing.",
    inputSchema: {
      type: "object",
      properties: {
        recipientId: { type: "string" },
      },
      required: ["recipientId"],
    },
  },
  {
    name: "list_categories",
    description:
      "GET /categories. Mercury custom categories (categoryData / categoryId) for update_transaction_category after a send. Distinct from QBO/accounting-integration GL codes (glAllocations).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 1000 },
        order: { type: "string", enum: ["asc", "desc"] },
        start_after: { type: "string" },
        end_before: { type: "string" },
      },
    },
  },
  {
    name: "update_transaction_category",
    description:
      "PATCH /transaction/{transactionId} (updateTransaction). Set categoryId and optional note AFTER a send. createTransaction / PostTransactionAPIRequest has no categoryId or glAllocations. glAllocations (accounting-integration GL codes) are distinct from Mercury custom categories (categoryData) and are not set here. Internal transfers often auto-map in QBO as bank transfers; category may not apply the same way.",
    inputSchema: {
      type: "object",
      properties: {
        transactionId: { type: "string" },
        categoryId: {
          type: "string",
          description: "Mercury custom category id from list_categories",
        },
        note: {
          type: "string",
          description: "Optional. Omit to keep the current note; empty/null clears it.",
        },
      },
      required: ["transactionId", "categoryId"],
    },
  },
];

/**
 * @param {object} [opts]
 * @param {ReturnType<typeof createMercuryClient>} [opts.client]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createToolRunner({
  client,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const mercury = client || createMercuryClient({ env, fetchImpl });

  /**
   * @param {string} name
   * @param {Record<string, unknown>} [args]
   */
  return async function runTool(name, args = {}) {
    if (SPEND_TOOL_SET.has(name) && !isSpendAllowed(env)) {
      throw new Error(spendDisabledMessage(name));
    }
    switch (name) {
      case "list_accounts":
        return mercury.listAccounts(args);
      case "get_account":
        return mercury.getAccount(args);
      case "list_transactions":
        return mercury.listTransactions(args);
      case "get_transaction":
        return mercury.getTransaction(args);
      case "list_recipients":
        return mercury.listRecipients(args);
      case "send_money":
        return mercury.sendMoney(args);
      case "request_send_money":
        return mercury.requestSendMoney(args);
      case "transfer_money":
        return mercury.transferMoney(args);
      case "request_transfer_money":
        return mercury.requestTransferMoney(args);
      case "create_recipient":
        return mercury.createRecipient(args);
      case "get_recipient":
        return mercury.getRecipient(args);
      case "list_categories":
        return mercury.listCategories(args);
      case "update_transaction_category":
        return mercury.updateTransactionCategory(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}

/**
 * @param {object} [opts]
 * @param {ReturnType<typeof createToolRunner>} [opts.runTool]
 * @param {NodeJS.ProcessEnv} [opts.env]
 */
export function createMessageHandler({ runTool, env = process.env } = {}) {
  const dispatch = runTool || createToolRunner({ env });

  /**
   * @param {object} message
   * @returns {Promise<object|null>}
   */
  return async function handleMessage(message) {
    if (!message || message.jsonrpc !== "2.0") return null;
    if (message.method === undefined && message.id === undefined) return null;

    const isNotification = message.id === undefined || message.id === null;
    try {
      if (message.method === "initialize") {
        const requested = message.params && message.params.protocolVersion;
        return result(message, {
          protocolVersion: requested || PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      }
      if (
        message.method === "notifications/initialized" ||
        message.method === "initialized"
      ) {
        return null;
      }
      if (message.method === "ping") {
        return isNotification ? null : result(message, {});
      }
      if (message.method === "tools/list") {
        return result(message, { tools: advertisedTools(env) });
      }
      if (message.method === "tools/call") {
        const name = message.params && message.params.name;
        const args = (message.params && message.params.arguments) || {};
        if (SPEND_TOOL_SET.has(name) && !isSpendAllowed(env)) {
          return result(message, {
            content: [{ type: "text", text: spendDisabledMessage(name) }],
            isError: true,
          });
        }
        try {
          const value = await dispatch(name, args);
          return result(message, {
            content: [{ type: "text", text: JSON.stringify(value) }],
          });
        } catch (err) {
          return result(message, {
            content: [{ type: "text", text: safeErrorMessage(err, env) }],
            isError: true,
          });
        }
      }
      if (isNotification) return null;
      return rpcError(message, -32601, `Method not found: ${message.method}`);
    } catch (err) {
      if (isNotification) return null;
      return rpcError(message, -32603, safeErrorMessage(err, env));
    }
  };
}

function result(message, value) {
  return { jsonrpc: "2.0", id: message.id, result: value };
}

function rpcError(message, code, errMessage) {
  return {
    jsonrpc: "2.0",
    id: message.id ?? null,
    error: { code, message: errMessage },
  };
}

/**
 * Parse stdio bytes: Content-Length framing and newline-delimited JSON.
 * @param {(msg: object) => void} onMessage
 */
export function createStdioParser(onMessage) {
  let buffer = Buffer.alloc(0);

  /**
   * @param {Buffer|string} chunk
   */
  function push(chunk) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (match) {
          const len = Number(match[1]);
          const start = headerEnd + 4;
          if (buffer.length < start + len) return;
          const json = buffer.subarray(start, start + len).toString("utf8");
          buffer = buffer.subarray(start + len);
          emit(json);
          continue;
        }
      }

      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      const line = buffer.subarray(0, nl).toString("utf8").replace(/\r$/, "").trim();
      buffer = buffer.subarray(nl + 1);
      if (!line || /^Content-Length:/i.test(line)) continue;
      emit(line);
    }
  }

  /**
   * @param {string} json
   */
  function emit(json) {
    try {
      onMessage(JSON.parse(json));
    } catch {
      // ignore malformed frames
    }
  }

  return { push };
}

/**
 * @param {object} opts
 * @param {NodeJS.ReadStream|import('node:stream').Readable} opts.stdin
 * @param {NodeJS.WriteStream|import('node:stream').Writable} opts.stdout
 * @param {NodeJS.WriteStream|import('node:stream').Writable} [opts.stderr]
 * @param {ReturnType<typeof createMessageHandler>} [opts.handleMessage]
 * @param {NodeJS.ProcessEnv} [opts.env]
 */
export function startServer({
  stdin,
  stdout,
  stderr,
  handleMessage,
  env = process.env,
}) {
  const handle = handleMessage || createMessageHandler({ env });
  const missing = missingTokenVars(env);
  if (missing.length > 0 && stderr) {
    stderr.write(
      `mercury-ops: missing ${missing.join(", ")}. Set them in Cursor → Plugins → Configure.\n`
    );
  }

  let queue = Promise.resolve();
  const parser = createStdioParser((msg) => {
    queue = queue
      .then(async () => {
        const reply = await handle(msg);
        if (reply) {
          stdout.write(`${JSON.stringify(reply)}\n`);
        }
      })
      .catch((err) => {
        if (stderr) stderr.write(`${safeErrorMessage(err, env)}\n`);
      });
  });

  stdin.on("data", (chunk) => parser.push(chunk));
  return { parser };
}
