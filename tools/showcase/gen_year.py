"""Go Media Ops Hub · one year of project history for the BC26 report (Pilot, Lark simulation).

Writes tools/showcase/seed_year_2026.sql (and chunk files for the SQL editor / MCP). Dates are fixed:
Dec 2025 → 26 Nov 2026. The story the data tells, measured like the Dashboard (sub-task late = accepted
after its KPI deadline, or still open past it):

  * Dec 2025 – Jun 2026, before Ops Hub: about half of the tasks late (manual sheet + fixed bot reminder).
  * Jul – Aug 2026: exactly the three projects on the "Symptom 1" slide: Bermy Vietnam 3/8, Jullien Day 6/10,
    Ngọc Huyền 7/11 → 16/29 late (55 %). No other task is due in July or August.
  * Sep – 25 Oct 2026: still before Ops Hub, ~45 % late.
  * 26 Oct – 26 Nov 2026 (Ops Hub pilot, settings.pilot_start): new projects nearly all on time, so the pilot
    window including the existing demo projects stays under the 20 % KPI.

Every row is listed in seed_registry, so supabase/setup/clear_sample_data.sql removes it. The SQL stops
without changes if project BMY07 already exists. No timestamp is later than 23 Nov 2026 18:00.
"""

from __future__ import annotations

import datetime as dt
import json
import random
from pathlib import Path

R = random.Random(2026_11_24)
D = dt.date
HOLIDAYS = {D(2026, 1, 1), *[D(2026, 2, d) for d in range(16, 21)], D(2026, 4, 27), D(2026, 4, 30), D(2026, 5, 1), D(2026, 9, 1), D(2026, 9, 2)}
LAST_STAMP = D(2026, 11, 23)  # nothing happens after this day (the data is loaded on 24/11)
PILOT = D(2026, 10, 26)
APP = 'https://azure-vo.github.io/gomedia-ops-hub'


def workday(d: D) -> bool:
    return d.weekday() < 5 and d not in HOLIDAYS


def add_work(d: D, n: int) -> D:
    step = 1 if n >= 0 else -1
    while not workday(d):
        d += dt.timedelta(days=step)
    k = abs(n)
    while k:
        d += dt.timedelta(days=step)
        if workday(d):
            k -= 1
    return d


def on_or_after(d: D) -> D:
    while not workday(d):
        d += dt.timedelta(days=1)
    return d


PM_A = 'anh.vq@gomedia.local'
PM_T = 'long.nguyen230608+pm@vnuk.edu.vn'
STAFF = ['duyen.pm@gomedia.local', 'huy.tg@gomedia.local', 'kiet.lt@gomedia.local', 'ngoc.nb@gomedia.local', 'phuoc.dh@gomedia.local',
         'truc.mt@gomedia.local', 'thinh.hd@gomedia.local', 'long.nguyen230608+nv1@vnuk.edu.vn', 'long.nguyen230608+nv2@vnuk.edu.vn']

