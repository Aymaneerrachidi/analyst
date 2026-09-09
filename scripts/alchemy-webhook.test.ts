import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { receiveAlchemyWebhook, MAX_WEBHOOK_BYTES } from "../lib/indexer/alchemy-webhook";

const settings = { signingKey: "test-only-signing-key", webhookId: "wh_test", network: "test-robinhood-network" };
const payload = { id: "event1", webhookId: settings.webhookId, createdAt: "2026-09-09T00:00:00.000Z", type: "ADDRESS_ACTIVITY", event: { network: settings.network, activity: [{ hash: `0x${"1".repeat(64)}`, blockNum: "0x123", fromAddress: `0x${"2".repeat(40)}`, toAddress: `0x${"3".repeat(40)}` }] } };
function request(body: string, signature = createHmac("sha256", settings.signingKey).update(body).digest("hex")) {
  return new Request("https://example.test/api/webhooks/alchemy", { method: "POST", body, headers: { "x-alchemy-signature": signature } });
}

test("valid signed activity is persisted before acknowledgment", async () => {
  let saved = false;
  const response = await receiveAlchemyWebhook(request(JSON.stringify(payload)), settings, async (id, event) => { assert.equal(id, "wh_test:event1"); assert.equal(event.event.activity.length, 1); saved = true; });
  assert.equal(saved, true);
  assert.equal(response.status, 200);
});
test("forged or altered payload cannot enter the inbox", async () => {
  const response = await receiveAlchemyWebhook(request(JSON.stringify(payload), "0".repeat(64)), settings, async () => assert.fail("must not save"));
  assert.equal(response.status, 401);
});
test("valid signature cannot authorize a different network or webhook", async () => {
  for (const altered of [{ ...payload, webhookId: "other" }, { ...payload, event: { ...payload.event, network: "ETH_MAINNET" } }]) {
    const response = await receiveAlchemyWebhook(request(JSON.stringify(altered)), settings, async () => assert.fail("must not save"));
    assert.equal(response.status, 400);
  }
});
test("database failure returns retryable failure instead of losing an event", async () => {
  const response = await receiveAlchemyWebhook(request(JSON.stringify(payload)), settings, async () => { throw new Error("offline"); });
  assert.equal(response.status, 503);
});
test("body size is bounded even without content-length", async () => {
  const response = await receiveAlchemyWebhook(request("a".repeat(MAX_WEBHOOK_BYTES + 1)), settings, async () => assert.fail("must not save"));
  assert.equal(response.status, 413);
});
test("missing configuration fails closed", async () => {
  const response = await receiveAlchemyWebhook(request(JSON.stringify(payload)), { ...settings, signingKey: "" }, async () => assert.fail("must not save"));
  assert.equal(response.status, 503);
});
