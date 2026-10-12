import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type { RunKind, RunRecord, RunStage, RunStatus, StoredMessage } from "./types";
import { redact } from "./redact";

type RunRow = {
  id: string;
  kind: RunKind;
  period_start: string;
  period_end: string;
  period_label: string;
  status: RunStatus;
  stage: RunStage;
  filename: string;
  total_fetched: number;
  total_excluded: number;
  total_processed: number;
  total_failed: number;
  ai_count: number;
  fallback_count: number;
  error: string | null;
  note: string | null;
  local_path: string | null;
  drive_file_id: string | null;
  drive_url: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
};

function mapMessage(row: {
  run_id: string;
  gmail_id: string;
  thread_id: string;
  from_addr: string;
  subject: string;
  received_at: string;
  body_text: string;
  truncated: number;
  analysis_json: string | null;
  status: StoredMessage["status"];
  error: string | null;
}): StoredMessage {
  return {
    runId: row.run_id,
    gmailId: row.gmail_id,
    threadId: row.thread_id || "",
    fromAddr: row.from_addr || "",
    subject: row.subject || "",
    receivedAt: row.received_at || "",
    bodyText: row.body_text || "",
    truncated: row.truncated,
    analysisJson: row.analysis_json,
    status: row.status,
    error: row.error,
  };
}

function mapRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    kind: row.kind,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    periodLabel: row.period_label,
    status: row.status,
    stage: row.stage,
    filename: row.filename,
    totalFetched: row.total_fetched,
    totalExcluded: row.total_excluded,
    totalProcessed: row.total_processed,
    totalFailed: row.total_failed,
    aiCount: row.ai_count,
    fallbackCount: row.fallback_count,
    error: row.error,
    note: row.note,
    localPath: row.local_path,
    driveFileId: row.drive_file_id,
    driveUrl: row.drive_url,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
  };
}

export type RunPatch = Partial<{
  status: RunStatus;
  stage: RunStage;
  filename: string;
  totalFetched: number;
  totalExcluded: number;
  totalProcessed: number;
  totalFailed: number;
  aiCount: number;
  fallbackCount: number;
  error: string | null;
  note: string | null;
  localPath: string | null;
  driveFileId: string | null;
  driveUrl: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}>;

const PATCH_COLUMNS: Record<keyof RunPatch, string> = {
  status: "status",
  stage: "stage",
  filename: "filename",
  totalFetched: "total_fetched",
  totalExcluded: "total_excluded",
  totalProcessed: "total_processed",
  totalFailed: "total_failed",
  aiCount: "ai_count",
  fallbackCount: "fallback_count",
  error: "error",
  note: "note",
  localPath: "local_path",
  driveFileId: "drive_file_id",
  driveUrl: "drive_url",
  finishedAt: "finished_at",
  durationMs: "duration_ms",
};

