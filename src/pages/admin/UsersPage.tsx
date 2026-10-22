import { FormEvent, useState } from 'react';
import { ROLE_LABEL, Role } from '@/domain';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnDate } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  active: boolean;
  telegram_linked: boolean;
  created_at: string;
}

const ROLES = Object.keys(ROLE_LABEL) as Role[];

export function UsersPage() {
  const me = useProfile();
  const { tz } = useSettings();
  const toast = useToast();
  const [form, setForm] = useState({ email: '', full_name: '', role: 'staff' as Role });
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useAsync(async () => check(await supabase.rpc('admin_users')) as UserRow[], []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await callApi('admin.invite', form);
      toast(`Đã tạo tài khoản cho ${form.email}. Người đó đăng nhập bằng email ở trang đăng nhập.`);
      setForm({ email: '', full_name: '', role: form.role });
      reload();
    } catch (err) {
      toast((err as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function update(u: UserRow, patch: Partial<Pick<UserRow, 'role' | 'active' | 'full_name'>>) {
    try {
      check(await supabase.from('profiles').update(patch).eq('id', u.id).select('id'));
      toast('Đã cập nhật');
      reload();
    } catch (err) {
      toast((err as Error).message, 'bad');
      reload();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Người dùng" subtitle="Chỉ người được mời mới đăng nhập được. Mỗi người một vai trò; vai trò quyết định màn hình và dữ liệu họ thấy." />
      <Card title="Mời người dùng">
        <form onSubmit={invite} className="grid gap-3 md:grid-cols-[2fr_2fr_1.3fr_auto] md:items-end">
          <Field label="Email công việc">{(id) => <Input id={id} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
          <Field label="Họ tên">{(id) => <Input id={id} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />}</Field>
          <Field label="Vai trò">
            {(id) => (
              <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" icon="plus" busy={busy}>
            Mời
          </Button>
        </form>
      </Card>
      <Card title={`${data?.length ?? 0} tài khoản`}>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[14.5px]">
              <thead className="text-[13px] text-ink-3">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Người dùng</th>
                  <th className="py-2 pr-3 font-semibold">Vai trò</th>
                  <th className="py-2 pr-3 font-semibold">Telegram</th>
                  <th className="py-2 pr-3 font-semibold">Tạo ngày</th>
                  <th className="py-2 font-semibold">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {data!.map((u) => (
                  <tr key={u.id} className={`border-b border-line-soft ${u.active ? '' : 'opacity-60'}`}>
                    <td className="py-2 pr-3">
                      <div className="font-semibold">{u.full_name || '(chưa có tên)'}</div>
                      <div className="text-[13px] text-ink-3">{u.email}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <Select aria-label={`Vai trò của ${u.email}`} value={u.role} onChange={(e) => update(u, { role: e.target.value as Role })} className="w-52">
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 pr-3">{u.telegram_linked ? <Badge tone="ok">Đã liên kết</Badge> : <Badge>Chưa</Badge>}</td>
                    <td className="py-2 pr-3 text-ink-3">{fmtVnDate(u.created_at, tz)}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        {u.active ? <Badge tone="ok">Đang dùng</Badge> : <Badge>Đã khoá</Badge>}
                        <Button size="sm" variant={u.active ? 'ghost' : 'secondary'} disabled={u.id === me.id} onClick={() => update(u, { active: !u.active })}>
                          {u.active ? 'Khoá' : 'Mở khoá'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
