// @ts-nocheck
// Go Media Ops Hub · Edge Function "ops-hub" · app 1.0.0 · domain bdfc368f76
// GENERATED FILE: paste the whole file into Supabase → Edge Functions → ops-hub → index.ts.
// Source code: supabase/functions/ops-hub and src/domain in the repository. Do not edit here.
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

// supabase/functions/ops-hub/handler.ts
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

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
  const ms2 = t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t);
  if (!Number.isFinite(ms2)) throw new Error(`Invalid date: ${String(t)}`);
  return ms2;
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
function parseLocalDateTime(input, timeZone) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && /\d{4}-\d{2}-\d{2}T/.test(s)) {
    const ms2 = Date.parse(s);
    return Number.isFinite(ms2) ? ms2 : null;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  let y, mo, d, h = 0, mi = 0;
  if (m) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
    if (m[4] !== void 0) {
      h = +m[4];
      mi = +m[5];
    }
  } else {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return null;
    d = +m[1];
    mo = +m[2];
    y = +m[3];
    if (m[4] !== void 0) {
      h = +m[4];
      mi = +m[5];
    }
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  return localToMs(y, mo, d, h, mi, timeZone);
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
var HOUR = 36e5;
var MAX_DAYS = 3700;
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
function workingMsBetween(start, end, cal = DEFAULT_CALENDAR) {
  const a = toMs(start);
  const b = toMs(end);
  if (!(b > a)) return 0;
  const p = prepare(cal);
  let { year, month, day } = toLocalParts(a, p.tz);
  let total = 0;
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [s, e] of dayIntervals(year, month, day, p)) {
      const lo = Math.max(s, a);
      const hi = Math.min(e, b);
      if (hi > lo) total += hi - lo;
    }
    const next = addDays(year, month, day, 1);
    if (localToMs(next.year, next.month, next.day, 0, 0, p.tz) >= b) break;
    ({ year, month, day } = next);
  }
  return total;
}
function workingHoursBetween(start, end, cal = DEFAULT_CALENDAR) {
  return workingMsBetween(start, end, cal) / HOUR;
}
function addWorkingMs(start, ms2, cal = DEFAULT_CALENDAR) {
  if (!(ms2 >= 0)) throw new Error("Working time to add must be zero or more");
  const a = toMs(start);
  const p = prepare(cal);
  let remaining = ms2;
  let { year, month, day } = toLocalParts(a, p.tz);
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [s, e] of dayIntervals(year, month, day, p)) {
      if (e <= a) continue;
      const from = Math.max(s, a);
      const available = e - from;
      if (remaining <= available) return from + remaining;
      remaining -= available;
    }
    ({ year, month, day } = addDays(year, month, day, 1));
  }
  throw new Error("No working time found in the calendar");
}
function addWorkingHours(start, hours2, cal = DEFAULT_CALENDAR) {
  return new Date(addWorkingMs(start, Math.round(hours2 * HOUR), cal));
}
function isWorkingTime(t, cal = DEFAULT_CALENDAR) {
  const ms2 = toMs(t);
  const p = prepare(cal);
  const { year, month, day } = toLocalParts(ms2, p.tz);
  return dayIntervals(year, month, day, p).some(([s, e]) => ms2 >= s && ms2 <= e);
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
function nextQuoteStatus(status, event, band) {
  const fail2 = (error) => ({ ok: false, error });
  switch (event) {
    case "edit":
      if (status === "sent") return fail2("B\xE1o gi\xE1 \u0111\xE3 g\u1EEDi kh\xF4ng s\u1EEDa \u0111\u01B0\u1EE3c. H\xE3y t\u1EA1o b\xE1o gi\xE1 m\u1EDBi (c\xF3 th\u1EC3 ch\xE9p h\u1EA1ng m\u1EE5c).");
      return { ok: true, status: "draft" };
    case "submit":
      if (status !== "draft") return fail2("Ch\u1EC9 g\u1EEDi duy\u1EC7t \u0111\u01B0\u1EE3c b\xE1o gi\xE1 \u0111ang \u1EDF tr\u1EA1ng th\xE1i Nh\xE1p.");
      if (!band) return fail2("Ch\u01B0a c\xF3 k\u1EBFt qu\u1EA3 ki\u1EC3m tra khung gi\xE1.");
      if (band === "send_now") return fail2("B\xE1o gi\xE1 n\u1EB1m trong khung gi\xE1, c\xF3 th\u1EC3 g\u1EEDi ngay, kh\xF4ng c\u1EA7n duy\u1EC7t.");
      return { ok: true, status: "pending" };
    case "approve":
      if (status !== "pending") return fail2("Ch\u1EC9 duy\u1EC7t \u0111\u01B0\u1EE3c b\xE1o gi\xE1 \u0111ang ch\u1EDD duy\u1EC7t.");
      return { ok: true, status: "approved" };
    case "request_changes":
      if (status !== "pending") return fail2("Ch\u1EC9 y\xEAu c\u1EA7u s\u1EEDa \u0111\u01B0\u1EE3c b\xE1o gi\xE1 \u0111ang ch\u1EDD duy\u1EC7t.");
      return { ok: true, status: "changes_requested" };
    case "send":
      if (status === "approved") return { ok: true, status: "sent" };
      if (status === "draft" && band === "send_now") return { ok: true, status: "sent" };
      if (status === "draft") return fail2("B\xE1o gi\xE1 ngo\xE0i khung gi\xE1 ph\u1EA3i \u0111\u01B0\u1EE3c duy\u1EC7t tr\u01B0\u1EDBc khi g\u1EEDi.");
      return fail2("B\xE1o gi\xE1 \u1EDF tr\u1EA1ng th\xE1i n\xE0y ch\u01B0a g\u1EEDi \u0111\u01B0\u1EE3c.");
  }
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
var COMMENT_ANCHORS = ["general", "client", "line", "section", "totals", "terms"];
var ANCHOR_LABEL = {
  general: "C\u1EA3 b\xE1o gi\xE1",
  client: "Th\xF4ng tin kh\xE1ch h\xE0ng",
  totals: "Chi\u1EBFt kh\u1EA5u, thu\u1EBF v\xE0 t\u1ED5ng ti\u1EC1n",
  terms: "\u0110i\u1EC1u kho\u1EA3n v\xE0 ghi ch\xFA"
};
var COMMENT_MAX_LENGTH = 2e3;
function canComment(role, isOwner, status) {
  if (status === "sent") return false;
  return role === "pm" || role === "ceo" || role === "account" && isOwner;
}
function anchorLabel(a) {
  if (a.anchor === "line") return `D\xF2ng ${a.position ?? "?"} \xB7 ${(a.itemName ?? "").trim() || "H\u1EA1ng m\u1EE5c"}`;
  if (a.anchor === "section") return `Ph\u1EA7n \xB7 ${(a.sectionTitle ?? "").trim() || "H\u1EA1ng m\u1EE5c d\u1ECBch v\u1EE5"}`;
  return ANCHOR_LABEL[a.anchor];
}
function validateCommentBody(body) {
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return { ok: false, error: "H\xE3y vi\u1EBFt n\u1ED9i dung g\xF3p \xFD." };
  if (text.length > COMMENT_MAX_LENGTH) return { ok: false, error: `G\xF3p \xFD d\xE0i t\u1ED1i \u0111a ${COMMENT_MAX_LENGTH} k\xFD t\u1EF1.` };
  return { ok: true, body: text };
}
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

// src/domain/tasks.ts
var CHECKPOINT_PCTS = [25, 50, 75, 99];
var TASK_STATUS_LABEL = {
  not_started: "Ch\u01B0a b\u1EAFt \u0111\u1EA7u",
  on_track: "\u0110\xFAng k\u1EBF ho\u1EA1ch",
  at_risk: "C\xF3 r\u1EE7i ro",
  blocked: "B\u1ECB ch\u1EB7n",
  no_update: "Kh\xF4ng c\u1EADp nh\u1EADt",
  done: "Ho\xE0n th\xE0nh",
  overdue: "Tr\u1EC5 h\u1EA1n",
  cancelled: "\u0110\xE3 hu\u1EF7"
};
var ANSWER_LABEL = {
  on_plan: "\u0110\xFAng k\u1EBF ho\u1EA1ch",
  behind: "Ch\u1EADm h\u01A1n k\u1EBF ho\u1EA1ch",
  blocked: "B\u1ECB ch\u1EB7n"
};
var ALERT_LABEL = {
  at_risk: "C\xF3 r\u1EE7i ro",
  blocker: "B\u1ECB ch\u1EB7n",
  no_reply: "Kh\xF4ng tr\u1EA3 l\u1EDDi",
  overdue: "Tr\u1EC5 h\u1EA1n"
};
function checkpointIndex(pct2) {
  const i = CHECKPOINT_PCTS.indexOf(pct2);
  if (i < 0) throw new Error(`Unknown checkpoint ${pct2}%`);
  return i + 1;
}
function checkpointTimes(start, due, cal) {
  const a = toMs(start);
  const b = toMs(due);
  if (!(b > a)) throw new Error("Deadline must be after the start");
  const totalMin = workingMsBetween(a, b, cal) / 6e4;
  if (!(totalMin >= 1)) throw new Error("The task has no working time between start and deadline");
  return CHECKPOINT_PCTS.map((pct2) => new Date(addWorkingMs(a, Math.round(totalMin * pct2 / 100) * 6e4, cal)));
}
function validateTaskDraft(t, cal) {
  const errors = [];
  if (!t.name.trim()) errors.push("Nh\u1EADp t\xEAn task.");
  if (!t.ownerId) errors.push("Ch\u1ECDn ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch.");
  if (t.startAt === null) errors.push("Nh\u1EADp th\u1EDDi \u0111i\u1EC3m b\u1EAFt \u0111\u1EA7u.");
  if (t.dueAt === null) errors.push("Nh\u1EADp deadline.");
  if (t.startAt !== null && t.dueAt !== null) {
    if (t.dueAt <= t.startAt) errors.push("Deadline ph\u1EA3i sau th\u1EDDi \u0111i\u1EC3m b\u1EAFt \u0111\u1EA7u.");
    else if (workingMsBetween(t.startAt, t.dueAt, cal) < 6e4) errors.push("T\u1EEB l\xFAc b\u1EAFt \u0111\u1EA7u \u0111\u1EBFn deadline kh\xF4ng c\xF3 gi\u1EDD l\xE0m vi\u1EC7c n\xE0o.");
  }
  if (t.dueAt !== null && t.now !== void 0 && t.dueAt <= t.now) errors.push("Deadline \u0111\xE3 qua: task n\xE0y kh\xF4ng \u0111\u01B0a v\xE0o theo d\xF5i \u0111\u01B0\u1EE3c (s\u1EBD b\u1ECB t\xEDnh tr\u1EC5 h\u1EA1n ngay).");
  if (t.milestones.length !== 4 || t.milestones.some((m) => !m.trim())) errors.push("C\u1EA7n \u0111\u1EE7 4 m\u1ED1c ki\u1EC3m ch\u1EE9ng, m\u1ED7i m\u1ED1c c\xF3 n\u1ED9i dung.");
  return errors;
}
function answerEffect(task, checkpoint, answer, reason) {
  if (task.status === "cancelled" || task.status === "overdue") throw new Error("Task is closed");
  const done = Math.max(0, Math.min(4, task.doneCount));
  if (answer === "on_plan") {
    if (checkpoint === null) throw new Error("On plan needs a checkpoint");
    const newDone = Math.max(done, checkpoint);
    const markDone = [];
    for (let i = done + 1; i <= newDone; i++) markDone.push(i);
    return { doneCount: newDone, status: newDone >= 4 ? "done" : "on_track", markDone, alert: null };
  }
  if (answer === "behind") {
    if (checkpoint === null) throw new Error("Behind needs a checkpoint");
    return { doneCount: done, status: "at_risk", markDone: [], alert: { kind: "at_risk", reason: null } };
  }
  const why = (reason ?? "").trim();
  if (!why) throw new Error("A blocker needs a reason");
  return { doneCount: done, status: "blocked", markDone: [], alert: { kind: "blocker", reason: why } };
}
function isTaskOpen(t, now) {
  return t.closedAs === null && t.status !== "cancelled" && t.status !== "overdue" && now < t.dueAt;
}
function noReplyDue(cp, now, windowHours, cal) {
  if (cp.sentAt === null || cp.answeredAt !== null || cp.noReplyAlertedAt !== null) return false;
  return workingMsBetween(cp.sentAt, now, cal) >= windowHours * 36e5 - 1;
}
function planDispatch(input) {
  const now = toMs(input.now);
  const canSend = isWorkingTime(now, input.cal);
  const byTask = /* @__PURE__ */ new Map();
  for (const cp of input.checkpoints) {
    const list = byTask.get(cp.taskId) ?? [];
    list.push(cp);
    byTask.set(cp.taskId, list);
  }
  const plan2 = { send: [], expire: [], noReply: [], canSend };
  for (const task of input.tasks) {
    const cps = (byTask.get(task.id) ?? []).sort((a, b) => a.pct - b.pct);
    const open = isTaskOpen(task, now);
    if (!open || task.status === "done") {
      for (const cp of cps) if (cp.sentAt === null && cp.expiredAt === null) plan2.expire.push(cp);
      continue;
    }
    for (const cp of cps) if (noReplyDue(cp, now, input.noReplyWindowHours, input.cal)) plan2.noReply.push(cp);
    if (!canSend) continue;
    const due = cps.filter((cp) => cp.sentAt === null && cp.expiredAt === null && cp.scheduledAt <= now);
    if (!due.length) continue;
    const latest = due[due.length - 1];
    plan2.send.push(latest);
    for (const cp of cps) {
      if (cp === latest || cp.expiredAt !== null || cp.answeredAt !== null) continue;
      if (cp.pct < latest.pct) plan2.expire.push(cp);
    }
  }
  return plan2;
}
function closeOutcome(milestoneDoneAt, dueAt) {
  const doneInTime = milestoneDoneAt.filter((t) => t !== null && t <= dueAt).length;
  return milestoneDoneAt.length >= 4 && doneInTime >= 4 ? "on_time" : "overdue";
}
function tasksToClose(tasks, now) {
  const t = toMs(now);
  return tasks.filter((task) => task.closedAs === null && task.status !== "cancelled" && task.dueAt <= t);
}
function statusAfterSilence(status) {
  return status === "blocked" || status === "done" || status === "overdue" || status === "cancelled" ? status : "no_update";
}

// src/domain/lark.ts
var DEFAULT_LARK_CODE_RULES = {
  parentPattern: "^[A-Z]{2}\\d{3}$",
  childPattern: "^{PARENT}-\\d{2}-S\\d{2}$",
  parentExample: "DA056",
  childExample: "DA056-04-S44"
};
var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var stripAnchors = (p) => p.replace(/^\^/, "").replace(/\$$/, "");
function normalizeCode(raw) {
  return String(raw ?? "").normalize("NFC").trim().toUpperCase().replace(/\s*[‐-―−]\s*/g, "-").replace(/\s*-\s*/g, "-");
}
function compile(pattern, flags = "") {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}
function validateCodeRules(r) {
  const out = [];
  if (!compile(r.parentPattern)) out.push("M\u1EABu m\xE3 task m\u1EB9 kh\xF4ng ph\u1EA3i bi\u1EC3u th\u1EE9c h\u1EE3p l\u1EC7.");
  if (!r.childPattern.includes("{PARENT}")) out.push("M\u1EABu m\xE3 task con ph\u1EA3i ch\u1EE9a {PARENT} \u0111\u1EC3 ki\u1EC3m tra li\xEAn k\u1EBFt v\u1EDBi task m\u1EB9.");
  if (!compile(r.childPattern.replace("{PARENT}", "X"))) out.push("M\u1EABu m\xE3 task con kh\xF4ng ph\u1EA3i bi\u1EC3u th\u1EE9c h\u1EE3p l\u1EC7.");
  if (!out.length) {
    if (checkParentCode(r.parentExample, r).length) out.push(`V\xED d\u1EE5 m\xE3 task m\u1EB9 ${r.parentExample} kh\xF4ng kh\u1EDBp m\u1EABu.`);
    else if (checkChildCode(r.childExample, r.parentExample, r).length) out.push(`V\xED d\u1EE5 m\xE3 task con ${r.childExample} kh\xF4ng kh\u1EDBp m\u1EABu.`);
  }
  return out;
}
function checkParentCode(raw, rules = DEFAULT_LARK_CODE_RULES) {
  const code = normalizeCode(raw);
  if (!code) return ["Thi\u1EBFu m\xE3 task m\u1EB9."];
  const re = compile(rules.parentPattern);
  if (!re || !re.test(code)) return [`M\xE3 task m\u1EB9 "${code}" sai format (\u0111\xFAng d\u1EA1ng: ${rules.parentExample}).`];
  return [];
}
function checkChildCode(raw, parentRaw, rules = DEFAULT_LARK_CODE_RULES) {
  const code = normalizeCode(raw);
  const parent = normalizeCode(parentRaw);
  if (!code) return ["Thi\u1EBFu m\xE3 task con."];
  const anyParent = compile(rules.childPattern.replace("{PARENT}", `(?:${stripAnchors(rules.parentPattern)})`));
  if (!anyParent || !anyParent.test(code)) return [`M\xE3 task con "${code}" sai format (\u0111\xFAng d\u1EA1ng: ${rules.childExample}).`];
  if (checkParentCode(parent, rules).length) return [`M\xE3 task m\u1EB9 "${parent || "\u2014"}" c\u1EE7a task con sai format.`];
  const own2 = compile(rules.childPattern.replace("{PARENT}", escapeRe(parent)));
  if (!own2 || !own2.test(code)) return [`M\xE3 task con "${code}" kh\xF4ng thu\u1ED9c task m\u1EB9 ${parent}.`];
  return [];
}
function parentCodeOf(childRaw, rules = DEFAULT_LARK_CODE_RULES) {
  const m = normalizeCode(childRaw).match(compile(`^(${stripAnchors(rules.parentPattern)})`) ?? /$^/);
  return m ? m[1] : null;
}
function findCodeInTitle(title, kind, rules = DEFAULT_LARK_CODE_RULES) {
  const body = kind === "parent" ? stripAnchors(rules.parentPattern) : stripAnchors(rules.childPattern.replace("{PARENT}", `(?:${stripAnchors(rules.parentPattern)})`));
  const re = compile(`(?:^|[^A-Z0-9-])(${body})(?![A-Z0-9-])`, "i");
  const m = re ? normalizeCode(title).match(re) : null;
  return m ? normalizeCode(m[1]) : null;
}
function larkTitle(kind, code, name) {
  const c = normalizeCode(code);
  const n = name.trim();
  if (normalizeCode(n).includes(c)) return n;
  return kind === "parent" ? `[${c}] ${n}` : `${n} (${c})`;
}
function stripCodeFromTitle(title, code) {
  const c = escapeRe(normalizeCode(code));
  return title.replace(new RegExp(`^\\s*\\[${c}\\]\\s*`, "i"), "").replace(new RegExp(`\\s*\\(${c}\\)\\s*$`, "i"), "").trim();
}
function daysUntil(dueDate, now, timeZone) {
  const [y, m, d] = dueDate.split("-").map(Number);
  const [ty, tm, td] = localDateKey(now, timeZone).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 864e5);
}
var DEFAULT_LARK_SCHEDULE = { notifyD0: false, before: [3, 2, 1] };
function milestoneLabel(offset) {
  return offset > 0 ? `D-${offset}` : offset === 0 ? "D0" : `D+${-offset}`;
}
function milestoneFor(offset, opts = DEFAULT_LARK_SCHEDULE) {
  if (offset > 0) return opts.before.includes(offset) ? { kind: "before", offset, label: milestoneLabel(offset) } : null;
  if (offset === 0) return opts.notifyD0 ? { kind: "due", offset, label: "D0" } : null;
  return { kind: "overdue", offset, label: milestoneLabel(offset) };
}
function parseDueDate(raw, now, timeZone) {
  const s = raw.trim();
  let y, m, d;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const vn = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (vn) {
    d = Number(vn[1]);
    m = Number(vn[2]);
    const today = localDateKey(now, timeZone);
    y = vn[3] ? Number(vn[3].length === 2 ? `20${vn[3]}` : vn[3]) : Number(today.slice(0, 4));
    if (!vn[3] && dateKey(y, m, d) < today) y += 1;
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dateKey(y, m, d);
}
function fmtDueDate(dueDate) {
  const [y, m, d] = dueDate.split("-");
  return `${d}/${m}/${y}`;
}
function completionCheck(t, rules = DEFAULT_LARK_CODE_RULES) {
  const codeErrors = [...checkParentCode(t.parentCode, rules), ...checkChildCode(t.childCode, t.parentCode, rules)];
  return { done: t.completedAt !== null && codeErrors.length === 0, codeErrors };
}
function decideLarkAction(t, now, timeZone, opts) {
  if (t.closedAt) return { type: "none", reason: "closed" };
  const check = completionCheck(t, opts.rules);
  if (check.done) return { type: "complete" };
  const ms2 = milestoneFor(daysUntil(t.dueDate, now, timeZone), opts.schedule);
  if (!ms2) return { type: "none", reason: "no_milestone" };
  if (opts.sentToday) return { type: "none", reason: "already_sent" };
  return { type: "remind", milestone: ms2, codeErrors: t.completedAt !== null ? check.codeErrors : [] };
}
var parentLine = (code, name) => normalizeCode(name).includes(normalizeCode(code)) ? name : `[${normalizeCode(code)}] ${name}`;
var childLine = (code, name) => normalizeCode(name).includes(normalizeCode(code)) ? name : `${name} (${normalizeCode(code)})`;
function reminderMessage(t, ms2, codeErrors = []) {
  const days = Math.abs(ms2.offset);
  const title = ms2.kind === "before" ? `\u{1F534} Task s\u1EAFp \u0111\u1EBFn h\u1EA1n \u2013 C\xF2n ${days} ng\xE0y!` : ms2.kind === "due" ? "\u{1F534} Task \u0111\u1EBFn h\u1EA1n h\xF4m nay!" : "\u{1F534} Task con \u0111\xE3 \u0111\u1EBFn h\u1EA1n \u2013 Ch\u01B0a ho\xE0n th\xE0nh!";
  const lines = [
    { icon: "\u{1F4CC}", label: "Task m\u1EB9", text: parentLine(t.parentCode, t.parentName) },
    { icon: "\u{1F538}", label: "Task con", text: childLine(t.childCode, t.childName) },
    { icon: "\u{1F464}", label: "Ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n", text: t.assigneeName ?? "ch\u01B0a g\xE1n", mentionOpenId: t.assigneeOpenId },
    { icon: "\u23F0", label: "H\u1EA1n ch\xF3t", text: fmtDueDate(t.dueDate) }
  ];
  if (ms2.kind === "overdue") lines.push({ icon: "\u26A0\uFE0F", text: `\u0110\xE3 qu\xE1 h\u1EA1n ${days} ng\xE0y.` });
  for (const e of codeErrors) lines.push({ icon: "\u2757", text: `Task \u0111\xE3 Completed nh\u01B0ng m\xE3 ch\u01B0a h\u1EE3p l\u1EC7: ${e} S\u1EEDa m\xE3 tr\xEAn ti\xEAu \u0111\u1EC1 task \u0111\u1EC3 d\u1EEBng nh\u1EAFc.` });
  return {
    tone: ms2.kind === "before" ? "orange" : "red",
    title,
    lines,
    note: ms2.kind === "before" ? "Vui l\xF2ng c\u1EADp nh\u1EADt ti\u1EBFn \u0111\u1ED9 task." : ms2.kind === "due" ? "Vui l\xF2ng ho\xE0n th\xE0nh v\xE0 c\u1EADp nh\u1EADt ti\u1EBFn \u0111\u1ED9 ngay." : "Vui l\xF2ng c\u1EADp nh\u1EADt ngay.",
    badge: ms2.label
  };
}
function completionMessage(t, timeZone) {
  const at3 = t.completedAt ?? Date.now();
  const [y, m, d] = localDateKey(at3, timeZone).split("-");
  return {
    tone: "green",
    title: "\u2705 Task \u0111\xE3 ho\xE0n th\xE0nh!",
    lines: [
      { icon: "\u{1F4CC}", text: `Task: [${normalizeCode(t.childCode)}] \u2013 DONE` },
      { icon: "\u{1F552}", text: `Th\u1EDDi gian ho\xE0n th\xE0nh: ${d}/${m}/${y}` }
    ],
    note: "C\u1EA3m \u01A1n b\u1EA1n \u0111\xE3 c\u1EADp nh\u1EADt \u{1F389}"
  };
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
function validateDraft(d, ctx) {
  const out = [];
  const code = normalizeCode(d.code);
  if (d.kind === "parent") out.push(...checkParentCode(code, ctx.rules));
  else {
    const parent = normalizeCode(d.parentCode || parentCodeOf(code, ctx.rules) || "");
    out.push(...checkChildCode(code, parent, ctx.rules));
    if (!out.length && !ctx.parents.has(parent)) out.push(`Ch\u01B0a c\xF3 task m\u1EB9 ${parent}. T\u1EA1o task m\u1EB9 tr\u01B0\u1EDBc, r\u1ED3i m\u1EDBi t\u1EA1o task con.`);
    const pd = ctx.parents.get(parent)?.dueDate;
    if (!out.length && pd && d.dueDate && d.dueDate > pd) out.push(`Deadline task con (${fmtDueDate(d.dueDate)}) sau deadline t\u1ED5ng c\u1EE7a task m\u1EB9 (${fmtDueDate(pd)}).`);
  }
  if (code && ctx.existingCodes.has(code)) out.push(`M\xE3 ${code} \u0111\xE3 c\xF3 tr\xEAn h\u1EC7 th\u1ED1ng.`);
  if (!d.name.trim()) out.push(d.kind === "parent" ? "Thi\u1EBFu t\xEAn task m\u1EB9." : "Thi\u1EBFu t\xEAn task con.");
  if (!d.assigneeOpenId) out.push(d.kind === "parent" ? "Thi\u1EBFu ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch (@tag ng\u01B0\u1EDDi \u0111\xF3)." : "Thi\u1EBFu ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n (@tag ng\u01B0\u1EDDi \u0111\xF3).");
  if (!d.dueDate) out.push("Thi\u1EBFu deadline ho\u1EB7c ng\xE0y kh\xF4ng h\u1EE3p l\u1EC7 (d\u1EA1ng 20/11/2026).");
  else if (d.dueDate < localDateKey(ctx.now, ctx.timeZone)) out.push(`Deadline ${fmtDueDate(d.dueDate)} \u0111\xE3 qua.`);
  return out;
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
function parseCreateCommand(text, mentions, now, timeZone) {
  const t = text.replace(/ /g, " ").trim();
  const m = t.match(/^\/?(?:tao\s*moi|taomoi|tạo\s*mới|tạomới|tao|tạo)\s+(me|mẹ|con)\b\s*(.*)$/is);
  if (!m) return { draft: null, errors: [], help: true };
  const kind = /^con$/i.test(m[1]) ? "child" : "parent";
  const parts = m[2].split("|").map((s) => s.trim());
  const [code = "", name = "", who = "", due = "", desc = ""] = parts;
  const mention = mentions.find((x) => who.includes(x.key)) ?? (mentions.length === 1 && who.startsWith("@") ? mentions[0] : void 0);
  const errors = [];
  if (parts.length < 4) errors.push(`Thi\u1EBFu th\xF4ng tin: c\u1EA7n ${kind === "parent" ? 4 : "4\u20135"} ph\u1EA7n, ng\u0103n c\xE1ch b\u1EB1ng d\u1EA5u |.`);
  const dueDate = due ? parseDueDate(due, now, timeZone) : null;
  return {
    help: false,
    errors,
    draft: {
      kind,
      code: normalizeCode(code),
      name,
      assigneeOpenId: mention?.openId ?? null,
      assigneeName: mention?.name ?? (who.replace(/^@/, "") || null),
      dueDate,
      description: desc || null
    }
  };
}
function draftPreviewMessage(d, draftId, parentName) {
  const lines = d.kind === "parent" ? [{ icon: "\u{1F4CC}", label: "Task m\u1EB9", text: parentLine(d.code, d.name) }] : [
    { icon: "\u{1F4CC}", label: "Task m\u1EB9", text: parentName ? parentLine(d.parentCode ?? "", parentName) : normalizeCode(d.parentCode ?? "") },
    { icon: "\u{1F538}", label: "Task con", text: childLine(d.code, d.name) }
  ];
  lines.push({ icon: "\u{1F464}", label: d.kind === "parent" ? "Ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch" : "Ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n", text: d.assigneeName ?? "", mentionOpenId: d.assigneeOpenId });
  lines.push({ icon: "\u23F0", label: d.kind === "parent" ? "Deadline t\u1ED5ng" : "Deadline", text: d.dueDate ? fmtDueDate(d.dueDate) : "\u2014" });
  if (d.description) lines.push({ icon: "\u{1F4DD}", label: "M\xF4 t\u1EA3", text: d.description });
  return {
    tone: "blue",
    title: d.kind === "parent" ? "X\xE1c nh\u1EADn t\u1EA1o task m\u1EB9" : "X\xE1c nh\u1EADn t\u1EA1o task con",
    lines,
    note: "M\xE3 h\u1EE3p l\u1EC7. B\u1EA5m X\xE1c nh\u1EADn t\u1EA1o \u0111\u1EC3 l\u01B0u l\xEAn Lark Tasks.",
    buttons: [
      { text: "X\xE1c nh\u1EADn t\u1EA1o", type: "primary", value: { op: "confirm", draft: draftId } },
      { text: "Hu\u1EF7", type: "default", value: { op: "cancel", draft: draftId } }
    ]
  };
}
function errorMessage(title, errors) {
  return { tone: "red", title, lines: errors.map((e) => ({ icon: "\u274C", text: e })), note: 'S\u1EEDa l\u1EA1i r\u1ED3i g\u1EEDi l\u1EC7nh l\u1EA7n n\u1EEFa. G\xF5 "help" \u0111\u1EC3 xem c\xFA ph\xE1p.' };
}

// src/domain/kpi.ts
var QUOTE_LATE_HOURS = 8;
function quoteTurnaroundHours(q, cal) {
  if (q.sentAt === null) return null;
  return workingHoursBetween(q.requestedAt, q.sentAt, cal);
}
function quoteKpis(quotes, cal, lateHours = QUOTE_LATE_HOURS) {
  const rows = [];
  for (const q of quotes) {
    const hours2 = quoteTurnaroundHours(q, cal);
    if (hours2 === null) continue;
    rows.push({ ...q, hours: hours2, late: hours2 > lateHours + 1e-9 });
  }
  const count = rows.length;
  const lateCount = rows.filter((r) => r.late).length;
  return {
    count,
    avgHours: count ? rows.reduce((s, r) => s + r.hours, 0) / count : null,
    lateCount,
    latePct: count ? lateCount * 100 / count : null,
    rows
  };
}
function round(value, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// src/domain/imports.ts
function pick(r, ...keys) {
  for (const k of keys) {
    const v = r[k];
    if (v !== void 0 && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function parseVnd(input) {
  const s = String(input ?? "").trim();
  if (!s || /[a-zA-Z]/.test(s.replace(/đ|vnd|VND|Đ/g, ""))) return null;
  const compact = s.replace(/\s|đ|Đ|vnd|VND/g, "");
  if (/^-?\d+[.,]\d{1,2}$/.test(compact)) return Math.round(Number(compact.replace(",", ".")));
  const digits = s.replace(/[^\d-]/g, "");
  if (!/^-?\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}
function parseNumber(input) {
  let s = String(input ?? "").trim().replace(/\s|%/g, "");
  if (!s) return null;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    s = s.split(decimal === "," ? "." : ",").join("").replace(",", ".");
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
function validateQuoteHistoryRows(rows, timeZone) {
  const errors = [];
  const groups = /* @__PURE__ */ new Map();
  rows.forEach((r, i) => {
    const n = i + 1;
    const code = pick(r, "quote_code", "code");
    const client = pick(r, "client_alias", "client");
    const serviceGroup = pick(r, "service_group", "group");
    const reqRaw = pick(r, "requested_at");
    const sentRaw = pick(r, "sent_at");
    const requestedAt = parseLocalDateTime(reqRaw, timeZone);
    const sentAt = parseLocalDateTime(sentRaw, timeZone);
    const itemName = pick(r, "item_name", "name");
    const unit = pick(r, "unit");
    const qty = parseNumber(pick(r, "qty", "quantity"));
    const unitPrice = parseVnd(pick(r, "unit_price"));
    const discRaw = pick(r, "discount_pct", "discount");
    const discountPct = discRaw ? parseNumber(discRaw) : 0;
    const problems = [];
    if (!code) problems.push("thi\u1EBFu quote_code");
    if (requestedAt === null) problems.push(`requested_at kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c ("${reqRaw}")`);
    if (sentAt === null) problems.push(`sent_at kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c ("${sentRaw}")`);
    if (requestedAt !== null && sentAt !== null && sentAt <= requestedAt) problems.push("sent_at ph\u1EA3i sau requested_at");
    if (!itemName) problems.push("thi\u1EBFu item_name");
    if (qty === null || qty <= 0) problems.push("qty ph\u1EA3i l\u1EDBn h\u01A1n 0");
    if (unitPrice === null || unitPrice < 0) problems.push("unit_price kh\xF4ng h\u1EE3p l\u1EC7");
    if (discountPct === null || discountPct < 0 || discountPct > 100) problems.push("discount_pct ph\u1EA3i t\u1EEB 0 \u0111\u1EBFn 100");
    if (problems.length) {
      errors.push({ row: n, message: problems.join("; ") });
      return;
    }
    const existing = groups.get(code);
    const line = { itemName, unit: unit || "", qty, unitPrice };
    if (!existing) {
      groups.set(code, {
        first: n,
        quote: { code, client, serviceGroup, requestedAt, sentAt, discountPct, lines: [line] }
      });
      return;
    }
    const q = existing.quote;
    if (q.requestedAt !== requestedAt || q.sentAt !== sentAt || q.discountPct !== discountPct || q.client !== client) {
      errors.push({ row: n, message: `c\xE1c c\u1ED9t requested_at, sent_at, discount_pct, client_alias ph\u1EA3i gi\u1ED1ng d\xF2ng ${existing.first} c\u1EE7a c\xF9ng ${code}` });
      return;
    }
    q.lines.push(line);
  });
  return { quotes: [...groups.values()].map((g) => g.quote), errors };
}
function validateTaskRows(rows, timeZone) {
  const out = [];
  const errors = [];
  rows.forEach((r, i) => {
    const n = i + 1;
    const name = pick(r, "task_name", "name");
    const owner = pick(r, "owner_email", "owner_alias", "owner");
    const taskType = pick(r, "task_type", "type");
    const startRaw = pick(r, "start_at");
    const dueRaw = pick(r, "due_at");
    const startAt = parseLocalDateTime(startRaw, timeZone);
    const dueAt = parseLocalDateTime(dueRaw, timeZone);
    const ms2 = [1, 2, 3, 4].map((k) => pick(r, `milestone_${k}`));
    const problems = [];
    if (!name) problems.push("thi\u1EBFu task_name");
    if (!owner) problems.push("thi\u1EBFu owner_email");
    if (startAt === null) problems.push(`start_at kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c ("${startRaw}")`);
    if (dueAt === null) problems.push(`due_at kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c ("${dueRaw}")`);
    if (startAt !== null && dueAt !== null && dueAt <= startAt) problems.push("due_at ph\u1EA3i sau start_at");
    const someMs = ms2.some(Boolean);
    if (someMs && !ms2.every(Boolean)) problems.push("n\u1EBFu ghi m\u1ED1c th\xEC ph\u1EA3i \u0111\u1EE7 milestone_1 \u0111\u1EBFn milestone_4");
    if (!someMs && !taskType) problems.push("c\u1EA7n task_type ho\u1EB7c \u0111\u1EE7 4 m\u1ED1c");
    if (problems.length) errors.push({ row: n, message: problems.join("; ") });
    else out.push({ row: n, name, owner, taskType, startAt, dueAt, milestones: someMs ? ms2 : null, priorityNote: pick(r, "priority_note") || null });
  });
  return { rows: out, errors };
}

// src/domain/cases.ts
var TZ = DEFAULT_CALENDAR.timeZone;
var DAY = { Mon: 5, Tue: 6, Wed: 7, Thu: 8, Fri: 9, Sat: 10, Sun: 11, NextMon: 12 };
function at(day, hm) {
  const [h, m] = hm.split(":").map(Number);
  return localToMs(2026, 10, DAY[day], h, m, TZ);
}
var WD = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function fmtLocal(t, timeZone = TZ) {
  const p = toLocalParts(t, timeZone);
  return `${WD[p.weekday]} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
function hours(v) {
  return v.toFixed(1);
}
function groupThousands(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
var lib = (n, price = 1e6, unitPrice = price) => ({ name: `Item ${n}`, qty: 1, unitPrice, libraryPrice: price });
function cases(cal) {
  return [
    {
      id: 1,
      rule: "Gi\u1EDD l\xE0m vi\u1EC7c",
      input: "Mon 16:30 \u2192 Tue 09:30",
      expected: "2.5",
      run: () => hours(workingHoursBetween(at("Mon", "16:30"), at("Tue", "09:30"), cal))
    },
    {
      id: 2,
      rule: "Gi\u1EDD l\xE0m vi\u1EC7c",
      input: "Fri 11:00 \u2192 Mon 09:00 (qua cu\u1ED1i tu\u1EA7n)",
      expected: "6.0",
      run: () => hours(workingHoursBetween(at("Fri", "11:00"), at("NextMon", "09:00"), cal))
    },
    {
      id: 3,
      rule: "Gi\u1EDD l\xE0m vi\u1EC7c",
      input: "Wed 11:00 \u2192 Wed 14:00 (qua gi\u1EDD ngh\u1EC9 tr\u01B0a)",
      expected: "1.5",
      run: () => hours(workingHoursBetween(at("Wed", "11:00"), at("Wed", "14:00"), cal))
    },
    {
      id: 4,
      rule: "Khung gi\xE1",
      input: "Chi\u1EBFt kh\u1EA5u 5%, m\u1ECDi \u0111\u01A1n gi\xE1 \u0111\xFAng th\u01B0 vi\u1EC7n",
      expected: "send_now",
      run: () => bandCheck([lib(1), lib(2), lib(3)], 5, DEFAULT_BAND_RULES).level
    },
    {
      id: 5,
      rule: "Khung gi\xE1",
      input: "Chi\u1EBFt kh\u1EA5u 15%, m\u1ECDi \u0111\u01A1n gi\xE1 \u0111\xFAng th\u01B0 vi\u1EC7n",
      expected: "pm",
      run: () => bandCheck([lib(1), lib(2), lib(3)], 15, DEFAULT_BAND_RULES).level
    },
    {
      id: 6,
      rule: "Khung gi\xE1",
      input: "Chi\u1EBFt kh\u1EA5u 5%, m\u1ED9t \u0111\u01A1n gi\xE1 +25%",
      expected: "ceo",
      run: () => bandCheck([lib(1), lib(2, 1e6, 125e4), lib(3)], 5, DEFAULT_BAND_RULES).level
    },
    {
      id: 7,
      rule: "L\u1ECBch checkpoint",
      input: "Mon 08:00 \u2192 Fri 17:30 (40 gi\u1EDD l\xE0m vi\u1EC7c)",
      expected: "Tue 10:00, Wed 12:00, Thu 15:30, Fri 17:06",
      run: () => checkpointTimes(at("Mon", "08:00"), at("Fri", "17:30"), cal).map((d) => fmtLocal(d)).join(", ")
    },
    {
      id: 8,
      rule: "Tr\u1EA3 l\u1EDDi checkpoint",
      input: "Behind \u1EDF m\u1ED1c 75% khi \u0111\xE3 xong 2/4",
      expected: "at_risk, 1 c\u1EA3nh b\xE1o at_risk",
      run: () => {
        const e = answerEffect({ doneCount: 2, status: "on_track" }, 3, "behind");
        return `${e.status}, ${e.alert ? `1 c\u1EA3nh b\xE1o ${e.alert.kind}` : "0 c\u1EA3nh b\xE1o"}`;
      }
    },
    {
      id: 9,
      rule: "Tr\u1EA3 l\u1EDDi checkpoint",
      input: "On plan \u1EDF m\u1ED1c 99% khi \u0111\xE3 xong 3/4",
      expected: "done, 4/4",
      run: () => {
        const e = answerEffect({ doneCount: 3, status: "on_track" }, 4, "on_plan");
        return `${e.status}, ${e.doneCount}/4`;
      }
    },
    {
      id: 10,
      rule: "KPI b\xE1o gi\xE1",
      input: "3 b\xE1o gi\xE1 m\u1EA5t 6h, 8h, 12h l\xE0m vi\u1EC7c",
      expected: "TB 8.67h, 33.3% tr\u1EC5",
      run: () => {
        const qs = [
          { id: "a", requestedAt: at("Mon", "08:00"), sentAt: at("Mon", "15:30") },
          { id: "b", requestedAt: at("Mon", "08:00"), sentAt: at("Mon", "17:30") },
          { id: "c", requestedAt: at("Mon", "08:00"), sentAt: at("Tue", "12:00") }
        ];
        const k = quoteKpis(qs, cal);
        return `TB ${round(k.avgHours, 2).toFixed(2)}h, ${k.latePct.toFixed(1)}% tr\u1EC5`;
      }
    },
    {
      id: 11,
      rule: "Im l\u1EB7ng",
      input: "Checkpoint g\u1EEDi Mon 09:00, kh\xF4ng tr\u1EA3 l\u1EDDi \u0111\u1EBFn Mon 11:00",
      expected: "1 c\u1EA3nh b\xE1o no_reply",
      run: () => {
        const plan2 = planDispatch({
          now: at("Mon", "11:00"),
          cal,
          noReplyWindowHours: 2,
          tasks: [{ id: "t", status: "on_track", dueAt: at("Fri", "17:30"), closedAs: null }],
          checkpoints: [{ id: 1, taskId: "t", pct: 25, scheduledAt: at("Mon", "09:00"), sentAt: at("Mon", "09:00"), answeredAt: null, expiredAt: null, noReplyAlertedAt: null }]
        });
        return `${plan2.noReply.length} c\u1EA3nh b\xE1o no_reply`;
      }
    },
    {
      id: 12,
      rule: "Ch\u1ED1t task",
      input: "Xong 4/4 m\u1ED1c tr\u01B0\u1EDBc deadline",
      expected: "on_time",
      run: () => closeOutcome([at("Tue", "10:00"), at("Wed", "12:00"), at("Thu", "15:30"), at("Fri", "17:06")], at("Fri", "17:30"))
    },
    {
      id: 13,
      rule: "T\u1ED5ng b\xE1o gi\xE1",
      input: "12 \xD7 1.500.000 + 8 \xD7 600.000 + 3 \xD7 2.000.000, gi\u1EA3m 5%",
      expected: "27.360.000",
      run: () => {
        const lines = [
          { qty: 12, unitPrice: 15e5 },
          { qty: 8, unitPrice: 6e5 },
          { qty: 3, unitPrice: 2e6 }
        ];
        return groupThousands(quoteTotals(lines, 5).total);
      }
    },
    {
      id: 14,
      rule: "V\xF2ng \u0111\u1EDDi b\xE1o gi\xE1",
      input: "S\u1EEDa b\xE1o gi\xE1 \u0111\xE3 duy\u1EC7t",
      expected: "draft",
      run: () => {
        const t = nextQuoteStatus("approved", "edit");
        return t.ok ? t.status : t.error;
      }
    },
    {
      id: 15,
      rule: "L\u1ECBch checkpoint",
      input: "B\u1EAFt \u0111\u1EA7u Sat 09:00 (ngo\xE0i gi\u1EDD) \u2192 Mon 17:30",
      expected: "Mon 10:00, Mon 12:00, Mon 15:30, Mon 17:25",
      run: () => checkpointTimes(at("Sat", "09:00"), at("NextMon", "17:30"), cal).map((d) => fmtLocal(d)).join(", ")
    }
  ];
}
function runDomainCases() {
  const cal = { ...DEFAULT_CALENDAR, holidays: [] };
  return cases(cal).map((c) => {
    let actual;
    try {
      actual = c.run();
    } catch (err) {
      actual = `L\u1ED7i: ${err.message}`;
    }
    return { id: c.id, rule: c.rule, input: c.input, expected: c.expected, actual, pass: actual === c.expected };
  });
}

// src/domain/version.ts
var DOMAIN_VERSION = true ? "bdfc368f76" : "dev";

// src/domain/labels.ts
var ROLE_LABEL = {
  account: "Account",
  pm: "PM",
  ceo: "CEO",
  ecom_exec: "E-commerce Executive",
  staff: "Nh\xE2n vi\xEAn",
  admin: "Admin"
};
var VN_WEEKDAY = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];
function p2(n) {
  return n < 10 ? `0${n}` : String(n);
}
function fmtVnShort(t, timeZone) {
  const p = toLocalParts(t, timeZone);
  return `${VN_WEEKDAY[p.weekday]} ${p2(p.hour)}:${p2(p.minute)}, ${p2(p.day)}/${p2(p.month)}`;
}
function fmtVnd(n, withUnit = true) {
  if (n === null || n === void 0 || !Number.isFinite(n)) return "\u2013";
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "\u2212" : ""}${s}${withUnit ? " \u0111" : ""}`;
}

// supabase/functions/ops-hub/http.ts
var ApiError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-retry-count",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Max-Age": "86400"
};
function preflight(req) {
  const asked = req.headers.get("access-control-request-headers");
  return new Response("ok", { headers: { ...CORS_HEADERS, ...asked ? { "Access-Control-Allow-Headers": asked } : {} } });
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
  });
}
function fail(err) {
  if (err instanceof ApiError) return json({ error: { code: err.code, message: err.message } }, err.status);
  const message = err instanceof Error ? err.message : String(err);
  console.error("ops-hub error", message, err instanceof Error ? err.stack : "");
  return json({ error: { code: "server_error", message: `L\u1ED7i m\xE1y ch\u1EE7: ${message}` } }, 500);
}
function safeEqual(a, b) {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
function randomToken(bytes = 9) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
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
async function loadProfile(db, id) {
  return must(
    await db.from("profiles").select("id, email, full_name, role, active, telegram_chat_id, tg_state").eq("id", id).maybeSingle(),
    "load profile"
  );
}
async function profileByChat(db, chatId) {
  return must(
    await db.from("profiles").select("id, email, full_name, role, active, telegram_chat_id, tg_state").eq("telegram_chat_id", chatId).maybeSingle(),
    "load profile by chat"
  );
}
function requireRole(p, ...roles) {
  if (!roles.includes(p.role)) throw new ApiError(403, "forbidden", "B\u1EA1n kh\xF4ng c\xF3 quy\u1EC1n l\xE0m thao t\xE1c n\xE0y.");
}
async function logEvent(db, actor, entity, entityId, action, payload = {}) {
  await db.from("events").insert({ actor, entity, entity_id: entityId, action, payload });
}
function appLink(s, path) {
  if (!s.app_url) return null;
  return `${s.app_url.replace(/\/$/, "")}${path}`;
}

// supabase/functions/ops-hub/demo.ts
var DEMO_DOMAIN = "demo.gomedia.example.com";
var PEOPLE = [
  { key: "acc-a", name: "Account A (m\u1EABu)", role: "account" },
  { key: "acc-b", name: "Account B (m\u1EABu)", role: "account" },
  { key: "intern-a", name: "Th\u1EF1c t\u1EADp sinh A (m\u1EABu)", role: "staff" },
  { key: "intern-b", name: "Th\u1EF1c t\u1EADp sinh B (m\u1EABu)", role: "staff" },
  { key: "intern-c", name: "Th\u1EF1c t\u1EADp sinh C (m\u1EABu)", role: "staff" },
  { key: "intern-d", name: "Th\u1EF1c t\u1EADp sinh D (m\u1EABu)", role: "staff" }
];
var G_EVENT = "S\u1EF1 ki\u1EC7n & s\u1EA3n xu\u1EA5t";
var G_WEB = "Website & SEO";
var G_ADS = "Qu\u1EA3ng c\xE1o";
var G_CONTENT = "K\xEAnh n\u1ED9i dung & social";
var LIBRARY = [
  ["DEMO-SK-01", "G\xF3i ch\u1EE5p h\xECnh s\u1EF1 ki\u1EC7n", "g\xF3i", G_EVENT, 105e5, "service", "Ch\u1EE5p to\xE0n b\u1ED9 ch\u01B0\u01A1ng tr\xECnh, b\xE0n giao \u1EA3nh \u0111\xE3 ch\u1EC9nh m\xE0u"],
  ["DEMO-SK-02", "G\xF3i quay s\u1EF1 ki\u1EC7n", "g\xF3i", G_EVENT, 1e7, "service", "Quay \u0111a g\xF3c, d\u1EF1ng clip t\u1ED5ng h\u1EE3p"],
  ["DEMO-SK-03", "G\xF3i flycam", "g\xF3i", G_EVENT, 5e6, "service", "Quay to\xE0n c\u1EA3nh t\u1EEB tr\xEAn cao"],
  ["DEMO-SK-04", "Thu\xEA camera", "cam/ng\xE0y", G_EVENT, 27e5, "service", null],
  ["DEMO-SK-05", "Thu\xEA mic kh\xF4ng d\xE2y", "mic/ng\xE0y", G_EVENT, 45e4, "service", null],
  ["DEMO-SK-06", "Camera operator", "ng\u01B0\u1EDDi/ng\xE0y", G_EVENT, 7e5, "service", null],
  ["DEMO-SK-07", "AI concept photography", "concept", G_EVENT, 3e6, "service", null],
  ["DEMO-WS-01", "Thi\u1EBFt k\u1EBF website WordPress (Professional)", "tr\u1ECDn g\xF3i", G_WEB, 28e6, "service", null],
  ["DEMO-WS-02", "Landing page", "trang", G_WEB, 5e6, "service", null],
  ["DEMO-WS-03", "Ch\u0103m s\xF3c website v\xE0 SEO (Growth)", "th\xE1ng", G_WEB, 85e5, "service", null],
  ["DEMO-WS-04", "SEO Google Maps", "th\xE1ng", G_WEB, 95e5, "service", null],
  ["DEMO-WS-05", "SEO website t\u1ED5ng th\u1EC3 (kho\u1EA3ng 170 b\xE0i)", "th\xE1ng", G_WEB, 105e5, "service", null],
  ["DEMO-QC-01", "Ph\xED qu\u1EA3n l\xFD Meta Ads", "th\xE1ng", G_ADS, 4e6, "service", null],
  ["DEMO-QC-02", "Ph\xED qu\u1EA3n l\xFD Yandex Ads", "th\xE1ng", G_ADS, 45e5, "service", null],
  ["DEMO-QC-03", "Ph\xED qu\u1EA3n l\xFD Google Ads", "th\xE1ng", G_ADS, 45e5, "service", null],
  ["DEMO-QC-04", "Ng\xE2n s\xE1ch Meta Ads (chi h\u1ED9)", "th\xE1ng", G_ADS, 16e6, "pass_through", null],
  ["DEMO-QC-05", "Ng\xE2n s\xE1ch Yandex Ads (chi h\u1ED9)", "th\xE1ng", G_ADS, 25e6, "pass_through", null],
  ["DEMO-QC-06", "Ng\xE2n s\xE1ch Google Ads (chi h\u1ED9)", "th\xE1ng", G_ADS, 15e6, "pass_through", null],
  ["DEMO-KN-01", "Qu\u1EA3n tr\u1ECB fanpage v\xE0 n\u1ED9i dung social", "th\xE1ng", G_CONTENT, 1e7, "service", null],
  ["DEMO-KN-02", "S\u1EA3n xu\u1EA5t video TikTok", "video", G_CONTENT, 3e6, "service", null],
  ["DEMO-KN-03", "Setup k\xEAnh YouTube", "g\xF3i", G_CONTENT, 7e6, "service", null],
  ["DEMO-KN-04", "V\u1EADn h\xE0nh k\xEAnh YouTube", "th\xE1ng", G_CONTENT, 9e6, "service", null],
  ["DEMO-KN-05", "B\xE0i content Telegram", "b\xE0i", G_CONTENT, 25e4, "service", null]
];
var BASELINE_HOURS = [4, 5, 6, 6.5, 7, 7.5, 8, 9.5, 9.5, 6, 7.5, 9, 9.5, 10, 11, 11.5, 12, 12.5, 12.5];
function requireDemo(ctx, user) {
  requireRole(user, "admin");
  if (ctx.env.appEnv !== "demo") throw new ApiError(403, "not_demo", "Ch\u1EC9 d\xF9ng \u1EDF b\u1EA3n Demo (\u0111\u1EB7t APP_ENV=demo trong Edge Function Secrets c\u1EE7a project demo).");
}
async function demoUserIds(ctx) {
  const rows = must(await ctx.db.from("profiles").select("id").like("email", `%@${DEMO_DOMAIN}`), "demo users");
  return rows.map((r) => r.id);
}
async function clearDemo(ctx, user) {
  requireDemo(ctx, user);
  const ids = await demoUserIds(ctx);
  if (ids.length) {
    must(await ctx.db.from("tasks").delete().in("owner_id", ids).select("id"), "delete demo tasks");
    must(await ctx.db.from("quotes").delete().in("created_by", ids).select("id"), "delete demo quotes");
  }
  must(await ctx.db.from("quotes").delete().like("code", "DEMO-%").select("id"), "delete demo quote codes");
  must(await ctx.db.from("library_items").delete().like("code", "DEMO-%").select("id"), "delete demo library");
  for (const id of ids) await ctx.db.auth.admin.deleteUser(id);
  return { removedUsers: ids.length };
}
function at2(cal, day, hm) {
  const [h, m] = hm.split(":").map(Number);
  return localToMs(day.year, day.month, day.day, h, m, cal.timeZone);
}
function weeks(now, cal) {
  const p = toLocalParts(now, cal.timeZone);
  const thisMon = addDays(p.year, p.month, p.day, -(isoWeekday(p.year, p.month, p.day) - 1));
  const lastMon = addDays(thisMon.year, thisMon.month, thisMon.day, -7);
  return { thisMon, lastMon };
}
async function seedDemo(ctx, user) {
  requireDemo(ctx, user);
  await clearDemo(ctx, user);
  const s = await loadSettings(ctx.db);
  const cal = calendarOf(s);
  const rules = await loadRules(ctx.db);
  const now = ctx.now();
  const who = {};
  for (const p of PEOPLE) {
    const { data, error } = await ctx.db.auth.admin.createUser({
      email: `${p.key}@${DEMO_DOMAIN}`,
      email_confirm: true,
      app_metadata: { ops_role: p.role },
      user_metadata: { full_name: p.name }
    });
    if (error) throw new Error(`create demo user: ${error.message}`);
    who[p.key] = data.user.id;
    await ctx.db.from("profiles").update({ full_name: p.name, role: p.role }).eq("id", data.user.id);
  }
  const LIB_SELECT = "id, code, name, unit, service_group, unit_price, kind, description";
  const existing = must(await ctx.db.from("library_items").select(LIB_SELECT), "load library");
  const key = (name, unit) => `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
  const have = new Map(existing.map((l) => [key(l.name, l.unit), l]));
  const missing = LIBRARY.filter(([, name, unit]) => !have.has(key(name, unit)));
  const inserted = missing.length ? must(
    await ctx.db.from("library_items").insert(missing.map(([code, name, unit, group, price, kind, description]) => ({ code, name, unit, service_group: group, unit_price: price, kind, description }))).select(LIB_SELECT),
    "insert library"
  ) : [];
  for (const l of inserted) have.set(key(l.name, l.unit), l);
  const byCode = new Map(LIBRARY.map(([code, name, unit]) => [code, have.get(key(name, unit))]));
  const item = (code) => {
    const l = byCode.get(code);
    return { ...l, unit_price: Number(l.unit_price) };
  };
  const baseline = BASELINE_HOURS.map((h, i) => {
    const month = 7 + Math.floor(i / 7);
    let day = { year: 2026, month, day: 3 + i % 7 * 3 };
    while (isoWeekday(day.year, day.month, day.day) > 5) day = addDays(day.year, day.month, day.day, 1);
    const requested = at2(cal, day, i % 2 ? "09:00" : "14:00");
    const sent = addWorkingHours(requested, h, cal).getTime();
    const scope = i % 3 === 0 ? ["DEMO-KN-02", "DEMO-KN-05", "DEMO-KN-01"] : i % 3 === 1 ? ["DEMO-SK-04", "DEMO-SK-06"] : ["DEMO-QC-01", "DEMO-QC-04", "DEMO-WS-04"];
    const lines = scope.map((code, k) => ({ item: item(code), qty: k === 0 ? 6 + i % 7 : 2 + i % 3 }));
    const discount = [0, 5, 8, 10][i % 4];
    const totals = quoteTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.item.unit_price, kind: l.item.kind })), discount);
    return {
      code: `DEMO-H-${String(i + 1).padStart(2, "0")}`,
      client: `Kh\xE1ch m\u1EABu ${String(i + 1).padStart(2, "0")}`,
      service_group: lines[0].item.service_group,
      requested_at: new Date(requested).toISOString(),
      sent_at: new Date(sent).toISOString(),
      discount_pct: discount,
      subtotal: totals.subtotal,
      total: totals.total,
      lines: lines.map((l) => ({ library_item_id: l.item.id, item_name: l.item.name, unit: l.item.unit, qty: l.qty, unit_price: l.item.unit_price, library_price: l.item.unit_price, kind: l.item.kind }))
    };
  });
  must(await ctx.db.rpc("ops_import_quotes", { p: { actor: who["acc-a"], quotes: baseline } }), "import baseline");
  const { thisMon, lastMon } = weeks(now, cal);
  const pilotQuotes = [
    { by: "acc-a", day: lastMon, at: "09:00", hours: 2.5, lines: [["DEMO-KN-02", 12, 0], ["DEMO-KN-05", 8, 0], ["DEMO-KN-01", 3, 0]], disc: 5 },
    { by: "acc-b", day: addDays(lastMon.year, lastMon.month, lastMon.day, 1), at: "10:30", hours: 3, lines: [["DEMO-SK-04", 4, 0], ["DEMO-SK-06", 6, 0]], disc: 0 },
    { by: "acc-a", day: addDays(lastMon.year, lastMon.month, lastMon.day, 2), at: "14:00", hours: 6.5, lines: [["DEMO-QC-01", 4, 0], ["DEMO-QC-04", 2, 0]], disc: 15 },
    { by: "acc-b", day: addDays(lastMon.year, lastMon.month, lastMon.day, 3), at: "08:30", hours: 9, lines: [["DEMO-SK-01", 2, 0.25], ["DEMO-SK-02", 3, 0]], disc: 5 },
    { by: "acc-a", day: thisMon, at: "09:30", hours: 1.5, lines: [["DEMO-KN-02", 10, 0], ["DEMO-KN-01", 3, 0]], disc: 8 }
  ];
  for (const [i, q] of pilotQuotes.entries()) {
    const requested = at2(cal, q.day, q.at);
    const sent = addWorkingHours(requested, q.hours, cal).getTime();
    if (sent > now) continue;
    const lines = q.lines.map(([code, qty, dev]) => {
      const it = item(code);
      return { it, qty, price: Math.round(it.unit_price * (1 + dev)) };
    });
    const band = bandCheck(lines.map((l) => ({ name: l.it.name, qty: l.qty, unitPrice: l.price, libraryPrice: l.it.unit_price, passThrough: l.it.kind === "pass_through" })), q.disc, rules);
    const totals = quoteTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.price, kind: l.it.kind })), q.disc, { pct: s.vat_pct, onPassThrough: s.vat_on_pass_through });
    const quote = must(
      await ctx.db.from("quotes").insert({
        code: `DEMO-Q-${String(i + 1).padStart(2, "0")}`,
        client: `Kh\xE1ch m\u1EABu ${String(20 + i)}`,
        service_group: lines[0].it.service_group,
        requested_at: new Date(requested).toISOString(),
        sent_at: new Date(sent).toISOString(),
        status: "sent",
        discount_pct: q.disc,
        subtotal: totals.subtotal,
        total: totals.total,
        vat_pct: s.vat_pct,
        vat_amount: totals.vatAmount,
        grand_total: totals.grandTotal,
        band_result: band.level,
        approver: band.level === "send_now" ? null : band.level,
        created_by: who[q.by]
      }).select("id").single(),
      "demo quote"
    );
    await ctx.db.from("quote_lines").insert(
      lines.map((l, k) => ({
        quote_id: quote.id,
        position: k + 1,
        library_item_id: l.it.id,
        item_name: l.it.name,
        unit: l.it.unit,
        qty: l.qty,
        unit_price: l.price,
        library_price: l.it.unit_price,
        override_reason: l.price !== l.it.unit_price ? "Ph\u1EA1m vi \u0111\u1EB7c th\xF9 (m\u1EABu)" : null,
        section: l.it.service_group,
        description: l.it.description,
        kind: l.it.kind
      }))
    );
    if (band.level !== "send_now") {
      await ctx.db.from("approvals").insert({ quote_id: quote.id, level: band.level, approver_id: user.id, decision: "approve", comment: "Duy\u1EC7t (d\u1EEF li\u1EC7u m\u1EABu)", decided_at: new Date(sent - 30 * 6e4).toISOString() });
    }
  }
  const types = must(await ctx.db.from("task_types").select("id, name, milestone_1, milestone_2, milestone_3, milestone_4"), "types");
  const scripts = [
    { name: "Shortlist KOC cho th\u01B0\u01A1ng hi\u1EC7u m\u1EF9 ph\u1EA9m (m\u1EABu)", owner: "intern-a", type: 0, week: "last", answers: ["on_plan", "on_plan", "behind", "on_plan"], priority: "Li\xEAn h\u1EC7 KOC d\u1EF1 ph\xF2ng ngay h\xF4m nay" },
    { name: "D\u1EF1ng video s\u1EA3n ph\u1EA9m ch\u0103m s\xF3c da (m\u1EABu)", owner: "intern-b", type: 1, week: "last", answers: ["on_plan", "blocked", "on_plan", "on_plan"], priority: "Account nh\u1EAFc kh\xE1ch g\u1EEDi g\xF3p \xFD" },
    { name: "SEO 20 trang s\u1EA3n ph\u1EA9m (m\u1EABu)", owner: "intern-c", type: 2, week: "last", answers: ["on_plan", "on_plan", "on_plan", "on_plan"], priority: "Xong meta title tr\u01B0\u1EDBc khi \u0111\u0103ng" },
    { name: "Banner chi\u1EBFn d\u1ECBch 11.11 (m\u1EABu)", owner: "intern-d", type: 3, week: "last", answers: ["on_plan", null, "behind", "behind"], priority: "Nh\u1EDD designer h\u1ED7 tr\u1EE3 b\u1EA3n nh\xE1p" },
    { name: "Booking KOC cho chu\u1ED7i F&B (m\u1EABu)", owner: "intern-a", type: 0, week: "this", answers: ["on_plan", "on_plan", "on_plan", "on_plan"], priority: "Ch\u1ED1t KOC tr\u01B0\u1EDBc th\u1EE9 N\u0103m" },
    { name: "Video unbox s\u1EA3n ph\u1EA9m m\u1EDBi (m\u1EABu)", owner: "intern-b", type: 1, week: "this", answers: ["on_plan", "behind", "on_plan", "on_plan"], priority: "\u01AFu ti\xEAn b\u1EA3n d\u1EF1ng th\xF4" },
    { name: "Banner gian h\xE0ng Shopee (m\u1EABu)", owner: "intern-d", type: 3, week: "this", answers: [null, "on_plan", "on_plan", "on_plan"], priority: "Xin \u1EA3nh s\u1EA3n ph\u1EA9m t\u1EEB kh\xE1ch" }
  ];
  let createdTasks = 0;
  for (const sc of scripts) {
    const mon = sc.week === "last" ? lastMon : thisMon;
    const fri = addDays(mon.year, mon.month, mon.day, 4);
    const start = at2(cal, mon, "08:00");
    const due = at2(cal, fri, "17:30");
    const ty = types[sc.type % types.length];
    const times = checkpointTimes(start, due, cal).map((d) => d.getTime());
    const task = must(
      await ctx.db.from("tasks").insert({ name: sc.name, owner_id: who[sc.owner], type_id: ty.id, start_at: new Date(start).toISOString(), due_at: new Date(due).toISOString(), priority_note: sc.priority, created_by: user.id }).select("id").single(),
      "demo task"
    );
    createdTasks++;
    const labels = [ty.milestone_1, ty.milestone_2, ty.milestone_3, ty.milestone_4];
    const doneAt = [null, null, null, null];
    let state = { doneCount: 0, status: "not_started" };
    const cpRows = [];
    const alerts = [];
    times.forEach((t, i) => {
      const row = { task_id: task.id, pct: CHECKPOINT_PCTS[i], scheduled_at: new Date(t).toISOString(), token: randomToken() };
      if (t <= now && t <= due) {
        for (const prev of cpRows) if (prev.sent_at && !prev.answered_at && !prev.expired_at) prev.expired_at = new Date(t).toISOString();
        row.sent_at = new Date(t).toISOString();
        row.sent_via = "web";
        const a = sc.answers[i];
        const answeredAt = addWorkingMs(t, 20 * 6e4, cal);
        if (a && answeredAt <= now) {
          const reason = a === "blocked" ? "Kh\xE1ch ch\u01B0a g\u1EEDi g\xF3p \xFD (m\u1EABu)" : null;
          const eff = answerEffect(state, i + 1, a, reason);
          for (const k of eff.markDone) doneAt[k - 1] = answeredAt;
          state = { doneCount: eff.doneCount, status: eff.status };
          Object.assign(row, { answered_at: new Date(answeredAt).toISOString(), answer: a, answer_via: "web", answer_reason: reason });
          if (eff.alert) alerts.push({ task_id: task.id, kind: eff.alert.kind, reason: eff.alert.reason, created_at: new Date(answeredAt).toISOString(), notified_at: new Date(answeredAt).toISOString() });
        } else if (!a) {
          const silentAt = addWorkingMs(t, s.no_reply_window_hours * 36e5, cal);
          if (silentAt <= now && workingMsBetween(t, Math.min(now, due), cal) >= s.no_reply_window_hours * 36e5) {
            row.no_reply_alerted_at = new Date(silentAt).toISOString();
            state = { ...state, status: statusAfterSilence(state.status) };
            alerts.push({ task_id: task.id, kind: "no_reply", reason: `Kh\xF4ng tr\u1EA3 l\u1EDDi checkpoint ${CHECKPOINT_PCTS[i]}% (m\u1EABu)`, created_at: new Date(silentAt).toISOString(), notified_at: new Date(silentAt).toISOString() });
          }
        }
      }
      cpRows.push(row);
    });
    const ms2 = labels.map((label, i) => ({ task_id: task.id, idx: i + 1, label, done_at: doneAt[i] ? new Date(doneAt[i]).toISOString() : null }));
    must(await ctx.db.from("milestones").insert(ms2).select("id"), "demo milestones");
    must(await ctx.db.from("checkpoints").insert(cpRows).select("id"), "demo checkpoints");
    let closed = { status: state.status };
    if (due <= now) {
      const outcome = closeOutcome(doneAt, due);
      closed = { status: outcome === "on_time" ? "done" : "overdue", closed_as: outcome, closed_at: new Date(due).toISOString() };
      if (outcome === "overdue") alerts.push({ task_id: task.id, kind: "overdue", reason: "Tr\u1EC5 deadline (m\u1EABu)", created_at: new Date(due).toISOString(), notified_at: new Date(due).toISOString() });
      await ctx.db.from("checkpoints").update({ expired_at: new Date(due).toISOString() }).eq("task_id", task.id).is("answered_at", null);
    }
    await ctx.db.from("tasks").update(closed).eq("id", task.id);
    if (alerts.length) must(await ctx.db.from("alerts").insert(alerts).select("id"), "demo alerts");
  }
  const pilotEnd = addDays(thisMon.year, thisMon.month, thisMon.day, 4);
  const iso = (d) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  await ctx.db.from("settings").update({ pilot_start: iso(lastMon), pilot_end: iso(pilotEnd) }).eq("id", 1);
  await ctx.db.from("events").insert({ actor: user.id, entity: "system", entity_id: null, action: "demo.seeded", payload: { tasks: createdTasks } });
  return { users: PEOPLE.length, library: LIBRARY.length, baselineQuotes: baseline.length, tasks: createdTasks };
}

// supabase/functions/ops-hub/messages.ts
function checkpointText(o) {
  return [
    `<b>Checkpoint ${o.pct}%</b> \xB7 ${escapeHtml(o.taskName)}`,
    `Deadline: ${fmtVnShort(o.dueAt, o.tz)}`,
    "",
    "Theo k\u1EBF ho\u1EA1ch, \u0111\u1EBFn l\xFAc n\xE0y c\u1EA7n xong:",
    `<b>M\u1ED1c ${o.idx}/4: ${escapeHtml(o.milestone)}</b>`,
    "",
    "M\u1ED1c n\xE0y \u0111\xE3 xong ch\u01B0a? Ch\u1ECDn \u0111\xFAng t\xECnh tr\u1EA1ng th\u1EADt."
  ].join("\n");
}
function checkpointButtons(cpId, token) {
  return [
    [{ text: "\u0110\xFAng k\u1EBF ho\u1EA1ch (\u0111\xE3 xong)", data: `a:${cpId}:${token}:p` }],
    [
      { text: "Ch\u1EADm h\u01A1n k\u1EBF ho\u1EA1ch", data: `a:${cpId}:${token}:b` },
      { text: "B\u1ECB ch\u1EB7n", data: `a:${cpId}:${token}:x` }
    ]
  ];
}
function alertText(o) {
  const done = o.milestones.filter((m) => m.done_at).map((m) => m.label);
  const upto = Math.max(o.plannedIdx ?? 0, done.length + 1);
  const pending = o.milestones.filter((m) => !m.done_at && m.idx <= upto).map((m) => m.label);
  const lines = [
    `<b>C\u1EA2NH B\xC1O \xB7 ${ALERT_LABEL[o.kind].toUpperCase()}</b>`,
    `${escapeHtml(o.taskName)} \xB7 ${escapeHtml(o.ownerName)}`,
    `Deadline: ${fmtVnShort(o.dueAt, o.tz)}`,
    `\u0110\xE3 xong: ${done.length ? escapeHtml(done.join(", ")) : "ch\u01B0a c\xF3 m\u1ED1c n\xE0o"}`
  ];
  if (o.kind !== "overdue") lines.push(`\u0110ang ch\u1EDD: ${pending.length ? escapeHtml(pending.join(", ")) : "\u2013"}`);
  if (o.reason) lines.push(`${o.kind === "blocker" ? "L\xFD do" : "Ghi ch\xFA"}: ${escapeHtml(o.reason)}`);
  if (o.priorityNote && o.kind !== "overdue") lines.push(`\u01AFu ti\xEAn: ${escapeHtml(o.priorityNote)}`);
  return lines.join("\n");
}
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
function commentText(o) {
  const body = o.body.length > 300 ? `${o.body.slice(0, 300)}\u2026` : o.body;
  return [
    `<b>${o.reply ? "Tr\u1EA3 l\u1EDDi g\xF3p \xFD" : "G\xF3p \xFD m\u1EDBi"} \xB7 ${escapeHtml(o.code)}</b>`,
    `Kh\xE1ch: ${escapeHtml(o.client)} \xB7 ${escapeHtml(o.authorName)}`,
    `${escapeHtml(o.place)}: \u201C${escapeHtml(body)}\u201D`
  ].join("\n");
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

// supabase/functions/ops-hub/alerts.ts
async function composeAlert(ctx, a, tz) {
  const task = must(
    await ctx.db.from("tasks").select("id, name, owner_id, due_at, priority_note").eq("id", a.task_id).maybeSingle(),
    "load task"
  );
  if (!task) return null;
  const owner = (await ctx.db.from("profiles").select("full_name, email").eq("id", task.owner_id).maybeSingle()).data;
  const milestones = must(await ctx.db.from("milestones").select("idx, label, done_at").eq("task_id", task.id).order("idx"), "load milestones");
  let plannedIdx = null;
  if (a.checkpoint_id) {
    const cp = (await ctx.db.from("checkpoints").select("pct").eq("id", a.checkpoint_id).maybeSingle()).data;
    if (cp) plannedIdx = [25, 50, 75, 99].indexOf(cp.pct) + 1;
  }
  return alertText({
    kind: a.kind,
    taskName: task.name,
    ownerName: owner?.full_name || owner?.email || "Kh\xF4ng r\xF5",
    milestones,
    plannedIdx,
    priorityNote: task.priority_note,
    reason: a.reason,
    dueAt: task.due_at,
    tz
  });
}
async function notifyAlert(ctx, alertId) {
  const s = await loadSettings(ctx.db);
  if (!isWorkingTime(ctx.now(), calendarOf(s))) return false;
  const claimed = must(
    await ctx.db.from("alerts").update({ notified_at: new Date(ctx.now()).toISOString() }).eq("id", alertId).is("notified_at", null).select("id, task_id, checkpoint_id, kind, reason, notified_at"),
    "claim alert"
  );
  if (!claimed.length) return false;
  const text = await composeAlert(ctx, claimed[0], s.timezone);
  if (text) await ctx.notifier.sendToRoles(["ecom_exec"], text, linkButton("M\u1EDF trang C\u1EA3nh b\xE1o", appLink(s, "/alerts")));
  return true;
}
async function deliverPendingAlerts(ctx) {
  const s = await loadSettings(ctx.db);
  if (!isWorkingTime(ctx.now(), calendarOf(s))) return 0;
  const since = new Date(ctx.now() - 7 * 24 * 36e5).toISOString();
  const rows = must(
    await ctx.db.from("alerts").select("id").is("notified_at", null).is("acknowledged_at", null).gte("created_at", since).order("created_at").limit(50),
    "pending alerts"
  );
  let n = 0;
  for (const r of rows) if (await notifyAlert(ctx, r.id)) n++;
  return n;
}

// supabase/functions/ops-hub/review.ts
var COMMENT_COLS = "id, quote_id, parent_id, author_id, anchor, line_id, section_title, anchor_label, body, resolved_at, resolved_by, created_at";
var NOTIFY_GAP_MS = 10 * 6e4;
async function quoteFor(ctx, user, id) {
  const q = must(await ctx.db.from("quotes").select("id, code, client, status, created_by, approver").eq("id", id).maybeSingle(), "load quote");
  if (!q) throw new ApiError(404, "quote_not_found", "Kh\xF4ng t\xECm th\u1EA5y b\xE1o gi\xE1.");
  if (q.status === "sent") throw new ApiError(409, "quote_sent", "B\xE1o gi\xE1 \u0111\xE3 g\u1EEDi kh\xE1ch, kh\xF4ng g\xF3p \xFD th\xEAm \u0111\u01B0\u1EE3c.");
  if (!canComment(user.role, q.created_by === user.id, q.status)) throw new ApiError(403, "forbidden", "Ch\u1EC9 PM, CEO v\xE0 Account l\u1EADp b\xE1o gi\xE1 n\xE0y m\u1EDBi g\xF3p \xFD \u0111\u01B0\u1EE3c.");
  return q;
}
async function openThreadCount(ctx, quoteId) {
  const res = await ctx.db.from("quote_comments").select("id", { count: "exact", head: true }).eq("quote_id", quoteId).is("parent_id", null).is("resolved_at", null);
  if (res.error) throw new Error(`count open comments: ${res.error.message}`);
  return res.count ?? 0;
}
async function notify(ctx, q, author, c, root) {
  const to = /* @__PURE__ */ new Set();
  if (author.id !== q.created_by) to.add(q.created_by);
  else if (root && root.author_id !== author.id) to.add(root.author_id);
  else if (q.status === "pending" && q.approver) {
    const rows = must(await ctx.db.from("profiles").select("id").eq("role", q.approver).eq("active", true), "load approvers");
    for (const r of rows) to.add(r.id);
  }
  to.delete(author.id);
  if (!to.size) return;
  const s = await loadSettings(ctx.db);
  if (!isWorkingTime(ctx.now(), calendarOf(s))) return;
  const recent = must(
    await ctx.db.from("events").select("payload").eq("entity", "quotes").eq("entity_id", q.id).eq("action", "quote.comment_notified").order("id", { ascending: false }).limit(50),
    "recent comment notices"
  );
  const told = new Set(recent.filter((r) => Math.abs(ctx.now() - Number(r.payload?.at ?? 0)) < NOTIFY_GAP_MS).map((r) => r.payload?.to));
  const text = commentText({ code: q.code, client: q.client, authorName: author.full_name || author.email, place: c.anchor_label, body: c.body, reply: !!root });
  for (const userId of to) {
    if (told.has(userId)) continue;
    const res = await ctx.notifier.send(userId, text, linkButton("M\u1EDF b\xE1o gi\xE1", appLink(s, `/quotes/${q.id}`)));
    if (res.delivered) await logEvent(ctx.db, author.id, "quotes", q.id, "quote.comment_notified", { to: userId, at: ctx.now() });
  }
}
async function addComment(ctx, user, body) {
  const q = await quoteFor(ctx, user, String(body.quote_id ?? ""));
  const text = validateCommentBody(body.body);
  if (!text.ok) throw new ApiError(400, "bad_comment", text.error);
  let row;
  let root = null;
  if (body.parent_id) {
    root = must(await ctx.db.from("quote_comments").select(COMMENT_COLS).eq("id", String(body.parent_id)).maybeSingle(), "load thread");
    if (!root || root.quote_id !== q.id || root.parent_id) throw new ApiError(400, "bad_parent", "Kh\xF4ng t\xECm th\u1EA5y g\xF3p \xFD \u0111\u1EC3 tr\u1EA3 l\u1EDDi.");
    row = { quote_id: q.id, parent_id: root.id, author_id: user.id, anchor: root.anchor, line_id: root.line_id, section_title: root.section_title, anchor_label: root.anchor_label, body: text.body };
  } else {
    const anchor = COMMENT_ANCHORS.includes(body.anchor) ? body.anchor : "general";
    let lineId = null;
    let sectionTitle = null;
    let label = anchorLabel({ anchor });
    if (anchor === "line") {
      const line = must(
        await ctx.db.from("quote_lines").select("id, quote_id, position, item_name").eq("id", String(body.line_id ?? "")).maybeSingle(),
        "load line"
      );
      if (!line || line.quote_id !== q.id) throw new ApiError(400, "bad_line", "D\xF2ng n\xE0y kh\xF4ng c\xF2n trong b\xE1o gi\xE1. T\u1EA3i l\u1EA1i trang r\u1ED3i th\u1EED l\u1EA1i.");
      lineId = line.id;
      label = anchorLabel({ anchor, position: line.position, itemName: line.item_name });
    } else if (anchor === "section") {
      sectionTitle = String(body.section_title ?? "").trim().slice(0, 200);
      if (!sectionTitle) throw new ApiError(400, "bad_section", "Thi\u1EBFu t\xEAn ph\u1EA7n c\u1EA7n g\xF3p \xFD.");
      label = anchorLabel({ anchor, sectionTitle });
    }
    row = { quote_id: q.id, author_id: user.id, anchor, line_id: lineId, section_title: sectionTitle, anchor_label: label, body: text.body };
  }
  const comment = must(await ctx.db.from("quote_comments").insert(row).select(COMMENT_COLS).single(), "save comment");
  if (root?.resolved_at) {
    must(await ctx.db.from("quote_comments").update({ resolved_at: null, resolved_by: null }).eq("id", root.id).select("id"), "reopen thread");
  }
  await logEvent(ctx.db, user.id, "quotes", q.id, root ? "quote.comment_replied" : "quote.commented", { comment_id: comment.id, anchor: comment.anchor, label: comment.anchor_label });
  try {
    await notify(ctx, q, user, comment, root);
  } catch (err) {
    console.error("comment notice failed", err);
  }
  return { comment, reopened: !!root?.resolved_at };
}
async function resolveComment(ctx, user, body) {
  const c = must(await ctx.db.from("quote_comments").select(COMMENT_COLS).eq("id", String(body.comment_id ?? "")).maybeSingle(), "load comment");
  if (!c) throw new ApiError(404, "comment_not_found", "Kh\xF4ng t\xECm th\u1EA5y g\xF3p \xFD.");
  if (c.parent_id) throw new ApiError(400, "not_a_thread", "Ch\u1EC9 \u0111\xE1nh d\u1EA5u \u0111\u01B0\u1EE3c g\xF3p \xFD g\u1ED1c, kh\xF4ng ph\u1EA3i c\xE2u tr\u1EA3 l\u1EDDi.");
  const q = await quoteFor(ctx, user, c.quote_id);
  const resolved = body.resolved !== false;
  if (resolved === !!c.resolved_at) return { comment: c };
  const comment = must(
    await ctx.db.from("quote_comments").update(resolved ? { resolved_at: new Date(ctx.now()).toISOString(), resolved_by: user.id } : { resolved_at: null, resolved_by: null }).eq("id", c.id).select(COMMENT_COLS).single(),
    "update comment"
  );
  await logEvent(ctx.db, user.id, "quotes", q.id, resolved ? "quote.comment_resolved" : "quote.comment_reopened", { comment_id: c.id, label: c.anchor_label });
  return { comment };
}

// supabase/functions/ops-hub/quotes.ts
var QUOTE_COLS = "id, code, client, service_group, status, requested_at, discount_pct, vat_pct, created_by, approver, band_result, band_detail, total";
async function libraryMap(ctx, ids) {
  const wanted = [...new Set(ids.filter((x) => !!x))];
  if (!wanted.length) return /* @__PURE__ */ new Map();
  const rows = must(await ctx.db.from("library_items").select("id, name, unit, service_group, unit_price, band_low, band_high, active, kind").in("id", wanted), "load library");
  return new Map(rows.map((r) => [r.id, { ...r, unit_price: Number(r.unit_price), band_low: r.band_low === null ? null : Number(r.band_low), band_high: r.band_high === null ? null : Number(r.band_high) }]));
}
function bandLines(lines, lib2) {
  return lines.map((l) => {
    const item = l.library_item_id ? lib2.get(l.library_item_id) : void 0;
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
function checkLinesShape(lines) {
  if (!Array.isArray(lines) || lines.length > 200) throw new ApiError(400, "bad_lines", "Danh s\xE1ch h\u1EA1ng m\u1EE5c kh\xF4ng h\u1EE3p l\u1EC7.");
  return lines.map((l) => {
    const x = l;
    const qty = Number(x.qty);
    const price = Number(x.unit_price);
    if (!(qty > 0) || !(price >= 0) || !Number.isFinite(qty) || !Number.isFinite(price)) throw new ApiError(400, "bad_lines", "S\u1ED1 l\u01B0\u1EE3ng ph\u1EA3i > 0 v\xE0 \u0111\u01A1n gi\xE1 \u2265 0.");
    return { library_item_id: x.library_item_id || null, item_name: String(x.item_name ?? ""), qty, unit_price: Math.round(price), override_reason: x.override_reason ?? null, kind: x.kind === "pass_through" ? "pass_through" : "service" };
  });
}
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
async function transition(ctx, p) {
  const res = await ctx.db.rpc("ops_quote_transition", { p });
  if (res.error && /conflict/.test(res.error.message)) throw new ApiError(409, "conflict", "B\xE1o gi\xE1 v\u1EEBa \u0111\u01B0\u1EE3c thay \u0111\u1ED5i \u1EDF n\u01A1i kh\xE1c. T\u1EA3i l\u1EA1i trang r\u1ED3i th\u1EED l\u1EA1i.");
  return must(res, "quote transition");
}
async function readyLines(ctx, q) {
  const lines = await loadLines(ctx, q.id);
  const lib2 = await libraryMap(ctx, lines.map((l) => l.library_item_id));
  const errors = validateQuote({
    client: q.client,
    requestedAt: Date.parse(q.requested_at),
    now: ctx.now(),
    lines: lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price })),
    discountPct: q.discount_pct,
    vatPct: q.vat_pct
  });
  const kindOf = (l) => (l.library_item_id ? lib2.get(l.library_item_id)?.kind : void 0) ?? l.kind ?? "service";
  if (q.status !== "approved") {
    const missing = linesMissingOverrideReason(
      lines.map((l) => ({ unitPrice: l.unit_price, libraryPrice: l.library_item_id ? lib2.get(l.library_item_id)?.unit_price ?? null : null, overrideReason: l.override_reason, kind: kindOf(l) }))
    );
    if (missing.length) errors.push(`Ghi l\xFD do cho \u0111\u01A1n gi\xE1 kh\xE1c th\u01B0 vi\u1EC7n \u1EDF d\xF2ng ${missing.map((i) => i + 1).join(", ")}.`);
  }
  if (errors.length) throw new ApiError(400, "invalid_quote", errors.join(" "));
  const [rules, s] = await Promise.all([loadRules(ctx.db), loadSettings(ctx.db)]);
  const band = bandCheck(bandLines(lines, lib2), q.discount_pct, rules);
  const totals = quoteTotals(
    lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price, kind: kindOf(l) })),
    q.discount_pct,
    { pct: q.vat_pct, onPassThrough: s.vat_on_pass_through }
  );
  return { lines, band, totals };
}
async function previewBand(ctx, user, body) {
  requireRole(user, "account", "pm", "ceo");
  const lines = checkLinesShape(body.lines ?? []);
  const lib2 = await libraryMap(ctx, lines.map((l) => l.library_item_id));
  const discount = Number(body.discount_pct ?? 0);
  let result;
  try {
    result = bandCheck(bandLines(lines, lib2), discount, await loadRules(ctx.db));
  } catch (err) {
    throw new ApiError(400, "bad_input", err.message === "Discount must be between 0 and 100%" ? "Chi\u1EBFt kh\u1EA5u ph\u1EA3i t\u1EEB 0 \u0111\u1EBFn 100%." : "D\u1EEF li\u1EC7u b\xE1o gi\xE1 kh\xF4ng h\u1EE3p l\u1EC7.");
  }
  const libraryPrices = lines.map((l) => l.library_item_id ? lib2.get(l.library_item_id)?.unit_price ?? null : null);
  return user.role === "ceo" ? { band: publicBand(result), full: result, libraryPrices } : { band: publicBand(result), libraryPrices };
}
async function notifyApproval(ctx, quoteId) {
  const s = await loadSettings(ctx.db);
  if (!isWorkingTime(ctx.now(), calendarOf(s))) return false;
  const claimed = must(
    await ctx.db.from("quotes").update({ approval_notified_at: new Date(ctx.now()).toISOString() }).eq("id", quoteId).eq("status", "pending").is("approval_notified_at", null).select(QUOTE_COLS),
    "claim approval notice"
  );
  const q = claimed[0];
  if (!q || !q.approver) return false;
  const account = (await ctx.db.from("profiles").select("full_name, email").eq("id", q.created_by).maybeSingle()).data;
  const text = approvalRequestText({
    code: q.code,
    client: q.client,
    total: Number(q.total),
    level: q.approver,
    accountName: account?.full_name || account?.email || "",
    reasons: q.band_detail?.reasons ?? []
  });
  await ctx.notifier.sendToRoles([q.approver], text, linkButton("M\u1EDF b\xE1o gi\xE1 \u0111\u1EC3 duy\u1EC7t", appLink(s, `/quotes/${q.id}`)));
  return true;
}
async function deliverPendingApprovals(ctx) {
  const rows = must(await ctx.db.from("quotes").select("id").eq("status", "pending").is("approval_notified_at", null).limit(50), "pending approvals");
  let n = 0;
  for (const r of rows) if (await notifyApproval(ctx, r.id)) n++;
  return n;
}
async function submitQuote(ctx, user, quoteId) {
  const q = await loadQuote(ctx, quoteId);
  own(user, q);
  const { band, totals } = await readyLines(ctx, q);
  const t = nextQuoteStatus(q.status, "submit", band.level);
  if (!t.ok) throw new ApiError(409, "bad_transition", t.error);
  const quote = await transition(ctx, {
    quote_id: q.id,
    expected_status: q.status,
    new_status: t.status,
    actor: user.id,
    fields: { band_result: band.level, band_detail: publicBand(band), approver: band.level, approval_requested: true, subtotal: totals.subtotal, total: totals.total, vat_amount: totals.vatAmount, grand_total: totals.grandTotal },
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
  if (q.status !== "pending") throw new ApiError(409, "not_pending", "B\xE1o gi\xE1 n\xE0y kh\xF4ng c\xF2n ch\u1EDD duy\u1EC7t.");
  if (q.approver !== user.role) throw new ApiError(403, "wrong_approver", `B\xE1o gi\xE1 n\xE0y ch\u1EDD ${ROLE_LABEL[q.approver ?? "ceo"]} duy\u1EC7t.`);
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
  const t = nextQuoteStatus(q.status, decision === "approve" ? "approve" : "request_changes");
  if (!t.ok) throw new ApiError(409, "bad_transition", t.error);
  const quote = await transition(ctx, {
    quote_id: q.id,
    expected_status: "pending",
    new_status: t.status,
    actor: user.id,
    approval: { level: q.approver, approver_id: user.id, decision, comment },
    event_action: decision === "approve" ? "quote.approved" : "quote.changes_requested",
    event_payload: { comment, open_comments: open }
  });
  const s = await loadSettings(ctx.db);
  if (isWorkingTime(ctx.now(), calendarOf(s))) {
    await ctx.notifier.send(q.created_by, decisionText({ code: q.code, decision, approverRole: user.role, comment: comment || null }), linkButton("M\u1EDF b\xE1o gi\xE1", appLink(s, `/quotes/${q.id}`)));
  }
  return { quote };
}
async function sendQuote(ctx, user, quoteId) {
  const q = await loadQuote(ctx, quoteId);
  own(user, q);
  const gate = sendGate(await openThreadCount(ctx, q.id));
  if (!gate.ok) throw new ApiError(409, "open_comments", gate.error);
  const { band, totals } = await readyLines(ctx, q);
  const t = nextQuoteStatus(q.status, "send", q.status === "approved" ? q.band_result ?? void 0 : band.level);
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
async function importQuotes(ctx, user, body) {
  requireRole(user, "pm", "admin");
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length > 5e3) throw new ApiError(400, "bad_rows", "File kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c qu\xE1 l\u1EDBn (t\u1ED1i \u0111a 5000 d\xF2ng).");
  const s = await loadSettings(ctx.db);
  const { quotes, errors } = validateQuoteHistoryRows(rows, s.timezone);
  const lib2 = must(await ctx.db.from("library_items").select("id, name, unit, unit_price, kind"), "load library");
  const byNameUnit = new Map(lib2.map((i) => [`${i.name.trim().toLowerCase()}|${i.unit.trim().toLowerCase()}`, i]));
  const byName = new Map(lib2.map((i) => [i.name.trim().toLowerCase(), i]));
  const unmatched = /* @__PURE__ */ new Set();
  const payload = quotes.map((q) => {
    const matched = q.lines.map((l) => byNameUnit.get(`${l.itemName.toLowerCase()}|${l.unit.toLowerCase()}`) ?? byName.get(l.itemName.toLowerCase()));
    const totals = quoteTotals(q.lines.map((l, i) => ({ qty: l.qty, unitPrice: l.unitPrice, kind: matched[i]?.kind })), q.discountPct);
    return {
      code: q.code,
      client: q.client,
      service_group: q.serviceGroup,
      requested_at: new Date(q.requestedAt).toISOString(),
      sent_at: new Date(q.sentAt).toISOString(),
      discount_pct: q.discountPct,
      subtotal: totals.subtotal,
      total: totals.total,
      lines: q.lines.map((l, i) => {
        const item = matched[i];
        if (!item) unmatched.add(l.itemName);
        return { library_item_id: item?.id ?? null, item_name: l.itemName, unit: l.unit, qty: l.qty, unit_price: l.unitPrice, library_price: item ? Number(item.unit_price) : null, kind: item?.kind ?? "service" };
      })
    };
  });
  const firstRequested = quotes.length ? Math.min(...quotes.map((q) => q.requestedAt)) : null;
  const lastSent = quotes.length ? Math.max(...quotes.map((q) => q.sentAt)) : null;
  const summary = {
    quotes: payload.length,
    lines: payload.reduce((n, q) => n + q.lines.length, 0),
    errors,
    unmatchedItems: [...unmatched],
    // Shown back to the user so a day/month swap (US-style dates from Excel) is visible before saving.
    range: firstRequested === null ? null : { from: new Date(firstRequested).toISOString(), to: new Date(lastSent).toISOString() },
    sample: payload.slice(0, 3).map((q) => ({ code: q.code, requested_at: q.requested_at, sent_at: q.sent_at }))
  };
  if (body.dryRun) return { preview: summary };
  if (!payload.length) throw new ApiError(400, "nothing_to_import", "Kh\xF4ng c\xF3 b\xE1o gi\xE1 h\u1EE3p l\u1EC7 \u0111\u1EC3 nh\u1EADp.");
  const result = must(await ctx.db.rpc("ops_import_quotes", { p: { actor: user.id, quotes: payload } }), "import quotes");
  return { preview: summary, result };
}

// supabase/functions/ops-hub/jobs.ts
var ms = (v) => v ? Date.parse(v) : null;
async function heartbeat(ctx, key, summary) {
  const s = await loadSettings(ctx.db);
  const status = { ...s.system_status ?? {}, [key]: { at: new Date(ctx.now()).toISOString(), ...summary } };
  await ctx.db.from("settings").update({ system_status: status }).eq("id", 1);
}
async function dispatchCheckpoints(ctx) {
  const s = await loadSettings(ctx.db);
  const cal = calendarOf(s);
  const now = ctx.now();
  const tasks = must(
    await ctx.db.from("tasks").select("id, name, owner_id, status, due_at, closed_as").is("closed_as", null).neq("status", "cancelled"),
    "open tasks"
  );
  const cps = tasks.length ? must(
    await ctx.db.from("checkpoints").select("id, task_id, pct, scheduled_at, sent_at, answered_at, expired_at, no_reply_alerted_at, token").in("task_id", tasks.map((t) => t.id)),
    "checkpoints"
  ) : [];
  const rows = cps.map((c) => ({
    id: c.id,
    taskId: c.task_id,
    pct: c.pct,
    scheduledAt: Date.parse(c.scheduled_at),
    sentAt: ms(c.sent_at),
    answeredAt: ms(c.answered_at),
    expiredAt: ms(c.expired_at),
    noReplyAlertedAt: ms(c.no_reply_alerted_at)
  }));
  const taskRows = tasks.map((t) => ({ id: t.id, status: t.status, dueAt: Date.parse(t.due_at), closedAs: t.closed_as }));
  const plan2 = planDispatch({ now, cal, noReplyWindowHours: s.no_reply_window_hours, tasks: taskRows, checkpoints: rows });
  const nowIso = new Date(now).toISOString();
  const summary = { sent: 0, web_only: 0, expired: 0, no_reply: 0, alerts_sent: 0, approvals_sent: 0, can_send: plan2.canSend, retry: 0 };
  if (plan2.expire.length) {
    const ids = plan2.expire.map((c) => c.id);
    const done = must(await ctx.db.from("checkpoints").update({ expired_at: nowIso }).in("id", ids).is("expired_at", null).select("id"), "expire");
    summary.expired = done.length;
  }
  for (const cp of plan2.noReply) {
    const task = tasks.find((t) => t.id === cp.taskId);
    if (!task) continue;
    const alertId = must(
      await ctx.db.rpc("ops_no_reply", { p: { checkpoint_id: cp.id, new_status: statusAfterSilence(task.status), reason: `Kh\xF4ng tr\u1EA3 l\u1EDDi checkpoint ${cp.pct}% sau ${s.no_reply_window_hours} gi\u1EDD l\xE0m vi\u1EC7c` } }),
      "no reply"
    );
    if (alertId) {
      summary.no_reply++;
      if (await notifyAlert(ctx, alertId)) summary.alerts_sent++;
    }
  }
  for (const cp of plan2.send) {
    const task = tasks.find((t) => t.id === cp.taskId);
    const claimed = must(
      await ctx.db.from("checkpoints").update({ sent_at: nowIso, sent_via: "web" }).eq("id", cp.id).is("sent_at", null).is("expired_at", null).is("answered_at", null).select("id, token"),
      "claim checkpoint"
    );
    if (!claimed.length) continue;
    const idx = checkpointIndex(cp.pct);
    const ms4 = (await ctx.db.from("milestones").select("label").eq("task_id", task.id).eq("idx", idx).maybeSingle()).data;
    const text = checkpointText({ taskName: task.name, pct: cp.pct, idx, milestone: ms4?.label ?? `M\u1ED1c ${idx}`, dueAt: task.due_at, tz: cal.timeZone });
    const res = await ctx.notifier.send(task.owner_id, text, checkpointButtons(cp.id, claimed[0].token));
    if (res.delivered) {
      await ctx.db.from("checkpoints").update({ sent_via: "telegram", telegram_message_id: res.messageId ?? null }).eq("id", cp.id);
      summary.sent++;
    } else if (res.reason === "not_linked" || res.reason === "no_channel" || res.permanent) {
      summary.web_only++;
    } else {
      await ctx.db.from("checkpoints").update({ sent_at: null, sent_via: null }).eq("id", cp.id);
      summary.retry++;
    }
    await ctx.db.from("events").insert({
      actor: null,
      entity: "tasks",
      entity_id: task.id,
      action: "checkpoint.sent",
      payload: { checkpoint_id: cp.id, pct: cp.pct, via: res.delivered ? "telegram" : "web", telegram_error: res.delivered ? null : res.reason ?? null }
    });
  }
  if (plan2.canSend) {
    summary.alerts_sent += await deliverPendingAlerts(ctx);
    summary.approvals_sent = await deliverPendingApprovals(ctx);
  }
  await heartbeat(ctx, "dispatch", summary);
  return summary;
}
async function closeTasks(ctx) {
  const now = ctx.now();
  const tasks = must(
    await ctx.db.from("tasks").select("id, name, owner_id, status, due_at, closed_as").is("closed_as", null).neq("status", "cancelled").lte("due_at", new Date(now).toISOString()),
    "due tasks"
  );
  const due = tasksToClose(tasks.map((t) => ({ id: t.id, status: t.status, dueAt: Date.parse(t.due_at), closedAs: t.closed_as })), now);
  const summary = { closed: 0, on_time: 0, overdue: 0 };
  for (const t of due) {
    const milestones = must(await ctx.db.from("milestones").select("idx, done_at").eq("task_id", t.id).order("idx"), "milestones");
    const outcome = closeOutcome(milestones.map((m) => ms(m.done_at)), t.dueAt);
    let reason = null;
    if (outcome === "overdue") {
      const earlier = must(
        await ctx.db.from("alerts").select("id").eq("task_id", t.id).lt("created_at", new Date(t.dueAt).toISOString()).limit(1),
        "earlier alerts"
      );
      const done = milestones.filter((m) => m.done_at && Date.parse(m.done_at) <= t.dueAt).length;
      reason = `Tr\u1EC5 deadline, xong ${done}/4 m\u1ED1c. ${earlier.length ? "\u0110\xE3 c\xF3 c\u1EA3nh b\xE1o tr\u01B0\u1EDBc deadline." : "Kh\xF4ng c\xF3 c\u1EA3nh b\xE1o n\xE0o tr\u01B0\u1EDBc deadline."}`;
    }
    const res = must(
      await ctx.db.rpc("ops_close_task", { p: { task_id: t.id, closed_as: outcome, status: outcome === "on_time" ? "done" : "overdue", reason } }),
      "close task"
    );
    if (!res) continue;
    summary.closed++;
    if (outcome === "on_time") summary.on_time++;
    else summary.overdue++;
    if (res.alert_id) await notifyAlert(ctx, res.alert_id);
  }
  await heartbeat(ctx, "close", summary);
  return summary;
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
};
function apiOf(ctx, cfg) {
  if (!cfg.appId || !cfg.appSecret) throw new ApiError(400, "lark_config", "Ch\u01B0a c\xF3 App ID / App Secret c\u1EE7a Lark (Admin \u2192 S1 \xB7 Nh\u1EAFc task Lark \u2192 C\u1EA5u h\xECnh).");
  return new LarkApi(cfg.apiBase, cfg.appId, cfg.appSecret, ctx.fetchImpl ?? fetch);
}
var dueToLark = (dueDate) => ({ timestamp: String(Date.parse(`${dueDate}T00:00:00Z`)), is_all_day: true });
function dueFromLark(due, timeZone) {
  const ms2 = Number(due?.timestamp ?? 0);
  if (!ms2) return null;
  return due?.is_all_day ? new Date(ms2).toISOString().slice(0, 10) : localDateKey(ms2, timeZone);
}
var TASK_COLS = "id, kind, parent_id, code, parent_code, name, description, assignee_open_id, assignee_name, due_date, mode, lark_guid, lark_url, lark_title, completed_at, closed_at";
async function draftContext(ctx, cfg) {
  const rows = must(await ctx.db.from("lark_tasks").select("code, kind, due_date, name, id").is("deleted_at", null), "load lark codes");
  return {
    rows,
    ctx: {
      rules: cfg.rules,
      now: ctx.now(),
      timeZone: cfg.timeZone,
      existingCodes: new Set(rows.map((r) => normalizeCode(r.code))),
      parents: new Map(rows.filter((r) => r.kind === "parent").map((r) => [normalizeCode(r.code), { dueDate: r.due_date }]))
    }
  };
}
async function rememberPeople(ctx, people) {
  const rows = people.filter((p) => p.openId && p.name).map((p) => ({ open_id: p.openId, name: p.name, updated_at: (/* @__PURE__ */ new Date()).toISOString() }));
  if (rows.length) await ctx.db.from("lark_people").upsert(rows, { onConflict: "open_id" });
}
async function ensureSimPeople(ctx) {
  const profiles = must(await ctx.db.from("profiles").select("id, full_name, email").eq("active", true), "load profiles");
  const rows = profiles.map((p) => ({ open_id: `sim:${p.id}`, name: p.full_name || p.email, profile_id: p.id, updated_at: (/* @__PURE__ */ new Date()).toISOString() }));
  if (rows.length) must(await ctx.db.from("lark_people").upsert(rows, { onConflict: "open_id" }), "save people");
  return { people: rows.length };
}
async function createFromDraft(ctx, cfg, d, by) {
  const { ctx: dctx } = await draftContext(ctx, cfg);
  const code = normalizeCode(d.code);
  const draft = { ...d, code, parentCode: d.kind === "child" ? normalizeCode(d.parentCode || parentCodeOf(code, cfg.rules) || "") : null };
  const errors = validateDraft(draft, dctx);
  if (errors.length) return { ok: false, errors };
  let parent = null;
  if (draft.kind === "child") {
    parent = must(
      await ctx.db.from("lark_tasks").select(TASK_COLS).eq("kind", "parent").ilike("code", draft.parentCode).is("deleted_at", null).maybeSingle(),
      "load parent"
    );
    if (!parent) return { ok: false, errors: [`Ch\u01B0a c\xF3 task m\u1EB9 ${draft.parentCode}.`] };
  }
  const mode = cfg.mode;
  let guid = null;
  let url = null;
  const title = larkTitle(draft.kind, code, draft.name);
  if (mode === "live") {
    const api = apiOf(ctx, cfg);
    const body = {
      summary: title,
      description: draft.description ?? "",
      due: dueToLark(draft.dueDate),
      members: draft.assigneeOpenId ? [{ id: draft.assigneeOpenId, type: "user", role: "assignee" }] : [],
      client_token: crypto.randomUUID()
    };
    try {
      if (draft.kind === "parent") {
        const t = await api.createTask(body);
        guid = t.guid;
        url = t.url ?? null;
      } else {
        if (!parent.lark_guid) return { ok: false, errors: [`Task m\u1EB9 ${parent.code} \u0111\u01B0\u1EE3c t\u1EA1o \u1EDF ch\u1EBF \u0111\u1ED9 m\xF4 ph\u1ECFng, kh\xF4ng c\xF3 tr\xEAn Lark.`] };
        const t = await api.createSubtask(parent.lark_guid, body);
        guid = t.guid;
        url = t.url ?? null;
      }
    } catch (e) {
      return { ok: false, errors: [`Lark ch\u01B0a t\u1EA1o \u0111\u01B0\u1EE3c task: ${e.message}`] };
    }
  }
  const row = must(
    await ctx.db.from("lark_tasks").insert({
      kind: draft.kind,
      parent_id: parent?.id ?? null,
      code,
      parent_code: parent?.code ?? null,
      name: draft.name.trim(),
      description: draft.description ?? null,
      assignee_open_id: draft.assigneeOpenId,
      assignee_name: draft.assigneeName,
      due_date: draft.dueDate,
      mode,
      lark_guid: guid,
      lark_url: url,
      lark_title: title,
      source: by.source,
      created_by_open_id: by.openId ?? null,
      created_by: by.profileId ?? null,
      synced_at: mode === "live" ? new Date(ctx.now()).toISOString() : null
    }).select(TASK_COLS).single(),
    "save lark task"
  );
  return { ok: true, errors: [], task: row };
}
function createdMessage(t) {
  const lines = [
    { icon: t.kind === "parent" ? "\u{1F4CC}" : "\u{1F538}", label: t.kind === "parent" ? "Task m\u1EB9" : "Task con", text: larkTitle(t.kind, t.code, t.name) },
    { icon: "\u{1F464}", label: t.kind === "parent" ? "Ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch" : "Ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n", text: t.assignee_name ?? "", mentionOpenId: t.assignee_open_id },
    { icon: "\u23F0", label: "Deadline", text: fmtDueDate(t.due_date) }
  ];
  if (t.lark_url) lines.push({ icon: "\u{1F517}", text: `[M\u1EDF tr\xEAn Lark Tasks](${t.lark_url})` });
  return {
    tone: "green",
    title: t.kind === "parent" ? "\u2705 \u0110\xE3 t\u1EA1o task m\u1EB9" : "\u2705 \u0110\xE3 t\u1EA1o task con",
    lines,
    note: t.kind === "parent" ? `T\u1EA1o task con: /taomoi con ${t.code}-01-S01 | \u2026 | @ng\u01B0\u1EDDi | deadline` : "Bot s\u1EBD nh\u1EAFc trong group t\u1EEB D-3 \u0111\u1EBFn khi task Completed."
  };
}
async function createLarkTaskFromWeb(ctx, user, body) {
  const cfg = await loadLarkConfig(ctx);
  const openId = String(body.assignee_open_id ?? "") || null;
  let name = null;
  if (openId) {
    const p = must(await ctx.db.from("lark_people").select("name").eq("open_id", openId).maybeSingle(), "load person");
    name = p?.name ?? null;
  }
  const draft = {
    kind: body.kind === "child" ? "child" : "parent",
    code: String(body.code ?? ""),
    name: String(body.name ?? ""),
    assigneeOpenId: openId,
    assigneeName: name,
    dueDate: body.due_date ? String(body.due_date) : null,
    description: body.description ? String(body.description) : null,
    parentCode: body.parent_code ? String(body.parent_code) : null
  };
  if (body.dry_run) {
    const { ctx: dctx } = await draftContext(ctx, cfg);
    const d = { ...draft, code: normalizeCode(draft.code), parentCode: draft.kind === "child" ? normalizeCode(draft.parentCode || parentCodeOf(normalizeCode(draft.code), cfg.rules) || "") : null };
    return { ok: true, errors: validateDraft(d, dctx), mode: cfg.mode };
  }
  const res = await createFromDraft(ctx, cfg, draft, { profileId: user.id, source: "web" });
  if (!res.ok) throw new ApiError(400, "invalid", res.errors.join(" "));
  return { ok: true, task: res.task, mode: cfg.mode };
}
var LEADING_MENTIONS = /^(\s*@_user_\d+\s*)+/;
async function onMessage(ctx, cfg, ev, api) {
  const message = ev.message ?? {};
  const sender = ev.sender?.sender_id?.open_id ?? "";
  const reply = (m) => api.replyCard(message.message_id, toLarkCard(m)).catch((e) => console.error("lark reply failed", e));
  if (message.message_type !== "text") return reply({ tone: "blue", title: "H\u01B0\u1EDBng d\u1EABn t\u1EA1o task", lines: [{ icon: "\u2139\uFE0F", text: LARK_HELP_TEXT }] });
  const raw = String(JSON.parse(message.content ?? "{}").text ?? "");
  const mentions = (message.mentions ?? []).map((m) => ({ key: m.key, openId: m.id?.open_id ?? "", name: m.name ?? "" })).filter((m) => m.openId);
  await rememberPeople(ctx, mentions);
  const text = raw.replace(LEADING_MENTIONS, "").trim();
  const low = text.toLowerCase().normalize("NFC");
  if (/^(xác nhận|xac nhan|ok|đồng ý|dong y|yes)$/.test(low) || /^(huỷ|hủy|huy|cancel)$/.test(low)) {
    const pending = must(
      await ctx.db.from("lark_drafts").select("id, open_id, draft, status").eq("open_id", sender).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      "load draft"
    );
    if (!pending) return reply({ tone: "grey", title: "Kh\xF4ng c\xF3 b\u1EA3n nh\xE1p n\xE0o \u0111ang ch\u1EDD", lines: [{ icon: "\u2139\uFE0F", text: "G\u1EEDi l\u1EC7nh /taomoi \u0111\u1EC3 t\u1EA1o task." }] });
    return reply(await settleDraft(ctx, cfg, pending, sender, /^(huỷ|hủy|huy|cancel)$/.test(low) ? "cancel" : "confirm"));
  }
  const parsed = parseCreateCommand(text, mentions, ctx.now(), cfg.timeZone);
  if (parsed.help || !parsed.draft) return reply({ tone: "blue", title: "H\u01B0\u1EDBng d\u1EABn t\u1EA1o task", lines: [{ icon: "\u2139\uFE0F", text: LARK_HELP_TEXT }] });
  const d = parsed.draft;
  if (d.kind === "child") d.parentCode = parentCodeOf(d.code, cfg.rules);
  const { ctx: dctx, rows } = await draftContext(ctx, cfg);
  const errors = [...parsed.errors, ...validateDraft(d, dctx)];
  if (errors.length) return reply(errorMessage(d.kind === "parent" ? "Ch\u01B0a t\u1EA1o task m\u1EB9" : "Ch\u01B0a t\u1EA1o task con", errors));
  const saved = must(await ctx.db.from("lark_drafts").insert({ open_id: sender, draft: d }).select("id").single(), "save draft");
  const parentName = d.kind === "child" ? rows.find((r) => r.kind === "parent" && normalizeCode(r.code) === normalizeCode(d.parentCode ?? ""))?.name : null;
  return reply(draftPreviewMessage(d, saved.id, parentName));
}
async function settleDraft(ctx, cfg, row, operator, op) {
  if (row.status !== "pending") return { tone: "grey", title: "B\u1EA3n nh\xE1p n\xE0y \u0111\xE3 \u0111\u01B0\u1EE3c x\u1EED l\xFD", lines: [{ icon: "\u2139\uFE0F", text: "G\u1EEDi l\u1EC7nh /taomoi m\u1EDBi n\u1EBFu c\u1EA7n." }] };
  if (row.open_id !== operator) return { tone: "red", title: "Ch\u1EC9 ng\u01B0\u1EDDi g\u1EEDi l\u1EC7nh m\u1EDBi x\xE1c nh\u1EADn \u0111\u01B0\u1EE3c", lines: [] };
  if (op === "cancel") {
    await ctx.db.from("lark_drafts").update({ status: "cancelled" }).eq("id", row.id).eq("status", "pending");
    return { tone: "grey", title: "\u0110\xE3 hu\u1EF7, kh\xF4ng t\u1EA1o task", lines: [{ icon: "\u{1F5D1}\uFE0F", text: normalizeCode(row.draft.code) }] };
  }
  const claimed = must(await ctx.db.from("lark_drafts").update({ status: "confirmed" }).eq("id", row.id).eq("status", "pending").select("id"), "claim draft");
  if (!claimed.length) return { tone: "grey", title: "B\u1EA3n nh\xE1p n\xE0y \u0111\xE3 \u0111\u01B0\u1EE3c x\u1EED l\xFD", lines: [] };
  const res = await createFromDraft(ctx, cfg, row.draft, { openId: operator, source: "bot" });
  if (!res.ok) {
    await ctx.db.from("lark_drafts").update({ status: "cancelled" }).eq("id", row.id);
    return errorMessage("Ch\u01B0a t\u1EA1o \u0111\u01B0\u1EE3c task", res.errors);
  }
  await ctx.db.from("lark_drafts").update({ task_id: res.task.id }).eq("id", row.id);
  return createdMessage(res.task);
}
async function handleLarkEvent(ctx, req) {
  const body = await req.json().catch(() => ({}));
  const cfg = await loadLarkConfig(ctx);
  if (body.encrypt) throw new ApiError(400, "encrypted", "H\xE3y \u0111\u1EC3 tr\u1ED1ng Encrypt Key trong Lark Developer Console (Events & Callbacks).");
  const token = body.header?.token ?? body.token;
  if (!cfg.verificationToken || !safeEqual(token, cfg.verificationToken)) throw new ApiError(401, "unauthorized", "Wrong Lark verification token");
  if (body.type === "url_verification") return { challenge: body.challenge };
  if (cfg.mode !== "live") return { ok: true, ignored: "simulation mode" };
  const eventId = body.header?.event_id;
  if (eventId) {
    const { error } = await ctx.db.from("lark_events").insert({ event_id: eventId, event_type: body.header?.event_type ?? null });
    if (error) return { ok: true, duplicate: true };
  }
  const api = apiOf(ctx, cfg);
  const type = body.header?.event_type;
  if (type === "im.message.receive_v1") {
    await onMessage(ctx, cfg, body.event ?? {}, api);
    return { ok: true };
  }
  const isNew = type === "card.action.trigger";
  const operator = isNew ? String((body.event?.operator ?? {}).open_id ?? "") : String(body.open_id ?? "");
  const value = isNew ? (body.event?.action ?? {}).value : body.action?.value;
  if (value?.draft) {
    const row = must(await ctx.db.from("lark_drafts").select("id, open_id, draft, status").eq("id", value.draft).maybeSingle(), "load draft");
    const msg = row ? await settleDraft(ctx, cfg, row, operator, value.op === "cancel" ? "cancel" : "confirm") : { tone: "grey", title: "Kh\xF4ng t\xECm th\u1EA5y b\u1EA3n nh\xE1p", lines: [] };
    const card = toLarkCard(msg);
    return isNew ? { toast: { type: msg.tone === "red" ? "error" : "success", content: msg.title }, card: { type: "raw", data: card } } : card;
  }
  return { ok: true };
}
function localHM(now, timeZone) {
  const p = toLocalParts(now, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}
async function syncFromLark(ctx, cfg, api, t) {
  const lt = await api.getTask(t.lark_guid);
  const title = lt.summary ?? t.lark_title ?? "";
  const found = findCodeInTitle(title, t.kind, cfg.rules);
  const assignee = (lt.members ?? []).find((m) => m.role === "assignee");
  const due = dueFromLark(lt.due, cfg.timeZone) ?? t.due_date;
  const completedMs = Number(lt.completed_at ?? 0);
  let assigneeName = t.assignee_name;
  if (assignee && assignee.id !== t.assignee_open_id) {
    const p = must(await ctx.db.from("lark_people").select("name").eq("open_id", assignee.id).maybeSingle(), "load person");
    assigneeName = assignee.name ?? p?.name ?? null;
  }
  const code = found ?? (title.match(/\(([^()]+)\)\s*$/)?.[1] ?? title.match(/^\s*\[([^\]]+)\]/)?.[1] ?? t.code);
  const patch = {
    lark_title: title,
    name: stripCodeFromTitle(title, code) || t.name,
    code: normalizeCode(code),
    due_date: due,
    assignee_open_id: assignee?.id ?? t.assignee_open_id,
    assignee_name: assigneeName,
    completed_at: completedMs ? new Date(completedMs).toISOString() : null,
    lark_url: lt.url ?? t.lark_url,
    synced_at: new Date(ctx.now()).toISOString()
  };
  return must(await ctx.db.from("lark_tasks").update(patch).eq("id", t.id).select(TASK_COLS).single(), "save sync");
}
var MAX_ATTEMPTS = 5;
async function claim(ctx, taskId, today, kind, msg, milestone, assignee) {
  const base = { task_id: taskId, local_date: today, kind, milestone, assignee_open_id: assignee, message: msg };
  const ins = await ctx.db.from("lark_notifications").insert({ ...base, status: "failed", attempts: 1, last_error: "\u0111ang g\u1EEDi" }).select("id, task_id, kind, status, attempts").maybeSingle();
  if (!ins.error && ins.data) return ins.data;
  const cur = must(await ctx.db.from("lark_notifications").select("id, task_id, kind, status, attempts").eq("task_id", taskId).eq("local_date", today).eq("kind", kind).maybeSingle(), "load notification");
  if (!cur || cur.status !== "failed" || cur.attempts >= MAX_ATTEMPTS) return null;
  const upd = must(
    await ctx.db.from("lark_notifications").update({ attempts: cur.attempts + 1, message: msg, milestone, assignee_open_id: assignee }).eq("id", cur.id).eq("attempts", cur.attempts).select("id, task_id, kind, status, attempts"),
    "claim retry"
  );
  return upd[0] ?? null;
}
async function deliver(ctx, cfg, api, slot, msg, today) {
  try {
    let messageId = null;
    if (cfg.mode === "live") {
      if (!cfg.chatId) throw new Error("Ch\u01B0a c\u1EA5u h\xECnh group Lark nh\u1EADn th\xF4ng b\xE1o (chat_id).");
      const r = await api.sendCard(cfg.chatId, toLarkCard(msg), `${slot.id.slice(0, 18)}-${today}-${slot.attempts}`);
      messageId = r.message_id;
    }
    must(
      await ctx.db.from("lark_notifications").update({ status: cfg.mode === "live" ? "sent" : "simulated", last_error: null, sent_at: new Date(ctx.now()).toISOString(), lark_message_id: messageId }).eq("id", slot.id),
      "save notification"
    );
    return true;
  } catch (e) {
    await ctx.db.from("lark_notifications").update({ status: "failed", last_error: e.message.slice(0, 500) }).eq("id", slot.id);
    return false;
  }
}
async function larkTick(ctx, opts = {}) {
  const cfg = await loadLarkConfig(ctx);
  const now = ctx.now();
  const today = localDateKey(now, cfg.timeZone);
  const res = { mode: cfg.mode, today, synced: 0, syncErrors: 0, reminders: 0, completions: 0, failed: 0, waitingForTime: 0 };
  let api = null;
  if (cfg.mode === "live") {
    if (!cfg.appId || !cfg.appSecret) {
      res.note = "Ch\u1EBF \u0111\u1ED9 th\u1EADt nh\u01B0ng thi\u1EBFu App ID / App Secret: kh\xF4ng g\u1EEDi.";
      await saveStatus(ctx, res);
      return res;
    }
    api = new LarkApi(cfg.apiBase, cfg.appId, cfg.appSecret, ctx.fetchImpl ?? fetch);
  }
  let tasks = must(await ctx.db.from("lark_tasks").select(TASK_COLS).is("closed_at", null).is("deleted_at", null), "load open lark tasks");
  if (api) {
    const synced = [];
    for (const t of tasks) {
      if (t.mode !== "live" || !t.lark_guid) continue;
      try {
        synced.push(await syncFromLark(ctx, cfg, api, t));
        res.synced++;
      } catch (e) {
        res.syncErrors++;
        console.error("lark sync failed", t.code, e.message);
        synced.push(t);
      }
    }
    tasks = synced;
  } else tasks = tasks.filter((t) => t.mode === "simulation");
  const parents = new Map(
    must(await ctx.db.from("lark_tasks").select("id, code, name").eq("kind", "parent"), "load parents").map((p) => [p.id, p])
  );
  const todays = must(await ctx.db.from("lark_notifications").select("task_id, kind, status, attempts").eq("local_date", today), "load today");
  const done = new Set(todays.filter((n) => n.status !== "failed" || n.attempts >= MAX_ATTEMPTS).map((n) => `${n.task_id}|${n.kind}`));
  const inWindow = opts.force || localHM(now, cfg.timeZone) >= cfg.notifyTime;
  const schedule = { ...DEFAULT_LARK_SCHEDULE, notifyD0: cfg.notifyD0 };
  for (const t of tasks.filter((x) => x.kind === "child")) {
    const p = t.parent_id ? parents.get(t.parent_id) : void 0;
    const tracked = {
      parentCode: p?.code ?? t.parent_code ?? "",
      parentName: p ? stripCodeFromTitle(p.name, p.code) : "",
      childCode: t.code,
      childName: t.name,
      assigneeOpenId: t.assignee_open_id,
      assigneeName: t.assignee_name,
      dueDate: t.due_date,
      completedAt: t.completed_at ? Date.parse(t.completed_at) : null,
      closedAt: t.closed_at ? Date.parse(t.closed_at) : null
    };
    const action = decideLarkAction(tracked, now, cfg.timeZone, { rules: cfg.rules, schedule, sentToday: done.has(`${t.id}|reminder`) });
    const codeErrors = [...checkParentCode(tracked.parentCode, cfg.rules), ...checkChildCode(t.code, tracked.parentCode, cfg.rules)];
    await ctx.db.from("lark_tasks").update({ code_errors: codeErrors }).eq("id", t.id);
    if (action.type === "complete") {
      if (done.has(`${t.id}|completion`)) continue;
      const msg = completionMessage(tracked, cfg.timeZone);
      const slot = await claim(ctx, t.id, today, "completion", msg, "DONE", t.assignee_open_id);
      if (!slot) continue;
      if (await deliver(ctx, cfg, api, slot, msg, today)) {
        res.completions++;
        await ctx.db.from("lark_tasks").update({ closed_at: new Date(now).toISOString() }).eq("id", t.id);
      } else res.failed++;
    } else if (action.type === "remind") {
      if (!inWindow) {
        res.waitingForTime++;
        continue;
      }
      const msg = reminderMessage(tracked, action.milestone, action.codeErrors);
      const slot = await claim(ctx, t.id, today, "reminder", msg, action.milestone.label, t.assignee_open_id);
      if (!slot) continue;
      if (await deliver(ctx, cfg, api, slot, msg, today)) res.reminders++;
      else res.failed++;
    }
  }
  await saveStatus(ctx, res);
  return res;
}
async function saveStatus(ctx, res) {
  await ctx.db.from("settings").update({ lark_status: { ...res, at: new Date(ctx.now()).toISOString() } }).eq("id", 1);
}
var MANAGERS = ["admin", "ecom_exec", "pm", "ceo"];
async function simulateLark(ctx, user, body) {
  const t = must(await ctx.db.from("lark_tasks").select(TASK_COLS).eq("id", String(body.task_id ?? "")).maybeSingle(), "load task");
  if (!t) throw new ApiError(404, "not_found", "Kh\xF4ng t\xECm th\u1EA5y task.");
  if (t.mode !== "simulation") throw new ApiError(400, "live", "Task n\xE0y n\u1EB1m tr\xEAn Lark th\u1EADt: h\xE3y s\u1EEDa tr\xEAn Lark Tasks, h\u1EC7 th\u1ED1ng t\u1EF1 \u0111\u1ED3ng b\u1ED9.");
  const own2 = t.assignee_open_id === `sim:${user.id}`;
  if (!own2 && !MANAGERS.includes(user.role)) throw new ApiError(403, "forbidden", "Ch\u1EC9 ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n ho\u1EB7c qu\u1EA3n l\xFD m\u1EDBi l\xE0m \u0111\u01B0\u1EE3c.");
  const patch = {};
  switch (body.op) {
    case "complete":
      patch.completed_at = new Date(ctx.now()).toISOString();
      break;
    case "reopen":
      patch.completed_at = null;
      patch.closed_at = null;
      break;
    case "set_due":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.due_date ?? ""))) throw new ApiError(400, "invalid", "Ng\xE0y kh\xF4ng h\u1EE3p l\u1EC7.");
      patch.due_date = body.due_date;
      break;
    case "set_assignee": {
      const p = must(await ctx.db.from("lark_people").select("open_id, name").eq("open_id", String(body.open_id ?? "")).maybeSingle(), "load person");
      if (!p) throw new ApiError(400, "invalid", "Kh\xF4ng t\xECm th\u1EA5y ng\u01B0\u1EDDi n\xE0y.");
      patch.assignee_open_id = p.open_id;
      patch.assignee_name = p.name;
      break;
    }
    case "set_code":
      patch.code = normalizeCode(String(body.code ?? ""));
      patch.lark_title = larkTitle(t.kind, String(patch.code), t.name);
      break;
    default:
      throw new ApiError(400, "unknown_op", "Thao t\xE1c kh\xF4ng h\u1EE3p l\u1EC7.");
  }
  must(await ctx.db.from("lark_tasks").update(patch).eq("id", t.id), "save simulation");
  return { ok: true };
}
async function larkAdminStatus(ctx, user) {
  if (user.role !== "admin") throw new ApiError(403, "forbidden", "Ch\u1EC9 admin.");
  const cfg = await loadLarkConfig(ctx);
  return {
    mode: cfg.mode,
    hasAppSecret: !!cfg.appSecret,
    hasVerificationToken: !!cfg.verificationToken,
    eventsUrl: `${ctx.env.functionsBase}/ops-hub/lark-events`,
    rulesErrors: validateCodeRules(cfg.rules)
  };
}
async function saveLarkConfig(ctx, user, body) {
  if (user.role !== "admin") throw new ApiError(403, "forbidden", "Ch\u1EC9 admin.");
  const str = (k) => body[k] === void 0 ? void 0 : String(body[k]).trim();
  const patch = {};
  for (const k of ["lark_api_base", "lark_app_id", "lark_chat_id", "lark_parent_pattern", "lark_child_pattern", "lark_parent_example", "lark_child_example", "lark_notify_time"]) {
    const v = str(k);
    if (v !== void 0) patch[k] = v;
  }
  if (body.lark_mode !== void 0) patch.lark_mode = body.lark_mode === "live" ? "live" : "simulation";
  if (body.lark_notify_d0 !== void 0) patch.lark_notify_d0 = !!body.lark_notify_d0;
  if (patch.lark_notify_time !== void 0 && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch.lark_notify_time))) throw new ApiError(400, "invalid", "Gi\u1EDD g\u1EEDi ph\u1EA3i d\u1EA1ng HH:MM.");
  const cfg = await loadLarkConfig(ctx);
  const rules = {
    parentPattern: String(patch.lark_parent_pattern ?? cfg.rules.parentPattern),
    childPattern: String(patch.lark_child_pattern ?? cfg.rules.childPattern),
    parentExample: String(patch.lark_parent_example ?? cfg.rules.parentExample),
    childExample: String(patch.lark_child_example ?? cfg.rules.childExample)
  };
  const errs = validateCodeRules(rules);
  if (errs.length) throw new ApiError(400, "invalid", errs.join(" "));
  if (Object.keys(patch).length) must(await ctx.db.from("settings").update(patch).eq("id", 1), "save lark settings");
  for (const [k, name] of [
    ["app_secret", "lark_app_secret"],
    ["verification_token", "lark_verification_token"]
  ]) {
    const v = str(k);
    if (v) must(await ctx.db.rpc("ops_set_lark_secret", { p_name: name, p_value: v }), "save lark secret");
  }
  return larkAdminStatus(ctx, user);
}
async function testLark(ctx, user) {
  if (user.role !== "admin") throw new ApiError(403, "forbidden", "Ch\u1EC9 admin.");
  const cfg = await loadLarkConfig(ctx);
  if (cfg.mode !== "live") return { ok: true, note: "\u0110ang \u1EDF ch\u1EBF \u0111\u1ED9 m\xF4 ph\u1ECFng: kh\xF4ng g\u1ECDi Lark." };
  const api = apiOf(ctx, cfg);
  await api.token();
  if (!cfg.chatId) return { ok: true, note: "App ID / Secret \u0111\xFAng. Ch\u01B0a c\xF3 chat_id c\u1EE7a group n\xEAn ch\u01B0a g\u1EEDi th\u1EED." };
  await api.sendCard(cfg.chatId, toLarkCard({ tone: "blue", title: "Go Media Ops Hub \u0111\xE3 k\u1EBFt n\u1ED1i", lines: [{ icon: "\u2705", text: "Bot s\u1EBD nh\u1EAFc task trong group n\xE0y l\xFAc " + cfg.notifyTime + " m\u1ED7i ng\xE0y." }] }), crypto.randomUUID().slice(0, 32));
  return { ok: true, note: "\u0110\xE3 g\u1EEDi tin th\u1EED v\xE0o group." };
}
async function runLarkNow(ctx, user) {
  if (!MANAGERS.includes(user.role)) throw new ApiError(403, "forbidden", "Ch\u1EC9 qu\u1EA3n l\xFD ho\u1EB7c admin.");
  return larkTick(ctx, { force: true });
}

// supabase/functions/ops-hub/notify.ts
function telegramChannel(api) {
  return {
    name: "telegram",
    async deliver(chatId, text, buttons) {
      const keyboard = buttons?.map((row) => row.map((b) => b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? "" }));
      const res = await api.sendMessage(chatId, text, keyboard);
      if (res.ok) return { delivered: true, messageId: res.result?.message_id };
      const permanent = res.error_code === 403 || res.error_code === 400 && /chat not found|user is deactivated/i.test(res.description ?? "");
      return { delivered: false, permanent, reason: res.description };
    }
  };
}
function makeChannel(api) {
  return api ? telegramChannel(api) : null;
}
var Notifier = class {
  constructor(db, channel) {
    this.db = db;
    this.channel = channel;
  }
  get enabled() {
    return this.channel !== null;
  }
  /** send(userId, text, buttons): delivers to the user's linked chat; false when not linked. */
  async send(userId, text, buttons) {
    if (!this.channel) return { delivered: false, reason: "no_channel" };
    const { data } = await this.db.from("profiles").select("telegram_chat_id, active").eq("id", userId).maybeSingle();
    const chatId = data?.telegram_chat_id;
    if (!chatId || data?.active === false) return { delivered: false, reason: "not_linked" };
    const res = await this.channel.deliver(Number(chatId), text, buttons);
    if (!res.delivered && res.permanent) {
      await this.db.from("profiles").update({ telegram_chat_id: null }).eq("id", userId);
    }
    return res;
  }
  /** Sends to every active user with one of the roles; returns how many received it. */
  async sendToRoles(roles, text, buttons) {
    const { data } = await this.db.from("profiles").select("id").in("role", roles).eq("active", true);
    let n = 0;
    for (const p of data ?? []) if ((await this.send(p.id, text, buttons)).delivered) n++;
    return n;
  }
};

// supabase/functions/ops-hub/telegram.ts
var TelegramApi = class {
  constructor(token, base = "https://api.telegram.org", fetchImpl = fetch) {
    this.token = token;
    this.base = base;
    this.fetchImpl = fetchImpl;
  }
  async call(method, body = {}) {
    try {
      const res = await this.fetchImpl(`${this.base}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
      if (!data.ok && data.error_code === void 0) data.error_code = res.status;
      return data;
    } catch (err) {
      return { ok: false, description: err.message, error_code: 0 };
    }
  }
  sendMessage(chatId, text, keyboard, extra = {}) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {},
      ...extra
    });
  }
  askForReply(chatId, text, placeholder) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: { force_reply: true, input_field_placeholder: placeholder }
    });
  }
  clearButtons(chatId, messageId) {
    return this.call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  }
  answerCallback(id, text) {
    return this.call("answerCallbackQuery", { callback_query_id: id, text: text.slice(0, 190) });
  }
  getMe() {
    return this.call("getMe");
  }
  getWebhookInfo() {
    return this.call("getWebhookInfo");
  }
  setWebhook(url, secretToken) {
    return this.call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
      max_connections: 10
    });
  }
};
async function deriveWebhookSecret(botToken) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(botToken), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("go-media-ops-hub/telegram-webhook"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// supabase/functions/ops-hub/system.ts
var ROLES = Object.keys(ROLE_LABEL);
async function inviteUser(ctx, user, body) {
  requireRole(user, "admin");
  const email = String(body.email ?? "").trim().toLowerCase();
  const fullName = String(body.full_name ?? "").trim();
  const role = String(body.role ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "bad_email", "Email kh\xF4ng h\u1EE3p l\u1EC7.");
  if (!ROLES.includes(role)) throw new ApiError(400, "bad_role", "Vai tr\xF2 kh\xF4ng h\u1EE3p l\u1EC7.");
  const { data, error } = await ctx.db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { ops_role: role },
    user_metadata: { full_name: fullName }
  });
  if (error) {
    if (/already|exists|registered/i.test(error.message)) throw new ApiError(409, "exists", "Email n\xE0y \u0111\xE3 c\xF3 t\xE0i kho\u1EA3n. \u0110\u1ED5i vai tr\xF2 \u1EDF b\u1EA3ng b\xEAn d\u01B0\u1EDBi.");
    throw new ApiError(400, "invite_failed", `Kh\xF4ng t\u1EA1o \u0111\u01B0\u1EE3c t\xE0i kho\u1EA3n: ${error.message}`);
  }
  const id = data.user.id;
  must(await ctx.db.from("profiles").update({ full_name: fullName, role, active: true }).eq("id", id).select("id"), "set profile");
  await ctx.db.from("events").insert({ actor: user.id, entity: "profiles", entity_id: id, action: "user.invited", payload: { email, role } });
  return { user_id: id };
}
function expectedWebhookUrl(ctx) {
  return `${ctx.env.functionsBase}/ops-hub/telegram-webhook`;
}
async function systemHealth(ctx, user) {
  requireRole(user, "admin");
  const s = await loadSettings(ctx.db);
  const cron = await ctx.db.rpc("ops_cron_secret");
  const telegram = { configured: !!ctx.tg };
  if (ctx.tg) {
    const [me, hook] = await Promise.all([ctx.tg.getMe(), ctx.tg.getWebhookInfo()]);
    telegram.tokenValid = me.ok;
    telegram.username = me.result?.username ?? null;
    telegram.webhookUrl = hook.result?.url ?? null;
    telegram.webhookExpected = expectedWebhookUrl(ctx);
    telegram.webhookOk = hook.ok && hook.result?.url === expectedWebhookUrl(ctx);
    telegram.pending = hook.result?.pending_update_count ?? null;
    telegram.lastError = hook.result?.last_error_message ?? null;
    telegram.lastErrorAt = hook.result?.last_error_date ? new Date(hook.result.last_error_date * 1e3).toISOString() : null;
    if (me.ok && me.result?.username && me.result.username !== s.telegram_bot_username) {
      await ctx.db.from("settings").update({ telegram_bot_username: me.result.username }).eq("id", 1);
    }
  }
  return {
    domainVersion: DOMAIN_VERSION,
    cases: runDomainCases(),
    appEnv: ctx.env.appEnv,
    cronSecretConfigured: !cron.error && !!cron.data,
    telegram,
    systemStatus: s.system_status ?? {},
    serverTime: new Date(ctx.now()).toISOString()
  };
}
async function connectTelegram(ctx, user) {
  requireRole(user, "admin");
  if (!ctx.tg || !ctx.env.telegramToken) throw new ApiError(400, "no_token", "Ch\u01B0a c\xF3 TELEGRAM_BOT_TOKEN trong Edge Function Secrets.");
  const me = await ctx.tg.getMe();
  if (!me.ok) throw new ApiError(400, "bad_token", `Token Telegram kh\xF4ng h\u1EE3p l\u1EC7: ${me.description ?? ""}`);
  const secret = ctx.env.webhookSecretOverride ?? await deriveWebhookSecret(ctx.env.telegramToken);
  const url = expectedWebhookUrl(ctx);
  const res = await ctx.tg.setWebhook(url, secret);
  if (!res.ok) throw new ApiError(400, "webhook_failed", `Telegram t\u1EEB ch\u1ED1i webhook: ${res.description ?? ""}`);
  await ctx.db.from("settings").update({ telegram_bot_username: me.result?.username ?? null }).eq("id", 1);
  await ctx.db.from("events").insert({ actor: user.id, entity: "settings", entity_id: "1", action: "telegram.webhook_set", payload: { url, username: me.result?.username } });
  return { ok: true, url, username: me.result?.username ?? null };
}
async function testMessage(ctx, user) {
  const res = await ctx.notifier.send(user.id, `Tin nh\u1EAFn th\u1EED t\u1EEB <b>Go Media Ops Hub</b>.
T\xE0i kho\u1EA3n: ${user.full_name || user.email} (${ROLE_LABEL[user.role]}). Bot \u0111\xE3 nh\u1EAFn \u0111\u01B0\u1EE3c cho b\u1EA1n.`);
  if (!res.delivered) {
    const why = res.reason === "not_linked" ? "B\u1EA1n ch\u01B0a li\xEAn k\u1EBFt Telegram." : res.reason === "no_channel" ? "M\xE1y ch\u1EE7 ch\u01B0a c\xF3 token bot." : `Telegram b\xE1o l\u1ED7i: ${res.reason ?? ""}`;
    throw new ApiError(400, "not_delivered", why);
  }
  return { ok: true };
}

