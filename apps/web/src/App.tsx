import { Navigate, Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query.js";
import { AuthProvider, useSession } from "./lib/auth.js";
import { Centered, LoadingScreen, Shell } from "./components/layout.js";
import { LoginPage } from "./pages/Login.js";
import { RegisterPage } from "./pages/Register.js";
import { AcceptInvitePage } from "./pages/AcceptInvite.js";
import { ResetPasswordPage } from "./pages/ResetPassword.js";
import { DashboardPage } from "./pages/Dashboard.js";
import { ProjectPage } from "./pages/Project.js";
import { ScopePage } from "./pages/Scope.js";
import { ChangePage } from "./pages/Change.js";
import { InboxPage } from "./pages/Inbox.js";
import { TimelinePage } from "./pages/Timeline.js";
import { ReviewPage } from "./pages/Review.js";
import { IntakePage } from "./pages/Intake.js";
import { ActivityPage } from "./pages/Activity.js";
import { HealthPage } from "./pages/Health.js";
import { OrgSettingsPage } from "./pages/OrgSettings.js";

function RequireAuth(): JSX.Element {
  const { session, loading } = useSession();
  if (loading) {
    return <LoadingScreen />;
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <Centered><RegisterPage /></Centered> },
  { path: "/accept-invite/:token", element: <Centered><AcceptInvitePage /></Centered> },
  { path: "/reset-password", element: <Centered><ResetPasswordPage /></Centered> },
  { path: "/review/:token", element: <ReviewPage /> },
  { path: "/intake/:token", element: <IntakePage /> },
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
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
