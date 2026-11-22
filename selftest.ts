// @ts-nocheck
// tools/selftest/work-selftest.ts
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

// supabase/functions/ops-hub/env.ts
function readEnv(get) {
  const supabaseUrl = (get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  let serviceKey = get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey) {
    const raw = get("SUPABASE_SECRET_KEYS");
    if (raw) {
      try {
        const keys = JSON.parse(raw);
        serviceKey = keys.default ?? Object.values(keys)[0] ?? "";
      } catch {
        serviceKey = "";
      }
    }
  }
  const appEnv = (get("APP_ENV") ?? "pilot").toLowerCase() === "demo" ? "demo" : "pilot";
  return {
    supabaseUrl,
    serviceKey,
    telegramToken: get("TELEGRAM_BOT_TOKEN")?.trim() || null,
    telegramApiBase: (get("TELEGRAM_API_BASE") ?? "https://api.telegram.org").replace(/\/$/, ""),
    webhookSecretOverride: get("TELEGRAM_WEBHOOK_SECRET")?.trim() || null,
    appEnv,
    functionsBase: (get("FUNCTIONS_BASE_URL") ?? `${supabaseUrl}/functions/v1`).replace(/\/$/, ""),
    larkApiBase: get("LARK_API_BASE")?.trim().replace(/\/$/, "") || null
  };
}

