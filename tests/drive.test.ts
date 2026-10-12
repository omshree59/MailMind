import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRootFolder, uploadReport, type DriveApi } from "../src/drive";
import { extractGoogleCredentials } from "../src/config";

describe("Drive upload", () => {
  it("reuses an existing file name instead of uploading a duplicate", async () => {
    let created = 0;
    const api: DriveApi = {
      async list(query) {
        if (query.includes("MailMind_Report_2026-10-11.docx")) {
          return [{ id: "file-1", name: "MailMind_Report_2026-10-11.docx", webViewLink: "https://drive.google.com/file/d/file-1/view" }];
        }
        if (query.includes("name = '2026'")) return [{ id: "year", name: "2026" }];
        if (query.includes("name = '10'")) return [{ id: "month", name: "10" }];
        return [];
      },
      async createFolder() {
        throw new Error("folder should already exist");
      },
      async createFile() {
        created += 1;
        return { id: "new" };
      },
    };
    const uploaded = await uploadReport(api, {
      rootFolderId: "root",
      year: "2026",
      month: "10",
      filename: "MailMind_Report_2026-10-11.docx",
      data: Buffer.from("docx"),
    });
    assert.equal(created, 0);
    assert.equal(uploaded.fileId, "file-1");
  });

  it("does not claim success when the folder is missing", async () => {
    const api: DriveApi = {
      async list() { return []; },
      async createFolder() { const error = new Error("forbidden") as Error & { code?: number }; error.code = 403; throw error; },
      async createFile() { return { id: "nope" }; },
    };
    await assert.rejects(
      () => uploadReport(api, { rootFolderId: "root", year: "2026", month: "10", filename: "MailMind_Report_2026-10-11.docx", data: Buffer.from("x") }),
      /refused the configured folder/,
    );
  });

  it("reuses an existing root folder and parses Google Cloud OAuth JSON", async () => {
    let foldersCreated = 0;
    const api: DriveApi = {
      async list() { return [{ id: "existing-root", name: "MailMind Reports" }]; },
      async createFolder() { foldersCreated += 1; return { id: "created-root" }; },
      async createFile() { return { id: "file" }; },
    };
    const root = await createRootFolder(api);
    assert.equal(root.id, "existing-root");
    assert.equal(foldersCreated, 0);

    const creds = extractGoogleCredentials({
      json: JSON.stringify({ web: { client_id: "cid.apps.googleusercontent.com", client_secret: "GOCSPX-123" } }),
    });
    assert.equal(creds.clientId, "cid.apps.googleusercontent.com");
    assert.equal(creds.clientSecret, "GOCSPX-123");
  });

  it("uploads reports into date-wise folders when dateFolder is specified", async () => {
    const createdFolders: { name: string; parentId?: string }[] = [];
    let fileParentId = "";
    const api: DriveApi = {
      async list() { return []; },
      async createFolder(name, parentId) {
        createdFolders.push({ name, parentId });
        return { id: `folder-${name}` };
      },
      async createFile(args) {
        fileParentId = args.parentId;
        return { id: "date-file-1", webViewLink: "https://drive.google.com/file/d/date-file-1/view" };
      },
    };
    const uploaded = await uploadReport(api, {
      rootFolderId: "root-drive",
      year: "2026",
      month: "10",
      dateFolder: "2026-10-11",
      filename: "MailMind_Report_2026-10-11.docx",
      data: Buffer.from("docx"),
    });
    assert.deepEqual(createdFolders, [{ name: "2026-10-11", parentId: "root-drive" }]);
    assert.equal(fileParentId, "folder-2026-10-11");
    assert.equal(uploaded.fileId, "date-file-1");
  });
});


