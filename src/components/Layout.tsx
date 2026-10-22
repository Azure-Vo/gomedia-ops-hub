import { ReactNode, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ROLE_LABEL, Role } from '@/domain';
import { useSession } from '@/lib/session';
import { cx, EmptyState, Icon } from './ui';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
  group: string;
}

const ALL: Role[] = ['account', 'pm', 'ceo', 'ecom_exec', 'staff', 'admin'];

export const NAV: NavItem[] = [
  { group: 'Task (S1)', to: '/checkins', label: 'Check-in của tôi', icon: 'clock', roles: ['staff', 'ecom_exec'] },
  { group: 'Task (S1)', to: '/tasks', label: 'Task', icon: 'tasks', roles: ['ecom_exec', 'staff', 'admin'] },
  { group: 'Task (S1)', to: '/alerts', label: 'Cảnh báo', icon: 'bell', roles: ['ecom_exec', 'admin'] },
  { group: 'Task (S1)', to: '/task-types', label: 'Loại task & mốc', icon: 'list', roles: ['ecom_exec', 'admin'] },
  { group: 'Báo giá (S2)', to: '/quotes', label: 'Báo giá', icon: 'file', roles: ['account', 'pm', 'ceo', 'admin'] },
  { group: 'Báo giá (S2)', to: '/approvals', label: 'Duyệt báo giá', icon: 'check', roles: ['pm', 'ceo'] },
  { group: 'Báo giá (S2)', to: '/archive', label: 'Kho tham chiếu', icon: 'archive', roles: ['account', 'pm', 'ceo', 'admin'] },
  { group: 'Báo giá (S2)', to: '/library', label: 'Thư viện giá', icon: 'tag', roles: ['pm', 'ceo', 'admin'] },
  { group: 'Báo giá (S2)', to: '/rules', label: 'Luật khung giá', icon: 'shield', roles: ['ceo'] },
  { group: 'Đo lường', to: '/dashboard', label: 'Dashboard KPI', icon: 'chart', roles: ['ceo', 'pm', 'ecom_exec', 'admin'] },
  { group: 'Quản trị', to: '/admin/users', label: 'Người dùng', icon: 'user', roles: ['admin'] },
  { group: 'Quản trị', to: '/admin/settings', label: 'Cài đặt', icon: 'settings', roles: ['admin'] },
  { group: 'Quản trị', to: '/admin/diagnostics', label: 'Diagnostics', icon: 'shield', roles: ['admin'] },
  { group: 'Cá nhân', to: '/profile', label: 'Hồ sơ & Telegram', icon: 'telegram', roles: ALL },
];

export const HOME: Record<Role, string> = {
  account: '/quotes',
  pm: '/approvals',
  ceo: '/dashboard',
  ecom_exec: '/tasks',
  staff: '/checkins',
  admin: '/admin/diagnostics',
};

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
  const items = NAV.filter((n) => n.roles.includes(profile.role));
  const groups = [...new Set(items.map((i) => i.group))];
  const nav = (
    <nav aria-label="Điều hướng chính" className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g}>
          <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-ink-3">{g}</div>
          <ul className="flex flex-col gap-0.5">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      cx('flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium', isActive ? 'bg-brand-soft font-bold text-brand' : 'text-ink-2 hover:bg-canvas')
                    }
                  >
                    <Icon name={i.icon} />
                    {i.label}
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
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-white p-4 lg:flex">
          <Brand />
          <div className="mt-6 flex-1 overflow-y-auto">{nav}</div>
          <UserBox name={profile.full_name || profile.email} role={ROLE_LABEL[profile.role]} onSignOut={signOut} />
        </aside>
        <div className="min-w-0 flex-1">
          <header className="flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-2 lg:hidden">
            <Brand />
            <button type="button" aria-label="Mở menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-canvas">
              <Icon name={open ? 'x' : 'menu'} />
            </button>
          </header>
          {open && (
            <div className="border-b border-line bg-white p-4 lg:hidden">
              {nav}
              <UserBox name={profile.full_name || profile.email} role={ROLE_LABEL[profile.role]} onSignOut={signOut} />
            </div>
          )}
          <main key={loc.pathname} className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <img src={`${import.meta.env.BASE_URL}brand/gomedia-mark.png`} alt="" width={44} height={44} className="h-11 w-11 shrink-0" />
      <div className="leading-tight">
        <div className="font-extrabold text-ink">Ops Hub</div>
        <div className="text-[12px] font-semibold uppercase tracking-wide text-accent">Go Media</div>
      </div>
    </div>
  );
}

function UserBox({ name, role, onSignOut }: { name: string; role: string; onSignOut: () => void }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2 border-t border-line-soft pt-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-ink">{name}</div>
        <div className="text-[12px] text-ink-3">{role}</div>
      </div>
      <button type="button" onClick={onSignOut} aria-label="Đăng xuất" title="Đăng xuất" className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-3 hover:bg-canvas hover:text-ink">
        <Icon name="logout" />
      </button>
    </div>
  );
}
