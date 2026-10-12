import dotenv from "dotenv";
import fs from "fs";
import path from "path";

export type DriveAccess = "file" | "full";
export type CatchupMode = "off" | "offer" | "auto";

export type AppConfig = {
  port: number;
  ollamaBaseUrl: string;
  ollamaModel: string;
  timezone: string;
  hour: number;
  minute: number;
  driveFolderId: string;
  driveAccess: DriveAccess;
  scheduleEnabled: boolean;
  catchup: CatchupMode;
  dataDir: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  ollamaNetworkRetries: number;
  ollamaInvalidRetries: number;
  gmailMaxMessages: number;
  testEmailLimit: number;
};

const SETTING_KEYS = [
  "REPORT_TIMEZONE",
  "REPORT_HOUR",
  "REPORT_MINUTE",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "GOOGLE_DRIVE_FOLDER_ID",
  "GOOGLE_DRIVE_ACCESS",
  "SCHEDULE_ENABLED",
  "REPORT_CATCHUP",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function intInRange(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Expected an integer from ${min} to ${max}, received "${value}".`);
  }
  return n;
}

export function assertTimeZone(timeZone: string): string {
  const trimmed = timeZone.trim();
  if (!trimmed) throw new Error("Timezone is required.");
  Intl.DateTimeFormat("en-US", { timeZone: trimmed });
  return trimmed;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const timezone = assertTimeZone(env.REPORT_TIMEZONE?.trim() || "Asia/Kolkata");
  const driveAccess = (env.GOOGLE_DRIVE_ACCESS?.trim() || "file").toLowerCase();
  if (driveAccess !== "file" && driveAccess !== "full") {
    throw new Error('GOOGLE_DRIVE_ACCESS must be "file" or "full".');
  }
  const catchup = (env.REPORT_CATCHUP?.trim() || "offer").toLowerCase();
  if (catchup !== "off" && catchup !== "offer" && catchup !== "auto") {
    throw new Error('REPORT_CATCHUP must be "off", "offer", or "auto".');
  }
  const port = intInRange(env.PORT, 8787, 1, 65535);
  const redirect = env.GOOGLE_REDIRECT_URI?.trim() || `http://127.0.0.1:${port}/oauth/callback`;
  return {
    port,
    ollamaBaseUrl: (env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/$/, ""),
    ollamaModel: env.OLLAMA_MODEL?.trim() || "gemma3:4b",
    timezone,
    hour: intInRange(env.REPORT_HOUR, 7, 0, 23),
    minute: intInRange(env.REPORT_MINUTE, 0, 0, 59),
    driveFolderId: env.GOOGLE_DRIVE_FOLDER_ID?.trim() || "",
    driveAccess,
    scheduleEnabled: bool(env.SCHEDULE_ENABLED, false),
    catchup,
    dataDir: path.resolve(env.DATA_DIR?.trim() || "./data"),
    googleClientId: env.GOOGLE_CLIENT_ID?.trim() || "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET?.trim() || "",
    googleRedirectUri: redirect,
    ollamaNetworkRetries: intInRange(env.OLLAMA_NETWORK_RETRIES, 2, 0, 5),
    ollamaInvalidRetries: intInRange(env.OLLAMA_INVALID_RETRIES, 2, 0, 5),
    gmailMaxMessages: intInRange(env.GMAIL_MAX_MESSAGES, 300, 1, 2000),
    testEmailLimit: intInRange(env.TEST_EMAIL_LIMIT, 3, 1, 10),
  };
}

export function readEnvFile(envFile = path.resolve(".env")): Record<string, string> {
  if (!fs.existsSync(envFile)) return {};
  try {
    return dotenv.parse(fs.readFileSync(envFile, "utf8"));
  } catch {
    return {};
  }
}

function pickNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (v !== undefined && v.trim() !== "") return v.trim();
  }
  return undefined;
}

