import { useMemo, useState } from 'react';
import { baselineCheck, CaseResult, DOMAIN_VERSION, fmtNum, inBaselinePeriod, quoteKpis, runDomainCases } from '@/domain';
import { Badge, Banner, Button, Card, ErrorBox, Icon, Loading, PageHeader, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { config } from '@/lib/config';
import { downloadText, toCsv } from '@/lib/csv';
import { fmtVnDateTime, timeAgo } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';

interface Health {
  domainVersion: string;
  cases: CaseResult[];
  appEnv: 'pilot' | 'demo';
  cronSecretConfigured: boolean;
  telegram: { configured: boolean; tokenValid?: boolean; username?: string | null; webhookOk?: boolean; webhookUrl?: string | null; webhookExpected?: string; pending?: number | null; lastError?: string | null; lastErrorAt?: string | null };
  systemStatus: Record<string, { at?: string } & Record<string, unknown>>;
  serverTime: string;
}

function CaseTable({ rows }: { rows: CaseResult[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-[14px]">
        <thead className="text-[13px] text-ink-3">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-semibold">#</th>
            <th className="py-2 pr-3 font-semibold">Luật</th>
            <th className="py-2 pr-3 font-semibold">Đầu vào (lịch mặc định)</th>
            <th className="py-2 pr-3 font-semibold">Mong đợi</th>
            <th className="py-2 pr-3 font-semibold">Thực tế</th>
            <th className="py-2 font-semibold">Kết quả</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line-soft">
              <td className="py-2 pr-3 text-ink-3">{r.id}</td>
              <td className="py-2 pr-3 font-semibold">{r.rule}</td>
              <td className="py-2 pr-3">{r.input}</td>
              <td className="py-2 pr-3 tabular-nums">{r.expected}</td>
              <td className={`py-2 pr-3 tabular-nums ${r.pass ? '' : 'font-bold text-bad'}`}>{r.actual}</td>
              <td className="py-2">{r.pass ? <Badge tone="ok">PASS</Badge> : <Badge tone="solidBad">FAIL</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Check({ ok, label, children }: { ok: boolean | null; label: string; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 border-b border-line-soft py-2.5 last:border-0">
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${ok === null ? 'bg-line-soft text-ink-3' : ok ? 'bg-ok text-white' : 'bg-bad text-white'}`}>
        <Icon name={ok === null ? 'clock' : ok ? 'check' : 'x'} size={14} />
      </span>
      <div className="min-w-0">
        <div className="font-semibold text-ink">{label}</div>
        {children && <div className="text-[13.5px] text-ink-3">{children}</div>}
      </div>
    </li>
  );
}

export function DiagnosticsPage() {
  const { calendar, tz, settings } = useSettings();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const browser = useMemo(() => runDomainCases(), []);
  const server = useAsync(() => callApi<Health>('system.health'), []);
  const baseline = useAsync(async () => {
    const rows = check(await supabase.from('quotes').select('id, code, requested_at, sent_at').eq('source', 'import').eq('status', 'sent').order('requested_at')) as { id: string; code: string; requested_at: string; sent_at: string }[];
    return rows;
  }, []);

  const lateHours = settings?.quote_late_hours ?? 8;
  const base = useMemo(() => {
    const qs = (baseline.data ?? []).map((r) => ({ id: r.id, requestedAt: Date.parse(r.requested_at), sentAt: Date.parse(r.sent_at) }));
    const inPeriod = qs.filter((q) => inBaselinePeriod(q.requestedAt, calendar.timeZone));
    return { check: baselineCheck(qs, calendar, lateHours), rows: quoteKpis(inPeriod, calendar, lateHours).rows };
  }, [baseline.data, calendar, lateHours]);
  const demoData = (baseline.data ?? []).length > 0 && (baseline.data ?? []).every((r) => r.code.startsWith('DEMO-'));

  const h = server.data;
  const browserPass = browser.filter((c) => c.pass).length;
  const serverPass = h ? h.cases.filter((c) => c.pass).length : 0;
  const versionOk = h ? h.domainVersion === DOMAIN_VERSION : null;
  const lastDispatch = h?.systemStatus?.dispatch?.at as string | undefined;
  const lastClose = h?.systemStatus?.close?.at as string | undefined;
  const stale = (t?: string) => !t || Date.now() - Date.parse(t) > 35 * 60_000;

  async function action(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try {
      toast(await fn());
      server.reload();
      baseline.reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  const allGood = browserPass === browser.length && h && serverPass === h.cases.length && versionOk;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Diagnostics" subtitle="Chạy sau mỗi lần cập nhật code hoặc cấu hình. Đây là cách người không viết code biết luật nghiệp vụ còn đúng." actions={<Button variant="secondary" icon="refresh" onClick={() => { server.reload(); baseline.reload(); }}>Chạy lại</Button>} />
      {allGood ? (
        <Banner tone="ok" title={`Luật nghiệp vụ: ${browserPass}/${browser.length} PASS ở trình duyệt, ${serverPass}/${h!.cases.length} PASS trên máy chủ`}>Phiên bản domain {DOMAIN_VERSION} khớp giữa web app và Edge Function.</Banner>
      ) : (
        server.loading && <Loading label="Đang kiểm tra máy chủ…" />
      )}

      <Card title={`Luật nghiệp vụ trong trình duyệt · ${browserPass}/${browser.length} PASS`} subtitle={`src/domain phiên bản ${DOMAIN_VERSION}`}>
        <CaseTable rows={browser} />
      </Card>

      <Card title="Máy chủ (Edge Function ops-hub) và cấu hình">
        {server.error ? (
          <ErrorBox error={server.error} />
        ) : !h ? (
          <Loading />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <ul>
              <Check ok={serverPass === h.cases.length} label={`Luật nghiệp vụ trên máy chủ: ${serverPass}/${h.cases.length} PASS`} />
              <Check ok={versionOk} label="Edge Function chạy cùng phiên bản domain với web app">
                Web {DOMAIN_VERSION} · máy chủ {h.domainVersion}
                {!versionOk && '. Dán lại file dist/edge/ops-hub/index.ts mới nhất vào Supabase rồi bấm Deploy.'}
              </Check>
              <Check ok={h.appEnv === config.environment} label={`Môi trường: web "${config.environment}", máy chủ "${h.appEnv}"`}>
                {h.appEnv !== config.environment && 'Sửa environment trong config.js hoặc APP_ENV trong Edge Function Secrets cho khớp.'}
              </Check>
              <Check ok={h.cronSecretConfigured} label="Bí mật cho job định kỳ đã có trong Vault">
                {!h.cronSecretConfigured && 'Chạy file 02_cron.sql trong SQL Editor.'}
              </Check>
              <Check ok={!stale(lastDispatch)} label="Job gửi checkpoint (15 phút/lần)">
                {lastDispatch ? `Chạy lần cuối ${timeAgo(lastDispatch)} (${fmtVnDateTime(lastDispatch, tz)})` : 'Chưa chạy lần nào. Kiểm tra 02_cron.sql.'}
              </Check>
              <Check ok={!stale(lastClose)} label="Job chốt task tại deadline (15 phút/lần)">
                {lastClose ? `Chạy lần cuối ${timeAgo(lastClose)}` : 'Chưa chạy lần nào.'}
              </Check>
            </ul>
            <ul>
              <Check ok={h.telegram.configured && !!h.telegram.tokenValid} label="Token bot Telegram">
                {!h.telegram.configured ? 'Chưa đặt TELEGRAM_BOT_TOKEN trong Edge Function Secrets.' : h.telegram.tokenValid ? `Bot @${h.telegram.username}` : 'Token không hợp lệ.'}
              </Check>
              <Check ok={!!h.telegram.webhookOk} label="Webhook Telegram trỏ về ops-hub">
                {h.telegram.webhookOk ? `${h.telegram.pending ?? 0} tin đang chờ` : `Hiện tại: ${h.telegram.webhookUrl || '(trống)'}. Bấm "Kết nối webhook".`}
                {h.telegram.lastError && ` · Lỗi gần nhất: ${h.telegram.lastError}`}
              </Check>
              <li className="flex flex-wrap gap-2 pt-3">
                <Button size="sm" icon="link" busy={busy === 'hook'} disabled={!h.telegram.configured} onClick={() => action('hook', async () => { const r = await callApi<{ username: string }>('system.connect_telegram'); return `Đã kết nối webhook cho @${r.username}`; })}>
                  Kết nối webhook Telegram
                </Button>
                <Button size="sm" variant="secondary" icon="telegram" busy={busy === 'msg'} onClick={() => action('msg', async () => { await callApi('system.test_message'); return 'Đã gửi tin nhắn thử. Kiểm tra Telegram của bạn.'; })}>
                  Gửi tin thử cho tôi
                </Button>
                <Button size="sm" variant="secondary" icon="play" busy={busy === 'jobs'} onClick={() => action('jobs', async () => { const r = await callApi<{ dispatch: { sent: number; no_reply: number }; close: { closed: number } }>('system.run_jobs'); return `Đã chạy job: gửi ${r.dispatch.sent} checkpoint, ${r.dispatch.no_reply} cảnh báo im lặng, chốt ${r.close.closed} task.`; })}>
                  Chạy job ngay
                </Button>
              </li>
            </ul>
          </div>
        )}
        {h && serverPass !== h.cases.length && (
          <div className="mt-4">
            <CaseTable rows={h.cases} />
          </div>
        )}
      </Card>

      <Card
        title="Baseline: 19 báo giá tháng 7–9/2026"
        subtitle={`So kết quả app tính lại với số nhóm tính tay (8,66 giờ; 52,6% trễ). Chỉ dùng báo giá nhập từ CSV lịch sử. Báo giá trễ = quá ${lateHours} giờ làm việc.`}
        actions={
          base.rows.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              icon="download"
              onClick={() =>
                downloadText(
                  'kiem_tra_baseline.csv',
                  toCsv(
                    base.rows.map((r) => {
                      const q = baseline.data!.find((x) => x.id === r.id)!;
                      return { code: q.code, requested_at: fmtVnDateTime(q.requested_at, tz), sent_at: fmtVnDateTime(q.sent_at, tz), working_hours: r.hours.toFixed(2), late: r.late ? 1 : 0 };
                    }),
                  ),
                )
              }
            >
              Xuất CSV để đối chiếu
            </Button>
          )
        }
      >
        {baseline.loading ? (
          <Loading />
        ) : baseline.error ? (
          <ErrorBox error={baseline.error} />
        ) : !base.check.ran ? (
          <Banner tone="info" title="CHƯA CHẠY">
            {base.check.skipped ? base.check.message : 'Chưa có báo giá lịch sử. Vào Thư viện giá → Nhập báo giá lịch sử, chọn file 19 báo giá đã ẩn tên (Bước 0).'}
          </Banner>
        ) : (
          <>
            <Banner tone={base.check.pass ? 'ok' : 'warn'} title={base.check.pass ? 'PASS · khớp baseline' : 'LỆCH baseline · cần thống nhất cách tính trước pilot'}>
              App tính: {base.check.count} báo giá có ngày khách yêu cầu từ 01/07 đến 30/09/2026, trung bình {fmtNum(base.check.avgHours, 2)} giờ, {fmtNum(base.check.latePct, 1)}% trễ.
              {base.check.skipped > 0 && ` Bỏ qua ${base.check.skipped} báo giá lịch sử ngoài kỳ này.`} {base.check.pass ? '' : base.check.message}
            </Banner>
            {demoData && (
              <Banner tone="warn" className="mt-3" title="Đây là dữ liệu mẫu tổng hợp">
                Bộ 19 báo giá DEMO được dựng để khớp số tổng hợp, nên PASS ở đây không kiểm chứng baseline thật. Kiểm tra thật cần file 19 báo giá thật đã ẩn tên.
              </Banner>
            )}
            <div className="mt-3 max-h-80 overflow-y-auto">
              <table className="w-full text-left text-[14px]">
                <thead className="sticky top-0 bg-white text-[13px] text-ink-3">
                  <tr className="border-b border-line">
                    <th className="py-1.5 pr-3 font-semibold">Mã</th>
                    <th className="py-1.5 pr-3 font-semibold">Khách yêu cầu</th>
                    <th className="py-1.5 pr-3 font-semibold">Gửi</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Giờ làm việc</th>
                    <th className="py-1.5 font-semibold">Trễ</th>
                  </tr>
                </thead>
                <tbody>
                  {base.rows.map((r) => {
                    const q = baseline.data!.find((x) => x.id === r.id)!;
                    return (
                      <tr key={r.id} className="border-b border-line-soft">
                        <td className="py-1.5 pr-3">{q.code}</td>
                        <td className="py-1.5 pr-3">{fmtVnDateTime(q.requested_at, tz)}</td>
                        <td className="py-1.5 pr-3">{fmtVnDateTime(q.sent_at, tz)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtNum(r.hours, 2)}</td>
                        <td className="py-1.5">{r.late ? <Badge tone="bad">trễ</Badge> : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {config.environment === 'demo' && (
        <Card title="Dữ liệu mẫu (chỉ bản Demo)" subtitle="Tạo 6 người dùng ảo, thư viện giá mẫu, 19 báo giá baseline tổng hợp, báo giá và task của tuần trước và tuần này.">
          <div className="flex flex-wrap gap-2">
            <Button icon="refresh" busy={busy === 'seed'} onClick={() => action('seed', async () => { const r = await callApi<{ tasks: number; baselineQuotes: number }>('demo.seed'); return `Đã nạp dữ liệu mẫu: ${r.baselineQuotes} báo giá baseline, ${r.tasks} task.`; })}>
              Nạp lại dữ liệu mẫu
            </Button>
            <Button variant="danger" icon="trash" busy={busy === 'clear'} onClick={() => action('clear', async () => { await callApi('demo.clear'); return 'Đã xoá dữ liệu mẫu.'; })}>
              Xoá dữ liệu mẫu
            </Button>
          </div>
        </Card>
      )}
      <p className="text-[13px] text-ink-3">
        Supabase: {config.supabaseUrl.replace(/^https?:\/\//, '')} · môi trường web: {config.environment} · giờ máy chủ: {h ? fmtVnDateTime(h.serverTime, tz) : '–'}
      </p>
    </div>
  );
}
