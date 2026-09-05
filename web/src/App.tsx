import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getToken, setToken } from './api';
import HomePage from './pages/marketing/HomePage';
import ThemeFab from './components/ThemeFab';
import DiagnosticsHarness from './components/DiagnosticsHarness';

// Everything except the homepage is code-split so the marketing site loads fast;
// the TMS app chunks only download once you sign in and open that section.
const RoleLanding = lazy(() => import('./pages/marketing/RoleLanding'));
const PricingPage = lazy(() => import('./pages/marketing/PricingPage'));
const FaqPage = lazy(() => import('./pages/marketing/FaqPage'));
const PrivacyPage = lazy(() => import('./pages/marketing/LegalPage').then(m => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/marketing/LegalPage').then(m => ({ default: m.TermsPage })));
const ContactPage = lazy(() => import('./pages/marketing/ContactPage'));
const SignIn = lazy(() => import('./pages/SignIn'));
const Diagnostics = lazy(() => import('./pages/Diagnostics'));
const AppShell = lazy(() => import('./pages/app/AppShell'));
const Dashboard = lazy(() => import('./pages/app/Dashboard'));
const SearchLoads = lazy(() => import('./pages/app/SearchLoads'));
const SearchTrucks = lazy(() => import('./pages/app/SearchTrucks'));
const MyLoads = lazy(() => import('./pages/app/MyLoads'));
const Network = lazy(() => import('./pages/app/Network'));
const Tools = lazy(() => import('./pages/app/Tools'));
const Ifta = lazy(() => import('./pages/app/Ifta'));
const Fleet = lazy(() => import('./pages/app/Fleet'));
const Drivers = lazy(() => import('./pages/app/Drivers'));

function RouteFallback() {
  return <div className="route-fallback" aria-label="Loading" />;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('App error boundary caught:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-crash">
          <h1>Something went wrong</h1>
          <p className="muted">The app hit an unexpected error while rendering.</p>
          <pre className="app-crash-msg">{String(this.state.error)}</pre>
          <button
            className="btn-primary"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
      <Suspense fallback={<RouteFallback />}>
      <ErrorBoundary>
      <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/carrier" element={<RoleLanding role="carrier" />} />
      <Route path="/broker" element={<RoleLanding role="broker" />} />
      <Route path="/shipper" element={<RoleLanding role="shipper" />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/faq" element={<FaqPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/diagnostics" element={<Diagnostics />} />
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
      </ErrorBoundary>
      <ThemeFab />
      <DiagnosticsHarness />
      </Suspense>
    </>
  );
}