export const CATEGORIES = [
  "Work",
  "Personal",
  "Finance",
  "Security",
  "Meetings",
  "Newsletters",
  "Notifications",
  "Travel",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type Importance = "Critical" | "High" | "Medium" | "Low";
export type AnalysisSource = "ai" | "rules";
export type RunKind = "scheduled" | "manual" | "test" | "retry";
export type RunStatus = "running" | "failed" | "completed";
export type RunStage = "created" | "fetched" | "analyzed" | "docx_saved" | "uploaded" | "completed";

export type Period = {
  start: Date;
  end: Date;
  label: string;
  year: string;
  month: string;
};

export type SanitizedEmail = {
  gmailId: string;
  threadId: string;
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
  truncated: boolean;
  gmailLink: string;
};

export type EmailAnalysis = {
  category: Category;
  importance: Importance;
  summary: string;
  keyInformation: string[];
  actionItems: string[];
  deadlines: string[];
  replyNeeded: boolean;
  aiSummaryAvailable: boolean;
  analysisSource: AnalysisSource;
  warnings: string[];
};

export type RunRecord = {
  id: string;
  kind: RunKind;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  status: RunStatus;
  stage: RunStage;
  filename: string;
  totalFetched: number;
  totalExcluded: number;
  totalProcessed: number;
  totalFailed: number;
  aiCount: number;
  fallbackCount: number;
  error: string | null;
  note: string | null;
  localPath: string | null;
  driveFileId: string | null;
  driveUrl: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
};

export type StoredMessage = {
  runId: string;
  gmailId: string;
  threadId: string;
  fromAddr: string;
  subject: string;
  receivedAt: string;
  bodyText: string;
  truncated: number;
  analysisJson: string | null;
  status: "pending" | "analyzed" | "failed";
  error: string | null;
};
