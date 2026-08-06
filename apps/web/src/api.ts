import type {
  BookInput,
  BookRow,
  BooksResponse,
  CalendarDayLog,
  CalendarEventsResponse,
  ExerciseInput,
  ExerciseRow,
  ExercisesResponse,
  PeriodsResponse,
  PeriodToggleInput,
  PeriodToggleResult,
  PortfolioResponse,
  SpendingDashboard,
  StatusResponse,
  UploadResponse,
  WeatherResponse,
} from "@life/shared";

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `API ${res.status}: ${res.statusText}`;
}

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<T>;
}

export const getStatus = () => apiFetch<StatusResponse>("/api/status");

export type TimedStatus = StatusResponse & { loadMs: number };

// getStatus, plus the round-trip time in ms (how long the API/DB read took —
// includes Neon cold-start latency). Shared by SyncStatus and the Todos header.
export async function getStatusTimed(): Promise<TimedStatus> {
  const t0 = performance.now();
  const data = await getStatus();
  return { ...data, loadMs: Math.round(performance.now() - t0) };
}

export type TodoRow = {
  id: number;
  externalId: string;
  title: string | null;
  startTs: string;
  // Set to now() when a todo is marked completed — used as the completion date.
  updatedAt: string;
  payload: {
    status?: string;
    list?: string | null;
    notes?: string | null;
    due?: { date?: string | null } | null;
    added_at?: string;
    parent_id?: string | null;
  } | null;
};

export const getTodos = () => apiFetch<{ todos: TodoRow[] }>("/api/todos");

export async function closeTodo(externalId: string): Promise<void> {
  const res = await fetch(`/api/todos/${externalId}/close`, {
    method: "POST",
    headers: { Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

async function apiDelete(path: string): Promise<Response> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res;
}

export const deleteTodo = (externalId: string) => apiDelete(`/api/todos/${externalId}`);

export async function clearCompletedTodos(): Promise<number> {
  const res = await apiDelete("/api/todos/completed");
  const body = (await res.json()) as { deleted: number };
  return body.deleted;
}

// Sync one connector on demand (Todos + Sync status buttons). Returns the
// connector's raw result; callers refetch ["status"] and the source's data.
export async function syncSource(source: string): Promise<void> {
  const res = await fetch(`/api/sync/${source}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export const getPortfolio = () => apiFetch<PortfolioResponse>("/api/finance/portfolio");

export async function uploadHoldings(csv: string): Promise<UploadResponse> {
  const res = await fetch("/api/finance/holdings/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "text/csv",
    },
    body: csv,
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<UploadResponse>;
}

export const getExercises = () => apiFetch<ExercisesResponse>("/api/exercises");

export const getBooks = () => apiFetch<BooksResponse>("/api/books");

export const getCalendarEvents = () => apiFetch<CalendarEventsResponse>("/api/calendar/events");

export const getWeather = () => apiFetch<WeatherResponse>("/api/weather");

export async function addBook(input: BookInput): Promise<BookRow> {
  const res = await fetch("/api/books", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<BookRow>;
}

export async function updateBook(id: number, input: BookInput): Promise<BookRow> {
  const res = await fetch(`/api/books/${id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<BookRow>;
}

export async function addExercise(input: ExerciseInput): Promise<ExerciseRow> {
  const res = await fetch("/api/exercises", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<ExerciseRow>;
}

export async function updateExercise(id: number, input: ExerciseInput): Promise<ExerciseRow> {
  const res = await fetch(`/api/exercises/${id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<ExerciseRow>;
}

export const getPeriods = () => apiFetch<PeriodsResponse>("/api/period");

export async function togglePeriodDay(input: PeriodToggleInput): Promise<PeriodToggleResult> {
  const res = await fetch("/api/period/toggle", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<PeriodToggleResult>;
}

export const getDayLog = (date: string) => apiFetch<CalendarDayLog>(`/api/calendar/day/${date}`);

export const getSpending = (month?: string) =>
  apiFetch<SpendingDashboard>(`/api/finance/spending${month ? `?month=${month}` : ""}`);

async function apiPost<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<T>;
}

export const createPlaidLinkToken = () =>
  apiPost<{ link_token: string }>("/api/plaid/link-token", {});

export const exchangePlaidToken = (publicToken: string) =>
  apiPost<{ access_token: string; item_id: string }>("/api/plaid/exchange", {
    public_token: publicToken,
  });

export async function saveDayLog(date: string, log: string): Promise<CalendarDayLog> {
  const res = await fetch(`/api/calendar/day/${date}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ log }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<CalendarDayLog>;
}
