---
name: mercury-ops
description: >
  Mercury Ops — API-token Mercury org banking MCP: accounts,
  transactions, recipients, create recipient, post-send category, and
  spend/transfer tools. Distinct from the stock Mercury OAuth MCP.
  Env flag alone is not Jim green. Never call spend/transfer without
  Jim’s explicit green for that specific action, even if
  MERCURY_OPS_ALLOW_SPEND=1. Flag default off (execute refuse).
  Prefer request_* when proving. No live money in tests. Approval
  lives OUTSIDE this connector. Banking ops only — not an accounting
  ledger.
---

# Mercury Ops (Phase A — API-token org banking)

## Two Mercury surfaces

- **Mercury Ops** (`mercury-ops`): API-token org. Full banking capability is listed. Spend **execute** is gated. Do not call this server “Mercury”.
- **Stock Mercury OAuth MCP:** OAuth-org reads only. Cannot see the API-token org. Do not modify it.

## Dual spend gate (both required)

Spend tools (`send_money`, `request_send_money`, `transfer_money`, `request_transfer_money`) **appear in `tools/list`**. Do not treat listing as permission to execute.

1. **Flag:** `MERCURY_OPS_ALLOW_SPEND` must be `1` (or true/yes/on) or execute refuses. If execute fails with a disabled-until-flag error, stop. Do not retry. Do not ask to flip the flag unless Jim already decided to enable spend.
2. **Jim green for that specific action:** even with the flag on, **never** call send/transfer unless Jim has explicitly greened **that** action. The env flag alone is **not** Jim green. Both are required during oversight, until patterns are proven. Approval lives **outside** this connector.

If either gate fails: refuse and continue with reads / non-spend writes only.

When **both** gates pass, **prefer `request_*`** (Mercury approval queue) over immediate `send_money` / `transfer_money`, especially when proving a path. No live money movement in tests.

This connector does not approve, reject, or auto-release queued payments.

## Always-on execute

**Reads:** `list_accounts`, `get_account`, `list_transactions`, `get_transaction`, `list_recipients`, `get_recipient`, `list_categories`

**Non-spend writes:** `create_recipient`, `update_transaction_category`

`list_transactions` is `GET /transactions` (optional `accountId`; prefer `postedStart`/`postedEnd`). Paginate with `page.nextPage` as `start_after`. This plugin is banking ops only (not an accounting ledger).

## Auth

`MERCURY_API_TOKEN` (API-token org dashboard token, including `secret-token:`). In Cursor, set it under plugin Configure. The Grok Bot box secrets launcher may map an org-scoped alias (see README “Multi-org install example”) onto `MERCURY_API_TOKEN`. Never ask anyone to paste the token into chat. Never log it.

## Workflow

1. `list_accounts` / `get_account` for balances and ids.
2. `list_recipients` / `get_recipient`. Create a payee with `create_recipient` if needed.
3. Stop. Do **not** send or transfer unless `MERCURY_OPS_ALLOW_SPEND=1` **and** Jim greened **that specific** action. Flag on ≠ permission.
4. If both gates pass: prefer `request_send_money` / `request_transfer_money` with `idempotencyKey`. Then `update_transaction_category` if a transaction id exists.
5. Confirm with `get_transaction` / `list_transactions` or the Mercury dashboard.

`purpose` is required for `domesticWire` and `internationalWire`. There is no dedicated “transfer to my external bank” endpoint — that is a recipient + `purpose.simple.category = transferToMyExternalAccount`.
