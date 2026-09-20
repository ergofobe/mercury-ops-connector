import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AMOUNT,
  MAX_NOTE_CHARS,
  buildCreateRecipientBody,
  buildListTransactionsQuery,
  buildSendMoneyBody,
  buildTransferBody,
  buildUpdateTransactionBody,
  createMercuryClient,
  inspectMercuryCall,
} from "../src/mercury.js";
import { createToolRunner } from "../src/server.js";
import { safeErrorMessage } from "../src/secrets.js";

const TOKEN = "secret-token:mercury_test_fake_not_real_abc123";
const BARE_TOKEN = "mercury_test_fake_not_real_abc123";

const ACCOUNT = "11111111-1111-1111-1111-111111111111";
const RECIPIENT = "22222222-2222-2222-2222-222222222222";
const DEST = "33333333-3333-3333-3333-333333333333";
const TXN = "44444444-4444-4444-4444-444444444444";
const CATEGORY = "55555555-5555-5555-5555-555555555555";

/**
 * @param {typeof fetch} [respond]
 */
function mockClient(respond) {
  /** @type {{ url: string, init: RequestInit }[]} */
  const calls = [];
  const env = { MERCURY_API_TOKEN: TOKEN };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (respond) return respond(url, init, calls);
    return /** @type {Response} */ ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, id: "mock" }),
    });
  };
  const client = createMercuryClient({ env, fetchImpl });
  const runTool = createToolRunner({ env, fetchImpl });
  return { calls, client, runTool, env };
}

function lastInspect(calls) {
  assert.ok(calls.length > 0, "expected a fetch call");
  return inspectMercuryCall(calls[calls.length - 1]);
}

function assertBearerAuth(inspected, rawCalls) {
  assert.equal(inspected.authScheme, "Bearer");
  assert.equal(inspected.authHasSecretPrefix, true);
  const auth = String(
    rawCalls[rawCalls.length - 1].init.headers.Authorization || ""
  );
  assert.equal(auth.startsWith("Bearer "), true);
  assert.equal(auth.includes("Basic "), false);
  assert.match(auth, /^Bearer secret-token:/);
  assert.doesNotMatch(JSON.stringify(inspected), new RegExp(TOKEN));
}

describe("send_money request shape", () => {
  it("POSTs /account/{id}/transactions with required fields and Bearer auth", async () => {
    const { calls, runTool } = mockClient();
    const result = await runTool("send_money", {
      accountId: ACCOUNT,
      recipientId: RECIPIENT,
      amount: 25.5,
      paymentMethod: "ach",
      idempotencyKey: "pay-jan-1",
      note: "Books bill",
      externalMemo: "Invoice 1042",
    });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "POST");
    assert.equal(inspected.path, `/account/${ACCOUNT}/transactions`);
    assert.deepEqual(inspected.body, {
      recipientId: RECIPIENT,
      amount: 25.5,
      paymentMethod: "ach",
      idempotencyKey: "pay-jan-1",
      note: "Books bill",
      externalMemo: "Invoice 1042",
    });
    assert.equal(inspected.body.categoryId, undefined);
    assert.match(inspected.url, /^https:\/\/api\.mercury\.com\/api\/v1\/account\//);
    assertBearerAuth(inspected, calls);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
    assert.doesNotMatch(JSON.stringify(result), new RegExp(BARE_TOKEN));
  });

  it("requires purpose for domesticWire and nests simple.category", async () => {
    const { calls, runTool } = mockClient();
    await runTool("send_money", {
      accountId: ACCOUNT,
      recipientId: RECIPIENT,
      amount: 100,
      paymentMethod: "domesticWire",
      idempotencyKey: "wire-1",
      purpose: { category: "vendor", additionalInfo: "Acme HVAC" },
    });
    const inspected = lastInspect(calls);
    assert.deepEqual(inspected.body.purpose, {
      simple: { category: "vendor", additionalInfo: "Acme HVAC" },
    });
  });

  it("rejects missing idempotencyKey before fetch", async () => {
    const { calls, runTool } = mockClient();
    await assert.rejects(
      () =>
        runTool("send_money", {
          accountId: ACCOUNT,
          recipientId: RECIPIENT,
          amount: 10,
          paymentMethod: "ach",
        }),
      /idempotencyKey is required/
    );
    assert.equal(calls.length, 0);
  });

  it("drops categoryId even if the caller passes it", () => {
    const body = buildSendMoneyBody({
      recipientId: RECIPIENT,
      amount: 10,
      paymentMethod: "ach",
      idempotencyKey: "no-cat",
      categoryId: CATEGORY,
    });
    assert.equal(Object.hasOwn(body, "categoryId"), false);
  });

  it("rejects internationalWire on send_money", async () => {
    const { calls, runTool } = mockClient();
    await assert.rejects(
      () =>
        runTool("send_money", {
          accountId: ACCOUNT,
          recipientId: RECIPIENT,
          amount: 10,
          paymentMethod: "internationalWire",
          idempotencyKey: "nope",
          purpose: { category: "vendor", additionalInfo: "X" },
        }),
      /paymentMethod must be one of/
    );
    assert.equal(calls.length, 0);
  });
});

