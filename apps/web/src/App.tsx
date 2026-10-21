import { Suspense, lazy } from "react";
import { Navigate, Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query.js";
import { AuthProvider, useSession } from "./lib/auth.js";
import { SessionLocaleProvider } from "./lib/i18n/index.js";
import { Centered, LoadingScreen, Shell } from "./components/layout.js";

// Route-level splitting: pages load on demand so the initial bundle stays
// small (was one 830 kB chunk tripping the size warning).
const LoginPage = lazy(() => import("./pages/Login.js").then((m) => ({ default: m.LoginPage })));
const LandingPage = lazy(() => import("./pages/Landing.js").then((m) => ({ default: m.LandingPage })));
const RegisterPage = lazy(() => import("./pages/Register.js").then((m) => ({ default: m.RegisterPage })));
const AcceptInvitePage = lazy(() => import("./pages/AcceptInvite.js").then((m) => ({ default: m.AcceptInvitePage })));
const ResetPasswordPage = lazy(() => import("./pages/ResetPassword.js").then((m) => ({ default: m.ResetPasswordPage })));
const DashboardPage = lazy(() => import("./pages/Dashboard.js").then((m) => ({ default: m.DashboardPage })));
const ProjectPage = lazy(() => import("./pages/Project.js").then((m) => ({ default: m.ProjectPage })));
const ScopePage = lazy(() => import("./pages/Scope.js").then((m) => ({ default: m.ScopePage })));
const ChangePage = lazy(() => import("./pages/Change.js").then((m) => ({ default: m.ChangePage })));
const InboxPage = lazy(() => import("./pages/Inbox.js").then((m) => ({ default: m.InboxPage })));
const TimelinePage = lazy(() => import("./pages/Timeline.js").then((m) => ({ default: m.TimelinePage })));
const ReviewPage = lazy(() => import("./pages/Review.js").then((m) => ({ default: m.ReviewPage })));
const IntakePage = lazy(() => import("./pages/Intake.js").then((m) => ({ default: m.IntakePage })));
const VerifyPage = lazy(() => import("./pages/Verify.js").then((m) => ({ default: m.VerifyPage })));
const ActivityPage = lazy(() => import("./pages/Activity.js").then((m) => ({ default: m.ActivityPage })));
const HealthPage = lazy(() => import("./pages/Health.js").then((m) => ({ default: m.HealthPage })));
const OrgSettingsPage = lazy(() => import("./pages/OrgSettings.js").then((m) => ({ default: m.OrgSettingsPage })));

function RequireAuth(): JSX.Element {
  const { session, loading } = useSession();
  if (loading) {
    return <LoadingScreen />;
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: "/welcome", element: <LandingPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <Centered><RegisterPage /></Centered> },
  { path: "/accept-invite/:token", element: <Centered><AcceptInvitePage /></Centered> },
  { path: "/reset-password", element: <Centered><ResetPasswordPage /></Centered> },
  { path: "/review/:token", element: <ReviewPage /> },
  { path: "/intake/:token", element: <IntakePage /> },
  { path: "/verify/:approvalId", element: <VerifyPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Shell />,
        children: [
          { path: "/", element: <DashboardPage /> },
          { path: "/inbox", element: <InboxPage /> },
          { path: "/projects/:id", element: <ProjectPage /> },
          { path: "/projects/:id/scope", element: <ScopePage /> },
          { path: "/projects/:id/timeline", element: <TimelinePage /> },
          { path: "/projects/:id/changes/:changeId", element: <ChangePage /> },
          { path: "/projects/:id/activity", element: <ActivityPage /> },
          { path: "/projects/:id/health", element: <HealthPage /> },
          { path: "/orgs/:id/settings", element: <OrgSettingsPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <Centered><p>Page not found.</p></Centered> },
]);

export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SessionLocaleProvider>
          <Suspense fallback={<LoadingScreen />}>
            <RouterProvider router={router} />
          </Suspense>
        </SessionLocaleProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