SERVICES = {
    'ecom': ('Chiến dịch E-commerce', ['Lập kế hoạch chiến dịch E-commerce', 'Lựa chọn KOC/KOL', 'Điều phối nội dung KOC', 'Sản xuất nội dung TikTok',
                                        'Điều chỉnh banner sản phẩm trên sàn', 'Triển khai & điều phối chiến dịch', 'Theo dõi hiệu suất', 'Báo cáo chiến dịch']),
    'live': ('Livestream bán hàng', ['Lập kế hoạch chiến lược E-commerce', 'Lựa chọn & briefing KOC/KOL', 'Lập kế hoạch livestream', 'Chuẩn bị livestream',
                                     'Thực hiện chiến dịch livestream', 'Theo dõi hiệu suất', 'Báo cáo chiến dịch']),
    'seo': ('SEO Google Maps & website', ['Thiết lập SEO Google Maps', 'Lập kế hoạch từ khoá & nội dung', 'Cập nhật nội dung Google Maps', 'Viết 8 bài chuẩn SEO',
                                          'Theo dõi thứ hạng từ khoá', 'Báo cáo SEO tháng']),
    'pr': ('PR & Booking báo chí', ['Lập kế hoạch PR/Booking', 'Điều phối Media/PR Booking', 'Duyệt bài PR với báo', 'Theo dõi lịch đăng bài', 'Báo cáo PR']),
    'tiktok': ('Xây kênh TikTok', ['Lập kế hoạch kênh TikTok', 'Viết kịch bản 12 video', 'Quay video', 'Dựng video', 'Đăng tải nội dung', 'Theo dõi hiệu suất kênh']),
    'fanpage': ('Vận hành fanpage', ['Lập lịch nội dung tháng', 'Thiết kế 20 ấn phẩm', 'Viết caption 20 bài', 'Chạy quảng cáo Facebook', 'Báo cáo fanpage tháng']),
    'brand': ('Bộ nhận diện thương hiệu', ['Brief và moodboard', 'Thiết kế 3 hướng logo', 'Hoàn thiện bộ nhận diện', 'Thiết kế ấn phẩm in', 'Bàn giao file gốc']),
    'video': ('Video quảng cáo sản phẩm', ['Viết kịch bản video', 'Book studio và talent', 'Quay video sản phẩm', 'Dựng video', 'Duyệt bản dựng với khách', 'Bàn giao video']),
    'event': ('Truyền thông sự kiện', ['Lên kế hoạch sự kiện', 'Thiết kế backdrop & standee', 'Quay chụp sự kiện', 'Dựng video highlight', 'Báo cáo sự kiện']),
}
OUTPUT = {
    'Lập kế hoạch': 'File kế hoạch đã gửi khách duyệt',
    'Lựa chọn': 'Danh sách KOC/KOL đã chốt, kèm rate card',
    'Điều phối': 'Lịch đăng và link bài đã lên',
    'Sản xuất': 'Video đã dựng, có phụ đề',
    'Điều chỉnh': 'Bộ banner mới đã cập nhật trên sàn',
    'Triển khai': 'Ảnh chụp chiến dịch đang chạy và link',
    'Theo dõi': 'Bảng số liệu cập nhật hằng ngày',
    'Báo cáo': 'Slide báo cáo gửi khách',
    'Chuẩn bị': 'Checklist chuẩn bị đã hoàn tất',
    'Thực hiện': 'Link các buổi live và số đơn',
    'Thiết lập': 'Ảnh chụp hồ sơ Google Maps đã tối ưu',
    'Cập nhật': 'Danh sách nội dung đã cập nhật',
    'Viết': 'File nội dung đã được duyệt',
    'Duyệt': 'Bản đã được khách duyệt',
    'Quay': 'Thư mục footage đã quay',
    'Dựng': 'Bản dựng hoàn chỉnh',
    'Đăng': 'Link bài đã đăng',
    'Thiết kế': 'File thiết kế PNG + file gốc',
    'Chạy': 'Ảnh chụp trình quản lý quảng cáo',
    'Brief': 'Brief và moodboard đã gửi khách',
    'Hoàn thiện': 'Bộ nhận diện hoàn chỉnh (PDF)',
    'Bàn giao': 'Thư mục bàn giao cho khách',
    'Book': 'Xác nhận studio và talent',
    'Lên': 'Kế hoạch sự kiện đã duyệt',
}


def output_for(name: str) -> str:
    for k, v in OUTPUT.items():
        if name.startswith(k):
            return v
    return 'Kết quả theo yêu cầu đã gửi PM'


CLIENTS = ['Cà phê Hạt Mộc', 'Mỹ phẩm Sen Hồng', 'Thời trang Lam Nhi', 'Nội thất Gỗ Thông', 'Bánh ngọt Mây', 'Nhà hàng Biển Xanh', 'Spa An Nhiên', 'Gốm Hội An Xưa',
           'Nước mắm Nam Ô', 'Khách sạn Sơn Trà View', 'Trà Cổ Thụ', 'Tour Ngũ Hành', 'Sữa chua Đồng Xanh', 'Giày Đà Thành', 'Yến sào Cù Lao', 'Mật ong Rừng Tràm',
           'Nệm Êm Ái', 'Nha khoa Smile Care', 'Anh ngữ Sky', 'Căn hộ Hoà Xuân', 'Kem Tuyết Sơn', 'Đồ chơi Gỗ Bé Na', 'Phở Cồ Hàn', 'Túi xách Mi Mi', 'Bia thủ công Sông Hàn',
           'Kính mắt Tầm Nhìn', 'Hải sản Mỹ Khê', 'Sữa hạt Lành', 'Nến thơm Hương Quê', 'Trang sức Ngọc Bích', 'Xe điện Gió Xanh', 'Thực phẩm Sạch Nhà Mình',
           'Cửa hàng Thú cưng Mập', 'Đồng hồ Thời Gian', 'Vali Du Lịch Đi', 'Trà sữa Gạo Rang', 'Bột giặt Trắng Trong', 'Phòng gym Khoẻ']
