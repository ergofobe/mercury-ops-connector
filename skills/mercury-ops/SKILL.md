---
name: mercury-ops
description: >
  Oforica-scoped Mercury Banking MCP (API token REST): accounts,
  transactions, recipients, create recipient, and post-send category.
  Stock Mercury OAuth MCP is OG Holdings-only — do not modify it.
  Spend tools are gated: require MERCURY_OPS_ALLOW_SPEND=1 AND Jim
  greenlight. Prefer request_* if spend is enabled. Approval lives
  OUTSIDE this connector. Books/invoices/receipts are Phase B — do
  not invent those tools here.
---

# Mercury Ops (Phase A — Oforica banking)

## Two Mercury surfaces

- **This plugin** (`mercury-ops` / `mercury-ops-oforica`): API-token org **Oforica**. Reads + non-spend writes always on. Spend tools only if both gates pass.
- **Stock Mercury OAuth MCP:** **OG Holdings** reads only. Cannot see Oforica. Do not modify it.

## Dual spend gate (both required)

Spend tools: `send_money`, `request_send_money`, `transfer_money`, `request_transfer_money`.

1. **Flag:** `MERCURY_OPS_ALLOW_SPEND` must be `1` (or true/yes/on). If spend tools are **missing from `tools/list`**, they are disabled. Do not invent them. Do not ask the user to flip the flag unless Jim has already said to enable spend.
2. **Jim-green:** even when the tools are advertised, **do not call them** unless Jim has explicitly greened money movement for this task. Human / Jim approval lives **outside** this connector.

If either gate fails: refuse, explain that spend is disabled until Jim enables it, and continue with reads / non-spend writes only.

When Jim has greened spend, **prefer `request_*`** (Mercury approval queue) over immediate `send_money` / `transfer_money`.

This connector does not approve, reject, or auto-release queued payments.

## Always-on tools

**Reads:** `list_accounts`, `get_account`, `list_transactions`, `get_transaction`, `list_recipients`, `get_recipient`, `list_categories`

**Non-spend writes:** `create_recipient`, `update_transaction_category`

`list_transactions` is `GET /transactions` (optional `accountId`; prefer `postedStart`/`postedEnd`). Paginate with `page.nextPage` as `start_after`. Do not invent Books tools (category CRUD, receipt upload, invoices, statements).

## Auth

`MERCURY_API_TOKEN` (Oforica dashboard token, including `secret-token:`). Ori maps `OFORICA_MERCURY_API_TOKEN` → `MERCURY_API_TOKEN` in the launcher. Never ask anyone to paste the token into chat. Never log it.

## Workflow (no spend unless Jim-green)

1. `list_accounts` / `get_account` for Oforica balances and ids.
2. `list_recipients` / `get_recipient`. Create a payee with `create_recipient` if needed.
3. Stop. Do **not** send or transfer unless both spend gates pass.
4. If Jim greened spend: prefer `request_send_money` / `request_transfer_money` with `idempotencyKey`. Then `update_transaction_category` if a transaction id exists.
5. Confirm with `get_transaction` / `list_transactions` or the Mercury dashboard.

`purpose` is required for `domesticWire` and `internationalWire`. There is no dedicated "transfer to Chase" endpoint — that is a recipient + `purpose.simple.category = transferToMyExternalAccount`.