describe("request_send_money request shape", () => {
  it("POSTs request-send-money and allows internationalWire", async () => {
    const { calls, runTool } = mockClient();
    await runTool("request_send_money", {
      accountId: ACCOUNT,
      recipientId: RECIPIENT,
      amount: 80,
      paymentMethod: "internationalWire",
      idempotencyKey: "req-wire-1",
      purpose: { simple: { category: "vendor", additionalInfo: "Vendor Ltd" } },
    });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "POST");
    assert.equal(inspected.path, `/account/${ACCOUNT}/request-send-money`);
    assert.equal(inspected.body.paymentMethod, "internationalWire");
    assert.equal(inspected.body.idempotencyKey, "req-wire-1");
    assertBearerAuth(inspected, calls);
  });

  it("requires idempotencyKey", async () => {
    const { calls, client } = mockClient();
    await assert.rejects(
      () =>
        client.requestSendMoney({
          accountId: ACCOUNT,
          recipientId: RECIPIENT,
          amount: 1,
          paymentMethod: "ach",
        }),
      /idempotencyKey is required/
    );
    assert.equal(calls.length, 0);
  });
});

describe("transfer_money request shape", () => {
  it("POSTs /transfer with source, dest, amount, idempotencyKey", async () => {
    const { calls, runTool } = mockClient();
    await runTool("transfer_money", {
      sourceAccountId: ACCOUNT,
      destinationAccountId: DEST,
      amount: 200,
      idempotencyKey: "xfer-1",
      note: "Sweep",
    });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "POST");
    assert.equal(inspected.path, "/transfer");
    assert.deepEqual(inspected.body, {
      sourceAccountId: ACCOUNT,
      destinationAccountId: DEST,
      amount: 200,
      idempotencyKey: "xfer-1",
      note: "Sweep",
    });
    assertBearerAuth(inspected, calls);
  });

  it("requires idempotencyKey", async () => {
    await assert.throws(
      () =>
        buildTransferBody({
          sourceAccountId: ACCOUNT,
          destinationAccountId: DEST,
          amount: 5,
        }),
      /idempotencyKey is required/
    );
  });
});

describe("request_transfer_money request shape", () => {
  it("POSTs /request-transfer", async () => {
    const { calls, runTool } = mockClient();
    await runTool("request_transfer_money", {
      sourceAccountId: ACCOUNT,
      destinationAccountId: DEST,
      amount: 15.01,
      idempotencyKey: "req-xfer-1",
    });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "POST");
    assert.equal(inspected.path, "/request-transfer");
    assert.equal(inspected.body.amount, 15.01);
    assert.equal(inspected.body.idempotencyKey, "req-xfer-1");
    assertBearerAuth(inspected, calls);
  });
});

describe("create_recipient request shape", () => {
  it("POSTs /recipients with electronicRoutingInfo for a linked bank", async () => {
    const { calls, runTool } = mockClient();
    await runTool("create_recipient", {
      name: "Chase Operating",
      emails: ["books@example.com"],
      nickname: "Chase",
      electronicRoutingInfo: {
        accountNumber: "000111222",
        routingNumber: "021000021",
        electronicAccountType: "businessChecking",
        address: {
          address1: "1 Mercury Way",
          city: "San Francisco",
          region: "CA",
          postalCode: "94105",
          country: "US",
        },
      },
    });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "POST");
    assert.equal(inspected.path, "/recipients");
    assert.equal(inspected.body.name, "Chase Operating");
    assert.deepEqual(inspected.body.emails, ["books@example.com"]);
    assert.equal(
      inspected.body.electronicRoutingInfo.electronicAccountType,
      "businessChecking"
    );
    assert.equal(inspected.body.electronicRoutingInfo.routingNumber, "021000021");
    assertBearerAuth(inspected, calls);
  });

  it("requires name and emails before fetch", async () => {
    await assert.throws(() => buildCreateRecipientBody({ emails: ["a@b.com"] }), /name is required/);
    await assert.throws(() => buildCreateRecipientBody({ name: "Acme" }), /emails is required/);
  });
});

