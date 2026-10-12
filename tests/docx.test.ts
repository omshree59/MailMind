import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it } from "node:test";
import { renderReportDocx, type ReportInput } from "../src/docx-report";

describe("Word report", () => {
  it("writes a docx with counts, deadlines, and a Gmail link", async () => {
    const input: ReportInput = {
      periodLabel: "2026-10-11",
      timezone: "Asia/Kolkata",
      generatedAt: "2026-10-12T02:00:00.000Z",
      executiveSummary: "One high-priority work email asked for a review.",
      executiveSummarySource: "rules",
      excludedCount: 2,
      runNote: null,
      failed: [],
      emails: [
        {
          gmailId: "abc",
          from: "Ada <ada@example.com>",
          subject: "Launch notes",
          receivedAt: "2026-10-11T09:00:00.000Z",
          gmailLink: "https://mail.google.com/mail/u/0/#all/abc",
          category: "Work",
          importance: "High",
          summary: "AI summary unavailable.",
          keyInformation: [],
          actionItems: ["Review the launch notes"],
          deadlines: ["by Friday 16 October 2026"],
          replyNeeded: true,
          aiSummaryAvailable: false,
          analysisSource: "rules",
          warnings: ["AI summary unavailable. Rule-based categorization was used."],
        },
      ],
    };
    const buffer = await renderReportDocx(input);
    assert.equal(buffer.subarray(0, 2).toString(), "PK");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mailmind-docx-"));
    const file = path.join(dir, "MailMind_Report_2026-10-11.docx");
    fs.writeFileSync(file, buffer);
    execFileSync("tar", ["-xf", file, "-C", dir]);
    const xml = fs.readFileSync(path.join(dir, "word", "document.xml"), "utf8");
    assert.match(xml, /MailMind report 2026-10-11/);
    assert.match(xml, /Emails processed: 1/);
    assert.match(xml, /by Friday 16 October 2026/);
    assert.match(xml, /https:\/\/mail.google.com\/mail\/u\/0\/#all\/abc/);
    assert.match(xml, /not an AI summary/);
    assert.match(xml, /Launch notes/);
  });
});