COLORS = ['#2F5BD3', '#D9822B', '#2E8B57', '#8A4FC7', '#C0392B', '#1C8C9E', '#B8860B', '#4E79D9', '#E08A2E', '#4E9F6B', '#8C63D2']

# ------------------------------------------------------------------------------------------- plan ----


class Project:
    def __init__(self, code, name, client, pm, start, service, tasks, late, late_days=(1, 4), pilot=False, open_after=None, names=None):
        self.code, self.name, self.client, self.pm, self.start, self.service = code, name, client, pm, start, service
        self.n, self.late, self.late_days, self.pilot, self.open_after, self.names = tasks, late, late_days, pilot, open_after, names


plan: list[Project] = []
used = set()


def code_for(service: str, month: int) -> str:
    pre = {'ecom': 'EC', 'live': 'LV', 'seo': 'SE', 'pr': 'PR', 'tiktok': 'TK', 'fanpage': 'FP', 'brand': 'BR', 'video': 'VD', 'event': 'EV'}[service]
    while True:
        c = f'{pre}{R.randint(10, 99)}'
        if c not in used and c not in {'SE08', 'VD15'}:
            used.add(c)
            return c


clients = CLIENTS[:]
R.shuffle(clients)


EXTRA_FIRST, EXTRA_LAST = 'Họp chốt brief với khách', 'Nghiệm thu và bàn giao cho khách'


def names_for(service: str, n: int) -> list[str]:
    base = SERVICES[service][1]
    if n <= len(base):
        return base[:n]
    extra = [EXTRA_FIRST] + base + [EXTRA_LAST]
    return extra[:n] if n <= len(extra) else extra


def add(start: D, service: str, rate: float, pilot=False, open_after=None, n=None):
    title, names = SERVICES[service]
    n = n or min(len(names), R.randint(5, len(names)))
    client = clients.pop()
    code = code_for(service, start.month)
    late = round(n * rate)
    plan.append(Project(code, f'{title} {client}', f'{client} (mẫu)', R.choice([PM_A, PM_T]), start, service, n, late, pilot=pilot, open_after=open_after))


# Dec 2025 – Jun 2026: before Ops Hub. Projects end before 1 July.
pre_months = [(2025, 12, 3), (2026, 1, 3), (2026, 2, 2), (2026, 3, 3), (2026, 4, 3), (2026, 5, 3), (2026, 6, 3)]
for y, m, k in pre_months:
    for i in range(k):
        day = 2 + i * 7 + R.randint(0, 2)
        start = on_or_after(D(y, m, day))
        if y == 2026 and m == 6:
            start = on_or_after(D(2026, 6, 1 + i * 3))
        add(start, R.choice(list(SERVICES)), R.choice([0.4, 0.5, 0.5, 0.6]))

# Jul – Aug 2026: the slide's three projects, task names and late counts as on the slide.
BERMY = ['Lập kế hoạch chiến dịch E-commerce', 'Lựa chọn KOC/KOL', 'Điều phối nội dung KOC', 'Sản xuất nội dung TikTok',
         'Điều chỉnh banner sản phẩm trên sàn', 'Triển khai & điều phối chiến dịch', 'Theo dõi hiệu suất', 'Báo cáo chiến dịch']
BERMY_LATE = {'Lựa chọn KOC/KOL', 'Điều phối nội dung KOC', 'Điều chỉnh banner sản phẩm trên sàn'}
JULLIEN = ['Lập kế hoạch chiến lược E-commerce', 'Lựa chọn & briefing KOC/KOL', 'Điều phối nội dung KOC', 'Lập kế hoạch livestream', 'Chuẩn bị livestream',
           'Sản xuất nội dung TikTok', 'Thực hiện chiến dịch livestream', 'Điều chỉnh nội dung E-commerce', 'Theo dõi hiệu suất', 'Báo cáo chiến dịch']
