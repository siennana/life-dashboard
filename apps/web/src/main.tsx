import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import { IndexRoute } from "./components/MobileNav";
import { ErrorBoundary } from "./ErrorBoundary";
import { ALL_NAV_ITEMS } from "./nav";
import { Bank } from "./pages/Bank";
import { CalendarPage } from "./pages/Calendar";
import { Exercise } from "./pages/Exercise";
import { Home } from "./pages/Home";
import { Finance } from "./pages/Finance";
import { Placeholder } from "./pages/Placeholder";
import { PlaidLink } from "./pages/PlaidLink";
import { Reading } from "./pages/Reading";
import { Settings } from "./pages/Settings";
import { Stocks } from "./pages/Stocks";
import { Todos } from "./pages/Todos";
// Selectable fonts (Settings > Style), bundled locally — no CDN.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";

// Fail fast instead of retrying 3x before surfacing an auth/config error.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />}>
              {/* Mobile: full-screen nav menu. Desktop: redirect to /home. */}
              <Route index element={<IndexRoute />} />
              <Route path="home" element={<Home />} />
              <Route path="todos" element={<Todos />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="finance" element={<Finance />} />
              <Route path="finance/stocks" element={<Stocks />} />
              <Route path="finance/bank" element={<Bank />} />
              <Route path="exercise" element={<Exercise />} />
              <Route path="reading" element={<Reading />} />
              <Route path="settings" element={<Settings />} />
              {/* Hidden utility page for one-time Plaid bank linking. */}
              <Route path="plaid-link" element={<PlaidLink />} />
              {ALL_NAV_ITEMS.filter((item) => !item.implemented).map((item) => (
                <Route
                  key={item.path}
                  path={item.path.slice(1)}
                  element={<Placeholder title={item.label} />}
                />
              ))}
              <Route path="*" element={<Navigate to="/todos" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
