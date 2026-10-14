import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { MailDb } from "./db";
import type { AppConfig } from "./config";
import type { ChatClient } from "./analyze";
import { analyzeEmail, executiveSummary, OllamaUnavailable } from "./analyze";
import { ruleAnalyze } from "./fallback";
import type { EmailAnalysis, Period, RunKind, RunRecord, SanitizedEmail } from "./types";
import type { ReportEmail, ReportInput } from "./docx-report";

const STALE_MS = 30 * 60 * 1000;

export type PipelineDeps = {
  now: () => Date;
  fetchMessages: (period: Period, maxMessages: number) => Promise<SanitizedEmail[]>;
  client: ChatClient | null;
  probe: () => Promise<{ ok: boolean; installed: boolean; error?: string }>;
  renderDocx: (input: ReportInput) => Promise<Buffer>;
  saveLocal: (filename: string, data: Buffer) => Promise<string>;
  upload: (args: { filename: string; data: Buffer; year: string; month: string; dateFolder?: string }) => Promise<{ fileId: string; url: string }>;
  isPidAlive: (pid: number) => boolean;
};

export type StartResult =
  | { ok: true; run: RunRecord; alreadyComplete?: boolean }
  | { ok: false; reason: "locked" };

function filenameFor(kind: RunKind, label: string, id: string, taken: boolean): string {
  const safe = label.replace(/[^0-9A-Za-z_\-]/g, "");
  if (kind === "test") return `MailMind_Report_${safe}_test-${id.slice(0, 8)}.docx`;
  if (taken) return `MailMind_Report_${safe}_update-${id.slice(0, 8)}.docx`;
  return `MailMind_Report_${safe}.docx`;
}

function toReportEmail(message: {
  gmailId: string;
  fromAddr: string;
  subject: string;
  receivedAt: string;
  analysisJson: string | null;
  error: string | null;
  status: string;
}): ReportEmail | null {
  if (!message.analysisJson) return null;
  const analysis = JSON.parse(message.analysisJson) as EmailAnalysis;
  return {
    ...analysis,
    gmailId: message.gmailId,
    from: message.fromAddr,
    subject: message.subject,
    receivedAt: message.receivedAt,
    gmailLink: `https://mail.google.com/mail/u/0/#all/${message.gmailId}`,
    error: message.error,
  };
}

export async function startReport(options: {
  db: MailDb;
  config: AppConfig;
  deps: PipelineDeps;
  lockOwner: string;
  kind: RunKind;
  period: Period;
  resumeRunId?: string;
  limit?: number | null;
}): Promise<StartResult> {
  const { db, deps, lockOwner } = options;
  const acquired = db.tryAcquireLock(lockOwner, deps.now().toISOString(), STALE_MS, deps.isPidAlive);
  if (!acquired) return { ok: false, reason: "locked" };
  try {
    db.touchLock(lockOwner, deps.now().toISOString());
    const run = options.resumeRunId
      ? await resumeExisting(options)
      : await createOrReuse(options);
    if (!run) {
      const existing = db.latestCompletedForLabel(options.period.label);
      if (!existing) throw new Error("Report was already complete but no Drive file was recorded.");
      return { ok: true, run: existing, alreadyComplete: true };
    }
    const finished = await execute(options.db, options.config, options.deps, run, lockOwner);
    return { ok: true, run: finished };
  } finally {
    db.releaseLock(lockOwner);
  }
}

