import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchGmailMessages, isQuotaError, parseGmailMessage, withQuotaRetry, type GmailApi } from "../src/gmail";

describe("Gmail fetch", () => {
  it("parses a plain-text payload and ignores HTML when plain text exists", () => {
    const parsed = parseGmailMessage({
      id: "abc",
      threadId: "thr",
      internalDate: "1760173200000",
      payload: {
        headers: [
          { name: "From", value: "Ada <ada@example.com>" },
          { name: "Subject", value: "Hello" },
        ],
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("Please reply by Friday 16 October 2026.").toString("base64url") } },
          { mimeType: "text/html", body: { data: Buffer.from("<p>Ignore this HTML</p><script>alert(1)</script>").toString("base64") } },
        ],
      },
    });
    assert.ok(parsed);
    assert.match(parsed.body, /Please reply/);
    assert.equal(parsed.body.includes("alert"), false);
    assert.equal(parsed.subject, "Hello");
    assert.equal(parsed.gmailLink, "https://mail.google.com/mail/u/0/#all/abc");
  });

  it("follows pagination, drops duplicate ids, and retries quota errors", async () => {
    let lists = 0;
    const api: GmailApi = {
      async list(args) {
        lists += 1;
        if (lists === 1) throw { code: 429, message: "rateLimitExceeded" };
        if (!args.pageToken) {
          return { data: { messages: [{ id: "a" }, { id: "b" }], nextPageToken: "next" } };
        }
        return { data: { messages: [{ id: "b" }, { id: "c" }], nextPageToken: null } };
      },
      async get(args) {
        return {
          data: {
            id: args.id,
            threadId: "t",
            internalDate: "1760173200000",
            payload: {
              headers: [{ name: "Subject", value: args.id }],
              mimeType: "text/plain",
              body: { data: Buffer.from(`body ${args.id}`).toString("base64url") },
            },
          },
        };
      },
    };
    const messages = await fetchGmailMessages(api, { query: "after:1 before:2", maxMessages: 10, sleep: async () => undefined });
    assert.deepEqual(messages.map((message) => message.gmailId), ["a", "b", "c"]);
    assert.equal(isQuotaError({ code: 403, errors: [{ reason: "userRateLimitExceeded" }] }), true);
    let attempts = 0;
    const value = await withQuotaRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw { code: 429, message: "quota" };
      return "ok";
    }, 4, async () => undefined);
    assert.equal(value, "ok");
    assert.equal(attempts, 3);
  });

  it("excludes promotions, updates, social, and non-inbox messages", () => {
    const promo = parseGmailMessage({
      id: "promo-1",
      labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
      payload: { headers: [{ name: "Subject", value: "50% off sale" }] },
    });
    const update = parseGmailMessage({
      id: "upd-1",
      labelIds: ["INBOX", "CATEGORY_UPDATES"],
      payload: { headers: [{ name: "Subject", value: "Automated update" }] },
    });
    const primary = parseGmailMessage({
      id: "pri-1",
      labelIds: ["INBOX", "CATEGORY_PERSONAL"],
      payload: {
        headers: [{ name: "Subject", value: "Project kickoff" }],
        mimeType: "text/plain",
        body: { data: Buffer.from("Let's meet tomorrow.").toString("base64url") },
      },
    });
    assert.equal(promo, null);
    assert.equal(update, null);
    assert.ok(primary);
    assert.equal(primary.gmailId, "pri-1");
  });
});