// supabase/functions/ops-hub/answers.ts
function cleanUrl(u) {
  const s = (u ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\/\S+$/i.test(s)) throw new ApiError(400, "bad_url", "Link b\u1EB1ng ch\u1EE9ng ph\u1EA3i b\u1EAFt \u0111\u1EA7u b\u1EB1ng http:// ho\u1EB7c https://");
  return s.slice(0, 1e3);
}
async function applyAnswer(ctx, req) {
  const evidence = cleanUrl(req.evidenceUrl);
  for (let attempt = 0; attempt < 3; attempt++) {
    let cp = null;
    if (req.checkpointId) {
      cp = must(
        await ctx.db.from("checkpoints").select("id, task_id, pct, sent_at, answered_at, expired_at, token").eq("id", req.checkpointId).maybeSingle(),
        "load checkpoint"
      );
      if (!cp) throw new ApiError(404, "checkpoint_not_found", "Kh\xF4ng t\xECm th\u1EA5y checkpoint.");
      if (req.via === "telegram" && !safeEqual(cp.token, req.token ?? "")) throw new ApiError(403, "bad_token", "N\xFAt n\xE0y kh\xF4ng c\xF2n hi\u1EC7u l\u1EF1c.");
      if (cp.answered_at) throw new ApiError(409, "already_answered", "Checkpoint n\xE0y \u0111\xE3 \u0111\u01B0\u1EE3c tr\u1EA3 l\u1EDDi r\u1ED3i.");
      if (cp.expired_at) throw new ApiError(409, "checkpoint_expired", "Checkpoint n\xE0y \u0111\xE3 h\u1EBFt hi\u1EC7u l\u1EF1c. H\xE3y tr\u1EA3 l\u1EDDi checkpoint m\u1EDBi nh\u1EA5t.");
      if (!cp.sent_at) throw new ApiError(409, "checkpoint_not_sent", "Checkpoint n\xE0y ch\u01B0a \u0111\u1EBFn gi\u1EDD.");
    }
    const taskId = cp?.task_id ?? req.taskId;
    if (!taskId) throw new ApiError(400, "task_required", "Thi\u1EBFu task.");
    const task = must(
      await ctx.db.from("tasks").select("id, name, owner_id, status, due_at, closed_as").eq("id", taskId).maybeSingle(),
      "load task"
    );
    if (!task) throw new ApiError(404, "task_not_found", "Kh\xF4ng t\xECm th\u1EA5y task.");
    if (task.owner_id !== req.actorId) throw new ApiError(403, "not_owner", "Ch\u1EC9 ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch task m\u1EDBi tr\u1EA3 l\u1EDDi \u0111\u01B0\u1EE3c.");
    if (task.closed_as || task.status === "cancelled" || task.status === "overdue") throw new ApiError(409, "task_closed", "Task \u0111\xE3 \u0111\xF3ng.");
    if (!cp && req.answer === "blocked") {
      const pending = must(
        await ctx.db.from("checkpoints").select("id, task_id, pct, sent_at, answered_at, expired_at, token").eq("task_id", task.id).not("sent_at", "is", null).is("answered_at", null).is("expired_at", null).order("pct", { ascending: false }).limit(1),
        "pending checkpoint"
      );
      cp = pending[0] ?? null;
    }
    const milestones = must(await ctx.db.from("milestones").select("idx, done_at").eq("task_id", task.id), "load milestones");
    const doneCount = milestones.filter((m) => m.done_at).length;
    const k = cp ? checkpointIndex(cp.pct) : null;
    let effect;
    try {
      effect = answerEffect({ doneCount, status: task.status }, k, req.answer, req.reason);
    } catch (err) {
      const m = err.message;
      throw new ApiError(400, "invalid_answer", /reason/.test(m) ? "H\xE3y nh\u1EADp l\xFD do b\u1ECB ch\u1EB7n." : m);
    }
    const res = await ctx.db.rpc("ops_apply_answer", {
      p: {
        task_id: task.id,
        checkpoint_id: cp?.id ?? null,
        expected_done: doneCount,
        expected_status: task.status,
        answer: req.answer,
        reason: req.reason?.trim() || null,
        evidence_url: evidence,
        milestone_idx: k,
        via: req.via,
        actor: req.actorId,
        effect
      }
    });
    if (res.error && /conflict/.test(res.error.message)) continue;
    const out = must(res, "apply answer");
    if (out.alert_id) await notifyAlert(ctx, out.alert_id);
    return {
      taskId: task.id,
      taskName: task.name,
      status: out.status,
      doneCount: effect.doneCount,
      alertId: out.alert_id,
      checkpointPct: cp?.pct ?? null,
      milestoneIdx: k
    };
  }
  throw new ApiError(409, "conflict", "D\u1EEF li\u1EC7u v\u1EEBa thay \u0111\u1ED5i, h\xE3y th\u1EED l\u1EA1i.");
}

