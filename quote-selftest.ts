// @ts-nocheck
// tools/selftest/quote-selftest.ts
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
function parseHM(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m) throw new Error(`Invalid time "${value}", expected HH:MM`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || h === 24 && mi > 0) throw new Error(`Invalid time "${value}"`);
  return h * 60 + mi;
}
function validateCalendar(cal) {
  const errors = [];
  if (!cal.timeZone) errors.push("Thi\u1EBFu m\xFAi gi\u1EDD.");
  else {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: cal.timeZone });
    } catch {
      errors.push(`M\xFAi gi\u1EDD kh\xF4ng h\u1EE3p l\u1EC7: ${cal.timeZone}.`);
    }
  }
  if (!cal.workDays.length) errors.push("C\u1EA7n \xEDt nh\u1EA5t m\u1ED9t ng\xE0y l\xE0m vi\u1EC7c trong tu\u1EA7n.");
  if (cal.workDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) errors.push("Ng\xE0y l\xE0m vi\u1EC7c ph\u1EA3i t\u1EEB 1 (th\u1EE9 Hai) \u0111\u1EBFn 7 (Ch\u1EE7 nh\u1EADt).");
  if (!cal.blocks.length) errors.push("C\u1EA7n \xEDt nh\u1EA5t m\u1ED9t ca l\xE0m vi\u1EC7c.");
  let prevEnd = -1;
  const sorted = [...cal.blocks].sort((a, b) => safeHM(a.start) - safeHM(b.start));
  for (const b of sorted) {
    let s;
    let e;
    try {
      s = parseHM(b.start);
      e = parseHM(b.end);
    } catch {
      errors.push(`Ca ${b.start}\u2013${b.end}: gi\u1EDD kh\xF4ng h\u1EE3p l\u1EC7.`);
      continue;
    }
    if (e <= s) errors.push(`Ca ${b.start}\u2013${b.end}: gi\u1EDD k\u1EBFt th\xFAc ph\u1EA3i sau gi\u1EDD b\u1EAFt \u0111\u1EA7u.`);
    if (s < prevEnd) errors.push(`Ca ${b.start}\u2013${b.end} ch\u1ED3ng l\xEAn ca tr\u01B0\u1EDBc.`);
    prevEnd = Math.max(prevEnd, e);
  }
  for (const h of cal.holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h)) errors.push(`Ng\xE0y l\u1EC5 kh\xF4ng h\u1EE3p l\u1EC7: ${h} (\u0111\u1ECBnh d\u1EA1ng YYYY-MM-DD).`);
  }
  return errors;
}
function safeHM(v) {
  try {
    return parseHM(v);
  } catch {
    return 0;
  }
}
var preparedCache = /* @__PURE__ */ new WeakMap();
function prepare(cal) {
  const cached = preparedCache.get(cal);
  if (cached) return cached;
  const errors = validateCalendar(cal);
  if (errors.length) throw new Error(`Invalid calendar: ${errors.join(" ")}`);
  const prepared = {
    tz: cal.timeZone,
    workDays: new Set(cal.workDays),
    blocks: cal.blocks.map((b) => [parseHM(b.start), parseHM(b.end)]).sort((a, b) => a[0] - b[0]),
    holidays: new Set(cal.holidays)
  };
  preparedCache.set(cal, prepared);
  return prepared;
}
function dayIntervals(year, month, day, p) {
  if (!p.workDays.has(isoWeekday(year, month, day))) return [];
  if (p.holidays.has(dateKey(year, month, day))) return [];
  return p.blocks.map(([s, e]) => [
    localToMs(year, month, day, Math.floor(s / 60), s % 60, p.tz),
    localToMs(year, month, day, Math.floor(e / 60), e % 60, p.tz)
  ]);
}
function isWorkingTime(t, cal = DEFAULT_CALENDAR) {
  const ms = toMs(t);
  const p = prepare(cal);
  const { year, month, day } = toLocalParts(ms, p.tz);
  return dayIntervals(year, month, day, p).some(([s, e]) => ms >= s && ms <= e);
}

