import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  missingTokenVars,
  normalizeApiToken,
  requireApiToken,
  safeErrorMessage,
  TOKEN_PREFIX,
} from "../src/secrets.js";
import { createMessageHandler, createToolRunner } from "../src/server.js";

const SECRET = "secret-token:mercury_test_fake_do_not_echo_9911";
const BARE = "mercury_test_fake_do_not_echo_9911";

describe("token config never echoes secrets", () => {
  it("requireApiToken lists the var name only", () => {
    const env = {};
    assert.deepEqual(missingTokenVars(env), ["MERCURY_API_TOKEN"]);
    assert.throws(
      () => requireApiToken(env),
      (err) => {
        assert.match(err.message, /MERCURY_API_TOKEN/);
        assert.doesNotMatch(err.message, /mercury_test_fake/);
        assert.doesNotMatch(err.message, /secret-token:/);
        return true;
      }
    );
  });

  it("normalizeApiToken adds secret-token: when missing", () => {
    assert.equal(normalizeApiToken(BARE), `${TOKEN_PREFIX}${BARE}`);
    assert.equal(normalizeApiToken(SECRET), SECRET);
  });

  it("safeErrorMessage redacts env values, bearer tokens, and secret-token forms", () => {
    const env = { MERCURY_API_TOKEN: SECRET };
    const raw = new Error(
      `authorization=Bearer ${SECRET} secret-token:${BARE} boom`
    );
    const msg = safeErrorMessage(raw, env);
    assert.doesNotMatch(msg, /mercury_test_fake_do_not_echo/);
    assert.doesNotMatch(msg, new RegExp(SECRET));
    assert.match(
      msg,
      /\[MERCURY_API_TOKEN\]|\[redacted-credential\]|Bearer \[redacted\]|secret-token:\[redacted\]/
    );
  });

  it("tools/call error content never includes the token", async () => {
    const env = { MERCURY_API_TOKEN: SECRET };
    const runTool = createToolRunner({
      env,
      fetchImpl: async () => {
        throw new Error(`upstream Bearer ${SECRET} MERCURY_API_TOKEN=${SECRET}`);
      },
    });
    const handle = createMessageHandler({ runTool, env });
    const reply = await handle({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "get_recipient",
        arguments: { recipientId: "rec-1" },
      },
    });
    const text = reply.result.content[0].text;
    assert.equal(reply.result.isError, true);
    assert.doesNotMatch(text, new RegExp(SECRET));
    assert.doesNotMatch(text, /mercury_test_fake/);
  });
});
