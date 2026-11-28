// 1.8 · Hành trình báo giá (CEO, buổi consult 27/11): đo thời gian TỪNG CHẶNG của mỗi báo giá và số vòng
// sửa, theo từng Account, thay vì chỉ nhìn tổng giờ. KPI chính vẫn là "gửi khách trong ≤ 8 giờ làm việc"
// (settings.quote_late_hours); thang Tốt / Trung bình / Yếu / Kém chỉ để đọc nhanh.
// Mọi thời lượng là giờ LÀM VIỆC (lịch công ty), giống KPI báo giá cũ.
import { WorkCalendar, workingHoursBetween } from './calendar';

export type JourneyStage = 'draft' | 'review' | 'fix' | 'sign' | 'send' | 'client';

/** Chặng tính vào KPI 8 giờ (từ lúc nhận yêu cầu đến lúc gửi khách). "client" nằm ngoài KPI. */
export const KPI_STAGES: JourneyStage[] = ['draft', 'review', 'fix', 'sign', 'send'];

export const STAGE_LABEL: Record<JourneyStage, string> = {
  draft: 'Account soạn',
  review: 'Chờ PM/CEO duyệt',
  fix: 'Account sửa theo góp ý',
  sign: 'Chờ CEO ký',
  send: 'Chốt và gửi khách',
  client: 'Khách xem và ký',
};

export const STAGE_OWNER: Record<JourneyStage, 'account' | 'manager' | 'client'> = {
  draft: 'account',
  review: 'manager',
  fix: 'account',
  sign: 'manager',
  send: 'account',
  client: 'client',
};

export type Grade = 'good' | 'fair' | 'weak' | 'poor';
export const GRADE_LABEL: Record<Grade, string> = { good: 'Tốt', fair: 'Trung bình', weak: 'Yếu', poor: 'Kém' };

/** Ngưỡng thang đánh giá (giờ làm việc). good = mục tiêu KPI (mặc định 8). */
export interface GradeScale {
  good: number;
  fair: number;
  weak: number;
}
export const DEFAULT_GRADE_SCALE: GradeScale = { good: 8, fair: 16, weak: 24 };

export function gradeScaleErrors(s: GradeScale): string[] {
  const errs: string[] = [];
  for (const [k, v] of Object.entries(s)) if (!Number.isFinite(v) || v <= 0 || v > 200) errs.push(`Ngưỡng "${k}" phải từ 0 đến 200 giờ.`);
  if (!errs.length && !(s.good < s.fair && s.fair < s.weak)) errs.push('Ngưỡng phải tăng dần: Tốt < Trung bình < Yếu.');
  return errs;
}

export function gradeOf(hours: number, s: GradeScale = DEFAULT_GRADE_SCALE): Grade {
  if (hours <= s.good + 1e-9) return 'good';
  if (hours <= s.fair + 1e-9) return 'fair';
  if (hours <= s.weak + 1e-9) return 'weak';
  return 'poor';
}

/** Các mốc trong bảng events (action) có ý nghĩa với hành trình. */
export interface JourneyEvent {
  action: string;
  at: number;
}

export interface JourneyQuote {
  id: string;
  code: string;
  client: string;
  accountId: string;
  accountName: string;
  requestedAt: number;
  sentAt: number | null;
  /** Lúc khách ký xác nhận (1.8), nếu có. */
  clientSignedAt?: number | null;
  events: JourneyEvent[];
}

export interface JourneySegment {
  stage: JourneyStage;
  from: number;
  to: number;
  hours: number;
}

export interface JourneyRow {
  quote: JourneyQuote;
  segments: JourneySegment[];
  /** Giờ làm việc theo chặng (chỉ chặng có thời gian). */
  stageHours: Partial<Record<JourneyStage, number>>;
  /** Tổng giờ KPI: nhận yêu cầu → gửi khách. null nếu chưa gửi. */
  kpiHours: number | null;
  /** Số lần PM/CEO yêu cầu sửa. */
  rounds: number;
  onTarget: boolean | null;
  grade: Grade | null;
  /** Chặng tốn nhiều giờ nhất trong KPI. */
  slowest: JourneyStage | null;
}