// supabase/functions/ops-hub/telegram-webhook.ts
var REASON_WINDOW_MS = 30 * 6e4;
var EVIDENCE_WINDOW_MS = 2 * 36e5;
var CODE_TO_ANSWER = { p: "on_plan", b: "behind", x: "blocked" };
async function setState(ctx, profileId, state) {
  await ctx.db.from("profiles").update({ tg_state: state }).eq("id", profileId);
}
async function say(ctx, chatId, text) {
  await ctx.tg?.sendMessage(chatId, text);
}
function friendly(err) {
  if (err instanceof ApiError) return err.message;
  console.error("telegram handler", err);
  return "C\xF3 l\u1ED7i khi ghi nh\u1EADn. B\u1EA1n th\u1EED l\u1EA1i, ho\u1EB7c tr\u1EA3 l\u1EDDi tr\xEAn trang Check-in c\u1EE7a t\xF4i trong app.";
}
function outcomeText(answer, o) {
  const head = `\u0110\xE3 ghi nh\u1EADn: <b>${ANSWER_LABEL[answer]}</b>${o.checkpointPct ? ` \xB7 checkpoint ${o.checkpointPct}%` : ""}`;
  const body = `${escapeHtml(o.taskName)} \xB7 ${o.doneCount}/4 m\u1ED1c \xB7 ${TASK_STATUS_LABEL[o.status] ?? o.status}`;
  const tail = answer === "behind" ? "\u0110\xE3 b\xE1o E-commerce Executive \u0111\u1EC3 h\u1ED7 tr\u1EE3." : answer === "blocked" ? "\u0110\xE3 b\xE1o E-commerce Executive ngay." : "";
  return [head, body, tail].filter(Boolean).join("\n");
}
async function linkAccount(ctx, chatId, code) {
  const now = new Date(ctx.now()).toISOString();
  const p = must(
    await ctx.db.from("profiles").select("id, full_name, email, role, active").eq("telegram_link_code", code.toUpperCase()).gt("telegram_link_expires_at", now).maybeSingle(),
    "find link code"
  );
  if (!p || !p.active) {
    await say(ctx, chatId, "M\xE3 li\xEAn k\u1EBFt kh\xF4ng \u0111\xFAng ho\u1EB7c \u0111\xE3 h\u1EBFt h\u1EA1n. V\xE0o app \u2192 H\u1ED3 s\u01A1 \u0111\u1EC3 l\u1EA5y m\xE3 m\u1EDBi (hi\u1EC7u l\u1EF1c 30 ph\xFAt).");
    return;
  }
  await ctx.db.from("profiles").update({ telegram_chat_id: null, tg_state: null }).eq("telegram_chat_id", chatId).neq("id", p.id);
  await ctx.db.from("profiles").update({ telegram_chat_id: chatId, telegram_link_code: null, telegram_link_expires_at: null, tg_state: null }).eq("id", p.id);
  await ctx.db.from("events").insert({ actor: p.id, entity: "profiles", entity_id: p.id, action: "telegram.linked", payload: {} });
  await say(ctx, chatId, `\u0110\xE3 li\xEAn k\u1EBFt v\u1EDBi <b>${escapeHtml(p.full_name || p.email)}</b> (${ROLE_LABEL[p.role]}).
T\u1EEB gi\u1EDD bot s\u1EBD nh\u1EAFn check-in v\xE0 c\u1EA3nh b\xE1o t\u1EA1i \u0111\xE2y, ch\u1EC9 trong gi\u1EDD l\xE0m vi\u1EC7c.

${HELP_TEXT}`);
}
async function listOpenTasks(ctx, profile, chatId) {
  const tasks = must(
    await ctx.db.from("tasks").select("id, name, status").eq("owner_id", profile.id).is("closed_as", null).not("status", "in", "(cancelled,done,overdue)").order("due_at").limit(10),
    "open tasks"
  );
  if (!tasks.length) {
    await say(ctx, chatId, "B\u1EA1n kh\xF4ng c\xF3 task n\xE0o \u0111ang m\u1EDF.");
    return;
  }
  await ctx.tg?.sendMessage(chatId, "Task n\xE0o \u0111ang b\u1ECB ch\u1EB7n?", tasks.map((t) => [{ text: t.name.slice(0, 60), callback_data: `k:${t.id}` }]));
}
async function checkpointProblem(ctx, cpId, token, ownerId) {
  const cp = (await ctx.db.from("checkpoints").select("task_id, token, sent_at, answered_at, expired_at").eq("id", cpId).maybeSingle()).data;
  if (!cp || !safeEqual(cp.token, token)) return "N\xFAt n\xE0y kh\xF4ng c\xF2n hi\u1EC7u l\u1EF1c.";
  if (cp.answered_at) return "Checkpoint n\xE0y \u0111\xE3 \u0111\u01B0\u1EE3c tr\u1EA3 l\u1EDDi r\u1ED3i.";
  if (cp.expired_at) return "Checkpoint n\xE0y \u0111\xE3 h\u1EBFt hi\u1EC7u l\u1EF1c. H\xE3y tr\u1EA3 l\u1EDDi checkpoint m\u1EDBi nh\u1EA5t.";
  const task = (await ctx.db.from("tasks").select("owner_id").eq("id", cp.task_id).maybeSingle()).data;
  if (!task || task.owner_id !== ownerId) return "Ch\u1EC9 ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch task m\u1EDBi tr\u1EA3 l\u1EDDi \u0111\u01B0\u1EE3c.";
  return null;
}
async function onCallback(ctx, cq) {
  const chatId = cq.message?.chat.id ?? cq.from.id;
  const data = cq.data ?? "";
  const profile = await profileByChat(ctx.db, chatId);
  if (!profile || !profile.active) {
    await ctx.tg?.answerCallback(cq.id, "T\xE0i kho\u1EA3n Telegram n\xE0y ch\u01B0a li\xEAn k\u1EBFt v\u1EDBi app.");
    return;
  }
  if (data.startsWith("a:")) {
    const [, cpId, token, code] = data.split(":");
    const answer = CODE_TO_ANSWER[code];
    if (!answer) return;
    if (answer === "blocked") {
      const problem = await checkpointProblem(ctx, Number(cpId), token, profile.id);
      if (problem) {
        await ctx.tg?.answerCallback(cq.id, problem);
        if (cq.message) await ctx.tg?.clearButtons(chatId, cq.message.message_id);
        return;
      }
      await setState(ctx, profile.id, { await: "reason", task_id: "", checkpoint_id: Number(cpId), token, message_id: cq.message?.message_id, until: ctx.now() + REASON_WINDOW_MS });
      await ctx.tg?.answerCallback(cq.id, "Nh\u1EADp l\xFD do b\u1ECB ch\u1EB7n");
      await ctx.tg?.askForReply(chatId, "Task \u0111ang b\u1ECB ch\u1EB7n v\xEC sao? Tr\u1EA3 l\u1EDDi tin n\xE0y b\u1EB1ng <b>m\u1ED9t d\xF2ng l\xFD do</b> (v\xED d\u1EE5: kh\xE1ch ch\u01B0a g\u1EEDi \u1EA3nh s\u1EA3n ph\u1EA9m).", "L\xFD do b\u1ECB ch\u1EB7n");
      return;
    }
    try {
      const out = await applyAnswer(ctx, { actorId: profile.id, checkpointId: Number(cpId), answer, via: "telegram", token });
      await ctx.tg?.answerCallback(cq.id, "\u0110\xE3 ghi nh\u1EADn");
      if (cq.message) await ctx.tg?.clearButtons(chatId, cq.message.message_id);
      await say(ctx, chatId, outcomeText(answer, out));
      if (answer === "on_plan" && out.milestoneIdx) {
        await setState(ctx, profile.id, { await: "evidence", task_id: out.taskId, milestone_idx: out.milestoneIdx, until: ctx.now() + EVIDENCE_WINDOW_MS });
        await say(ctx, chatId, "C\xF3 link b\u1EB1ng ch\u1EE9ng (Drive, b\xE0i \u0111\u0103ng, file)? G\u1EEDi link v\xE0o \u0111\xE2y trong 2 gi\u1EDD t\u1EDBi. Kh\xF4ng b\u1EAFt bu\u1ED9c.");
      } else {
        await setState(ctx, profile.id, null);
      }
    } catch (err) {
      await ctx.tg?.answerCallback(cq.id, friendly(err));
      if (err instanceof ApiError && cq.message && ["already_answered", "checkpoint_expired", "task_closed", "bad_token"].includes(err.code)) {
        await ctx.tg?.clearButtons(chatId, cq.message.message_id);
      }
    }
    return;
  }
  if (data.startsWith("k:")) {
    const taskId = data.slice(2);
    await setState(ctx, profile.id, { await: "reason", task_id: taskId, checkpoint_id: null, until: ctx.now() + REASON_WINDOW_MS });
    await ctx.tg?.answerCallback(cq.id, "Nh\u1EADp l\xFD do b\u1ECB ch\u1EB7n");
    await ctx.tg?.askForReply(chatId, "Task \u0111ang b\u1ECB ch\u1EB7n v\xEC sao? Tr\u1EA3 l\u1EDDi tin n\xE0y b\u1EB1ng <b>m\u1ED9t d\xF2ng l\xFD do</b>.", "L\xFD do b\u1ECB ch\u1EB7n");
    return;
  }
  await ctx.tg?.answerCallback(cq.id, "N\xFAt n\xE0y kh\xF4ng c\xF2n d\xF9ng \u0111\u01B0\u1EE3c.");
}
async function onMessage2(ctx, msg) {
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim();
  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (code) return linkAccount(ctx, chatId, code);
  }
  const profile = await profileByChat(ctx.db, chatId);
  if (!profile || !profile.active) {
    await say(ctx, chatId, "Ch\xE0o b\u1EA1n! \u0110\u1EC3 nh\u1EADn check-in, v\xE0o app Go Media Ops Hub \u2192 <b>H\u1ED3 s\u01A1</b> \u2192 <b>Li\xEAn k\u1EBFt Telegram</b>, r\u1ED3i b\u1EA5m link m\u1EDF bot.");
    return;
  }
  if (text === "/baochan" || text.toLowerCase() === "b\xE1o ch\u1EB7n") return listOpenTasks(ctx, profile, chatId);
  if (text === "/help" || text === "/start") return say(ctx, chatId, HELP_TEXT);
  const state = profile.tg_state;
  if (state && state.until > ctx.now() && text && !text.startsWith("/")) {
    if (state.await === "reason") {
      try {
        const out = await applyAnswer(ctx, {
          actorId: profile.id,
          checkpointId: state.checkpoint_id,
          taskId: state.task_id || null,
          answer: "blocked",
          reason: text.slice(0, 500),
          via: "telegram",
          token: state.token ?? null
        });
        await setState(ctx, profile.id, null);
        if (state.message_id) await ctx.tg?.clearButtons(chatId, state.message_id);
        await say(ctx, chatId, outcomeText("blocked", out));
      } catch (err) {
        await setState(ctx, profile.id, null);
        await say(ctx, chatId, friendly(err));
      }
      return;
    }
    if (state.await === "evidence") {
      if (!/^https?:\/\/\S+$/i.test(text)) {
        await say(ctx, chatId, "\u0110\xE2y ch\u01B0a ph\u1EA3i link (c\u1EA7n b\u1EAFt \u0111\u1EA7u b\u1EB1ng http:// ho\u1EB7c https://). G\u1EEDi l\u1EA1i link, ho\u1EB7c b\u1ECF qua.");
        return;
      }
      await ctx.db.from("milestones").update({ evidence_url: text.slice(0, 1e3) }).eq("task_id", state.task_id).eq("idx", state.milestone_idx);
      await ctx.db.from("events").insert({ actor: profile.id, entity: "tasks", entity_id: state.task_id, action: "milestone.evidence_added", payload: { idx: state.milestone_idx, via: "telegram" } });
      await setState(ctx, profile.id, null);
      await say(ctx, chatId, `\u0110\xE3 l\u01B0u link b\u1EB1ng ch\u1EE9ng cho m\u1ED1c ${state.milestone_idx}.`);
      return;
    }
  }
  await say(ctx, chatId, HELP_TEXT);
}
async function handleTelegramUpdate(ctx, update) {
  if (!ctx.tg) return;
  if (update.callback_query) return onCallback(ctx, update.callback_query);
  if (update.message) return onMessage2(ctx, update.message);
}

