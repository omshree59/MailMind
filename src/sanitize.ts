const MAX_BODY = 6000;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

export function sanitizeText(input: string): { text: string; truncated: boolean } {
  const withoutControls = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  const untagged = withoutControls.replace(/<\/?\s*untrusted_email\s*>/gi, "");
  const collapsed = untagged.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  if (collapsed.length <= MAX_BODY) return { text: collapsed, truncated: false };
  return { text: collapsed.slice(0, MAX_BODY), truncated: true };
}

export function sanitizeEmailContent(raw: string, mimeHint: "plain" | "html" = "plain"): { text: string; truncated: boolean } {
  const source = mimeHint === "html" ? htmlToText(raw) : raw;
  return sanitizeText(source);
}
