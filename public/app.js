/* MailMind AI — Editorial SaaS Workspace Controller */

const VIEW_METADATA = {
  overview: {
    title: "Overview",
    subtitle: "Daily Primary Inbox intelligence, Gemma summarization, and Google Drive synchronization.",
  },
  inbox: {
    title: "Inbox Intelligence",
    subtitle: "Inspect Primary Inbox messages analyzed by local Gemma with extracted facts, deadlines, and action items.",
  },
  categories: {
    title: "Categories & Domain Lenses",
    subtitle: "Explore synchronized Primary Inbox messages across academic, work, financial, and core AI categories.",
  },
  actions: {
    title: "Action Items & Deadlines",
    subtitle: "Tasks and verbatim-verified deadlines extracted from your Primary Inbox messages.",
  },
  reports: {
    title: "Daily Word Reports",
    subtitle: "Generate, download, and open formatted .docx reports organized in date-wise Google Drive folders.",
  },
  automation: {
    title: "Automation Center",
    subtitle: "Configure daily scheduled execution, timezone rules, and computer sleep catch-up behavior.",
  },
  logs: {
    title: "Activity Logs",
    subtitle: "Real-time operational telemetry and pipeline audit trail with automatic secret redaction.",
  },
  settings: {
    title: "System Settings",
    subtitle: "Account connection, local Ollama model status, inbox filtering rules, and storage configuration.",
  },
};

const FOCUS_DOMAINS = [
  {
    id: "college",
    name: "College & Education",
    description: "Courses, university notices, faculty correspondence, and campus announcements.",
    match: (msg) =>
      /\b(college|university|campus|professor|faculty|lecture|semester|syllabus|course|academic|student|dean|department|vit|iit|nit|edu)\b/i.test(
        `${msg.subject} ${msg.sender} ${msg.snippet} ${msg.analysis?.summary || ""}`,
      ),
  },
  {
    id: "assignments",
    name: "Assignments & Exams",
    description: "Deadlines, quizzes, lab submissions, project evaluations, and exam schedules.",
    match: (msg) =>
      /\b(assignment|exam|quiz|midterm|final|submission|grade|homework|lab|test|project|assessment|deadline)\b/i.test(
        `${msg.subject} ${msg.sender} ${msg.snippet} ${msg.analysis?.summary || ""}`,
      ),
  },
  {
    id: "jobs",
    name: "Jobs & Internships",
    description: "Recruiting, interview invites, internship offers, applications, and career updates.",
    match: (msg) =>
      /\b(job|internship|interview|recruiter|hiring|application|offer|resume|career|candidate|onboarding|stipend|role|position)\b/i.test(
        `${msg.subject} ${msg.sender} ${msg.snippet} ${msg.analysis?.summary || ""}`,
      ) || msg.analysis?.category === "Work",
  },
  {
    id: "finance",
    name: "Finance & Bills",
    description: "Invoices, payment confirmations, bank alerts, tax statements, and subscriptions.",
    match: (msg) =>
      msg.analysis?.category === "Finance" ||
      /\b(invoice|payment|bill|receipt|bank|transaction|statement|tax|refund|salary|upi|credit|debit)\b/i.test(
        `${msg.subject} ${msg.sender} ${msg.snippet}`,
      ),
  },
  {
    id: "orders",
    name: "Purchases & Orders",
    description: "Order confirmations, shipping updates, deliveries, and travel bookings.",
    match: (msg) =>
      msg.analysis?.category === "Travel" ||
      /\b(order|shipment|delivery|dispatched|tracking|amazon|flipkart|flight|hotel|booking|ticket|parcel)\b/i.test(
        `${msg.subject} ${msg.sender} ${msg.snippet}`,
      ),
  },
  {
    id: "security",
    name: "Security & Access",
    description: "Security alerts, verification codes, OAuth grants, and sign-in notifications.",
    match: (msg) =>
      msg.analysis?.category === "Security" ||
      /\b(security|password|verification|otp|login|sign-in|2fa|authentication|access|alert)\b/i.test(
        `${msg.subject} ${msg.sender} ${msg.snippet}`,
      ),
  },
  {
    id: "personal",
    name: "Personal & Meetings",
    description: "Direct personal correspondence, calendar invitations, and 1-on-1 scheduling.",
    match: (msg) =>
      msg.analysis?.category === "Personal" ||
      msg.analysis?.category === "Meetings" ||
      /\b(meeting|calendar|invite|zoom|google meet|catch up|dinner|lunch|family)\b/i.test(
        `${msg.subject} ${msg.sender} ${msg.snippet}`,
      ),
  },
  {
    id: "other",
    name: "General & Notifications",
    description: "System updates, general correspondence, and uncategorized primary messages.",
    match: (msg) =>
      msg.analysis?.category === "Notifications" ||
      msg.analysis?.category === "Newsletters" ||
      msg.analysis?.category === "Other",
  },
];

const CORE_CATEGORIES = [
  { id: "Work", name: "Work", description: "Professional projects, team threads, and workplace tasks." },
  { id: "Personal", name: "Personal", description: "Direct personal messages and individual correspondence." },
  { id: "Finance", name: "Finance", description: "Invoices, billing, receipts, and financial statements." },
  { id: "Security", name: "Security", description: "Account security alerts, sign-ins, and verification notices." },
  { id: "Meetings", name: "Meetings", description: "Calendar invitations, agenda notes, and scheduling requests." },
  { id: "Travel", name: "Travel", description: "Itineraries, transit bookings, and accommodation details." },
  { id: "Notifications", name: "Notifications", description: "Automated service updates that arrived in Primary Inbox." },
  { id: "Newsletters", name: "Newsletters", description: "Digests and editorial publications in Primary Inbox." },
  { id: "Other", name: "Other", description: "General correspondence outside standard categories." },
];

const IMPORTANCE_WEIGHT = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

const state = {
  activeView: "overview",
  status: null,
  messages: [],
  logs: [],
  selectedPeriod: "",
  globalSearch: "",
  inbox: {
    category: "",
    importance: "",
    action: "",
    sort: "date-desc",
    page: 1,
    pageSize: 12,
    selectedGmailId: null,
  },
  categories: {
    selectedType: "domain", // "domain" | "core"
    selectedId: "college",
  },
  actionsFilter: "all",
  reportsSearch: "",
  logsFilter: {
    level: "",
    search: "",
  },
  formHydrated: false,
  isLoading: true,
};

const el = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function senderDisplayName(sender) {
  if (!sender) return "Unknown Sender";
  const cleaned = String(sender).replace(/<[^>]+>/g, "").replace(/"/g, "").trim();
  return cleaned || sender;
}

function importanceBadge(importance) {
  const imp = importance || "Low";
  const cls =
    imp === "Critical"
      ? "badge-critical"
      : imp === "High"
        ? "badge-high"
        : imp === "Medium"
          ? "badge-medium"
          : "badge-low";
  return `<span class="badge ${cls}">${escapeHtml(imp)}</span>`;
}

function categoryBadge(category) {
  const cat = category || "Other";
  return `<span class="badge badge-cat badge-cat-${escapeHtml(cat)}">${escapeHtml(cat)}</span>`;
}

function statusBadge(status) {
  const s = status || "unknown";
  const cls =
    s === "completed"
      ? "badge-forest"
      : s === "running"
        ? "badge-medium"
        : s === "failed"
          ? "badge-critical"
          : "badge-neutral";
  return `<span class="badge ${cls}">${escapeHtml(s)}</span>`;
}

function showToast(message, isError = false) {
  const bar = el("toast-bar");
  if (!bar) return;
  bar.textContent = message;
  bar.classList.remove("hidden", "error");
  if (isError) bar.classList.add("error");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    bar.classList.add("hidden");
  }, 4800);
}

