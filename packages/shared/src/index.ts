import { z } from "zod";

export const SOURCES = ["todoist", "strava", "health", "calendar", "vault", "fidelity", "manual"] as const;
export const sourceSchema = z.enum(SOURCES);
export type Source = z.infer<typeof sourceSchema>;

// One row in the Sync status widget = one automated/background process. Covers
// every source that resyncs or hits an external service on a schedule, plus the
// live DB connectivity check. `type` is the connection kind (Database / REST
// API / CalDAV / ...); `cadence` is how often it runs ("every 5 min", "live",
// "manual"); `status` folds sync_runs state with config presence ("off" = creds
// missing on this machine, "idle" = configured but not run yet).
export const SYNC_PROCESS_STATUSES = ["ok", "error", "running", "idle", "off"] as const;
export const syncProcessStatusSchema = z.enum(SYNC_PROCESS_STATUSES);
export type SyncProcessStatus = z.infer<typeof syncProcessStatusSchema>;

export const syncProcessSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
  cadence: z.string(),
  status: syncProcessStatusSchema,
  lastRun: z.coerce.date().nullable(),
  error: z.string().nullable(),
});
export type SyncProcess = z.infer<typeof syncProcessSchema>;

export const statusResponseSchema = z.object({
  processes: z.array(syncProcessSchema),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

// Risk tiers derived from a holding's beta (volatility vs. the market).
// "unknown" = no beta available (e.g. money-market / some funds).
export const RISK_TIERS = ["low", "moderate", "elevated", "high", "unknown"] as const;
export const riskTierSchema = z.enum(RISK_TIERS);
export type RiskTier = z.infer<typeof riskTierSchema>;

// Finance — a holding is what the Fidelity CSV gives us (symbol + cost basis,
// plus quantity when the export includes it). A position is a holding priced
// with a live quote; nulls mean we have the holding but no quote yet.
export const positionSchema = z.object({
  symbol: z.string(),
  description: z.string().nullable(),
  quantity: z.number().nullable(),
  costBasis: z.number().nullable(),
  price: z.number().nullable(),
  previousClose: z.number().nullable(),
  dayChangePct: z.number().nullable(),
  marketValue: z.number().nullable(),
  totalGain: z.number().nullable(),
  totalGainPct: z.number().nullable(),
  dayGain: z.number().nullable(),
  beta: z.number().nullable(),
  riskTier: riskTierSchema,
  weightPct: z.number().nullable(),
  sector: z.string().nullable(),
  dividendYieldPct: z.number().nullable(),
  fiftyTwoWeekLow: z.number().nullable(),
  fiftyTwoWeekHigh: z.number().nullable(),
  // Where the live price sits inside the 52-week range, 0 (at the low) to 100.
  fiftyTwoWeekPct: z.number().nullable(),
});
export type Position = z.infer<typeof positionSchema>;

// Value grouped by Yahoo sector ("Other" = funds/unknown), for the allocation
// chart. Only priced positions contribute.
export const sectorSliceSchema = z.object({
  sector: z.string(),
  value: z.number(),
  weightPct: z.number(),
  positions: z.number(),
});
export type SectorSlice = z.infer<typeof sectorSliceSchema>;

// Bottom-of-dashboard portfolio-level risk assessment.
export const portfolioRiskSchema = z.object({
  rating: riskTierSchema,
  portfolioBeta: z.number().nullable(),
  topWeightPct: z.number().nullable(),
  topSymbol: z.string().nullable(),
  highRiskPct: z.number().nullable(),
  pricedHoldings: z.number(),
  notes: z.array(z.string()),
});
export type PortfolioRisk = z.infer<typeof portfolioRiskSchema>;

export const portfolioResponseSchema = z.object({
  positions: z.array(positionSchema),
  totals: z.object({
    marketValue: z.number().nullable(),
    costBasis: z.number().nullable(),
    totalGain: z.number().nullable(),
    totalGainPct: z.number().nullable(),
    dayGain: z.number().nullable(),
    dayGainPct: z.number().nullable(),
  }),
  sectors: z.array(sectorSliceSchema),
  // Daily portfolio-value snapshots (metrics rows), oldest first. `capturedAt`
  // is when the stored (last-write-wins) value was computed; null for
  // `backfilled` days, which are reconstructed daily closes with no wall time.
  history: z.array(
    z.object({
      date: z.string(),
      value: z.number(),
      capturedAt: z.string().nullable(),
      backfilled: z.boolean(),
    }),
  ),
  risk: portfolioRiskSchema,
  pricedAt: z.string().nullable(),
  // When the holdings themselves were last replaced (= last CSV upload).
  holdingsAsOf: z.string().nullable(),
  quotesConfigured: z.boolean(),
});
export type PortfolioResponse = z.infer<typeof portfolioResponseSchema>;

export const uploadResponseSchema = z.object({
  imported: z.number(),
  symbols: z.array(z.string()),
  skipped: z.number(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

// Exercise — manually logged workouts. `type` and `date` are required; the rest
// are optional. `date` is a plain YYYY-MM-DD (the day of the workout).
export const EXERCISE_TYPES = ["run", "gym", "yoga", "bike", "hike", "custom"] as const;
export const exerciseTypeSchema = z.enum(EXERCISE_TYPES);
export type ExerciseType = z.infer<typeof exerciseTypeSchema>;

export const exerciseInputSchema = z.object({
  type: exerciseTypeSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected date as YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "expected time as HH:MM").optional(),
  description: z.string().trim().max(2000).optional(),
  totalTime: z.number().nonnegative().optional(), // minutes
  distanceMiles: z.number().nonnegative().optional(),
  caloriesBurned: z.number().nonnegative().optional(),
});
export type ExerciseInput = z.infer<typeof exerciseInputSchema>;

export const exerciseRowSchema = z.object({
  id: z.number(),
  type: exerciseTypeSchema,
  date: z.string(),
  time: z.string().nullable(),
  description: z.string().nullable(),
  totalTime: z.number().nullable(),
  distanceMiles: z.number().nullable(),
  caloriesBurned: z.number().nullable(),
  createdAt: z.string(),
});
export type ExerciseRow = z.infer<typeof exerciseRowSchema>;

export const exercisesResponseSchema = z.object({
  exercises: z.array(exerciseRowSchema),
});
export type ExercisesResponse = z.infer<typeof exercisesResponseSchema>;

// Reading — manually logged books. `title` and `status` are required; rating
// is out of 5 in half-star steps; dates are plain YYYY-MM-DD.
export const BOOK_STATUSES = ["reading", "complete", "queued", "abandoned"] as const;
export const bookStatusSchema = z.enum(BOOK_STATUSES);
export type BookStatus = z.infer<typeof bookStatusSchema>;

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected date as YYYY-MM-DD");

export const bookInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  status: bookStatusSchema,
  author: z.string().trim().max(300).optional(),
  rating: z.number().min(0.5).max(5).multipleOf(0.5).optional(),
  log: z.string().trim().max(20000).optional(),
  dateStarted: dayString.optional(),
  dateCompleted: dayString.optional(),
});
export type BookInput = z.infer<typeof bookInputSchema>;

export const bookRowSchema = z.object({
  id: z.number(),
  title: z.string(),
  author: z.string().nullable(),
  rating: z.number().nullable(),
  log: z.string().nullable(),
  dateStarted: z.string().nullable(),
  dateCompleted: z.string().nullable(),
  status: bookStatusSchema,
  createdAt: z.string(),
});
export type BookRow = z.infer<typeof bookRowSchema>;

export const booksResponseSchema = z.object({
  books: z.array(bookRowSchema),
});
export type BooksResponse = z.infer<typeof booksResponseSchema>;

// Calendar — events pulled read-only from iCloud (CalDAV). Times are ISO
// strings; all-day events carry allDay=true.
export const calendarEventSchema = z.object({
  id: z.number(),
  title: z.string(),
  start: z.string(),
  end: z.string().nullable(),
  allDay: z.boolean(),
  calendar: z.string().nullable(),
  location: z.string().nullable(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const calendarEventsResponseSchema = z.object({
  events: z.array(calendarEventSchema),
});
export type CalendarEventsResponse = z.infer<typeof calendarEventsResponseSchema>;

// Weather — live read from Open-Meteo (no key). `code` is a WMO weather code;
// the API sends an ASCII label, the web app maps the code to an emoji. Temps
// are Fahrenheit. `configured: false` means no location is set in .env.
export const weatherDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  code: z.number(),
  label: z.string(),
  tempMax: z.number(),
  tempMin: z.number(),
  precipProbability: z.number().nullable(),
});
export type WeatherDay = z.infer<typeof weatherDaySchema>;

// One hourly slot, trimmed server-side to the next ~24h from now (Open-Meteo
// returns a full week hourly, which is more than the widget needs).
export const weatherHourSchema = z.object({
  time: z.string(), // YYYY-MM-DDTHH:00, local to the forecast location
  code: z.number(),
  label: z.string(), // ASCII WMO description (for the tooltip)
  temp: z.number(),
  precipProbability: z.number().nullable(),
});
export type WeatherHour = z.infer<typeof weatherHourSchema>;

export const weatherResponseSchema = z.object({
  configured: z.boolean(),
  location: z.string().nullable(),
  current: z
    .object({ temp: z.number(), code: z.number(), label: z.string() })
    .nullable(),
  hourly: z.array(weatherHourSchema),
  daily: z.array(weatherDaySchema),
  // When this data was actually pulled from Open-Meteo (not when the browser
  // asked) — the 30min server-side cache means those can differ.
  fetchedAt: z.string().nullable(),
});
export type WeatherResponse = z.infer<typeof weatherResponseSchema>;

// Menstrual cycle tracking — each menstruating day is toggled independently
// (right-click a calendar day). No start/end range logic; the data is just the
// set of dates marked as menstruating.
export const periodToggleInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected date as YYYY-MM-DD"),
});
export type PeriodToggleInput = z.infer<typeof periodToggleInputSchema>;

export const periodToggleResultSchema = z.object({
  date: z.string(),
  marked: z.boolean(),
});
export type PeriodToggleResult = z.infer<typeof periodToggleResultSchema>;

export const periodsResponseSchema = z.object({
  days: z.array(z.string()), // YYYY-MM-DD
});
export type PeriodsResponse = z.infer<typeof periodsResponseSchema>;

// Bank spending via Plaid (read-only). Transactions land in `events` (source
// "plaid"); amounts follow Plaid's sign convention: positive = money out.
export const plaidExchangeInputSchema = z.object({
  public_token: z.string().min(10),
});
export type PlaidExchangeInput = z.infer<typeof plaidExchangeInputSchema>;

export const spendingTransactionSchema = z.object({
  id: z.number(),
  date: z.string(), // YYYY-MM-DD
  name: z.string(),
  amount: z.number(),
  category: z.string().nullable(),
  pending: z.boolean(),
  accountId: z.string().nullable(),
});
export type SpendingTransaction = z.infer<typeof spendingTransactionSchema>;

// One month of the spending dashboard. `months` drives the month switcher;
// spend figures exclude internal transfers / card payments (NON_SPEND rules in
// the API) and are net of refunds.
export const spendingAccountSchema = z.object({
  accountId: z.string(),
  name: z.string(),
  mask: z.string().nullable(),
  accountType: z.string().nullable(), // credit | depository | ...
  subtype: z.string().nullable(),
  balance: z.number().nullable(),
  creditLimit: z.number().nullable(),
  spend: z.number(), // selected month, this account
  count: z.number(),
});
export type SpendingAccount = z.infer<typeof spendingAccountSchema>;

export const recurringChargeSchema = z.object({
  name: z.string(),
  avgAmount: z.number(),
  frequency: z.enum(["weekly", "biweekly", "monthly", "yearly"]),
  count: z.number(),
  lastDate: z.string(), // YYYY-MM-DD
  nextExpected: z.string(), // YYYY-MM-DD
  active: z.boolean(), // false once a due charge stopped showing up
});
export type RecurringCharge = z.infer<typeof recurringChargeSchema>;

export const spendingDashboardSchema = z.object({
  configured: z.boolean(),
  linked: z.boolean(),
  month: z.string(), // selected YYYY-MM
  months: z.array(z.string()), // every month with data, newest first
  summary: z.object({
    spend: z.number(), // net of refunds
    income: z.number(),
    refunds: z.number(),
    txCount: z.number(),
    pendingCount: z.number(),
    prevMonthSpend: z.number().nullable(),
    projected: z.number().nullable(), // spend pace * days-in-month; current month only
  }),
  trend: z.array(z.object({ month: z.string(), spend: z.number(), income: z.number() })),
  daily: z.array(z.object({ date: z.string(), spend: z.number(), cumulative: z.number() })),
  categories: z.array(z.object({ category: z.string(), spend: z.number(), count: z.number() })),
  accounts: z.array(spendingAccountSchema),
  merchants: z.array(z.object({ name: z.string(), spend: z.number(), count: z.number() })),
  recurring: z.array(recurringChargeSchema),
  transactions: z.array(spendingTransactionSchema), // selected month, newest first
});
export type SpendingDashboard = z.infer<typeof spendingDashboardSchema>;

// UI settings (Settings > Style panel), stored as one jsonb row in `settings`
// under key "ui". Defaults make a missing/stale row safe to parse.
export const UI_FONTS = ["system", "inter", "jetbrains-mono", "consolas", "georgia"] as const;
export const uiFontSchema = z.enum(UI_FONTS);
export type UiFont = z.infer<typeof uiFontSchema>;

export const UI_THEMES = ["dark", "light"] as const;
export const uiThemeSchema = z.enum(UI_THEMES);
export type UiTheme = z.infer<typeof uiThemeSchema>;

// Density sliders (continuous, replacing the old discrete enum — an old row's
// `density` key is stripped on parse and these defaults take over):
// `spacing` is Tailwind's --spacing base in rem (default 0.25; every padding/
// margin/gap and numeric w-/h- derives from it), `lineHeight` the leading
// ratio for xs/sm text (base text uses it +0.1). Terminal-tight ≈ 1.15.
export const uiSettingsSchema = z.object({
  font: uiFontSchema.default("system"),
  theme: uiThemeSchema.default("dark"),
  spacing: z.number().min(0.18).max(0.3).default(0.225),
  lineHeight: z.number().min(1).max(1.6).default(1.25),
});
export type UiSettings = z.infer<typeof uiSettingsSchema>;

// Net cashflow per day (Plaid), for the per-day figure on the calendar grid.
// `net` = income − spend (Bank-page definitions); net < 0 means money out on
// balance. Only days with real movement are included.
export const cashflowDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  net: z.number(),
  spend: z.number(),
  income: z.number(),
});
export type CashflowDay = z.infer<typeof cashflowDaySchema>;

export const cashflowResponseSchema = z.object({
  days: z.array(cashflowDaySchema),
});
export type CashflowResponse = z.infer<typeof cashflowResponseSchema>;

// Plaid transactions on one day, for the calendar day-detail Transactions list.
export const dayTransactionsResponseSchema = z.object({
  date: z.string(),
  transactions: z.array(spendingTransactionSchema),
});
export type DayTransactionsResponse = z.infer<typeof dayTransactionsResponseSchema>;

// Calendar day-detail form (expanded day cell): the free-text log auto-saves on
// blur; todos + transactions read-only alongside it.
export const calendarDayLogSchema = z.object({
  date: z.string(),
  log: z.string().nullable(),
});
export type CalendarDayLog = z.infer<typeof calendarDayLogSchema>;

// Timestamp of the most recent calendar-day edit (the "last saved" stamp).
export const calendarLastUpdatedSchema = z.object({
  updatedAt: z.string().nullable(),
});
export type CalendarLastUpdated = z.infer<typeof calendarLastUpdatedSchema>;

export const saveDayLogInputSchema = z.object({
  log: z.string().max(20000),
});
export type SaveDayLogInput = z.infer<typeof saveDayLogInputSchema>;
