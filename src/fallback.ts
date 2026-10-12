import { CATEGORIES, type Category, type EmailAnalysis, type Importance, type SanitizedEmail } from "./types";

const CATEGORY_RULES: { category: Category; re: RegExp }[] = [
  { category: "Security", re: /password|verify your account|suspended|security alert|\b2fa\b|\botp\b|unusual sign-in/i },
  { category: "Finance", re: /invoice|payment|receipt|\bbank\b|refund|amount due/i },
  { category: "Meetings", re: /\bmeeting\b|calendar|\bzoom\b|google meet|invitation:/i },
  { category: "Travel", re: /\bflight\b|itinerary|\bhotel\b|boarding pass/i },
  { category: "Newsletters", re: /unsubscribe|newsletter|view in browser/i },
  { category: "Notifications", re: /\bnotification\b|no-reply|noreply|do not reply/i },
  { category: "Work", re: /\bproject\b|\bdeadline\b|deliverable|standup/i },
  { category: "Personal", re: /\bfamily\b|\bbirthday\b/i },
];

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_RE = new RegExp(
  String.raw`\b(?:by|before|due|deadline(?: is)?|on|until)\s+((?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(?:\d{1,2}\s+(?:${MONTHS})\s+\d{4}|(?:${MONTHS})\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}))`,
  "gi",
);

export function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function deadlineIsExplicit(email: Pick<SanitizedEmail, "subject" | "body">, phrase: string): boolean {
  const needle = normalizePhrase(phrase);
  if (needle.length < 4) return false;
  const hay = normalizePhrase(`${email.subject}\n${email.body}`);
  return hay.includes(needle);
}

export function ruleAnalyze(email: SanitizedEmail): EmailAnalysis {
  const hay = `${email.from}\n${email.subject}\n${email.body}`;
  let category: Category = "Other";
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(hay)) {
      category = rule.category;
      break;
    }
  }
  const urgent = /\burgent\b|\basap\b|\bcritical\b|\bimmediately\b/i.test(hay);
  let importance: Importance = "Medium";
  if (category === "Newsletters" || category === "Notifications") importance = "Low";
  if (urgent) importance = category === "Security" || category === "Finance" ? "Critical" : "High";
  if (!urgent && category === "Security") importance = "High";

  const actionItems = email.body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /\b(please|kindly|action required|need you to|could you)\b/i.test(s))
    .slice(0, 3);

  const deadlines: string[] = [];
  for (const match of hay.matchAll(DATE_RE)) {
    const phrase = match[0].trim();
    if (phrase && !deadlines.includes(phrase)) deadlines.push(phrase);
  }

  const replyNeeded = /\?/.test(email.body) && category !== "Newsletters" && category !== "Notifications";
  const warnings = ["AI summary unavailable. Rule-based categorization was used."];
  if (email.truncated) warnings.push("Email body was truncated before categorization.");

  return {
    category,
    importance,
    summary: "AI summary unavailable.",
    keyInformation: [],
    actionItems,
    deadlines,
    replyNeeded,
    aiSummaryAvailable: false,
    analysisSource: "rules",
    warnings,
  };
}

export function ruleExecutiveSummary(input: {
  label: string;
  messages: EmailAnalysis[];
  failed: number;
}): string {
  const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const message of input.messages) counts[message.importance] += 1;
  const fallback = input.messages.filter((m) => !m.aiSummaryAvailable).length;
  return [
    `Processed ${input.messages.length} emails for ${input.label}.`,
    `Critical: ${counts.Critical}. High: ${counts.High}. Medium: ${counts.Medium}. Low: ${counts.Low}.`,
    `AI summaries unavailable for ${fallback} emails.`,
    input.failed ? `${input.failed} emails could not be processed.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
