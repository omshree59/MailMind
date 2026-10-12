import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it } from "node:test";
import { configFromEnv } from "../src/config";
import { openDatabase, recoverInterruptedRuns } from "../src/db";
import { startReport, type PipelineDeps } from "../src/pipeline";
import { previousReportingPeriod } from "../src/period";
import type { ChatClient } from "../src/analyze";
import type { SanitizedEmail } from "../src/types";
import { renderReportDocx } from "../src/docx-report";

function email(id: string): SanitizedEmail {
  return {
    gmailId: id,
    threadId: `t-${id}`,
    from: "Ada <ada@example.com>",
    subject: `Subject ${id}`,
    receivedAt: "2026-10-11T09:00:00.000Z",
    body: "Please review the launch notes by Friday 16 October 2026.",
    truncated: false,
    gmailLink: `https://mail.google.com/mail/u/0/#all/${id}`,
  };
}

function harness(messages: SanitizedEmail[], uploadImpl?: PipelineDeps["upload"]) {
  const db = openDatabase(":memory:");
  const config = configFromEnv({ REPORT_TIMEZONE: "UTC", SCHEDULE_ENABLED: "false", DATA_DIR: os.tmpdir() });
  const period = previousReportingPeriod(new Date("2026-10-12T12:00:00.000Z"), "UTC");
  let uploads = 0;
  let completes = 0;
  const client: ChatClient = {
    async complete() {
      completes += 1;
      return JSON.stringify({
        category: "Work",
        importance: "High",
        summary: "Ada asked for the launch notes to be reviewed.",
        keyInformation: ["Launch notes"],
        actionItems: ["Review the launch notes"],
        deadlines: ["by Friday 16 October 2026"],
        replyNeeded: true,
      });
    },
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mailmind-"));
  const deps: PipelineDeps = {
    now: () => new Date("2026-10-12T12:00:00.000Z"),
    fetchMessages: async () => messages,
    client,
    probe: async () => ({ ok: true, installed: true }),
    renderDocx: renderReportDocx,
    saveLocal: async (filename, data) => {
      const full = path.join(dir, filename);
      fs.writeFileSync(full, data);
      return full;
    },
    upload: uploadImpl ?? (async (args) => {
      uploads += 1;
      return { fileId: "drive-1", url: "https://drive.google.com/file/d/drive-1/view" };
    }),
    isPidAlive: () => true,
  };
  return { db, config, period, deps, dir, counts: { get uploads() { return uploads; }, get completes() { return completes; } } };
}

describe("report pipeline", () => {
  it("excludes messages already included in a completed report", async () => {
    const first = harness([email("a"), email("b")]);
    const done = await startReport({ db: first.db, config: first.config, deps: first.deps, lockOwner: "test-a", kind: "manual", period: first.period });
    assert.equal(done.ok, true);
    if (!done.ok) return;
    assert.equal(done.run.status, "completed");
    assert.equal(done.run.driveFileId, "drive-1");
    assert.equal(done.run.totalProcessed, 2);

    const again = await startReport({ db: first.db, config: first.config, deps: first.deps, lockOwner: "test-b", kind: "manual", period: first.period });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.alreadyComplete, true);
    assert.equal(first.counts.uploads, 1);
  });

  it("does not mark a run successful when upload fails, then resumes without new analysis", async () => {
    let fail = true;
    let uploads = 0;
    const { db, config, deps, period, counts } = harness([email("c")], async () => {
      uploads += 1;
      if (fail) throw new Error("upload failed");
      return { fileId: "drive-2", url: "https://drive.google.com/file/d/drive-2/view" };
    });
    const failed = await startReport({ db, config, deps, lockOwner: "owner-1", kind: "manual", period });
    assert.equal(failed.ok, true);
    if (!failed.ok) return;
    assert.equal(failed.run.status, "failed");
    assert.equal(failed.run.stage, "docx_saved");
    assert.equal(failed.run.driveFileId, null);
    assert.equal(db.includedSet(["c"]).size, 0);
    const analyzedCalls = counts.completes;

    fail = false;
    const retried = await startReport({
      db,
      config,
      deps,
      lockOwner: "owner-1",
      kind: "retry",
      period,
      resumeRunId: failed.run.id,
    });
    assert.equal(retried.ok, true);
    if (!retried.ok) return;
    assert.equal(retried.run.status, "completed");
    assert.equal(retried.run.driveFileId, "drive-2");
    assert.equal(counts.completes, analyzedCalls);
    assert.equal(uploads, 2);
    assert.equal(db.includedSet(["c"]).has("c"), true);
  });

  it("marks AI summaries unavailable when the model probe fails", async () => {
    const setup = harness([email("d")]);
    setup.deps.probe = async () => ({ ok: false, installed: false, error: "down" });
    const result = await startReport({ db: setup.db, config: setup.config, deps: setup.deps, lockOwner: "probe", kind: "manual", period: setup.period });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.run.fallbackCount, 1);
    assert.equal(result.run.aiCount, 0);
    assert.equal(result.run.status, "completed");
    const stored = setup.db.listMessages(result.run.id)[0];
    assert.match(stored.analysisJson || "", /AI summary unavailable/);
  });

  it("refuses to overlap two runs", async () => {
    const setup = harness([email("e")]);
    assert.equal(setup.db.tryAcquireLock("pid:999999", new Date().toISOString(), 60_000, () => true), true);
    const blocked = await startReport({ db: setup.db, config: setup.config, deps: setup.deps, lockOwner: "other", kind: "manual", period: setup.period });
    assert.deepEqual(blocked, { ok: false, reason: "locked" });
  });

  it("marks an interrupted run failed without clearing a live lock", () => {
    const db = openDatabase(":memory:");
    const config = configFromEnv({ REPORT_TIMEZONE: "UTC" });
    const period = previousReportingPeriod(new Date("2026-10-12T12:00:00.000Z"), "UTC");
    db.createRun({
      id: "run-dead",
      kind: "scheduled",
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      periodLabel: period.label,
      status: "running",
      stage: "fetched",
      filename: "MailMind_Report_x.docx",
      totalFetched: 1,
      totalExcluded: 0,
      totalProcessed: 0,
      totalFailed: 0,
      aiCount: 0,
      fallbackCount: 0,
      error: null,
      note: null,
      localPath: null,
      driveFileId: null,
      driveUrl: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
    });
    db.tryAcquireLock("pid:424242", new Date().toISOString(), 60_000, () => true);
    const recovered = recoverInterruptedRuns(db, (pid) => pid === process.pid);
    assert.equal(recovered, 1);
    assert.equal(db.getRun("run-dead")?.status, "failed");
    assert.equal(db.getLock().owner, null);
    void config;
  });
});
