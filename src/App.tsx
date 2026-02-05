import { Routes, Route } from "react-router-dom";

import Layout from "./components/Layout";
import AuthGuard from "./components/AuthGuard";
import ErrorBoundary from "./components/ErrorBoundary";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import AuthCallback from "./pages/AuthCallback";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Analytics from "./pages/Analytics";
import Customers from "./pages/Customers";
import Partners from "./pages/Partners";
import Payouts from "./pages/Payouts";
import FraudFlags from "./pages/FraudFlags";
import ProjectSettings from "./pages/ProjectSettings";
import PartnerPageDesigner from "./pages/PartnerPageDesigner";
import JoinPartnerProgram from "./pages/JoinPartnerProgram";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
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
        <Route path="analytics" element={<Analytics />} />
        <Route path="customers" element={<Customers />} />
        <Route path="partners" element={<Partners />} />
        <Route path="payouts" element={<Payouts />} />
        <Route path="fraud-flags" element={<FraudFlags />} />
        <Route path="projects/:slug/settings" element={<ProjectSettings />} />
        <Route path="projects/:slug/partner-page" element={<PartnerPageDesigner />} />
      </Route>
    </Routes>
  );
}

export default App;