describe("list_accounts request shape", () => {
  it("GETs /accounts with cursor pagination", async () => {
    const { calls, runTool } = mockClient();
    await runTool("list_accounts", { limit: 25, order: "desc" });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "GET");
    assert.equal(inspected.path, "/accounts");
    assert.equal(inspected.query.limit, "25");
    assert.equal(inspected.query.order, "desc");
    assert.equal(inspected.body, null);
    assertBearerAuth(inspected, calls);
  });
});

describe("get_account request shape", () => {
  it("GETs /account/{id} with Bearer auth", async () => {
    const { calls, runTool } = mockClient();
    await runTool("get_account", { accountId: ACCOUNT });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "GET");
    assert.equal(inspected.path, `/account/${ACCOUNT}`);
    assert.equal(inspected.body, null);
    assertBearerAuth(inspected, calls);
  });

  it("requires accountId before fetch", async () => {
    const { calls, runTool } = mockClient();
    await assert.rejects(() => runTool("get_account", {}), /accountId is required/);
    assert.equal(calls.length, 0);
  });
});

describe("list_transactions request shape", () => {
  it("GETs org-level /transactions with account and posted date filters", async () => {
    const { calls, runTool } = mockClient();
    await runTool("list_transactions", {
      accountId: ACCOUNT,
      postedStart: "2026-08-01",
      postedEnd: "2026-08-31",
      limit: 100,
      order: "desc",
      status: "sent",
    });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "GET");
    assert.equal(inspected.path, "/transactions");
    assert.equal(inspected.query.accountId, ACCOUNT);
    assert.equal(inspected.query.postedStart, "2026-08-01");
    assert.equal(inspected.query.postedEnd, "2026-08-31");
    assert.equal(inspected.query.limit, "100");
    assert.equal(inspected.query.order, "desc");
    assert.equal(inspected.query.status, "sent");
    assert.equal(inspected.body, null);
    assertBearerAuth(inspected, calls);
  });

  it("repeats accountId query params for multiple accounts", async () => {
    const { calls, runTool } = mockClient();
    await runTool("list_transactions", {
      accountId: [ACCOUNT, DEST],
      status: ["sent", "pending"],
    });
    const inspected = lastInspect(calls);
    assert.deepEqual(inspected.query.accountId, [ACCOUNT, DEST]);
    assert.deepEqual(inspected.query.status, ["sent", "pending"]);
  });

  it("rejects combined cursors and invalid dates before fetch", () => {
    assert.throws(
      () =>
        buildListTransactionsQuery({
          start_after: TXN,
          end_before: CATEGORY,
        }),
      /cannot be combined/
    );
    assert.throws(
      () => buildListTransactionsQuery({ postedStart: "last-month" }),
      /postedStart must be YYYY-MM-DD/
    );
    assert.throws(
      () => buildListTransactionsQuery({ status: "posted" }),
      /status must be one of/
    );
  });
});

describe("get_transaction request shape", () => {
  it("GETs /transaction/{id}", async () => {
    const { calls, runTool } = mockClient();
    await runTool("get_transaction", { transactionId: TXN });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "GET");
    assert.equal(inspected.path, `/transaction/${TXN}`);
    assert.equal(inspected.body, null);
    assertBearerAuth(inspected, calls);
  });
});

describe("list_recipients request shape", () => {
  it("GETs /recipients with cursor pagination", async () => {
    const { calls, runTool } = mockClient();
    await runTool("list_recipients", { limit: 40, start_after: RECIPIENT });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "GET");
    assert.equal(inspected.path, "/recipients");
    assert.equal(inspected.query.limit, "40");
    assert.equal(inspected.query.start_after, RECIPIENT);
    assertBearerAuth(inspected, calls);
  });
});