// src/domain/time.ts
var WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
var formatters = /* @__PURE__ */ new Map();
function formatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short"
    });
    formatters.set(timeZone, f);
  }
  return f;
}
function toMs(t) {
  const ms = t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t);
  if (!Number.isFinite(ms)) throw new Error(`Invalid date: ${String(t)}`);
  return ms;
}
function toLocalParts(t, timeZone) {
  const parts = formatter(timeZone).formatToParts(new Date(toMs(t)));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS[get("weekday")] ?? 0
  };
}
function offsetMinutes(t, timeZone) {
  const whole = Math.floor(t / 1e3) * 1e3;
  const p = toLocalParts(whole, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - whole) / 6e4);
}
function localToMs(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMinutes(guess, timeZone) * 6e4;
  const second = offsetMinutes(first, timeZone);
  return guess - second * 6e4;
}
function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}
function localDateKey(t, timeZone) {
  const p = toLocalParts(t, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}
function addDays(year, month, day, days) {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
function isoWeekday(year, month, day) {
  const w = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return w === 0 ? 7 : w;
}
function dateKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// src/domain/calendar.ts
var DEFAULT_CALENDAR = {
  timeZone: "Asia/Ho_Chi_Minh",
  workDays: [1, 2, 3, 4, 5],
  blocks: [
    { start: "08:00", end: "12:00" },
    { start: "13:30", end: "17:30" }
  ],
  holidays: []
};

// src/domain/lark.ts
function normalizeCode(raw) {
  return String(raw ?? "").normalize("NFC").trim().toUpperCase().replace(/\s*[‐-―−]\s*/g, "-").replace(/\s*-\s*/g, "-");
}
function fmtDueDate(dueDate) {
  const [y, m, d] = dueDate.split("-");
  return `${d}/${m}/${y}`;
}
function toLarkCard(m) {
  const template = { orange: "orange", red: "red", green: "green", blue: "blue", grey: "grey" }[m.tone];
  const body = m.lines.map((l) => {
    const value = l.mentionOpenId ? `<at id=${l.mentionOpenId}></at>` : l.text;
    return `${l.icon} ${l.label ? `**${l.label}:** ` : ""}${value}`;
  }).join("\n");
  const elements = [{ tag: "div", text: { tag: "lark_md", content: body } }];
  if (m.buttons?.length) {
    elements.push({
      tag: "action",
      actions: m.buttons.map((b) => ({ tag: "button", text: { tag: "plain_text", content: b.text }, type: b.type, value: b.value }))
    });
  }
  if (m.note || m.badge) {
    elements.push({ tag: "note", elements: [{ tag: "plain_text", content: [m.note, m.badge ? `[${m.badge}]` : ""].filter(Boolean).join("  ") }] });
  }
  return { config: { wide_screen_mode: true, update_multi: true }, header: { template, title: { tag: "plain_text", content: m.title } }, elements };
}
var LARK_HELP_TEXT = [
  "T\u1EA1o task m\u1EB9:",
  "/taomoi me <m\xE3> | <t\xEAn task m\u1EB9> | @ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch | <deadline>",
  "VD: /taomoi me DA056 | [STING] Qu\u1EA3n l\xFD 1600 KOC video Freecast | @Tr\xE2m | 30/11/2026",
  "",
  "T\u1EA1o task con:",
  "/taomoi con <m\xE3> | <t\xEAn task con> | @ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n | <deadline> | <m\xF4 t\u1EA3 (kh\xF4ng b\u1EAFt bu\u1ED9c)>",
  "VD: /taomoi con DA056-04-S44 | [STING] Push 50 KOC g\u1EEDi \u0111\u1EE7 s\u1ED1 l\u01B0\u1EE3ng video | @Tr\xE2m | 20/11/2026",
  "",
  'Bot ki\u1EC3m tra m\xE3, hi\u1EC7n b\u1EA3n xem tr\u01B0\u1EDBc; b\u1EA5m "X\xE1c nh\u1EADn t\u1EA1o" (ho\u1EB7c tr\u1EA3 l\u1EDDi "x\xE1c nh\u1EADn") \u0111\u1EC3 t\u1EA1o tr\xEAn Lark Tasks.'
].join("\n");

// src/domain/cases.ts
var TZ = DEFAULT_CALENDAR.timeZone;

// src/domain/projects.ts
var PROJECT_CODE_RE = /^[A-Z]{2,4}\d{1,4}$/;
var PROJECT_CODE_EXAMPLE = "MT35";
function normalizeProjectCode(raw) {
  return normalizeCode(raw).replace(/\s+/g, "");
}
function checkProjectCode(raw, existing = []) {
  const code = normalizeProjectCode(raw);
  if (!code) return ["Thi\u1EBFu m\xE3 d\u1EF1 \xE1n."];
  if (!PROJECT_CODE_RE.test(code)) return [`M\xE3 d\u1EF1 \xE1n "${code}" ch\u01B0a \u0111\xFAng: 2\u20134 ch\u1EEF in hoa r\u1ED3i 1\u20134 ch\u1EEF s\u1ED1, v\xED d\u1EE5 ${PROJECT_CODE_EXAMPLE}.`];
  for (const e of existing) if (normalizeProjectCode(e) === code) return [`M\xE3 ${code} \u0111\xE3 c\xF3 d\u1EF1 \xE1n kh\xE1c d\xF9ng.`];
  return [];
}
function taskCode(projectCode, seq) {
  return `${normalizeProjectCode(projectCode)}-${String(seq).padStart(2, "0")}`;
}
function projectTitle(code, name) {
  return `[${code}] ${name.trim()}`;
}
function taskTitle(code, name) {
  return `${name.trim()} (${code})`;
}
function chatMatchesCode(chatName, code) {
  const c = normalizeProjectCode(code);
  if (!c) return false;
  return new RegExp(`(^|[^A-Z0-9])${c}([^A-Z0-9]|$)`).test(normalizeCode(chatName));
}
function shiftKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const r = addDays(y, m, d, days);
  return dateKey(r.year, r.month, r.day);
}
function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5);
}
function isWorkDay(key, cal) {
  const [y, m, d] = key.split("-").map(Number);
  return cal.workDays.includes(isoWeekday(y, m, d)) && !cal.holidays.includes(key);
}
function nextWorkDay(key, cal) {
  let k = key;
  for (let i = 0; i < 30 && !isWorkDay(k, cal); i++) k = shiftKey(k, 1);
  return k;
}
function workDaysAfter(from, to, cal) {
  let n = 0;
  for (let k = shiftKey(from, 1), i = 0; k <= to && i < 400; k = shiftKey(k, 1), i++) if (isWorkDay(k, cal)) n++;
  return n;
}
function localHM(now, timeZone) {
  const p = toLocalParts(now, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}
var TIER_RULES = {
  short: { checkins: [], before: [0] },
  medium: { checkins: [50], before: [1, 0] },
  long: { checkins: [50, 75], before: [2, 1, 0] }
};
var CHANGES_BEFORE = [1, 0];
function autoTier(startDate, dueDate) {
  const d = daysBetween(startDate, dueDate);
  return d <= 3 ? "short" : d <= 7 ? "medium" : "long";
}
function tierOf(t) {
  return t.tier ?? autoTier(t.startDate, t.dueDate);
}
function checkinDates(startDate, dueDate, tier, cal) {
  const span = daysBetween(startDate, dueDate);
  const out = [];
  for (const pct of TIER_RULES[tier].checkins) {
    const date = nextWorkDay(shiftKey(startDate, Math.round(span * pct / 100)), cal);
    if (date >= dueDate || date <= startDate) continue;
    if (out.some((o) => o.date === date)) continue;
    out.push({ pct, date });
  }
  return out;
}
function reminderToday(t, today) {
  if (t.state !== "doing" && t.state !== "changes") return null;
  const before = t.state === "changes" ? CHANGES_BEFORE : TIER_RULES[tierOf(t)].before;
  const offset = daysBetween(today, t.dueDate);
  if (offset < 0) return { kind: "overdue", offset, label: `D+${-offset}` };
  if (!before.includes(offset)) return null;
  return offset === 0 ? { kind: "due", offset, label: "D0" } : { kind: "before", offset, label: `D-${offset}` };
}
function checkinToSend(t, sentPcts, today, cal) {
  if (t.state !== "doing" || today >= t.dueDate) return null;
  if (!isWorkDay(today, cal)) return null;
  const sent = new Set(sentPcts);
  const due = checkinDates(t.startDate, t.dueDate, tierOf(t), cal).filter((c) => c.date <= today && !sent.has(c.pct));
  return due.length ? due[due.length - 1] : null;
}
function isNoUpdate(sentDate, today, nowHM, cal) {
  const limit = nextWorkDay(shiftKey(sentDate, 1), cal);
  return today > limit || today === limit && nowHM >= "09:00";
}
function reviewIsLate(reviewSinceDate, today, cal) {
  return workDaysAfter(reviewSinceDate, today, cal) > 1;
}
var TASK_STAGE_LABEL = {
  doing: "\u0110ang l\xE0m",
  review: "Ch\u1EDD duy\u1EC7t",
  changes: "C\u1EA7n s\u1EEDa",
  done: "Ho\xE0n th\xE0nh",
  cancelled: "\u0110\xE3 hu\u1EF7"
};
function whyNot(action, state, who2) {
  const pm = who2.role === "pm" && who2.isProjectPm;
  switch (action) {
    case "submit":
    case "progress":
      if (!who2.isAssignee) return "Ch\u1EC9 ng\u01B0\u1EDDi \u0111\u01B0\u1EE3c giao task m\u1EDBi l\xE0m \u0111\u01B0\u1EE3c.";
      if (state !== "doing" && state !== "changes") return `Task \u0111ang \u1EDF tr\u1EA1ng th\xE1i ${TASK_STAGE_LABEL[state]}.`;
      return null;
    case "approve":
    case "request_changes":
      if (!pm) return "Ch\u1EC9 PM ph\u1EE5 tr\xE1ch d\u1EF1 \xE1n m\u1EDBi duy\u1EC7t \u0111\u01B0\u1EE3c.";
      if (state !== "review") return "Task ch\u01B0a \u0111\u01B0\u1EE3c n\u1ED9p \u0111\u1EC3 duy\u1EC7t.";
      return null;
    case "extend":
      if (!pm) return "Ch\u1EC9 PM ph\u1EE5 tr\xE1ch d\u1EF1 \xE1n m\u1EDBi gia h\u1EA1n \u0111\u01B0\u1EE3c.";
      if (state === "done" || state === "cancelled") return `Task \u0111\xE3 ${TASK_STAGE_LABEL[state].toLowerCase()}.`;
      return null;
    case "cancel":
      if (!pm) return "Ch\u1EC9 PM ph\u1EE5 tr\xE1ch d\u1EF1 \xE1n m\u1EDBi hu\u1EF7 \u0111\u01B0\u1EE3c.";
      if (state === "done" || state === "cancelled") return `Task \u0111\xE3 ${TASK_STAGE_LABEL[state].toLowerCase()}.`;
      return null;
    case "reopen":
      if (!pm) return "Ch\u1EC9 PM ph\u1EE5 tr\xE1ch d\u1EF1 \xE1n m\u1EDBi m\u1EDF l\u1EA1i \u0111\u01B0\u1EE3c.";
      if (state !== "done") return "Ch\u1EC9 m\u1EDF l\u1EA1i \u0111\u01B0\u1EE3c task \u0111\xE3 ho\xE0n th\xE0nh.";
      return null;
  }
}
function cleanLinks(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/\s+/);
  return [...new Set(list.map((s) => String(s).trim()).filter((s) => /^https?:\/\/\S+$/i.test(s)))].slice(0, 20);
}
function evidenceErrors(e) {
  return e.links.length || e.files.length ? [] : ["Th\xEAm \xEDt nh\u1EA5t 1 link ho\u1EB7c 1 file l\xE0m b\u1EB1ng ch\u1EE9ng."];
}
var MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;
var EXTEND_REASON_LABEL = {
  scope: "Do y\xEAu c\u1EA7u thay \u0111\u1ED5i",
  quality: "Do k\u1EBFt qu\u1EA3 ch\u01B0a \u0111\u1EA1t"
};
function applyExtension(t, newDue, reason) {
  return { dueDate: newDue, kpiDueDate: reason === "scope" ? newDue : t.kpiDueDate };
}
function extensionErrors(t, newDue, reason, projectDue, today) {
  const out = [];
  if (!newDue) out.push("Ch\u1ECDn deadline m\u1EDBi.");
  else {
    if (newDue === t.dueDate) out.push("Deadline m\u1EDBi tr\xF9ng deadline hi\u1EC7n t\u1EA1i.");
    if (newDue < today) out.push("Deadline m\u1EDBi \u0111\xE3 qua.");
    if (newDue > projectDue) out.push(`Deadline m\u1EDBi sau deadline d\u1EF1 \xE1n (${fmtDueDate(projectDue)}). Gia h\u1EA1n d\u1EF1 \xE1n tr\u01B0\u1EDBc.`);
  }
  if (reason !== "scope" && reason !== "quality") out.push("Ch\u1ECDn l\xFD do gia h\u1EA1n.");
  return out;
}
function taskHealth(t, today) {
  if (t.state === "cancelled") return { health: "cancelled", reason: "\u0110\xE3 hu\u1EF7" };
  if (t.state === "done") return { health: "done", reason: "\u0110\xE3 duy\u1EC7t" };
  if (t.state === "review") return t.hasEvidence ? { health: "blue", reason: "Ch\u1EDD PM duy\u1EC7t" } : { health: "amber", reason: "\u0110\xE3 \u0111\xE1nh d\u1EA5u xong tr\xEAn Lark nh\u01B0ng ch\u01B0a c\xF3 b\u1EB1ng ch\u1EE9ng" };
  const left = daysBetween(today, t.dueDate);
  if (left < 0) return { health: "red", reason: `Qu\xE1 h\u1EA1n ${-left} ng\xE0y` };
  if (t.progress === "blocked") return { health: "red", reason: `B\u1ECB ch\u1EB7n${t.progressNote ? `: ${t.progressNote}` : ""}` };
  if (t.progress === "behind") return { health: "amber", reason: `B\xE1o ch\u1EADm${t.progressNote ? `: ${t.progressNote}` : ""}` };
  if (t.noUpdate) return { health: "amber", reason: "Ch\u01B0a tr\u1EA3 l\u1EDDi c\xE2u h\u1ECFi ti\u1EBFn \u0111\u1ED9" };
  if (t.state === "changes" && left <= 1) return { health: "amber", reason: "C\u1EA7n s\u1EEDa v\xE0 s\u1EAFp \u0111\u1EBFn h\u1EA1n" };
  if (t.state === "changes") return { health: "green", reason: "\u0110ang s\u1EEDa theo g\xF3p \xFD" };
  return { health: "green", reason: t.progress === "on_plan" ? "B\xE1o \u0111\xFAng ti\u1EBFn \u0111\u1ED9" : "\u0110ang l\xE0m" };
}
var PROJECT_STATUS_LABEL = {
  cancelled: "\u0110\xE3 hu\u1EF7",
  done: "Ho\xE0n th\xE0nh",
  late: "Tr\u1EC5",
  red: "C\u1EA7n can thi\u1EC7p",
  risk: "C\xF3 nguy c\u01A1",
  ok: "\u0110\xFAng ti\u1EBFn \u0111\u1ED9"
};
var PROJECT_STATUS_RANK = { late: 0, red: 1, risk: 2, ok: 3, done: 4, cancelled: 5 };
var RISK_GAP_POINTS = 25;
function projectRollup(p, tasks, today) {
  const live = tasks.filter((t) => t.state !== "cancelled");
  const count = (h) => live.filter((t) => t.health === h).length;
  const done = live.filter((t) => t.state === "done").length;
  const total = live.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const span = Math.max(1, daysBetween(p.startDate, p.dueDate));
  const timePct = Math.max(0, Math.min(100, Math.round(daysBetween(p.startDate, today) / span * 100)));
  const base = { total, done, review: count("blue"), green: count("green"), amber: count("amber"), red: count("red"), pct, timePct };
  if (p.state === "cancelled") return { ...base, status: "cancelled", reason: "PM \u0111\xE3 hu\u1EF7 d\u1EF1 \xE1n" };
  if (total > 0 && done === total) return { ...base, status: "done", reason: "M\u1ECDi task \u0111\xE3 \u0111\u01B0\u1EE3c duy\u1EC7t" };
  if (today > p.dueDate) return { ...base, status: "late", reason: `\u0110\xE3 qua deadline d\u1EF1 \xE1n ${fmtDueDate(p.dueDate)}` };
  if (base.red) return { ...base, status: "red", reason: `${base.red} task c\u1EA7n can thi\u1EC7p` };
  if (base.amber) return { ...base, status: "risk", reason: `${base.amber} task c\xF3 nguy c\u01A1` };
  if (total && timePct - pct > RISK_GAP_POINTS) return { ...base, status: "risk", reason: `\u0110\xE3 \u0111i ${timePct}% th\u1EDDi gian, m\u1EDBi xong ${pct}% task` };
  return { ...base, status: "ok", reason: total ? "\u0110\xFAng ti\u1EBFn \u0111\u1ED9" : "Ch\u01B0a c\xF3 task" };
}
function kpiStatus(t, now, timeZone) {
  if (t.state === "cancelled") return "excluded";
  if (t.state === "done" && t.acceptedAt !== null) return localDateKey(t.acceptedAt, timeZone) <= t.kpiDueDate ? "on_time" : "late";
  if (t.state === "review" && t.pendingAt !== null && localDateKey(t.pendingAt, timeZone) <= t.kpiDueDate) return "pending";
  return t.kpiDueDate < localDateKey(now, timeZone) ? "overdue" : "open";
}
var pLine = (p) => ({ icon: "\u{1F4CC}", label: "D\u1EF1 \xE1n", text: projectTitle(p.code, p.name) });
var tLine = (t) => ({ icon: "\u{1F538}", label: "Task", text: taskTitle(t.code, t.name) });
var who = (t, label = "Ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n") => ({ icon: "\u{1F464}", label, text: t.assigneeName ?? "ch\u01B0a g\xE1n", mentionOpenId: t.assigneeOpenId });
var linkLine = (url, text = "M\u1EDF tr\xEAn Ops Hub") => url ? [{ icon: "\u{1F517}", text: `[${text}](${url})` }] : [];
function taskCreatedMessage(p, t, url) {
  return {
    tone: "blue",
    title: "\u{1F195} Task m\u1EDBi",
    lines: [pLine(p), tLine(t), who(t), { icon: "\u23F0", label: "Deadline", text: fmtDueDate(t.dueDate) }, ...t.expectedOutput ? [{ icon: "\u{1F3AF}", label: "K\u1EBFt qu\u1EA3 c\u1EA7n n\u1ED9p", text: t.expectedOutput }] : [], ...linkLine(url)],
    note: "Xong vi\u1EC7c th\xEC b\u1EA5m N\u1ED9p k\u1EBFt qu\u1EA3 tr\xEAn Ops Hub, k\xE8m link ho\u1EB7c file \u0111\u1EC3 PM duy\u1EC7t."
  };
}
function deadlineMessage(p, t, r, url) {
  const days = Math.abs(r.offset);
  const title = r.kind === "before" ? `\u{1F534} Task s\u1EAFp \u0111\u1EBFn h\u1EA1n \u2013 C\xF2n ${days} ng\xE0y!` : r.kind === "due" ? "\u{1F534} Task \u0111\u1EBFn h\u1EA1n h\xF4m nay!" : `\u{1F534} Task \u0111\xE3 qu\xE1 h\u1EA1n ${days} ng\xE0y \u2013 Ch\u01B0a n\u1ED9p!`;
  return {
    tone: r.kind === "before" ? "orange" : "red",
    title,
    lines: [pLine(p), tLine(t), who(t), { icon: "\u23F0", label: "H\u1EA1n ch\xF3t", text: fmtDueDate(t.dueDate) }, ...linkLine(url, "N\u1ED9p k\u1EBFt qu\u1EA3")],
    note: r.kind === "before" ? 'G\u1EB7p kh\xF3 kh\u0103n th\xEC b\xE1o "B\u1ECB ch\u1EB7n" \u0111\u1EC3 PM h\u1ED7 tr\u1EE3 s\u1EDBm.' : "Vui l\xF2ng n\u1ED9p k\u1EBFt qu\u1EA3 ngay ho\u1EB7c b\xE1o PM.",
    badge: r.label
  };
}
function checkinMessage(p, t, pct, taskId, url) {
  return {
    tone: "blue",
    title: `\u{1F4CD} Ti\u1EBFn \u0111\u1ED9 ${t.code} th\u1EBF n\xE0o?`,
    lines: [pLine(p), tLine(t), { icon: "\u23F0", label: "Deadline", text: fmtDueDate(t.dueDate) }, { icon: "\u23F3", text: `\u0110\xE3 \u0111i kho\u1EA3ng ${pct}% th\u1EDDi gian c\u1EE7a task.` }, ...linkLine(url, "Tr\u1EA3 l\u1EDDi ho\u1EB7c n\u1ED9p k\u1EBFt qu\u1EA3")],
    note: 'Ch\u1ECDn m\u1ED9t n\xFAt. Ch\u1ECDn "B\u1ECB ch\u1EB7n" th\xEC tr\u1EA3 l\u1EDDi k\xE8m l\xFD do tr\xEAn Ops Hub \u0111\u1EC3 PM h\u1ED7 tr\u1EE3.',
    buttons: [
      { text: "\u0110\xFAng ti\u1EBFn \u0111\u1ED9", type: "primary", value: { op: "progress", task: taskId, answer: "on_plan" } },
      { text: "Ch\u1EADm", type: "default", value: { op: "progress", task: taskId, answer: "behind" } },
      { text: "B\u1ECB ch\u1EB7n", type: "danger", value: { op: "progress", task: taskId, answer: "blocked" } }
    ]
  };
}
function blockedMessage(p, t, reason, url) {
  return { tone: "red", title: `\u26D4 ${t.code} b\u1ECB ch\u1EB7n`, lines: [pLine(p), tLine(t), who(t), { icon: "\u2757", label: "L\xFD do", text: reason || "ch\u01B0a ghi" }, ...linkLine(url)], note: "Nh\xE2n s\u1EF1 c\u1EA7n PM h\u1ED7 tr\u1EE3 \u0111\u1EC3 l\xE0m ti\u1EBFp." };
}
function submittedMessage(p, t, pm, url) {
  return {
    tone: "blue",
    title: `\u{1F4E5} ${t.code} \u0111\xE3 n\u1ED9p, ch\u1EDD duy\u1EC7t`,
    lines: [pLine(p), tLine(t), who(t), { icon: "\u{1F9D1}\u200D\u{1F4BC}", label: "PM duy\u1EC7t", text: pm.name, mentionOpenId: pm.openId }, ...linkLine(url, "Xem b\u1EB1ng ch\u1EE9ng v\xE0 duy\u1EC7t")]
  };
}
function missingEvidenceMessage(t, url) {
  return {
    tone: "orange",
    title: `\u{1F4CE} Th\xEAm b\u1EB1ng ch\u1EE9ng cho ${t.code}`,
    lines: [tLine(t), { icon: "\u2139\uFE0F", text: "B\u1EA1n \u0111\xE3 \u0111\xE1nh d\u1EA5u ho\xE0n th\xE0nh tr\xEAn Lark. PM c\u1EA7n link ho\u1EB7c file k\u1EBFt qu\u1EA3 \u0111\u1EC3 duy\u1EC7t." }, ...linkLine(url, "Th\xEAm b\u1EB1ng ch\u1EE9ng")]
  };
}
function approvedMessage(p, t) {
  return { tone: "green", title: `\u2705 ${t.code} ho\xE0n th\xE0nh`, lines: [pLine(p), tLine(t), who(t)], note: "PM \u0111\xE3 duy\u1EC7t k\u1EBFt qu\u1EA3. C\u1EA3m \u01A1n b\u1EA1n \u{1F389}" };
}
function changesGroupMessage(p, t, newDue) {
  return {
    tone: "orange",
    title: `\u270F\uFE0F ${t.code} c\u1EA7n ch\u1EC9nh s\u1EEDa`,
    lines: [pLine(p), tLine(t), who(t), { icon: "\u23F0", label: newDue ? "H\u1EA1n m\u1EDBi" : "H\u1EA1n", text: fmtDueDate(newDue ?? t.dueDate) }],
    note: "G\xF3p \xFD chi ti\u1EBFt \u0111\xE3 g\u1EEDi ri\xEAng cho ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n."
  };
}
function changesDmMessage(p, t, feedback, newDue, url) {
  return {
    tone: "orange",
    title: `\u270F\uFE0F PM g\xF3p \xFD cho ${t.code}`,
    lines: [pLine(p), tLine(t), { icon: "\u{1F4AC}", label: "G\xF3p \xFD", text: feedback }, { icon: "\u23F0", label: newDue ? "H\u1EA1n m\u1EDBi" : "H\u1EA1n", text: fmtDueDate(newDue ?? t.dueDate) }, ...linkLine(url, "S\u1EEDa v\xE0 n\u1ED9p l\u1EA1i")]
  };
}
function extendedMessage(p, t, oldDue, newDue, reason) {
  return {
    tone: "blue",
    title: `\u{1F4C5} ${t.code} \u0111\u01B0\u1EE3c gia h\u1EA1n`,
    lines: [pLine(p), tLine(t), who(t), { icon: "\u23F0", label: "Deadline", text: `${fmtDueDate(oldDue)} \u2192 ${fmtDueDate(newDue)}` }, { icon: "\u2139\uFE0F", label: "L\xFD do", text: EXTEND_REASON_LABEL[reason] }]
  };
}
function cancelledMessage(p, t, reason) {
  return { tone: "grey", title: `\u{1F5D1}\uFE0F ${t.code} \u0111\xE3 hu\u1EF7`, lines: [pLine(p), tLine(t), { icon: "\u2139\uFE0F", label: "L\xFD do", text: reason }] };
}
function reopenedMessage(p, t, reason) {
  return { tone: "orange", title: `\u21A9\uFE0F ${t.code} \u0111\u01B0\u1EE3c m\u1EDF l\u1EA1i`, lines: [pLine(p), tLine(t), who(t), { icon: "\u2139\uFE0F", label: "L\xFD do", text: reason }] };
}
function projectLinkedMessage(p) {
  return {
    tone: "blue",
    title: `\u{1F4CC} D\u1EF1 \xE1n ${p.code} \u0111\xE3 g\u1EAFn v\u1EDBi group n\xE0y`,
    lines: [pLine(p), { icon: "\u{1F9D1}\u200D\u{1F4BC}", label: "PM", text: p.pmName, mentionOpenId: p.pmOpenId }, { icon: "\u23F0", label: "Deadline d\u1EF1 \xE1n", text: fmtDueDate(p.dueDate) }],
    note: "Task, nh\u1EAFc h\u1EA1n v\xE0 k\u1EBFt qu\u1EA3 duy\u1EC7t c\u1EE7a d\u1EF1 \xE1n s\u1EBD \u0111\u01B0\u1EE3c b\xE1o trong group n\xE0y."
  };
}
function projectDoneMessage(p, total, onTime) {
  return { tone: "green", title: `\u{1F3C1} D\u1EF1 \xE1n ${p.code} ho\xE0n th\xE0nh`, lines: [pLine(p), { icon: "\u2705", text: `${total} task \u0111\xE3 \u0111\u01B0\u1EE3c duy\u1EC7t, ${onTime} task \u0111\xFAng h\u1EA1n.` }], note: "C\u1EA3m \u01A1n c\u1EA3 nh\xF3m!" };
}
function botMissingMessage(p, url) {
  return {
    tone: "orange",
    title: `\u{1F916} Bot ch\u01B0a c\xF3 trong group c\u1EE7a ${p.code}`,
    lines: [pLine(p), { icon: "\u2139\uFE0F", text: `Th\xEAm bot Go Media v\xE0o group Lark c\u1EE7a d\u1EF1 \xE1n (n\xEAn \u0111\u1EB7t t\xEAn group b\u1EAFt \u0111\u1EA7u b\u1EB1ng "${p.code}"), r\u1ED3i b\u1EA5m "Ki\u1EC3m tra l\u1EA1i" tr\xEAn trang d\u1EF1 \xE1n.` }, ...linkLine(url, "M\u1EDF d\u1EF1 \xE1n")],
    note: "Trong l\xFAc ch\u01B0a g\u1EAFn group, tin c\u1EE7a d\u1EF1 \xE1n \u0111\u01B0\u1EE3c g\u1EEDi ri\xEAng cho b\u1EA1n."
  };
}
function reviewNudgeMessage(items, url) {
  return {
    tone: "orange",
    title: `\u23F3 ${items.length} task ch\u1EDD b\u1EA1n duy\u1EC7t`,
    lines: [...items.slice(0, 10).map((i) => ({ icon: "\u{1F4E5}", text: `${taskTitle(i.code, i.name)} \xB7 ch\u1EDD ${i.days} ng\xE0y l\xE0m vi\u1EC7c` })), ...items.length > 10 ? [{ icon: "\u2026", text: `v\xE0 ${items.length - 10} task kh\xE1c` }] : [], ...linkLine(url, "M\u1EDF trang Ch\u1EDD duy\u1EC7t")]
  };
}
function summarizeProject(p, tasks, today, cal) {
  const open = tasks.filter((t) => t.state === "doing" || t.state === "changes");
  const tomorrow = nextWorkDay(shiftKey(today, 1), cal);
  const out = {
    code: p.code,
    name: p.name,
    status: p.status,
    reason: p.reason,
    overdue: open.filter((t) => t.dueDate < today),
    dueToday: open.filter((t) => t.dueDate === today),
    review: tasks.filter((t) => t.state === "review").map((t) => ({ ...t, waitDays: t.reviewSince ? workDaysAfter(t.reviewSince, today, cal) : 0 })).sort((a, b) => b.waitDays - a.waitDays),
    blocked: open.filter((t) => t.progress === "blocked"),
    behind: open.filter((t) => t.progress === "behind"),
    noUpdate: open.filter((t) => t.noUpdate && t.progress !== "blocked" && t.progress !== "behind"),
    dueTomorrow: open.filter((t) => t.dueDate > today && t.dueDate <= tomorrow),
    approvedToday: tasks.filter((t) => t.approvedOn === today).length,
    submittedToday: tasks.filter((t) => t.submittedOn === today).length,
    weight: 0
  };
  out.weight = out.overdue.length * 3 + out.blocked.length * 3 + out.review.length * 2 + out.dueToday.length * 2 + out.behind.length + out.noUpdate.length + (p.status === "late" ? 5 : 0);
  return out;
}
function sortSummary(list) {
  return [...list].sort((a, b) => PROJECT_STATUS_RANK[a.status] - PROJECT_STATUS_RANK[b.status] || b.weight - a.weight || a.code.localeCompare(b.code));
}
var codes = (xs) => xs.map((x) => x.code).join(", ");
function morningSummaryMessage(list, today, url) {
  const rows = sortSummary(list).filter((s) => s.status !== "done" && s.status !== "cancelled");
  const lines = [];
  for (const s of rows) {
    const bits = [
      s.overdue.length && `${s.overdue.length} qu\xE1 h\u1EA1n (${codes(s.overdue)})`,
      s.dueToday.length && `${s.dueToday.length} \u0111\u1EBFn h\u1EA1n h\xF4m nay`,
      s.review.length && `${s.review.length} ch\u1EDD duy\u1EC7t`,
      s.blocked.length && `${s.blocked.length} b\u1ECB ch\u1EB7n (${codes(s.blocked)})`,
      s.behind.length && `${s.behind.length} b\xE1o ch\u1EADm`,
      s.noUpdate.length && `${s.noUpdate.length} ch\u01B0a c\u1EADp nh\u1EADt`
    ].filter(Boolean);
    lines.push({ icon: s.status === "ok" ? "\u{1F7E2}" : s.status === "risk" ? "\u{1F7E1}" : "\u{1F534}", label: `${s.code} \xB7 ${PROJECT_STATUS_LABEL[s.status]}`, text: bits.length ? bits.join(" \xB7 ") : "kh\xF4ng c\xF3 vi\u1EC7c c\u1EA7n x\u1EED l\xFD" });
  }
  if (!lines.length) lines.push({ icon: "\u2705", text: "Kh\xF4ng c\xF3 d\u1EF1 \xE1n n\xE0o \u0111ang ch\u1EA1y." });
  return { tone: rows.some((s) => s.status === "late" || s.status === "red") ? "red" : "blue", title: `\u2600\uFE0F T\xF3m t\u1EAFt s\xE1ng ${fmtDueDate(today)}`, lines: [...lines, ...linkLine(url, "M\u1EDF T\xF3m t\u1EAFt h\xF4m nay")], note: "B\u1EA3n ch\u1EE5p l\xFAc g\u1EEDi. S\u1ED1 m\u1EDBi nh\u1EA5t lu\xF4n c\xF3 tr\xEAn trang T\xF3m t\u1EAFt h\xF4m nay." };
}
function eveningSummaryMessage(list, today, url) {
  const rows = sortSummary(list).filter((s) => s.status !== "cancelled");
  const sum = (f) => rows.reduce((n, s) => n + f(s), 0);
  const lines = [
    { icon: "\u2705", label: "H\xF4m nay", text: `${sum((s) => s.approvedToday)} task \u0111\u01B0\u1EE3c duy\u1EC7t \xB7 ${sum((s) => s.submittedToday)} task \u0111\u01B0\u1EE3c n\u1ED9p` },
    { icon: "\u{1F4E5}", label: "C\xF2n ch\u1EDD duy\u1EC7t", text: String(sum((s) => s.review.length)) }
  ];
  const dueTomorrow = rows.flatMap((s) => s.dueTomorrow);
  lines.push({ icon: "\u{1F4C5}", label: "\u0110\u1EBFn h\u1EA1n ng\xE0y l\xE0m vi\u1EC7c k\u1EBF ti\u1EBFp", text: dueTomorrow.length ? dueTomorrow.map((t) => taskTitle(t.code, t.name)).join("; ") : "kh\xF4ng c\xF3" });
  const slipping = rows.flatMap((s) => s.dueToday);
  if (slipping.length) lines.push({ icon: "\u26A0\uFE0F", label: "S\u1EBD qu\xE1 h\u1EA1n n\u1EBFu h\xF4m nay ch\u01B0a n\u1ED9p", text: slipping.map((t) => t.code).join(", ") });
  return { tone: slipping.length ? "orange" : "green", title: `\u{1F319} T\u1ED5ng k\u1EBFt ng\xE0y ${fmtDueDate(today)}`, lines: [...lines, ...linkLine(url, "M\u1EDF T\xF3m t\u1EAFt h\xF4m nay")] };
}
var PROJECT_HELP_TEXT = [
  "Ch\u1EC9 PM d\xF9ng \u0111\u01B0\u1EE3c c\xE1c l\u1EC7nh n\xE0y.",
  "",
  "T\u1EA1o d\u1EF1 \xE1n (g\xF5 trong group c\u1EE7a d\u1EF1 \xE1n th\xEC d\u1EF1 \xE1n t\u1EF1 g\u1EAFn v\xE0o group \u0111\xF3):",
  "/taomoi duan <m\xE3> | <t\xEAn d\u1EF1 \xE1n> | <deadline>",
  "VD: /taomoi duan MT35 | Ra m\u1EAFt BST T\u1EBFt | 30/01/2027",
  "",
  "T\u1EA1o task (m\xE3 task do bot t\u1EF1 sinh):",
  "/taomoi task <m\xE3 d\u1EF1 \xE1n> | <t\xEAn task> | @ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n | <deadline> | <k\u1EBFt qu\u1EA3 c\u1EA7n n\u1ED9p>",
  "VD: /taomoi task MT35 | Push 50 KOC g\u1EEDi video | @Tr\xE2m | 20/01/2027 | 50 video \u0111\xE3 \u0111\u0103ng + file link"
].join("\n");
var PROJECT_COLORS = ["#2F5BD3", "#D9822B", "#2E8B57", "#8A4FC7", "#C0392B", "#1C8C9E", "#B8860B", "#5D6D7E"];
function colorFor(index) {
  return PROJECT_COLORS[(index % PROJECT_COLORS.length + PROJECT_COLORS.length) % PROJECT_COLORS.length];
}

