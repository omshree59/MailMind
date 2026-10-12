const runs = document.querySelector("#runs");
const logs = document.querySelector("#logs");
const ollamaPill = document.querySelector("#ollama-pill");
const googlePill = document.querySelector("#google-pill");
const connectCard = document.querySelector("#connect-card");
const missed = document.querySelector("#missed");
const message = document.querySelector("#action-message");
const form = document.querySelector("#settings");
const openReport = document.querySelector("#open-report");
const retry = document.querySelector("#retry");
const scheduleBadge = document.querySelector("#schedule-badge");

const kpiStatus = document.querySelector("#kpi-status");
const kpiAccount = document.querySelector("#kpi-account");
const kpiNext = document.querySelector("#kpi-next");
const kpiTz = document.querySelector("#kpi-tz");
const kpiLast = document.querySelector("#kpi-last");
const kpiLastMeta = document.querySelector("#kpi-last-meta");

function field(name) {
  return form.elements[name];
}

function renderStatus(status) {
  const isConnected = status.google.state === "connected";
  connectCard.classList.toggle("hidden", isConnected);

  ollamaPill.textContent = status.ollama.ok && status.ollama.installed
    ? `Local AI: ${status.config.OLLAMA_MODEL} Ready`
    : "Local AI: Unavailable";
  ollamaPill.className = status.ollama.ok && status.ollama.installed ? "pill ok" : "pill warn";

  if (isConnected) {
    googlePill.textContent = status.google.email
      ? `Gmail: ${status.google.email}`
      : "Gmail: Connected";
    googlePill.className = "pill ok";
  } else {
    googlePill.textContent = "Gmail: Not Connected";
    googlePill.className = "pill warn";
  }

  kpiStatus.textContent = status.busy
    ? `Running (${status.currentRun?.stage || "processing"}…)`
    : (status.scheduleEnabled ? "Daily Automation Active" : "Manual Mode");

  kpiAccount.textContent = isConnected
    ? (status.google.email || "Connected & Authorized")
    : "Connect Gmail to start";

  kpiNext.textContent = status.nextRunAt
    ? new Date(status.nextRunAt).toLocaleString()
    : "Paused";
  kpiTz.textContent = `Timezone: ${status.config.REPORT_TIMEZONE}`;

  scheduleBadge.textContent = status.scheduleEnabled ? "Active Daily" : "Paused";
  scheduleBadge.className = status.scheduleEnabled ? "badge ok" : "badge warn";

  const last = status.lastSuccess;
  if (last) {
    kpiLast.textContent = `Folder: ${last.periodLabel}`;
    kpiLastMeta.textContent = `${last.totalProcessed} primary emails · ${new Date(last.finishedAt).toLocaleTimeString()}`;
  } else {
    kpiLast.textContent = "No reports yet";
    kpiLastMeta.textContent = "Saved to Google Drive date folders";
  }

  if (status.latestReport?.driveUrl) {
    openReport.href = status.latestReport.driveUrl;
    openReport.classList.remove("hidden");
  } else {
    openReport.classList.add("hidden");
  }

  retry.disabled = !status.failedRun;

  if (status.missed && isConnected) {
    const label = status.missed.periodLabel;
    missed.classList.remove("hidden");
    missed.innerHTML = `
      <div>
        <strong>Missed scheduled report for ${label}.</strong>
        <span>The scheduled window passed while the computer was off or asleep.</span>
      </div>
      <button id="run-missed" class="btn btn-primary btn-sm" type="button">Run ${label} Report Now</button>
    `;
    document.querySelector("#run-missed")?.addEventListener("click", () => {
      startRun({ mode: "scheduled", from: label, to: label });
    });
  } else {
    missed.classList.add("hidden");
    missed.innerHTML = "";
  }
}

function fillSettings(config) {
  field("SCHEDULE_ENABLED").checked = config.SCHEDULE_ENABLED === "true";
  for (const key of ["REPORT_TIMEZONE", "REPORT_HOUR", "REPORT_MINUTE", "REPORT_CATCHUP"]) {
    if (field(key)) field(key).value = config[key] ?? "";
  }
}

function statusBadge(status) {
  if (status === "completed") return `<span class="badge ok">Completed</span>`;
  if (status === "running") return `<span class="badge">Running</span>`;
  return `<span class="badge err">Failed</span>`;
}

function renderRuns(list) {
  runs.innerHTML = list.map((run) => {
    const links = [];
    if (run.driveUrl) links.push(`<a class="btn btn-outline btn-sm" href="${run.driveUrl}" target="_blank" rel="noreferrer">Drive ↗</a>`);
    if (run.localPath) links.push(`<a class="btn btn-secondary btn-sm" href="/api/runs/${run.id}/docx">.docx</a>`);
    const reportCell = links.join(" ") || (run.error ? `<span class="badge err" title="${run.error}">Error</span>` : "—");
    return `<tr>
      <td>${new Date(run.startedAt).toLocaleString()}</td>
      <td><strong>📁 ${run.periodLabel}</strong></td>
      <td>${run.kind}</td>
      <td>${statusBadge(run.status)}</td>
      <td>${run.stage}</td>
      <td>${run.totalProcessed} inbox (${run.totalExcluded} skipped)</td>
      <td>${run.aiCount} Gemma / ${run.fallbackCount} fallback</td>
      <td>${reportCell}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="8">No report runs yet. Click "Run report now" to generate your first report.</td></tr>`;
}

function renderLogs(entries) {
  logs.innerHTML = entries.map((entry) => `<li>${new Date(entry.createdAt).toLocaleTimeString()} [${entry.level.toUpperCase()}] ${entry.message}</li>`).join("") || "<li>No logs yet.</li>";
}

let settingsReady = false;
async function refresh() {
  const status = await fetch("/api/status").then((response) => response.json());
  renderStatus(status);
  if (!settingsReady) {
    fillSettings(status.config);
    settingsReady = true;
  }
  renderRuns(status.runs);
  renderLogs(await fetch("/api/logs").then((response) => response.json()));
  if (status.busy) setTimeout(refresh, 2500);
}

async function startRun(body) {
  message.textContent = "Starting report pipeline…";
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  message.textContent = response.ok
    ? `Started ${payload.kind} report for date folder ${payload.periodLabel}.`
    : payload.error;
  await refresh();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    SCHEDULE_ENABLED: String(field("SCHEDULE_ENABLED").checked),
    REPORT_TIMEZONE: field("REPORT_TIMEZONE").value,
    REPORT_HOUR: field("REPORT_HOUR").value,
    REPORT_MINUTE: field("REPORT_MINUTE").value,
    REPORT_CATCHUP: field("REPORT_CATCHUP").value,
  };
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  message.textContent = response.ok ? "Daily automation schedule saved." : body.error;
  settingsReady = false;
  await refresh();
});

document.querySelector("#run-now").addEventListener("click", () => startRun({ mode: "now" }));
document.querySelector("#run-test").addEventListener("click", () => startRun({ mode: "test" }));
retry.addEventListener("click", () => startRun({ mode: "retry" }));
document.querySelector("#range").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  startRun({ mode: "now", from: data.get("from"), to: data.get("to") });
});
document.querySelector("#refresh-logs").addEventListener("click", async () => {
  renderLogs(await fetch("/api/logs").then((response) => response.json()));
});

refresh();
