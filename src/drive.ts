export interface DriveApi {
  list(query: string): Promise<{ id: string; name: string; webViewLink?: string | null }[]>;
  createFolder(name: string, parentId?: string): Promise<{ id: string }>;
  createFile(args: { name: string; parentId: string; data: Buffer }): Promise<{ id: string; webViewLink?: string | null }>;
}

export class DrivePermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrivePermissionError";
  }
}

function escapeName(name: string): string {
  return name.replace(/'/g, "\\'");
}

export function driveFileUrl(id: string): string {
  return `https://drive.google.com/file/d/${id}/view`;
}

async function findByName(api: DriveApi, parentId: string, name: string): Promise<{ id: string; webViewLink?: string | null } | null> {
  const files = await api.list(`'${parentId}' in parents and name = '${escapeName(name)}' and trashed = false`);
  return files[0] ?? null;
}

async function folderId(api: DriveApi, parentId: string, name: string): Promise<string> {
  const existing = await findByName(api, parentId, name);
  if (existing) return existing.id;
  const created = await api.createFolder(name, parentId);
  return created.id;
}

export async function uploadReport(api: DriveApi, args: {
  rootFolderId: string;
  year: string;
  month: string;
  dateFolder?: string;
  filename: string;
  data: Buffer;
}): Promise<{ fileId: string; url: string }> {
  if (!args.rootFolderId) {
    throw new DrivePermissionError("GOOGLE_DRIVE_FOLDER_ID is empty. Create a MailMind folder from the dashboard or set the id in .env.");
  }
  try {
    let targetFolderId: string;
    if (args.dateFolder) {
      targetFolderId = await folderId(api, args.rootFolderId, args.dateFolder);
    } else {
      const yearId = await folderId(api, args.rootFolderId, args.year);
      targetFolderId = await folderId(api, yearId, args.month);
    }
    const existing = await findByName(api, targetFolderId, args.filename);
    if (existing) return { fileId: existing.id, url: existing.webViewLink || driveFileUrl(existing.id) };
    const created = await api.createFile({ name: args.filename, parentId: targetFolderId, data: args.data });
    return { fileId: created.id, url: created.webViewLink || driveFileUrl(created.id) };
  } catch (error) {
    const status = (error as { code?: number; response?: { status?: number } }).code
      ?? (error as { response?: { status?: number } }).response?.status;
    if (status === 403 || status === 404) {
      throw new DrivePermissionError(
        "Google Drive refused the configured folder. With drive.file, use a folder this app created, or set GOOGLE_DRIVE_ACCESS=full and connect Google again.",
      );
    }
    throw error;
  }
}

export async function createRootFolder(api: DriveApi, name = "MailMind Reports"): Promise<{ id: string }> {
  const existing = await api.list(`name = '${escapeName(name)}' and trashed = false`);
  if (existing[0]?.id) return { id: existing[0].id };
  const created = await api.createFolder(name);
  return { id: created.id };
}

