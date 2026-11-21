import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HOME, Layout, RequireRole } from '@/components/Layout';
import { Banner, Button, Loading } from '@/components/ui';
import { isConfigured } from '@/lib/config';
import { useSession } from '@/lib/session';
import { SettingsProvider } from '@/lib/settings';
import { DiagnosticsPage } from '@/pages/admin/DiagnosticsPage';
import { SettingsPage } from '@/pages/admin/SettingsPage';
import { UsersPage } from '@/pages/admin/UsersPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { GoStarPage } from '@/pages/lark/GoStarPage';
import { LarkSetupPage } from '@/pages/lark/LarkSetupPage';
import { LibraryPage } from '@/pages/library/LibraryPage';
import { PriceRulesPage } from '@/pages/library/PriceRulesPage';
import { LoginPage, NotConfiguredPage, RETURN_KEY, takeReturnPath } from '@/pages/LoginPage';
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
import { CalendarPage } from '@/pages/work/CalendarPage';
import { InboxPage } from '@/pages/work/InboxPage';
import { PeoplePage } from '@/pages/work/PeoplePage';
import { ProjectDetailPage } from '@/pages/work/ProjectDetailPage';
import { ProjectsPage } from '@/pages/work/ProjectsPage';
import { ReviewPage } from '@/pages/work/ReviewPage';
import { SummaryPage } from '@/pages/work/SummaryPage';
import type { Role } from '@/domain';

const QUOTES: Role[] = ['account', 'pm', 'ceo', 'admin'];
const TASKS: Role[] = ['admin'];
// 1.6 (PRD 3–4): PM manages, CEO looks on, everyone else is "nhân sự".
const STAFF: Role[] = ['account', 'ecom_exec', 'staff'];
const MGR: Role[] = ['pm', 'ceo'];
const EVERYONE: Role[] = ['account', 'ecom_exec', 'staff', 'pm', 'ceo', 'admin'];

function guard(roles: Role[], el: JSX.Element) {
  return <RequireRole roles={roles}>{el}</RequireRole>;
}

function HomeRedirect() {
  const { profile } = useSession();
  // Someone who opened a quote link, then signed in with the emailed link, lands on the app root:
  // send them on to the page the link pointed at.
  const [back] = useState(takeReturnPath);
  return <Navigate to={back ?? (profile ? HOME[profile.role] : '/')} replace />;
}

/** Once signed in on any page other than the root, a stored return path is no longer needed. */
function ForgetReturnPath() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname !== '/') localStorage.removeItem(RETURN_KEY);
  }, [pathname]);
  return null;
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
      <ForgetReturnPath />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="quotes" element={guard(QUOTES, <QuotesPage />)} />
          <Route path="quotes/:id" element={guard(QUOTES, <QuoteBuilderPage />)} />
          <Route path="approvals" element={guard(['pm', 'ceo'], <ApprovalsPage />)} />
          <Route path="archive" element={guard(QUOTES, <ArchivePage />)} />
          <Route path="library" element={guard(['pm', 'ceo', 'admin'], <LibraryPage />)} />
          <Route path="rules" element={guard(['ceo'], <PriceRulesPage />)} />
          <Route path="inbox" element={guard(STAFF, <InboxPage />)} />
          <Route path="du-an" element={guard(EVERYONE, <ProjectsPage />)} />
          <Route path="du-an/:code" element={guard(EVERYONE, <ProjectDetailPage />)} />
          <Route path="lich" element={guard([...STAFF, ...MGR], <CalendarPage />)} />
          <Route path="tom-tat" element={guard(MGR, <SummaryPage />)} />
          <Route path="cho-duyet" element={guard(MGR, <ReviewPage />)} />
          <Route path="nhan-su" element={guard(MGR, <PeoplePage />)} />
          <Route path="lark" element={<Navigate to="/du-an" replace />} />
          <Route path="gostar" element={guard(EVERYONE, <GoStarPage />)} />
          <Route path="lark/setup" element={guard(['admin'], <LarkSetupPage />)} />
          <Route path="tasks" element={guard(TASKS, <TasksPage />)} />
          <Route path="tasks/:id" element={guard(TASKS, <TaskDetailPage />)} />
          <Route path="checkins" element={guard(['staff', 'ecom_exec', 'pm', 'ceo', 'account', 'admin'], <MyCheckinsPage />)} />
          <Route path="alerts" element={guard(TASKS, <AlertsPage />)} />
          <Route path="task-types" element={guard(TASKS, <TaskTypesPage />)} />
          <Route path="dashboard" element={guard(['ceo', 'pm', 'admin'], <DashboardPage />)} />
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