export function applySettings(base: AppConfig, settings: Record<string, string>, fileEnv: Record<string, string> = {}): AppConfig {
  const merged: NodeJS.ProcessEnv = {
    PORT: String(base.port),
    OLLAMA_BASE_URL: pickNonEmpty(settings.OLLAMA_BASE_URL, fileEnv.OLLAMA_BASE_URL, base.ollamaBaseUrl),
    OLLAMA_MODEL: pickNonEmpty(settings.OLLAMA_MODEL, fileEnv.OLLAMA_MODEL, base.ollamaModel),
    REPORT_TIMEZONE: pickNonEmpty(settings.REPORT_TIMEZONE, fileEnv.REPORT_TIMEZONE, base.timezone),
    REPORT_HOUR: pickNonEmpty(settings.REPORT_HOUR, fileEnv.REPORT_HOUR, String(base.hour)),
    REPORT_MINUTE: pickNonEmpty(settings.REPORT_MINUTE, fileEnv.REPORT_MINUTE, String(base.minute)),
    GOOGLE_DRIVE_FOLDER_ID: pickNonEmpty(fileEnv.GOOGLE_DRIVE_FOLDER_ID, settings.GOOGLE_DRIVE_FOLDER_ID, base.driveFolderId) ?? "",
    GOOGLE_DRIVE_ACCESS: pickNonEmpty(fileEnv.GOOGLE_DRIVE_ACCESS, settings.GOOGLE_DRIVE_ACCESS, base.driveAccess),
    SCHEDULE_ENABLED: pickNonEmpty(settings.SCHEDULE_ENABLED, fileEnv.SCHEDULE_ENABLED, String(base.scheduleEnabled)),
    REPORT_CATCHUP: pickNonEmpty(settings.REPORT_CATCHUP, fileEnv.REPORT_CATCHUP, base.catchup),
    DATA_DIR: base.dataDir,
    GOOGLE_CLIENT_ID: pickNonEmpty(fileEnv.GOOGLE_CLIENT_ID, settings.GOOGLE_CLIENT_ID, base.googleClientId) ?? "",
    GOOGLE_CLIENT_SECRET: pickNonEmpty(fileEnv.GOOGLE_CLIENT_SECRET, settings.GOOGLE_CLIENT_SECRET, base.googleClientSecret) ?? "",
    GOOGLE_REDIRECT_URI: pickNonEmpty(fileEnv.GOOGLE_REDIRECT_URI, base.googleRedirectUri),
    OLLAMA_NETWORK_RETRIES: String(base.ollamaNetworkRetries),
    OLLAMA_INVALID_RETRIES: String(base.ollamaInvalidRetries),
    GMAIL_MAX_MESSAGES: String(base.gmailMaxMessages),
    TEST_EMAIL_LIMIT: String(base.testEmailLimit),
  };
  return configFromEnv(merged);
}

export function extractGoogleCredentials(input: unknown): { clientId: string; clientSecret: string } {
  if (!input || typeof input !== "object") {
    throw new Error("Provide a clientId and clientSecret or a Google Cloud OAuth JSON object.");
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.json === "string" && raw.json.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.json);
    } catch {
      throw new Error("The pasted OAuth JSON is not valid JSON.");
    }
    return extractGoogleCredentials(parsed);
  }
  const container = (raw.web ?? raw.installed ?? raw) as Record<string, unknown>;
  const clientId = String(container.clientId ?? container.client_id ?? "").trim();
  const clientSecret = String(container.clientSecret ?? container.client_secret ?? "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required.");
  }
  return { clientId, clientSecret };
}

export function updateEnvCredentials(clientId: string, clientSecret: string, envFile = path.resolve(".env")): void {
  const exampleFile = path.resolve(".env.example");
  let content = "";
  if (fs.existsSync(envFile)) {
    content = fs.readFileSync(envFile, "utf8");
  } else if (fs.existsSync(exampleFile)) {
    content = fs.readFileSync(exampleFile, "utf8");
  }
  const upsert = (src: string, key: string, value: string): string => {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(src)) return src.replace(re, `${key}=${value}`);
    return `${src.trimEnd()}\n${key}=${value}\n`;
  };
  content = upsert(content, "GOOGLE_CLIENT_ID", clientId);
  content = upsert(content, "GOOGLE_CLIENT_SECRET", clientSecret);
  fs.writeFileSync(envFile, content, "utf8");
}

export function settingsFromConfig(config: AppConfig): Record<SettingKey, string> {
  return {
    REPORT_TIMEZONE: config.timezone,
    REPORT_HOUR: String(config.hour),
    REPORT_MINUTE: String(config.minute),
    OLLAMA_BASE_URL: config.ollamaBaseUrl,
    OLLAMA_MODEL: config.ollamaModel,
    GOOGLE_DRIVE_FOLDER_ID: "",
    GOOGLE_DRIVE_ACCESS: config.driveAccess,
    SCHEDULE_ENABLED: String(config.scheduleEnabled),
    REPORT_CATCHUP: config.catchup,
  };
}

export function sanitizeSettings(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SETTING_KEYS) {
    if (input[key] === undefined) continue;
    const val = String(input[key]).trim();
    if (key === "GOOGLE_DRIVE_FOLDER_ID" && !val) continue;
    out[key] = val;
  }
  return out;
}

export function ensureDataDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export { SETTING_KEYS };


