import fs from "fs";
import path from "path";
import express from "express";
import type { Server } from "http";
import type { AppConfig } from "./config";
import { extractGoogleCredentials, sanitizeSettings, settingsFromConfig, updateEnvCredentials } from "./config";
import type { MailDb } from "./db";
import { OllamaClient, analysisJsonSchema, probeOllama } from "./analyze";
import { checkGoogle, authUrl, disconnectGoogle, exchangeCode, fetchPeriodMessages, driveApi } from "./google";
import { createRootFolder, uploadReport } from "./drive";
import { localReportSaver, startReport, type PipelineDeps } from "./pipeline";
import { renderReportDocx } from "./docx-report";
import { missedPeriodLabel, nextScheduledInstant, periodFromDates, previousReportingPeriod } from "./period";
import type { RunKind } from "./types";

export type AppRuntime = {
  envConfig: AppConfig;
  db: MailDb;
  getConfig: () => AppConfig;
  reloadConfig: () => AppConfig;
  enqueue: (task: () => Promise<void>) => boolean;
  busy: () => boolean;
  reschedule: (config: AppConfig) => void;
};

export function buildPipelineDeps(config: AppConfig, db?: MailDb): PipelineDeps {
  const client = new OllamaClient({
    baseUrl: config.ollamaBaseUrl,
    model: config.ollamaModel,
    schema: analysisJsonSchema as unknown as Record<string, unknown>,
    networkRetries: config.ollamaNetworkRetries,
  });
  return {
    now: () => new Date(),
    fetchMessages: (period, max) => fetchPeriodMessages(config, period, max),
    client,
    probe: () => probeOllama(config.ollamaBaseUrl, config.ollamaModel),
    renderDocx: renderReportDocx,
    saveLocal: localReportSaver(path.join(config.dataDir, "reports")),
    upload: async (args) => {
      const api = await driveApi(config);
      let rootFolderId = config.driveFolderId;
      if (!rootFolderId && db) {
        const created = await createRootFolder(api);
        rootFolderId = created.id;
        db.setSettings({ GOOGLE_DRIVE_FOLDER_ID: rootFolderId });
        db.addLog("info", `Initialized MailMind Google Drive folder (${rootFolderId}).`);
      }
      try {
        return await uploadReport(api, { ...args, rootFolderId });
      } catch (error) {
        if (db && error instanceof Error && error.name === "DrivePermissionError") {
          const fallbackFolder = await createRootFolder(api);
          db.setSettings({ GOOGLE_DRIVE_FOLDER_ID: fallbackFolder.id });
          db.addLog("warn", `Configured Drive folder was not writable; switched to MailMind Reports folder (${fallbackFolder.id}).`);
          return await uploadReport(api, { ...args, rootFolderId: fallbackFolder.id });
        }
        throw error;
      }
    },
    isPidAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function createApp(runtime: AppRuntime): express.Express {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/api/health", async (_req, res) => {
    const config = runtime.getConfig();
    const [ollama, google] = await Promise.all([
      probeOllama(config.ollamaBaseUrl, config.ollamaModel),
      checkGoogle(config),
    ]);
    res.json({ ollama, google });
  });

  app.get("/api/status", async (_req, res) => {
    const config = runtime.getConfig();
    const [ollama, google] = await Promise.all([
      probeOllama(config.ollamaBaseUrl, config.ollamaModel),
      checkGoogle(config),
    ]);
    const next = config.scheduleEnabled
      ? nextScheduledInstant(new Date(), config.timezone, config.hour, config.minute).toISOString()
      : null;
    const missedLabel = config.scheduleEnabled && config.catchup !== "off"
      ? missedPeriodLabel(new Date(), config.timezone, config.hour, config.minute)
      : null;
    const missedDone = missedLabel ? runtime.db.latestCompletedForLabel(missedLabel) : null;
    const current = runtime.db.listRunning()[0] ?? null;
    res.json({
      config: settingsFromConfig(config),
      ollama,
      google,
      scheduleEnabled: config.scheduleEnabled,
      nextRunAt: next,
      lastSuccess: runtime.db.lastSuccess(),
      latestReport: runtime.db.lastSuccess(),
      currentRun: current,
      busy: runtime.busy() || Boolean(current),
      failedRun: runtime.db.latestFailed(),
      missed: missedLabel && !missedDone ? { periodLabel: missedLabel } : null,
      runs: runtime.db.listRuns(20),
    });
  });

  app.get("/api/settings", (_req, res) => {
    res.json(settingsFromConfig(runtime.getConfig()));
  });

  app.put("/api/settings", (req, res) => {
    try {
      const patch = sanitizeSettings(req.body ?? {});
      runtime.db.setSettings(patch);
      const config = runtime.reloadConfig();
      runtime.reschedule(config);
      runtime.db.addLog("info", "Settings updated.");
      res.json(settingsFromConfig(config));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid settings." });
    }
  });

  app.post("/api/google/credentials", (req, res) => {
    try {
      const { clientId, clientSecret } = extractGoogleCredentials(req.body ?? {});
      runtime.db.setSettings({
        GOOGLE_CLIENT_ID: clientId,
        GOOGLE_CLIENT_SECRET: clientSecret,
      });
      try {
        updateEnvCredentials(clientId, clientSecret);
      } catch {
        // SQLite settings remain authoritative if .env is read-only.
      }
      const config = runtime.reloadConfig();
      runtime.db.addLog("info", "Google OAuth client credentials saved.");
      res.json({
        saved: true,
        clientId: config.googleClientId,
        redirectUri: config.googleRedirectUri,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid Google credentials." });
    }
  });

  app.post("/api/google/disconnect", (_req, res) => {
    disconnectGoogle(runtime.getConfig());
    runtime.db.addLog("info", "Disconnected Google account.");
    res.json({ disconnected: true });
  });

  app.get("/oauth/start", (_req, res) => {
    const config = runtime.getConfig();
    if (!config.googleClientId || !config.googleClientSecret) {
      res.status(400).send("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env before connecting Google.");
      return;
    }
    res.redirect(authUrl(config));
  });

  app.get("/oauth/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      res.status(400).send("Google did not return an authorization code.");
      return;
    }
    try {
      const config = runtime.getConfig();
      await exchangeCode(config, code);
      runtime.db.addLog("info", "Google account connected.");
      const updatedConfig = runtime.reloadConfig();
      runtime.reschedule(updatedConfig);
      const period = previousReportingPeriod(new Date(), updatedConfig.timezone);
      runtime.enqueue(async () => {
        const activeConfig = runtime.getConfig();
        await startReport({
          db: runtime.db,
          config: activeConfig,
          deps: buildPipelineDeps(activeConfig, runtime.db),
          lockOwner: `pid:${process.pid}`,
          kind: "manual",
          period,
        });
      });
      res.redirect("/");
    } catch (error) {
      runtime.db.addLog("error", "Google connection failed.");
      res.status(400).send(error instanceof Error ? error.message : "Google connection failed.");
    }
  });

  app.post("/api/drive/folder", async (_req, res) => {
    try {
      const config = runtime.getConfig();
      const created = await createRootFolder(await driveApi(config));
      runtime.db.setSettings({ GOOGLE_DRIVE_FOLDER_ID: created.id });
      runtime.reloadConfig();
      runtime.db.addLog("info", "Created the MailMind Google Drive folder.");
      res.json({ id: created.id });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Could not create the Drive folder." });
    }
  });

  app.get("/api/runs/:id/docx", (req, res) => {
    const run = runtime.db.getRun(req.params.id);
    if (!run || !run.localPath || !fs.existsSync(run.localPath)) {
      res.status(404).json({ error: "Local report file is not available for this run." });
      return;
    }
    res.download(run.localPath, run.filename);
  });

  app.get("/api/logs", (req, res) => {
    const runId = typeof req.query.runId === "string" ? req.query.runId : undefined;
    res.json(runtime.db.listLogs(runId));
  });

  app.post("/api/runs", async (req, res) => {
    const body = (req.body ?? {}) as { mode?: string; from?: string; to?: string; runId?: string; limit?: number };
    const mode = body.mode || "now";
    let kind: RunKind = "manual";
    if (mode === "test") kind = "test";
    if (mode === "retry") kind = "retry";
    if (mode === "scheduled") kind = "scheduled";
    const config = runtime.getConfig();
    let period;
    try {
      period = body.from && body.to
        ? periodFromDates(body.from, body.to, config.timezone)
        : previousReportingPeriod(new Date(), config.timezone);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid date range." });
      return;
    }
    const resumeRunId = kind === "retry" ? body.runId || runtime.db.latestFailed()?.id : undefined;
    if (kind === "retry" && !resumeRunId) {
      res.status(400).json({ error: "There is no failed run to retry." });
      return;
    }
    const google = await checkGoogle(config);
    if (google.state !== "connected") {
      const message = google.state === "revoked" ? google.message : "Connect Google before running a report.";
      res.status(400).json({ error: message });
      return;
    }
    const limit = kind === "test" ? Math.min(body.limit || config.testEmailLimit, 10) : null;
    const queued = runtime.enqueue(async () => {
      const activeConfig = runtime.getConfig();
      const result = await startReport({
        db: runtime.db,
        config: activeConfig,
        deps: buildPipelineDeps(activeConfig, runtime.db),
        lockOwner: `pid:${process.pid}`,
        kind: kind === "retry" ? "manual" : kind,
        period: resumeRunId ? periodFromRun(runtime, resumeRunId) : period,
        resumeRunId,
        limit,
      });
      if (!result.ok) runtime.db.addLog("warn", "A report is already running.");
    });
    if (!queued) {
      res.status(409).json({ error: "A report is already running." });
      return;
    }
    res.status(202).json({ started: true, kind, periodLabel: period.label });
  });

  return app;
}

function periodFromRun(runtime: AppRuntime, runId: string) {
  const run = runtime.db.getRun(runId);
  if (!run) return previousReportingPeriod(new Date(), runtime.getConfig().timezone);
  return {
    start: new Date(run.periodStart),
    end: new Date(run.periodEnd),
    label: run.periodLabel,
    year: run.periodLabel.slice(0, 4),
    month: run.periodLabel.slice(5, 7),
  };
}

export function listen(app: express.Express, port: number): Server {
  return app.listen(port, "127.0.0.1");
}

