import "dotenv/config";
import { configFromEnv } from "./config";
import { OllamaClient, analysisJsonSchema, analyzeEmail } from "./analyze";
import type { SanitizedEmail } from "./types";

const sample: SanitizedEmail = {
  gmailId: "local-check",
  threadId: "local-check",
  from: "Ada <ada@example.com>",
  subject: "Notes for Monday",
  receivedAt: "2026-10-11T09:00:00.000Z",
  body: "Please review the launch notes by Friday 16 October 2026. The staging link is in the doc. Can you reply today?",
  truncated: false,
  gmailLink: "https://mail.google.com/mail/u/0/#all/local-check",
};

async function main(): Promise<void> {
  const config = configFromEnv();
  const client = new OllamaClient({
    baseUrl: config.ollamaBaseUrl,
    model: config.ollamaModel,
    schema: analysisJsonSchema as unknown as Record<string, unknown>,
    networkRetries: config.ollamaNetworkRetries,
    timeoutMs: 120_000,
  });
  const analysis = await analyzeEmail(sample, client, config.ollamaInvalidRetries + 1);
  const visible = {
    model: config.ollamaModel,
    category: analysis.category,
    importance: analysis.importance,
    summary: analysis.summary,
    keyInformation: analysis.keyInformation,
    actionItems: analysis.actionItems,
    deadlines: analysis.deadlines,
    replyNeeded: analysis.replyNeeded,
    aiSummaryAvailable: analysis.aiSummaryAvailable,
    analysisSource: analysis.analysisSource,
    warnings: analysis.warnings,
  };
  console.log(JSON.stringify(visible, null, 2));
  if (!analysis.aiSummaryAvailable) process.exitCode = 1;
}

void main();