async function createOrReuse(options: {
  db: MailDb;
  config: AppConfig;
  deps: PipelineDeps;
  kind: RunKind;
  period: Period;
  limit?: number | null;
}): Promise<RunRecord | null> {
  const { db, deps, period, kind } = options;
  const maxMessages = kind === "test" ? Math.max((options.limit ?? 3) * 5, 15) : options.config.gmailMaxMessages;
  const fetched = await deps.fetchMessages(period, maxMessages);
  const included = kind === "test" ? new Set<string>() : db.includedSet(fetched.map((message) => message.gmailId));
  const fresh = fetched.filter((message) => !included.has(message.gmailId));
  const limited = kind === "test" ? fresh.slice(0, options.limit ?? 3) : fresh;
  const existing = db.latestCompletedForLabel(period.label);
  if (kind !== "test" && limited.length === 0 && existing) return null;

  const id = randomUUID();
  const taken = Boolean(existing);
  const now = deps.now().toISOString();
  const run: RunRecord = {
    id,
    kind,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    periodLabel: period.label,
    status: "running",
    stage: "fetched",
    filename: filenameFor(kind, period.label, id, taken),
    totalFetched: fetched.length,
    totalExcluded: fetched.length - fresh.length,
    totalProcessed: 0,
    totalFailed: 0,
    aiCount: 0,
    fallbackCount: 0,
    error: null,
    note: null,
    localPath: null,
    driveFileId: null,
    driveUrl: null,
    startedAt: now,
    finishedAt: null,
    durationMs: null,
  };
  db.createRun(run);
  db.insertMessages(
    limited.map((message) => ({
      runId: id,
      gmailId: message.gmailId,
      threadId: message.threadId,
      fromAddr: message.from,
      subject: message.subject,
      receivedAt: message.receivedAt,
      bodyText: message.body,
      truncated: message.truncated ? 1 : 0,
      analysisJson: null,
      status: "pending",
      error: null,
    })),
  );
  db.addLog("info", `Fetched ${fetched.length} messages, ${limited.length} queued, ${run.totalExcluded} excluded.`, id);
  return run;
}

async function resumeExisting(options: {
  db: MailDb;
  deps: PipelineDeps;
  resumeRunId?: string;
}): Promise<RunRecord> {
  const run = options.db.getRun(options.resumeRunId || "");
  if (!run) throw new Error("The run to retry does not exist.");
  if (run.status === "completed" && run.driveFileId) return run;
  options.db.updateRun(run.id, { status: "running", error: null });
  options.db.addLog("info", `Resuming run at stage ${run.stage}.`, run.id);
  return { ...run, status: "running", error: null };
}

async function execute(
  db: MailDb,
  config: AppConfig,
  deps: PipelineDeps,
  run: RunRecord,
  lockOwner: string,
): Promise<RunRecord> {
  try {
    if (run.stage === "created") {
      throw new Error("Run has no fetched messages to resume.");
    }
    let current = db.getRun(run.id)!;
    if (current.stage === "fetched") {
      current = await analyzeStage(db, config, deps, current, lockOwner);
    }
    current = db.getRun(run.id)!;
    if (current.stage === "analyzed" || (current.stage === "docx_saved" && !current.localPath)) {
      current = await documentStage(db, config, deps, current);
    }
    current = db.getRun(run.id)!;
    if (current.stage === "docx_saved" || current.stage === "uploaded") {
      current = await uploadStage(db, deps, current);
    }
    return db.getRun(run.id)!;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report failed.";
    const latest = db.getRun(run.id);
    db.updateRun(run.id, { status: "failed", error: message });
    db.addLog("error", message, run.id);
    return db.getRun(run.id)!;
  }
}

async function analyzeStage(
  db: MailDb,
  config: AppConfig,
  deps: PipelineDeps,
  run: RunRecord,
  lockOwner: string,
): Promise<RunRecord> {
  const probe = await deps.probe();
  let client = probe.ok && probe.installed ? deps.client : null;
  if (!client) {
    db.addLog("warn", probe.error || "Ollama is unavailable. AI summaries will be marked unavailable.", run.id);
  }
  let unavailableStreak = 0;
  const messages = db.listMessages(run.id);
  for (const message of messages) {
    if (message.status === "analyzed" && message.analysisJson) continue;
    db.touchLock(lockOwner, deps.now().toISOString());
    const email: SanitizedEmail = {
      gmailId: message.gmailId,
      threadId: message.threadId,
      from: message.fromAddr,
      subject: message.subject,
      receivedAt: message.receivedAt,
      body: message.bodyText,
      truncated: message.truncated === 1,
      gmailLink: `https://mail.google.com/mail/u/0/#all/${message.gmailId}`,
    };
    try {
      const analysis = client
        ? await analyzeEmail(email, client, config.ollamaInvalidRetries + 1)
        : ruleAnalyze(email);
      if (!analysis.aiSummaryAvailable) unavailableStreak += 1;
      else unavailableStreak = 0;
      if (unavailableStreak >= 3) client = null;
      db.updateMessage(run.id, message.gmailId, { status: "analyzed", analysisJson: JSON.stringify(analysis), error: null });
    } catch (error) {
      if (error instanceof OllamaUnavailable) {
        const analysis = ruleAnalyze(email);
        db.updateMessage(run.id, message.gmailId, { status: "analyzed", analysisJson: JSON.stringify(analysis), error: null });
        unavailableStreak += 1;
        if (unavailableStreak >= 3) client = null;
      } else {
        const messageText = error instanceof Error ? error.message : "Analysis failed.";
        db.updateMessage(run.id, message.gmailId, { status: "failed", error: messageText });
        db.addLog("error", `Message ${message.gmailId} failed analysis.`, run.id);
      }
    }
  }
  const analyzed = db.listMessages(run.id);
  const aiCount = analyzed.filter((item) => item.analysisJson && (JSON.parse(item.analysisJson) as EmailAnalysis).aiSummaryAvailable).length;
  const failed = analyzed.filter((item) => item.status === "failed").length;
  db.updateRun(run.id, {
    stage: "analyzed",
    totalProcessed: analyzed.filter((item) => item.status === "analyzed").length,
    totalFailed: failed,
    aiCount,
    fallbackCount: analyzed.filter((item) => item.status === "analyzed").length - aiCount,
  });
  return db.getRun(run.id)!;
}

