---
name: mercury-ops
description: >
  Complementary Mercury Banking write MCP for Books money movement: send
  money, queue approval, internal transfer, create recipient, and set
  category after a send. Use stock Mercury MCP for accounts, balances,
  transactions, recipient lists, listCategories, and list approval
  requests. Jim/agent approval gates live OUTSIDE this connector.
---

# Mercury Ops (write)

## When to use this vs stock Mercury

Use **this plugin** when the task is one of:

- Sending money to a recipient (`send_money`) or queueing that send for Mercury dashboard approval (`request_send_money`)
- Moving money between two Mercury accounts (`transfer_money`) or queueing that transfer (`request_transfer_money`)
- Creating a new recipient (`create_recipient`)
- Confirming one recipient before a send (`get_recipient`) — thin write-UX read only
- Setting a Mercury custom category on a transaction **after** a send (`update_transaction_category`, optionally via `list_categories`)

Use **stock Mercury MCP** for everything else:

- Accounts and balances (`getAccounts`, `getAccount`)
- Transaction lists and detail
- Recipient lists (`getRecipients`) — prefer stock over this plugin's thin `get_recipient`
- Custom categories browse (`listCategories`) — prefer stock over this plugin's `list_categories`
- Send-money approval request lists (`listSendMoneyApprovalRequests`)
- Cards, treasury, users, invoices, webhooks

Do **not** treat this plugin as a Mercury replacement. Do **not** invent endpoints (no dedicated "linked Chase account" API — that is a recipient).

## Approval gates live outside the connector

Jim / agent policy (who may send, dollar caps, dual control) is **not** implemented here.

- `send_money` and `transfer_money` hit Mercury immediately (Send Money scope; `createTransaction` needs an IP whitelist).
- `request_send_money` and `request_transfer_money` only enqueue a Mercury dashboard approval. Someone else with send-money permission reviews it in Mercury.
- This connector does not approve, reject, or auto-release queued payments.

If the user has not explicitly authorized a live send, prefer `request_*` so the payment sits in the approval queue.

## QBO / Books categorization (API gap)

`createTransaction` (`send_money`) **does not accept `categoryId` or `glAllocations`**. After a send:

1. Read the returned transaction `id`.
2. Resolve a Mercury custom category via stock `listCategories` (preferred) or this plugin's `list_categories`.
3. Call `update_transaction_category` with that `categoryId` (optional `note`).

Notes:

- Mercury custom categories (`categoryData`) are **not** the same as accounting-integration GL codes (`glAllocations`). This tool sets `categoryId` only.
- Internal transfers often auto-map in QBO as bank transfers; category on create may not apply the same way.
- Dashboard QBO enrichment is the fallback if updateTransaction is not enough.

## Linked external bank (e.g. Chase)

There is no special "external account" endpoint. Typical pattern:

1. `create_recipient` with `electronicRoutingInfo` (ACH) for that bank.
2. `send_money` / `request_send_money` with `purpose.simple.category = transferToMyExternalAccount` when the payment is a wire-style "to my own external account".

Do not invent a transfer-to-Chase path.

## Tools

| Tool | Mercury call |
| --- | --- |
| `send_money` | `POST /account/{accountId}/transactions` |
| `request_send_money` | `POST /account/{accountId}/request-send-money` |
| `transfer_money` | `POST /transfer` |
| `request_transfer_money` | `POST /request-transfer` |
| `create_recipient` | `POST /recipients` |
| `get_recipient` | `GET /recipient/{id}` |
| `list_categories` | `GET /categories` |
| `update_transaction_category` | `PATCH /transaction/{transactionId}` |

Every money-movement tool requires `idempotencyKey`. `purpose` is required for `domesticWire` and `internationalWire`.

## Auth

`MERCURY_API_TOKEN` is configured in Cursor → Plugins → Configure. The value from the Mercury dashboard includes the `secret-token:` prefix. Never ask the user to paste the token into chat. Never log it.

## Workflow (Books send + categorize)

1. Stock Mercury: pick `accountId` (balance check) and `recipientId`.
2. If the payee does not exist: `create_recipient` (ACH / wire / check routing as needed).
3. Prefer `request_send_money` unless Jim has authorized an immediate send.
4. After a created transaction exists, `update_transaction_category` for QBO.
5. Use stock Mercury to confirm the txn / approval-request status.
