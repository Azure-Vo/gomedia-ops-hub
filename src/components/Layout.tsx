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
  { group: 'S1 · Task Lark & ghi nhận', to: '/lark', label: 'Nhắc task Lark', icon: 'bell', roles: ['ecom_exec', 'staff', 'pm', 'ceo', 'admin'] },
  { group: 'S1 · Task Lark & ghi nhận', to: '/gostar', label: 'Go Star · Ghi nhận', icon: 'star', roles: ['ecom_exec', 'staff', 'pm', 'ceo', 'admin'] },
  { group: 'S1 · Task Lark & ghi nhận', to: '/lark/setup', label: 'Kết nối Lark', icon: 'link', roles: ['admin'] },
  { group: 'Task checkpoint (bản cũ)', to: '/checkins', label: 'Check-in của tôi', icon: 'clock', roles: ['staff', 'ecom_exec'] },
  { group: 'Task checkpoint (bản cũ)', to: '/tasks', label: 'Task', icon: 'tasks', roles: ['ecom_exec', 'staff', 'admin'] },
  { group: 'Task checkpoint (bản cũ)', to: '/alerts', label: 'Cảnh báo', icon: 'bell', roles: ['ecom_exec', 'admin'] },
  { group: 'Task checkpoint (bản cũ)', to: '/task-types', label: 'Loại task & mốc', icon: 'list', roles: ['ecom_exec', 'admin'] },
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
    <nav aria-label="Điều hướng chính" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g}>
          <div className="px-3 pb-1.5 text-[12px] font-medium text-rail-group">{g}</div>
          <ul className="flex flex-col gap-px">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <li key={i.to}>
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