export class MailDb {
  constructor(private readonly db: DatabaseSync) {}

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        period_label TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        filename TEXT NOT NULL,
        total_fetched INTEGER NOT NULL DEFAULT 0,
        total_excluded INTEGER NOT NULL DEFAULT 0,
        total_processed INTEGER NOT NULL DEFAULT 0,
        total_failed INTEGER NOT NULL DEFAULT 0,
        ai_count INTEGER NOT NULL DEFAULT 0,
        fallback_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        note TEXT,
        local_path TEXT,
        drive_file_id TEXT,
        drive_url TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER
      );
      CREATE TABLE IF NOT EXISTS run_messages (
        run_id TEXT NOT NULL,
        gmail_id TEXT NOT NULL,
        thread_id TEXT,
        from_addr TEXT,
        subject TEXT,
        received_at TEXT,
        body_text TEXT,
        truncated INTEGER NOT NULL DEFAULT 0,
        analysis_json TEXT,
        status TEXT NOT NULL,
        error TEXT,
        PRIMARY KEY (run_id, gmail_id)
      );
      CREATE TABLE IF NOT EXISTS included_messages (
        gmail_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        included_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner TEXT,
        acquired_at TEXT,
        run_id TEXT
      );
    `);
    this.db.prepare("INSERT OR IGNORE INTO job_lock (id, owner, acquired_at, run_id) VALUES (1, NULL, NULL, NULL)").run();
  }

  getSettings(): Record<string, string> {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  setSettings(values: Record<string, string>): void {
    const stmt = this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    this.transaction(() => {
      for (const [key, value] of Object.entries(values)) stmt.run(key, value);
    });
  }

  createRun(run: RunRecord): void {
    this.db.prepare(`
      INSERT INTO runs (
        id, kind, period_start, period_end, period_label, status, stage, filename,
        total_fetched, total_excluded, total_processed, total_failed, ai_count, fallback_count,
        error, note, local_path, drive_file_id, drive_url, started_at, finished_at, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id, run.kind, run.periodStart, run.periodEnd, run.periodLabel, run.status, run.stage, run.filename,
      run.totalFetched, run.totalExcluded, run.totalProcessed, run.totalFailed, run.aiCount, run.fallbackCount,
      run.error, run.note, run.localPath, run.driveFileId, run.driveUrl, run.startedAt, run.finishedAt, run.durationMs,
    );
  }

  getRun(id: string): RunRecord | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  listRuns(limit = 30): RunRecord[] {
    const rows = this.db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?").all(limit) as RunRow[];
    return rows.map(mapRun);
  }

  listRunning(): RunRecord[] {
    const rows = this.db.prepare("SELECT * FROM runs WHERE status = 'running'").all() as RunRow[];
    return rows.map(mapRun);
  }

  latestCompletedForLabel(label: string): RunRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM runs WHERE period_label = ? AND status = 'completed' AND kind != 'test' AND drive_file_id IS NOT NULL ORDER BY finished_at DESC LIMIT 1",
    ).get(label) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  lastSuccess(): RunRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM runs WHERE status = 'completed' AND kind != 'test' AND drive_file_id IS NOT NULL ORDER BY finished_at DESC LIMIT 1",
    ).get() as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  latestFailed(): RunRecord | null {
    const row = this.db.prepare(
      `SELECT * FROM runs r
       WHERE r.status = 'failed'
         AND NOT EXISTS (
           SELECT 1 FROM runs c
           WHERE c.period_label = r.period_label
             AND c.status = 'completed'
             AND c.drive_file_id IS NOT NULL
             AND c.started_at > r.started_at
         )
       ORDER BY r.started_at DESC LIMIT 1`,
    ).get() as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  updateRun(id: string, patch: RunPatch): void {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof RunPatch, string][]) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(patch[key] as string | number | null);
      }
    }
    if (!sets.length) return;
    values.push(id);
    this.db.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  deleteRunMessages(runId: string): void {
    this.db.prepare("DELETE FROM run_messages WHERE run_id = ?").run(runId);
  }

  insertMessages(messages: StoredMessage[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO run_messages (
        run_id, gmail_id, thread_id, from_addr, subject, received_at, body_text, truncated, analysis_json, status, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.transaction(() => {
      for (const message of messages) {
        stmt.run(
          message.runId, message.gmailId, message.threadId, message.fromAddr, message.subject,
          message.receivedAt, message.bodyText, message.truncated, message.analysisJson, message.status, message.error,
        );
      }
    });
  }

  listMessages(runId: string): StoredMessage[] {
    const rows = this.db.prepare("SELECT * FROM run_messages WHERE run_id = ? ORDER BY received_at").all(runId) as Parameters<typeof mapMessage>[0][];
    return rows.map(mapMessage);
  }

  updateMessage(runId: string, gmailId: string, patch: { analysisJson?: string | null; status?: string; error?: string | null }): void {
    const sets: string[] = [];
    const values: Array<string | null> = [];
    if (patch.analysisJson !== undefined) {
      sets.push("analysis_json = ?");
      values.push(patch.analysisJson);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      values.push(patch.status);
    }
    if (patch.error !== undefined) {
      sets.push("error = ?");
      values.push(patch.error);
    }
    if (!sets.length) return;
    values.push(runId, gmailId);
    this.db.prepare(`UPDATE run_messages SET ${sets.join(", ")} WHERE run_id = ? AND gmail_id = ?`).run(...values);
  }

  includedSet(ids: string[]): Set<string> {
    if (!ids.length) return new Set();
    const found = new Set<string>();
    const stmt = this.db.prepare("SELECT gmail_id FROM included_messages WHERE gmail_id = ?");
    for (const id of ids) {
      const row = stmt.get(id) as { gmail_id: string } | undefined;
      if (row) found.add(row.gmail_id);
    }
    return found;
  }

  markIncluded(runId: string, ids: string[], at: string): void {
    const stmt = this.db.prepare("INSERT OR IGNORE INTO included_messages (gmail_id, run_id, included_at) VALUES (?, ?, ?)");
    for (const id of ids) stmt.run(id, runId, at);
  }

  addLog(level: "info" | "warn" | "error", message: string, runId?: string, at = new Date().toISOString()): void {
    this.db.prepare("INSERT INTO logs (run_id, level, message, created_at) VALUES (?, ?, ?, ?)").run(
      runId ?? null,
      level,
      redact(message),
      at,
    );
  }

  listLogs(runId?: string, limit = 200): { id: number; runId: string | null; level: string; message: string; createdAt: string }[] {
    const rows = runId
      ? this.db.prepare("SELECT * FROM logs WHERE run_id = ? ORDER BY id DESC LIMIT ?").all(runId, limit)
      : this.db.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT ?").all(limit);
    return (rows as { id: number; run_id: string | null; level: string; message: string; created_at: string }[]).map((row) => ({
      id: row.id,
      runId: row.run_id,
      level: row.level,
      message: row.message,
      createdAt: row.created_at,
    }));
  }

  getLock(): { owner: string | null; acquiredAt: string | null; runId: string | null } {
    const row = this.db.prepare("SELECT owner, acquired_at, run_id FROM job_lock WHERE id = 1").get() as {
      owner: string | null;
      acquired_at: string | null;
      run_id: string | null;
    };
    return { owner: row.owner, acquiredAt: row.acquired_at, runId: row.run_id };
  }

  tryAcquireLock(owner: string, nowIso: string, staleMs: number, isPidAlive: (pid: number) => boolean): boolean {
    let acquired = false;
    this.transaction(() => {
      const row = this.getLock();
      if (row.owner) {
        const age = Date.now() - Date.parse(row.acquiredAt || "");
        const stale = !Number.isFinite(age) || age > staleMs;
        const pid = row.owner.startsWith("pid:") ? Number(row.owner.slice(4)) : NaN;
        const dead = Number.isInteger(pid) && !isPidAlive(pid);
        if (!stale && !dead) return;
      }
      this.db.prepare("UPDATE job_lock SET owner = ?, acquired_at = ?, run_id = NULL WHERE id = 1").run(owner, nowIso);
      acquired = true;
    });
    return acquired;
  }

  touchLock(owner: string, nowIso: string): void {
    this.db.prepare("UPDATE job_lock SET acquired_at = ? WHERE id = 1 AND owner = ?").run(nowIso, owner);
  }

  releaseLock(owner: string): void {
    this.db.prepare("UPDATE job_lock SET owner = NULL, acquired_at = NULL, run_id = NULL WHERE id = 1 AND owner = ?").run(owner);
  }

  clearLock(): void {
    this.db.prepare("UPDATE job_lock SET owner = NULL, acquired_at = NULL, run_id = NULL WHERE id = 1").run();
  }

  transaction(fn: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

export function openDatabase(file: string): MailDb {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  const mail = new MailDb(db);
  mail.migrate();
  return mail;
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function recoverInterruptedRuns(db: MailDb, isPidAlive: (pid: number) => boolean): number {
  const lock = db.getLock();
  const pid = lock.owner?.startsWith("pid:") ? Number(lock.owner.slice(4)) : NaN;
  const heldByLive = Number.isInteger(pid) && isPidAlive(pid);
  if (heldByLive) return 0;
  db.clearLock();
  const running = db.listRunning();
  for (const run of running) {
    db.updateRun(run.id, {
      status: "failed",
      error: "Interrupted before completion. Use retry to resume this run.",
    });
    db.addLog("warn", `Run ${run.id} was interrupted at stage ${run.stage}.`, run.id);
  }
  return running.length;
}