// supabase/functions/ops-hub/http.ts
var ApiError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
function must(res, what) {
  if (res.error) {
    const msg = res.error.message || "unknown";
    if (/conflict|already_answered|checkpoint_expired|task_closed|task_started|checkpoint_not_sent/.test(msg)) {
      throw new ApiError(409, msg.match(/conflict|already_answered|checkpoint_expired|task_closed|task_started|checkpoint_not_sent/)[0], msg);
    }
    throw new Error(`${what}: ${msg}`);
  }
  return res.data;
}

// supabase/functions/ops-hub/context.ts
async function loadSettings(db) {
  const row = must(await db.from("settings").select("*").eq("id", 1).maybeSingle(), "load settings");
  if (!row) throw new Error("settings row missing: run 01_schema.sql");
  return { ...row, no_reply_window_hours: Number(row.no_reply_window_hours), quote_late_hours: Number(row.quote_late_hours), vat_pct: Number(row.vat_pct ?? 0), vat_on_pass_through: !!row.vat_on_pass_through };
}
function calendarOf(s) {
  return {
    timeZone: s.timezone || DEFAULT_CALENDAR.timeZone,
    workDays: s.work_days?.length ? s.work_days : DEFAULT_CALENDAR.workDays,
    blocks: s.work_blocks?.length ? s.work_blocks : DEFAULT_CALENDAR.blocks,
    holidays: (s.holidays ?? []).map(String)
  };
}
function appLink(s, path) {
  if (!s.app_url) return null;
  return `${s.app_url.replace(/\/$/, "")}${path}`;
}

