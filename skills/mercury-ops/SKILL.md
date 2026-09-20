---
name: mercury-ops
description: >
  Oforica-scoped Mercury Banking read+write MCP (API token REST): list
  accounts/transactions/recipients, send or queue money, internal transfer,
  create recipient, and set category after a send. Stock Cursor Mercury
  OAuth MCP is OG Holdings-only and cannot see Oforica — do not modify it.
  Prefer request_* over send_money. Jim/agent approval gates live OUTSIDE
  this connector.
---

# Mercury Ops (Oforica read + write)

## When to use this vs stock Mercury

Use **this plugin** (`mercury-ops` / Grok Bot `mercury-ops-oforica`) for the **Oforica** org (API token):

- Accounts and balances (`list_accounts`, `get_account`)
- Transaction lists and detail (`list_transactions`, `get_transaction`)
- Recipient lists and detail (`list_recipients`, `get_recipient`)
- Custom categories (`list_categories`)
- Sending money (`send_money`) or queueing that send (`request_send_money`)
- Moving money between two Mercury accounts (`transfer_money` / `request_transfer_money`)
- Creating a recipient (`create_recipient`)
- Setting a Mercury custom category **after** a send (`update_transaction_category`)

Use **stock Mercury MCP** only for **OG Holdings** OAuth reads. It cannot see Oforica. Do not modify the stock plugin. Do not invent endpoints (no dedicated "linked Chase account" API — that is a recipient).

## Approval gates live outside the connector

Jim / agent policy (who may send, dollar caps, dual control) is **not** implemented here.

- `send_money` and `transfer_money` hit Mercury immediately (Send Money scope; `createTransaction` needs an IP whitelist).
- `request_send_money` and `request_transfer_money` only enqueue a Mercury dashboard approval. Someone else with send-money permission reviews it in Mercury.
- This connector does not approve, reject, or auto-release queued payments.

**Prefer `request_*`** unless the user has explicitly authorized an immediate send.

## QBO / Books categorization (API gap)

`createTransaction` (`send_money`) **does not accept `categoryId` or `glAllocations`**. After a send:

1. Read the returned transaction `id`.
2. Resolve a Mercury custom category via `list_categories`.
3. Call `update_transaction_category` with that `categoryId` (optional `note`).

Notes:

- Mercury custom categories (`categoryData`) are **not** the same as accounting-integration GL codes (`glAllocations`). This tool sets `categoryId` only.
- Internal transfers often auto-map in QBO as bank transfers; category on create may not apply the same way.
- Dashboard QBO enrichment is the fallback if updateTransaction is not enough.

## Linked external bank (e.g. Chase)

There is no special "external account" endpoint. Typical pattern:

1. `create_recipient` with `electronicRoutingInfo` (ACH) for that bank.
2. `request_send_money` (preferred) or `send_money` with `purpose.simple.category = transferToMyExternalAccount` when the payment is a wire-style "to my own external account".

Do not invent a transfer-to-Chase path.

## Tools

| Tool | Mercury call |
| --- | --- |
| `list_accounts` | `GET /accounts` |
| `get_account` | `GET /account/{accountId}` |
| `list_transactions` | `GET /transactions` (optional `accountId`; prefer `postedStart`/`postedEnd`) |
| `get_transaction` | `GET /transaction/{transactionId}` |
| `list_recipients` | `GET /recipients` |
| `get_recipient` | `GET /recipient/{id}` |
| `list_categories` | `GET /categories` |
| `send_money` | `POST /account/{accountId}/transactions` |
| `request_send_money` | `POST /account/{accountId}/request-send-money` |
| `transfer_money` | `POST /transfer` |
| `request_transfer_money` | `POST /request-transfer` |
| `create_recipient` | `POST /recipients` |
| `update_transaction_category` | `PATCH /transaction/{transactionId}` |

Every money-movement tool requires `idempotencyKey`. `purpose` is required for `domesticWire` and `internationalWire`.

`list_transactions` is org-level (`GET /transactions`). Do not call the offset-based `GET /account/{id}/transactions` path — pass `accountId` on `list_transactions` instead. Paginate with `page.nextPage` as `start_after`.

## Auth

`MERCURY_API_TOKEN` is configured in Cursor → Plugins → Configure (Oforica dashboard token, including `secret-token:`). Ori maps `OFORICA_MERCURY_API_TOKEN` → `MERCURY_API_TOKEN` in the Grok Bot launcher. Never ask the user to paste the token into chat. Never log it.

## Workflow (Oforica send + categorize)

1. `list_accounts` / `get_account`: pick `accountId` and check balances.
2. `list_recipients` / `get_recipient`: pick `recipientId`. If the payee does not exist: `create_recipient`.
3. Prefer `request_send_money` unless Jim has authorized an immediate send.
4. After a created transaction exists, `update_transaction_category` for QBO.
5. Confirm with `get_transaction` / `list_transactions` (or the Mercury dashboard approval queue).