// supabase/functions/ops-hub/tasks.ts
function parseTask(body) {
  const ms2 = Array.isArray(body.milestones) ? body.milestones.map((m) => String(m ?? "").trim()) : [];
  const time = (v) => {
    const t = typeof v === "string" || typeof v === "number" ? new Date(v).getTime() : NaN;
    return Number.isFinite(t) ? t : null;
  };
  return {
    name: String(body.name ?? "").trim(),
    owner_id: body.owner_id ? String(body.owner_id) : null,
    type_id: body.type_id ? String(body.type_id) : null,
    start_at: time(body.start_at),
    due_at: time(body.due_at),
    milestones: ms2,
    priority_note: body.priority_note ? String(body.priority_note).trim() : null
  };
}
async function checkOwner(ctx, ownerId) {
  if (!ownerId) return;
  const p = (await ctx.db.from("profiles").select("id, active").eq("id", ownerId).maybeSingle()).data;
  if (!p || !p.active) throw new ApiError(400, "bad_owner", "Ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch kh\xF4ng t\u1ED3n t\u1EA1i ho\u1EB7c \u0111\xE3 b\u1ECB kho\xE1.");
}
function plan(t, cal, now) {
  const errors = validateTaskDraft({ name: t.name, ownerId: t.owner_id, startAt: t.start_at, dueAt: t.due_at, milestones: t.milestones, now }, cal);
  if (errors.length) throw new ApiError(400, "invalid_task", errors.join(" "));
  return checkpointTimes(t.start_at, t.due_at, cal).map((d, i) => ({ pct: CHECKPOINT_PCTS[i], scheduled_at: d.toISOString() }));
}
async function insertTask(ctx, actor, t, cal, source) {
  const checkpoints = plan(t, cal, ctx.now()).map((c) => ({ ...c, token: randomToken() }));
  const id = must(
    await ctx.db.rpc("ops_create_task", {
      p: {
        name: t.name,
        owner_id: t.owner_id,
        type_id: t.type_id,
        start_at: new Date(t.start_at).toISOString(),
        due_at: new Date(t.due_at).toISOString(),
        priority_note: t.priority_note,
        actor,
        source,
        milestones: t.milestones,
        checkpoints
      }
    }),
    "create task"
  );
  return { task_id: id, checkpoints: checkpoints.map(({ pct: pct2, scheduled_at }) => ({ pct: pct2, scheduled_at })) };
}
async function createTask(ctx, user, body) {
  requireRole(user, "ecom_exec", "admin");
  const t = parseTask(body);
  await checkOwner(ctx, t.owner_id);
  const cal = calendarOf(await loadSettings(ctx.db));
  return insertTask(ctx, user.id, t, cal, "app");
}
async function updateTaskPlan(ctx, user, body) {
  requireRole(user, "ecom_exec", "admin");
  const taskId = String(body.task_id ?? "");
  const t = parseTask(body);
  await checkOwner(ctx, t.owner_id);
  const cal = calendarOf(await loadSettings(ctx.db));
  const checkpoints = plan(t, cal, ctx.now());
  const res = await ctx.db.rpc("ops_update_task_plan", {
    p: {
      task_id: taskId,
      name: t.name,
      owner_id: t.owner_id,
      type_id: t.type_id,
      start_at: new Date(t.start_at).toISOString(),
      due_at: new Date(t.due_at).toISOString(),
      priority_note: t.priority_note,
      milestones: t.milestones,
      checkpoints,
      actor: user.id
    }
  });
  if (res.error && /task_started/.test(res.error.message)) throw new ApiError(409, "task_started", "Task \u0111\xE3 g\u1EEDi check-in \u0111\u1EA7u ti\xEAn, kh\xF4ng \u0111\u1ED5i k\u1EBF ho\u1EA1ch \u0111\u01B0\u1EE3c n\u1EEFa. C\xF3 th\u1EC3 hu\u1EF7 task v\xE0 t\u1EA1o task m\u1EDBi.");
  must(res, "update task");
  return { task_id: taskId, checkpoints };
}
async function cancelTask(ctx, user, body) {
  requireRole(user, "ecom_exec", "admin");
  const reason = String(body.reason ?? "").trim();
  if (!reason) throw new ApiError(400, "reason_required", "Ghi l\xFD do hu\u1EF7 task.");
  const res = await ctx.db.rpc("ops_cancel_task", { p: { task_id: String(body.task_id ?? ""), reason, actor: user.id } });
  if (res.error && /task_closed/.test(res.error.message)) throw new ApiError(409, "task_closed", "Task \u0111\xE3 \u0111\xF3ng ho\u1EB7c \u0111\xE3 hu\u1EF7.");
  must(res, "cancel task");
  return { ok: true };
}
async function importTasks(ctx, user, body) {
  requireRole(user, "ecom_exec", "admin");
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length > 2e3) throw new ApiError(400, "bad_rows", "File kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c qu\xE1 l\u1EDBn (t\u1ED1i \u0111a 2000 d\xF2ng).");
  const s = await loadSettings(ctx.db);
  const cal = calendarOf(s);
  const parsed = validateTaskRows(rows, cal.timeZone);
  const people = must(await ctx.db.from("profiles").select("id, email, full_name, active"), "load people");
  const types = must(await ctx.db.from("task_types").select("id, name, milestone_1, milestone_2, milestone_3, milestone_4, active"), "load types");
  const errors = [...parsed.errors];
  const ready = [];
  parsed.rows.forEach((r) => {
    const rowNo = r.row;
    const key = r.owner.toLowerCase();
    const owner = people.find((p) => p.active && (p.email.toLowerCase() === key || p.full_name.trim().toLowerCase() === key));
    const type = r.taskType ? types.find((t2) => t2.active && t2.name.trim().toLowerCase() === r.taskType.toLowerCase()) : void 0;
    if (!owner) return errors.push({ row: rowNo, message: `kh\xF4ng t\xECm th\u1EA5y ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch "${r.owner}" trong danh s\xE1ch ng\u01B0\u1EDDi d\xF9ng` });
    if (r.taskType && !type && !r.milestones) return errors.push({ row: rowNo, message: `kh\xF4ng c\xF3 lo\u1EA1i task "${r.taskType}"` });
    const t = {
      name: r.name,
      owner_id: owner.id,
      type_id: type?.id ?? null,
      start_at: r.startAt,
      due_at: r.dueAt,
      milestones: r.milestones ?? [type.milestone_1, type.milestone_2, type.milestone_3, type.milestone_4],
      priority_note: r.priorityNote
    };
    const problems = validateTaskDraft({ name: t.name, ownerId: t.owner_id, startAt: t.start_at, dueAt: t.due_at, milestones: t.milestones, now: ctx.now() }, cal);
    if (problems.length) return errors.push({ row: rowNo, message: problems.join(" ") });
    ready.push(t);
  });
  const preview = { valid: ready.length, errors: errors.sort((a, b) => a.row - b.row) };
  if (body.dryRun) return { preview };
  const created = [];
  for (const t of ready) created.push((await insertTask(ctx, user.id, t, cal, "import")).task_id);
  return { preview, created: created.length };
}
async function answerOnWeb(ctx, user, body) {
  const answer = String(body.answer ?? "");
  if (!["on_plan", "behind", "blocked"].includes(answer)) throw new ApiError(400, "bad_answer", "C\xE2u tr\u1EA3 l\u1EDDi kh\xF4ng h\u1EE3p l\u1EC7.");
  return applyAnswer(ctx, {
    actorId: user.id,
    checkpointId: Number(body.checkpoint_id),
    answer,
    reason: body.reason ? String(body.reason) : null,
    evidenceUrl: body.evidence_url ? String(body.evidence_url) : null,
    via: "web"
  });
}
async function reportBlockerOnWeb(ctx, user, body) {
  return applyAnswer(ctx, { actorId: user.id, taskId: String(body.task_id ?? ""), answer: "blocked", reason: String(body.reason ?? ""), via: "web" });
}

