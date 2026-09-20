# mercury-ops-connector

**Mercury Ops** — Phase A stdio MCP for an **API-token Mercury org**: banking **reads + non-spend writes**, plus **gated** money-move tools. Auth is `MERCURY_API_TOKEN` (Bearer `secret-token:…`). Complements the stock Mercury OAuth MCP (separate org / OAuth reads). This repo does not replace or rename that plugin.

Not an official Mercury product. **No Marketplace publish.** Plugin id and process name: **`mercury-ops`** (display name **Mercury Ops**). Do not register this server as bare “Mercury”.

**Phase B (follow-on PR):** accounting extras — categories CRUD, receipt upload, invoices, statements.

## Two Mercury MCPs

| Surface | Org | Auth | Role |
| --- | --- | --- | --- |
| **Stock Mercury MCP** | OAuth org (not the API-token org) | OAuth | Reads for that OAuth session. Do not modify. |
| **Mercury Ops** (`mercury-ops`) | API-token org | `MERCURY_API_TOKEN` | Banking reads + non-spend writes. Spend tools stay **off** until `MERCURY_OPS_ALLOW_SPEND` is set. |

The stock OAuth plugin cannot see the API-token org. Keep both if you need both orgs.

## Dual spend gate

Money-move tools are **implemented but gated off by default**. Both layers must pass:

1. **Flag:** `MERCURY_OPS_ALLOW_SPEND` unset/false → spend tools are **absent from `tools/list`** and `tools/call` returns a clear error (no Mercury request). Set to `1` / `true` / `yes` / `on` only when an authorized operator enables spend.
2. **Operator greenlight:** even when the flag is on, agents must not send or transfer unless a human has authorized that movement. Approval lives **outside** this connector (`request_*` only queues Mercury dashboard review).

Spend tools: `send_money`, `request_send_money`, `transfer_money`, `request_transfer_money`.

## Tools (Phase A)

### Reads (always on)

| Tool | Mercury API |
| --- | --- |
| `list_accounts` | `GET /accounts` |
| `get_account` | `GET /account/{accountId}` |
| `list_transactions` | `GET /transactions` (org-level; optional `accountId`) |
| `get_transaction` | `GET /transaction/{transactionId}` |
| `list_recipients` | `GET /recipients` |
| `get_recipient` | `GET /recipient/{id}` |
| `list_categories` | `GET /categories` (read custom category ids only — not CRUD) |

### Non-spend writes (always on)

| Tool | Mercury API |
| --- | --- |
| `create_recipient` | `POST /recipients` |
| `update_transaction_category` | `PATCH /transaction/{transactionId}` |

### Spend / money-move (implemented, gated)

| Tool | Mercury API |
| --- | --- |
| `send_money` | `POST /account/{accountId}/transactions` |
| `request_send_money` | `POST /account/{accountId}/request-send-money` (prefer this when spend is enabled) |
| `transfer_money` | `POST /transfer` |
| `request_transfer_money` | `POST /request-transfer` |

`createTransaction` does not accept `categoryId`. Categorize after a send with `update_transaction_category`.

## Env

| Variable | Required | Notes |
| --- | --- | --- |
| `MERCURY_API_TOKEN` | yes | Dashboard token, including `secret-token:`. Never log or echo. If the prefix is missing, the server adds it. |
| `MERCURY_OPS_ALLOW_SPEND` | no | Default off. `1`/`true`/`yes`/`on` advertises and executes spend tools. |
| `MERCURY_API_BASE_URL` | no | Defaults to `https://api.mercury.com/api/v1`. |

```http
Authorization: Bearer secret-token:<token-from-dashboard>
```

## Run as stdio MCP (any host)

Node 18+. Zero runtime npm dependencies (`fetch` only).

```bash
export MERCURY_API_TOKEN='secret-token:…'
# leave MERCURY_OPS_ALLOW_SPEND unset until spend is explicitly enabled
node src/index.js
```

JSON-RPC 2.0 on stdin/stdout (newline-delimited; Content-Length frames also accepted). Point any MCP host at that command. Register the server as **`mercury-ops`**, not “Mercury”.

Do not pass the token on argv. The process never prints it.

### Cursor plugin Configure

`.cursor-plugin/plugin.json` + `mcp.json` wire `${MERCURY_API_TOKEN}` and optional `${MERCURY_OPS_ALLOW_SPEND}` into the Node process. Display name is **Mercury Ops**. Keep the stock Mercury OAuth plugin if you still need OAuth-org reads.

### Grok Bot box secrets launcher

`scripts/run-mcp-from-box-secrets.mjs` starts the same stdio server after secrets are already in the environment. It never prints the token.

## Multi-org install example

When one host also runs the stock OAuth Mercury MCP, give this process a distinct server id and an org-scoped secret name that the launcher maps onto `MERCURY_API_TOKEN`:

| Item | Example |
| --- | --- |
| MCP server id | `mercury-ops-oforica` |
| Box secret | `OFORICA_MERCURY_API_TOKEN` |
| Process env the server reads | `MERCURY_API_TOKEN` (mapped by the box secrets launcher) |
| Spend flag | `MERCURY_OPS_ALLOW_SPEND` (still default off) |

The stdio server itself only reads `MERCURY_API_TOKEN` and `MERCURY_OPS_ALLOW_SPEND`.

## Mercury API notes (Phase A)

- **List txns:** wrapped `GET /transactions` (cursor). Not wrapped: offset `GET /account/{id}/transactions`. Pass `accountId` on `list_transactions`.
- **Get txn:** wrapped `GET /transaction/{id}`. Not wrapped: `GET /account/{id}/transaction/{id}`.
- **Category on create:** `PostTransactionAPIRequest` has no `categoryId` / `glAllocations`. `glAllocations` are accounting GL codes; this server sets Mercury `categoryId` only.
- **No linked-bank transfer path.** External bank = recipient + `purpose.simple.category = transferToMyExternalAccount`.
- **Not in Phase A:** categories CRUD, receipt/attachment upload, invoices, statements, cards, treasury, webhooks, users, approval-request lists, recipient invites.

## Tests (no live Mercury)

```bash
npm test
```

Mocked `fetch` only. No production token, no sandbox send, no real money movement. CI is `npm test` with `MERCURY_API_TOKEN` unset.

## License

MIT
