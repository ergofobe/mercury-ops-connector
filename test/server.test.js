import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createMessageHandler,
  createStdioParser,
  createToolRunner,
  SERVER_INFO,
  TOOL_DEFS,
} from "../src/server.js";

const TOOL_NAMES = [
  "create_recipient",
  "get_recipient",
  "list_categories",
  "request_send_money",
  "request_transfer_money",
  "send_money",
  "transfer_money",
  "update_transaction_category",
];

describe("MCP surface", () => {
  it("lists exactly the eight write tools", async () => {
    const handle = createMessageHandler({
      runTool: async () => {
        throw new Error("should not run");
      },
    });
    const listed = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = listed.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, TOOL_NAMES);
    assert.equal(TOOL_DEFS.length, 8);

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

    const categorize = listed.result.tools.find(
      (t) => t.name === "update_transaction_category"
    );
    assert.deepEqual(categorize.inputSchema.required, [
      "transactionId",
      "categoryId",
    ]);
  });

  it("initialize and tools/call return JSON-RPC results", async () => {
    const handle = createMessageHandler({
      runTool: async (name, args) => {
        assert.equal(name, "send_money");
        assert.equal(args.accountId, "acct-1");
        assert.equal(args.idempotencyKey, "idem-1");
        return { id: "txn-1", status: "pending" };
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
        name: "send_money",
        arguments: {
          accountId: "acct-1",
          recipientId: "rec-1",
          amount: 12.34,
          paymentMethod: "ach",
          idempotencyKey: "idem-1",
        },
      },
    });
    assert.deepEqual(JSON.parse(call.result.content[0].text), {
      id: "txn-1",
      status: "pending",
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
    await assert.rejects(() => runTool("get_account", { accountId: "x" }), /Unknown tool/);
    assert.equal(called, false);
  });
});
