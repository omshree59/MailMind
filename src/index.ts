import "dotenv/config";
import path from "path";
import { configFromEnv, applySettings, ensureDataDir, readEnvFile } from "./config";
import { openDatabase, pidAlive, recoverInterruptedRuns } from "./db";
import { probeOllama } from "./analyze";
import { checkGoogle } from "./google";
import { buildPipelineDeps, createApp, listen } from "./server";
import { startScheduler } from "./scheduler";
import { mostRecentSlot, previousReportingPeriod } from "./period";
import { startReport } from "./pipeline";

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
  const ollama = await probeOllama(config.ollamaBaseUrl, config.ollamaModel);
  db.addLog(ollama.ok && ollama.installed ? "info" : "warn", ollama.error || `Ollama model ${config.ollamaModel} is available.`);
  const google = await checkGoogle(config);
  db.addLog(google.state === "connected" ? "info" : "warn", `Google status: ${google.state}.`);

  if (config.scheduleEnabled && config.catchup === "auto" && google.state === "connected") {
    const slot = mostRecentSlot(new Date(), config.timezone, config.hour, config.minute);
    const period = previousReportingPeriod(slot, config.timezone);
    if (!db.latestCompletedForLabel(period.label)) {
      db.addLog("info", `Starting missed report for ${period.label}.`);
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
    }
  }

  console.log(`MailMind listening at http://127.0.0.1:${envConfig.port}`);
  const shutdown = () => {
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
