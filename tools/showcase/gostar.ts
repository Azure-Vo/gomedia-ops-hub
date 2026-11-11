// Go Star showcase data (1.4): manager scores for Oct and Nov 2026 on the showcase people, and
// October closed by the CEO with the ranking computed by the app's own rules (src/domain/gostar.ts).
// Lark sub-tasks below mirror the showcase S1 data already on the Pilot (generate.ts).
// Every row is listed in public.seed_registry, so clear_sample_data.sql removes it.
// All names are invented.   npx tsx tools/showcase/gostar.ts > /tmp/gostar.sql
import { DEFAULT_GOSTAR_RULES, rankGoStar, type GoStarScore, type GoStarTask } from '../../src/domain';

const TZ = 'Asia/Ho_Chi_Minh';
const P = {
  thinh: '5a1f0c3e-7b2d-4e61-9a8c-2f4b6d8e1a02', // E-com Exec, scores
  anh: '5a1f0c3e-7b2d-4e61-9a8c-2f4b6d8e1a01', // PM, scores
  ceo: 'b5513125-b334-4c7c-b61e-a1a013959fa9',
};
const people = [
  ['5a1f0c3e-7b2d-4e61-9a8c-2f4b6d8e1a03', 'Trịnh Gia Huy'],
  ['838129ab-7698-4c9a-bc43-cd945485e53a', 'Nguyễn Bảo Ngọc'],
  ['ac9c6aca-9862-457a-8033-85a8871a695f', 'Phan Mỹ Duyên'],
  ['5a1f0c3e-7b2d-4e61-9a8c-2f4b6d8e1a04', 'Mai Thanh Trúc'],
  ['ed88b8ac-515a-489a-a324-bef8ba63757f', 'Lương Tuấn Kiệt'],
  ['78c9d5f1-7fe6-4c73-a43f-5663d68fab2d', 'Đặng Hữu Phước'],
].map(([id, name]) => ({ openId: `sim:${id}`, name }));
const oid = (name: string) => people.find((p) => p.name === name)!.openId;
const at = (d: string) => Date.parse(`${d}T16:00:00+07:00`);
// October sub-tasks of the showcase (due date, completed date or null).
const octTasks: GoStarTask[] = [
  { assigneeOpenId: oid('Đặng Hữu Phước'), dueDate: '2026-10-29', completedAt: null },
  { assigneeOpenId: oid('Lương Tuấn Kiệt'), dueDate: '2026-10-30', completedAt: at('2026-10-31') },
  { assigneeOpenId: oid('Nguyễn Bảo Ngọc'), dueDate: '2026-10-28', completedAt: at('2026-10-27') },
  { assigneeOpenId: oid('Phan Mỹ Duyên'), dueDate: '2026-10-30', completedAt: at('2026-10-30') },
  { assigneeOpenId: oid('Trịnh Gia Huy'), dueDate: '2026-10-31', completedAt: at('2026-10-30') },
];

type S = { kpiName: string; kpi: number; q: number; t: number; note: string; by: string };
const oct: Record<string, S> = {
  'Trịnh Gia Huy': { kpiName: '12 video TikTok shop đăng đúng lịch', kpi: 112, q: 4, t: 5, note: 'Kèm Kiệt dựng video DA061 tuần cuối tháng.', by: P.thinh },
  'Nguyễn Bảo Ngọc': { kpiName: 'Doanh số livestream shop DA061', kpi: 108, q: 5, t: 4, note: 'Kịch bản livestream được khách khen, không phải sửa.', by: P.thinh },
  'Phan Mỹ Duyên': { kpiName: '20 bài đăng fanpage KN032', kpi: 100, q: 4, t: 3, note: '', by: P.anh },
  'Mai Thanh Trúc': { kpiName: '8 thiết kế banner sàn TMĐT', kpi: 102, q: 4, t: 5, note: 'Chưa có task con đến hạn trong tháng 10.', by: P.anh },
  'Lương Tuấn Kiệt': { kpiName: '10 video ngắn DA061', kpi: 95, q: 4, t: 4, note: 'Trễ DA061-01-S02 một ngày.', by: P.thinh },
  'Đặng Hữu Phước': { kpiName: 'Báo cáo quảng cáo TM024 hằng tuần', kpi: 80, q: 3, t: 4, note: 'TM024-01-S01 quá hạn, khách phải nhắc.', by: P.thinh },
};
const nov: Record<string, S> = {
  'Trịnh Gia Huy': { kpiName: '12 video TikTok shop đăng đúng lịch', kpi: 70, q: 4, t: 4, note: 'Tạm tính đến 11/11.', by: P.thinh },
  'Phan Mỹ Duyên': { kpiName: '20 bài đăng fanpage KN032', kpi: 55, q: 5, t: 4, note: 'Tạm tính đến 11/11.', by: P.anh },
  'Mai Thanh Trúc': { kpiName: '8 thiết kế banner sàn TMĐT', kpi: 50, q: 4, t: 5, note: 'Tạm tính đến 11/11.', by: P.anh },
};

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const out: string[] = ['begin;'];
for (const [month, set, ts] of [
  ['2026-10', oct, '2026-10-31T17:00:00+07:00'],
  ['2026-11', nov, '2026-11-11T11:30:00+07:00'],
] as const) {
  for (const [name, s] of Object.entries(set)) {
    out.push(
      `insert into public.gostar_scores (month, open_id, kpi_name, kpi_pct, quality, teamwork, note, updated_by, updated_at) values (${q(month)}, ${q(oid(name))}, ${q(s.kpiName)}, ${s.kpi}, ${s.q}, ${s.t}, ${q(s.note)}, ${q(s.by)}, ${q(ts)}) on conflict (month, open_id) do nothing;`,
    );
    out.push(`insert into public.seed_registry (table_name, row_id) values ('gostar_scores', ${q(`${month}|${oid(name)}`)}) on conflict do nothing;`);
  }
}
const scores = new Map<string, GoStarScore>(Object.entries(oct).map(([n, s]) => [oid(n), { kpiPct: s.kpi, quality: s.q, teamwork: s.t }]));
const closedAt = '2026-11-02T09:15:00+07:00';
const rows = rankGoStar(people, octTasks, scores, '2026-10', Date.parse(closedAt), TZ);
const result = { rows, rules: DEFAULT_GOSTAR_RULES, computedAt: new Date(closedAt).toISOString() };
out.push(`insert into public.gostar_months (month, result, finalized_by, finalized_at) values ('2026-10', ${q(JSON.stringify(result))}::jsonb, ${q(P.ceo)}, ${q(closedAt)}) on conflict (month) do nothing;`);
out.push(`insert into public.seed_registry (table_name, row_id) values ('gostar_months', '2026-10') on conflict do nothing;`);
out.push('commit;');
console.error(rows.map((r) => `${r.rank}. ${r.name} ${r.starCount}★ ${r.prize}`).join('\n'));
console.log(out.join('\n'));
