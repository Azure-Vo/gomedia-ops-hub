import { ReactNode, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ROLE_LABEL, Role } from '@/domain';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { cx, EmptyState, Icon } from './ui';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
  group: string;
  /** Count shown next to the label. */
  badge?: 'inbox' | 'review';
}

const ALL: Role[] = ['account', 'pm', 'ceo', 'ecom_exec', 'staff', 'admin'];
/** PRD 3: only the PM manages projects; the CEO looks on; everyone else is "nhân sự". */
const STAFF: Role[] = ['account', 'ecom_exec', 'staff'];
const MGR: Role[] = ['pm', 'ceo'];

export const NAV: NavItem[] = [
  // Trang nhân sự (PRD 4.1)
  { group: 'Công việc', to: '/inbox', label: 'Inbox', icon: 'inbox', roles: STAFF, badge: 'inbox' },
  { group: 'Công việc', to: '/du-an', label: 'Dự án của tôi', icon: 'folder', roles: STAFF },
  { group: 'Công việc', to: '/lich', label: 'Calendar', icon: 'calendar', roles: STAFF },
  { group: 'Công việc', to: '/gostar', label: 'Go Star', icon: 'star', roles: STAFF },
  // Trang quản lý (PRD 4.2)
  { group: 'Quản lý dự án', to: '/tom-tat', label: 'Tóm tắt hôm nay', icon: 'sun', roles: MGR },
  { group: 'Quản lý dự án', to: '/cho-duyet', label: 'Chờ duyệt', icon: 'check', roles: MGR, badge: 'review' },
  { group: 'Quản lý dự án', to: '/du-an', label: 'Dự án', icon: 'folder', roles: MGR },
  { group: 'Quản lý dự án', to: '/lich', label: 'Calendar', icon: 'calendar', roles: MGR },
  { group: 'Quản lý dự án', to: '/nhan-su', label: 'Nhân sự', icon: 'users', roles: MGR },
  { group: 'Quản lý dự án', to: '/dashboard', label: 'Báo cáo', icon: 'chart', roles: MGR },
  { group: 'Quản lý dự án', to: '/gostar', label: 'Go Star', icon: 'star', roles: MGR },
  // Báo giá (S2), unchanged
  { group: 'Báo giá', to: '/quotes', label: 'Báo giá', icon: 'file', roles: ['account', 'pm', 'ceo', 'admin'] },
  { group: 'Báo giá', to: '/approvals', label: 'Duyệt báo giá', icon: 'check', roles: ['pm', 'ceo'] },
  { group: 'Báo giá', to: '/archive', label: 'Kho tham chiếu', icon: 'archive', roles: ['account', 'pm', 'ceo', 'admin'] },
  { group: 'Báo giá', to: '/library', label: 'Thư viện giá', icon: 'tag', roles: ['pm', 'ceo', 'admin'] },
  { group: 'Báo giá', to: '/rules', label: 'Luật khung giá', icon: 'shield', roles: ['ceo'] },
  // Quản trị
  { group: 'Quản trị', to: '/admin/users', label: 'Người dùng', icon: 'user', roles: ['admin'] },
  { group: 'Quản trị', to: '/admin/settings', label: 'Cài đặt', icon: 'settings', roles: ['admin'] },
  { group: 'Quản trị', to: '/lark/setup', label: 'Kết nối Lark & nhắc việc', icon: 'link', roles: ['admin'] },
  { group: 'Quản trị', to: '/dashboard', label: 'Dashboard KPI', icon: 'chart', roles: ['admin'] },
  { group: 'Quản trị', to: '/admin/diagnostics', label: 'Diagnostics', icon: 'shield', roles: ['admin'] },
  { group: 'Task checkpoint (bản cũ)', to: '/tasks', label: 'Task', icon: 'tasks', roles: ['admin'] },
  { group: 'Task checkpoint (bản cũ)', to: '/alerts', label: 'Cảnh báo', icon: 'bell', roles: ['admin'] },
  { group: 'Task checkpoint (bản cũ)', to: '/task-types', label: 'Loại task & mốc', icon: 'list', roles: ['admin'] },
  { group: 'Cá nhân', to: '/profile', label: 'Hồ sơ & Telegram', icon: 'telegram', roles: ALL },
];

export const HOME: Record<Role, string> = {
  account: '/inbox',
  pm: '/tom-tat',
  ceo: '/dashboard',
  ecom_exec: '/inbox',
  staff: '/inbox',
  admin: '/admin/users',
};

