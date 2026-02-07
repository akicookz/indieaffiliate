import { Routes, Route } from "react-router-dom";

import Layout from "./components/Layout";
import AuthGuard from "./components/AuthGuard";
import PartnerAuthGuard from "./components/PartnerAuthGuard";
import PartnerLayout from "./components/PartnerLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import PartnerLogin from "./pages/PartnerLogin";
import AuthCallback from "./pages/AuthCallback";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Customers from "./pages/Customers";
import Partners from "./pages/Partners";
import Payouts from "./pages/Payouts";
import FraudFlags from "./pages/FraudFlags";
import ProjectSettings from "./pages/ProjectSettings";
import Import from "./pages/Import";
import PartnerPageDesigner from "./pages/PartnerPageDesigner";
import JoinPartnerProgram from "./pages/JoinPartnerProgram";
import PortalDashboard from "./pages/PortalDashboard";
import PortalReferrals from "./pages/PortalReferrals";
import PortalCommissions from "./pages/PortalCommissions";
import PortalPayouts from "./pages/PortalPayouts";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/partner-login" element={<PartnerLogin />} />
      <Route path="/join/:slug" element={<JoinPartnerProgram />} />
      <Route path="/api/auth/callback/:provider" element={<AuthCallback />} />
      <Route
        path="/onboarding"
        element={
          <ErrorBoundary>
            <AuthGuard>
              <Onboarding />
            </AuthGuard>
          </ErrorBoundary>
        }
      />
      <Route
        path="/app"
        element={
          <ErrorBoundary>
            <AuthGuard>
              <Layout />
            </AuthGuard>
          </ErrorBoundary>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="customers" element={<Customers />} />
        <Route path="partners" element={<Partners />} />
        <Route path="payouts" element={<Payouts />} />
        <Route path="fraud-flags" element={<FraudFlags />} />
        <Route path="import" element={<Import />} />
        <Route path="projects/:slug/settings" element={<ProjectSettings />} />
        <Route path="projects/:slug/partner-page" element={<PartnerPageDesigner />} />
      </Route>
      {/* Partner Portal */}
      <Route
        path="/portal"
        element={
          <ErrorBoundary>
            <PartnerAuthGuard>
              <PartnerLayout />
            </PartnerAuthGuard>
          </ErrorBoundary>
        }
      >
        <Route index element={<PortalDashboard />} />
        <Route path="referrals" element={<PortalReferrals />} />
        <Route path="commissions" element={<PortalCommissions />} />
        <Route path="payouts" element={<PortalPayouts />} />
      </Route>
    </Routes>
  );
}

export default App;
