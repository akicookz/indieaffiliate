import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import AuthGuard from "./components/AuthGuard";
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
import ProjectSettings from "./pages/ProjectSettings";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/api/auth/callback/:provider" element={<AuthCallback />} />
      <Route
        path="/onboarding"
        element={
          <AuthGuard>
            <Onboarding />
          </AuthGuard>
        }
      />
      <Route
        path="/app"
        element={
          <AuthGuard>
            <Layout />
          </AuthGuard>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="customers" element={<Customers />} />
        <Route path="partners" element={<Partners />} />
        <Route path="payouts" element={<Payouts />} />
        <Route path="projects/:slug/settings" element={<ProjectSettings />} />
      </Route>
    </Routes>
  );
}

export default App;