async function apiJson(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

/* ==========================================================================
   Navigation & View Switching
   ========================================================================== */

function switchView(viewName) {
  if (!VIEW_METADATA[viewName]) return;
  state.activeView = viewName;

  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === viewName);
  });

  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${viewName}`);
  });

  const meta = VIEW_METADATA[viewName];
  el("page-title").textContent = meta.title;
  el("page-subtitle").textContent = meta.subtitle;

  // Close mobile sidebar if open
  el("sidebar")?.classList.remove("mobile-open");

  renderActiveView();
}

/* ==========================================================================
   Data Filtering Helpers
   ========================================================================== */

function getPeriodFilteredMessages() {
  let list = state.messages || [];
  if (state.selectedPeriod) {
    list = list.filter((m) => m.periodLabel === state.selectedPeriod);
  }
  return list;
}

function getAllExtractedTasks(messages) {
  const items = [];
  for (const msg of messages) {
    const analysis = msg.analysis || {};
    const actions = Array.isArray(analysis.actionItems) ? analysis.actionItems : [];
    const deadlines = Array.isArray(analysis.deadlines) ? analysis.deadlines : [];

    if (actions.length > 0) {
      actions.forEach((taskText, idx) => {
        items.push({
          id: `${msg.gmailId}-act-${idx}`,
          task: taskText,
          deadline: deadlines[idx] || deadlines[0] || null,
          allDeadlines: deadlines,
          importance: analysis.importance || "Low",
          category: analysis.category || "Other",
          replyNeeded: Boolean(analysis.replyNeeded),
          gmailId: msg.gmailId,
          subject: msg.subject,
          sender: msg.sender,
          receivedAt: msg.receivedAt,
          gmailLink: msg.gmailLink,
        });
      });
    } else if (deadlines.length > 0) {
      deadlines.forEach((dlText, idx) => {
        items.push({
          id: `${msg.gmailId}-dl-${idx}`,
          task: `Observed deadline in "${msg.subject}"`,
          deadline: dlText,
          allDeadlines: deadlines,
          importance: analysis.importance || "Low",
          category: analysis.category || "Other",
          replyNeeded: Boolean(analysis.replyNeeded),
          gmailId: msg.gmailId,
          subject: msg.subject,
          sender: msg.sender,
          receivedAt: msg.receivedAt,
          gmailLink: msg.gmailLink,
        });
      });
    } else if (analysis.replyNeeded) {
      items.push({
        id: `${msg.gmailId}-reply`,
        task: `Reply requested: ${msg.subject}`,
        deadline: null,
        allDeadlines: [],
        importance: analysis.importance || "Low",
        category: analysis.category || "Other",
        replyNeeded: true,
        gmailId: msg.gmailId,
        subject: msg.subject,
        sender: msg.sender,
        receivedAt: msg.receivedAt,
        gmailLink: msg.gmailLink,
      });
    }
  }

  return items.sort(
    (a, b) => (IMPORTANCE_WEIGHT[b.importance] || 0) - (IMPORTANCE_WEIGHT[a.importance] || 0),
  );
}

/* ==========================================================================
   Shell, Sidebar, Topbar & Global Banners Rendering
   ========================================================================== */

function updatePeriodSelector() {
  const select = el("period-selector");
  if (!select) return;

  const periodsFromRuns = (state.status?.runs || []).map((r) => r.periodLabel).filter(Boolean);
  const periodsFromMsgs = (state.messages || []).map((m) => m.periodLabel).filter(Boolean);
  const uniquePeriods = Array.from(new Set([...periodsFromRuns, ...periodsFromMsgs])).sort((a, b) =>
    b.localeCompare(a),
  );

  const currentVal = state.selectedPeriod;
  select.innerHTML = `<option value="">All synchronized periods (${state.messages.length} emails)</option>` +
    uniquePeriods
      .map((p) => {
        const count = state.messages.filter((m) => m.periodLabel === p).length;
        return `<option value="${escapeHtml(p)}" ${p === currentVal ? "selected" : ""}>Period: ${escapeHtml(p)} (${count})</option>`;
      })
      .join("");
}

function renderShellStatus() {
  const status = state.status;
  if (!status) return;

  const googleOk = Boolean(status.google?.connected);
  const ollamaOk = Boolean(status.ollama?.reachable && status.ollama?.configuredModelInstalled);
  const driveOk = Boolean(status.google?.connected && status.driveConfigured);

  // Sidebar status dots
  const setDot = (dotId, stateId, stateType, label) => {
    const dot = el(dotId);
    const st = el(stateId);
    if (dot) {
      dot.className = `status-dot ${stateType}`;
    }
    if (st) {
      st.textContent = label;
    }
  };

  setDot("dot-gmail", "state-gmail", googleOk ? "ok" : "err", googleOk ? "Connected" : "Action Needed");
  setDot(
    "dot-ollama",
    "state-ollama",
    ollamaOk ? "ok" : status.ollama?.reachable ? "warn" : "err",
    ollamaOk ? status.config?.ollamaModel || "Ready" : status.ollama?.reachable ? "Model Missing" : "Offline",
  );
  setDot("dot-drive", "state-drive", driveOk ? "ok" : "warn", driveOk ? "Date Folders" : "Standby");

  // Topbar account chip
  const chipDot = el("chip-dot");
  const chipLabel = el("chip-label");
  if (chipDot && chipLabel) {
    chipDot.className = `status-dot ${googleOk ? "ok" : "err"}`;
    chipLabel.textContent = googleOk
      ? status.google.emailAddress || "Gmail Connected"
      : "Gmail Not Connected";
  }

  // Sidebar navigation counts
  const periodMessages = getPeriodFilteredMessages();
  const tasks = getAllExtractedTasks(periodMessages);
  const completedReports = (status.runs || []).filter((r) => r.status === "completed").length;

  el("nav-count-inbox").textContent = String(periodMessages.length);
  el("nav-count-actions").textContent = String(tasks.length);
  el("nav-count-reports").textContent = String(completedReports || (status.runs || []).length);

  // Connect banner
  const connectBanner = el("connect-banner");
  if (connectBanner) {
    connectBanner.classList.toggle("hidden", googleOk);
  }

  // Active Running Job banner
  const runningBanner = el("running-banner");
  if (runningBanner) {
    if (status.running) {
      runningBanner.classList.remove("hidden");
      const activeRun = (status.runs || []).find((r) => r.status === "running");
      el("running-title").textContent = activeRun
        ? `Processing report for ${activeRun.periodLabel}…`
        : "Report pipeline is currently executing…";
      el("running-stage-badge").textContent = activeRun?.stage || "Running";
    } else {
      runningBanner.classList.add("hidden");
    }
  }

  // Missed scheduled run banner
  const missedBanner = el("missed-banner");
  if (missedBanner) {
    if (status.missedPeriodLabel && !status.running) {
      missedBanner.classList.remove("hidden");
      missedBanner.innerHTML = `
        <div class="alert-body">
          <strong>Missed Scheduled Report Detected (${escapeHtml(status.missedPeriodLabel)})</strong>
          <span>Your computer was asleep or offline during the scheduled window for ${escapeHtml(status.missedPeriodLabel)}.</span>
        </div>
        <button class="btn btn-primary btn-sm" id="run-missed-btn" type="button">Run ${escapeHtml(status.missedPeriodLabel)} Now</button>
      `;
      el("run-missed-btn")?.addEventListener("click", () =>
        triggerRun({ date: status.missedPeriodLabel, trigger: "catchup" }),
      );
    } else {
      missedBanner.classList.add("hidden");
      missedBanner.innerHTML = "";
    }
  }

  // Top Run Now button state
  const topRunBtn = el("top-run-now");
  if (topRunBtn) {
    topRunBtn.disabled = Boolean(status.running);
  }
}

/* ==========================================================================
   VIEW 1: Overview Dashboard
   ========================================================================== */

function renderOverviewView() {
  const status = state.status;
  if (!status) return;

  const messages = getPeriodFilteredMessages();
  const runs = status.runs || [];

  // Metric 1: Total Emails Processed
  const aiCount = messages.filter((m) => m.analysis?.aiSummaryAvailable).length;
  const fallbackCount = messages.length - aiCount;
  el("ov-period-tag").textContent = state.selectedPeriod || "All Periods";
  el("ov-total-emails").textContent = String(messages.length);
  el("ov-ai-breakdown").textContent =
    messages.length > 0
      ? `${aiCount} Gemma AI · ${fallbackCount} rule-based · Primary Inbox only`
      : "Primary Inbox only (Promotions & Updates excluded)";

  // Metric 2: High Priority & Critical
  const highPriorityMsgs = messages.filter(
    (m) => m.analysis?.importance === "Critical" || m.analysis?.importance === "High",
  );
  const replyMsgs = messages.filter((m) => m.analysis?.replyNeeded);
  el("ov-high-priority").textContent = String(highPriorityMsgs.length);
  el("ov-reply-count").textContent = `${replyMsgs.length} awaiting reply`;

  // Metric 3: Pending Actions & Deadlines
  const totalActions = messages.reduce(
    (acc, m) => acc + (Array.isArray(m.analysis?.actionItems) ? m.analysis.actionItems.length : 0),
    0,
  );
  const totalDeadlines = messages.reduce(
    (acc, m) => acc + (Array.isArray(m.analysis?.deadlines) ? m.analysis.deadlines.length : 0),
    0,
  );
  el("ov-actions-count").textContent = String(totalActions);
  el("ov-deadlines-count").textContent = `${totalDeadlines} explicit deadline${totalDeadlines === 1 ? "" : "s"} verified`;

  // Metric 4: Schedule & Last Sync
  const schedEnabled = Boolean(status.config?.scheduleEnabled);
  const schedBadge = el("ov-schedule-badge");
  if (schedBadge) {
    schedBadge.className = `badge ${schedEnabled ? "badge-forest" : "badge-neutral"}`;
    schedBadge.textContent = schedEnabled ? "Automated Daily" : "Paused";
  }
  el("ov-next-run").textContent = status.nextScheduledRun
    ? formatShortTime(status.nextScheduledRun)
    : "Schedule disabled";
  el("ov-last-sync").textContent = status.lastSuccessfulRun
    ? `Last sync: ${ status.lastSuccessfulRun.periodLabel } (${formatShortTime(status.lastSuccessfulRun.completedAt)})`
    : "Last sync: no completed run yet";

  // Priority Emails Requiring Attention List
  const priorityContainer = el("ov-priority-list");
  const attentionEmails = messages
    .filter(
      (m) =>
        m.analysis?.importance === "Critical" ||
        m.analysis?.importance === "High" ||
        m.analysis?.replyNeeded ||
        (m.analysis?.deadlines && m.analysis.deadlines.length > 0),
    )
    .slice(0, 6);

  const displayEmails = attentionEmails.length > 0 ? attentionEmails : messages.slice(0, 5);

  if (displayEmails.length === 0) {
    priorityContainer.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No synchronized emails for this period yet</p>
        <p class="empty-desc">Click "Run Report Now" in the top bar or "Test (3 Emails)" below to fetch and analyze your Primary Inbox.</p>
      </div>
    `;
  } else {
    priorityContainer.innerHTML = displayEmails
      .map((msg) => {
        const analysis = msg.analysis || {};
        const deadlines = Array.isArray(analysis.deadlines) ? analysis.deadlines : [];
        return `
          <article class="stack-item" data-inspect-id="${escapeHtml(msg.gmailId)}" style="cursor:pointer">
            <div class="stack-item-main">
              <div class="stack-item-title">
                ${importanceBadge(analysis.importance)}
                ${categoryBadge(analysis.category)}
                <span>${escapeHtml(msg.subject)}</span>
              </div>
              <div class="stack-item-meta">
                <span>${escapeHtml(senderDisplayName(msg.sender))}</span>
                <span>·</span>
                <span>${escapeHtml(formatShortTime(msg.receivedAt))}</span>
                ${analysis.replyNeeded ? `<span>· <strong style="color:var(--accent)">Reply Needed</strong></span>` : ""}
                ${deadlines.length > 0 ? `<span>· Deadline: ${escapeHtml(deadlines[0])}</span>` : ""}
              </div>
              <div class="stack-item-desc">${escapeHtml(analysis.summary || msg.snippet)}</div>
            </div>
            <div class="stack-item-actions">
              <button class="btn btn-secondary btn-sm" type="button" data-inspect-id="${escapeHtml(msg.gmailId)}">Inspect</button>
              ${msg.gmailLink ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(msg.gmailLink)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">Gmail ↗</a>` : ""}
            </div>
          </article>
        `;
      })
      .join("");
  }

  // Latest Generated Reports List
  const reportsContainer = el("ov-reports-list");
  const recentRuns = runs.slice(0, 5);
  if (recentRuns.length === 0) {
    reportsContainer.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No Word reports generated yet</p>
        <p class="empty-desc">Run your first report to generate a formatted .docx document and upload it to Google Drive.</p>
      </div>
    `;
  } else {
    reportsContainer.innerHTML = recentRuns
      .map((run) => {
        const hasDocx = Boolean(run.docxPath);
        const hasDrive = Boolean(run.driveUrl);
        return `
          <article class="stack-item">
            <div class="stack-item-main">
              <div class="stack-item-title">
                <span class="mono">📁 ${escapeHtml(run.periodLabel)}</span>
                ${statusBadge(run.status)}
                <span class="badge badge-neutral">${escapeHtml(run.trigger)}</span>
              </div>
              <div class="stack-item-meta">
                <span>${run.processedCount} emails analyzed (${run.aiCount} Gemma AI, ${run.fallbackCount} fallback)</span>
                <span>·</span>
                <span>Stage: ${escapeHtml(run.stage)}</span>
                <span>·</span>
                <span>Duration: ${escapeHtml(formatDuration(run.durationMs))}</span>
              </div>
              ${run.errorSummary ? `<div class="stack-item-desc" style="color:var(--critical)">${escapeHtml(run.errorSummary)}</div>` : ""}
            </div>
            <div class="stack-item-actions">
              ${hasDocx ? `<a class="btn btn-secondary btn-sm" href="/api/runs/${run.id}/docx">Download .docx</a>` : ""}
              ${hasDrive ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(run.driveUrl)}" target="_blank" rel="noreferrer">Google Drive ↗</a>` : ""}
            </div>
          </article>
        `;
      })
      .join("");
  }

  // Detected Action Items (Side Column)
  const actionsListEl = el("ov-actions-list");
  const extractedTasks = getAllExtractedTasks(messages).slice(0, 6);
  if (extractedTasks.length === 0) {
    actionsListEl.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No pending action items</p>
        <p class="empty-desc">Action items and explicit deadlines extracted from your Primary Inbox will appear here.</p>
      </div>
    `;
  } else {
    actionsListEl.innerHTML = extractedTasks
      .map(
        (item) => `
        <div class="compact-item" data-inspect-id="${escapeHtml(item.gmailId)}" style="cursor:pointer">
          <div class="compact-item-top">
            <span class="compact-item-title">${escapeHtml(item.task)}</span>
            ${importanceBadge(item.importance)}
          </div>
          <div class="compact-item-sub">
            <span>From: ${escapeHtml(senderDisplayName(item.sender))}</span>
            ${item.deadline ? ` · <strong>Deadline: ${escapeHtml(item.deadline)}</strong>` : ""}
          </div>
        </div>
      `,
      )
      .join("");
  }

  // Recent Activity Timeline (Side Column)
  const timelineEl = el("ov-timeline");
  const recentLogs = (state.logs || []).slice(0, 7);
  if (recentLogs.length === 0) {
    timelineEl.innerHTML = `<li class="timeline-item"><div class="timeline-msg">No activity logs recorded yet.</div></li>`;
  } else {
    timelineEl.innerHTML = recentLogs
      .map(
        (log) => `
        <li class="timeline-item ${escapeHtml(log.level)}">
          <div class="timeline-time">${escapeHtml(formatShortTime(log.createdAt))} · ${escapeHtml(log.level.toUpperCase())}</div>
          <div class="timeline-msg">${escapeHtml(log.message)}</div>
        </li>
      `,
      )
      .join("");
  }
}

/* ==========================================================================
   VIEW 2: Inbox Intelligence & Detail Inspector
   ========================================================================== */

function getFilteredInboxMessages() {
  let list = getPeriodFilteredMessages();

  const q = (state.globalSearch || "").trim().toLowerCase();
  if (q) {
    list = list.filter((msg) => {
      const hay = `${msg.subject} ${msg.sender} ${msg.snippet} ${msg.analysis?.summary || ""} ${(msg.analysis?.actionItems || []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }

  if (state.inbox.category) {
    list = list.filter((msg) => msg.analysis?.category === state.inbox.category);
  }

  if (state.inbox.importance) {
    list = list.filter((msg) => msg.analysis?.importance === state.inbox.importance);
  }

  if (state.inbox.action === "action") {
    list = list.filter((msg) => Array.isArray(msg.analysis?.actionItems) && msg.analysis.actionItems.length > 0);
  } else if (state.inbox.action === "deadline") {
    list = list.filter((msg) => Array.isArray(msg.analysis?.deadlines) && msg.analysis.deadlines.length > 0);
  } else if (state.inbox.action === "reply") {
    list = list.filter((msg) => Boolean(msg.analysis?.replyNeeded));
  }

  list = [...list];
  if (state.inbox.sort === "date-asc") {
    list.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
  } else if (state.inbox.sort === "importance") {
    list.sort(
      (a, b) =>
        (IMPORTANCE_WEIGHT[b.analysis?.importance] || 0) - (IMPORTANCE_WEIGHT[a.analysis?.importance] || 0) ||
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );
  } else {
    list.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }

  return list;
}

function renderInboxView() {
  const filtered = getFilteredInboxMessages();
  el("inbox-result-count").textContent = `${filtered.length} email${filtered.length === 1 ? "" : "s"}`;

  const totalPages = Math.max(1, Math.ceil(filtered.length / state.inbox.pageSize));
  if (state.inbox.page > totalPages) state.inbox.page = totalPages;
  if (state.inbox.page < 1) state.inbox.page = 1;

  const startIdx = (state.inbox.page - 1) * state.inbox.pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + state.inbox.pageSize);

  el("inbox-page-info").textContent = `Page ${state.inbox.page} of ${totalPages}`;
  el("inbox-prev").disabled = state.inbox.page <= 1;
  el("inbox-next").disabled = state.inbox.page >= totalPages;

  const listEl = el("inbox-list");
  if (pageItems.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No matching Primary Inbox emails</p>
        <p class="empty-desc">Try clearing your search or filter criteria, or run a new report to synchronize recent emails.</p>
      </div>
    `;
    renderInboxDetail(null);
    return;
  }

  // Ensure an email is selected if available
  const selectedExists = filtered.some((m) => m.gmailId === state.inbox.selectedGmailId);
  if (!selectedExists && pageItems.length > 0) {
    state.inbox.selectedGmailId = pageItems[0].gmailId;
  }

  listEl.innerHTML = pageItems
    .map((msg) => {
      const analysis = msg.analysis || {};
      const isSelected = msg.gmailId === state.inbox.selectedGmailId;
      const isPriority = analysis.importance === "Critical" || analysis.importance === "High";
      const actionCount = Array.isArray(analysis.actionItems) ? analysis.actionItems.length : 0;
      const deadlineCount = Array.isArray(analysis.deadlines) ? analysis.deadlines.length : 0;

      return `
        <div class="email-row ${isSelected ? "selected" : ""} ${isPriority ? "priority-high" : ""}" data-email-id="${escapeHtml(msg.gmailId)}" role="listitem">
          <div class="email-row-top">
            <span class="email-sender">${escapeHtml(senderDisplayName(msg.sender))}</span>
            <span class="email-time">${escapeHtml(formatShortTime(msg.receivedAt))}</span>
          </div>
          <div class="email-subject">${escapeHtml(msg.subject)}</div>
          <div class="email-summary">${escapeHtml(analysis.summary || msg.snippet)}</div>
          <div class="email-badges">
            ${importanceBadge(analysis.importance)}
            ${categoryBadge(analysis.category)}
            ${actionCount > 0 ? `<span class="badge badge-neutral">${actionCount} action${actionCount === 1 ? "" : "s"}</span>` : ""}
            ${deadlineCount > 0 ? `<span class="badge badge-high">Deadline</span>` : ""}
            ${analysis.replyNeeded ? `<span class="badge badge-forest">Reply Needed</span>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  const activeMsg = filtered.find((m) => m.gmailId === state.inbox.selectedGmailId) || pageItems[0];
  renderInboxDetail(activeMsg);
}

function renderInboxDetail(msg) {
  const detailEl = el("inbox-detail");
  if (!detailEl) return;

  if (!msg) {
    detailEl.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">Select an email to inspect</p>
        <p class="empty-desc">View Gemma's concise summary, extracted key facts, explicit deadlines, action items, and open the original thread in Gmail.</p>
      </div>
    `;
    return;
  }

  const analysis = msg.analysis || {};
  const keyInfo = Array.isArray(analysis.keyInformation) ? analysis.keyInformation : [];
  const actionItems = Array.isArray(analysis.actionItems) ? analysis.actionItems : [];
  const deadlines = Array.isArray(analysis.deadlines) ? analysis.deadlines : [];

  detailEl.innerHTML = `
    <div class="detail-header">
      <div class="email-badges" style="margin-bottom:10px">
        ${importanceBadge(analysis.importance)}
        ${categoryBadge(analysis.category)}
        <span class="badge badge-neutral">${analysis.aiSummaryAvailable ? "Gemma Local AI" : "Rule Fallback"}</span>
        ${analysis.replyNeeded ? `<span class="badge badge-forest">Reply Recommended</span>` : ""}
      </div>
      <h2 class="detail-subject">${escapeHtml(msg.subject)}</h2>
      <div class="detail-meta">
        <div><strong>From:</strong> ${escapeHtml(msg.sender)}</div>
        <div><strong>Received:</strong> ${escapeHtml(formatDateTime(msg.receivedAt))} · <strong>Report Period:</strong> <span class="mono">${escapeHtml(msg.periodLabel)}</span></div>
      </div>
      <div class="detail-actions">
        ${msg.gmailLink ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(msg.gmailLink)}" target="_blank" rel="noreferrer">Open Original in Gmail ↗</a>` : ""}
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Concise AI Summary</div>
      <div class="detail-summary-box">
        ${escapeHtml(analysis.summary || msg.snippet || "No summary available.")}
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Explicit Deadlines (${deadlines.length})</div>
      ${
        deadlines.length > 0
          ? `<ul class="detail-list">${deadlines.map((d) => `<li><strong>${escapeHtml(d)}</strong> <span class="muted-text">(verified in message text)</span></li>`).join("")}</ul>`
          : `<p class="muted-text">No explicit deadlines stated in this email.</p>`
      }
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Action Items (${actionItems.length})</div>
      ${
        actionItems.length > 0
          ? `<ul class="detail-list">${actionItems.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`
          : `<p class="muted-text">No specific action items required.</p>`
      }
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Key Facts &amp; Extracted Information (${keyInfo.length})</div>
      ${
        keyInfo.length > 0
          ? `<ul class="detail-list">${keyInfo.map((k) => `<li>${escapeHtml(k)}</li>`).join("")}</ul>`
          : `<p class="muted-text">No additional key facts extracted.</p>`
      }
    </div>
  `;
}

function inspectEmailInInbox(gmailId) {
  if (!gmailId) return;
  state.inbox.selectedGmailId = gmailId;
  state.inbox.category = "";
  state.inbox.importance = "";
  state.inbox.action = "";
  state.inbox.page = 1;
  switchView("inbox");
}

/* ==========================================================================
   VIEW 3: Categories & Domain Lenses
   ========================================================================== */

function renderCategoriesView() {
  const messages = getPeriodFilteredMessages();

  // Render Focus Domains Grid
  const domainGrid = el("domain-categories-grid");
  domainGrid.innerHTML = FOCUS_DOMAINS.map((domain) => {
    const matched = messages.filter(domain.match);
    const active =
      state.categories.selectedType === "domain" && state.categories.selectedId === domain.id;
    return `
      <div class="category-card ${active ? "active" : ""}" data-cat-type="domain" data-cat-id="${escapeHtml(domain.id)}">
        <div class="category-card-head">
          <span class="category-name">${escapeHtml(domain.name)}</span>
          <span class="category-count">${matched.length}</span>
        </div>
        <div class="category-desc">${escapeHtml(domain.description)}</div>
      </div>
    `;
  }).join("");

  // Render Core AI Categories Grid
  const coreGrid = el("core-categories-grid");
  coreGrid.innerHTML = CORE_CATEGORIES.map((cat) => {
    const matched = messages.filter((m) => (m.analysis?.category || "Other") === cat.id);
    const active =
      state.categories.selectedType === "core" && state.categories.selectedId === cat.id;
    return `
      <div class="category-card ${active ? "active" : ""}" data-cat-type="core" data-cat-id="${escapeHtml(cat.id)}">
        <div class="category-card-head">
          <span class="category-name">${escapeHtml(cat.name)}</span>
          <span class="category-count">${matched.length}</span>
        </div>
        <div class="category-desc">${escapeHtml(cat.description)}</div>
      </div>
    `;
  }).join("");

  // Render Preview Panel for selected category
  let selectedTitle = "";
  let filteredMsgs = [];
  if (state.categories.selectedType === "domain") {
    const dom = FOCUS_DOMAINS.find((d) => d.id === state.categories.selectedId) || FOCUS_DOMAINS[0];
    selectedTitle = `${dom.name} (${messages.filter(dom.match).length})`;
    filteredMsgs = messages.filter(dom.match);
  } else {
    const core = CORE_CATEGORIES.find((c) => c.id === state.categories.selectedId) || CORE_CATEGORIES[0];
    selectedTitle = `${core.name} Category (${messages.filter((m) => (m.analysis?.category || "Other") === core.id).length})`;
    filteredMsgs = messages.filter((m) => (m.analysis?.category || "Other") === core.id);
  }

  el("category-preview-title").textContent = selectedTitle;
  el("category-preview-subtitle").textContent =
    filteredMsgs.length > 0
      ? `Showing ${filteredMsgs.length} matching Primary Inbox email${filteredMsgs.length === 1 ? "" : "s"}.`
      : "No synchronized emails currently match this category.";

  const previewList = el("category-emails-list");
  if (filteredMsgs.length === 0) {
    previewList.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No emails in this category</p>
        <p class="empty-desc">Select another category card above or synchronize additional reporting periods.</p>
      </div>
    `;
  } else {
    previewList.innerHTML = filteredMsgs
      .slice(0, 15)
      .map((msg) => {
        const analysis = msg.analysis || {};
        return `
          <article class="stack-item" data-inspect-id="${escapeHtml(msg.gmailId)}" style="cursor:pointer">
            <div class="stack-item-main">
              <div class="stack-item-title">
                ${importanceBadge(analysis.importance)}
                ${categoryBadge(analysis.category)}
                <span>${escapeHtml(msg.subject)}</span>
              </div>
              <div class="stack-item-meta">
                <span>${escapeHtml(senderDisplayName(msg.sender))}</span>
                <span>·</span>
                <span>${escapeHtml(formatShortTime(msg.receivedAt))}</span>
              </div>
              <div class="stack-item-desc">${escapeHtml(analysis.summary || msg.snippet)}</div>
            </div>
            <div class="stack-item-actions">
              <button class="btn btn-secondary btn-sm" type="button" data-inspect-id="${escapeHtml(msg.gmailId)}">Inspect</button>
              ${msg.gmailLink ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(msg.gmailLink)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">Gmail ↗</a>` : ""}
            </div>
          </article>
        `;
      })
      .join("");
  }
}

/* ==========================================================================
   VIEW 4: Action Items & Deadlines
   ========================================================================== */

function renderActionsView() {
  const messages = getPeriodFilteredMessages();
  let tasks = getAllExtractedTasks(messages);

  const q = (state.globalSearch || "").trim().toLowerCase();
  if (q) {
    tasks = tasks.filter((t) => `${t.task} ${t.subject} ${t.sender} ${t.deadline || ""}`.toLowerCase().includes(q));
  }

  if (state.actionsFilter === "deadline") {
    tasks = tasks.filter((t) => Boolean(t.deadline));
  } else if (state.actionsFilter === "critical-high") {
    tasks = tasks.filter((t) => t.importance === "Critical" || t.importance === "High");
  } else if (state.actionsFilter === "reply") {
    tasks = tasks.filter((t) => t.replyNeeded);
  }

  const wrap = el("actions-table-wrap");
  if (tasks.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No extracted action items or deadlines match this view</p>
        <p class="empty-desc">MailMind AI only displays real tasks and verbatim deadlines verified in your Primary Inbox emails.</p>
      </div>
    `;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Importance</th>
          <th>Action Item / Task</th>
          <th>Explicit Deadline</th>
          <th>Reply State</th>
          <th>Source Email &amp; Sender</th>
          <th>Received</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${tasks
          .map(
            (item) => `
          <tr>
            <td>${importanceBadge(item.importance)}</td>
            <td><strong>${escapeHtml(item.task)}</strong></td>
            <td>
              ${
                item.deadline
                  ? `<span class="badge badge-high">${escapeHtml(item.deadline)}</span>`
                  : `<span class="muted-text">None stated</span>`
              }
            </td>
            <td>
              ${
                item.replyNeeded
                  ? `<span class="badge badge-forest">Reply Needed</span>`
                  : `<span class="muted-text">No reply required</span>`
              }
            </td>
            <td>
              <div><strong>${escapeHtml(item.subject)}</strong></div>
              <div class="muted-text">${escapeHtml(senderDisplayName(item.sender))}</div>
            </td>
            <td class="mono">${escapeHtml(formatShortTime(item.receivedAt))}</td>
            <td>
              <div style="display:flex;gap:6px">
                <button class="btn btn-secondary btn-sm" type="button" data-inspect-id="${escapeHtml(item.gmailId)}">Inspect</button>
                ${item.gmailLink ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(item.gmailLink)}" target="_blank" rel="noreferrer">Gmail ↗</a>` : ""}
              </div>
            </td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

/* ==========================================================================
   VIEW 5: Daily Reports
   ========================================================================== */

function renderReportsView() {
  const runs = state.status?.runs || [];
  const q = (state.reportsSearch || state.globalSearch || "").trim().toLowerCase();

  const filtered = q
    ? runs.filter((r) => `${r.periodLabel} ${r.status} ${r.trigger} ${r.stage}`.toLowerCase().includes(q))
    : runs;

  const tbody = el("reports-table-body");
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:32px;color:var(--ink-muted)">
          No historical reports match your filter. Use the controls above to generate a report.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((run) => {
      const hasDocx = Boolean(run.docxPath);
      const hasDrive = Boolean(run.driveUrl);
      return `
        <tr>
          <td class="mono"><strong>📁 ${escapeHtml(run.periodLabel)}</strong></td>
          <td><span class="badge badge-neutral">${escapeHtml(run.trigger)}</span></td>
          <td>
            ${statusBadge(run.status)}
            <div class="muted-text" style="margin-top:3px">Stage: ${escapeHtml(run.stage)}</div>
            ${run.errorSummary ? `<div style="color:var(--critical);font-size:0.75rem;margin-top:4px">${escapeHtml(run.errorSummary)}</div>` : ""}
          </td>
          <td>
            <strong>${run.processedCount}</strong> included
            <div class="muted-text">${run.fetchedCount} fetched · ${run.skippedDuplicateCount} dupes</div>
          </td>
          <td>
            <span class="mono">${run.aiCount}</span> AI / <span class="mono">${run.fallbackCount}</span> fallback
          </td>
          <td class="mono">${escapeHtml(formatShortTime(run.completedAt || run.startedAt))}</td>
          <td class="mono">${escapeHtml(formatDuration(run.durationMs))}</td>
          <td>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${hasDocx ? `<a class="btn btn-secondary btn-sm" href="/api/runs/${run.id}/docx">Download .docx</a>` : ""}
              ${hasDrive ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(run.driveUrl)}" target="_blank" rel="noreferrer">Drive Folder ↗</a>` : ""}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

/* ==========================================================================
   VIEW 6: Automation Center
   ========================================================================== */

function renderAutomationView() {
  const status = state.status;
  if (!status) return;

  const cfg = status.config || {};
  const hh = String(cfg.reportHour ?? 7).padStart(2, "0");
  const mm = String(cfg.reportMinute ?? 0).padStart(2, "0");

  const schedBadge = el("auto-state-badge");
  if (schedBadge) {
    schedBadge.className = `badge ${cfg.scheduleEnabled ? "badge-forest" : "badge-neutral"}`;
    schedBadge.textContent = cfg.scheduleEnabled ? "Active" : "Disabled";
  }

  el("auto-schedule-time").textContent = `${hh}:${mm} ${cfg.reportTimezone || "UTC"}`;
  el("auto-catchup-label").textContent = `Catch-up mode: ${cfg.reportCatchup || "auto"} · 15-min wake check`;
  el("auto-next-run").textContent = status.nextScheduledRun
    ? formatDateTime(status.nextScheduledRun)
    : "Scheduling disabled";
  el("auto-last-run").textContent = status.lastSuccessfulRun
    ? `Last completed: ${status.lastSuccessfulRun.periodLabel} (${formatShortTime(status.lastSuccessfulRun.completedAt)})`
    : "Last completed: none yet";

  const googleOk = Boolean(status.google?.connected);
  const ollamaOk = Boolean(status.ollama?.reachable && status.ollama?.configuredModelInstalled);
  const driveOk = Boolean(status.google?.connected && status.driveConfigured);
  const readyCount = [googleOk, ollamaOk, driveOk].filter(Boolean).length;

  const readyBadge = el("auto-ready-badge");
  if (readyBadge) {
    readyBadge.className = `badge ${readyCount === 3 ? "badge-forest" : "badge-high"}`;
    readyBadge.textContent = readyCount === 3 ? "All Ready" : `${readyCount}/3 Ready`;
  }
  el("auto-ready-summary").textContent =
    readyCount === 3 ? "All 3 integrations online" : `${readyCount} of 3 integrations ready`;

  // Retry failed button
  const hasFailed = (status.runs || []).some((r) => r.status === "failed");
  const retryBtn = el("auto-retry-btn");
  if (retryBtn) {
    retryBtn.disabled = !hasFailed || Boolean(status.running);
  }

  // Hydrate automation form once
  const form = el("automation-form");
  if (form && !state.formHydrated) {
    form.elements.SCHEDULE_ENABLED.checked = Boolean(cfg.scheduleEnabled);
    form.elements.REPORT_HOUR.value = cfg.reportHour ?? 7;
    form.elements.REPORT_MINUTE.value = cfg.reportMinute ?? 0;
    form.elements.REPORT_TIMEZONE.value = cfg.reportTimezone ?? "Asia/Kolkata";
    form.elements.REPORT_CATCHUP.value = cfg.reportCatchup ?? "auto";
    state.formHydrated = true;
  }

  // Readiness checklist
  const readinessEl = el("auto-readiness-list");
  if (readinessEl) {
    readinessEl.innerHTML = `
      <div class="stack-item">
        <div class="stack-item-main">
          <div class="stack-item-title">
            <span class="status-dot ${googleOk ? "ok" : "err"}"></span>
            <span>Gmail OAuth 2.0 (Read-Only Primary Inbox)</span>
          </div>
          <div class="stack-item-desc">
            ${googleOk ? `Connected as ${escapeHtml(status.google.emailAddress || "authorized user")}. Refresh token persisted.` : "Not connected. Authorize Gmail to enable scheduled synchronization."}
          </div>
        </div>
      </div>
      <div class="stack-item">
        <div class="stack-item-main">
          <div class="stack-item-title">
            <span class="status-dot ${ollamaOk ? "ok" : "warn"}"></span>
            <span>Local Ollama &amp; Gemma Model (${escapeHtml(cfg.ollamaModel || "gemma3:4b")})</span>
          </div>
          <div class="stack-item-desc">
            ${
              ollamaOk
                ? `Reachable at ${escapeHtml(cfg.ollamaBaseUrl)} with model installed.`
                : `Ollama status: ${escapeHtml(status.ollama?.error || "Model not installed; rule-based fallback will be used.")}`
            }
          </div>
        </div>
      </div>
      <div class="stack-item">
        <div class="stack-item-main">
          <div class="stack-item-title">
            <span class="status-dot ${driveOk ? "ok" : "warn"}"></span>
            <span>Google Drive Date-Wise Folder Upload</span>
          </div>
          <div class="stack-item-desc">
            ${driveOk ? "Configured and active. Daily .docx reports upload automatically into YYYY-MM-DD folders." : "Awaiting Gmail OAuth connection."}
          </div>
        </div>
      </div>
    `;
  }
}

/* ==========================================================================
   VIEW 7: Activity Logs
   ========================================================================== */

function renderLogsView() {
  let logs = state.logs || [];
  if (state.logsFilter.level) {
    logs = logs.filter((l) => l.level === state.logsFilter.level);
  }
  const q = (state.logsFilter.search || state.globalSearch || "").trim().toLowerCase();
  if (q) {
    logs = logs.filter((l) => `${l.message} ${l.level} ${l.runId || ""}`.toLowerCase().includes(q));
  }

  const tbody = el("logs-table-body");
  if (logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center;padding:28px;color:var(--ink-muted)">
          No activity logs match the current filter.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = logs
    .map((log) => {
      const badgeCls =
        log.level === "error"
          ? "badge-critical"
          : log.level === "warn"
            ? "badge-high"
            : "badge-neutral";
      return `
        <tr>
          <td class="mono">${escapeHtml(formatDateTime(log.createdAt))}</td>
          <td><span class="badge ${badgeCls}">${escapeHtml(log.level.toUpperCase())}</span></td>
          <td class="mono">${log.runId ? `Run #${escapeHtml(log.runId)}` : "System"}</td>
          <td>${escapeHtml(log.message)}</td>
        </tr>
      `;
    })
    .join("");
}

/* ==========================================================================
   VIEW 8: Settings (Zero Exposed Secrets)
   ========================================================================== */

function renderSettingsView() {
  const status = state.status;
  if (!status) return;

  const googleOk = Boolean(status.google?.connected);
  const ollamaOk = Boolean(status.ollama?.reachable && status.ollama?.configuredModelInstalled);
  const cfg = status.config || {};

  const gBadge = el("settings-google-badge");
  if (gBadge) {
    gBadge.className = `badge ${googleOk ? "badge-forest" : "badge-critical"}`;
    gBadge.textContent = googleOk ? "Connected" : "Disconnected";
  }

  el("settings-google-kv").innerHTML = `
    <div><dt>Connection State</dt><dd>${googleOk ? "Authorized &amp; Active" : "Not Connected"}</dd></div>
    <div><dt>Connected Gmail Account</dt><dd>${escapeHtml(status.google?.emailAddress || "None")}</dd></div>
    <div><dt>OAuth Credentials</dt><dd>Loaded securely from server environment (hidden)</dd></div>
    <div><dt>Gmail Permission Scope</dt><dd>Read-Only (<code>gmail.readonly</code>)</dd></div>
    <div><dt>Token Persistence</dt><dd>Encrypted local token store (auto-refresh enabled)</dd></div>
  `;

  const oBadge = el("settings-ollama-badge");
  if (oBadge) {
    oBadge.className = `badge ${ollamaOk ? "badge-forest" : "badge-high"}`;
    oBadge.textContent = ollamaOk ? "Online" : "Degraded";
  }

  el("settings-ollama-kv").innerHTML = `
    <div><dt>Inference Endpoint</dt><dd>${escapeHtml(cfg.ollamaBaseUrl || "http://127.0.0.1:11434")}</dd></div>
    <div><dt>Configured Model</dt><dd>${escapeHtml(cfg.ollamaModel || "gemma3:4b")}</dd></div>
    <div><dt>Model Installed</dt><dd>${status.ollama?.configuredModelInstalled ? "Yes (Verified)" : "No"}</dd></div>
    <div><dt>Installed Local Models</dt><dd>${escapeHtml((status.ollama?.models || []).join(", ") || "None detected")}</dd></div>
    <div><dt>Cloud / Paid API Usage</dt><dd>Strictly Disabled (100% Local Inference)</dd></div>
  `;

  const dBadge = el("settings-drive-badge");
  if (dBadge) {
    dBadge.className = `badge ${status.driveConfigured ? "badge-forest" : "badge-neutral"}`;
    dBadge.textContent = status.driveConfigured ? "Configured" : "Default Root";
  }

  el("settings-storage-kv").innerHTML = `
    <div><dt>Google Drive Target Folder</dt><dd>${status.driveConfigured ? "Configured via server environment (ID hidden)" : "Drive root"}</dd></div>
    <div><dt>Drive Folder Hierarchy</dt><dd>Date-wise subfolders (<code>YYYY-MM-DD / MailMind_Report_YYYY-MM-DD.docx</code>)</dd></div>
    <div><dt>Local Report Archive</dt><dd><code>reports/YYYY/MM/MailMind_Report_YYYY-MM-DD.docx</code></dd></div>
    <div><dt>Database Engine</dt><dd>Local SQLite (<code>node:sqlite</code> with WAL mode &amp; run locking)</dd></div>
  `;
}

/* ==========================================================================
   Master Render & Polling
   ========================================================================== */

function renderActiveView() {
  renderShellStatus();
  switch (state.activeView) {
    case "overview":
      renderOverviewView();
      break;
    case "inbox":
      renderInboxView();
      break;
    case "categories":
      renderCategoriesView();
      break;
    case "actions":
      renderActionsView();
      break;
    case "reports":
      renderReportsView();
      break;
    case "automation":
      renderAutomationView();
      break;
    case "logs":
      renderLogsView();
      break;
    case "settings":
      renderSettingsView();
      break;
  }
}

async function refreshAllData() {
  try {
    const [status, messagesData, logsData] = await Promise.all([
      apiJson("/api/status"),
      apiJson("/api/messages?limit=500"),
      apiJson("/api/logs?limit=120"),
    ]);
    state.status = status;
    state.messages = messagesData.messages || [];
    state.logs = logsData.logs || [];
    state.isLoading = false;

    updatePeriodSelector();
    renderActiveView();
  } catch (error) {
    showToast(error.message || "Unable to reach local MailMind server.", true);
  }
}

async function triggerRun(payload = {}) {
  try {
    await apiJson("/api/runs/now", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showToast("Report job started. Analyzing Primary Inbox emails with Gemma…");
    await refreshAllData();
  } catch (error) {
    showToast(error.message, true);
  }
}

/* ==========================================================================
   Event Listeners Initialization
   ========================================================================== */

function initEvents() {
  // Sidebar view navigation
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchView(btn.getAttribute("data-view"));
    });
  });

  // Quick goto buttons inside panels
  document.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchView(btn.getAttribute("data-goto"));
    });
  });

  // Sidebar collapse
  el("sidebar-collapse")?.addEventListener("click", () => {
    el("app-layout")?.classList.toggle("sidebar-collapsed");
  });

  // Mobile menu button
  el("mobile-menu-btn")?.addEventListener("click", () => {
    el("sidebar")?.classList.toggle("mobile-open");
  });

  // Global search
  el("global-search")?.addEventListener("input", (e) => {
    state.globalSearch = e.target.value || "";
    state.inbox.page = 1;
    renderActiveView();
  });

  // Period selector
  el("period-selector")?.addEventListener("change", (e) => {
    state.selectedPeriod = e.target.value || "";
    state.inbox.page = 1;
    renderActiveView();
  });

  // Topbar Run Report Now
  el("top-run-now")?.addEventListener("click", () => triggerRun({}));

  // Overview 3-email test button
  el("ov-run-test")?.addEventListener("click", () => triggerRun({ maxMessages: 3, trigger: "test" }));

  // Delegated click for inspecting an email from any list/table
  document.body.addEventListener("click", (e) => {
    const inspectTarget = e.target.closest("[data-inspect-id]");
    if (inspectTarget) {
      const gmailId = inspectTarget.getAttribute("data-inspect-id");
      inspectEmailInInbox(gmailId);
      return;
    }

    const emailRow = e.target.closest("[data-email-id]");
    if (emailRow) {
      state.inbox.selectedGmailId = emailRow.getAttribute("data-email-id");
      renderInboxView();
      return;
    }

    const catCard = e.target.closest("[data-cat-type]");
    if (catCard) {
      state.categories.selectedType = catCard.getAttribute("data-cat-type");
      state.categories.selectedId = catCard.getAttribute("data-cat-id");
      renderCategoriesView();
    }
  });

  // Inbox filters
  el("inbox-filter-category")?.addEventListener("change", (e) => {
    state.inbox.category = e.target.value;
    state.inbox.page = 1;
    renderInboxView();
  });

  el("inbox-filter-importance")?.addEventListener("change", (e) => {
    state.inbox.importance = e.target.value;
    state.inbox.page = 1;
    renderInboxView();
  });

  el("inbox-filter-action")?.addEventListener("change", (e) => {
    state.inbox.action = e.target.value;
    state.inbox.page = 1;
    renderInboxView();
  });

  el("inbox-sort")?.addEventListener("change", (e) => {
    state.inbox.sort = e.target.value;
    state.inbox.page = 1;
    renderInboxView();
  });

  el("inbox-reset-filters")?.addEventListener("click", () => {
    state.inbox.category = "";
    state.inbox.importance = "";
    state.inbox.action = "";
    state.inbox.sort = "date-desc";
    state.inbox.page = 1;
    state.globalSearch = "";
    if (el("global-search")) el("global-search").value = "";
    if (el("inbox-filter-category")) el("inbox-filter-category").value = "";
    if (el("inbox-filter-importance")) el("inbox-filter-importance").value = "";
    if (el("inbox-filter-action")) el("inbox-filter-action").value = "";
    if (el("inbox-sort")) el("inbox-sort").value = "date-desc";
    renderInboxView();
  });

  el("inbox-prev")?.addEventListener("click", () => {
    if (state.inbox.page > 1) {
      state.inbox.page -= 1;
      renderInboxView();
    }
  });

  el("inbox-next")?.addEventListener("click", () => {
    state.inbox.page += 1;
    renderInboxView();
  });

  // Categories -> Open in Inbox Intelligence button
  el("category-open-inbox")?.addEventListener("click", () => {
    if (state.categories.selectedType === "core") {
      state.inbox.category = state.categories.selectedId;
      if (el("inbox-filter-category")) el("inbox-filter-category").value = state.categories.selectedId;
    } else {
      state.inbox.category = "";
      if (el("inbox-filter-category")) el("inbox-filter-category").value = "";
    }
    switchView("inbox");
  });

  // Action Items filter
  el("actions-filter")?.addEventListener("change", (e) => {
    state.actionsFilter = e.target.value;
    renderActionsView();
  });

  // Reports range form & buttons
  el("reports-range-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const from = String(fd.get("from") || "");
    const to = String(fd.get("to") || "");
    if (!from || !to) return;
    await triggerRun({ from, to });
  });

  el("reports-run-yesterday")?.addEventListener("click", () => triggerRun({}));
  el("reports-run-test")?.addEventListener("click", () => triggerRun({ maxMessages: 3, trigger: "test" }));
  el("reports-search")?.addEventListener("input", (e) => {
    state.reportsSearch = e.target.value || "";
    renderReportsView();
  });

  // Automation form & buttons
  el("automation-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const payload = {
      SCHEDULE_ENABLED: form.elements.SCHEDULE_ENABLED.checked ? "true" : "false",
      REPORT_HOUR: String(form.elements.REPORT_HOUR.value),
      REPORT_MINUTE: String(form.elements.REPORT_MINUTE.value),
      REPORT_TIMEZONE: String(form.elements.REPORT_TIMEZONE.value).trim(),
      REPORT_CATCHUP: String(form.elements.REPORT_CATCHUP.value),
    };
    try {
      await apiJson("/api/settings", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.formHydrated = false;
      showToast("Automation schedule saved and rescheduled.");
      await refreshAllData();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  el("auto-run-now")?.addEventListener("click", () => triggerRun({}));

  el("auto-retry-btn")?.addEventListener("click", async () => {
    try {
      await apiJson("/api/runs/retry", { method: "POST", body: "{}" });
      showToast("Retrying latest failed report run…");
      await refreshAllData();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  // Logs filters
  el("logs-level-filter")?.addEventListener("change", (e) => {
    state.logsFilter.level = e.target.value || "";
    renderLogsView();
  });

  el("logs-search")?.addEventListener("input", (e) => {
    state.logsFilter.search = e.target.value || "";
    renderLogsView();
  });

  el("logs-refresh-btn")?.addEventListener("click", () => refreshAllData());

  // Check URL query notifications (?google=connected or ?error=...)
  const params = new URLSearchParams(window.location.search);
  if (params.get("google") === "connected") {
    showToast("Gmail account connected. Daily automation is active.");
    window.history.replaceState({}, "", "/");
  } else if (params.get("error")) {
    showToast(params.get("error"), true);
    window.history.replaceState({}, "", "/");
  }
}

initEvents();
refreshAllData();
setInterval(refreshAllData, 5000);
