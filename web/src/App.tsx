import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getToken, setToken } from './api';
import SignIn from './pages/SignIn';
import HomePage from './pages/marketing/HomePage';
import RoleLanding from './pages/marketing/RoleLanding';
import PricingPage from './pages/marketing/PricingPage';
import FaqPage from './pages/marketing/FaqPage';

import AppShell from './pages/app/AppShell';
import Dashboard from './pages/app/Dashboard';
import SearchLoads from './pages/app/SearchLoads';
import SearchTrucks from './pages/app/SearchTrucks';
import MyLoads from './pages/app/MyLoads';
import Network from './pages/app/Network';
import Tools from './pages/app/Tools';
import Ifta from './pages/app/Ifta';
import Fleet from './pages/app/Fleet';
import Drivers from './pages/app/Drivers';

function RequireAuth({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const signedOut = getToken() === null;

  useEffect(() => {
    if (signedOut) navigate('/signin', { state: { from: location.pathname } });
  }, [signedOut, navigate, location.pathname]);

  if (signedOut) return null;
  return <>{children}</>;
}

function ScrollToHash() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash) {
      let raf = 0;
      const attempt = () => {
        const el = document.querySelector(location.hash);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (raf < 20) {
          raf += 1;
          setTimeout(attempt, 60);
        }
      };
      const timer = setTimeout(attempt, 60);
      return () => {
        clearTimeout(timer);
      };
    }
    window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToHash />
      <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/carrier" element={<RoleLanding role="carrier" />} />
      <Route path="/broker" element={<RoleLanding role="broker" />} />
      <Route path="/shipper" element={<RoleLanding role="shipper" />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/faq" element={<FaqPage />} />
      <Route path="/signin" element={<SignIn />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell onSignOut={() => setToken(null)} />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="board" element={<SearchLoads />} />
        <Route path="trucks" element={<SearchTrucks />} />
        <Route path="myloads" element={<MyLoads />} />
        <Route path="network" element={<Network />} />
        <Route path="tools" element={<Tools />} />
        <Route path="ifta" element={<Ifta />} />
        <Route path="fleet" element={<Fleet />} />
        <Route path="drivers" element={<Drivers />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}