// supabase/functions/ops-hub/lark.ts
async function loadLarkConfig(ctx) {
  const s = await loadSettings(ctx.db);
  const { data: secrets } = await ctx.db.rpc("ops_lark_secrets");
  const sec = secrets ?? {};
  return {
    mode: s.lark_mode === "live" ? "live" : "simulation",
    apiBase: (ctx.env.larkApiBase ?? String(s.lark_api_base ?? "https://open.larksuite.com")).replace(/\/$/, ""),
    appId: String(s.lark_app_id ?? ""),
    appSecret: sec.app_secret || null,
    verificationToken: sec.verification_token || null,
    chatId: String(s.lark_chat_id ?? ""),
    rules: {
      parentPattern: String(s.lark_parent_pattern ?? "^[A-Z]{2}\\d{3}$"),
      childPattern: String(s.lark_child_pattern ?? "^{PARENT}-\\d{2}-S\\d{2}$"),
      parentExample: String(s.lark_parent_example ?? "DA056"),
      childExample: String(s.lark_child_example ?? "DA056-04-S44")
    },
    notifyD0: !!s.lark_notify_d0,
    notifyTime: String(s.lark_notify_time ?? "09:00"),
    timeZone: String(s.timezone ?? "Asia/Ho_Chi_Minh")
  };
}
var LarkError = class extends Error {
  constructor(code, message, httpStatus = 0) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
};
var tokenCache = /* @__PURE__ */ new Map();
var LarkApi = class {
  constructor(base, appId, appSecret, fetchImpl = fetch) {
    this.base = base;
    this.appId = appId;
    this.appSecret = appSecret;
    this.fetchImpl = fetchImpl;
  }
  async token() {
    const key = `${this.base}|${this.appId}`;
    const hit = tokenCache.get(key);
    if (hit && hit.until > Date.now() + 6e4) return hit.token;
    const res = await this.fetchImpl(`${this.base}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.code !== 0 || !body.tenant_access_token) throw new LarkError(body.code ?? res.status, `Lark t\u1EEB ch\u1ED1i App ID / App Secret: ${body.msg ?? res.statusText}`, res.status);
    tokenCache.set(key, { token: body.tenant_access_token, until: Date.now() + (body.expire ?? 3600) * 1e3 });
    return body.tenant_access_token;
  }
  async call(method, path, body) {
    const token = await this.token();
    const res = await this.fetchImpl(`${this.base}/open-apis${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.code !== 0) throw new LarkError(out.code ?? res.status, `Lark ${method} ${path.split("?")[0]}: ${out.msg ?? res.statusText}`, res.status);
    return out.data;
  }
  createTask(body) {
    return this.call("POST", "/task/v2/tasks?user_id_type=open_id", body).then((d) => d.task);
  }
  createSubtask(parentGuid, body) {
    return this.call("POST", `/task/v2/tasks/${encodeURIComponent(parentGuid)}/subtasks?user_id_type=open_id`, body).then((d) => d.subtask);
  }
  getTask(guid) {
    return this.call("GET", `/task/v2/tasks/${encodeURIComponent(guid)}?user_id_type=open_id`).then((d) => d.task);
  }
  sendCard(chatId, card, uuid) {
    return this.call("POST", "/im/v1/messages?receive_id_type=chat_id", {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card),
      uuid
    });
  }
  replyCard(messageId, card) {
    return this.call("POST", `/im/v1/messages/${encodeURIComponent(messageId)}/reply`, { msg_type: "interactive", content: JSON.stringify(card) });
  }
  // ---- 1.6 (PRD 10.3, U: permissions to confirm on a real Lark app) ----
  /** Direct message to one person (receive_id_type open_id). */
  sendCardToUser(openId, card, uuid) {
    return this.call("POST", "/im/v1/messages?receive_id_type=open_id", {
      receive_id: openId,
      msg_type: "interactive",
      content: JSON.stringify(card),
      uuid
    });
  }
  /** Groups the bot is a member of. */
  async listChats() {
    const out = [];
    let token = "";
    for (let i = 0; i < 20; i++) {
      const d = await this.call("GET", `/im/v1/chats?page_size=100${token ? `&page_token=${encodeURIComponent(token)}` : ""}`);
      for (const c of d.items ?? []) out.push({ chat_id: c.chat_id, name: c.name ?? "" });
      if (!d.has_more || !d.page_token) break;
      token = d.page_token;
    }
    return out;
  }
  async chatMembers(chatId) {
    const out = [];
    let token = "";
    for (let i = 0; i < 20; i++) {
      const d = await this.call(
        "GET",
        `/im/v1/chats/${encodeURIComponent(chatId)}/members?member_id_type=open_id&page_size=100${token ? `&page_token=${encodeURIComponent(token)}` : ""}`
      );
      for (const m of d.items ?? []) out.push({ openId: m.member_id, name: m.name ?? "" });
      if (!d.has_more || !d.page_token) break;
      token = d.page_token;
    }
    return out;
  }
  /** Changes fields of a task the bot created (Completed state, deadline, title). */
  patchTask(guid, task, fields) {
    return this.call("PATCH", `/task/v2/tasks/${encodeURIComponent(guid)}?user_id_type=open_id`, { task, update_fields: fields }).then((d) => d.task);
  }
};
var dueToLark = (dueDate) => ({ timestamp: String(Date.parse(`${dueDate}T00:00:00Z`)), is_all_day: true });
async function rememberPeople(ctx, people) {
  const rows = people.filter((p) => p.openId && p.name).map((p) => ({ open_id: p.openId, name: p.name, updated_at: (/* @__PURE__ */ new Date()).toISOString() }));
  if (rows.length) await ctx.db.from("lark_people").upsert(rows, { onConflict: "open_id" });
}