/** Sidebar counts: my overdue / due today / to fix (staff) and tasks waiting for my review (PM). */
function useNavCounts(role: Role, userId: string, pathname: string) {
  const [counts, setCounts] = useState<{ inbox: number; review: number }>({ inbox: 0, review: 0 });
  useEffect(() => {
    let alive = true;
    (async () => {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
      if (STAFF.includes(role)) {
        const { data } = await supabase.from('lark_tasks').select('state, due_date').eq('kind', 'child').is('deleted_at', null).in('state', ['doing', 'changes']).or(`assignee_id.eq.${userId},assignee_open_id.eq.sim:${userId}`);
        const n = (data ?? []).filter((t: { state: string; due_date: string }) => t.state === 'changes' || t.due_date <= today).length;
        if (alive) setCounts((c) => ({ ...c, inbox: n }));
      } else if (role === 'pm') {
        const { data: mine } = await supabase.from('lark_tasks').select('id').eq('kind', 'parent').is('deleted_at', null).eq('pm_id', userId);
        const ids = (mine ?? []).map((p: { id: string }) => p.id);
        if (!ids.length) return alive && setCounts((c) => ({ ...c, review: 0 }));
        const { count } = await supabase.from('lark_tasks').select('id', { count: 'exact', head: true }).eq('kind', 'child').eq('state', 'review').in('parent_id', ids);
        if (alive) setCounts((c) => ({ ...c, review: count ?? 0 }));
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [role, userId, pathname]);
  return counts;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useSession();
  if (!profile || !roles.includes(profile.role)) {
    return (
      <div className="p-6">
        <EmptyState title="Bạn không có quyền xem trang này">
          Trang này dành cho: {roles.map((r) => ROLE_LABEL[r]).join(', ')}. Nếu cần quyền, nhờ Admin đổi vai trò.
        </EmptyState>
      </div>
    );
  }
  return <>{children}</>;
}

export function Layout() {
  const { profile, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  if (!profile) return null;
  return <Shell profile={profile} signOut={signOut} open={open} setOpen={setOpen} pathname={loc.pathname} />;
}

function Shell({ profile, signOut, open, setOpen, pathname }: { profile: NonNullable<ReturnType<typeof useSession>['profile']>; signOut: () => void; open: boolean; setOpen: (v: boolean | ((v: boolean) => boolean)) => void; pathname: string }) {
  const loc = { pathname };
  const counts = useNavCounts(profile.role, profile.id, loc.pathname);
  const items = NAV.filter((n) => n.roles.includes(profile.role));
  const groups = [...new Set(items.map((i) => i.group))];
  const nav = (
    <nav aria-label="Điều hướng chính" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g}>
          <div className="px-3 pb-1.5 text-[12px] font-medium text-rail-group">{g}</div>
          <ul className="flex flex-col gap-px">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <li key={`${i.group}${i.to}`}>
                  <NavLink
                    to={i.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      cx(
                        'relative flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-[14.5px] transition-colors duration-150',
                        isActive ? 'bg-rail-active font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]' : 'text-rail-text hover:bg-rail-hover hover:text-white',
                      )
                    }
                  >
                    <Icon name={i.icon} size={17} className="shrink-0 opacity-90" />
                    <span className="flex-1">{i.label}</span>
                    {i.badge && counts[i.badge] > 0 && <span className="rounded-full bg-accent px-1.5 text-[12px] font-semibold leading-5 text-white">{counts[i.badge]}</span>}
                  </NavLink>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <div className="min-h-screen bg-canvas">
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-rail px-3 py-4 [scrollbar-color:#2A3F7E_transparent] lg:flex">
          <Brand />
          <div className="mt-7 flex-1 overflow-y-auto">{nav}</div>
          <UserBox name={profile.full_name || profile.email} role={ROLE_LABEL[profile.role]} onSignOut={signOut} />
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-rail px-4 py-2 lg:hidden">
            <Brand />
            <button type="button" aria-label="Mở menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex h-11 w-11 items-center justify-center rounded-lg text-white hover:bg-rail-hover">
              <Icon name={open ? 'x' : 'menu'} />
            </button>
          </header>
          {open && (
            <div className="bg-rail px-3 pb-4 pt-2 lg:hidden">
              {nav}
              <UserBox name={profile.full_name || profile.email} role={ROLE_LABEL[profile.role]} onSignOut={signOut} />
            </div>
          )}
          <main key={loc.pathname} className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 sm:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-1">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white">
        <img src={`${import.meta.env.BASE_URL}brand/gomedia-mark.png`} alt="" width={30} height={30} className="h-[30px] w-[30px]" />
      </span>
      <div className="leading-tight">
        <div className="text-[15.5px] font-semibold text-white">Ops Hub</div>
        <div className="text-[12.5px] text-rail-text">Go Media</div>
      </div>
    </div>
  );
}

function UserBox({ name, role, onSignOut }: { name: string; role: string; onSignOut: () => void }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/10 px-1 pt-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-[13px] font-semibold text-white">
          {initials(name)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">{name}</div>
          <div className="text-[12px] text-rail-group">{role}</div>
        </div>
      </div>
      <button type="button" onClick={onSignOut} aria-label="Đăng xuất" title="Đăng xuất" className="flex h-10 w-10 items-center justify-center rounded-lg text-rail-text transition-colors duration-150 hover:bg-rail-hover hover:text-white">
        <Icon name="logout" />
      </button>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.replace(/@.*/, '').trim().split(/\s+/).filter(Boolean);
  const pick = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2);
  return pick.toUpperCase();
}
