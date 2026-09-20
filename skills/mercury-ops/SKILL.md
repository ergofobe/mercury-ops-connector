---
name: mercury-ops
description: >
  Mercury Ops — API-token Mercury org banking MCP: accounts,
  transactions, recipients, create recipient, and post-send category.
  Distinct from the stock Mercury OAuth MCP. Spend tools are gated:
  require MERCURY_OPS_ALLOW_SPEND=1 AND an authorized human greenlight.
  Prefer request_* if spend is enabled. Approval lives OUTSIDE this
  connector. Accounting extras (invoices, receipts, category CRUD) are
  Phase B — do not invent those tools here.
---

# Mercury Ops (Phase A — API-token org banking)

## Two Mercury surfaces

- **Mercury Ops** (`mercury-ops`): API-token org. Reads + non-spend writes always on. Spend tools only if both gates pass. Do not call this server “Mercury”.
- **Stock Mercury OAuth MCP:** OAuth-org reads only. Cannot see the API-token org. Do not modify it.

## Dual spend gate (both required)

Spend tools: `send_money`, `request_send_money`, `transfer_money`, `request_transfer_money`.

1. **Flag:** `MERCURY_OPS_ALLOW_SPEND` must be `1` (or true/yes/on). If spend tools are **missing from `tools/list`**, they are disabled. Do not invent them. Do not ask to flip the flag unless an authorized operator already decided to enable spend.
2. **Operator greenlight:** even when the tools are advertised, **do not call them** unless a human has explicitly authorized money movement for this task. Approval lives **outside** this connector.

If either gate fails: refuse, explain that spend is disabled until `MERCURY_OPS_ALLOW_SPEND=1`, and continue with reads / non-spend writes only.

When spend is enabled and authorized, **prefer `request_*`** (Mercury approval queue) over immediate `send_money` / `transfer_money`.

This connector does not approve, reject, or auto-release queued payments.

## Always-on tools

**Reads:** `list_accounts`, `get_account`, `list_transactions`, `get_transaction`, `list_recipients`, `get_recipient`, `list_categories`

**Non-spend writes:** `create_recipient`, `update_transaction_category`

`list_transactions` is `GET /transactions` (optional `accountId`; prefer `postedStart`/`postedEnd`). Paginate with `page.nextPage` as `start_after`. Do not invent Phase B tools (category CRUD, receipt upload, invoices, statements).

## Auth

`MERCURY_API_TOKEN` (API-token org dashboard token, including `secret-token:`). In Cursor, set it under plugin Configure. The Grok Bot box secrets launcher may map an org-scoped alias (see README “Multi-org install example”) onto `MERCURY_API_TOKEN`. Never ask anyone to paste the token into chat. Never log it.

## Workflow (no spend unless both gates pass)

1. `list_accounts` / `get_account` for balances and ids.
2. `list_recipients` / `get_recipient`. Create a payee with `create_recipient` if needed.
3. Stop. Do **not** send or transfer unless both spend gates pass.
4. If spend is enabled and authorized: prefer `request_send_money` / `request_transfer_money` with `idempotencyKey`. Then `update_transaction_category` if a transaction id exists.
5. Confirm with `get_transaction` / `list_transactions` or the Mercury dashboard.

`purpose` is required for `domesticWire` and `internationalWire`. There is no dedicated “transfer to my external bank” endpoint — that is a recipient + `purpose.simple.category = transferToMyExternalAccount`.