JULLIEN_LATE = {'Lựa chọn & briefing KOC/KOL', 'Điều phối nội dung KOC', 'Lập kế hoạch livestream', 'Chuẩn bị livestream', 'Thực hiện chiến dịch livestream', 'Theo dõi hiệu suất'}
HUYEN = ['Thiết lập SEO Google Maps', 'Lập kế hoạch từ khóa & nội dung', 'Cập nhật nội dung Google Maps', 'Lập kế hoạch PR/Booking', 'Điều phối Media/PR Booking',
         'Lập kế hoạch kênh TikTok', 'Sản xuất nội dung TikTok', 'Quay video', 'Dựng video', 'Đăng tải nội dung', 'Theo dõi hiệu suất']
HUYEN_LATE = {'Lập kế hoạch PR/Booking', 'Điều phối Media/PR Booking', 'Sản xuất nội dung TikTok', 'Quay video', 'Dựng video', 'Theo dõi hiệu suất', 'Đăng tải nội dung'}
plan.append(Project('BMY07', 'Chiến dịch E-commerce tháng 7', 'Bermy Vietnam', PM_A, D(2026, 7, 1), 'ecom', 8, 3, (2, 3), names=(BERMY, BERMY_LATE)))
plan.append(Project('JLD07', 'Livestream & E-commerce tháng 7', 'Jullien Day', PM_T, D(2026, 7, 1), 'live', 10, 6, (2, 4), names=(JULLIEN, JULLIEN_LATE)))
plan.append(Project('NHY08', 'SEO, PR và kênh TikTok tháng 8', 'Ngọc Huyền', PM_A, D(2026, 8, 3), 'seo', 11, 7, (1, 3), names=(HUYEN, HUYEN_LATE)))
used.update({'BMY07', 'JLD07', 'NHY08'})

# Sep – 25 Oct 2026: still before Ops Hub. Tasks due 1 Sep .. 23 Oct.
for i, start in enumerate([D(2026, 9, 3), D(2026, 9, 8), D(2026, 9, 21), D(2026, 9, 28), D(2026, 10, 1), D(2026, 10, 5)]):
    add(start, R.choice(list(SERVICES)), R.choice([0.4, 0.5]), n=5)

# 26 Oct – 26 Nov 2026: Ops Hub pilot. Two projects run on into December (later tasks still open).
for i, start in enumerate([D(2026, 10, 26), D(2026, 10, 27), D(2026, 10, 29), D(2026, 11, 2), D(2026, 11, 3), D(2026, 11, 5), D(2026, 11, 9), D(2026, 11, 10), D(2026, 11, 2), D(2026, 10, 28), D(2026, 11, 4)]):
    add(start, R.choice(['ecom', 'live', 'video', 'tiktok', 'seo']), 0.0, pilot=True, open_after=D(2026, 11, 26) if i in (6, 7) else None, n=R.randint(8, 9))
# exactly three late tasks in the pilot projects
for p in R.sample([p for p in plan if p.pilot and not p.open_after], 3):
    p.late = 1

# ---------------------------------------------------------------------------------------- schedule ----


def cap_for(p: Project):
    if p.open_after or p.names:
        return None
    if p.pilot:
        return D(2026, 11, 26)
    if p.start >= D(2026, 9, 1):
        return D(2026, 10, 23)
    if p.start >= D(2026, 6, 1):
        return D(2026, 6, 30)
    return None


def schedule(p: Project):
    """Due dates spread over the project; returns [(name, assignee, start, due, late_days or 0)]."""
    names = p.names[0] if p.names else names_for(p.service, p.n)
    late_set = set(p.names[1]) if p.names else set(R.sample(names, p.late))
    team = R.sample(STAFF, 3 if p.n <= 6 else 4)
    span = 18 if p.n <= 6 else 24
    if p.code in ('BMY07', 'JLD07'):
        span = 20
    if p.code == 'NHY08':
        span = 19
    if p.open_after:
        span = 34
    cap = cap_for(p)
    if cap:
        room = 0
        d = p.start
        while d < cap:
            d = add_work(d, 1)
            if d <= cap:
                room += 1
        span = min(span, room)
    rows = []
    for i, nm in enumerate(names):
        due = add_work(p.start, max(2, round((i + 1) * span / len(names))))
        st = add_work(due, -R.randint(2, 5))
        if st < p.start:
            st = p.start
        late = R.randint(*p.late_days) if nm in late_set else 0
        rows.append((nm, team[i % len(team)], st, due, late))
    return rows


