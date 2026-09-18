# mercury-ops-connector

Complementary **Mercury Banking write MCP** (stdio) for Books money movement: send money, queue approvals, internal transfers, recipients, and post-send category.

**Keep [stock Mercury MCP](https://docs.mercury.com/docs/supported-tools-on-mercury-mcp) for reads** — accounts, balances, transactions, recipients, `listCategories`, `listSendMoneyApprovalRequests`. This plugin does not replace or duplicate that surface.

Not an official Mercury product. **No Cursor Marketplace publish.** Owner decides later. Do not merge or install from this scaffold until Jim reviews.

## File tree

```text
.
├── .cursor-plugin/plugin.json   # name, displayName, MERCURY_API_TOKEN (no secrets)
├── mcp.json                     # stdio MCP; env wires ${MERCURY_API_TOKEN} into Node
├── skills/mercury-ops/SKILL.md
├── src/
│   ├── index.js                 # stdio entry
│   ├── server.js                # MCP JSON-RPC + eight tools
│   ├── mercury.js               # fetch + request shapes + validation
│   └── secrets.js               # token check + redaction
├── scripts/run-mcp-from-box-secrets.mjs  # Grok Bot note — Consola wires token later; do not install MCP
├── test/                        # mocked; no live Mercury, no real money movement
├── assets/logo.svg
├── package.json
├── LICENSE                      # MIT
└── README.md
```

No rules, hooks, agents, or commands.

## Tools

| Tool | Mercury API | Notes |
| --- | --- | --- |
| `send_money` | `POST /account/{accountId}/transactions` | Immediate send. `paymentMethod`: `ach` \| `check` \| `domesticWire`. Requires Send Money scope **and IP whitelist**. |
| `request_send_money` | `POST /account/{accountId}/request-send-money` | Approval queue. Same money fields; `paymentMethod` may include `internationalWire`. May **not** need IP whitelist. |
| `transfer_money` | `POST /transfer` | Internal transfer (`createInternalTransfer`). |
| `request_transfer_money` | `POST /request-transfer` | Internal transfer approval queue ([requestTransferMoney](https://docs.mercury.com/reference/requesttransfermoney.md)). |
| `create_recipient` | `POST /recipients` | [createRecipient](https://docs.mercury.com/reference/createrecipient.md). |
| `get_recipient` | `GET /recipient/{id}` | Thin read for write UX only. Prefer stock `getRecipient`. |
| `list_categories` | `GET /categories` | Thin convenience for `update_transaction_category`. **Prefer stock `listCategories`.** |
| `update_transaction_category` | `PATCH /transaction/{transactionId}` | [updateTransaction](https://docs.mercury.com/reference/updatetransaction.md). Set category (optional note) **after** a send. |

`get_account` is **not** included. Use stock Mercury `getAccounts` / `getAccount` for balances.

### Required fields

**`send_money` / `request_send_money`:** `accountId`, `recipientId`, `amount`, `paymentMethod`, `idempotencyKey`. Optional: `note`, `externalMemo`, `purpose` (**required** for `domesticWire`; also for `internationalWire` on `request_send_money`).

**`transfer_money` / `request_transfer_money`:** `sourceAccountId`, `destinationAccountId`, `amount`, `idempotencyKey`. Optional: `note`.

**`create_recipient`:** `name`, `emails`. Optional routing: `electronicRoutingInfo` (ACH), `domesticWireRoutingInfo`, `checkInfo`.

**`update_transaction_category`:** `transactionId`, `categoryId`. Optional: `note`.

`createTransaction` does **not** accept `categoryId` in the OpenAPI body. Categorize after the send.

## Auth

Base URL: `https://api.mercury.com/api/v1`

Authorization header:

```http
Authorization: Bearer secret-token:<token-from-dashboard>
```

The Mercury dashboard token **includes** the `secret-token:` prefix. Store the full value in **`MERCURY_API_TOKEN`** (plugin / env). The server sends `Authorization: Bearer <token>` and never logs or prints it. If the stored value is missing the prefix, the connector adds it.

### Mint a token (Jim)

1. Mercury → organization menu → **All Settings** → **Tokens**.
2. **Create an API Token**. Prefer a **Custom** token with the fewest scopes:
   - **Send Money** — `createTransaction` (`send_money`). **Needs an IP whitelist.**
   - **Request send money / Request transfer money** — approval-queue tools. **May not need an IP whitelist** (dashboard approval is the control).
   - Recipients + transaction metadata if you will create payees and set categories.
3. Copy the token **once**. It should look like `secret-token:mercury_production_…`.
4. Paste it only in **Cursor → Plugins → Configure** (`MERCURY_API_TOKEN`). Never commit it, never paste it into chat, issues, or screenshots.

If you cannot get a static egress IP, use `request_send_money` / `request_transfer_money` instead of immediate `send_money`. See [API token security policies](https://docs.mercury.com/docs/api-token-security-policies.md).

`mcp.json` injects `${MERCURY_API_TOKEN}` into the Node process. The server does not read tokens from argv or files.

## Known Mercury API gaps (QBO / Books)

Documented here so agents do not invent fields or endpoints.

### Category is not on create

`PostTransactionAPIRequest` has **no `categoryId`** and **no `glAllocations`**.

- After `send_money`, call `update_transaction_category` (`PATCH /transaction/{id}`) with a Mercury custom category id.
- Or categorize in the Mercury dashboard so QBO enrichment can pick it up.
- **`glAllocations` are accounting-integration GL codes.** They are distinct from Mercury custom categories (`categoryData`). This connector sets `categoryId` only.

### Internal transfers vs QBO

`POST /transfer` creates paired debit/credit transactions. QBO often **auto-maps these as bank transfers**. Applying a Mercury category on create (or even via update) may **not** apply the same way as an ACH send to a vendor. Prefer letting QBO treat them as transfers unless Books policy says otherwise.

### Linked external bank (e.g. Chase)

There is **no dedicated "linked bank / Chase" transfer endpoint**. Typical Mercury model:

1. The external account is a **recipient** with `electronicRoutingInfo` (ACH) and/or `domesticWireRoutingInfo`.
2. A send uses `purpose.simple.category = transferToMyExternalAccount` when the payment is "to my own external account" (especially wires).

Do not invent a `/transfer-to-external` path. Use `create_recipient` + `send_money` / `request_send_money`.

### What this plugin will not wrap

Stock Mercury already covers: accounts, cards, treasury, txn lists, recipient lists, approval-request lists, invoices, webhooks, users. International-wire **recipient setup** is typically a [recipient invite](https://docs.mercury.com/reference/createrecipientinvite.md) or the dashboard — not invented here.

## Implementation

**Zero runtime npm dependencies.** Node 18+ `fetch` calls Mercury REST. The MCP layer is a small stdio JSON-RPC 2.0 shim (newline-delimited, plus Content-Length read) instead of `@modelcontextprotocol/sdk`.

Jim / agent approval gates live **outside** this connector. `request_*` only enqueues Mercury dashboard review.

`scripts/run-mcp-from-box-secrets.mjs` is a **note / thin wrapper** for a later Grok Bot. Consola will wire `MERCURY_API_TOKEN`. Do **not** install this MCP from that script.

## Install in Cursor (when Jim is ready — not this PR)

1. Clone this repository (or add it as a plugin source). **Do not Marketplace-install.**
2. **Plugins → Configure** → set **Mercury API token**.
3. Restart / reinstall the MCP server so `tools/list` picks up the eight tools.
4. Keep stock Mercury MCP enabled for reads.

Requires **Node 18+**. There is no `npm install`.

## Tests (no live Mercury)

```bash
npm test
```

Requires Node 18+. All `fetch` calls are mocked. Coverage:

- Each write tool request shape (path, method, required fields)
- `Authorization` is `Bearer` with `secret-token:` prefix; tool results and errors never echo the token
- `idempotencyKey` required on all money-movement tools
- `update_transaction_category` PATCH body (`categoryId`, optional `note`)
- `send_money` body has **no** `categoryId`
- Oversize note / amount and other validation errors (no network)

CI runs `npm test` only. No production token, no sandbox send, no real money movement.

## Smoke checklist (WITHOUT live sends)

Do this after Configure is filled. **Do not send or transfer money** in smoke or CI.

1. Token minted; value starts with `secret-token:`; stored only in Plugins → Configure.
2. Restart the MCP server. Ask: *List mercury-ops tools.* Expect the eight names above — not stock `getAccounts` / `listTransactions`.
3. `npm test` is green on a clean checkout (no `MERCURY_API_TOKEN` required for tests).
4. Optional thin read (still not a send): stock Mercury `getAccounts` + this plugin `list_categories` / `get_recipient` on a **known** id. Confirm the token works. Stop there.
5. If a write path must be proven later (Jim only, not CI): use **`request_send_money`** for a tiny amount so it sits in the Mercury approval queue and can be **rejected**. Never use `send_money` as a first smoke.

## Non-goals

- Full Mercury replacement (reads, cards, treasury, invoices, webhooks)
- Marketplace / cursor.directory publish
- Live sends in tests or CI
- Implementing Jim/agent approval policy inside the connector

## License

MIT