describe("get_recipient request shape", () => {
  it("GETs /recipient/{id} with Bearer auth", async () => {
    const { calls, runTool } = mockClient();
    await runTool("get_recipient", { recipientId: RECIPIENT });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "GET");
    assert.equal(inspected.path, `/recipient/${RECIPIENT}`);
    assert.equal(inspected.body, null);
    assertBearerAuth(inspected, calls);
  });
});

describe("list_categories request shape", () => {
  it("GETs /categories with optional pagination", async () => {
    const { calls, runTool } = mockClient();
    await runTool("list_categories", { limit: 50, order: "asc" });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "GET");
    assert.equal(inspected.path, "/categories");
    assert.equal(inspected.query.limit, "50");
    assert.equal(inspected.query.order, "asc");
    assertBearerAuth(inspected, calls);
  });
});

describe("update_transaction_category body", () => {
  it("PATCHes /transaction/{id} with categoryId and optional note", async () => {
    const { calls, runTool } = mockClient();
    await runTool("update_transaction_category", {
      transactionId: TXN,
      categoryId: CATEGORY,
      note: "QBO: contractor",
    });
    const inspected = lastInspect(calls);
    assert.equal(inspected.method, "PATCH");
    assert.equal(inspected.path, `/transaction/${TXN}`);
    assert.deepEqual(inspected.body, {
      categoryId: CATEGORY,
      note: "QBO: contractor",
    });
    assertBearerAuth(inspected, calls);
  });

  it("omits note when not provided and requires categoryId", async () => {
    assert.deepEqual(buildUpdateTransactionBody({ categoryId: CATEGORY }), {
      categoryId: CATEGORY,
    });
    assert.throws(() => buildUpdateTransactionBody({}), /categoryId is required/);
  });
});

describe("validation and oversize", () => {
  it("rejects oversize notes and amounts before fetch", async () => {
    const { calls, runTool } = mockClient();
    await assert.rejects(
      () =>
        runTool("send_money", {
          accountId: ACCOUNT,
          recipientId: RECIPIENT,
          amount: 1,
          paymentMethod: "ach",
          idempotencyKey: "big-note",
          note: "x".repeat(MAX_NOTE_CHARS + 1),
        }),
      /note is \d+ characters; max is/
    );
    await assert.rejects(
      () =>
        runTool("transfer_money", {
          sourceAccountId: ACCOUNT,
          destinationAccountId: DEST,
          amount: MAX_AMOUNT + 1,
          idempotencyKey: "too-big",
        }),
      /exceeds the connector maximum/
    );
    assert.equal(calls.length, 0);
  });

  it("rejects amount below one cent and missing purpose on wire", async () => {
    assert.throws(
      () =>
        buildSendMoneyBody({
          recipientId: RECIPIENT,
          amount: 0,
          paymentMethod: "ach",
          idempotencyKey: "z",
        }),
      /amount must be at least/
    );
    assert.throws(
      () =>
        buildSendMoneyBody({
          recipientId: RECIPIENT,
          amount: 10,
          paymentMethod: "domesticWire",
          idempotencyKey: "z",
        }),
      /purpose is required when paymentMethod is domesticWire/
    );
  });

  it("prefixes a bare token so Authorization still uses secret-token:", async () => {
    /** @type {{ url: string, init: RequestInit }[]} */
    const calls = [];
    const runTool = createToolRunner({
      env: { MERCURY_API_TOKEN: BARE_TOKEN },
      fetchImpl: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: "ok" }),
        });
      },
    });
    await runTool("get_recipient", { recipientId: RECIPIENT });
    const auth = String(calls[0].init.headers.Authorization || "");
    assert.equal(auth, `Bearer secret-token:${BARE_TOKEN}`);
  });

  it("redacts the token from HTTP error text", async () => {
    const { runTool, env } = mockClient(async () => {
      return /** @type {Response} */ ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => `denied Bearer ${TOKEN}`,
      });
    });
    await assert.rejects(() => runTool("get_recipient", { recipientId: RECIPIENT }), (err) => {
      const msg = safeErrorMessage(err, env);
      assert.doesNotMatch(msg, new RegExp(TOKEN));
      assert.doesNotMatch(msg, /mercury_test_fake_not_real/);
      assert.match(msg, /401/);
      return true;
    });
  });
});