// supabase/functions/ops-hub/work.ts
var WORK_COLS = "id, kind, parent_id, code, name, description, client, assignee_open_id, assignee_name, assignee_id, due_date, start_date, original_due_date, kpi_due_date, mode, lark_guid, lark_url, lark_title, completed_at, closed_at, state, seq, next_seq, color, pm_id, chat_id, chat_name, chat_status, chat_warned_at, expected_output, tier, progress, progress_note, progress_at, review_since, accepted_at, approved_at, cancel_reason";
var SUB_COLS = "id, task_id, round, via, submitted_at, note, links, files, decision";
var hasEvidence = (s) => !!s && ((s.links?.length ?? 0) > 0 || (s.files?.length ?? 0) > 0);
async function workEnv(ctx, api) {
  const cfg = await loadLarkConfig(ctx);
  const settings = await loadSettings(ctx.db);
  const now = ctx.now();
  let client = api ?? null;
  if (api === void 0 && cfg.mode === "live" && cfg.appId && cfg.appSecret) client = new LarkApi(cfg.apiBase, cfg.appId, cfg.appSecret, ctx.fetchImpl ?? fetch);
  return { cfg, settings, cal: calendarOf(settings), api: client, now, today: localDateKey(now, cfg.timeZone), nowHM: localHM(now, cfg.timeZone) };
}
var link = (w, path) => appLink(w.settings, path);
var projectLink = (w, p) => link(w, `/du-an/${encodeURIComponent(p.code)}`);
var taskLink = (w, p, t) => link(w, `/du-an/${encodeURIComponent(p.code)}?task=${t.id}`);
async function loadRow(ctx, id) {
  if (!id) return null;
  return must(await ctx.db.from("lark_tasks").select(WORK_COLS).eq("id", id).is("deleted_at", null).maybeSingle(), "load row");
}
async function loadProjectByCode(ctx, code) {
  return must(await ctx.db.from("lark_tasks").select(WORK_COLS).eq("kind", "parent").ilike("code", normalizeProjectCode(code)).is("deleted_at", null).maybeSingle(), "load project");
}
async function loadTaskAndProject(ctx, taskId) {
  const task = await loadRow(ctx, taskId);
  if (!task || task.kind !== "child" || !task.parent_id) throw new ApiError(404, "not_found", "Kh\xF4ng t\xECm th\u1EA5y task.");
  const project = await loadRow(ctx, task.parent_id);
  if (!project) throw new ApiError(404, "not_found", "Kh\xF4ng t\xECm th\u1EA5y d\u1EF1 \xE1n c\u1EE7a task.");
  return { task, project };
}
async function personOf(ctx, w, profileId) {
  if (!profileId) return { openId: null, name: "" };
  const p = must(await ctx.db.from("profiles").select("id, full_name, email").eq("id", profileId).maybeSingle(), "load profile");
  const name = p ? p.full_name || p.email : "";
  if (w.cfg.mode === "simulation") {
    const openId = `sim:${profileId}`;
    await ctx.db.from("lark_people").upsert({ open_id: openId, name, profile_id: profileId, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "open_id" });
    return { openId, name };
  }
  const lp = must(await ctx.db.from("lark_people").select("open_id, name").eq("profile_id", profileId).not("open_id", "like", "sim:%").limit(1).maybeSingle(), "load lark person");
  return { openId: lp?.open_id ?? null, name: name || lp?.name || "" };
}
async function profileIdOfOpenId(ctx, openId) {
  if (!openId) return null;
  if (openId.startsWith("sim:")) return openId.slice(4);
  const lp = must(await ctx.db.from("lark_people").select("profile_id").eq("open_id", openId).maybeSingle(), "load person");
  return lp?.profile_id ?? null;
}
async function pmOf(ctx, w, project) {
  if (project.pm_id) return personOf(ctx, w, project.pm_id);
  return { openId: project.assignee_open_id, name: project.assignee_name ?? "PM" };
}
async function addMember(ctx, projectId, m, source) {
  if (!m.profileId && !m.openId) return;
  const { error } = await ctx.db.from("project_members").insert({ project_id: projectId, profile_id: m.profileId, open_id: m.openId, name: m.name, source });
  if (error && error.code !== "23505" && !/duplicate key/.test(error.message)) throw new Error(`save member: ${error.message}`);
}
function actorOf(user, task, project) {
  return {
    role: user.role,
    isAssignee: task.assignee_id === user.id || task.assignee_open_id === `sim:${user.id}`,
    isProjectPm: user.role === "pm" && (!project.pm_id || project.pm_id === user.id)
  };
}
function refuse(action, state, actor) {
  const why = whyNot(action, state, actor);
  if (why) throw new ApiError(403, "forbidden", why);
}
function requireProjectPm(user, project) {
  if (user.role !== "pm") throw new ApiError(403, "forbidden", "Ch\u1EC9 PM m\u1EDBi l\xE0m \u0111\u01B0\u1EE3c thao t\xE1c n\xE0y.");
  if (project.pm_id && project.pm_id !== user.id) throw new ApiError(403, "forbidden", "Ch\u1EC9 PM ph\u1EE5 tr\xE1ch d\u1EF1 \xE1n n\xE0y m\u1EDBi l\xE0m \u0111\u01B0\u1EE3c.");
}
var MAX_ATTEMPTS = 5;
var NOT_IN_CHAT = /* @__PURE__ */ new Set([230002, 232011, 232025]);
async function sendWork(ctx, w, r) {
  let channel = "dm";
  let chatId = null;
  let to = { openId: null, name: "" };
  let message = r.message;
  if (r.to === "group") {
    if (r.project?.chat_status === "linked" && r.project.chat_id) {
      channel = "group";
      chatId = r.project.chat_id;
    } else if (r.project?.chat_status === "none" && w.cfg.chatId) {
      channel = "group";
      chatId = w.cfg.chatId;
    } else {
      to = r.project ? await pmOf(ctx, w, r.project) : to;
      message = { ...message, note: [message.note, "D\u1EF1 \xE1n ch\u01B0a g\u1EAFn group Lark n\xEAn tin \u0111\u01B0\u1EE3c g\u1EEDi ri\xEAng cho PM."].filter(Boolean).join(" ") };
    }
  } else to = r.to;
  const base = {
    project_id: r.project?.id ?? null,
    task_id: r.task?.id ?? null,
    kind: r.kind,
    channel,
    chat_id: chatId,
    to_open_id: channel === "dm" ? to.openId : null,
    to_name: channel === "dm" ? to.name : null,
    dedupe_key: r.key,
    local_date: w.today,
    message,
    status: "failed",
    attempts: 1,
    last_error: "\u0111ang g\u1EEDi"
  };
  let slot = null;
  const ins = await ctx.db.from("bot_messages").insert(base).select("id, attempts").maybeSingle();
  if (!ins.error && ins.data) slot = ins.data;
  else if (r.key) {
    const cur = must(await ctx.db.from("bot_messages").select("id, attempts, status").eq("dedupe_key", r.key).maybeSingle(), "load message");
    if (!cur || cur.status !== "failed" || cur.attempts >= MAX_ATTEMPTS) return false;
    const upd = must(await ctx.db.from("bot_messages").update({ attempts: cur.attempts + 1, message }).eq("id", cur.id).eq("attempts", cur.attempts).select("id, attempts"), "claim retry");
    slot = upd[0] ?? null;
    if (!slot) return false;
  } else throw new Error(`save message: ${ins.error?.message}`);
  try {
    let messageId = null;
    if (w.cfg.mode === "live") {
      if (!w.api) throw new Error("Ch\u01B0a c\xF3 App ID / App Secret c\u1EE7a Lark.");
      const uuid = `${slot.id.slice(0, 18)}-${slot.attempts}`;
      if (channel === "group") messageId = (await w.api.sendCard(chatId, toLarkCard(message), uuid)).message_id;
      else {
        if (!to.openId || to.openId.startsWith("sim:")) throw new Error(`${to.name || "Ng\u01B0\u1EDDi nh\u1EADn"} ch\u01B0a li\xEAn k\u1EBFt t\xE0i kho\u1EA3n Lark.`);
        messageId = (await w.api.sendCardToUser(to.openId, toLarkCard(message), uuid)).message_id;
      }
    }
    must(
      await ctx.db.from("bot_messages").update({ status: w.cfg.mode === "live" ? "sent" : "simulated", last_error: null, sent_at: new Date(ctx.now()).toISOString(), lark_message_id: messageId }).eq("id", slot.id),
      "save message"
    );
    return true;
  } catch (e) {
    await ctx.db.from("bot_messages").update({ status: "failed", last_error: e.message.slice(0, 500) }).eq("id", slot.id);
    if (channel === "group" && r.project?.chat_status === "linked" && e instanceof LarkError && NOT_IN_CHAT.has(Number(e.code))) {
      await ctx.db.from("lark_tasks").update({ chat_status: "missing", chat_warned_at: null }).eq("id", r.project.id);
    }
    return false;
  }
}
var pRef = (p) => ({ code: p.code, name: p.name });
var tRef = (t) => ({ code: t.code, name: t.name, dueDate: t.due_date, assigneeName: t.assignee_name, assigneeOpenId: t.assignee_open_id, expectedOutput: t.expected_output });
var assignee = (t) => ({ openId: t.assignee_open_id, name: t.assignee_name ?? "" });
async function tryLark(what, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`lark ${what} failed`, e.message);
  }
}
async function listChats(ctx, user, body = {}) {
  if (!["pm", "ceo", "admin"].includes(user.role)) throw new ApiError(403, "forbidden", "Ch\u1EC9 PM, CEO ho\u1EB7c Admin.");
  const w = await workEnv(ctx);
  if (w.cfg.mode === "live" && w.api && body.refresh !== false) {
    const chats = await w.api.listChats();
    const stamp = new Date(ctx.now()).toISOString();
    if (chats.length) must(await ctx.db.from("lark_chats").upsert(chats.map((c) => ({ chat_id: c.chat_id, name: c.name, mode: "live", active: true, updated_at: stamp })), { onConflict: "chat_id" }), "save chats");
    const ids = new Set(chats.map((c) => c.chat_id));
    const known = must(await ctx.db.from("lark_chats").select("chat_id").eq("mode", "live").eq("active", true), "load chats");
    const gone = known.filter((k) => !ids.has(k.chat_id)).map((k) => k.chat_id);
    if (gone.length) await ctx.db.from("lark_chats").update({ active: false, updated_at: stamp }).in("chat_id", gone);
  }
  const rows = must(await ctx.db.from("lark_chats").select("chat_id, name, mode, active").eq("mode", w.cfg.mode).eq("active", true).order("name"), "load chats");
  return { mode: w.cfg.mode, chats: rows };
}
async function createSimChat(ctx, user, body) {
  if (user.role !== "pm" && user.role !== "admin") throw new ApiError(403, "forbidden", "Ch\u1EC9 PM ho\u1EB7c Admin.");
  const w = await workEnv(ctx);
  if (w.cfg.mode !== "simulation") throw new ApiError(400, "live", "\u0110ang k\u1EBFt n\u1ED1i Lark th\u1EADt: h\xE3y th\xEAm bot v\xE0o group tr\xEAn Lark.");
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError(400, "invalid", "Nh\u1EADp t\xEAn group.");
  const row = { chat_id: `sim-chat:${crypto.randomUUID()}`, name, mode: "simulation", active: true };
  must(await ctx.db.from("lark_chats").insert(row), "save chat");
  return { chat: row };
}
async function syncMembersFromChat(ctx, w, project) {
  if (w.cfg.mode !== "live" || !w.api || project.chat_status !== "linked" || !project.chat_id) return;
  const members = await w.api.chatMembers(project.chat_id);
  await rememberPeople(ctx, members);
  const people = must(await ctx.db.from("lark_people").select("open_id, profile_id").in("open_id", members.map((m) => m.openId).concat("-")), "load people");
  const byOpen = new Map(people.map((p) => [p.open_id, p.profile_id]));
  for (const m of members) await addMember(ctx, project.id, { profileId: byOpen.get(m.openId) ?? null, openId: m.openId, name: m.name }, "group");
  const current = must(await ctx.db.from("project_members").select("id, open_id").eq("project_id", project.id).eq("source", "group"), "load members");
  const still = new Set(members.map((m) => m.openId));
  const left = current.filter((c) => c.open_id && !still.has(c.open_id)).map((c) => c.id);
  if (left.length) await ctx.db.from("project_members").delete().in("id", left);
}
async function bindChat(ctx, w, project, chatId) {
  const chat = must(await ctx.db.from("lark_chats").select("chat_id, name, mode, active").eq("chat_id", chatId).maybeSingle(), "load chat");
  if (!chat || !chat.active || chat.mode !== w.cfg.mode) throw new ApiError(400, "invalid", "Bot ch\u01B0a \u1EDF trong group n\xE0y. Th\xEAm bot v\xE0o group tr\xEAn Lark r\u1ED3i t\u1EA3i l\u1EA1i danh s\xE1ch.");
  const row = must(
    await ctx.db.from("lark_tasks").update({ chat_id: chat.chat_id, chat_name: chat.name, chat_status: "linked", chat_warned_at: null }).eq("id", project.id).select(WORK_COLS).single(),
    "link chat"
  );
  await tryLark("sync members", () => syncMembersFromChat(ctx, w, row));
  const pm = await pmOf(ctx, w, row);
  await sendWork(ctx, w, { kind: "project_linked", project: row, to: "group", key: `linked|${row.id}|${chat.chat_id}`, message: projectLinkedMessage({ ...pRef(row), dueDate: row.due_date, pmName: pm.name, pmOpenId: pm.openId }) });
  return row;
}
async function warnBotMissing(ctx, w, project) {
  if (project.chat_status !== "missing" || project.chat_warned_at) return false;
  const pm = await pmOf(ctx, w, project);
  await sendWork(ctx, w, { kind: "bot_missing", project, to: pm, key: `bot_missing|${project.id}|${w.today}`, message: botMissingMessage(pRef(project), projectLink(w, project)) });
  await ctx.db.from("lark_tasks").update({ chat_warned_at: new Date(ctx.now()).toISOString() }).eq("id", project.id);
  return true;
}
async function checkProjectChat(ctx, user, body) {
  const w = await workEnv(ctx);
  const project = await loadRow(ctx, String(body.project_id ?? ""));
  if (!project || project.kind !== "parent") throw new ApiError(404, "not_found", "Kh\xF4ng t\xECm th\u1EA5y d\u1EF1 \xE1n.");
  requireProjectPm(user, project);
  const { chats } = await listChats(ctx, user, { refresh: true });
  const chosen = body.chat_id ? chats.find((c) => c.chat_id === body.chat_id) : chats.find((c) => chatMatchesCode(c.name, project.code));
  if (!chosen) {
    if (project.chat_status !== "missing") await ctx.db.from("lark_tasks").update({ chat_status: "missing" }).eq("id", project.id);
    return { linked: false, chats };
  }
  const row = await bindChat(ctx, w, project, chosen.chat_id);
  return { linked: true, project: row, chats };
}
async function createProject(ctx, user, body, via = "web") {
  if (user.role !== "pm") throw new ApiError(403, "forbidden", "Ch\u1EC9 PM m\u1EDBi t\u1EA1o \u0111\u01B0\u1EE3c d\u1EF1 \xE1n.");
  const w = await workEnv(ctx);
  const code = normalizeProjectCode(String(body.code ?? ""));
  const name = String(body.name ?? "").trim();
  const startDate = String(body.start_date || w.today);
  const dueDate = String(body.due_date ?? "");
  const existing = must(await ctx.db.from("lark_tasks").select("code").eq("kind", "parent").is("deleted_at", null), "load codes");
  const errors = [...checkProjectCode(code, existing.map((e) => e.code))];
  if (!name) errors.push("Thi\u1EBFu t\xEAn d\u1EF1 \xE1n.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) errors.push("Thi\u1EBFu deadline d\u1EF1 \xE1n.");
  else {
    if (dueDate <= startDate) errors.push("Deadline d\u1EF1 \xE1n ph\u1EA3i sau ng\xE0y b\u1EAFt \u0111\u1EA7u.");
    if (dueDate < w.today) errors.push("Deadline d\u1EF1 \xE1n \u0111\xE3 qua.");
  }
  if (errors.length) throw new ApiError(400, "invalid", errors.join(" "));
  const pm = await personOf(ctx, w, user.id);
  let guid = null;
  let url = null;
  const title = projectTitle(code, name);
  if (w.cfg.mode === "live") {
    if (!w.api) throw new ApiError(400, "lark_config", "Ch\u01B0a c\xF3 App ID / App Secret c\u1EE7a Lark (Admin \u2192 K\u1EBFt n\u1ED1i Lark).");
    try {
      const t = await w.api.createTask({
        summary: title,
        description: String(body.description ?? ""),
        due: dueToLark(dueDate),
        members: pm.openId ? [{ id: pm.openId, type: "user", role: "assignee" }] : [],
        client_token: crypto.randomUUID()
      });
      guid = t.guid;
      url = t.url ?? null;
    } catch (e) {
      throw new ApiError(502, "lark", `Lark ch\u01B0a t\u1EA1o \u0111\u01B0\u1EE3c d\u1EF1 \xE1n: ${e.message}`);
    }
  }
  const row = must(
    await ctx.db.from("lark_tasks").insert({
      kind: "parent",
      code,
      name,
      client: String(body.client ?? "").trim() || null,
      description: String(body.description ?? "").trim() || null,
      assignee_open_id: pm.openId,
      assignee_name: pm.name,
      pm_id: user.id,
      start_date: startDate,
      due_date: dueDate,
      original_due_date: dueDate,
      kpi_due_date: dueDate,
      mode: w.cfg.mode,
      lark_guid: guid,
      lark_url: url,
      lark_title: title,
      state: "active",
      color: String(body.color ?? "") || colorFor(existing.length),
      chat_status: "missing",
      source: via,
      created_by: user.id,
      synced_at: w.cfg.mode === "live" ? new Date(ctx.now()).toISOString() : null
    }).select(WORK_COLS).single(),
    "save project"
  );
  for (const id of Array.isArray(body.member_ids) ? body.member_ids.map(String) : []) {
    const p = await personOf(ctx, w, id);
    await addMember(ctx, row.id, { profileId: id, openId: p.openId, name: p.name }, "manual");
  }
  let out = row;
  if (body.chat_id) out = await bindChat(ctx, w, row, String(body.chat_id));
  else await warnBotMissing(ctx, w, row);
  return { project: out };
}
async function setMembers(ctx, user, body) {
  const w = await workEnv(ctx);
  const project = await loadRow(ctx, String(body.project_id ?? ""));
  if (!project || project.kind !== "parent") throw new ApiError(404, "not_found", "Kh\xF4ng t\xECm th\u1EA5y d\u1EF1 \xE1n.");
  requireProjectPm(user, project);
  for (const id of Array.isArray(body.add_ids) ? body.add_ids.map(String) : []) {
    const p = await personOf(ctx, w, id);
    await addMember(ctx, project.id, { profileId: id, openId: p.openId, name: p.name }, "manual");
  }
  const remove = Array.isArray(body.remove_ids) ? body.remove_ids.map(String) : [];
  if (remove.length) {
    const busy = must(await ctx.db.from("lark_tasks").select("code, assignee_id").eq("parent_id", project.id).in("assignee_id", remove).in("state", ["doing", "review", "changes"]), "load tasks");
    if (busy.length) throw new ApiError(400, "invalid", `C\xF2n task \u0111ang m\u1EDF (${busy.map((b) => b.code).join(", ")}): giao l\u1EA1i ho\u1EB7c hu\u1EF7 tr\u01B0\u1EDBc khi b\u1ECF th\xE0nh vi\xEAn.`);
    must(await ctx.db.from("project_members").delete().eq("project_id", project.id).in("profile_id", remove).neq("source", "group"), "remove members");
  }
  return { ok: true };
}
async function reopenProjectIfDone(ctx, project) {
  if (project.state === "done") await ctx.db.from("lark_tasks").update({ state: "active", closed_at: null }).eq("id", project.id);
}
async function maybeCloseProject(ctx, w, projectId) {
  const project = await loadRow(ctx, projectId);
  if (!project || project.state !== "active") return;
  const kids = must(await ctx.db.from("lark_tasks").select("state, kpi_due_date, accepted_at").eq("parent_id", projectId).is("deleted_at", null), "load tasks");
  const live = kids.filter((k) => k.state !== "cancelled");
  if (!live.length || live.some((k) => k.state !== "done")) return;
  must(await ctx.db.from("lark_tasks").update({ state: "done", closed_at: new Date(ctx.now()).toISOString() }).eq("id", projectId).eq("state", "active"), "close project");
  const onTime = live.filter((k) => kpiStatus({ state: k.state, kpiDueDate: k.kpi_due_date, acceptedAt: k.accepted_at ? Date.parse(k.accepted_at) : null, pendingAt: null }, ctx.now(), w.cfg.timeZone) === "on_time").length;
  await sendWork(ctx, w, { kind: "project_done", project, to: "group", key: `project_done|${projectId}|${w.today}`, message: projectDoneMessage(pRef(project), live.length, onTime) });
}
async function nextSeq(ctx, projectId) {
  for (let i = 0; i < 6; i++) {
    const cur = must(await ctx.db.from("lark_tasks").select("next_seq").eq("id", projectId).single(), "load counter");
    const upd = must(await ctx.db.from("lark_tasks").update({ next_seq: cur.next_seq + 1 }).eq("id", projectId).eq("next_seq", cur.next_seq).select("id"), "take number");
    if (upd.length) return cur.next_seq;
  }
  throw new ApiError(409, "conflict", "\u0110ang c\xF3 ng\u01B0\u1EDDi t\u1EA1o task c\xF9ng l\xFAc, th\u1EED l\u1EA1i.");
}
async function createTask(ctx, user, body, via = "web") {
  const w = await workEnv(ctx);
  const project = body.project_id ? await loadRow(ctx, String(body.project_id)) : await loadProjectByCode(ctx, String(body.project_code ?? ""));
  if (!project || project.kind !== "parent") throw new ApiError(404, "not_found", `Kh\xF4ng t\xECm th\u1EA5y d\u1EF1 \xE1n ${String(body.project_code ?? "")}.`.trim());
  requireProjectPm(user, project);
  if (project.state === "cancelled") throw new ApiError(400, "invalid", "D\u1EF1 \xE1n \u0111\xE3 hu\u1EF7.");
  const name = String(body.name ?? "").trim();
  const output = String(body.expected_output ?? "").trim();
  const startDate = String(body.start_date || w.today);
  const dueDate = String(body.due_date ?? "");
  const tier = ["short", "medium", "long"].includes(String(body.tier)) ? String(body.tier) : null;
  let person = { openId: null, name: "" };
  let assigneeId = body.assignee_id ? String(body.assignee_id) : null;
  if (assigneeId) person = await personOf(ctx, w, assigneeId);
  else if (body.assignee_open_id) {
    person = { openId: String(body.assignee_open_id), name: String(body.assignee_name ?? "") };
    assigneeId = await profileIdOfOpenId(ctx, person.openId);
  }
  const errors = [];
  if (!name) errors.push("Thi\u1EBFu t\xEAn task.");
  if (!output) errors.push("Thi\u1EBFu k\u1EBFt qu\u1EA3 c\u1EA7n n\u1ED9p.");
  if (!person.openId && !assigneeId) errors.push("Ch\u1ECDn ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) errors.push("Thi\u1EBFu deadline.");
  else {
    if (dueDate <= startDate) errors.push("Deadline ph\u1EA3i sau ng\xE0y b\u1EAFt \u0111\u1EA7u.");
    if (dueDate < w.today) errors.push(`Deadline ${fmtDueDate(dueDate)} \u0111\xE3 qua.`);
    if (dueDate > project.due_date) errors.push(`Deadline sau deadline d\u1EF1 \xE1n (${fmtDueDate(project.due_date)}). Gia h\u1EA1n d\u1EF1 \xE1n tr\u01B0\u1EDBc.`);
  }
  if (errors.length) throw new ApiError(400, "invalid", errors.join(" "));
  if (body.dry_run) return { ok: true, code: taskCode(project.code, project.next_seq) };
  const seq = await nextSeq(ctx, project.id);
  const code = taskCode(project.code, seq);
  let guid = null;
  let url = null;
  const title = taskTitle(code, name);
  if (w.cfg.mode === "live") {
    if (!w.api) throw new ApiError(400, "lark_config", "Ch\u01B0a c\xF3 App ID / App Secret c\u1EE7a Lark.");
    if (!project.lark_guid) throw new ApiError(400, "invalid", `D\u1EF1 \xE1n ${project.code} \u0111\u01B0\u1EE3c t\u1EA1o \u1EDF ch\u1EBF \u0111\u1ED9 m\xF4 ph\u1ECFng, kh\xF4ng c\xF3 tr\xEAn Lark.`);
    try {
      const t = await w.api.createSubtask(project.lark_guid, {
        summary: title,
        description: [String(body.description ?? ""), `K\u1EBFt qu\u1EA3 c\u1EA7n n\u1ED9p: ${output}`].filter(Boolean).join("\n\n"),
        due: dueToLark(dueDate),
        members: person.openId && !person.openId.startsWith("sim:") ? [{ id: person.openId, type: "user", role: "assignee" }] : [],
        client_token: crypto.randomUUID()
      });
      guid = t.guid;
      url = t.url ?? null;
    } catch (e) {
      throw new ApiError(502, "lark", `Lark ch\u01B0a t\u1EA1o \u0111\u01B0\u1EE3c task: ${e.message}`);
    }
  }
  const row = must(
    await ctx.db.from("lark_tasks").insert({
      kind: "child",
      parent_id: project.id,
      parent_code: project.code,
      code,
      seq,
      name,
      description: String(body.description ?? "").trim() || null,
      expected_output: output,
      assignee_open_id: person.openId,
      assignee_name: person.name || null,
      assignee_id: assigneeId,
      start_date: startDate,
      due_date: dueDate,
      original_due_date: dueDate,
      kpi_due_date: dueDate,
      tier,
      state: "doing",
      mode: w.cfg.mode,
      lark_guid: guid,
      lark_url: url,
      lark_title: title,
      source: via,
      created_by: user.id,
      synced_at: w.cfg.mode === "live" ? new Date(ctx.now()).toISOString() : null
    }).select(WORK_COLS).single(),
    "save task"
  );
  await addMember(ctx, project.id, { profileId: assigneeId, openId: person.openId, name: person.name }, "task");
  await reopenProjectIfDone(ctx, project);
  await sendWork(ctx, w, { kind: "task_created", project, task: row, to: "group", key: `task_created|${row.id}`, message: taskCreatedMessage(pRef(project), tRef(row), taskLink(w, project, row)) });
  return { task: row };
}
async function latestSubmission(ctx, taskId) {
  return must(await ctx.db.from("task_submissions").select(SUB_COLS).eq("task_id", taskId).order("round", { ascending: false }).limit(1).maybeSingle(), "load submission");
}
function cleanFiles(raw, taskId) {
  if (!Array.isArray(raw)) return [];
  return raw.map((f) => f).filter((f) => typeof f.path === "string" && f.path.startsWith(`${taskId}/`) && !f.path.includes("..")).map((f) => ({ path: String(f.path), name: String(f.name ?? f.path.split("/").pop()), size: Number(f.size ?? 0) })).slice(0, 20);
}
async function submitTask(ctx, user, body) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ""));
  const actor = actorOf(user, task, project);
  const evidence = { links: cleanLinks(body.links), files: cleanFiles(body.files, task.id) };
  const note = String(body.note ?? "").trim() || null;
  const last = await latestSubmission(ctx, task.id);
  if (task.state === "review" && actor.isAssignee && last && !last.decision && !hasEvidence(last)) {
    const errs2 = evidenceErrors(evidence);
    if (errs2.length) throw new ApiError(400, "invalid", errs2.join(" "));
    must(await ctx.db.from("task_submissions").update({ links: evidence.links, files: evidence.files, note }).eq("id", last.id), "save evidence");
    const pm2 = await pmOf(ctx, w, project);
    await sendWork(ctx, w, { kind: "submitted", project, task, to: "group", key: `submitted|${task.id}|${last.round}`, message: submittedMessage(pRef(project), tRef(task), pm2, taskLink(w, project, task)) });
    return { ok: true, round: last.round };
  }
  refuse("submit", task.state, actor);
  const errs = evidenceErrors(evidence);
  if (errs.length) throw new ApiError(400, "invalid", errs.join(" "));
  const round2 = (last?.round ?? 0) + 1;
  const stamp = new Date(ctx.now()).toISOString();
  must(await ctx.db.from("task_submissions").insert({ task_id: task.id, round: round2, via: "web", submitted_by: user.id, submitted_at: stamp, note, links: evidence.links, files: evidence.files }), "save submission");
  must(await ctx.db.from("lark_tasks").update({ state: "review", review_since: stamp, completed_at: stamp }).eq("id", task.id).in("state", ["doing", "changes"]), "save task");
  if (task.lark_guid && w.api) await tryLark("complete", () => w.api.patchTask(task.lark_guid, { completed_at: String(ctx.now()) }, ["completed_at"]));
  const pm = await pmOf(ctx, w, project);
  await sendWork(ctx, w, { kind: "submitted", project, task, to: "group", key: `submitted|${task.id}|${round2}`, message: submittedMessage(pRef(project), tRef(task), pm, taskLink(w, project, task)) });
  return { ok: true, round: round2 };
}
async function reviewTask(ctx, user, body) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ""));
  const actor = actorOf(user, task, project);
  const approve = body.decision === "approve";
  refuse(approve ? "approve" : "request_changes", task.state, actor);
  const sub = await latestSubmission(ctx, task.id);
  if (!sub || sub.decision) throw new ApiError(409, "conflict", "Kh\xF4ng c\xF3 l\u1EA7n n\u1ED9p n\xE0o \u0111ang ch\u1EDD duy\u1EC7t.");
  const stamp = new Date(ctx.now()).toISOString();
  if (approve) {
    if (!hasEvidence(sub)) throw new ApiError(400, "invalid", "L\u1EA7n n\u1ED9p n\xE0y ch\u01B0a c\xF3 b\u1EB1ng ch\u1EE9ng: ch\u1EDD nh\xE2n s\u1EF1 th\xEAm link ho\u1EB7c file, ho\u1EB7c b\u1EA5m Y\xEAu c\u1EA7u s\u1EEDa.");
    must(await ctx.db.from("task_submissions").update({ decision: "approved", decided_by: user.id, decided_at: stamp, feedback: String(body.feedback ?? "").trim() || null }).eq("id", sub.id).is("decision", null), "save decision");
    must(
      await ctx.db.from("lark_tasks").update({ state: "done", accepted_at: sub.submitted_at, approved_at: stamp, approved_by: user.id, closed_at: stamp, progress: null, progress_note: null }).eq("id", task.id).eq("state", "review"),
      "save task"
    );
    await sendWork(ctx, w, { kind: "approved", project, task, to: "group", key: `approved|${task.id}|${sub.round}`, message: approvedMessage(pRef(project), tRef(task)) });
    await maybeCloseProject(ctx, w, project.id);
    return { ok: true, state: "done" };
  }
  const feedback = String(body.feedback ?? "").trim();
  if (!feedback) throw new ApiError(400, "invalid", "Ghi g\xF3p \xFD: c\u1EA7n c\u1EA3i thi\u1EC7n g\xEC, s\u1EEDa g\xEC.");
  let dates = { dueDate: task.due_date, kpiDueDate: task.kpi_due_date ?? task.due_date };
  let newDue = null;
  if (body.extend_to) {
    newDue = String(body.extend_to);
    const reason = String(body.extend_reason ?? "");
    const errs = extensionErrors({ dueDate: task.due_date }, newDue, reason, project.due_date, w.today);
    if (errs.length) throw new ApiError(400, "invalid", errs.join(" "));
    dates = applyExtension(dates, newDue, reason);
    must(await ctx.db.from("task_extensions").insert({ task_id: task.id, from_date: task.due_date, to_date: newDue, reason, note: feedback, created_by: user.id }), "save extension");
  }
  must(await ctx.db.from("task_submissions").update({ decision: "changes", decided_by: user.id, decided_at: stamp, feedback }).eq("id", sub.id).is("decision", null), "save decision");
  must(
    await ctx.db.from("lark_tasks").update({ state: "changes", review_since: null, completed_at: null, due_date: dates.dueDate, kpi_due_date: dates.kpiDueDate, progress: null, progress_note: null }).eq("id", task.id).eq("state", "review"),
    "save task"
  );
  if (task.lark_guid && w.api) {
    const fields = newDue ? ["completed_at", "due"] : ["completed_at"];
    await tryLark("reopen", () => w.api.patchTask(task.lark_guid, { completed_at: "0", ...newDue ? { due: dueToLark(newDue) } : {} }, fields));
  }
  const t2 = { ...task, due_date: dates.dueDate };
  await sendWork(ctx, w, { kind: "changes", project, task, to: "group", key: `changes|${task.id}|${sub.round}`, message: changesGroupMessage(pRef(project), tRef(task), newDue) });
  await sendWork(ctx, w, { kind: "changes_dm", project, task, to: assignee(task), key: `changes_dm|${task.id}|${sub.round}`, message: changesDmMessage(pRef(project), tRef(t2), feedback, newDue, taskLink(w, project, task)) });
  return { ok: true, state: "changes" };
}
async function extendTask(ctx, user, body) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ""));
  refuse("extend", task.state, actorOf(user, task, project));
  const to = String(body.to ?? "");
  const reason = String(body.reason ?? "");
  const errs = extensionErrors({ dueDate: task.due_date }, to || null, reason, project.due_date, w.today);
  if (errs.length) throw new ApiError(400, "invalid", errs.join(" "));
  const dates = applyExtension({ dueDate: task.due_date, kpiDueDate: task.kpi_due_date ?? task.due_date }, to, reason);
  const ext = must(
    await ctx.db.from("task_extensions").insert({ task_id: task.id, from_date: task.due_date, to_date: to, reason, note: String(body.note ?? "").trim() || null, created_by: user.id }).select("id").single(),
    "save extension"
  );
  must(await ctx.db.from("lark_tasks").update({ due_date: dates.dueDate, kpi_due_date: dates.kpiDueDate }).eq("id", task.id), "save task");
  if (task.lark_guid && w.api) await tryLark("due", () => w.api.patchTask(task.lark_guid, { due: dueToLark(to) }, ["due"]));
  await sendWork(ctx, w, { kind: "extended", project, task, to: "group", key: `extended|${ext.id}`, message: extendedMessage(pRef(project), tRef(task), task.due_date, to, reason) });
  return { ok: true, due_date: dates.dueDate, kpi_due_date: dates.kpiDueDate };
}
async function cancelTask(ctx, user, body) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ""));
  refuse("cancel", task.state, actorOf(user, task, project));
  const reason = String(body.reason ?? "").trim();
  if (!reason) throw new ApiError(400, "invalid", "Ghi l\xFD do hu\u1EF7 task.");
  const stamp = new Date(ctx.now()).toISOString();
  must(await ctx.db.from("lark_tasks").update({ state: "cancelled", cancel_reason: reason, cancelled_at: stamp, closed_at: stamp }).eq("id", task.id), "cancel task");
  await sendWork(ctx, w, { kind: "cancelled", project, task, to: "group", key: `cancelled|${task.id}`, message: cancelledMessage(pRef(project), tRef(task), reason) });
  await maybeCloseProject(ctx, w, project.id);
  return { ok: true };
}
async function reopenTask(ctx, user, body) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ""));
  refuse("reopen", task.state, actorOf(user, task, project));
  const reason = String(body.reason ?? "").trim();
  if (!reason) throw new ApiError(400, "invalid", "Ghi l\xFD do m\u1EDF l\u1EA1i.");
  must(await ctx.db.from("lark_tasks").update({ state: "doing", accepted_at: null, approved_at: null, approved_by: null, closed_at: null, completed_at: null }).eq("id", task.id).eq("state", "done"), "reopen task");
  await reopenProjectIfDone(ctx, project);
  if (task.lark_guid && w.api) await tryLark("reopen", () => w.api.patchTask(task.lark_guid, { completed_at: "0" }, ["completed_at"]));
  await sendWork(ctx, w, { kind: "reopened", project, task, to: "group", key: `reopened|${task.id}|${ctx.now()}`, message: reopenedMessage(pRef(project), tRef(task), reason) });
  return { ok: true };
}
async function recordProgress(ctx, w, task, project, answer, reason) {
  const stamp = new Date(ctx.now()).toISOString();
  must(await ctx.db.from("lark_tasks").update({ progress: answer, progress_note: reason || null, progress_at: stamp }).eq("id", task.id), "save progress");
  const open = must(await ctx.db.from("task_checkins").select("id").eq("task_id", task.id).not("sent_at", "is", null).is("answered_at", null).order("pct", { ascending: false }).limit(1), "load check-in");
  if (open.length) await ctx.db.from("task_checkins").update({ answer, answer_reason: reason || null, answered_at: stamp }).eq("id", open[0].id);
  if (answer === "blocked") {
    const pm = await pmOf(ctx, w, project);
    await sendWork(ctx, w, { kind: "blocked", project, task, to: pm, key: `blocked|${task.id}|${stamp}`, message: blockedMessage(pRef(project), tRef(task), reason, taskLink(w, project, task)) });
  }
}
async function answerProgress(ctx, user, body) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ""));
  refuse("progress", task.state, actorOf(user, task, project));
  const answer = String(body.answer ?? "");
  if (!["on_plan", "behind", "blocked"].includes(answer)) throw new ApiError(400, "invalid", "C\xE2u tr\u1EA3 l\u1EDDi kh\xF4ng h\u1EE3p l\u1EC7.");
  const reason = String(body.reason ?? "").trim();
  if (answer === "blocked" && !reason) throw new ApiError(400, "invalid", "Ghi l\xFD do b\u1ECB ch\u1EB7n \u0111\u1EC3 PM h\u1ED7 tr\u1EE3.");
  await recordProgress(ctx, w, task, project, answer, reason);
  return { ok: true };
}
async function clearBlocked(ctx, user, body) {
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ""));
  const actor = actorOf(user, task, project);
  if (!actor.isAssignee && !actor.isProjectPm) throw new ApiError(403, "forbidden", "Ch\u1EC9 ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n ho\u1EB7c PM c\u1EE7a d\u1EF1 \xE1n.");
  must(await ctx.db.from("lark_tasks").update({ progress: "on_plan", progress_note: null, progress_at: new Date(ctx.now()).toISOString() }).eq("id", task.id).eq("progress", "blocked"), "clear blocked");
  return { ok: true };
}
function deriveTask(w, t, checkins, pending) {
  const mine = checkins.filter((c) => c.task_id === t.id && c.sent_at).sort((a, b) => b.pct - a.pct)[0];
  const noUpdate = !!mine && !mine.answered_at && isNoUpdate(localDateKey(Date.parse(mine.sent_at), w.cfg.timeZone), w.today, w.nowHM, w.cal);
  const h = taskHealth({ state: t.state, dueDate: t.due_date, progress: t.progress, progressNote: t.progress_note, noUpdate, hasEvidence: hasEvidence(pending) }, w.today);
  const day = (s) => s ? localDateKey(Date.parse(s), w.cfg.timeZone) : null;
  return {
    code: t.code,
    name: t.name,
    state: t.state,
    dueDate: t.due_date,
    health: h.health,
    reason: h.reason,
    progress: t.progress,
    noUpdate,
    reviewSince: day(t.review_since),
    submittedOn: t.state === "review" ? day(t.review_since) : null,
    approvedOn: day(t.approved_at)
  };
}
async function workTick(ctx, api, opts = {}) {
  const w = await workEnv(ctx, api);
  const res = { reminders: 0, checkins: 0, nudges: 0, summaries: 0, fromLark: 0, warned: 0, closed: 0 };
  const inWindow = !!opts.force || w.nowHM >= w.cfg.notifyTime;
  const workday = isWorkDay(w.today, w.cal);
  const projects = must(await ctx.db.from("lark_tasks").select(WORK_COLS).eq("kind", "parent").is("deleted_at", null).eq("state", "active"), "load projects");
  if (!projects.length) return res;
  const ids = projects.map((p) => p.id);
  const tasks = must(await ctx.db.from("lark_tasks").select(WORK_COLS).eq("kind", "child").is("deleted_at", null).in("parent_id", ids), "load tasks");
  const openIds = tasks.filter((t) => ["doing", "changes", "review"].includes(t.state)).map((t) => t.id);
  const checkins = openIds.length ? must(await ctx.db.from("task_checkins").select("task_id, pct, sent_at, answered_at").in("task_id", openIds), "load check-ins") : [];
  const subs = openIds.length ? must(await ctx.db.from("task_submissions").select(SUB_COLS).in("task_id", openIds).is("decision", null), "load submissions") : [];
  const pendingOf = new Map(subs.map((s) => [s.task_id, s]));
  for (const project of projects) {
    if (await warnBotMissing(ctx, w, project)) res.warned++;
    const kids = tasks.filter((t) => t.parent_id === project.id);
    for (const t of kids) {
      if (t.completed_at && (t.state === "doing" || t.state === "changes")) {
        const last = await latestSubmission(ctx, t.id);
        const round2 = (last?.round ?? 0) + 1;
        const { error } = await ctx.db.from("task_submissions").insert({ task_id: t.id, round: round2, via: "lark", submitted_at: t.completed_at });
        if (!error) {
          must(await ctx.db.from("lark_tasks").update({ state: "review", review_since: t.completed_at }).eq("id", t.id).in("state", ["doing", "changes"]), "save task");
          t.state = "review";
          t.review_since = t.completed_at;
          pendingOf.set(t.id, { id: "", task_id: t.id, round: round2, via: "lark", submitted_at: t.completed_at, note: null, links: [], files: [], decision: null });
          await sendWork(ctx, w, { kind: "missing_evidence", project, task: t, to: assignee(t), key: `missing_evidence|${t.id}|${round2}`, message: missingEvidenceMessage(tRef(t), taskLink(w, project, t)) });
          res.fromLark++;
        }
        continue;
      }
      if (!inWindow) continue;
      const r = reminderToday({ state: t.state, dueDate: t.due_date, startDate: t.start_date, tier: t.tier }, w.today);
      if (r && await sendWork(ctx, w, { kind: "reminder", project, task: t, to: "group", key: `reminder|${t.id}|${w.today}`, message: deadlineMessage(pRef(project), tRef(t), r, taskLink(w, project, t)) })) res.reminders++;
      const sent = checkins.filter((c) => c.task_id === t.id).map((c) => c.pct);
      const ci = checkinToSend({ state: t.state, startDate: t.start_date, dueDate: t.due_date, tier: t.tier }, sent, w.today, w.cal);
      if (ci) {
        const stamp = new Date(ctx.now()).toISOString();
        const { error } = await ctx.db.from("task_checkins").insert({ task_id: t.id, pct: ci.pct, due_date: ci.date, sent_at: stamp });
        if (!error) {
          checkins.push({ task_id: t.id, pct: ci.pct, sent_at: stamp, answered_at: null });
          if (await sendWork(ctx, w, { kind: "checkin", project, task: t, to: assignee(t), key: `checkin|${t.id}|${ci.pct}`, message: checkinMessage(pRef(project), tRef(t), ci.pct, t.id, taskLink(w, project, t)) })) res.checkins++;
        }
      }
    }
  }
  if (workday) {
    const byPm = /* @__PURE__ */ new Map();
    for (const p of projects) if (p.pm_id) byPm.set(p.pm_id, [...byPm.get(p.pm_id) ?? [], p]);
    const morning = w.settings.summary_morning_time ?? "08:30";
    const evening = w.settings.summary_evening_time ?? "17:30";
    for (const [pmId, mine] of byPm) {
      const pm = await personOf(ctx, w, pmId);
      const kidsOf = (p) => tasks.filter((t) => t.parent_id === p.id);
      if (inWindow) {
        const waiting = mine.flatMap((p) => kidsOf(p).filter((t) => t.state === "review" && t.review_since && reviewIsLate(localDateKey(Date.parse(t.review_since), w.cfg.timeZone), w.today, w.cal)));
        if (waiting.length) {
          const items = waiting.map((t) => ({ code: t.code, name: t.name, days: workDaysAfter(localDateKey(Date.parse(t.review_since), w.cfg.timeZone), w.today, w.cal) }));
          if (await sendWork(ctx, w, { kind: "review_nudge", project: null, to: pm, key: `review_nudge|${pmId}|${w.today}`, message: reviewNudgeMessage(items, link(w, "/cho-duyet")) })) res.nudges++;
        }
      }
      const wantMorning = opts.force || w.nowHM >= morning;
      const wantEvening = (opts.force || w.nowHM >= evening) && w.settings.summary_evening_on !== false;
      if (!wantMorning && !wantEvening) continue;
      const list = mine.map((p) => {
        const derived = kidsOf(p).map((t) => deriveTask(w, t, checkins, pendingOf.get(t.id)));
        const roll = projectRollup({ state: "active", startDate: p.start_date, dueDate: p.due_date }, derived.map((d) => ({ state: d.state, health: d.health })), w.today);
        return summarizeProject({ code: p.code, name: p.name, status: roll.status, reason: roll.reason }, derived, w.today, w.cal);
      });
      if (wantMorning && await sendWork(ctx, w, { kind: "summary_morning", project: null, to: pm, key: `summary_morning|${pmId}|${w.today}`, message: morningSummaryMessage(list, w.today, link(w, "/tom-tat")) })) res.summaries++;
      if (wantEvening && await sendWork(ctx, w, { kind: "summary_evening", project: null, to: pm, key: `summary_evening|${pmId}|${w.today}`, message: eveningSummaryMessage(list, w.today, link(w, "/tom-tat")) })) res.summaries++;
    }
  }
  for (const p of projects) {
    const before = p.state;
    await maybeCloseProject(ctx, w, p.id);
    const after = await loadRow(ctx, p.id);
    if (after && after.state !== before) res.closed++;
  }
  if (w.cfg.mode === "live" && w.api) for (const p of projects) await tryLark("members", () => syncMembersFromChat(ctx, w, p));
  return res;
}