# --------------------------------------------------------------------------------------------- sql ----

HELPERS = open(Path(__file__).with_name('seed_year_helpers.sql'), encoding='utf-8').read()


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def ts(d: D, hm: str) -> str:
    return f"pg_temp.ts('{d.isoformat()}', '{hm}')"


def reminder_msg(p: Project, code: str, name: str, who_name: str, due: D, badge: str, overdue: int) -> dict:
    title = f'🔴 Task đã quá hạn {overdue} ngày – Chưa nộp!' if overdue else ('⏰ Hôm nay là hạn chót' if badge == 'D0' else f'🔔 Còn {badge[2:]} ngày đến hạn')
    return {
        'tone': 'red' if overdue or badge == 'D0' else 'orange',
        'title': title,
        'badge': badge,
        'lines': [
            {'icon': '📌', 'label': 'Dự án', 'text': f'[{p.code}] {p.name}'},
            {'icon': '🔸', 'label': 'Task', 'text': f'{name} ({code})'},
            {'icon': '👤', 'label': 'Người thực hiện', 'text': who_name},
            {'icon': '⏰', 'label': 'Hạn chót', 'text': due.strftime('%d/%m/%Y')},
        ],
        'note': 'Vui lòng nộp kết quả ngay hoặc báo PM.' if overdue else 'Xong việc thì bấm Nộp kết quả trên Ops Hub.',
    }


def approved_msg(p: Project, code: str, name: str, who_name: str) -> dict:
    return {'tone': 'green', 'title': f'✅ {code} hoàn thành', 'lines': [{'icon': '📌', 'label': 'Dự án', 'text': f'[{p.code}] {p.name}'},
            {'icon': '🔸', 'label': 'Task', 'text': f'{name} ({code})'}, {'icon': '👤', 'label': 'Người thực hiện', 'text': who_name}], 'note': 'PM đã duyệt kết quả. Cảm ơn bạn!'}


NAMES = {}


