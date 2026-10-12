import { sanitizeEmailContent } from "./sanitize";
import type { SanitizedEmail } from "./types";

export type GmailHeader = { name?: string | null; value?: string | null };
export type GmailPart = {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null; size?: number | null } | null;
  parts?: GmailPart[] | null;
  headers?: GmailHeader[] | null;
};

export type GmailMessageData = {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  snippet?: string | null;
  internalDate?: string | null;
  payload?: GmailPart | null;
};

const EXCLUDED_GMAIL_LABELS = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_SOCIAL",
  "CATEGORY_FORUMS",
  "SPAM",
  "TRASH",
  "DRAFT",
]);


export interface GmailApi {
  list(args: { q: string; pageToken?: string; maxResults: number }): Promise<{
    data: { messages?: { id?: string | null }[] | null; nextPageToken?: string | null };
  }>;
  get(args: { id: string }): Promise<{ data: GmailMessageData }>;
}

export function isQuotaError(error: unknown): boolean {
  const candidate = error as { code?: number; response?: { status?: number }; errors?: { reason?: string }[]; message?: string };
  const status = candidate.code ?? candidate.response?.status;
  const reason = candidate.errors?.[0]?.reason ?? candidate.message ?? "";
  if (status === 429) return true;
  return status === 403 && /rateLimit|userRateLimit|quotaExceeded|quota/i.test(reason);
}

export async function withQuotaRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!isQuotaError(error) || attempt === attempts) throw error;
      await sleep(250 * 2 ** (attempt - 1));
    }
  }
  throw last;
}

function header(payload: GmailPart | null | undefined, name: string): string {
  const found = payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase());
  return found?.value?.trim() || "";
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

function collectParts(part: GmailPart | null | undefined, acc: { plain: string[]; html: string[] }): void {
  if (!part) return;
  if (part.filename) {
    if (part.parts) for (const child of part.parts) collectParts(child, acc);
    return;
  }
  const data = part.body?.data;
  if (data && part.mimeType === "text/plain") acc.plain.push(decodeBase64Url(data));
  if (data && part.mimeType === "text/html") acc.html.push(decodeBase64Url(data));
  if (part.parts) for (const child of part.parts) collectParts(child, acc);
}

export function gmailLink(id: string): string {
  return `https://mail.google.com/mail/u/0/#all/${id}`;
}

export function parseGmailMessage(data: GmailMessageData): SanitizedEmail | null {
  if (!data.id) return null;
  if (Array.isArray(data.labelIds) && data.labelIds.length > 0) {
    if (!data.labelIds.includes("INBOX")) return null;
    if (data.labelIds.some((label) => EXCLUDED_GMAIL_LABELS.has(label))) return null;
  }
  const collected = { plain: [] as string[], html: [] as string[] };
  collectParts(data.payload, collected);
  const plain = collected.plain.join("\n").trim();
  const html = collected.html.join("\n").trim();
  const raw = plain || html || data.snippet || "";
  const sanitized = sanitizeEmailContent(raw, !plain && html ? "html" : "plain");
  const receivedAt = data.internalDate
    ? new Date(Number(data.internalDate)).toISOString()
    : header(data.payload, "Date");
  return {
    gmailId: data.id,
    threadId: data.threadId || "",
    from: header(data.payload, "From"),
    subject: header(data.payload, "Subject") || "(no subject)",
    receivedAt,
    body: sanitized.text,
    truncated: sanitized.truncated,
    gmailLink: gmailLink(data.id),
  };
}

export async function fetchGmailMessages(
  api: GmailApi,
  options: {
    query: string;
    maxMessages: number;
    sleep?: (ms: number) => Promise<void>;
    quotaAttempts?: number;
  },
): Promise<SanitizedEmail[]> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const quotaAttempts = options.quotaAttempts ?? 4;
  const seen = new Set<string>();
  const messages: SanitizedEmail[] = [];
  let pageToken: string | undefined;
  do {
    const page = await withQuotaRetry(
      () => api.list({ q: options.query, pageToken, maxResults: Math.min(50, options.maxMessages) }),
      quotaAttempts,
      sleep,
    );
    const ids = (page.data.messages ?? []).map((item) => item.id).filter((id): id is string => Boolean(id));
    for (const id of ids) {
      if (seen.has(id) || messages.length >= options.maxMessages) continue;
      seen.add(id);
      const full = await withQuotaRetry(() => api.get({ id }), quotaAttempts, sleep);
      const parsed = parseGmailMessage(full.data);
      if (parsed) messages.push(parsed);
    }
    pageToken = page.data.nextPageToken || undefined;
  } while (pageToken && messages.length < options.maxMessages);
  return messages;
}
