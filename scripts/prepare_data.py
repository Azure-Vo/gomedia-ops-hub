#!/usr/bin/env python3
"""
prepare_data.py - Step 0 data preparation for Go Media Ops Hub.

Turns the team's raw exports into CSV files the app imports, on your own computer:

  quotes  approved quote lines (one row per line item)
          -> bao_gia_lich_su.csv        history for the Reference Archive / baseline check,
                                        client names replaced by aliases ("Khach 001", ...)
          -> thu_vien_gia.csv           Pricing Library: median approved unit price per item
                                        over the last 6-12 months (import-ready)
          -> thu_vien_gia_chi_tiet.csv  the same items with sample size, min/max and flags,
                                        for the Pricing Owner (PM) to review before import
          -> bao_cao_quotes.txt         what was done, without any client name

  tasks   the e-commerce team's current task sheet
          -> task_nhap_app.csv          open tasks only, owner e-mails, ISO dates (import-ready)
          -> bao_cao_tasks.txt

The real-name <-> alias table is written ONLY to --alias-map (default private/client_alias_map.csv).
Keep that folder off shared drives and never paste it into an AI tool.

Working-hour KPIs are deliberately NOT computed here: the app's domain module is the single
implementation. After importing, open Diagnostics in the Demo app to check 19 quotes / 8.66 h / 52.6 %.

Python 3.9+, standard library only.
  python scripts/prepare_data.py quotes raw_quotes.csv --out step0/out
  python scripts/prepare_data.py tasks task_sheet.csv --owners private/owners.csv --out step0/out
"""
from __future__ import annotations

import argparse
import calendar
import csv
import datetime as dt
import io
import math
import re
import statistics
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

BASELINE_FROM = dt.date(2026, 7, 1)  # PRD: July-September 2026, 19 quotations
BASELINE_TO = dt.date(2026, 9, 30)
BASELINE_COUNT = 19

# ----------------------------------------------------------------------------- text helpers


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s or "")


def collapse(s: str) -> str:
    return re.sub(r"\s+", " ", nfc(s)).strip()


def key(s: str) -> str:
    """Comparison key: same name typed with different spacing or case is the same thing."""
    return collapse(s).casefold()


def slug(s: str) -> str:
    """Header key without Vietnamese tone marks: 'Khach hang' / 'Khách hàng' -> 'khach_hang'."""
    s = nfc(s).replace("đ", "d").replace("Đ", "D")
    s = "".join(ch for ch in unicodedata.normalize("NFD", s) if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


# ----------------------------------------------------------------------------- CSV reading


def _count_outside_quotes(line: str, sep: str) -> int:
    n, quoted = 0, False
    for ch in line:
        if ch == '"':
            quoted = not quoted
        elif ch == sep and not quoted:
            n += 1
    return n


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]], dict]:
    """Reads Excel / Google Sheets CSV: UTF-8 (with or without BOM) or Windows-1258; , ; or tab."""
    raw = path.read_bytes()
    try:
        text, encoding = raw.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        text, encoding = raw.decode("cp1258"), "windows-1258"
    text = nfc(text)
    first = text.splitlines()[0] if text else ""
    sep = max([",", ";", "\t"], key=lambda s: _count_outside_quotes(first, s))
    if _count_outside_quotes(first, sep) == 0:
        sep = ","
    records = [r for r in csv.reader(io.StringIO(text), delimiter=sep) if any(c.strip() for c in r)]
    if not records:
        return [], [], {"encoding": encoding, "sep": sep}
    header = [slug(h) for h in records[0]]
    rows = [{h: (r[i].strip() if i < len(r) else "") for i, h in enumerate(header)} for r in records[1:]]
    return header, rows, {"encoding": encoding, "sep": sep}


