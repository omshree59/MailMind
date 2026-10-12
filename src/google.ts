import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { google } from "googleapis";
import type { AppConfig } from "./config";
import { ensureDataDir } from "./config";
import { redact } from "./redact";
import type { DriveApi } from "./drive";
import { fetchGmailMessages, type GmailApi } from "./gmail";
import type { Period, SanitizedEmail } from "./types";
import { gmailQuery } from "./period";

export type GoogleStatus =
  | { state: "connected"; email?: string }
  | { state: "missing_credentials" }
  | { state: "missing_token" }
  | { state: "revoked"; message: string };

export function driveScope(access: AppConfig["driveAccess"]): string {
  return access === "full" ? "https://www.googleapis.com/auth/drive" : "https://www.googleapis.com/auth/drive.file";
}

export function googleScopes(config: AppConfig): string[] {
  return ["https://www.googleapis.com/auth/gmail.readonly", driveScope(config.driveAccess)];
}

export function tokenFile(config: AppConfig): string {
  return path.join(config.dataDir, "google-tokens.json");
}

type StoredTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string;
  token_type?: string | null;
  id_token?: string | null;
  email?: string | null;
};

function readTokens(file: string): StoredTokens | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as StoredTokens;
}

function writeTokens(file: string, tokens: StoredTokens): void {
  ensureDataDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(tokens), { mode: 0o600 });
}

export function oauthClient(config: AppConfig) {
  return new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
}

export function authUrl(config: AppConfig): string {
  const existing = readTokens(tokenFile(config));
  return oauthClient(config).generateAuthUrl({
    access_type: "offline",
    prompt: existing?.refresh_token ? undefined : "consent",
    scope: googleScopes(config),
  });
}

export async function exchangeCode(config: AppConfig, code: string): Promise<void> {
  const client = oauthClient(config);
  const { tokens } = await client.getToken(code);
  const file = tokenFile(config);
  const previous = readTokens(file);
  const merged: StoredTokens = {
    ...previous,
    ...tokens,
    refresh_token: tokens.refresh_token || previous?.refresh_token,
  };
  client.setCredentials(merged);
  try {
    const gmail = google.gmail({ version: "v1", auth: client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    if (profile.data.emailAddress) merged.email = profile.data.emailAddress;
  } catch {
    // Profile email is optional display metadata
  }
  writeTokens(file, merged);
}

export function disconnectGoogle(config: AppConfig): void {
  const file = tokenFile(config);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export async function checkGoogle(config: AppConfig): Promise<GoogleStatus> {
  if (!config.googleClientId || !config.googleClientSecret) return { state: "missing_credentials" };
  const file = tokenFile(config);
  const tokens = readTokens(file);
  if (!tokens?.refresh_token && !tokens?.access_token) return { state: "missing_token" };
  const client = oauthClient(config);
  client.setCredentials(tokens);
  client.on("tokens", (next) => {
    const current = readTokens(file) || {};
    writeTokens(file, { ...current, ...next, refresh_token: next.refresh_token || current.refresh_token });
  });
  try {
    await client.getAccessToken();
    let email = tokens.email || undefined;
    if (!email) {
      try {
        const gmail = google.gmail({ version: "v1", auth: client });
        const profile = await gmail.users.getProfile({ userId: "me" });
        if (profile.data.emailAddress) {
          email = profile.data.emailAddress;
          writeTokens(file, { ...(readTokens(file) || tokens), email });
        }
      } catch {
        // Ignore profile lookup errors if token is valid
      }
    }
    return { state: "connected", email };
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : "Google authentication failed.");
    if (/invalid_grant|revoked|unauthorized|invalid_client/i.test(message)) {
      return { state: "revoked", message: "Google access expired or was revoked. Connect Google again." };
    }
    return { state: "revoked", message: "Google authentication failed. Connect Google again." };
  }
}

async function authorized(config: AppConfig) {
  const status = await checkGoogle(config);
  if (status.state !== "connected") {
    throw new Error(status.state === "revoked" ? status.message : "Google is not connected.");
  }
  const file = tokenFile(config);
  const client = oauthClient(config);
  client.setCredentials(readTokens(file) || {});
  client.on("tokens", (tokens) => {
    const previous = readTokens(file) || {};
    writeTokens(file, { ...previous, ...tokens, refresh_token: tokens.refresh_token || previous.refresh_token });
  });
  return client;
}

export async function fetchPeriodMessages(config: AppConfig, period: Period, maxMessages: number): Promise<SanitizedEmail[]> {
  const auth = await authorized(config);
  const gmail = google.gmail({ version: "v1", auth });
  const api: GmailApi = {
    list: (args) => gmail.users.messages.list({ userId: "me", q: args.q, pageToken: args.pageToken, maxResults: args.maxResults }),
    get: (args) => gmail.users.messages.get({ userId: "me", id: args.id, format: "full" }),
  };
  try {
    return await fetchGmailMessages(api, { query: gmailQuery(period), maxMessages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail request failed.";
    if (/invalid_grant|insufficient permissions|unauthorized/i.test(message)) {
      throw new Error("Google access expired or was revoked. Connect Google again.");
    }
    throw error;
  }
}

export async function driveApi(config: AppConfig): Promise<DriveApi> {
  const auth = await authorized(config);
  const drive = google.drive({ version: "v3", auth });
  return {
    async list(query: string) {
      const res = await drive.files.list({ q: query, fields: "files(id,name,webViewLink)", pageSize: 10, spaces: "drive" });
      return (res.data.files ?? []).flatMap((file) => (file.id && file.name ? [{ id: file.id, name: file.name, webViewLink: file.webViewLink }] : []));
    },
    async createFolder(name: string, parentId?: string) {
      const res = await drive.files.create({
        requestBody: {
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: parentId ? [parentId] : undefined,
        },
        fields: "id",
      });
      if (!res.data.id) throw new Error("Google Drive did not return a folder id.");
      return { id: res.data.id };
    },
    async createFile(args) {
      const res = await drive.files.create({
        requestBody: {
          name: args.name,
          parents: [args.parentId],
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        media: {
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          body: Readable.from(args.data),
        },
        fields: "id, webViewLink",
      });
      if (!res.data.id) throw new Error("Google Drive did not return a file id.");
      return { id: res.data.id, webViewLink: res.data.webViewLink };
    },
  };
}