// supabase/functions/ops-hub/handler.ts
function routeOf(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
async function requireCron(ctx, req) {
  const got = req.headers.get("x-cron-secret");
  const { data, error } = await ctx.db.rpc("ops_cron_secret");
  if (error || !data || !safeEqual(got, data)) throw new ApiError(401, "unauthorized", "Missing or wrong x-cron-secret");
}
async function handleApi(ctx, req) {
  if (req.method !== "POST") throw new ApiError(405, "method", "POST only");
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ApiError(401, "unauthenticated", "B\u1EA1n c\u1EA7n \u0111\u0103ng nh\u1EADp.");
  const { data, error } = await ctx.db.auth.getUser(token);
  if (error || !data?.user) throw new ApiError(401, "unauthenticated", "Phi\xEAn \u0111\u0103ng nh\u1EADp \u0111\xE3 h\u1EBFt h\u1EA1n. H\xE3y \u0111\u0103ng nh\u1EADp l\u1EA1i.");
  const user = await loadProfile(ctx.db, data.user.id);
  if (!user || !user.active) throw new ApiError(403, "inactive", "T\xE0i kho\u1EA3n ch\u01B0a \u0111\u01B0\u1EE3c c\u1EA5p quy\u1EC1n ho\u1EB7c \u0111\xE3 b\u1ECB kho\xE1.");
  const body = await req.json().catch(() => ({}));
  const id = String(body.quote_id ?? "");
  switch (body.action) {
    case "quote.band":
      return previewBand(ctx, user, body);
    case "quote.submit":
      return submitQuote(ctx, user, id);
    case "quote.reopen":
      return reopenQuote(ctx, user, id);
    case "quote.decide":
      return decideQuote(ctx, user, body);
    case "quote.send":
      return sendQuote(ctx, user, id);
    case "quote.comment":
      return addComment(ctx, user, body);
    case "quote.comment_resolve":
      return resolveComment(ctx, user, body);
    case "quote.import":
      return importQuotes(ctx, user, body);
    case "task.create":
      return createTask(ctx, user, body);
    case "task.update":
      return updateTaskPlan(ctx, user, body);
    case "task.cancel":
      return cancelTask(ctx, user, body);
    case "task.import":
      return importTasks(ctx, user, body);
    case "checkin.answer":
      return answerOnWeb(ctx, user, body);
    case "checkin.blocker":
      return reportBlockerOnWeb(ctx, user, body);
    case "admin.invite":
      return inviteUser(ctx, user, body);
    case "system.health":
      return systemHealth(ctx, user);
    case "system.connect_telegram":
      return connectTelegram(ctx, user);
    case "system.test_message":
      return testMessage(ctx, user);
    case "system.run_jobs":
      if (user.role !== "admin") throw new ApiError(403, "forbidden", "Ch\u1EC9 admin.");
      return { dispatch: await dispatchCheckpoints(ctx), close: await closeTasks(ctx) };
    case "lark.create":
      return createLarkTaskFromWeb(ctx, user, body);
    case "lark.simulate":
      return simulateLark(ctx, user, body);
    case "lark.run":
      return runLarkNow(ctx, user);
    case "lark.people":
      return ensureSimPeople(ctx);
    case "lark.status":
      return larkAdminStatus(ctx, user);
    case "lark.config":
      return saveLarkConfig(ctx, user, body);
    case "lark.test":
      return testLark(ctx, user);
    case "demo.seed":
      return seedDemo(ctx, user);
    case "demo.clear":
      return clearDemo(ctx, user);
    default:
      throw new ApiError(400, "unknown_action", `Unknown action: ${String(body.action)}`);
  }
}
async function handleWebhook(ctx, req) {
  if (!ctx.tg || !ctx.env.telegramToken) return json({ ok: false, reason: "telegram not configured" });
  const expected = ctx.env.webhookSecretOverride ?? await deriveWebhookSecret(ctx.env.telegramToken);
  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), expected)) return json({ error: "forbidden" }, 401);
  const update = await req.json().catch(() => null);
  if (update) {
    try {
      await handleTelegramUpdate(ctx, update);
    } catch (err) {
      console.error("telegram update failed", err);
    }
  }
  return json({ ok: true });
}
function createHandler(env, opts = {}) {
  return async (req) => {
    if (req.method === "OPTIONS") return preflight(req);
    const route = routeOf(req.url);
    if (route === "health") return json({ ok: true, domainVersion: DOMAIN_VERSION, appEnv: env.appEnv });
    if (!env.supabaseUrl || !env.serviceKey) return json({ error: { code: "config", message: "SUPABASE_URL / service key missing" } }, 500);
    const fixed = opts.allowTestClock ? req.headers.get("x-test-now") : null;
    const now = fixed ? () => Date.parse(fixed) : Date.now;
    const db = createClient(env.supabaseUrl, env.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: opts.fetchImpl ? { fetch: opts.fetchImpl } : void 0
    });
    const tg = env.telegramToken ? new TelegramApi(env.telegramToken, env.telegramApiBase, opts.fetchImpl ?? fetch) : null;
    const ctx = { env, db, tg, notifier: new Notifier(db, makeChannel(tg)), now, fetchImpl: opts.fetchImpl };
    try {
      switch (route) {
        case "api":
          return json(await handleApi(ctx, req));
        case "telegram-webhook":
          return await handleWebhook(ctx, req);
        case "dispatch-checkpoints": {
          await requireCron(ctx, req);
          const out = await dispatchCheckpoints(ctx);
          let lark;
          try {
            lark = await larkTick(ctx);
          } catch (err) {
            lark = { error: err.message };
          }
          return json({ ...out, lark });
        }
        case "lark-events":
          return json(await handleLarkEvent(ctx, req));
        case "close-tasks":
          await requireCron(ctx, req);
          return json(await closeTasks(ctx));
        default:
          return json({ error: { code: "not_found", message: `Unknown route ${route}` } }, 404);
      }
    } catch (err) {
      return fail(err);
    }
  };
}

// supabase/functions/ops-hub/index.ts
Deno.serve(createHandler(readEnv((key) => Deno.env.get(key))));