const NEXT_STATE: Record<string, JourneyStage | 'end' | 'reopen'> = {
  'quote.submitted': 'review',
  'quote.approved': 'sign',
  'quote.approved_signed': 'send',
  'quote.signed': 'send',
  'quote.changes_requested': 'fix',
  'quote.reopened': 'reopen',
  'quote.sent': 'client',
  'quote.client_signed': 'end',
  'quote.outcome': 'end',
};

/** Tách một báo giá thành các chặng liên tiếp theo các mốc trạng thái. */
export function quoteJourney(q: JourneyQuote, cal: WorkCalendar, scale: GradeScale = DEFAULT_GRADE_SCALE): JourneyRow {
  const evs = q.events.filter((e) => e.action in NEXT_STATE && e.at >= q.requestedAt).sort((a, b) => a.at - b.at);
  // Báo giá nhập lịch sử / dữ liệu cũ có thể thiếu mốc gửi: lấy sent_at của báo giá.
  if (q.sentAt !== null && !evs.some((e) => e.action === 'quote.sent')) evs.push({ action: 'quote.sent', at: q.sentAt });
  if (q.clientSignedAt && !evs.some((e) => e.action === 'quote.client_signed')) evs.push({ action: 'quote.client_signed', at: q.clientSignedAt });
  evs.sort((a, b) => a.at - b.at);

  const segments: JourneySegment[] = [];
  let state: JourneyStage | 'end' = 'draft';
  let since = q.requestedAt;
  let rounds = 0;
  const push = (to: number) => {
    if (state === 'end' || to <= since) return;
    const hours = workingHoursBetween(since, to, cal);
    const last = segments[segments.length - 1];
    if (last && last.stage === state && last.to === since) {
      last.to = to;
      last.hours += hours;
    } else segments.push({ stage: state, from: since, to, hours });
  };
  for (const e of evs) {
    if (state === 'end') break;
    // Sau khi đã gửi khách chỉ còn chờ khách; bỏ qua các mốc nội bộ đến muộn.
    if (state === 'client' && NEXT_STATE[e.action] !== 'end') continue;
    push(e.at);
    since = Math.max(since, e.at);
    const next = NEXT_STATE[e.action];
    if (e.action === 'quote.changes_requested') rounds++;
    if (next === 'reopen') state = rounds > 0 ? 'fix' : 'draft';
    else state = next;
  }
  // Báo giá đang mở: tính chặng hiện tại đến lúc này thì sai với kỳ đã chọn, nên dừng ở mốc cuối.

  const stageHours: Partial<Record<JourneyStage, number>> = {};
  for (const s of segments) if (s.hours > 0) stageHours[s.stage] = (stageHours[s.stage] ?? 0) + s.hours;
  const kpiHours = q.sentAt === null ? null : workingHoursBetween(q.requestedAt, q.sentAt, cal);
  let slowest: JourneyStage | null = null;
  for (const st of KPI_STAGES) if ((stageHours[st] ?? 0) > (slowest ? stageHours[slowest] ?? 0 : 0)) slowest = st;
  return {
    quote: q,
    segments,
    stageHours,
    kpiHours,
    rounds,
    onTarget: kpiHours === null ? null : kpiHours <= scale.good + 1e-9,
    grade: kpiHours === null ? null : gradeOf(kpiHours, scale),
    slowest,
  };
}

