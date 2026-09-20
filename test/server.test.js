import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  advertisedTools,
  createMessageHandler,
  createStdioParser,
  createToolRunner,
  isSpendAllowed,
  SERVER_INFO,
  SPEND_TOOL_NAMES,
  TOOL_DEFS,
} from "../src/server.js";

const ALWAYS_ON_TOOL_NAMES = [
  "create_recipient",
  "get_account",
  "get_recipient",
  "get_transaction",
  "list_accounts",
  "list_categories",
  "list_recipients",
  "list_transactions",
  "update_transaction_category",
];

const ALL_TOOL_NAMES = [...ALWAYS_ON_TOOL_NAMES, ...SPEND_TOOL_NAMES].sort();

describe("MCP surface", () => {
  it("always lists full capability including spend tools", async () => {
    const handle = createMessageHandler({
      env: {},
      runTool: async () => {
        throw new Error("should not run");
      },
    });
    const listed = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = listed.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ALL_TOOL_NAMES);
    assert.equal(TOOL_DEFS.length, 13);
    assert.equal(advertisedTools({}).length, 13);
    for (const spend of SPEND_TOOL_NAMES) {
      assert.ok(names.includes(spend));
    }

    const getAccount = listed.result.tools.find((t) => t.name === "get_account");
    assert.deepEqual(getAccount.inputSchema.required, ["accountId"]);

    const listTx = listed.result.tools.find((t) => t.name === "list_transactions");
    assert.match(listTx.description, /GET \/transactions/);

    const categorize = listed.result.tools.find(
      (t) => t.name === "update_transaction_category"
    );
    assert.deepEqual(categorize.inputSchema.required, [
      "transactionId",
      "categoryId",
    ]);
    assert.ok(listed.result.tools.find((t) => t.name === "create_recipient"));
  });

  it("documents spend tool schemas even when the execute flag is off", async () => {
    const handle = createMessageHandler({
      env: {},
      runTool: async () => {
        throw new Error("should not run");
      },
    });
    const listed = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = listed.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ALL_TOOL_NAMES);

    const send = listed.result.tools.find((t) => t.name === "send_money");
    assert.deepEqual(send.inputSchema.required, [
      "accountId",
      "recipientId",
      "amount",
      "paymentMethod",
      "idempotencyKey",
    ]);
    assert.deepEqual(send.inputSchema.properties.paymentMethod.enum, [
      "ach",
      "check",
      "domesticWire",
    ]);
    assert.equal(send.inputSchema.properties.categoryId, undefined);

    const requestSend = listed.result.tools.find(
      (t) => t.name === "request_send_money"
    );
    assert.ok(
      requestSend.inputSchema.properties.paymentMethod.enum.includes(
        "internationalWire"
      )
    );

    const transfer = listed.result.tools.find((t) => t.name === "transfer_money");
    assert.deepEqual(transfer.inputSchema.required, [
      "sourceAccountId",
      "destinationAccountId",
      "amount",
      "idempotencyKey",
    ]);
  });

  it("treats 1/true/yes/on as spend-enabled and anything else as off", () => {
    assert.equal(isSpendAllowed({}), false);
    assert.equal(isSpendAllowed({ MERCURY_OPS_ALLOW_SPEND: "" }), false);
    assert.equal(isSpendAllowed({ MERCURY_OPS_ALLOW_SPEND: "0" }), false);
    assert.equal(isSpendAllowed({ MERCURY_OPS_ALLOW_SPEND: "false" }), false);
    assert.equal(isSpendAllowed({ MERCURY_OPS_ALLOW_SPEND: "1" }), true);
    assert.equal(isSpendAllowed({ MERCURY_OPS_ALLOW_SPEND: "true" }), true);
    assert.equal(isSpendAllowed({ MERCURY_OPS_ALLOW_SPEND: "YES" }), true);
    assert.equal(isSpendAllowed({ MERCURY_OPS_ALLOW_SPEND: "On" }), true);
  });

  it("tools/call on a gated spend tool returns a clear error without dispatch", async () => {
    let called = false;
    const handle = createMessageHandler({
      env: {},
      runTool: async () => {
        called = true;
        throw new Error("should not run");
      },
    });
    const reply = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "send_money",
        arguments: {
          accountId: "acct-1",
          recipientId: "rec-1",
          amount: 1,
          paymentMethod: "ach",
          idempotencyKey: "nope",
        },
      },
    });
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /MERCURY_OPS_ALLOW_SPEND=1/);
    assert.match(reply.result.content[0].text, /Jim's explicit green/);
    assert.equal(called, false);
  });

  it("refuses every spend tool at the handler layer for every off value of the flag", async () => {
    const spendArgs = {
      send_money: { accountId: "a", recipientId: "r", amount: 1, paymentMethod: "ach", idempotencyKey: "k" },
      request_send_money: { accountId: "a", recipientId: "r", amount: 1, paymentMethod: "ach", idempotencyKey: "k" },
      transfer_money: { sourceAccountId: "a", destinationAccountId: "b", amount: 1, idempotencyKey: "k" },
      request_transfer_money: { sourceAccountId: "a", destinationAccountId: "b", amount: 1, idempotencyKey: "k" },
    };
    assert.deepEqual(Object.keys(spendArgs).sort(), [...SPEND_TOOL_NAMES].sort());

    // Includes the literal placeholder a host may leave when the variable is unconfigured.
    const offValues = [undefined, "", "0", "false", "no", "off", "enabled", "${MERCURY_OPS_ALLOW_SPEND}"];
    for (const flag of offValues) {
      let fetched = 0;
      const env = { MERCURY_API_TOKEN: "secret-token:mercury_test_fake" };
      if (flag !== undefined) env.MERCURY_OPS_ALLOW_SPEND = flag;
      const runTool = createToolRunner({
        env,
        fetchImpl: async () => {
          fetched += 1;
          throw new Error("should not fetch");
        },
      });
      const handle = createMessageHandler({ runTool, env });
      for (const name of SPEND_TOOL_NAMES) {
        const reply = await handle({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name, arguments: spendArgs[name] },
        });
        assert.equal(reply.result.isError, true, `${name} with flag ${JSON.stringify(flag)}`);
        assert.match(reply.result.content[0].text, /disabled until MERCURY_OPS_ALLOW_SPEND=1/);
        await assert.rejects(
          () => runTool(name, spendArgs[name]),
          /disabled until MERCURY_OPS_ALLOW_SPEND=1/,
          `${name} runner with flag ${JSON.stringify(flag)}`
        );
      }
      assert.equal(fetched, 0);
    }
  });

  it("initialize and tools/call return JSON-RPC results for always-on tools", async () => {
    const handle = createMessageHandler({
      env: {},
      runTool: async (name, args) => {
        assert.equal(name, "get_account");
        assert.equal(args.accountId, "acct-1");
        return { id: "acct-1", name: "Oforica checking" };
      },
    });
    const init = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    });
    assert.equal(init.result.serverInfo.name, SERVER_INFO.name);
    assert.equal(init.result.protocolVersion, "2025-03-26");

    const call = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_account",
        arguments: { accountId: "acct-1" },
      },
    });
    assert.deepEqual(JSON.parse(call.result.content[0].text), {
      id: "acct-1",
      name: "Oforica checking",
    });
  });

  it("parses Content-Length and newline frames", () => {
    const messages = [];
    const parser = createStdioParser((msg) => messages.push(msg));
    const a = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    parser.push(`Content-Length: ${Buffer.byteLength(a)}\r\n\r\n${a}`);
    parser.push('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    assert.equal(messages.length, 2);
    assert.equal(messages[0].id, 1);
    assert.equal(messages[1].id, 2);
  });
});

describe("createToolRunner wiring", () => {
  it("rejects unknown tools without calling fetch", async () => {
    let called = false;
    const runTool = createToolRunner({
      env: { MERCURY_API_TOKEN: "secret-token:mercury_test_fake" },
      fetchImpl: async () => {
        called = true;
        throw new Error("should not fetch");
      },
    });
    await assert.rejects(() => runTool("get_organization", { accountId: "x" }), /Unknown tool/);
    assert.equal(called, false);
  });

  it("blocks spend tools before fetch when the flag is unset", async () => {
    let called = false;
    const runTool = createToolRunner({
      env: { MERCURY_API_TOKEN: "secret-token:mercury_test_fake" },
      fetchImpl: async () => {
        called = true;
        throw new Error("should not fetch");
      },
    });
    await assert.rejects(
      () =>
        runTool("request_send_money", {
          accountId: "a",
          recipientId: "b",
          amount: 1,
          paymentMethod: "ach",
          idempotencyKey: "k",
        }),
      /disabled until MERCURY_OPS_ALLOW_SPEND=1 and operator has Jim's explicit green/
    );
    assert.equal(called, false);
  });
});