async function documentStage(db: MailDb, config: AppConfig, deps: PipelineDeps, run: RunRecord): Promise<RunRecord> {
  const messages = db.listMessages(run.id);
  const emails = messages.map(toReportEmail).filter((item): item is ReportEmail => Boolean(item));
  const failed = messages
    .filter((item) => item.status === "failed")
    .map((item) => ({
      gmailId: item.gmailId,
      from: item.fromAddr,
      subject: item.subject,
      receivedAt: item.receivedAt,
      gmailLink: `https://mail.google.com/mail/u/0/#all/${item.gmailId}`,
      error: item.error,
      category: "Other" as const,
      importance: "Low" as const,
      summary: "AI summary unavailable.",
      keyInformation: [],
      actionItems: [],
      deadlines: [],
      replyNeeded: false,
      aiSummaryAvailable: false,
      analysisSource: "rules" as const,
      warnings: [],
    }));
  const summary = await executiveSummary({
    label: run.periodLabel,
    messages: emails,
    failed: failed.length,
    client: deps.client,
    invalidAttempts: config.ollamaInvalidRetries + 1,
  });
  const buffer = await deps.renderDocx({
    periodLabel: run.periodLabel,
    timezone: config.timezone,
    generatedAt: deps.now().toISOString(),
    executiveSummary: summary.text,
    executiveSummarySource: summary.source,
    emails,
    excludedCount: run.totalExcluded,
    failed,
    runNote: run.note,
  });
  const localPath = await deps.saveLocal(run.filename, buffer);
  db.updateRun(run.id, { stage: "docx_saved", localPath });
  db.addLog("info", `Saved local report ${run.filename}.`, run.id);
  return db.getRun(run.id)!;
}

async function uploadStage(db: MailDb, deps: PipelineDeps, run: RunRecord): Promise<RunRecord> {
  if (!run.localPath || !fs.existsSync(run.localPath)) {
    throw new Error("Local report file is missing, so the upload was not marked successful.");
  }
  const data = fs.readFileSync(run.localPath);
  const [year, month] = run.periodLabel.slice(0, 7).split("-");
  const uploaded = await deps.upload({
    filename: run.filename,
    data,
    year: year || "unknown",
    month: month || "00",
    dateFolder: run.periodLabel,
  });
  const finishedAt = deps.now().toISOString();
  const durationMs = Date.parse(finishedAt) - Date.parse(run.startedAt);
  db.transaction(() => {
    db.updateRun(run.id, {
      status: "completed",
      stage: "completed",
      driveFileId: uploaded.fileId,
      driveUrl: uploaded.url,
      finishedAt,
      durationMs,
      error: null,
    });
    if (run.kind !== "test") {
      const ids = db.listMessages(run.id).filter((item) => item.status === "analyzed").map((item) => item.gmailId);
      db.markIncluded(run.id, ids, finishedAt);
    }
  });
  db.addLog("info", `Upload confirmed for file ${uploaded.fileId}.`, run.id);
  return db.getRun(run.id)!;
}

export function localReportSaver(directory: string): (filename: string, data: Buffer) => Promise<string> {
  return async (filename, data) => {
    fs.mkdirSync(directory, { recursive: true });
    const full = path.join(directory, filename);
    fs.writeFileSync(full, data);
    return full;
  };
}

/**
 * Retry AI summaries for messages that previously fell back to rule-based analysis.
 * Called automatically on startup (once Ollama is confirmed online) and periodically.
 * Upgrades fallback summaries to real AI summaries without re-running the full pipeline.
 */