// src/domain/band.ts
var DEFAULT_BAND_RULES = [
  { level: "send_now", maxDiscountPct: 10, maxDeviationPct: 10, marginFloorPct: null },
  { level: "pm", maxDiscountPct: 20, maxDeviationPct: 20, marginFloorPct: null },
  { level: "ceo", maxDiscountPct: null, maxDeviationPct: null, marginFloorPct: null }
];
var EPS = 1e-9;
function deviationPct(unitPrice, libraryPrice) {
  if (libraryPrice === null || libraryPrice === void 0 || !(libraryPrice > 0)) return null;
  return (unitPrice - libraryPrice) * 100 / libraryPrice;
}
function ruleFor(level, rules) {
  return rules.find((r) => r.level === level) ?? DEFAULT_BAND_RULES.find((r) => r.level === level);
}
function failuresAt(rule, lines, discountPct, devs, effectivePct) {
  const out = [];
  const level = rule.level;
  if (rule.maxDiscountPct !== null && discountPct > rule.maxDiscountPct + EPS) {
    out.push({ code: "discount", level, value: discountPct, limit: rule.maxDiscountPct });
  }
  lines.forEach((line, i) => {
    if (line.passThrough) return;
    const dev = devs[i];
    if (dev === null) {
      out.push({ code: "no_library_price", level, line: i, name: line.name });
      return;
    }
    const hasItemBand = (line.bandLow ?? null) !== null || (line.bandHigh ?? null) !== null;
    if (level === "send_now" && hasItemBand) {
      const lo = line.bandLow ?? -Infinity;
      const hi = line.bandHigh ?? Infinity;
      if (line.unitPrice < lo || line.unitPrice > hi) {
        out.push({ code: "deviation", level, line: i, name: line.name, value: dev, limit: null, bandLow: line.bandLow ?? null, bandHigh: line.bandHigh ?? null });
      }
      return;
    }
    if (rule.maxDeviationPct !== null && Math.abs(dev) > rule.maxDeviationPct + EPS) {
      out.push({ code: "deviation", level, line: i, name: line.name, value: dev, limit: rule.maxDeviationPct });
    }
  });
  if (rule.marginFloorPct !== null && effectivePct !== null && effectivePct + EPS < rule.marginFloorPct) {
    out.push({ code: "margin_floor", level, value: effectivePct, limit: rule.marginFloorPct });
  }
  return out;
}
function bandCheck(lines, discountPct, rules = DEFAULT_BAND_RULES) {
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
    throw new Error("Discount must be between 0 and 100%");
  }
  for (const l of lines) {
    if (!Number.isFinite(l.qty) || l.qty <= 0) throw new Error("Quantity must be greater than 0");
    if (!Number.isFinite(l.unitPrice) || l.unitPrice < 0) throw new Error("Unit price must be 0 or more");
  }
  const devs = lines.map((l) => l.passThrough ? null : deviationPct(l.unitPrice, l.libraryPrice));
  const known = devs.filter((d) => d !== null).map((d) => Math.abs(d));
  const maxDeviationPct = known.length ? Math.max(...known) : 0;
  const service = lines.map((l, i) => ({ l, d: devs[i] })).filter((x) => !x.l.passThrough);
  let effectivePct = null;
  if (service.length && service.every((x) => x.d !== null)) {
    const libraryValue = service.reduce((s, x) => s + x.l.qty * x.l.libraryPrice, 0);
    const quoted = service.reduce((s, x) => s + x.l.qty * x.l.unitPrice, 0) * (1 - discountPct / 100);
    effectivePct = libraryValue > 0 ? quoted * 100 / libraryValue : null;
  }
  const failed = {};
  let level = "ceo";
  for (const candidate of ["send_now", "pm"]) {
    const f = failuresAt(ruleFor(candidate, rules), lines, discountPct, devs, effectivePct);
    if (!f.length) {
      level = candidate;
      break;
    }
    failed[candidate] = f;
  }
  return {
    level,
    discountPct,
    maxDeviationPct,
    lineDeviationPct: devs,
    effectivePct,
    failed,
    reasons: level === "send_now" ? [] : failed[level === "pm" ? "send_now" : "pm"] ?? []
  };
}
function publicBand(result) {
  return {
    level: result.level,
    discountPct: result.discountPct,
    maxDeviationPct: result.maxDeviationPct,
    lineDeviationPct: result.lineDeviationPct,
    reasons: result.reasons.map((r) => {
      if (r.code === "discount") return { code: r.code, value: r.value };
      if (r.code === "deviation") return { code: r.code, line: r.line, name: r.name, value: r.value };
      if (r.code === "no_library_price") return { code: r.code, line: r.line, name: r.name };
      return { code: r.code };
    })
  };
}
var BAND_LABEL = {
  send_now: "G\u1EEDi ngay",
  pm: "C\u1EA7n PM duy\u1EC7t",
  ceo: "C\u1EA7n CEO duy\u1EC7t"
};
function pct(v) {
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "\u2212" : ""}${Math.abs(r).toLocaleString("vi-VN")}%`;
}
function describeReason(r) {
  switch (r.code) {
    case "discount":
      return `Chi\u1EBFt kh\u1EA5u ${(r.value ?? 0).toLocaleString("vi-VN")}% v\u01B0\u1EE3t m\u1EE9c \u0111\u01B0\u1EE3c ph\xE9p \u1EDF c\u1EA5p n\xE0y`;
    case "deviation":
      return `\u0110\u01A1n gi\xE1 "${r.name ?? `d\xF2ng ${(r.line ?? 0) + 1}`}" l\u1EC7ch ${pct(r.value ?? 0)} so v\u1EDBi th\u01B0 vi\u1EC7n`;
    case "no_library_price":
      return `D\xF2ng "${r.name ?? `d\xF2ng ${(r.line ?? 0) + 1}`}" kh\xF4ng c\xF3 gi\xE1 th\u01B0 vi\u1EC7n \u0111\u1EC3 so s\xE1nh`;
    case "margin_floor":
      return "T\u1ED5ng gi\xE1 th\u1EA5p h\u01A1n m\u1EE9c s\xE0n c\u1EE7a c\xF4ng ty";
  }
}

// src/domain/quote.ts
function lineAmount(line) {
  return Math.round(line.qty * line.unitPrice);
}
function isPassThrough(line) {
  return line.kind === "pass_through";
}
function quoteTotals(lines, discountPct, vat) {
  const serviceSubtotal = lines.filter((l) => !isPassThrough(l)).reduce((s, l) => s + lineAmount(l), 0);
  const passThrough = lines.filter(isPassThrough).reduce((s, l) => s + lineAmount(l), 0);
  const subtotal = serviceSubtotal + passThrough;
  const discountAmount = Math.round(serviceSubtotal * (Number(discountPct) || 0) / 100);
  const total = subtotal - discountAmount;
  const vatPct = Number(vat?.pct) || 0;
  const vatBase = serviceSubtotal - discountAmount + (vat?.onPassThrough ? passThrough : 0);
  const vatAmount = Math.round(vatBase * vatPct / 100);
  return { subtotal, serviceSubtotal, passThrough, discountAmount, total, vatPct, vatAmount, grandTotal: total + vatAmount };
}
function approverFor(kind, band) {
  if (kind === "project") return "ceo";
  return band === "send_now" ? null : band;
}
function nextQuoteStatus(status, event, band, kind = "quick") {
  const fail = (error) => ({ ok: false, error });
  switch (event) {
    case "edit":
      if (status === "sent") return fail("B\xE1o gi\xE1 \u0111\xE3 g\u1EEDi kh\xF4ng s\u1EEDa \u0111\u01B0\u1EE3c. H\xE3y t\u1EA1o b\xE1o gi\xE1 m\u1EDBi (c\xF3 th\u1EC3 ch\xE9p h\u1EA1ng m\u1EE5c).");
      return { ok: true, status: "draft" };
    case "submit":
      if (status !== "draft") return fail("Ch\u1EC9 g\u1EEDi duy\u1EC7t \u0111\u01B0\u1EE3c b\xE1o gi\xE1 \u0111ang \u1EDF tr\u1EA1ng th\xE1i Nh\xE1p.");
      if (!band) return fail("Ch\u01B0a c\xF3 k\u1EBFt qu\u1EA3 ki\u1EC3m tra khung gi\xE1.");
      if (band === "send_now" && kind !== "project") return fail("B\xE1o gi\xE1 n\u1EB1m trong khung gi\xE1, c\xF3 th\u1EC3 g\u1EEDi ngay, kh\xF4ng c\u1EA7n duy\u1EC7t.");
      return { ok: true, status: "pending" };
    case "approve":
      if (status !== "pending") return fail("Ch\u1EC9 duy\u1EC7t \u0111\u01B0\u1EE3c b\xE1o gi\xE1 \u0111ang ch\u1EDD duy\u1EC7t.");
      return { ok: true, status: "signing" };
    case "approve_sign":
      if (status !== "pending") return fail("Ch\u1EC9 duy\u1EC7t \u0111\u01B0\u1EE3c b\xE1o gi\xE1 \u0111ang ch\u1EDD duy\u1EC7t.");
      return { ok: true, status: "approved" };
    case "request_changes":
      if (status !== "pending" && status !== "signing") return fail("Ch\u1EC9 y\xEAu c\u1EA7u s\u1EEDa \u0111\u01B0\u1EE3c b\xE1o gi\xE1 \u0111ang ch\u1EDD duy\u1EC7t ho\u1EB7c ch\u1EDD k\xFD.");
      return { ok: true, status: "changes_requested" };
    case "sign":
      if (status !== "signing") return fail("Ch\u1EC9 k\xFD \u0111\u01B0\u1EE3c b\xE1o gi\xE1 \u0111ang ch\u1EDD CEO k\xFD.");
      return { ok: true, status: "approved" };
    case "send":
      if (status === "approved") return { ok: true, status: "sent" };
      if (status === "draft" && kind === "project") return fail("B\xE1o gi\xE1 d\u1EF1 \xE1n ph\u1EA3i \u0111\u01B0\u1EE3c duy\u1EC7t v\xE0 CEO k\xFD tr\u01B0\u1EDBc khi g\u1EEDi.");
      if (status === "draft" && band === "send_now") return { ok: true, status: "sent" };
      if (status === "draft") return fail("B\xE1o gi\xE1 ngo\xE0i khung gi\xE1 ph\u1EA3i \u0111\u01B0\u1EE3c duy\u1EC7t v\xE0 CEO k\xFD tr\u01B0\u1EDBc khi g\u1EEDi.");
      if (status === "signing") return fail("B\xE1o gi\xE1 \u0111ang ch\u1EDD CEO k\xFD.");
      return fail("B\xE1o gi\xE1 \u1EDF tr\u1EA1ng th\xE1i n\xE0y ch\u01B0a g\u1EEDi \u0111\u01B0\u1EE3c.");
  }
}
function termConflicts(selected, lib) {
  const groupOf = new Map(lib.filter((t) => t.choice_group?.trim()).map((t) => [t.text, t.choice_group.trim()]));
  const byGroup = /* @__PURE__ */ new Map();
  for (const text of selected) {
    const g = groupOf.get(text);
    if (g) byGroup.set(g, [...byGroup.get(g) ?? [], text]);
  }
  return [...byGroup.entries()].filter(([, ts]) => ts.length > 1).map(([group, terms]) => ({ group, terms }));
}
function termConflictText(c) {
  return c.map((x) => `\u0110i\u1EC1u kho\u1EA3n "${x.group}" ch\u1EC9 ch\u1ECDn 1 (\u0111ang ch\u1ECDn ${x.terms.length}).`);
}
var OUTCOME_LABEL = { won: "Kh\xE1ch \u0111\xE3 ch\u1ED1t", lost: "Kh\xF4ng ch\u1ED1t" };
var LOST_REASON_LABEL = { price: "Gi\xE1 cao", competitor: "Ch\u1ECDn b\xEAn kh\xE1c", postponed: "Kh\xE1ch ho\xE3n", other: "Kh\xE1c" };
function outcomeErrors(q, user, next) {
  const out = [];
  if (!(user.id === q.createdBy || user.role === "pm" || user.role === "ceo")) out.push("Ch\u1EC9 Account c\u1EE7a b\xE1o gi\xE1, PM ho\u1EB7c CEO ghi \u0111\u01B0\u1EE3c k\u1EBFt qu\u1EA3.");
  if (q.status !== "sent") out.push("Ch\u1EC9 ghi k\u1EBFt qu\u1EA3 cho b\xE1o gi\xE1 \u0111\xE3 g\u1EEDi kh\xE1ch.");
  if (q.source === "import") out.push("B\xE1o gi\xE1 nh\u1EADp t\u1EEB l\u1ECBch s\u1EED kh\xF4ng ghi k\u1EBFt qu\u1EA3.");
  if (q.hasProject) out.push("B\xE1o gi\xE1 \u0111\xE3 c\xF3 d\u1EF1 \xE1n: kh\xF4ng \u0111\u1ED5i k\u1EBFt qu\u1EA3 \u0111\u01B0\u1EE3c.");
  if (next.outcome === "won" && !next.handoverPm) out.push("Ch\u1ECDn PM nh\u1EADn d\u1EF1 \xE1n.");
  if (next.outcome === "lost" && !(next.lostReason && next.lostReason in LOST_REASON_LABEL)) out.push("Ch\u1ECDn l\xFD do kh\xF4ng ch\u1ED1t.");
  return out;
}
function quoteLinkErrors(q, user) {
  const out = [];
  if (user.role !== "pm") out.push("Ch\u1EC9 PM g\u1EAFn \u0111\u01B0\u1EE3c b\xE1o gi\xE1 v\xE0o d\u1EF1 \xE1n.");
  if (q.outcome !== "won") out.push("Ch\u1EC9 g\u1EAFn \u0111\u01B0\u1EE3c b\xE1o gi\xE1 kh\xE1ch \u0111\xE3 ch\u1ED1t.");
  if (q.source === "import") out.push("B\xE1o gi\xE1 nh\u1EADp t\u1EEB l\u1ECBch s\u1EED kh\xF4ng g\u1EAFn \u0111\u01B0\u1EE3c.");
  if (q.linked) out.push("B\xE1o gi\xE1 n\xE0y \u0111\xE3 thu\u1ED9c m\u1ED9t d\u1EF1 \xE1n.");
  if (q.handoverPm && q.handoverPm !== user.id) out.push("B\xE1o gi\xE1 n\xE0y giao cho PM kh\xE1c.");
  return out;
}
function validateQuote(q) {
  const errors = [];
  if (!q.client.trim()) errors.push("Nh\u1EADp t\xEAn kh\xE1ch h\xE0ng.");
  if (q.requestedAt === null) errors.push("Nh\u1EADp th\u1EDDi \u0111i\u1EC3m kh\xE1ch g\u1EEDi y\xEAu c\u1EA7u.");
  else if (q.requestedAt > q.now + 6e4) errors.push("Th\u1EDDi \u0111i\u1EC3m kh\xE1ch g\u1EEDi y\xEAu c\u1EA7u kh\xF4ng \u0111\u01B0\u1EE3c \u1EDF t\u01B0\u01A1ng lai.");
  if (!q.lines.length) errors.push("Th\xEAm \xEDt nh\u1EA5t m\u1ED9t h\u1EA1ng m\u1EE5c.");
  if (q.lines.some((l) => !(l.qty > 0))) errors.push("S\u1ED1 l\u01B0\u1EE3ng m\u1ED7i d\xF2ng ph\u1EA3i l\u1EDBn h\u01A1n 0.");
  if (q.lines.some((l) => !(l.unitPrice >= 0))) errors.push("\u0110\u01A1n gi\xE1 kh\xF4ng h\u1EE3p l\u1EC7.");
  if (!(q.discountPct >= 0 && q.discountPct <= 100)) errors.push("Chi\u1EBFt kh\u1EA5u ph\u1EA3i t\u1EEB 0 \u0111\u1EBFn 100%.");
  if (q.vatPct !== void 0 && !(q.vatPct >= 0 && q.vatPct <= 100)) errors.push("Thu\u1EBF GTGT ph\u1EA3i t\u1EEB 0 \u0111\u1EBFn 100%.");
  return errors;
}
function linesMissingOverrideReason(lines) {
  return lines.map((l, i) => ({ l, i })).filter(({ l }) => !isPassThrough(l) && l.libraryPrice !== null && l.unitPrice !== l.libraryPrice && !(l.overrideReason ?? "").trim()).map(({ i }) => i);
}

// src/domain/review.ts
function approveGate(openThreads) {
  if (openThreads > 0) return { ok: false, error: `C\xF2n ${openThreads} g\xF3p \xFD ch\u01B0a x\u1EED l\xFD. \u0110\xE1nh d\u1EA5u \u0111\xE3 x\u1EED l\xFD tr\u01B0\u1EDBc khi duy\u1EC7t, ho\u1EB7c ch\u1ECDn Y\xEAu c\u1EA7u s\u1EEDa.` };
  return { ok: true };
}
function requestChangesGate(note, openThreads) {
  if (!note.trim() && openThreads === 0) return { ok: false, error: "H\xE3y ghi nh\u1EADn x\xE9t, ho\u1EB7c g\xF3p \xFD tr\u1EF1c ti\u1EBFp tr\xEAn b\xE1o gi\xE1, \u0111\u1EC3 Account bi\u1EBFt c\u1EA7n s\u1EEDa g\xEC." };
  return { ok: true };
}
function sendGate(openThreads) {
  if (openThreads > 0) return { ok: false, error: `C\xF2n ${openThreads} g\xF3p \xFD ch\u01B0a x\u1EED l\xFD tr\xEAn b\xE1o gi\xE1. X\u1EED l\xFD v\xE0 \u0111\xE1nh d\u1EA5u xong tr\u01B0\u1EDBc khi g\u1EEDi kh\xE1ch.` };
  return { ok: true };
}
function changesSummary(note, openThreads) {
  const text = note.trim();
  if (text) return text;
  return `${openThreads} g\xF3p \xFD tr\xEAn b\xE1o gi\xE1`;
}

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

// src/domain/labels.ts
var ROLE_LABEL = {
  account: "Account",
  pm: "PM",
  ceo: "CEO",
  ecom_exec: "E-commerce Executive",
  staff: "Nh\xE2n vi\xEAn",
  admin: "Admin"
};
function fmtVnd(n, withUnit = true) {
  if (n === null || n === void 0 || !Number.isFinite(n)) return "\u2013";
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "\u2212" : ""}${s}${withUnit ? " \u0111" : ""}`;
}

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
function projectTitle(code, name) {
  return `[${code}] ${name.trim()}`;
}
function chatMatchesCode(chatName, code) {
  const c = normalizeProjectCode(code);
  if (!c) return false;
  return new RegExp(`(^|[^A-Z0-9])${c}([^A-Z0-9]|$)`).test(normalizeCode(chatName));
}
function chatNameFor(code, name) {
  return `${normalizeProjectCode(code)} - ${name.trim().replace(/\s+/g, " ")}`;
}
function chatCodeConflict(chatName, ownCode, otherCodes) {
  const own2 = normalizeProjectCode(ownCode);
  if (own2 && chatMatchesCode(chatName, own2)) return null;
  return otherCodes.map(normalizeProjectCode).find((c) => c && c !== own2 && chatMatchesCode(chatName, c)) ?? null;
}
function shiftKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const r = addDays(y, m, d, days);
  return dateKey(r.year, r.month, r.day);
}
function localHM(now, timeZone) {
  const p = toLocalParts(now, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}
var MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;
var pLine = (p) => ({ icon: "\u{1F4CC}", label: "D\u1EF1 \xE1n", text: projectTitle(p.code, p.name) });
var linkLine = (url, text = "M\u1EDF tr\xEAn Ops Hub") => url ? [{ icon: "\u{1F517}", text: `[${text}](${url})` }] : [];
function projectLinkedMessage(p) {
  return {
    tone: "blue",
    title: `\u{1F4CC} D\u1EF1 \xE1n ${p.code} \u0111\xE3 g\u1EAFn v\u1EDBi group n\xE0y`,
    lines: [pLine(p), { icon: "\u{1F9D1}\u200D\u{1F4BC}", label: "PM", text: p.pmName, mentionOpenId: p.pmOpenId }, { icon: "\u23F0", label: "Deadline d\u1EF1 \xE1n", text: fmtDueDate(p.dueDate) }],
    note: "Task, nh\u1EAFc h\u1EA1n v\xE0 k\u1EBFt qu\u1EA3 duy\u1EC7t c\u1EE7a d\u1EF1 \xE1n s\u1EBD \u0111\u01B0\u1EE3c b\xE1o trong group n\xE0y."
  };
}
function botMissingMessage(p, url) {
  return {
    tone: "orange",
    title: `\u{1F916} Bot ch\u01B0a c\xF3 trong group c\u1EE7a ${p.code}`,
    lines: [pLine(p), { icon: "\u2139\uFE0F", text: `Th\xEAm bot Go Media v\xE0o group Lark c\u1EE7a d\u1EF1 \xE1n (n\xEAn \u0111\u1EB7t t\xEAn group b\u1EAFt \u0111\u1EA7u b\u1EB1ng "${p.code}"), r\u1ED3i b\u1EA5m "Ki\u1EC3m tra l\u1EA1i" tr\xEAn trang d\u1EF1 \xE1n.` }, ...linkLine(url, "M\u1EDF d\u1EF1 \xE1n")],
    note: "Trong l\xFAc ch\u01B0a g\u1EAFn group, tin c\u1EE7a d\u1EF1 \xE1n \u0111\u01B0\u1EE3c g\u1EEDi ri\xEAng cho b\u1EA1n."
  };
}
function inviteMessage(p, toOpenId, toName, url) {
  return {
    tone: "blue",
    title: `\u{1F4E8} L\u1EDDi m\u1EDDi tham gia d\u1EF1 \xE1n ${p.code}`,
    lines: [
      { icon: "\u{1F464}", label: "G\u1EEDi", text: toName, mentionOpenId: toOpenId },
      pLine(p),
      ...p.client ? [{ icon: "\u{1F3E2}", label: "Kh\xE1ch h\xE0ng", text: p.client }] : [],
      { icon: "\u{1F9D1}\u200D\u{1F4BC}", label: "PM", text: p.pmName },
      { icon: "\u23F0", label: "Deadline d\u1EF1 \xE1n", text: fmtDueDate(p.dueDate) },
      ...linkLine(url, "Xem v\xE0 tr\u1EA3 l\u1EDDi l\u1EDDi m\u1EDDi")
    ],
    note: "V\xE0o Inbox tr\xEAn Ops Hub \u0111\u1EC3 Tham gia ho\u1EB7c T\u1EEB ch\u1ED1i (t\u1EEB ch\u1ED1i c\u1EA7n ghi l\xFD do)."
  };
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
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
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
async function loadRules(db) {
  const rows = must(await db.from("price_rules").select("level, max_discount_pct, max_deviation_pct, margin_floor_pct"), "load price rules");
  const num = (v) => v === null || v === void 0 ? null : Number(v);
  return rows.map((r) => ({ level: r.level, maxDiscountPct: num(r.max_discount_pct), maxDeviationPct: num(r.max_deviation_pct), marginFloorPct: num(r.margin_floor_pct) }));
}
function requireRole(p, ...roles) {
  if (!roles.includes(p.role)) throw new ApiError(403, "forbidden", "B\u1EA1n kh\xF4ng c\xF3 quy\u1EC1n l\xE0m thao t\xE1c n\xE0y.");
}
function appLink(s, path) {
  if (!s.app_url) return null;
  return `${s.app_url.replace(/\/$/, "")}${path}`;
}

// supabase/functions/ops-hub/messages.ts
function approvalRequestText(o) {
  return [
    `<b>B\xE1o gi\xE1 ch\u1EDD b\u1EA1n duy\u1EC7t \xB7 ${escapeHtml(o.code)}</b>`,
    `Kh\xE1ch: ${escapeHtml(o.client)} \xB7 T\u1ED5ng: ${fmtVnd(o.total)}`,
    `Ng\u01B0\u1EDDi l\u1EADp: ${escapeHtml(o.accountName)} \xB7 ${BAND_LABEL[o.level]}`,
    ...o.reasons.map((r) => `\u2022 ${escapeHtml(describeReason(r))}`)
  ].join("\n");
}
function decisionText(o) {
  const head = o.decision === "approve" ? `<b>${escapeHtml(o.code)} \u0111\xE3 \u0111\u01B0\u1EE3c duy\u1EC7t</b> \xB7 c\xF3 th\u1EC3 xu\u1EA5t PDF v\xE0 g\u1EEDi kh\xE1ch` : `<b>${escapeHtml(o.code)} c\u1EA7n s\u1EEDa</b>`;
  return [head, `Ng\u01B0\u1EDDi duy\u1EC7t: ${ROLE_LABEL[o.approverRole]}`, o.comment ? `Nh\u1EADn x\xE9t: ${escapeHtml(o.comment)}` : ""].filter(Boolean).join("\n");
}
function signRequestText(o) {
  return [`<b>B\xE1o gi\xE1 ch\u1EDD CEO k\xFD \xB7 ${escapeHtml(o.code)}</b>`, `Kh\xE1ch: ${escapeHtml(o.client)}`, "M\u1EDF b\xE1o gi\xE1, xem tr\u01B0\u1EDBc r\u1ED3i b\u1EA5m K\xFD."].join("\n");
}
function linkButton(text, url) {
  return url ? [[{ text, url }]] : void 0;
}
var HELP_TEXT = [
  "<b>Go Media Task Bot</b>",
  "Bot h\u1ECFi ti\u1EBFn \u0111\u1ED9 m\u1ED7i task \u1EDF 25%, 50%, 75% v\xE0 99% th\u1EDDi gian l\xE0m vi\u1EC7c, ch\u1EC9 trong gi\u1EDD l\xE0m.",
  "",
  "/baochan \xB7 b\xE1o m\u1ED9t task \u0111ang b\u1ECB ch\u1EB7n ngay b\xE2y gi\u1EDD",
  "/help \xB7 xem h\u01B0\u1EDBng d\u1EABn n\xE0y",
  "",
  "Ch\u01B0a li\xEAn k\u1EBFt t\xE0i kho\u1EA3n? V\xE0o app \u2192 H\u1ED3 s\u01A1 \u2192 Li\xEAn k\u1EBFt Telegram."
].join("\n");

// supabase/functions/ops-hub/review.ts
var NOTIFY_GAP_MS = 10 * 6e4;
async function openThreadCount(ctx, quoteId) {
  const res = await ctx.db.from("quote_comments").select("id", { count: "exact", head: true }).eq("quote_id", quoteId).is("parent_id", null).is("resolved_at", null);
  if (res.error) throw new Error(`count open comments: ${res.error.message}`);
  return res.count ?? 0;
}

// supabase/functions/ops-hub/quotes.ts
var QUOTE_COLS = "id, code, client, service_group, status, requested_at, discount_pct, vat_pct, created_by, approver, band_result, band_detail, total, kind, source, outcome, terms";
async function libraryMap(ctx, ids) {
  const wanted = [...new Set(ids.filter((x) => !!x))];
  if (!wanted.length) return /* @__PURE__ */ new Map();
  const rows = must(await ctx.db.from("library_items").select("id, name, unit, service_group, unit_price, band_low, band_high, active, kind").in("id", wanted), "load library");
  return new Map(rows.map((r) => [r.id, { ...r, unit_price: Number(r.unit_price), band_low: r.band_low === null ? null : Number(r.band_low), band_high: r.band_high === null ? null : Number(r.band_high) }]));
}
function bandLines(lines, lib) {
  return lines.map((l) => {
    const item = l.library_item_id ? lib.get(l.library_item_id) : void 0;
    return {
      name: item?.name ?? l.item_name ?? "H\u1EA1ng m\u1EE5c",
      qty: Number(l.qty),
      unitPrice: Number(l.unit_price),
      libraryPrice: item ? item.unit_price : null,
      bandLow: item?.band_low ?? null,
      bandHigh: item?.band_high ?? null,
      // The library decides what is pass-through; a line without a library item keeps its own kind.
      passThrough: (item?.kind ?? l.kind) === "pass_through"
    };
  });
}
var esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function loadQuote(ctx, id) {
  const q = must(await ctx.db.from("quotes").select(QUOTE_COLS).eq("id", id).maybeSingle(), "load quote");
  if (!q) throw new ApiError(404, "quote_not_found", "Kh\xF4ng t\xECm th\u1EA5y b\xE1o gi\xE1.");
  return { ...q, discount_pct: Number(q.discount_pct), vat_pct: Number(q.vat_pct ?? 0), total: Number(q.total) };
}
async function loadLines(ctx, quoteId) {
  const rows = must(
    await ctx.db.from("quote_lines").select("library_item_id, item_name, qty, unit_price, override_reason, kind").eq("quote_id", quoteId).order("position"),
    "load lines"
  );
  return rows.map((r) => ({ ...r, qty: Number(r.qty), unit_price: Number(r.unit_price) }));
}
function own(user, q) {
  requireRole(user, "account");
  if (q.created_by !== user.id) throw new ApiError(403, "not_owner", "\u0110\xE2y kh\xF4ng ph\u1EA3i b\xE1o gi\xE1 c\u1EE7a b\u1EA1n.");
}
async function requireSignature(ctx) {
  const row = must(await ctx.db.from("quote_signature").select("id").eq("id", 1).maybeSingle(), "load signature");
  if (!row) throw new ApiError(409, "no_signature", "Ch\u01B0a c\xF3 ch\u1EEF k\xFD m\u1EABu c\u1EE7a CEO. CEO t\u1EA3i ho\u1EB7c v\u1EBD ch\u1EEF k\xFD \u1EDF trang H\u1ED3 s\u01A1 r\u1ED3i k\xFD l\u1EA1i.");
}
async function setSignature(ctx, user, body) {
  requireRole(user, "ceo", "admin");
  const image = body.image === null ? null : String(body.image ?? "");
  if (image === null) {
    must(await ctx.db.from("quote_signature").delete().eq("id", 1), "remove signature");
  } else {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) throw new ApiError(400, "invalid", "Ch\u1EEF k\xFD ph\u1EA3i l\xE0 \u1EA3nh PNG.");
    if (image.length > 4e5) throw new ApiError(400, "too_big", "\u1EA2nh ch\u1EEF k\xFD qu\xE1 l\u1EDBn (t\u1ED1i \u0111a kho\u1EA3ng 300 KB).");
    const s = await loadSettings(ctx.db);
    must(await ctx.db.from("quote_signature").upsert({ id: 1, image, signer_name: s.signer_name || user.full_name || null, updated_by: user.id, updated_at: new Date(ctx.now()).toISOString() }), "save signature");
  }
  must(await ctx.db.from("events").insert({ actor: user.id, entity: "quote_signature", entity_id: "1", action: image ? "signature.set" : "signature.removed", payload: {} }), "log signature");
  return { ok: true };
}
async function termGate(ctx, q) {
  const lib = must(await ctx.db.from("quote_terms").select("text, choice_group"), "load terms");
  const errs = termConflictText(termConflicts(q.terms ?? [], lib));
  if (errs.length) throw new ApiError(400, "term_conflict", errs.join(" "));
}
async function transition(ctx, p) {
  const res = await ctx.db.rpc("ops_quote_transition", { p });
  if (res.error && /conflict/.test(res.error.message)) throw new ApiError(409, "conflict", "B\xE1o gi\xE1 v\u1EEBa \u0111\u01B0\u1EE3c thay \u0111\u1ED5i \u1EDF n\u01A1i kh\xE1c. T\u1EA3i l\u1EA1i trang r\u1ED3i th\u1EED l\u1EA1i.");
  return must(res, "quote transition");
}
async function readyLines(ctx, q) {
  const lines = await loadLines(ctx, q.id);
  const lib = await libraryMap(ctx, lines.map((l) => l.library_item_id));
  const errors = validateQuote({
    client: q.client,
    requestedAt: Date.parse(q.requested_at),
    now: ctx.now(),
    lines: lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price })),
    discountPct: q.discount_pct,
    vatPct: q.vat_pct
  });
  const kindOf = (l) => (l.library_item_id ? lib.get(l.library_item_id)?.kind : void 0) ?? l.kind ?? "service";
  if (q.status !== "approved") {
    const missing = linesMissingOverrideReason(
      lines.map((l) => ({ unitPrice: l.unit_price, libraryPrice: l.library_item_id ? lib.get(l.library_item_id)?.unit_price ?? null : null, overrideReason: l.override_reason, kind: kindOf(l) }))
    );
    if (missing.length) errors.push(`Ghi l\xFD do cho \u0111\u01A1n gi\xE1 kh\xE1c th\u01B0 vi\u1EC7n \u1EDF d\xF2ng ${missing.map((i) => i + 1).join(", ")}.`);
  }
  if (errors.length) throw new ApiError(400, "invalid_quote", errors.join(" "));
  const [rules, s] = await Promise.all([loadRules(ctx.db), loadSettings(ctx.db)]);
  const band = bandCheck(bandLines(lines, lib), q.discount_pct, rules);
  const totals = quoteTotals(
    lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price, kind: kindOf(l) })),
    q.discount_pct,
    { pct: q.vat_pct, onPassThrough: s.vat_on_pass_through }
  );
  return { lines, band, totals };
}
async function notifyApproval(ctx, quoteId) {
  const s = await loadSettings(ctx.db);
  if (!isWorkingTime(ctx.now(), calendarOf(s))) return false;
  const claimed = must(
    await ctx.db.from("quotes").update({ approval_notified_at: new Date(ctx.now()).toISOString() }).eq("id", quoteId).in("status", ["pending", "signing"]).is("approval_notified_at", null).select(QUOTE_COLS),
    "claim approval notice"
  );
  const q = claimed[0];
  if (!q || !q.approver) return false;
  if (q.status === "signing") {
    await ctx.notifier.sendToRoles(["ceo"], signRequestText({ code: q.code, client: q.client }), linkButton("M\u1EDF b\xE1o gi\xE1 \u0111\u1EC3 k\xFD", appLink(s, `/quotes/${q.id}`)));
    return true;
  }
  const account = (await ctx.db.from("profiles").select("full_name, email").eq("id", q.created_by).maybeSingle()).data;
  const text = approvalRequestText({
    code: q.code,
    client: q.client,
    total: Number(q.total),
    level: q.approver,
    accountName: account?.full_name || account?.email || "",
    reasons: q.band_detail?.reasons ?? []
  });
  await ctx.notifier.sendToRoles(q.kind === "project" ? ["ceo", "pm"] : [q.approver], text, linkButton(q.kind === "project" ? "M\u1EDF b\xE1o gi\xE1 \u0111\u1EC3 g\xF3p \xFD" : "M\u1EDF b\xE1o gi\xE1 \u0111\u1EC3 duy\u1EC7t", appLink(s, `/quotes/${q.id}`)));
  return true;
}
async function submitQuote(ctx, user, quoteId) {
  const q = await loadQuote(ctx, quoteId);
  own(user, q);
  await termGate(ctx, q);
  const { band, totals } = await readyLines(ctx, q);
  const t = nextQuoteStatus(q.status, "submit", band.level, q.kind);
  if (!t.ok) throw new ApiError(409, "bad_transition", t.error);
  const quote = await transition(ctx, {
    quote_id: q.id,
    expected_status: q.status,
    new_status: t.status,
    actor: user.id,
    fields: { band_result: band.level, band_detail: publicBand(band), approver: approverFor(q.kind, band.level), approval_requested: true, subtotal: totals.subtotal, total: totals.total, vat_amount: totals.vatAmount, grand_total: totals.grandTotal },
    event_action: "quote.submitted",
    event_payload: { band: band.level, total: totals.total }
  });
  await notifyApproval(ctx, q.id);
  return { quote };
}
async function reopenQuote(ctx, user, quoteId) {
  const q = await loadQuote(ctx, quoteId);
  own(user, q);
  if (q.status === "draft") return { quote: q };
  const t = nextQuoteStatus(q.status, "edit");
  if (!t.ok) throw new ApiError(409, "bad_transition", t.error);
  const quote = await transition(ctx, { quote_id: q.id, expected_status: q.status, new_status: t.status, actor: user.id, event_action: "quote.reopened" });
  return { quote };
}
async function decideQuote(ctx, user, body) {
  requireRole(user, "pm", "ceo");
  const q = await loadQuote(ctx, String(body.quote_id ?? ""));
  const signing = q.status === "signing";
  if (q.status !== "pending" && !signing) throw new ApiError(409, "not_pending", "B\xE1o gi\xE1 n\xE0y kh\xF4ng c\xF2n ch\u1EDD duy\u1EC7t.");
  if (signing ? user.role !== "ceo" : q.approver !== user.role) throw new ApiError(403, "wrong_approver", signing ? "B\xE1o gi\xE1 n\xE0y ch\u1EDD CEO k\xFD." : `B\xE1o gi\xE1 n\xE0y ch\u1EDD ${ROLE_LABEL[q.approver ?? "ceo"]} duy\u1EC7t.`);
  if (signing && body.decision === "approve") throw new ApiError(409, "use_sign", "B\xE1o gi\xE1 \u0111\xE3 duy\u1EC7t, \u0111ang ch\u1EDD CEO k\xFD.");
  const decision = body.decision === "approve" ? "approve" : body.decision === "changes" ? "changes" : null;
  if (!decision) throw new ApiError(400, "bad_decision", "Ch\u1ECDn Duy\u1EC7t ho\u1EB7c Y\xEAu c\u1EA7u s\u1EEDa.");
  const note = String(body.comment ?? "").trim();
  const open = await openThreadCount(ctx, q.id);
  if (decision === "approve") {
    const gate = approveGate(open);
    if (!gate.ok) throw new ApiError(409, "open_comments", gate.error);
  } else {
    const gate = requestChangesGate(note, open);
    if (!gate.ok) throw new ApiError(400, "comment_required", gate.error);
  }
  const comment = decision === "changes" ? changesSummary(note, open) : note;
  const ceoSigns = decision === "approve" && user.role === "ceo";
  if (ceoSigns) await requireSignature(ctx);
  const t = nextQuoteStatus(q.status, decision === "approve" ? ceoSigns ? "approve_sign" : "approve" : "request_changes");
  if (!t.ok) throw new ApiError(409, "bad_transition", t.error);
  const quote = await transition(ctx, {
    quote_id: q.id,
    expected_status: q.status,
    new_status: t.status,
    actor: user.id,
    fields: ceoSigns ? { signed_by: user.id } : {},
    approval: { level: signing ? "ceo" : q.approver, approver_id: user.id, decision, comment },
    event_action: decision === "approve" ? ceoSigns ? "quote.approved_signed" : "quote.approved" : "quote.changes_requested",
    event_payload: { comment, open_comments: open }
  });
  if (decision === "approve" && !ceoSigns) {
    must(await ctx.db.from("quotes").update({ approval_notified_at: null }).eq("id", q.id).eq("status", "signing"), "reset notice");
    await notifyApproval(ctx, q.id);
  }
  const s = await loadSettings(ctx.db);
  if (isWorkingTime(ctx.now(), calendarOf(s))) {
    await ctx.notifier.send(q.created_by, decisionText({ code: q.code, decision, approverRole: user.role, comment: comment || null }), linkButton("M\u1EDF b\xE1o gi\xE1", appLink(s, `/quotes/${q.id}`)));
  }
  return { quote };
}
async function signQuote(ctx, user, quoteId) {
  requireRole(user, "ceo");
  const q = await loadQuote(ctx, quoteId);
  const t = nextQuoteStatus(q.status, "sign");
  if (!t.ok) throw new ApiError(409, "bad_transition", t.error);
  if (await openThreadCount(ctx, q.id) > 0) throw new ApiError(409, "open_comments", "C\xF2n g\xF3p \xFD m\u1EDF: x\u1EED l\xFD xong r\u1ED3i k\xFD.");
  await requireSignature(ctx);
  const quote = await transition(ctx, {
    quote_id: q.id,
    expected_status: "signing",
    new_status: t.status,
    actor: user.id,
    fields: { signed_by: user.id },
    event_action: "quote.signed"
  });
  const s = await loadSettings(ctx.db);
  await ctx.notifier.send(q.created_by, `<b>${esc(q.code)} \u0111\xE3 \u0111\u01B0\u1EE3c CEO k\xFD</b> \xB7 c\xF3 th\u1EC3 g\u1EEDi kh\xE1ch`, linkButton("M\u1EDF b\xE1o gi\xE1", appLink(s, `/quotes/${q.id}`)));
  return { quote };
}
async function setQuoteOutcome(ctx, user, body) {
  const q = await loadQuote(ctx, String(body.quote_id ?? ""));
  const linked = must(await ctx.db.from("project_quotes").select("project_id").eq("quote_id", q.id).maybeSingle(), "quote project");
  const outcome = body.outcome === "won" || body.outcome === "lost" ? body.outcome : null;
  const lostReason = outcome === "lost" ? String(body.lost_reason ?? "") : null;
  const handoverPm = outcome === "won" ? String(body.handover_pm ?? "") || null : null;
  const errs = outcomeErrors({ status: q.status, source: q.source, createdBy: q.created_by, hasProject: !!linked }, user, { outcome, lostReason, handoverPm });
  if (handoverPm) {
    const pm = (await ctx.db.from("profiles").select("role, active").eq("id", handoverPm).maybeSingle()).data;
    if (!pm || pm.role !== "pm" || !pm.active) errs.push("Ng\u01B0\u1EDDi nh\u1EADn ph\u1EA3i l\xE0 PM \u0111ang ho\u1EA1t \u0111\u1ED9ng.");
  }
  if (errs.length) throw new ApiError(400, "invalid", errs.join(" "));
  const stamp = new Date(ctx.now()).toISOString();
  const row = must(
    await ctx.db.from("quotes").update({ outcome, outcome_at: outcome ? stamp : null, outcome_by: outcome ? user.id : null, lost_reason: lostReason, lost_note: outcome === "lost" ? String(body.lost_note ?? "").trim() || null : null, handover_pm: handoverPm }).eq("id", q.id).select("id, outcome, outcome_at, lost_reason, lost_note, handover_pm").single(),
    "save outcome"
  );
  must(await ctx.db.from("events").insert({ actor: user.id, entity: "quotes", entity_id: q.id, action: "quote.outcome", payload: { outcome, lost_reason: lostReason, handover_pm: handoverPm } }), "log outcome");
  if (outcome === "won" && handoverPm && q.outcome !== "won") {
    const s = await loadSettings(ctx.db);
    await ctx.notifier.send(handoverPm, `<b>${OUTCOME_LABEL.won} \xB7 ${esc(q.code)}</b>
Kh\xE1ch: ${esc(q.client)}
B\u1EA1n nh\u1EADn d\u1EF1 \xE1n n\xE0y: t\u1EA1o d\u1EF1 \xE1n t\u1EEB b\xE1o gi\xE1.`, linkButton("T\u1EA1o d\u1EF1 \xE1n", appLink(s, `/du-an?tu-bao-gia=${q.id}`)));
  }
  return { quote: row, lostReasonLabel: lostReason ? LOST_REASON_LABEL[lostReason] : null };
}
async function sendQuote(ctx, user, quoteId) {
  const q = await loadQuote(ctx, quoteId);
  own(user, q);
  const gate = sendGate(await openThreadCount(ctx, q.id));
  if (!gate.ok) throw new ApiError(409, "open_comments", gate.error);
  await termGate(ctx, q);
  const { band, totals } = await readyLines(ctx, q);
  const t = nextQuoteStatus(q.status, "send", q.status === "approved" ? q.band_result ?? void 0 : band.level, q.kind);
  if (!t.ok) throw new ApiError(409, "bad_transition", t.error);
  const fields = { subtotal: totals.subtotal, total: totals.total, vat_amount: totals.vatAmount, grand_total: totals.grandTotal };
  if (q.status !== "approved") Object.assign(fields, { band_result: band.level, band_detail: publicBand(band) });
  const quote = await transition(ctx, {
    quote_id: q.id,
    expected_status: q.status,
    new_status: "sent",
    actor: user.id,
    fields,
    event_action: "quote.sent",
    event_payload: { total: totals.total, grand_total: totals.grandTotal, band: q.status === "approved" ? q.band_result : band.level }
  });
  return { quote };
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
async function loadRow(ctx, id) {
  if (!id) return null;
  return must(await ctx.db.from("lark_tasks").select(WORK_COLS).eq("id", id).is("deleted_at", null).maybeSingle(), "load row");
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
async function pmOf(ctx, w, project) {
  if (project.pm_id) return personOf(ctx, w, project.pm_id);
  return { openId: project.assignee_open_id, name: project.assignee_name ?? "PM" };
}
async function addMember(ctx, projectId, m, source) {
  if (!m.profileId && !m.openId) return;
  const { error } = await ctx.db.from("project_members").insert({ project_id: projectId, profile_id: m.profileId, open_id: m.openId, name: m.name, source, status: "accepted", responded_at: (/* @__PURE__ */ new Date()).toISOString() });
  if (error && error.code !== "23505" && !/duplicate key/.test(error.message)) throw new Error(`save member: ${error.message}`);
  if (error && source === "group") {
    const q = ctx.db.from("project_members").update({ status: "accepted", decline_reason: null }).eq("project_id", projectId).neq("status", "accepted");
    await (m.profileId ? q.eq("profile_id", m.profileId) : q.eq("open_id", m.openId));
  }
}
async function inviteMember(ctx, w, project, profileId, by) {
  const p = await personOf(ctx, w, profileId);
  const stamp = new Date(ctx.now()).toISOString();
  const cur = must(await ctx.db.from("project_members").select("id, status").eq("project_id", project.id).eq("profile_id", profileId).maybeSingle(), "load member");
  if (cur?.status === "accepted" || cur?.status === "invited") return false;
  if (cur) must(await ctx.db.from("project_members").update({ status: "invited", invited_by: by.id, invited_at: stamp, responded_at: null, decline_reason: null, source: "manual" }).eq("id", cur.id), "invite again");
  else must(await ctx.db.from("project_members").insert({ project_id: project.id, profile_id: profileId, open_id: p.openId, name: p.name, source: "manual", status: "invited", invited_by: by.id, invited_at: stamp }), "invite");
  await sendWork(ctx, w, {
    kind: "invite",
    project,
    to: p,
    key: `invite|${project.id}|${profileId}|${stamp}`,
    message: inviteMessage({ ...pRef(project), dueDate: project.due_date, pmName: by.full_name || by.email, client: project.client }, p.openId, p.name, link(w, "/inbox"))
  });
  return true;
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
async function tryLark(what, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`lark ${what} failed`, e.message);
  }
}
async function createSimChat(ctx, user, body) {
  if (user.role !== "pm" && user.role !== "admin") throw new ApiError(403, "forbidden", "Ch\u1EC9 PM ho\u1EB7c Admin.");
  const w = await workEnv(ctx);
  if (w.cfg.mode !== "simulation") throw new ApiError(400, "live", "\u0110ang k\u1EBFt n\u1ED1i Lark th\u1EADt: h\xE3y th\xEAm bot v\xE0o group tr\xEAn Lark.");
  const code = normalizeProjectCode(String(body.code ?? ""));
  const title = String(body.name ?? "").trim();
  const codeErr = checkProjectCode(code);
  if (codeErr.length) throw new ApiError(400, "invalid", `Nh\u1EADp m\xE3 d\u1EF1 \xE1n h\u1EE3p l\u1EC7 tr\u01B0\u1EDBc khi t\u1EA1o group. ${codeErr.join(" ")}`);
  if (!title) throw new ApiError(400, "invalid", "Nh\u1EADp t\xEAn d\u1EF1 \xE1n tr\u01B0\u1EDBc khi t\u1EA1o group.");
  const projectId = body.project_id ? String(body.project_id) : null;
  const owner = must(await ctx.db.from("lark_tasks").select("id, name").eq("kind", "parent").eq("code", code).is("deleted_at", null).maybeSingle(), "check code");
  if (owner && owner.id !== projectId) throw new ApiError(409, "code_taken", `M\xE3 ${code} \u0111ang l\xE0 c\u1EE7a d\u1EF1 \xE1n "${owner.name}". \u0110\u1ED5i m\xE3 d\u1EF1 \xE1n tr\u01B0\u1EDBc khi t\u1EA1o group.`);
  const chats = must(await ctx.db.from("lark_chats").select("chat_id, name").eq("mode", "simulation").eq("active", true), "load chats");
  const same = chats.find((c) => chatMatchesCode(c.name, code));
  if (same) throw new ApiError(409, "chat_exists", `\u0110\xE3 c\xF3 group cho m\xE3 ${code}: "${same.name}". Ch\u1ECDn group \u0111\xF3 trong danh s\xE1ch.`);
  const row = { chat_id: `sim-chat:${crypto.randomUUID()}`, name: chatNameFor(code, title), mode: "simulation", active: true };
  must(await ctx.db.from("lark_chats").insert(row), "save chat");
  return { chat: row };
}
async function deleteSimChat(ctx, user, body) {
  if (user.role !== "pm" && user.role !== "admin") throw new ApiError(403, "forbidden", "Ch\u1EC9 PM ho\u1EB7c Admin.");
  const w = await workEnv(ctx);
  const chatId = String(body.chat_id ?? "");
  if (w.cfg.mode !== "simulation" || !chatId.startsWith("sim-chat:")) throw new ApiError(400, "live", "Group Lark th\u1EADt: gi\u1EA3i t\xE1n ho\u1EB7c xo\xE1 bot kh\u1ECFi group tr\xEAn Lark.");
  const holder = must(await ctx.db.from("lark_tasks").select("code, name").eq("kind", "parent").eq("chat_id", chatId).is("deleted_at", null).limit(1).maybeSingle(), "check chat");
  if (holder) throw new ApiError(409, "in_use", `Group \u0111ang g\u1EAFn v\u1EDBi d\u1EF1 \xE1n ${holder.code} \xB7 ${holder.name}. B\u1ECF g\u1EAFn tr\u01B0\u1EDBc khi xo\xE1.`);
  must(await ctx.db.from("lark_chats").delete().eq("chat_id", chatId), "delete chat");
  return { ok: true };
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
async function chatProblem(ctx, w, chatId, code, projectId) {
  const chat = must(await ctx.db.from("lark_chats").select("chat_id, name, mode, active").eq("chat_id", chatId).maybeSingle(), "load chat");
  if (!chat || !chat.active || chat.mode !== w.cfg.mode) return "Bot ch\u01B0a \u1EDF trong group n\xE0y. Th\xEAm bot v\xE0o group tr\xEAn Lark r\u1ED3i t\u1EA3i l\u1EA1i danh s\xE1ch.";
  const others = must(await ctx.db.from("lark_tasks").select("id, code, name, chat_id, state").eq("kind", "parent").is("deleted_at", null), "load projects");
  const holder = others.find((p) => p.id !== projectId && p.chat_id === chat.chat_id && p.state !== "cancelled");
  if (holder) return `Group "${chat.name}" \u0111ang g\u1EAFn v\u1EDBi d\u1EF1 \xE1n ${holder.code} \xB7 ${holder.name}.`;
  const clash = chatCodeConflict(chat.name, code, others.filter((p) => p.id !== projectId).map((p) => p.code));
  if (clash) return `T\xEAn group "${chat.name}" mang m\xE3 ${clash} c\u1EE7a d\u1EF1 \xE1n kh\xE1c. Ch\u1ECDn group c\xF3 m\xE3 ${normalizeProjectCode(code)}.`;
  return null;
}
async function bindChat(ctx, w, project, chatId) {
  const problem = await chatProblem(ctx, w, chatId, project.code ?? "", project.id);
  if (problem) throw new ApiError(400, "invalid", problem);
  const chat = must(await ctx.db.from("lark_chats").select("chat_id, name").eq("chat_id", chatId).single(), "load chat");
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
  if (body.chat_id) {
    const problem = await chatProblem(ctx, w, String(body.chat_id), String(body.code ?? ""), null);
    if (problem) errors.push(problem);
  }
  const fromQuote = body.quote_id ? await quoteForLink(ctx, String(body.quote_id), user) : null;
  if (fromQuote?.errors.length) errors.push(...fromQuote.errors);
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
  let out = row;
  if (body.chat_id) out = await bindChat(ctx, w, row, String(body.chat_id));
  else await warnBotMissing(ctx, w, row);
  for (const id of Array.isArray(body.member_ids) ? body.member_ids.map(String) : []) await inviteMember(ctx, w, out, id, user);
  if (fromQuote) await saveQuoteLink(ctx, out.id, fromQuote.id, user);
  return { project: out };
}
async function quoteForLink(ctx, quoteId, user) {
  const q = must(await ctx.db.from("quotes").select("id, code, outcome, source, handover_pm").eq("id", quoteId).maybeSingle(), "load quote");
  if (!q) throw new ApiError(404, "quote_not_found", "Kh\xF4ng t\xECm th\u1EA5y b\xE1o gi\xE1.");
  const linked = must(await ctx.db.from("project_quotes").select("project_id").eq("quote_id", q.id).maybeSingle(), "quote link");
  return { id: q.id, code: q.code, errors: quoteLinkErrors({ outcome: q.outcome, source: q.source, handoverPm: q.handover_pm, linked: !!linked }, user) };
}
async function saveQuoteLink(ctx, projectId, quoteId, user) {
  const res = await ctx.db.from("project_quotes").insert({ project_id: projectId, quote_id: quoteId, linked_by: user.id });
  if (res.error && /duplicate|unique/i.test(res.error.message)) throw new ApiError(409, "linked", "B\xE1o gi\xE1 n\xE0y \u0111\xE3 thu\u1ED9c m\u1ED9t d\u1EF1 \xE1n.");
  must(res, "link quote");
}
async function linkQuote(ctx, user, body) {
  const project = await loadRow(ctx, String(body.project_id ?? ""));
  if (!project || project.kind !== "parent") throw new ApiError(404, "not_found", "Kh\xF4ng t\xECm th\u1EA5y d\u1EF1 \xE1n.");
  requireProjectPm(user, project);
  if (project.state !== "active") throw new ApiError(409, "closed", "D\u1EF1 \xE1n \u0111\xE3 \u0111\xF3ng.");
  const q = await quoteForLink(ctx, String(body.quote_id ?? ""), user);
  if (q.errors.length) throw new ApiError(400, "invalid", q.errors.join(" "));
  await saveQuoteLink(ctx, project.id, q.id, user);
  return { ok: true, quote: q.code };
}
async function updateProject(ctx, user, body) {
  const w = await workEnv(ctx);
  const project = await loadRow(ctx, String(body.project_id ?? ""));
  if (!project || project.kind !== "parent") throw new ApiError(404, "not_found", "Kh\xF4ng t\xECm th\u1EA5y d\u1EF1 \xE1n.");
  requireProjectPm(user, project);
  const patch = {};
  for (const k of ["name", "client", "description", "color"]) if (body[k] !== void 0) patch[k] = String(body[k]).trim() || (k === "name" ? project.name : null);
  if (body.due_date !== void 0 && body.due_date !== project.due_date) {
    const to = String(body.due_date);
    const reason = String(body.reason ?? "");
    const kids = must(await ctx.db.from("lark_tasks").select("code, due_date, state").eq("parent_id", project.id).is("deleted_at", null), "load tasks");
    const after = kids.filter((k) => (k.state === "doing" || k.state === "changes" || k.state === "review") && k.due_date > to);
    const errs = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) errs.push("Deadline kh\xF4ng h\u1EE3p l\u1EC7.");
    else if (to <= project.start_date) errs.push("Deadline d\u1EF1 \xE1n ph\u1EA3i sau ng\xE0y b\u1EAFt \u0111\u1EA7u.");
    if (reason !== "scope" && reason !== "quality") errs.push("Ch\u1ECDn l\xFD do \u0111\u1ED5i deadline.");
    if (after.length) errs.push(`C\xE1c task ${after.map((a) => a.code).join(", ")} c\xF3 deadline sau ng\xE0y m\u1EDBi: \u0111\u1ED5i deadline c\xE1c task \u0111\xF3 tr\u01B0\u1EDBc.`);
    if (errs.length) throw new ApiError(400, "invalid", errs.join(" "));
    patch.due_date = to;
    patch.kpi_due_date = reason === "scope" ? to : project.kpi_due_date;
    must(await ctx.db.from("task_extensions").insert({ task_id: project.id, from_date: project.due_date, to_date: to, reason, note: String(body.note ?? "") || null, created_by: user.id }), "save extension");
    if (project.lark_guid && w.api) await tryLark("project due", () => w.api.patchTask(project.lark_guid, { due: dueToLark(to) }, ["due"]));
  }
  if (body.name !== void 0 && project.lark_guid && w.api) await tryLark("project title", () => w.api.patchTask(project.lark_guid, { summary: projectTitle(project.code, String(body.name)) }, ["summary"]));
  const row = Object.keys(patch).length ? must(await ctx.db.from("lark_tasks").update(patch).eq("id", project.id).select(WORK_COLS).single(), "save project") : project;
  if (body.chat_id && body.chat_id !== project.chat_id) return { project: await bindChat(ctx, w, row, String(body.chat_id)) };
  return { project: row };
}

// tools/selftest/quote-selftest.ts
Deno.serve(async (req) => {
  const env = readEnv((k) => Deno.env.get(k));
  const db = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });
  const secret = await db.rpc("ops_cron_secret");
  if (!secret.data || req.headers.get("x-cron-secret") !== secret.data) return new Response("unauthorized", { status: 401 });
  const sent = [];
  const notifier = {
    send: async (to, text) => void sent.push({ to, text }),
    sendToRoles: async (roles, text) => (sent.push({ to: roles.join(","), text }), 1)
  };
  const nowVn = new Date(Date.now() + 7 * 36e5);
  const clock = Date.UTC(nowVn.getUTCFullYear(), nowVn.getUTCMonth(), nowVn.getUTCDate(), 8, 0);
  const ctx = { env, db, tg: null, notifier, now: () => clock };
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
  const status = async (id) => (await db.from("quotes").select("status, approver, signed_at, sent_at, outcome, handover_pm, kind").eq("id", id).single()).data;
  let hadSig = true;
  try {
    const profiles = (await db.from("profiles").select("id, email, full_name, role, active, telegram_chat_id, tg_state").eq("active", true)).data ?? [];
    const account = profiles.find((p2) => p2.role === "account" && p2.email.startsWith("long.nguyen230608@")) ?? profiles.find((p2) => p2.role === "account");
    const account2 = profiles.find((p2) => p2.role === "account" && p2.id !== account?.id);
    const pm = profiles.find((p2) => p2.role === "pm" && p2.email.includes("+pm@")) ?? profiles.find((p2) => p2.role === "pm");
    const pm2 = profiles.find((p2) => p2.role === "pm" && p2.id !== pm?.id);
    const ceo = profiles.find((p2) => p2.role === "ceo");
    if (!account || !pm || !ceo) throw new Error("need active account, pm, ceo");
    const lib = (await db.from("library_items").select("id, name, unit, unit_price, kind").eq("active", true).eq("kind", "service").order("unit_price").limit(2)).data ?? [];
    if (lib.length < 2) throw new Error("need 2 active library items");
    const terms = (await db.from("quote_terms").select("text, choice_group").eq("active", true)).data ?? [];
    const pay = terms.filter((t) => t.choice_group);
    ok("payment terms grouped", pay.length >= 2, pay.map((t) => t.text.slice(0, 20)));
    hadSig = (await db.from("quote_signature").select("id").eq("id", 1).maybeSingle()).data !== null;
    const tmpSig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const makeQuote = async (code, kind, discount = 0) => {
      const q = (await db.from("quotes").insert({ code, client: "ZZ Selftest", project: "D\u1EF1 \xE1n selftest", venue: "\u0110\xE0 N\u1EB5ng", contact: "Ch\u1ECB A", requested_at: new Date(clock - 36e5).toISOString(), created_by: account.id, kind, discount_pct: discount }).select("id, terms").single()).data;
      await db.from("quote_lines").insert(lib.map((l, i) => ({ quote_id: q.id, position: i + 1, library_item_id: l.id, item_name: l.name, unit: l.unit, qty: 1, unit_price: l.unit_price, library_price: l.unit_price })));
      return q;
    };
    const p = await makeQuote("ZZ-TEST-01", "project");
    ok("default terms: one payment schedule", (p.terms ?? []).filter((t) => pay.some((x) => x.text === t)).length === 1, p.terms);
    await db.from("quotes").update({ terms: [...p.terms ?? [], ...pay.map((t) => t.text)] }).eq("id", p.id);
    await fails("two payment terms block submitting", () => submitQuote(ctx, account, p.id), /chỉ chọn 1/);
    await db.from("quotes").update({ terms: p.terms }).eq("id", p.id);
    await fails("project quote cannot be sent from draft", () => sendQuote(ctx, account, p.id), /duyệt và CEO ký/);
    await submitQuote(ctx, account, p.id);
    let s = await status(p.id);
    ok("project quote \u2192 pending, CEO decides (even inside the band)", s.status === "pending" && s.approver === "ceo", s);
    ok("PMs and CEO notified to comment/decide", sent.some((m) => m.to === "ceo,pm"));
    await fails("PM cannot approve a project quote", () => decideQuote(ctx, pm, { quote_id: p.id, decision: "approve" }), /chờ CEO/);
    if (!hadSig) await fails("CEO cannot approve-and-sign without a signature image", () => decideQuote(ctx, ceo, { quote_id: p.id, decision: "approve" }), /chữ ký mẫu/);
    await fails("Account cannot store the signature", () => setSignature(ctx, account, { image: tmpSig }), /quyền/);
    if (!hadSig) await setSignature(ctx, ceo, { image: tmpSig });
    await decideQuote(ctx, ceo, { quote_id: p.id, decision: "changes", comment: "S\u1EEDa t\xEAn d\u1EF1 \xE1n" });
    s = await status(p.id);
    ok("CEO can send it back", s.status === "changes_requested", s);
    await reopenQuote(ctx, account, p.id);
    await submitQuote(ctx, account, p.id);
    await decideQuote(ctx, ceo, { quote_id: p.id, decision: "approve" });
    s = await status(p.id);
    ok("CEO Duy\u1EC7t & k\xFD \u2192 approved and signed in one step", s.status === "approved" && !!s.signed_at, s);
    await sendQuote(ctx, account, p.id);
    s = await status(p.id);
    ok("Account sends after signing", s.status === "sent" && !!s.sent_at, s);
    if (account2) await fails("another Account cannot record the answer", () => setQuoteOutcome(ctx, account2, { quote_id: p.id, outcome: "won", handover_pm: pm.id }), /Chỉ Account/);
    await fails("won needs a PM", () => setQuoteOutcome(ctx, account, { quote_id: p.id, outcome: "won" }), /Chọn PM/);
    await fails("lost needs a reason", () => setQuoteOutcome(ctx, account, { quote_id: p.id, outcome: "lost" }), /lý do/);
    await setQuoteOutcome(ctx, account, { quote_id: p.id, outcome: "lost", lost_reason: "price", lost_note: "th\u1EED" });
    s = await status(p.id);
    ok("lost saved", s.outcome === "lost", s);
    await setQuoteOutcome(ctx, account, { quote_id: p.id, outcome: "won", handover_pm: pm.id });
    s = await status(p.id);
    ok("changed to won, PM set", s.outcome === "won" && s.handover_pm === pm.id, s);
    ok("PM notified with a link to create the project", sent.some((m) => m.to === pm.id && /tạo dự án/.test(m.text)));
    const today = localDateKey(Date.now(), "Asia/Ho_Chi_Minh");
    if (pm2) await fails("another PM cannot take this quote", () => createProject(ctx, pm2, { code: "ZZ8", name: "x", due_date: shiftKey(today, 20), quote_id: p.id }), /PM khác/);
    await fails("Account cannot create a project", () => createProject(ctx, account, { code: "ZZ8", name: "x", due_date: shiftKey(today, 20), quote_id: p.id }), /Chỉ PM/);
    const { project } = await createProject(ctx, pm, { code: "ZZ8", name: "D\u1EF1 \xE1n selftest", client: "ZZ Selftest", start_date: today, due_date: shiftKey(today, 20), quote_id: p.id });
    const link2 = (await db.from("project_quotes").select("project_id").eq("quote_id", p.id).maybeSingle()).data;
    ok("project created and linked to the quote", link2?.project_id === project.id, link2);
    await fails("answer locked once a project exists", () => setQuoteOutcome(ctx, account, { quote_id: p.id, outcome: "lost", lost_reason: "price" }), /đã có dự án/);
    await fails("a quote belongs to one project", () => linkQuote(ctx, pm, { project_id: project.id, quote_id: p.id }), /đã thuộc/);
    const mt = (await db.from("lark_tasks").select("id, code").eq("kind", "parent").eq("code", "MT35").maybeSingle()).data;
    if (mt) await fails("cannot create a group for a code owned by another project", () => createSimChat(ctx, pm, { code: "MT35", name: "LOLO" }), /đang là của dự án/);
    const g = await createSimChat(ctx, pm, { code: "ZZ9", name: "  Th\u1EED   group " });
    ok('group name is standard "CODE - Name"', g.chat.name === "ZZ9 - Th\u1EED group", g.chat.name);
    await fails("one group per code", () => createSimChat(ctx, pm, { code: "ZZ9", name: "kh\xE1c" }), /Đã có group/);
    if (mt) {
      const clashing = (await db.from("lark_chats").insert({ chat_id: `sim-chat:${crypto.randomUUID()}`, name: "MT35 ZZ selftest", mode: "simulation", active: true }).select("chat_id").single()).data;
      await fails("cannot bind a group named with another project's code", () => updateProject(ctx, pm, { project_id: project.id, chat_id: clashing.chat_id }), /mã MT35 của dự án khác/);
      await deleteSimChat(ctx, pm, { chat_id: clashing.chat_id });
      ok("unused mistaken group deleted", !(await db.from("lark_chats").select("chat_id").eq("chat_id", clashing.chat_id).maybeSingle()).data);
      const mtChat = (await db.from("lark_tasks").select("chat_id").eq("id", mt.id).single()).data;
      if (mtChat.chat_id) {
        await fails("cannot delete a group a project uses", () => deleteSimChat(ctx, pm, { chat_id: mtChat.chat_id }), /đang gắn/);
        await fails("cannot take a group another project uses", () => updateProject(ctx, pm, { project_id: project.id, chat_id: mtChat.chat_id }), /đang gắn với dự án MT35/);
      }
    }
    await deleteSimChat(ctx, pm, { chat_id: g.chat.chat_id });
    const fast = await makeQuote("ZZ-TEST-02", "quick");
    await sendQuote(ctx, account, fast.id);
    s = await status(fast.id);
    ok("quick quote inside the band goes out without signing", s.status === "sent" && !s.signed_at, s);
    await fails("cannot attach a quote that is not won", () => linkQuote(ctx, pm, { project_id: project.id, quote_id: fast.id }), /đã chốt/);
    await setQuoteOutcome(ctx, account, { quote_id: fast.id, outcome: "won", handover_pm: pm.id });
    await linkQuote(ctx, pm, { project_id: project.id, quote_id: fast.id });
    ok("second quote attached to the same project", ((await db.from("project_quotes").select("quote_id").eq("project_id", project.id)).data ?? []).length === 2);
    const rules = (await db.from("price_rules").select("*").limit(1).single()).data;
    const pmDiscount = Math.min(99, Number(rules.max_discount_pct ?? 10) + 1);
    const off = await makeQuote("ZZ-TEST-03", "quick", pmDiscount);
    ok("price rules loaded", true, { pmDiscount, rules });
    await fails("quick quote outside the band cannot be sent directly", () => sendQuote(ctx, account, off.id), /duyệt/);
    await submitQuote(ctx, account, off.id);
    s = await status(off.id);
    ok("outside the band \u2192 pending with a PM or CEO approver", s.status === "pending" && (s.approver === "pm" || s.approver === "ceo"), s);
    const approver = s.approver === "pm" ? pm : ceo;
    if (approver.role === "ceo") {
      await decideQuote(ctx, ceo, { quote_id: off.id, decision: "approve" });
      ok("CEO-level quick quote: approved and signed at once", (await status(off.id)).status === "approved");
    } else {
      await decideQuote(ctx, approver, { quote_id: off.id, decision: "approve" });
      ok("PM approve \u2192 Ch\u1EDD CEO k\xFD", (await status(off.id)).status === "signing");
      ok("CEO asked to sign", sent.some((m) => m.to === "ceo" && /chờ CEO ký/i.test(m.text)), sent.map((m) => m.to));
      await fails("cannot send while waiting for the signature", () => sendQuote(ctx, account, off.id), /chờ CEO ký/);
      await fails("PM cannot sign", () => signQuote(ctx, pm, off.id), /./);
      await signQuote(ctx, ceo, off.id);
    }
    await sendQuote(ctx, account, off.id);
    ok("signed quick quote sent", (await status(off.id)).status === "sent");
  } catch (e) {
    log.push({ step: "exception", ok: false, detail: `${e.message}
${e.stack}` });
  } finally {
    if (!hadSig) await db.from("quote_signature").delete().eq("id", 1);
    await db.from("lark_chats").delete().like("name", "ZZ9 %");
    await db.from("lark_chats").delete().eq("name", "MT35 ZZ selftest");
    const zz = ((await db.from("lark_tasks").select("id").like("code", "ZZ8%")).data ?? []).map((r) => r.id);
    if (zz.length) await db.from("bot_messages").delete().in("project_id", zz);
    await db.from("lark_tasks").delete().like("code", "ZZ8%");
    const ids = ((await db.from("quotes").select("id").like("code", "ZZ-TEST-%")).data ?? []).map((r) => r.id);
    if (ids.length) {
      await db.from("approvals").delete().in("quote_id", ids);
      await db.from("quote_comments").delete().in("quote_id", ids);
      await db.from("quotes").delete().in("id", ids);
    }
    const left = ((await db.from("quotes").select("id").like("code", "ZZ-TEST-%")).data ?? []).length + ((await db.from("lark_tasks").select("id").like("code", "ZZ8%")).data ?? []).length;
    log.push({ step: "cleanup", ok: left === 0, detail: { left } });
  }
  const failed = log.filter((l) => !l.ok);
  return new Response(JSON.stringify({ passed: log.length - failed.length, failed: failed.length, log }, null, 1), { headers: { "content-type": "application/json" } });
});
