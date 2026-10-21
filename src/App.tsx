import { Navigate, Route, Routes } from 'react-router-dom';
import { HOME, Layout, RequireRole } from '@/components/Layout';
import { Banner, Button, Loading } from '@/components/ui';
import { isConfigured } from '@/lib/config';
import { useSession } from '@/lib/session';
import { SettingsProvider } from '@/lib/settings';
import { DiagnosticsPage } from '@/pages/admin/DiagnosticsPage';
import { SettingsPage } from '@/pages/admin/SettingsPage';
import { UsersPage } from '@/pages/admin/UsersPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { LibraryPage } from '@/pages/library/LibraryPage';
import { PriceRulesPage } from '@/pages/library/PriceRulesPage';
import { LoginPage, NotConfiguredPage } from '@/pages/LoginPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { ApprovalsPage } from '@/pages/quotes/ApprovalsPage';
import { ArchivePage } from '@/pages/quotes/ArchivePage';
import { QuoteBuilderPage } from '@/pages/quotes/QuoteBuilderPage';
import { QuotesPage } from '@/pages/quotes/QuotesPage';
import { AlertsPage } from '@/pages/tasks/AlertsPage';
import { MyCheckinsPage } from '@/pages/tasks/MyCheckinsPage';
import { TaskDetailPage } from '@/pages/tasks/TaskDetailPage';
import { TasksPage } from '@/pages/tasks/TasksPage';
import { TaskTypesPage } from '@/pages/tasks/TaskTypesPage';
import type { Role } from '@/domain';

const QUOTES: Role[] = ['account', 'pm', 'ceo', 'admin'];
const TASKS: Role[] = ['ecom_exec', 'staff', 'admin', 'pm', 'ceo'];

function guard(roles: Role[], el: JSX.Element) {
  return <RequireRole roles={roles}>{el}</RequireRole>;
}

function HomeRedirect() {
  const { profile } = useSession();
  return <Navigate to={profile ? HOME[profile.role] : '/'} replace />;
}

export function App() {
  const { loading, session, profile, profileError, signOut } = useSession();
  if (!isConfigured()) return <NotConfiguredPage />;
  if (loading) return <Loading label="Đang mở Ops Hub…" />;
  if (!session) return <LoginPage />;
  if (!profile || !profile.active) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Banner tone="warn" title={profile && !profile.active ? 'Tài khoản đã bị khoá' : 'Chưa vào được app'} actions={<Button variant="secondary" onClick={signOut}>Đăng xuất</Button>}>
          {profile && !profile.active ? 'Nhờ Admin mở khoá tài khoản.' : profileError ?? 'Đang tải hồ sơ…'}
        </Banner>
      </div>
    );
  }
  return (
    <SettingsProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="quotes" element={guard(QUOTES, <QuotesPage />)} />
          <Route path="quotes/:id" element={guard(QUOTES, <QuoteBuilderPage />)} />
          <Route path="approvals" element={guard(['pm', 'ceo'], <ApprovalsPage />)} />
          <Route path="archive" element={guard(QUOTES, <ArchivePage />)} />
          <Route path="library" element={guard(['pm', 'ceo', 'admin'], <LibraryPage />)} />
          <Route path="rules" element={guard(['ceo'], <PriceRulesPage />)} />
          <Route path="tasks" element={guard(['ecom_exec', 'staff', 'admin'], <TasksPage />)} />
          <Route path="tasks/:id" element={guard(TASKS, <TaskDetailPage />)} />
          <Route path="checkins" element={guard(['staff', 'ecom_exec', 'pm', 'ceo', 'account', 'admin'], <MyCheckinsPage />)} />
          <Route path="alerts" element={guard(['ecom_exec', 'admin'], <AlertsPage />)} />
          <Route path="task-types" element={guard(['ecom_exec', 'admin'], <TaskTypesPage />)} />
          <Route path="dashboard" element={guard(['ceo', 'pm', 'ecom_exec', 'admin'], <DashboardPage />)} />
          <Route path="admin/users" element={guard(['admin'], <UsersPage />)} />
          <Route path="admin/settings" element={guard(['admin'], <SettingsPage />)} />
          <Route path="admin/diagnostics" element={guard(['admin'], <DiagnosticsPage />)} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Routes>
    </SettingsProvider>
  );
}
