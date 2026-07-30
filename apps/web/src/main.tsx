import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { NAV_ITEMS } from "./nav";
import { CalendarPage } from "./pages/Calendar";
import { Exercise } from "./pages/Exercise";
import { Finance } from "./pages/Finance";
import { Placeholder } from "./pages/Placeholder";
import { Todos } from "./pages/Todos";
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
              <Route index element={<Navigate to="/todos" replace />} />
              <Route path="todos" element={<Todos />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="finance" element={<Finance />} />
              <Route path="exercise" element={<Exercise />} />
              {NAV_ITEMS.filter((item) => !item.implemented).map((item) => (
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
