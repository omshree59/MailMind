# MailMind AI

MailMind builds a private daily Word report from your Gmail inbox. Gemma runs locally through Ollama. The app does not call a paid or cloud model. It only reads mail, writes a `.docx`, and uploads that file to a Google Drive folder you choose.

## What a run does

1. Resolve the reporting period in `REPORT_TIMEZONE`. The default period is the previous calendar day.
2. List Gmail messages in that window, following pagination and backing off on quota errors.
3. Skip message IDs already stored on a completed, uploaded report.
4. Strip scripts and HTML, then send each message to Gemma as untrusted data.
5. Validate the JSON with Zod. Invalid output is retried, then replaced with rule-based categorization. Those summaries are labeled unavailable.
6. Deadlines that do not appear in the email text are dropped.
7. Write `MailMind_Report_YYYY-MM-DD.docx`.
8. Save a copy under `data/reports/`.
9. Upload it under `year/month` in the configured Drive folder. The same file name is reused instead of duplicated.
10. Store the Drive file ID only after Google returns it. A failed upload stays failed and can be resumed.

The Gmail scope is `gmail.readonly`. MailMind does not send, delete, archive, or modify mail. OAuth tokens and message bodies are not written to logs. The SQLite database does store message text locally so a failed run can resume.

## Prerequisites

- Node.js 22.13 or newer
- [Ollama](https://ollama.com/) running locally
- The Gemma model already installed. On this machine that is `gemma3:4b`.

```powershell
ollama list
ollama serve
```

`ollama list` should show the model you put in `OLLAMA_MODEL`. MailMind will not switch to a different model.

## Setup

```powershell
cd "D:\CODE79HACK WEB DEV SECRET HACK SIGMA\mailmind ai"
npm install
copy .env.example .env
npm test
npm run check:ollama
npm run check:gemma
npm run dev
```

Open http://127.0.0.1:8787. The server must stay running for the schedule to fire. It listens on `127.0.0.1` only.

## Google Cloud steps you do by hand

1. Create a project at https://console.cloud.google.com/.
2. Enable the **Gmail API** and the **Google Drive API**.
3. Configure the OAuth consent screen. Add your own Google account as a **Test user** while the app is in testing.
4. Create an OAuth client of type **Web application**.
5. Add this authorized redirect URI: `http://127.0.0.1:8787/oauth/callback`.
6. Provide your credentials in either way (no restart required):
   - Paste `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` into `.env` (or into the **Google OAuth Setup** card at http://127.0.0.1:8787), **or**
   - Import the downloaded Google Cloud OAuth `client_secret_*.json` file directly in the dashboard's **Google OAuth Setup** card.
7. Click **Connect Google** (or **Authorize Gmail & Drive**) in the dashboard.

Default Drive scope is `drive.file`, which only accesses folders created by MailMind. On connection or first upload, MailMind automatically creates/reuses a `MailMind Reports` folder in your Google Drive if `GOOGLE_DRIVE_FOLDER_ID` is empty, or you can click **Create Drive folder** at any time.

If you need to upload into an existing folder created outside MailMind, set `GOOGLE_DRIVE_ACCESS=full` in `.env` or the dashboard, save settings, and click **Connect Google** again. Files are still created private to your account.

## Settings

Environment variables are the defaults. Saving the dashboard overrides them in SQLite without replacing `.env`.

| Setting | Default | Where to change it |
| --- | --- | --- |
| `REPORT_TIMEZONE` | `Asia/Kolkata` | `.env` or Schedule form |
| `REPORT_HOUR` | `7` | `.env` or Schedule form |
| `REPORT_MINUTE` | `0` | `.env` or Schedule form |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | `.env` or Schedule form |
| `OLLAMA_MODEL` | `gemma3:4b` | `.env` or Schedule form. Must match `ollama list`. |
| `GOOGLE_DRIVE_FOLDER_ID` | empty | `.env`, Schedule form, or Create Drive folder |
| `SCHEDULE_ENABLED` | `false` | `.env` or the Enabled checkbox |
| `REPORT_CATCHUP` | `offer` | `off`, `offer`, or `auto` |

`offer` shows a missed-report banner after the computer slept through the scheduled minute. `auto` runs that missed period on startup when Google is connected. Scheduling and the reporting day both use `REPORT_TIMEZONE`.

The dashboard can run the previous day, a date range of up to 31 days, a test of a few emails, or a retry of the last failed run. Test runs do not mark messages as already reported. A retry continues at the failed stage and does not repeat finished analysis or a confirmed upload.

## Tests

```powershell
npm test
npm run typecheck
```

The unit tests cover timezone boundaries, duplicate Gmail IDs, quota retries, invalid model JSON, invented deadlines, failed uploads, resume, and the `.docx` contents. `npm run check:gemma` is the live local-model check and needs Ollama.

## Data

- `data/mailmind.sqlite` — runs, settings, processed IDs, and message text
- `data/google-tokens.json` — OAuth tokens
- `data/reports/` — local copies of reports

All of `data/` is gitignored.
