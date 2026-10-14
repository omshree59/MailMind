import "dotenv/config";
import path from "path";
import { configFromEnv, applySettings, ensureDataDir, readEnvFile } from "./config";
import { openDatabase, pidAlive, recoverInterruptedRuns } from "./db";
import { ensureOllamaRunning, probeOllama, OllamaClient, analysisJsonSchema } from "./analyze";
import { checkGoogle } from "./google";
import { buildPipelineDeps, createApp, listen } from "./server";
import { startScheduler } from "./scheduler";
import { currentCalendarPeriod, mostRecentSlot, previousReportingPeriod } from "./period";
import { startReport, retryStaleSummaries } from "./pipeline";

async function main(): Promise<void> {
  const envConfig = configFromEnv();
  ensureDataDir(envConfig.dataDir);
  const db = openDatabase(path.join(envConfig.dataDir, "mailmind.sqlite"));
  const recovered = recoverInterruptedRuns(db, pidAlive);
  if (recovered) db.addLog("warn", `Marked ${recovered} interrupted run(s) as failed so they can be retried.`);

  const getConfig = () => applySettings(envConfig, db.getSettings(), readEnvFile());
  let current: Promise<void> | null = null;
  const enqueue = (task: () => Promise<void>) => {
    if (current) return false;
    current = task()
      .catch((error: unknown) => {
        db.addLog("error", error instanceof Error ? error.message : "Report failed.");
      })
      .finally(() => {
        current = null;
      });
    return true;
  };

  const runCatchupIfNeeded = async () => {
    const config = getConfig();
    if (!config.scheduleEnabled || config.catchup !== "auto") return;
    const google = await checkGoogle(config);
    if (google.state !== "connected") return;
    const slot = mostRecentSlot(new Date(), config.timezone, config.hour, config.minute);
    const period = previousReportingPeriod(slot, config.timezone);
    if (db.latestCompletedForLabel(period.label)) return;
    db.addLog("info", `Auto-running daily report for ${period.label}.`);
    enqueue(async () => {
      const activeConfig = getConfig();
      await startReport({
        db,
        config: activeConfig,
        deps: buildPipelineDeps(activeConfig, db),
        lockOwner: `pid:${process.pid}`,
        kind: "scheduled",
        period,
      });
    });
  };

  const scheduler = startScheduler({
    getConfig,
    log: (level, message) => db.addLog(level, message),
    catchupCheck: runCatchupIfNeeded,
    run: async () => {
      const config = getConfig();
      const google = await checkGoogle(config);
      if (google.state !== "connected") {
        db.addLog("warn", "Skipped the scheduled report because Google is not connected.");
        return;
      }
      const queued = enqueue(async () => {
        const activeConfig = getConfig();
        const result = await startReport({
          db,
          config: activeConfig,
          deps: buildPipelineDeps(activeConfig, db),
          lockOwner: `pid:${process.pid}`,
          kind: "scheduled",
          period: previousReportingPeriod(new Date(), activeConfig.timezone),
        });
        if (!result.ok) db.addLog("warn", "Skipped the scheduled report because another run holds the lock.");
      });
      if (!queued) db.addLog("warn", "Skipped the scheduled report because a run is already active.");
    },
  });

  const app = createApp({
    envConfig,
    db,
    getConfig,
    reloadConfig: getConfig,
    enqueue,
    busy: () => current !== null,
    reschedule: (config) => scheduler.reschedule(config),
  });
  const server = listen(app, envConfig.port);

  const config = getConfig();
  const ollama = await ensureOllamaRunning(config.ollamaBaseUrl, config.ollamaModel);
  db.addLog(ollama.ok && ollama.installed ? "info" : "warn", ollama.error || `Ollama model ${config.ollamaModel} is available.`);
  const google = await checkGoogle(config);
  db.addLog(google.state === "connected" ? "info" : "warn", `Google status: ${google.state}.`);

  if (google.state === "connected") {
    // 1. Check if previous reporting slot (yesterday) needs backfill
    const slot = mostRecentSlot(new Date(), config.timezone, config.hour, config.minute);
    const yesterdayPeriod = previousReportingPeriod(slot, config.timezone);
    const yesterdayDone = db.latestCompletedForLabel(yesterdayPeriod.label);
    if (!yesterdayDone) {
      db.addLog("info", `Auto-sync: Generating missed daily report for ${yesterdayPeriod.label} and uploading to Google Drive.`);
      enqueue(async () => {
        const activeConfig = getConfig();
        await startReport({
          db,
          config: activeConfig,
          deps: buildPipelineDeps(activeConfig, db),
          lockOwner: `pid:${process.pid}`,
          kind: "scheduled",
          period: yesterdayPeriod,
        });
      });
    }

    // 2. Also auto-sync today's latest primary emails
    const todayPeriod = currentCalendarPeriod(new Date(), config.timezone);
    db.addLog("info", `Auto-sync: Fetching and summarizing today's latest primary emails (${todayPeriod.label}).`);
    enqueue(async () => {
      const activeConfig = getConfig();
      await startReport({
        db,
        config: activeConfig,
        deps: buildPipelineDeps(activeConfig, db),
        lockOwner: `pid:${process.pid}`,
        kind: "manual",
        period: todayPeriod,
      });
    });
  } else {
    db.addLog("warn", "Google account is not connected yet. Open dashboard to connect Gmail & Google Drive.");
  }

  // 3. Continuous Reactive Summary Retry Engine
  // As soon as Ollama is connected, it automatically retries all emails that failed
  // to get AI summaries, repeating until all are successfully summarized.
  let isRetrying = false;
  let wasOllamaOnline = ollama.ok && ollama.installed;

  const runRetry = async () => {
    if (isRetrying) return;
    const activeConfig = getConfig();
    const fallbackCount = db.countFallbackMessages();
    if (fallbackCount === 0) return;

    // Check if Ollama is online and ready
    const probe = await probeOllama(activeConfig.ollamaBaseUrl, activeConfig.ollamaModel, 3000);
    if (!probe.ok || !probe.installed) return;

    isRetrying = true;
    try {
      const client = new OllamaClient({
        baseUrl: activeConfig.ollamaBaseUrl,
        model: activeConfig.ollamaModel,
        schema: analysisJsonSchema as unknown as Record<string, unknown>,
        networkRetries: activeConfig.ollamaNetworkRetries,
      });

      const result = await retryStaleSummaries({
        db,
        client,
        config: activeConfig,
        probe: () => probeOllama(activeConfig.ollamaBaseUrl, activeConfig.ollamaModel, 3000),
        batchSize: 20,
      });

      if (result.upgraded > 0) {
        console.log(`[MailMind] Upgraded ${result.upgraded}/${result.retried} email summaries with Gemma AI (${result.remaining} remaining)`);
      }

      // If more unsummarized emails remain and Ollama is healthy, immediately queue next batch!
      if (result.remaining > 0 && result.upgraded > 0) {
        setTimeout(() => { void runRetry(); }, 1500);
      }
    } catch (err) {
      db.addLog("warn", `Summary retry batch error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      isRetrying = false;
    }
  };

  // Connection Watchdog: poll every 10 seconds.
  // Detects when Ollama connects or reconnects, and immediately retries all pending summaries.
  const connectionWatchdog = setInterval(async () => {
    try {
      const activeConfig = getConfig();
      const probe = await probeOllama(activeConfig.ollamaBaseUrl, activeConfig.ollamaModel, 2500);
      const isOnline = probe.ok && probe.installed;

      if (isOnline && !wasOllamaOnline) {
        wasOllamaOnline = true;
        db.addLog("info", `🦙 Ollama connection established. Auto-retrying all unsummarized emails with Gemma AI...`);
        console.log("[MailMind] Ollama connection established! Triggering automatic summary retry for all pending emails...");
        void runRetry();
      } else if (!isOnline) {
        wasOllamaOnline = false;
      }

      // If online and there are unsummarized/failed messages, keep retrying
      if (isOnline && db.countFallbackMessages() > 0) {
        void runRetry();
      }
    } catch {
      // Quietly ignore watchdog probe errors
    }
  }, 10_000);

  // Initial startup trigger after 4 seconds (allows initial sync queue to start)
  setTimeout(() => {
    void runRetry();
  }, 4000);

  console.log(`MailMind listening at http://127.0.0.1:${envConfig.port}`);
  const shutdown = () => {
    clearInterval(connectionWatchdog);
    scheduler.stop();
    server.close();
    db.releaseLock(`pid:${process.pid}`);
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