def project_sql(p: Project) -> str:
    rows = schedule(p)
    end = max(r[3] for r in rows)
    out = [f"  -- {p.code} · {p.client} · {len(rows)} task, {sum(1 for r in rows if r[4])} trễ",
           f"  p := pg_temp.project({q(p.code)}, {q(p.name)}, {q(p.client)}, pg_temp.uid({q(p.pm)}), '{p.start}', '{max(end, p.open_after or end)}', {q(R.choice(COLORS))}, {'true' if p.pilot else 'false'});"]
    for who in sorted({r[1] for r in rows}):
        out.append(f"  perform pg_temp.member(p, pg_temp.uid({q(who)}), {ts(add_work(p.start, -1), '09:00')});")
    last = p.start
    for i, (nm, who, st, due, late) in enumerate(rows):
        code = f'{p.code}-{i + 1:02d}'
        out.append(f"  t := pg_temp.task(p, {q(nm)}, {q(output_for(nm))}, pg_temp.uid({q(who)}), '{st}', '{due}', {ts(add_work(st, -1), '15:00')});")
        if p.open_after and due > D(2026, 11, 26):
            if (due - LAST_STAMP).days <= 10:
                out.append(f"  perform pg_temp.checkin(t, 50, '{add_work(st, 2) if add_work(st, 2) <= LAST_STAMP else LAST_STAMP}', 'on_plan');")
            continue
        # submission day: on time = due day or 1-2 work days before; late = after
        sub = add_work(due, late) if late else add_work(due, -R.choice([0, 0, 1, 1, 2]))
        if sub > LAST_STAMP:
            sub = LAST_STAMP
        if p.pilot and add_work(st, 0) < due and (due - st).days >= 4:
            ans = 'behind' if late else 'on_plan'
            mid = add_work(st, max(1, (due - st).days // 3))
            if mid <= LAST_STAMP:
                out.append(f"  perform pg_temp.checkin(t, 50, '{mid}', {q(ans)}{', ' + q('Khách duyệt nội dung chậm') if ans == 'behind' else ''});")
        # a sent-back round first, more often before Ops Hub
        if R.random() < (0.12 if p.pilot else 0.25) and add_work(sub, -2) > st:
            first = add_work(sub, -2)
            out.append(f"  perform pg_temp.submit(t, {ts(first, '16:30')}, 'changes', {ts(add_work(first, 1), '09:30')}, {q(R.choice(['Thiếu số liệu so sánh với tháng trước, bổ sung giúp mình.', 'Khách muốn đổi tông màu ấm hơn, sửa lại 3 ấn phẩm.', 'Còn lỗi chính tả ở phần mô tả, rà lại toàn bộ.', 'Chưa đủ số lượng theo brief, bổ sung cho đủ.']))});")
        hm = R.choice(['10:20', '14:05', '16:40', '17:15'])
        decided = add_work(sub, 1) if add_work(sub, 1) <= LAST_STAMP else sub
        out.append(f"  perform pg_temp.submit(t, {ts(sub, hm)}, 'approved', {ts(decided, '09:10' if decided > sub else '18:00')});")
        last = max(last, decided)
        if p.pilot:
            nm_who = f"(select coalesce(nullif(full_name, ''), email) from public.profiles where email = {q(who)})"
            # reminders the bot sent before the task was in: D-1 for longer tasks, D0 when submitted on the day, then daily when late
            days = []
            if (due - st).days >= 4 and add_work(due, -1) <= sub:
                days.append((add_work(due, -1), 'D-1', 0))
            if sub >= due:
                days.append((due, 'D0', 0))
            for k in range(1, late + 1):
                d = add_work(due, k)
                if d <= sub:
                    days.append((d, f'D+{k}', k))
            for d, badge, od in days:
                msg = json.dumps(reminder_msg(p, code, nm, '§WHO§', due, badge, od), ensure_ascii=False)
                out.append(f"  perform pg_temp.bot(p, t, 'reminder', {q(msg)}, {nm_who}, '{d}', {ts(d, '09:00')}, {q(f'seed|reminder|{code}|{d}')});")
            msg = json.dumps(approved_msg(p, code, nm, '§WHO§'), ensure_ascii=False)
            out.append(f"  perform pg_temp.bot(p, t, 'approved', {q(msg)}, {nm_who}, '{decided}', {ts(decided, '09:12')}, {q(f'seed|approved|{code}')});")
    if not p.open_after:
        out.append(f"  update public.lark_tasks set state = 'done', closed_at = {ts(last, '18:00')} where id = p;")
    return '\n'.join(out)


blocks = []
for p in plan:
    blocks.append(project_sql(p))

stats = []
for p in plan:
    pass

header = f"""-- =====================================================================================
-- Go Media Ops Hub · one year of project history (Dec 2025 → 26 Nov 2026), {len(plan)} projects.
-- Generated by tools/showcase/gen_year.py; see the story there. Run after seed_1.6.sql.
-- =====================================================================================
"""


def chunk(bodies: list[str], guard: bool) -> str:
    g = """  if exists (select 1 from public.lark_tasks where kind = 'parent' and upper(code) = 'BMY07' and deleted_at is null) then
    raise notice 'BMY07 already exists: one-year history not loaded again.';
    return;
  end if;
""" if guard else ''
    return HELPERS + "\ndo $$\ndeclare p uuid; t uuid;\nbegin\n" + g + '\n'.join(bodies) + "\nend $$;\n"


out_dir = Path(__file__).parent
full = header + chunk(blocks, True)
(out_dir / 'seed_year_2026.sql').write_text(full, encoding='utf-8')
size = 0
parts, cur = [], []
for b in blocks:
    cur.append(b)
    size += len(b)
    if size > 45000:
        parts.append(cur)
        cur, size = [], 0
if cur:
    parts.append(cur)
for i, part in enumerate(parts):
    Path(f'/tmp/seed_year_part{i}.sql').write_text(chunk(part, i == 0), encoding='utf-8')
print(len(plan), 'projects,', sum(p.n for p in plan), 'tasks,', len(parts), 'parts')
print('pilot tasks', sum(p.n for p in plan if p.pilot and not p.open_after), 'late', sum(p.late for p in plan if p.pilot))
pre=[p for p in plan if not p.pilot and not p.names]; print('pre tasks', sum(p.n for p in pre), 'late', sum(p.late for p in pre))
for p in plan:
    print(p.code, p.start, p.n, p.late, 'pilot' if p.pilot else '', 'open' if p.open_after else '')
