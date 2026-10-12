export function redact(message: string): string {
  return message
    .replace(/ya29\.[A-Za-z0-9_\-]+/g, "[redacted-token]")
    .replace(/\b(access_token|refresh_token|client_secret|id_token|authorization)\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]")
    .slice(0, 500);
}