export async function retryStaleSummaries(options: {
  db: MailDb;
  client: ChatClient;
  config: AppConfig;
  probe: () => Promise<{ ok: boolean; installed: boolean; error?: string }>;
  batchSize?: number;
}): Promise<{ retried: number; upgraded: number; skipped: number; remaining: number }> {
  const { db, client, config, probe } = options;
  const batchSize = options.batchSize ?? 50;

  // First check that Ollama is actually available
  const status = await probe();
  if (!status.ok || !status.installed) {
    return { retried: 0, upgraded: 0, skipped: 0, remaining: db.countFallbackMessages() };
  }

  const fallbackMessages = db.listFallbackMessages(batchSize);
  if (fallbackMessages.length === 0) {
    return { retried: 0, upgraded: 0, skipped: 0, remaining: 0 };
  }

  db.addLog("info", `Retrying AI summaries for ${fallbackMessages.length} message(s) that need AI analysis.`);

  let upgraded = 0;
  let skipped = 0;
  let consecutiveFailures = 0;

  for (const msg of fallbackMessages) {
    if (consecutiveFailures >= 3) {
      // Check if Ollama itself went down
      const check = await probe();
      if (!check.ok) {
        db.addLog("warn", `Pausing summary retry batch: Ollama is offline (${check.error || "unavailable"}).`);
        skipped += fallbackMessages.length - (upgraded + skipped);
        break;
      }
      consecutiveFailures = 0;
    }

    const email: SanitizedEmail = {
      gmailId: msg.gmailId,
      threadId: msg.threadId,
      from: msg.fromAddr,
      subject: msg.subject,
      receivedAt: msg.receivedAt,
      body: msg.bodyText,
      truncated: msg.truncated === 1,
      gmailLink: `https://mail.google.com/mail/u/0/#all/${msg.gmailId}`,
    };

    try {
      const analysis = await analyzeEmail(email, client, config.ollamaInvalidRetries + 1);
      if (analysis.aiSummaryAvailable) {
        db.updateMessage(msg.runId, msg.gmailId, {
          status: "analyzed",
          analysisJson: JSON.stringify(analysis),
          error: null,
        });
        upgraded++;
        consecutiveFailures = 0;

        // Update run stats
        const run = db.getRun(msg.runId);
        if (run) {
          db.updateRun(msg.runId, {
            aiCount: run.aiCount + 1,
            fallbackCount: Math.max(0, run.fallbackCount - 1),
          });
        }
      } else {
        consecutiveFailures++;
        skipped++;
      }
    } catch {
      consecutiveFailures++;
      skipped++;
    }
  }

  const remaining = db.countFallbackMessages();
  if (upgraded > 0) {
    db.addLog("info", `Summary retry batch complete: ${upgraded} upgraded to AI. Remaining needing AI: ${remaining}.`);
  }

  return { retried: fallbackMessages.length, upgraded, skipped, remaining };
}

/**
 * Retry a single email summary on-demand (e.g. from UI "Retry with Gemma AI" button).
 */
export async function retrySingleSummary(options: {
  db: MailDb;
  client: ChatClient;
  config: AppConfig;
  gmailId: string;
}): Promise<EmailAnalysis> {
  const { db, client, config, gmailId } = options;
  const msg = db.getMessageByGmailId(gmailId);
  if (!msg) {
    throw new Error(`Message ${gmailId} not found in database.`);
  }

  const email: SanitizedEmail = {
    gmailId: msg.gmailId,
    threadId: msg.threadId,
    from: msg.fromAddr,
    subject: msg.subject,
    receivedAt: msg.receivedAt,
    body: msg.bodyText,
    truncated: msg.truncated === 1,
    gmailLink: `https://mail.google.com/mail/u/0/#all/${msg.gmailId}`,
  };

  const analysis = await analyzeEmail(email, client, config.ollamaInvalidRetries + 1);
  db.updateMessage(msg.runId, msg.gmailId, {
    status: "analyzed",
    analysisJson: JSON.stringify(analysis),
    error: null,
  });

  const run = db.getRun(msg.runId);
  if (run && analysis.aiSummaryAvailable) {
    db.updateRun(msg.runId, {
      aiCount: run.aiCount + 1,
      fallbackCount: Math.max(0, run.fallbackCount - 1),
    });
  }

  return analysis;
}