// tools/selftest/work-selftest.ts
var TZ2 = "Asia/Ho_Chi_Minh";
var at = (day, hm) => {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return localToMs(y, m, d, h, mi, TZ2);
};
Deno.serve(async (req) => {
  const env = readEnv((k) => Deno.env.get(k));
  const db = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });
  const secret = await db.rpc("ops_cron_secret");
  if (!secret.data || req.headers.get("x-cron-secret") !== secret.data) return new Response("unauthorized", { status: 401 });
  let clock = Date.now();
  const ctx = { env, db, tg: null, notifier: { send: async () => void 0 }, now: () => clock };
  const log = [];
  const ok = (step, cond, detail) => log.push({ step, ok: !!cond, detail });
  const fails = async (step, fn, re) => {
    try {
      await fn();
      ok(step, false, "no error");
    } catch (e) {
      ok(step, re.test(e.message), e.message);
    }
  };
  const testStart = (/* @__PURE__ */ new Date()).toISOString();
  const maxCheckin = ((await db.from("task_checkins").select("id").order("id", { ascending: false }).limit(1)).data ?? [])[0]?.id ?? 0;
  const projectsBefore = (await db.from("lark_tasks").select("id, state, closed_at").eq("kind", "parent")).data ?? [];
  const row = async (id) => (await db.from("lark_tasks").select(WORK_COLS).eq("id", id).single()).data;
  const msgs = async (kind, taskOrProject) => (await db.from("bot_messages").select("kind, channel, to_name, status").eq("kind", kind).or(`task_id.eq.${taskOrProject},project_id.eq.${taskOrProject}`)).data ?? [];
  try {
    const profiles = (await db.from("profiles").select("id, email, full_name, role, active, telegram_chat_id, tg_state").eq("active", true)).data ?? [];
    const pm = profiles.find((p) => p.role === "pm");
    const staff = profiles.find((p) => p.role === "staff");
    const admin = profiles.find((p) => p.role === "admin") ?? { ...staff, role: "admin" };
    if (!pm || !staff) throw new Error("need an active pm and staff profile");
    const today = localDateKey(clock, TZ2);
    ok("mode is simulation", (await workEnv(ctx)).cfg.mode === "simulation");
    await fails("staff cannot create a project", () => createProject(ctx, staff, { code: "ZZ9", name: "x", due_date: shiftKey(today, 30) }), /Chỉ PM/);
    const { project } = await createProject(ctx, pm, { code: "zz 9", name: "Selftest 1.6", client: "Test", start_date: today, due_date: shiftKey(today, 30) });
    ok("project code normalised", project.code === "ZZ9", project.code);
    ok("no group \u2192 chat missing", project.chat_status === "missing");
    ok("bot-missing DM to PM", (await msgs("bot_missing", project.id)).length === 1);
    await fails("duplicate code refused", () => createProject(ctx, pm, { code: "ZZ9", name: "dup", due_date: shiftKey(today, 30) }), /đã có/);
    const { chat } = await createSimChat(ctx, pm, { name: "ZZ9 \xB7 selftest" });
    const linked = await checkProjectChat(ctx, pm, { project_id: project.id });
    ok("check-again links the group by code", linked.linked && (await row(project.id)).chat_id === chat.chat_id);
    ok("linked message in group", (await msgs("project_linked", project.id))[0]?.channel === "group");
    await setMembers(ctx, pm, { project_id: project.id, add_ids: [staff.id] });
    ok("member added", ((await db.from("project_members").select("id").eq("project_id", project.id).eq("profile_id", staff.id)).data ?? []).length === 1);
    const t1 = await createTask(ctx, pm, { project_id: project.id, name: "Long task", expected_output: "50 video", assignee_id: staff.id, start_date: today, due_date: shiftKey(today, 14) });
    const t2 = await createTask(ctx, pm, { project_id: project.id, name: "Short task", expected_output: "1 file", assignee_id: staff.id, start_date: today, due_date: shiftKey(today, 2) });
    ok("task codes ZZ9-01, ZZ9-02", t1.task.code === "ZZ9-01" && t2.task.code === "ZZ9-02", [t1.task.code, t2.task.code]);
    ok("task created message in group", (await msgs("task_created", t1.task.id))[0]?.channel === "group");
    await fails("task after project deadline refused", () => createTask(ctx, pm, { project_id: project.id, name: "x", expected_output: "y", assignee_id: staff.id, due_date: shiftKey(today, 40) }), /deadline dự án/);
    await fails("task without expected output refused", () => createTask(ctx, pm, { project_id: project.id, name: "x", assignee_id: staff.id, due_date: shiftKey(today, 5) }), /Kết quả cần nộp/i);
    await fails("submit without evidence refused", () => submitTask(ctx, staff, { task_id: t1.task.id, links: [] }), /ít nhất 1/);
    await fails("PM cannot submit for staff", () => submitTask(ctx, pm, { task_id: t1.task.id, links: ["https://a.vn/x"] }), /người được giao/);
    await fails("admin cannot submit for staff", () => submitTask(ctx, admin, { task_id: t1.task.id, links: ["https://a.vn/x"] }), /người được giao/);
    clock = at(shiftKey(today, 1), "10:00");
    await submitTask(ctx, staff, { task_id: t1.task.id, links: ["https://drive.google.com/x", "bad link"], note: "xong" });
    let r1 = await row(t1.task.id);
    ok("submitted \u2192 review", r1.state === "review" && !!r1.review_since);
    ok("submitted message @PM in group", (await msgs("submitted", t1.task.id)).length === 1);
    await fails("staff cannot approve", () => reviewTask(ctx, staff, { task_id: t1.task.id, decision: "approve" }), /PM phụ trách/);
    await fails("changes without feedback refused", () => reviewTask(ctx, pm, { task_id: t1.task.id, decision: "changes", feedback: " " }), /góp ý/);
    await reviewTask(ctx, pm, { task_id: t1.task.id, decision: "changes", feedback: "Thi\u1EBFu 10 video", extend_to: shiftKey(today, 16), extend_reason: "quality" });
    r1 = await row(t1.task.id);
    ok("changes: state, due moved, KPI due kept", r1.state === "changes" && r1.due_date === shiftKey(today, 16) && r1.kpi_due_date === shiftKey(today, 14), [r1.state, r1.due_date, r1.kpi_due_date]);
    ok("changes: short group note + DM feedback", (await msgs("changes", t1.task.id))[0]?.channel === "group" && (await msgs("changes_dm", t1.task.id))[0]?.channel === "dm");
    clock = at(shiftKey(today, 2), "10:00");
    await fails("blocked needs a reason", () => answerProgress(ctx, staff, { task_id: t1.task.id, answer: "blocked" }), /lý do/);
    await answerProgress(ctx, staff, { task_id: t1.task.id, answer: "blocked", reason: "Ch\u1EDD kh\xE1ch g\u1EEDi logo" });
    ok("blocked \u2192 DM to PM", (await msgs("blocked", t1.task.id))[0]?.channel === "dm");
    await clearBlocked(ctx, staff, { task_id: t1.task.id });
    ok("unblocked", (await row(t1.task.id)).progress === "on_plan");
    await extendTask(ctx, pm, { task_id: t1.task.id, to: shiftKey(today, 18), reason: "scope" });
    r1 = await row(t1.task.id);
    ok("scope extension moves KPI date", r1.due_date === shiftKey(today, 18) && r1.kpi_due_date === shiftKey(today, 18));
    await fails("extension past project deadline refused", () => extendTask(ctx, pm, { task_id: t1.task.id, to: shiftKey(today, 45), reason: "scope" }), /deadline dự án/);
    clock = at(shiftKey(today, 2), "09:30");
    const tick = await workTick(ctx, null, {});
    ok("daily run sent a D0 reminder for ZZ9-02", ((await db.from("bot_messages").select("id").eq("kind", "reminder").eq("task_id", t2.task.id)).data ?? []).length === 1, tick);
    await submitTask(ctx, staff, { task_id: t1.task.id, links: ["https://drive.google.com/y"] });
    await reviewTask(ctx, pm, { task_id: t1.task.id, decision: "approve" });
    r1 = await row(t1.task.id);
    ok("approved \u2192 done, accepted = 2nd submission", r1.state === "done" && !!r1.accepted_at && !!r1.approved_at);
    await fails("cannot submit a done task", () => submitTask(ctx, staff, { task_id: t1.task.id, links: ["https://a.vn"] }), /Hoàn thành/);
    await cancelTask(ctx, pm, { task_id: t2.task.id, reason: "Kh\xE1ch b\u1ECF h\u1EA1ng m\u1EE5c" });
    const p2 = await row(project.id);
    ok("project closes when every live task is approved", p2.state === "done", p2.state);
    ok("project-done message", (await msgs("project_done", project.id)).length === 1);
    const subs = (await db.from("task_submissions").select("round, decision").eq("task_id", t1.task.id).order("round")).data ?? [];
    ok("history keeps both rounds", subs.length === 2 && subs[0].decision === "changes" && subs[1].decision === "approved", subs);
    await reopenTask(ctx, pm, { task_id: t1.task.id, reason: "Kh\xE1ch \u0111\u1ED5i \xFD" });
    ok("reopen \u2192 doing, project active again", (await row(t1.task.id)).state === "doing" && (await row(project.id)).state === "active");
    ok("evidence link cleaning", (await db.from("task_submissions").select("links").eq("task_id", t1.task.id).eq("round", 1).single()).data.links.length === 1);
  } catch (e) {
    log.push({ step: "exception", ok: false, detail: `${e.message}
${e.stack}` });
  } finally {
    await db.from("lark_tasks").delete().like("code", "ZZ9%");
    await db.from("lark_chats").delete().like("name", "ZZ9 \xB7%");
    await db.from("bot_messages").delete().gte("created_at", testStart);
    await db.from("task_checkins").delete().gt("id", maxCheckin);
    for (const p of projectsBefore) await db.from("lark_tasks").update({ state: p.state, closed_at: p.closed_at }).eq("id", p.id);
    const left = ((await db.from("lark_tasks").select("id").like("code", "ZZ9%")).data ?? []).length;
    log.push({ step: "cleanup", ok: left === 0, detail: { left } });
  }
  const failed = log.filter((l) => !l.ok);
  return new Response(JSON.stringify({ passed: log.length - failed.length, failed: failed.length, log }, null, 1), { headers: { "content-type": "application/json" } });
});
