import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { EmailAnalysis, Importance } from "./types";

export type ReportEmail = EmailAnalysis & {
  gmailId: string;
  from: string;
  subject: string;
  receivedAt: string;
  gmailLink: string;
  error?: string | null;
};

export type ReportInput = {
  periodLabel: string;
  timezone: string;
  generatedAt: string;
  executiveSummary: string;
  executiveSummarySource: "ai" | "rules";
  emails: ReportEmail[];
  excludedCount: number;
  failed: ReportEmail[];
  runNote: string | null;
};

const RANK: Record<Importance, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function text(value: string, bold = false): TextRun {
  return new TextRun({ text: value, font: "Calibri", size: 22, bold });
}

function para(value: string, heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    heading,
    spacing: { after: 120 },
    children: [text(value, Boolean(heading))],
  });
}

function bullets(title: string, items: string[]): Paragraph[] {
  if (!items.length) return [para(`${title}: none.`)];
  return [para(`${title}:`), ...items.map((item) => para(`• ${item}`))];
}

function emailCard(email: ReportEmail): Paragraph[] {
  return [
    para(`${email.subject}`, HeadingLevel.HEADING_3),
    para(`From: ${email.from || "unknown"}`),
    para(`Received: ${email.receivedAt}`),
    para(`Importance: ${email.importance} · Category: ${email.category} · Reply needed: ${email.replyNeeded ? "yes" : "no"}`),
    para(`Summary: ${email.summary}`),
    ...bullets("Key information", email.keyInformation),
    ...bullets("Action items", email.actionItems),
    ...bullets("Deadlines", email.deadlines),
    new Paragraph({
      spacing: { after: 80 },
      children: [
        text("Gmail: "),
        new ExternalHyperlink({
          link: email.gmailLink,
          children: [new TextRun({ text: email.gmailLink, font: "Calibri", size: 22, style: "Hyperlink" })],
        }),
      ],
    }),
    ...email.warnings.map((warning) => para(`Warning: ${warning}`)),
  ];
}

export function buildReportDocument(input: ReportInput): Document {
  const counts = new Map<string, number>();
  for (const email of input.emails) counts.set(email.category, (counts.get(email.category) ?? 0) + 1);
  const priority = input.emails
    .filter((email) => email.importance === "Critical" || email.importance === "High")
    .sort((a, b) => RANK[a.importance] - RANK[b.importance]);
  const categories = [...counts.keys()].sort();

  const children: (Paragraph | Table)[] = [
    para(`MailMind report ${input.periodLabel}`, HeadingLevel.TITLE),
    para(`Timezone: ${input.timezone}`),
    para(`Generated: ${input.generatedAt}`),
    para(`Emails processed: ${input.emails.length}`),
    para(`Already reported and excluded: ${input.excludedCount}`),
    para("Executive summary", HeadingLevel.HEADING_1),
    para(input.executiveSummary),
    para(
      input.executiveSummarySource === "ai"
        ? "Executive summary source: Gemma via Ollama."
        : "Executive summary source: counts and rule-based notes. This paragraph is not an AI summary.",
    ),
    para("Critical and high-priority emails", HeadingLevel.HEADING_1),
  ];

  if (!priority.length) children.push(para("None."));
  for (const email of priority) {
    children.push(
      para(`${email.importance}: ${email.subject} — ${email.from}`),
      para(email.summary),
      ...bullets("Deadlines", email.deadlines),
      ...bullets("Action items", email.actionItems),
    );
  }

  children.push(para("Category counts", HeadingLevel.HEADING_1));
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({ children: [para("Category")] }),
            new TableCell({ children: [para("Count")] }),
          ],
        }),
        ...(categories.length
          ? categories.map(
              (category) =>
                new TableRow({
                  children: [
                    new TableCell({ children: [para(category)] }),
                    new TableCell({ children: [para(String(counts.get(category) ?? 0))] }),
                  ],
                }),
            )
          : [
              new TableRow({
                children: [
                  new TableCell({ children: [para("None")] }),
                  new TableCell({ children: [para("0")] }),
                ],
              }),
            ]),
      ],
    }),
  );

  for (const category of categories) {
    children.push(para(category, HeadingLevel.HEADING_1));
    children.push(para(`${counts.get(category)} emails.`));
    for (const email of input.emails.filter((item) => item.category === category)) {
      children.push(...emailCard(email));
    }
  }

  children.push(para("Errors and incomplete processing", HeadingLevel.HEADING_1));
  if (input.runNote) children.push(para(input.runNote));
  if (!input.failed.length && !input.emails.some((email) => email.warnings.length)) {
    children.push(para("No processing warnings."));
  }
  for (const email of input.failed) {
    children.push(para(`${email.subject} from ${email.from || "unknown"} (${email.gmailId}) failed: ${email.error || "unknown error"}`));
  }
  const fallbacks = input.emails.filter((email) => !email.aiSummaryAvailable).length;
  if (fallbacks) {
    children.push(para(`${fallbacks} emails used rule-based categorization because an AI summary was unavailable.`));
  }
  return new Document({ sections: [{ children }] });
}

export async function renderReportDocx(input: ReportInput): Promise<Buffer> {
  return Packer.toBuffer(buildReportDocument(input));
}
