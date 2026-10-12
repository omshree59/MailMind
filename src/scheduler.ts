import cron from "node-cron";
import type { AppConfig } from "./config";

export type SchedulerHandle = {
  reschedule: (config: AppConfig) => void;
  stop: () => void;
};

export function startScheduler(options: {
  getConfig: () => AppConfig;
  run: () => Promise<void>;
  catchupCheck?: () => Promise<void>;
  log: (level: "info" | "warn" | "error", message: string) => void;
}): SchedulerHandle {
  let task: cron.ScheduledTask | null = null;
  let watchdog: cron.ScheduledTask | null = null;

  function reschedule(config: AppConfig): void {
    task?.stop();
    watchdog?.stop();
    task = null;
    watchdog = null;
    if (!config.scheduleEnabled) {
      options.log("info", "Scheduling is disabled.");
      return;
    }
    const expression = `${config.minute} ${config.hour} * * *`;
    if (!cron.validate(expression)) {
      options.log("error", "The schedule expression is invalid.");
      return;
    }
    task = cron.schedule(expression, () => {
      void options.run().catch((error: unknown) => {
        options.log("error", error instanceof Error ? error.message : "Scheduled run failed.");
      });
    }, { timezone: config.timezone });
    if (options.catchupCheck && config.catchup === "auto") {
      watchdog = cron.schedule("*/15 * * * *", () => {
        void options.catchupCheck?.().catch(() => undefined);
      }, { timezone: config.timezone });
    }
    options.log("info", `Schedule set for ${String(config.hour).padStart(2, "0")}:${String(config.minute).padStart(2, "0")} ${config.timezone}.`);
  }

  reschedule(options.getConfig());
  return {
    reschedule,
    stop: () => {
      task?.stop();
      watchdog?.stop();
    },
  };
}

