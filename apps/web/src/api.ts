import type {
  BookInput,
  ContributionsResponse,
  BookRow,
  BooksResponse,
  CalendarDayLog,
  CalendarEventsResponse,
  CalendarLastUpdated,
  CashflowResponse,
  DayTransactionsResponse,
  ExerciseInput,
  ExerciseRow,
  ExercisesResponse,
  GithubCommitsResponse,
  GithubReposResponse,
  LoanAssignInput,
  LoanInput,
  LoansResponse,
  LoggedDaysResponse,
  PeriodsResponse,
  PeriodToggleInput,
  PeriodToggleResult,
  PlaidLinkMode,
  PortfolioResponse,
  RecurringSeriesInput,
  SpendingDashboard,
  StatusResponse,
  StockAccount,
  Tag,
  TagsResponse,
  TagUpdateInput,
  UiSettings,
  UploadResponse,
  WakatimeResponse,
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

export const getPortfolio = (account: StockAccount = "individual") =>
  apiFetch<PortfolioResponse>(`/api/finance/portfolio?account=${account}`);

export const getLoans = () => apiFetch<LoansResponse>("/api/loans");

export const deleteLoan = (id: number) => apiDelete(`/api/loans/${id}`);

export async function addLoan(input: LoanInput): Promise<{ id: number }> {
  const res = await fetch("/api/loans", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<{ id: number }>;
}

export async function updateLoan(id: number, input: LoanInput): Promise<{ updated: boolean }> {
  const res = await fetch(`/api/loans/${id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<{ updated: boolean }>;
}

export const assignLoanMerchant = (input: LoanAssignInput) =>
  apiPost<{ assigned: boolean }>("/api/loans/assign-merchant", input);

export async function uploadHoldings(
  csv: string,
  account: StockAccount = "individual",
): Promise<UploadResponse> {
  const res = await fetch(`/api/finance/holdings/upload?account=${account}`, {
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

export const getContributions = () =>
  apiFetch<ContributionsResponse>("/api/github/contributions");

export const getGithubRepos = () => apiFetch<GithubReposResponse>("/api/github/repos");

export const getWakatime = () => apiFetch<WakatimeResponse>("/api/wakatime");

export const getGithubCommits = () => apiFetch<GithubCommitsResponse>("/api/github/commits");

export const getExercises = () => apiFetch<ExercisesResponse>("/api/exercises");

export const deleteExercise = (id: number) => apiDelete(`/api/exercises/${id}`);

export const getBooks = () => apiFetch<BooksResponse>("/api/books");

export const deleteBook = (id: number) => apiDelete(`/api/books/${id}`);

export const getCalendarEvents = () => apiFetch<CalendarEventsResponse>("/api/calendar/events");

export const getWeather = (force = false) =>
  apiFetch<WeatherResponse>(`/api/weather${force ? "?force=true" : ""}`);

export const getUiSettings = () => apiFetch<UiSettings>("/api/settings/ui");

export async function saveUiSettings(value: UiSettings): Promise<UiSettings> {
  const res = await fetch("/api/settings/ui", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<UiSettings>;
}

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

export const getCalendarLastUpdated = () =>
  apiFetch<CalendarLastUpdated>("/api/calendar/last-updated");

export const getLoggedDays = () => apiFetch<LoggedDaysResponse>("/api/calendar/logged-days");

export const getSpending = (month?: string) =>
  apiFetch<SpendingDashboard>(`/api/finance/spending${month ? `?month=${month}` : ""}`);

// excludeTags: tag ids whose merchants are dropped from the day sums (the
// calendar filter's Cashflow > Tags checkboxes).
export const getCashflow = (excludeTags: number[] = []) =>
  apiFetch<CashflowResponse>(
    `/api/finance/cashflow${excludeTags.length > 0 ? `?excludeTags=${excludeTags.join(",")}` : ""}`,
  );

export const getDayTransactions = (date: string) =>
  apiFetch<DayTransactionsResponse>(`/api/finance/transactions/${date}`);

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

// Confirm/dismiss a recurring-charge suggestion; delete = restore to suggested.
export const setRecurringSeries = (input: RecurringSeriesInput) =>
  apiPost<{ id: number; status: string }>("/api/recurring", input);

export const deleteRecurringSeries = (id: number) => apiDelete(`/api/recurring/${id}`);

// Edit a confirmed series' expected end date (null = indefinite).
export async function updateRecurringExpiration(
  id: number,
  expiresOn: string | null,
): Promise<{ id: number; expiresOn: string | null }> {
  const res = await fetch(`/api/recurring/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresOn }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<{ id: number; expiresOn: string | null }>;
}

// ---- Tags (Edit Tags drawer + Bank row menus) ------------------------------
export const getTags = () => apiFetch<TagsResponse>("/api/tags");

export const createTag = (name: string) => apiPost<Tag>("/api/tags", { name });

export async function updateTag(id: number, patch: TagUpdateInput): Promise<Tag> {
  const res = await fetch(`/api/tags/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<Tag>;
}

export const deleteTag = (id: number) => apiDelete(`/api/tags/${id}`);

export const toggleTagMerchant = (tagId: number, merchant: string) =>
  apiPost<{ tagged: boolean }>(`/api/tags/${tagId}/toggle`, { merchant });

export const createPlaidLinkToken = (mode: PlaidLinkMode = "transactions") =>
  apiPost<{ link_token: string }>("/api/plaid/link-token", { mode });

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