export interface AccountJourney {
  accountId: string;
  accountName: string;
  /** Báo giá đã gửi khách trong kỳ (mẫu số của KPI). */
  sent: number;
  onTarget: number;
  onTargetPct: number | null;
  avgHours: number | null;
  grade: Grade | null;
  /** Trung bình giờ mỗi chặng, trên các báo giá đã gửi. */
  avgStage: Record<JourneyStage, number>;
  /** Phần trăm tổng giờ KPI nằm ở từng chặng. */
  stageShare: Record<JourneyStage, number>;
  slowest: JourneyStage | null;
  rounds: number;
  avgRounds: number | null;
  /** Báo giá phải sửa ít nhất 1 lần. */
  revised: number;
  gradeCount: Record<Grade, number>;
  rank: number;
}

const zeroStages = (): Record<JourneyStage, number> => ({ draft: 0, review: 0, fix: 0, sign: 0, send: 0, client: 0 });

export function accountJourneys(rows: JourneyRow[], scale: GradeScale = DEFAULT_GRADE_SCALE): AccountJourney[] {
  const by = new Map<string, JourneyRow[]>();
  for (const r of rows) if (r.kpiHours !== null) by.set(r.quote.accountId, [...(by.get(r.quote.accountId) ?? []), r]);
  const out: AccountJourney[] = [];
  for (const [accountId, list] of by) {
    const n = list.length;
    const total = zeroStages();
    const gradeCount: Record<Grade, number> = { good: 0, fair: 0, weak: 0, poor: 0 };
    let hours = 0;
    let rounds = 0;
    let ok = 0;
    let revised = 0;
    for (const r of list) {
      for (const st of Object.keys(total) as JourneyStage[]) total[st] += r.stageHours[st] ?? 0;
      hours += r.kpiHours!;
      rounds += r.rounds;
      if (r.rounds > 0) revised++;
      if (r.onTarget) ok++;
      gradeCount[r.grade!]++;
    }
    const avgStage = zeroStages();
    for (const st of Object.keys(total) as JourneyStage[]) avgStage[st] = total[st] / n;
    const kpiSum = KPI_STAGES.reduce((s, st) => s + total[st], 0);
    const stageShare = zeroStages();
    for (const st of KPI_STAGES) stageShare[st] = kpiSum > 0 ? (total[st] * 100) / kpiSum : 0;
    let slowest: JourneyStage | null = null;
    for (const st of KPI_STAGES) if (avgStage[st] > (slowest ? avgStage[slowest] : 0)) slowest = st;
    const avgHours = hours / n;
    out.push({
      accountId,
      accountName: list[0].quote.accountName,
      sent: n,
      onTarget: ok,
      onTargetPct: (ok * 100) / n,
      avgHours,
      grade: gradeOf(avgHours, scale),
      avgStage,
      stageShare,
      slowest,
      rounds,
      avgRounds: rounds / n,
      revised,
      gradeCount,
      rank: 0,
    });
  }
  // Xếp hạng: tỉ lệ đạt mục tiêu cao hơn trước; bằng nhau thì giờ trung bình thấp hơn; rồi ít vòng sửa hơn.
  out.sort((a, b) => (b.onTargetPct ?? 0) - (a.onTargetPct ?? 0) || (a.avgHours ?? 0) - (b.avgHours ?? 0) || (a.avgRounds ?? 0) - (b.avgRounds ?? 0) || a.accountName.localeCompare(b.accountName));
  out.forEach((a, i) => (a.rank = i + 1));
  return out;
}

/** Cả đội: chặng nào chiếm nhiều giờ nhất. */
export function teamStageShare(rows: JourneyRow[]): { stage: JourneyStage; hours: number; avg: number; pct: number }[] {
  const sent = rows.filter((r) => r.kpiHours !== null);
  const total = zeroStages();
  for (const r of sent) for (const st of KPI_STAGES) total[st] += r.stageHours[st] ?? 0;
  const sum = KPI_STAGES.reduce((s, st) => s + total[st], 0);
  return KPI_STAGES.map((stage) => ({ stage, hours: total[stage], avg: sent.length ? total[stage] / sent.length : 0, pct: sum ? (total[stage] * 100) / sum : 0 }));
}
