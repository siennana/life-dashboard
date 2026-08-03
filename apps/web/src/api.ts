import type {
  BookInput,
  BookRow,
  BooksResponse,
  CalendarEventsResponse,
  ExerciseInput,
  ExerciseRow,
  ExercisesResponse,
  PeriodEntry,
  PeriodMarkInput,
  PeriodsResponse,
  PortfolioResponse,
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

export type TodoRow = {
  id: number;
  externalId: string;
  title: string | null;
  startTs: string;
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

export async function markPeriod(input: PeriodMarkInput): Promise<PeriodEntry> {
  const res = await fetch("/api/period/mark", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<PeriodEntry>;
}
