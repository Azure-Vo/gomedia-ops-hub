// 1.8 · Thang Tốt / Trung bình / Yếu / Kém của Hành trình báo giá. Mức "Tốt" là mục tiêu KPI
// (settings.quote_late_hours, mặc định 8 giờ, Admin chỉnh ở Cài đặt); CEO chỉnh hai ngưỡng còn lại.
import { gradeScaleErrors } from '../../../src/domain/index';
import { Ctx, loadSettings, Profile, requireRole } from './context';
import { ApiError, must } from './http';

export async function setGradeScale(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  requireRole(user, 'ceo', 'admin');
  const s = await loadSettings(ctx.db);
  const scale = { good: Number(s.quote_late_hours) || 8, fair: Number(body.fair), weak: Number(body.weak) };
  const errs = gradeScaleErrors(scale);
  if (errs.length) throw new ApiError(400, 'bad_scale', errs.join(' '));
  must(await ctx.db.from('settings').update({ quote_grade_fair_hours: scale.fair, quote_grade_weak_hours: scale.weak }).eq('id', 1), 'save grade scale');
  await ctx.db.from('events').insert({ actor: user.id, entity: 'settings', entity_id: '1', action: 'quote.grade_scale', payload: scale });
  return { scale };
}