def resolve_columns(header: list[str], spec: dict[str, list[str]], required: list[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    for canon, aliases in spec.items():
        for a in aliases:
            if a in header:
                found[canon] = a
                break
    missing = [c for c in required if c not in found]
    if missing:
        raise SystemExit(
            "Thiếu cột: " + ", ".join(missing) + "\nCác cột đọc được: " + ", ".join(header) +
            "\nĐổi tên cột theo file mẫu trong step0/templates rồi chạy lại."
        )
    return found


def write_csv(path: Path, columns: list[str], rows: list[dict]) -> None:
    """UTF-8 with BOM (Excel shows Vietnamese), comma-separated like the app's own exports."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, lineterminator="\r\n")
        w.writerow(columns)
        for r in rows:
            w.writerow(["" if r.get(c) is None else r.get(c) for c in columns])


# ----------------------------------------------------------------------------- numbers (same rules as the app)


def parse_vnd(s: str) -> int | None:
    """Whole dong: '1.500.000', '1,500,000', '1500000 đ' -> 1500000."""
    s = (s or "").strip()
    cleaned = re.sub(r"đ|Đ|vnd|VND|vnđ|VNĐ", "", s)
    if not s or re.search(r"[a-zA-Z]", cleaned):
        return None
    compact = re.sub(r"\s", "", cleaned)
    if re.fullmatch(r"-?\d+[.,]\d{1,2}", compact):
        return math.floor(float(compact.replace(",", ".")) + 0.5)  # same as JavaScript Math.round
    digits = re.sub(r"[^\d-]", "", s)
    if not re.fullmatch(r"-?\d+", digits):
        return None
    return int(digits)


def parse_number(s: str) -> float | None:
    """'7,5' or '7.5' or '7,5%' -> 7.5; '1.000' -> 1000."""
    s = re.sub(r"\s|%", "", (s or "").strip())
    if not s:
        return None
    has_dot, has_comma = "." in s, "," in s
    if has_dot and has_comma:
        dec = "," if s.rfind(",") > s.rfind(".") else "."
        s = s.replace("." if dec == "," else ",", "").replace(",", ".")
    elif has_comma:
        s = s.replace(",", "") if re.fullmatch(r"\d{1,3}(,\d{3})+", s) else s.replace(",", ".")
    elif has_dot and re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    if not re.fullmatch(r"-?\d+(\.\d+)?", s):
        return None
    return float(s)


def fmt_num(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:g}"


# ----------------------------------------------------------------------------- dates

ISO_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$")
SLASH_RE = re.compile(
    r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|SA|CH|am|pm|sa|ch)?)?$"
)
SERIAL_RE = re.compile(r"^\d{5}(?:\.\d+)?$")  # Excel serial day number (cells formatted as General)


def detect_date_order(values: list[str]) -> tuple[str, int, int]:
    """'dmy', 'mdy', 'mixed', 'ambiguous' (slash dates, none telling) or 'iso' (no slash dates at all),
    with the counts of telling dates for each order."""
    dmy = mdy = slash = 0
    for v in values:
        m = SLASH_RE.match((v or "").strip())
        if not m:
            continue
        slash += 1
        a, b = int(m.group(1)), int(m.group(2))
        if a > 12 >= b:
            dmy += 1
        elif b > 12 >= a:
            mdy += 1
    if dmy and mdy:
        return "mixed", dmy, mdy
    if dmy:
        return "dmy", dmy, mdy
    if mdy:
        return "mdy", dmy, mdy
    return ("ambiguous" if slash else "iso"), dmy, mdy


def parse_dt(s: str, order: str) -> tuple[dt.datetime | None, bool]:
    """Local date-time (no timezone: Asia/Ho_Chi_Minh is implied) and whether a time was given."""
    s = (s or "").strip()
    if not s:
        return None, False
    try:
        m = ISO_RE.match(s)
        if m:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            has_time = m.group(4) is not None
            h, mi = (int(m.group(4)), int(m.group(5))) if has_time else (0, 0)
            return dt.datetime(y, mo, d, h, mi), has_time
        m = SLASH_RE.match(s)
        if m:
            a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            d, mo = (b, a) if order == "mdy" else (a, b)
            has_time = m.group(4) is not None
            h, mi = (int(m.group(4)), int(m.group(5))) if has_time else (0, 0)
            ampm = (m.group(7) or "").upper()
            if ampm in ("PM", "CH") and h < 12:
                h += 12
            if ampm in ("AM", "SA") and h == 12:
                h = 0
            return dt.datetime(y, mo, d, h, mi), has_time
        if SERIAL_RE.match(s):
            days = float(s)
            value = dt.datetime(1899, 12, 30) + dt.timedelta(days=days)
            value = value.replace(second=0, microsecond=0) + dt.timedelta(minutes=round(value.second / 60))
            return value, not days.is_integer()
    except ValueError:  # e.g. 31/02/2026
        return None, False
    return None, False


def iso(d: dt.datetime) -> str:
    return d.strftime("%Y-%m-%d %H:%M")


def months_before(d: dt.date, months: int) -> dt.date:
    y, m = d.year, d.month - months
    while m <= 0:
        m += 12
        y -= 1
    return dt.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


# ----------------------------------------------------------------------------- client aliases


LEGAL_PREFIXES = [
    "cong ty tnhh mtv", "cong ty tnhh", "cong ty co phan", "cong ty cp", "cong ty", "cty tnhh", "cty cp", "cty",
    "tap doan", "chuoi", "cua hang", "nha hang", "thuong hieu", "shop", "quan", "tnhh",
]
LEGAL_SUFFIXES = ["tnhh", "jsc", "co ltd", "co., ltd", "ltd", "corp", "group", "viet nam", "vietnam"]


def short_name(name: str) -> str:
    """'Công ty TNHH Sao Mai' -> 'Sao Mai': the form people actually type in item names."""
    words = collapse(name).split(" ")
    changed = True
    while changed and len(words) > 1:
        changed = False
        for pre in LEGAL_PREFIXES:
            n = len(pre.split(" "))
            if len(words) > n and slug(" ".join(words[:n])) == slug(pre):
                words, changed = words[n:], True
                break
        for suf in LEGAL_SUFFIXES:
            n = len(suf.split(" "))
            if len(words) > n and slug(" ".join(words[-n:])) == slug(suf):
                words, changed = words[:-n], True
                break
    return " ".join(words).strip(" ,.-")


@dataclass
class AliasBook:
    path: Path
    by_key: dict[str, str] = field(default_factory=dict)  # key(any known name) -> alias
    names: dict[str, str] = field(default_factory=dict)  # alias -> registered real name (private file only)
    others: dict[str, list[str]] = field(default_factory=dict)  # alias -> extra variants typed by the team
    added: int = 0

    @classmethod
    def load(cls, path: Path) -> "AliasBook":
        book = cls(path)
        if path.exists():
            _, rows, _ = read_csv(path)
            for r in rows:
                alias, name = r.get("client_alias", ""), r.get("client_name", "")
                if alias and name:
                    book.names[alias] = collapse(name)
                    book.others[alias] = [collapse(x) for x in (r.get("other_names") or "").split("|") if collapse(x)]
                    for n in [name, *book.others[alias]]:
                        book.by_key[key(n)] = alias
        return book

    def alias_for(self, name: str) -> str:
        name = collapse(name)
        if not name:
            return ""
        k = key(name)
        if k not in self.by_key:
            used = [int(m.group(1)) for a in self.names if (m := re.search(r"(\d+)$", a))]
            alias = f"Khách {max(used, default=0) + 1:03d}"
            self.by_key[k] = alias
            self.names[alias] = name
            self.others.setdefault(alias, [])
            self.added += 1
        return self.by_key[k]

    def save(self) -> None:
        rows = [{"client_alias": a, "client_name": n, "other_names": " | ".join(self.others.get(a, []))} for a, n in sorted(self.names.items())]
        write_csv(self.path, ["client_alias", "client_name", "other_names"], rows)

    def variants(self) -> list[tuple[str, str]]:
        """(alias, variant) pairs, longest first so 'Công ty Sao Mai' is replaced before 'Sao Mai'."""
        out = []
        for alias, name in self.names.items():
            vs = {name, short_name(name), *self.others.get(alias, [])}
            out += [(alias, v) for v in vs if len(v) >= 3]
        return sorted(out, key=lambda x: -len(x[1]))

    def scrub(self, text: str) -> tuple[str, int]:
        """Replaces known client names inside free text (item names, quote codes), as whole words.
        Short names (< 6 letters) must match case exactly, so a client called 'Mai' leaves 'ngày mai' alone."""
        hits = 0
        for alias, v in self.variants():
            flags = 0 if len(v) < 6 else re.IGNORECASE
            pattern = re.compile(r"(?<!\w)" + re.escape(v) + r"(?!\w)", flags)
            text, n = pattern.subn(alias, text)
            hits += n
        return text, hits


# ----------------------------------------------------------------------------- quotes

QUOTE_SPEC = {
    "quote_code": ["quote_code", "code", "ma_bao_gia", "so_bao_gia", "ma"],
    "client": ["client", "client_name", "client_alias", "khach_hang", "ten_khach_hang", "khach"],
    "service_group": ["service_group", "group", "nhom_dich_vu", "nhom"],
    "requested_at": ["requested_at", "khach_gui_yeu_cau_luc", "khach_yeu_cau_luc", "ngay_yeu_cau", "thoi_gian_yeu_cau", "yeu_cau_luc"],
    "sent_at": ["sent_at", "gui_luc", "ngay_gui", "thoi_gian_gui"],
    "item_name": ["item_name", "name", "hang_muc", "ten_hang_muc", "dich_vu"],
    "unit": ["unit", "don_vi", "dvt"],
    "qty": ["qty", "quantity", "so_luong", "sl"],
    "unit_price": ["unit_price", "don_gia", "gia"],
    "discount_pct": ["discount_pct", "discount", "chiet_khau", "chiet_khau_pct", "giam_gia"],
}
QUOTE_REQUIRED = ["quote_code", "client", "requested_at", "sent_at", "item_name", "unit", "qty", "unit_price"]
HISTORY_COLUMNS = ["quote_code", "client_alias", "service_group", "requested_at", "sent_at", "item_name", "unit", "qty", "unit_price", "discount_pct"]


@dataclass
class Line:
    row: int
    code: str
    client: str
    group: str
    requested: dt.datetime
    sent: dt.datetime
    item: str
    unit: str
    qty: float
    price: int
    discount: float


def round_thousand(x: float) -> int:
    return int((x + 500) // 1000 * 1000)


def prepare_quotes(args) -> int:
    src = Path(args.input)
    out = Path(args.out)
    header, rows, meta = read_csv(src)
    if not rows:
        raise SystemExit("File không có dòng dữ liệu.")
    cols = resolve_columns(header, QUOTE_SPEC, QUOTE_REQUIRED)
    get = lambda r, c: collapse(r.get(cols[c], "")) if c in cols else ""  # noqa: E731

    order = args.date_order
    detected, n_dmy, n_mdy = detect_date_order([get(r, "requested_at") for r in rows] + [get(r, "sent_at") for r in rows])
    if order == "auto":
        if detected == "mixed":
            raise SystemExit(
                f"Ngày tháng lẫn hai kiểu: {n_dmy} ngày dạng ngày/tháng và {n_mdy} ngày dạng tháng/ngày. "
                "Sửa file cho một kiểu (nên dùng 2026-07-03 09:00) hoặc chạy lại với --date-order dmy|mdy."
            )
        order = "mdy" if detected == "mdy" else "dmy"

    errors: list[tuple[int, str]] = []
    lines: list[Line] = []
    for i, r in enumerate(rows, start=1):
        problems = []
        code = get(r, "quote_code")
        req, req_t = parse_dt(get(r, "requested_at"), order)
        sent, sent_t = parse_dt(get(r, "sent_at"), order)
        qty = parse_number(get(r, "qty"))
        price = parse_vnd(get(r, "unit_price"))
        disc_raw = get(r, "discount_pct")
        disc = parse_number(disc_raw) if disc_raw else 0.0
        if not code:
            problems.append("thiếu quote_code")
        if req is None:
            problems.append(f'requested_at không đọc được ("{get(r, "requested_at")}")')
        elif not req_t:
            problems.append("requested_at thiếu giờ:phút (cần để tính giờ làm việc)")
        if sent is None:
            problems.append(f'sent_at không đọc được ("{get(r, "sent_at")}")')
        elif not sent_t:
            problems.append("sent_at thiếu giờ:phút (cần để tính giờ làm việc)")
        if req and sent and sent <= req:
            problems.append("sent_at phải sau requested_at")
        if not get(r, "item_name"):
            problems.append("thiếu item_name")
        if qty is None or qty <= 0:
            problems.append("qty phải lớn hơn 0")
        if price is None or price < 0:
            problems.append("unit_price không hợp lệ")
        if disc is None or not (0 <= disc <= 100):
            problems.append("discount_pct phải từ 0 đến 100")
        if problems:
            errors.append((i, "; ".join(problems)))
            continue
        lines.append(Line(i, code, get(r, "client"), get(r, "service_group"), req, sent, get(r, "item_name"), get(r, "unit"), qty, price, disc))

    # Quote-level fields must agree across the lines of one quote (the app refuses otherwise).
    first: dict[str, Line] = {}
    consistent: list[Line] = []
    for ln in lines:
        f = first.setdefault(ln.code, ln)
        if f is not ln and (key(f.client) != key(ln.client) or f.requested != ln.requested or f.sent != ln.sent or f.discount != ln.discount):
            errors.append((ln.row, f"khách, requested_at, sent_at, discount_pct phải giống dòng {f.row} của cùng {ln.code}"))
            continue
        consistent.append(ln)

    # Anonymise
    book = AliasBook.load(Path(args.alias_map))
    for ln in sorted(consistent, key=lambda x: (x.requested, x.code)):
        book.alias_for(ln.client)
    scrubbed = Counter()
    out_rows = []
    recode: dict[str, str] = {}
    for ln in sorted(consistent, key=lambda x: (x.requested, x.code, x.row)):
        item, n1 = book.scrub(ln.item)
        code, n2 = book.scrub(ln.code)
        scrubbed["item_name"] += n1
        scrubbed["quote_code"] += n2
        if args.recode:
            code = recode.setdefault(ln.code, f"H-{ln.requested.year}-{len(recode) + 1:03d}")
        out_rows.append({
            "quote_code": code,
            "client_alias": book.alias_for(ln.client),
            "service_group": ln.group,
            "requested_at": iso(ln.requested),
            "sent_at": iso(ln.sent),
            "item_name": item,
            "unit": ln.unit,
            "qty": fmt_num(ln.qty),
            "unit_price": ln.price,
            "discount_pct": fmt_num(ln.discount),
        })
    write_csv(out / "bao_gia_lich_su.csv", HISTORY_COLUMNS, out_rows)
    book.save()
    if args.recode:
        # The code mapping stays private too: original codes may contain client initials.
        write_csv(Path(args.alias_map).with_name("quote_code_map.csv"), ["new_code", "original_code"],
                  [{"new_code": v, "original_code": k} for k, v in recode.items()])

    # Pricing Library: median approved unit price per item over the window
    as_of = dt.date.fromisoformat(args.as_of) if args.as_of else dt.date.today()
    since = months_before(as_of, args.months)
    groups: dict[tuple[str, str], dict] = defaultdict(lambda: {"prices": [], "quotes": set(), "names": Counter(), "units": Counter(), "groups": Counter(), "last": None, "free": 0})
    for ln, row in zip(sorted(consistent, key=lambda x: (x.requested, x.code, x.row)), out_rows):
        if not (since < ln.sent.date() <= as_of):
            continue
        g = groups[(key(row["item_name"]), key(ln.unit))]
        if ln.price == 0:
            g["free"] += 1
            continue
        g["prices"].append(ln.price)
        g["quotes"].add(ln.code)
        g["names"][row["item_name"]] += 1
        g["units"][ln.unit] += 1
        if ln.group:
            g["groups"][ln.group] += 1
        g["last"] = max(filter(None, [g["last"], ln.sent.date()]))
    lib_rows, detail_rows = [], []
    for (_, _), g in groups.items():
        if not g["prices"]:
            continue
        name = g["names"].most_common(1)[0][0]
        unit = g["units"].most_common(1)[0][0]
        group = g["groups"].most_common(1)[0][0] if g["groups"] else ""
        med = round_thousand(statistics.median(g["prices"]))
        lo, hi = min(g["prices"]), max(g["prices"])
        flags = []
        if len(g["quotes"]) < 3:
            flags.append("ít dữ liệu (<3 báo giá)")
        if lo > 0 and hi > 1.5 * lo:
            flags.append("giá phân tán (cao nhất > 1,5 × thấp nhất)")
        if g["last"] and g["last"] < months_before(as_of, 6):
            flags.append("hơn 6 tháng chưa báo")
        if not group:
            flags.append("thiếu nhóm dịch vụ")
        lib_rows.append({"item_name": name, "unit": unit, "group": group, "unit_price": med})
        detail_rows.append({
            "item_name": name, "unit": unit, "group": group, "unit_price_median": med,
            "n_quotes": len(g["quotes"]), "n_lines": len(g["prices"]), "min_price": lo, "max_price": hi,
            "last_quoted": g["last"].isoformat() if g["last"] else "", "free_lines": g["free"],
            "flags": "; ".join(flags), "pm_decision": "",
        })
    order_key = lambda r: (key(r["group"]), key(r["item_name"]))  # noqa: E731
    lib_rows.sort(key=order_key)
    detail_rows.sort(key=order_key)
    write_csv(out / "thu_vien_gia.csv", ["item_name", "unit", "group", "unit_price"], [r for r in lib_rows if r["group"]])
    write_csv(out / "thu_vien_gia_chi_tiet.csv", ["item_name", "unit", "group", "unit_price_median", "n_quotes", "n_lines", "min_price", "max_price", "last_quoted", "free_lines", "flags", "pm_decision"], detail_rows)

    # Report (counts only, never a client name)
    quotes = {ln.code: ln for ln in consistent}
    in_period = [q for q in quotes.values() if BASELINE_FROM <= q.requested.date() <= BASELINE_TO]
    lines_out = [
        f"Nguồn: {src.name} · mã hoá {meta['encoding']} · phân cách '{meta['sep']}'",
        f"Kiểu ngày: {'năm-tháng-ngày (ISO)' if detected == 'iso' and args.date_order == 'auto' else 'tháng/ngày (Mỹ) - đã đổi sang năm-tháng-ngày' if order == 'mdy' else 'ngày/tháng'}"
        + (" (tự nhận diện)" if args.date_order == "auto" and detected in ("dmy", "mdy") else "")
        + (" · CẢNH BÁO: không có ngày nào > 12 để phân biệt, đang hiểu là ngày/tháng; kiểm tra lại vài dòng" if detected == "ambiguous" and args.date_order == "auto" else ""),
        f"Dòng đọc được: {len(rows)} · hợp lệ: {len(consistent)} · lỗi: {len(errors)}",
        f"Báo giá: {len(quotes)} · khách đã ẩn tên: {len({key(q.client) for q in quotes.values() if q.client})} (thêm mới vào bảng alias: {book.added})",
        f"Tên khách tìm thấy và đã thay trong item_name: {scrubbed['item_name']} · trong quote_code: {scrubbed['quote_code']}"
        + (" · quote_code đã đổi sang H-YYYY-NNN" if args.recode else " · hãy liếc qua quote_code xem còn chữ viết tắt tên khách không"),
    ]
    if quotes:
        lo_d = min(q.requested for q in quotes.values())
        hi_d = max(q.sent for q in quotes.values())
        lines_out.append(f"Khoảng thời gian: {lo_d:%d/%m/%Y %H:%M} → {hi_d:%d/%m/%Y %H:%M}")
    lines_out.append(
        f"Kỳ baseline 01/07–30/09/2026 (theo ngày khách yêu cầu): {len(in_period)} báo giá"
        + (" - khớp PRD (19)" if len(in_period) == BASELINE_COUNT else f" - PRD ghi {BASELINE_COUNT}: kiểm tra lại trước khi so baseline")
    )
    lines_out.append(
        f"Thư viện giá: {len(lib_rows)} hạng mục từ báo giá gửi trong {since:%d/%m/%Y} → {as_of:%d/%m/%Y} ({args.months} tháng), giá = trung vị làm tròn 1.000 đ"
    )
    flagged = [r for r in detail_rows if r["flags"]]
    if flagged:
        lines_out.append(f"  {len(flagged)} hạng mục cần PM xem lại (cột flags trong thu_vien_gia_chi_tiet.csv)")
    no_group = [r for r in detail_rows if not r["group"]]
    if no_group:
        lines_out.append(f"  {len(no_group)} hạng mục thiếu nhóm dịch vụ: chưa đưa vào thu_vien_gia.csv, điền nhóm rồi chạy lại")
    if not (6 <= args.months <= 12):
        lines_out.append("  Lưu ý: Build Guide khuyên lấy 6–12 tháng.")
    if errors:
        lines_out.append("Dòng lỗi (dòng 1 = dòng ngay dưới tiêu đề):")
        lines_out += [f"  Dòng {n}: {msg}" for n, msg in errors[:80]]
        if len(errors) > 80:
            lines_out.append(f"  … và {len(errors) - 80} dòng nữa")
    lines_out.append(f"Bảng tên thật ↔ alias (RIÊNG TƯ, không chia sẻ): {Path(args.alias_map)}")
    lines_out.append("Bước tiếp: PM duyệt thu_vien_gia_chi_tiet.csv → nhập thu_vien_gia.csv rồi bao_gia_lich_su.csv vào app (Thư viện giá) → Diagnostics.")
    report = "\n".join(lines_out)
    (out / "bao_cao_quotes.txt").write_text(report + "\n", encoding="utf-8-sig")
    print(report)
    return 0


# ----------------------------------------------------------------------------- tasks

TASK_SPEC = {
    "task_name": ["task_name", "name", "ten_task", "task", "cong_viec", "ten_cong_viec"],
    "owner": ["owner_email", "owner", "owner_alias", "email", "nguoi_phu_trach", "phu_trach", "nguoi_lam"],
    "task_type": ["task_type", "type", "loai_task", "loai"],
    "start_at": ["start_at", "bat_dau", "ngay_bat_dau", "start"],
    "due_at": ["due_at", "deadline", "han", "han_chot", "ngay_het_han", "due"],
    "milestone_1": ["milestone_1", "moc_1", "moc1"],
    "milestone_2": ["milestone_2", "moc_2", "moc2"],
    "milestone_3": ["milestone_3", "moc_3", "moc3"],
    "milestone_4": ["milestone_4", "moc_4", "moc4"],
    "priority_note": ["priority_note", "uu_tien", "ghi_chu_uu_tien", "priority"],
    "status": ["status", "trang_thai", "tinh_trang"],
}
TASK_REQUIRED = ["task_name", "owner", "start_at", "due_at"]
CLOSED_STATUSES = {"xong", "da_xong", "hoan_thanh", "da_hoan_thanh", "done", "completed", "complete", "huy", "da_huy", "cancelled", "canceled"}


def prepare_tasks(args) -> int:
    src = Path(args.input)
    out = Path(args.out)
    header, rows, meta = read_csv(src)
    if not rows:
        raise SystemExit("File không có dòng dữ liệu.")
    cols = resolve_columns(header, TASK_SPEC, TASK_REQUIRED)
    get = lambda r, c: collapse(r.get(cols[c], "")) if c in cols else ""  # noqa: E731

    owners: dict[str, str] = {}
    if args.owners:
        _, orows, _ = read_csv(Path(args.owners))
        for r in orows:
            name, email = r.get("name") or r.get("full_name") or r.get("ho_ten") or "", r.get("email", "")
            if name and email:
                owners[key(name)] = email.strip().lower()

    order = args.date_order
    detected, n_dmy, n_mdy = detect_date_order([get(r, "start_at") for r in rows] + [get(r, "due_at") for r in rows])
    if order == "auto":
        if detected == "mixed":
            raise SystemExit(f"Ngày tháng lẫn hai kiểu ({n_dmy} ngày/tháng, {n_mdy} tháng/ngày). Sửa file hoặc dùng --date-order dmy|mdy.")
        order = "mdy" if detected == "mdy" else "dmy"
    now = dt.datetime.strptime(args.now, "%Y-%m-%d %H:%M") if args.now else dt.datetime.now().replace(second=0, microsecond=0)
    ds = dt.datetime.strptime(args.default_start, "%H:%M").time()
    dd = dt.datetime.strptime(args.default_due, "%H:%M").time()

    errors: list[tuple[int, str]] = []
    skipped_closed, skipped_past, defaulted_time = [], [], 0
    out_rows, types = [], Counter()
    by_name: set[str] = set()
    any_ms = False
    for i, r in enumerate(rows, start=1):
        if slug(get(r, "status")) in CLOSED_STATUSES:
            skipped_closed.append(i)
            continue
        problems = []
        name = get(r, "task_name")
        owner_raw = get(r, "owner")
        # E-mail as is; else the --owners table; else keep the name (the app also matches the exact full name).
        owner = owner_raw.lower() if "@" in owner_raw else owners.get(key(owner_raw), owner_raw)
        if owner and "@" not in owner:
            by_name.add(owner)
        start, st = parse_dt(get(r, "start_at"), order)
        due, dut = parse_dt(get(r, "due_at"), order)
        if start and not st:
            start, defaulted_time = dt.datetime.combine(start.date(), ds), defaulted_time + 1
        if due and not dut:
            due, defaulted_time = dt.datetime.combine(due.date(), dd), defaulted_time + 1
        ms = [get(r, f"milestone_{k}") for k in range(1, 5)]
        if not name:
            problems.append("thiếu tên task")
        if not owner_raw:
            problems.append("thiếu người phụ trách")
        if start is None:
            problems.append(f'start_at không đọc được ("{get(r, "start_at")}")')
        if due is None:
            problems.append(f'due_at không đọc được ("{get(r, "due_at")}")')
        if start and due and due <= start:
            problems.append("deadline phải sau thời điểm bắt đầu")
        if any(ms) and not all(ms):
            problems.append("nếu ghi mốc thì phải đủ 4 mốc")
        if not any(ms) and not get(r, "task_type"):
            problems.append("cần task_type hoặc đủ 4 mốc")
        if problems:
            errors.append((i, "; ".join(problems)))
            continue
        if due <= now:
            skipped_past.append(i)
            continue
        any_ms = any_ms or all(ms)
        if get(r, "task_type"):
            types[get(r, "task_type")] += 1
        out_rows.append({
            "task_name": name, "owner_email": owner, "task_type": get(r, "task_type"),
            "start_at": iso(start), "due_at": iso(due),
            **({f"milestone_{k}": ms[k - 1] for k in range(1, 5)} if all(ms) else {}),
            "priority_note": get(r, "priority_note"),
        })
    columns = ["task_name", "owner_email", "task_type", "start_at", "due_at"] + ([f"milestone_{k}" for k in range(1, 5)] if any_ms else []) + ["priority_note"]
    write_csv(out / "task_nhap_app.csv", columns, out_rows)

    lines_out = [
        f"Nguồn: {src.name} · mã hoá {meta['encoding']} · phân cách '{meta['sep']}' · kiểu ngày {'tháng/ngày (Mỹ)' if order == 'mdy' else 'ngày/tháng'}"
        + (" · CẢNH BÁO: không phân biệt được ngày/tháng, đang hiểu là ngày/tháng" if detected == "ambiguous" and args.date_order == "auto" else ""),
        f"Dòng đọc được: {len(rows)} · đưa vào app: {len(out_rows)} · lỗi: {len(errors)}",
        f"Bỏ qua vì đã xong/huỷ: {len(skipped_closed)} · bỏ qua vì đã qua deadline (tính tại {now:%d/%m/%Y %H:%M}): {len(skipped_past)}",
    ]
    if by_name:
        lines_out.append(
            f"{len(by_name)} người phụ trách ghi bằng tên, không phải email: app chỉ nhận nếu trùng đúng họ tên trong app. "
            "An toàn hơn: tạo file --owners (name,email)."
        )
    if defaulted_time:
        lines_out.append(f"{defaulted_time} ô ngày không có giờ: bắt đầu lấy {args.default_start}, deadline lấy {args.default_due}")
    if types:
        lines_out.append("Loại task dùng trong file (phải có đúng tên này ở trang Loại task & mốc): " + ", ".join(f"{t} ({n})" for t, n in types.most_common()))
    if skipped_past:
        lines_out.append("Dòng đã qua deadline: " + ", ".join(map(str, skipped_past[:50])) + (" …" if len(skipped_past) > 50 else ""))
    if errors:
        lines_out.append("Dòng lỗi (dòng 1 = dòng ngay dưới tiêu đề):")
        lines_out += [f"  Dòng {n}: {msg}" for n, msg in errors[:80]]
    lines_out.append("Bước tiếp: E-commerce Executive mở Task → Nhập CSV, chọn task_nhap_app.csv, xem lại phần 'App đọc ngày như sau' rồi bấm Tạo.")
    report = "\n".join(lines_out)
    (out / "bao_cao_tasks.txt").write_text(report + "\n", encoding="utf-8-sig")
    print(report)
    return 0


# ----------------------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass
    p = argparse.ArgumentParser(description="Chuẩn bị dữ liệu Bước 0 cho Go Media Ops Hub (chạy trên máy của bạn).")
    sub = p.add_subparsers(dest="cmd", required=True)

    q = sub.add_parser("quotes", help="báo giá đã duyệt → lịch sử (ẩn tên) + thư viện giá (trung vị)")
    q.add_argument("input", help="CSV báo giá, mỗi dòng một hạng mục")
    q.add_argument("--out", default="step0/out", help="thư mục kết quả (mặc định step0/out)")
    q.add_argument("--alias-map", default="private/client_alias_map.csv", help="bảng tên thật ↔ alias, giữ riêng")
    q.add_argument("--months", type=int, default=12, help="số tháng gần nhất để lấy trung vị (6–12)")
    q.add_argument("--as-of", help="ngày chốt YYYY-MM-DD (mặc định hôm nay)")
    q.add_argument("--date-order", choices=["auto", "dmy", "mdy"], default="auto")
    q.add_argument("--recode", action="store_true", help="đổi quote_code sang H-YYYY-NNN (nếu mã cũ chứa tên khách)")
    q.set_defaults(func=prepare_quotes)

    t = sub.add_parser("tasks", help="sheet task hiện tại → file nhập app (chỉ task còn hạn)")
    t.add_argument("input", help="CSV xuất từ Google Sheet của nhóm e-commerce")
    t.add_argument("--out", default="step0/out")
    t.add_argument("--owners", help="CSV name,email để đổi tên người phụ trách sang email đăng nhập")
    t.add_argument("--now", help='"YYYY-MM-DD HH:MM" coi như hiện tại (mặc định giờ máy)')
    t.add_argument("--default-start", default="08:00", help="giờ bắt đầu khi ô chỉ có ngày")
    t.add_argument("--default-due", default="17:30", help="giờ deadline khi ô chỉ có ngày")
    t.add_argument("--date-order", choices=["auto", "dmy", "mdy"], default="auto")
    t.set_defaults(func=prepare_tasks)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
