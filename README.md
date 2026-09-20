# mercury-ops-connector

**Phase A** stdio MCP: Oforica-scoped Mercury Banking **reads + non-spend writes**, plus **gated** money-move tools. Auth is `MERCURY_API_TOKEN` (Bearer `secret-token:…`). Complements the stock Mercury OAuth MCP, which stays **OG Holdings-only** and is not modified here.

Not an official Mercury product. **No Marketplace publish.**

**Phase B (follow-on PR):** Books/accounting — categories CRUD, receipt upload, invoices, statements. Do not fold those into this repo’s Phase A surface.

## Two Mercury MCPs

| Surface | Org | Auth | Role |
| --- | --- | --- | --- |
| **Stock Mercury MCP** | OG Holdings only | OAuth | Reads. OAuth multi-account cannot see Oforica. Do not modify. |
| **This server** (`mercury-ops` / suggested name **`mercury-ops-oforica`**) | Token org (Oforica) | `MERCURY_API_TOKEN` | Banking reads + non-spend writes. Spend tools exist in code but stay **off** until Jim enables them. |

## Dual spend gate

Money-move tools are **implemented but gated off by default**. Both layers must pass:

1. **Execute refuse / hide:** `MERCURY_OPS_ALLOW_SPEND` unset/false → spend tools are **absent from `tools/list`** and `tools/call` returns a clear error (no Mercury request). Set to `1` / `true` / `yes` / `on` only after Jim explicitly enables spend.
2. **Skill Jim-green:** even when the flag is on, agents must not send or transfer unless Jim has greened that spend. Human approval lives **outside** this connector (`request_*` only queues Mercury dashboard review).

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
| `request_send_money` | `POST /account/{accountId}/request-send-money` (prefer this if Jim greens spend) |
| `transfer_money` | `POST /transfer` |
| `request_transfer_money` | `POST /request-transfer` |

`createTransaction` does not accept `categoryId`. Categorize after a send with `update_transaction_category`.

## Env

| Variable | Required | Notes |
| --- | --- | --- |
| `MERCURY_API_TOKEN` | yes | Dashboard token, including `secret-token:`. Never log or echo. If the prefix is missing, the server adds it. |
| `MERCURY_OPS_ALLOW_SPEND` | no | Default off. `1`/`true`/`yes`/`on` advertises and executes spend tools. |
| `MERCURY_API_BASE_URL` | no | Defaults to `https://api.mercury.com/api/v1`. |
| `OFORICA_MERCURY_API_TOKEN` | no | Ori / Grok Bot launcher alias → `MERCURY_API_TOKEN`. |

```http
Authorization: Bearer secret-token:<token-from-dashboard>
```

## Run as stdio MCP (any host)

Node 18+. Zero runtime npm dependencies (`fetch` only).

```bash
export MERCURY_API_TOKEN='secret-token:…'
# leave MERCURY_OPS_ALLOW_SPEND unset until Jim enables spend
node src/index.js
```

JSON-RPC 2.0 on stdin/stdout (newline-delimited; Content-Length frames also accepted). Point any MCP host at that command. Suggested server name: **`mercury-ops-oforica`**.

Do not pass the token on argv. The process never prints it.

### Host notes (not required)

- **Cursor plugin:** `.cursor-plugin/plugin.json` + `mcp.json` wire `${MERCURY_API_TOKEN}` and optional `${MERCURY_OPS_ALLOW_SPEND}`. Keep the stock Mercury OAuth plugin for OG Holdings.
- **Grok Bot / Ori:** `scripts/run-mcp-from-box-secrets.mjs` maps `OFORICA_MERCURY_API_TOKEN` → `MERCURY_API_TOKEN`. Same spend flag.

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
