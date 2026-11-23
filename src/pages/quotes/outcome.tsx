import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LOST_REASON_LABEL, LostReason, OUTCOME_LABEL, QuoteOutcome } from '@/domain';
import { Badge, Button, cx, Field, Input, Select, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnDateTime } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { personName, QuoteRow } from './data';

type People = Map<string, { full_name: string; email: string; role: string }>;

/** 1.7 · The client's answer on a sent quote, and the project it became. */
export function OutcomeBlock({ quote, people, canEdit, onSaved }: { quote: QuoteRow; people: People; canEdit: boolean; onSaved: () => void }) {
  const { tz } = useSettings();
  const toast = useToast();
  const link = useAsync(async () => {
    const r = check(await supabase.from('project_quotes').select('project_id').eq('quote_id', quote.id).maybeSingle()) as { project_id: string } | null;
    if (!r) return null;
    // The Account sees the project read-only; others may not see it at all (then only the code is unknown).
    return (check(await supabase.from('lark_tasks').select('id, code, name').eq('id', r.project_id).maybeSingle()) as { id: string; code: string; name: string } | null) ?? { id: r.project_id, code: '', name: '' };
  }, [quote.id]);
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<QuoteOutcome | ''>(quote.outcome ?? '');
  const [pm, setPm] = useState(quote.handover_pm ?? '');
  const [reason, setReason] = useState<LostReason | ''>(quote.lost_reason ?? '');
  const [note, setNote] = useState(quote.lost_note ?? '');
  const [busy, setBusy] = useState(false);
  const pms = [...people.entries()].filter(([, p]) => p.role === 'pm');
  const hasProject = !!link.data;
  const ready = outcome === 'won' ? !!pm : outcome === 'lost' ? !!reason : false;

  async function save(next: QuoteOutcome | null) {
    setBusy(true);
    try {
      await callApi('quote.outcome', { quote_id: quote.id, outcome: next, handover_pm: pm || null, lost_reason: reason || null, lost_note: note });
      toast(next ? `Đã ghi: ${OUTCOME_LABEL[next]}` : 'Đã xoá kết quả');
      setEditing(false);
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const summary = quote.outcome ? (
    <div className="flex flex-wrap items-center gap-2 text-[14px]">
      <Badge tone={quote.outcome === 'won' ? 'ok' : 'neutral'}>{OUTCOME_LABEL[quote.outcome]}</Badge>
      {quote.outcome === 'won' && <span className="text-ink-2">PM nhận: {personName(people, quote.handover_pm)}</span>}
      {quote.outcome === 'lost' && quote.lost_reason && (
        <span className="text-ink-2">
          {LOST_REASON_LABEL[quote.lost_reason]}
          {quote.lost_note ? ` · ${quote.lost_note}` : ''}
        </span>
      )}
      {quote.outcome_at && <span className="text-[12.5px] text-ink-3">{fmtVnDateTime(quote.outcome_at, tz)}</span>}
      {link.data &&
        (link.data.code ? (
          <Link to={`/du-an/${encodeURIComponent(link.data.code)}`} className="font-semibold text-brand hover:underline">
            → Dự án {link.data.code}
          </Link>
        ) : (
          <span className="text-ink-3">Đã có dự án</span>
        ))}
      {quote.outcome === 'won' && !link.data && <span className="text-ink-3">Chờ PM tạo dự án</span>}
    </div>
  ) : (
    <p className="text-[14px] text-ink-3">Chưa có câu trả lời của khách.</p>
  );

  return (
    <div className="mt-4 rounded-lg border border-line-soft bg-canvas/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-ink">Khách trả lời</h3>
        {canEdit && !hasProject && !editing && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {quote.outcome ? 'Sửa' : 'Ghi kết quả'}
          </Button>
        )}
      </div>
      {!editing ? (
        summary
      ) : (
        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label="Kết quả" className="flex flex-wrap gap-2">
            {(['won', 'lost'] as QuoteOutcome[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={outcome === k} onClick={() => setOutcome(k)} className={cx('min-h-[36px] rounded-full border px-3.5 text-[14px] font-medium', outcome === k ? (k === 'won' ? 'border-ok bg-ok text-white' : 'border-ink bg-ink text-white') : 'border-line bg-white text-ink-2 hover:border-ink-3')}>
                {OUTCOME_LABEL[k]}
              </button>
            ))}
          </div>
          {outcome === 'won' && (
            <Field label="PM nhận dự án" hint="PM được báo để tạo dự án từ báo giá này">
              {(id) => (
                <Select id={id} value={pm} onChange={(e) => setPm(e.target.value)}>
                  <option value="">Chọn PM…</option>
                  {pms.map(([pid, p]) => (
                    <option key={pid} value={pid}>
                      {p.full_name || p.email}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {outcome === 'lost' && (
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <Field label="Lý do">
                {(id) => (
                  <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as LostReason)}>
                    <option value="">Chọn lý do…</option>
                    {(Object.keys(LOST_REASON_LABEL) as LostReason[]).map((k) => (
                      <option key={k} value={k}>
                        {LOST_REASON_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Ghi chú (không bắt buộc)">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}</Field>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {quote.outcome && (
              <Button variant="ghost" busy={busy} onClick={() => save(null)}>
                Xoá kết quả
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Huỷ
            </Button>
            <Button busy={busy} disabled={!ready} onClick={() => outcome && save(outcome)}>
              Lưu
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
