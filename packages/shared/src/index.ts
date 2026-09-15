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

// Which stock account a portfolio request/response is about: "individual" =
// the Fidelity brokerage (CSV upload or Plaid), "nm" = Northwestern Mutual
// via Plaid, "factset" = the FactSet 401k (same Fidelity Plaid item as
// "individual", split out by account subtype).
export const STOCK_ACCOUNTS = ["individual", "nm", "factset"] as const;
export const stockAccountSchema = z.enum(STOCK_ACCOUNTS);
export type StockAccount = z.infer<typeof stockAccountSchema>;

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
    // Value sitting in cash positions (NM sweep, Fidelity money market) —
    // included in marketValue, broken out for the Cash stat.
    cashValue: z.number().nullable(),
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
  // When the holdings themselves were last replaced (= last CSV upload for
  // "individual", last Plaid holdings sync for "nm").
  holdingsAsOf: z.string().nullable(),
  quotesConfigured: z.boolean(),
  account: stockAccountSchema,
  // False only for "nm" before its Plaid item is connected (no
  // PLAID_NM_ACCESS_TOKEN) — the UI shows the link CTA instead of the empty
  // dashboard. "individual" is CSV-based, so it's always true there.
  linked: z.boolean(),
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

// GitHub contribution counts (Home heatmap): one entry per day, zeros
// included ("synced, nothing that day"), oldest first.
export const contributionDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  count: z.number(),
});
export type ContributionDay = z.infer<typeof contributionDaySchema>;

export const contributionsResponseSchema = z.object({
  configured: z.boolean(), // false = no GITHUB_TOKEN on this machine
  days: z.array(contributionDaySchema),
});
export type ContributionsResponse = z.infer<typeof contributionsResponseSchema>;

// Repos committed to in the past year (Projects page). Private repos the
// read:user token can't see are folded into calendar counts but absent here.
export const githubRepoSchema = z.object({
  name: z.string(), // owner/name
  url: z.string(),
  isPrivate: z.boolean(),
  commitsPastYear: z.number(),
});
export type GithubRepo = z.infer<typeof githubRepoSchema>;

export const githubReposResponseSchema = z.object({
  repos: z.array(githubRepoSchema), // sorted by commitsPastYear desc
});
export type GithubReposResponse = z.infer<typeof githubReposResponseSchema>;

// Individual commits (default-branch, authored by the user) for the
// day-detail panel. `ts` is the full commit timestamp; the client derives the
// local calendar day from it.
export const githubCommitSchema = z.object({
  sha: z.string(),
  repo: z.string(),
  message: z.string(),
  url: z.string(),
  ts: z.string(),
});
export type GithubCommit = z.infer<typeof githubCommitSchema>;

export const githubCommitsResponseSchema = z.object({
  commits: z.array(githubCommitSchema), // newest first
});
export type GithubCommitsResponse = z.infer<typeof githubCommitsResponseSchema>;

// WakaTime coding time (Projects page). `days` is the full accumulated
// series (the DB outlives WakaTime's free 14-day API window); breakdowns are
// aggregated server-side over the trailing 7 days.
export const wakatimeSliceSchema = z.object({
  name: z.string(),
  seconds: z.number(),
});
export type WakatimeSlice = z.infer<typeof wakatimeSliceSchema>;

export const wakatimeResponseSchema = z.object({
  configured: z.boolean(), // false = no WAKATIME_API_KEY on this machine
  days: z.array(z.object({ date: z.string(), seconds: z.number() })), // oldest first
  todaySeconds: z.number().nullable(),
  weekSeconds: z.number(), // trailing 7 days including today
  languages: z.array(wakatimeSliceSchema), // 7-day aggregate, desc
  projects: z.array(wakatimeSliceSchema), // 7-day aggregate, desc
});
export type WakatimeResponse = z.infer<typeof wakatimeResponseSchema>;

// Which Plaid product set to request at link time: "transactions" = the bank
// item (spending), "investments" = the NM brokerage item (stock holdings).
export const plaidLinkTokenInputSchema = z.object({
  mode: z.enum(["transactions", "investments"]).default("transactions"),
});
export type PlaidLinkMode = z.infer<typeof plaidLinkTokenInputSchema>["mode"];

// Loans — manual entries (source "manual", type "loan"), since no servicer is
// linkable through Plaid (Sallie Mae is DOWN/delisted, federal servicers broke
// in 2024). `balance` is the remaining balance as of `asOfDate`; the API
// accrues daily simple interest from that anchor and applies linked bank
// transactions as payments (interest first, then principal).
export const loanInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  balance: z.number().min(0), // remaining balance as of asOfDate
  asOfDate: dayString, // the day `balance` was read off the servicer
  interestRate: z.number().min(0).max(100).optional(), // APR %
  minimumPayment: z.number().min(0).optional(), // monthly
  originalPrincipal: z.number().min(0).optional(),
  dueDay: z.number().int().min(1).max(31).optional(), // monthly due day
  lender: z.string().trim().max(200).optional(),
});
export type LoanInput = z.infer<typeof loanInputSchema>;

// One bank transaction counted as a payment on a loan (matched via the loan's
// linked merchants).
export const loanPaymentSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  amount: z.number(), // positive = money out (Plaid convention)
  merchantKey: z.string(),
  name: z.string(), // display merchant
});
export type LoanPaymentTx = z.infer<typeof loanPaymentSchema>;

// A merchant stream, either linked to a loan or awaiting linking. Loans link
// to *merchants* (normalized key — content, never transaction ids), so every
// past and future charge from that merchant counts as a payment automatically.
export const loanMerchantSchema = z.object({
  merchantKey: z.string(),
  name: z.string(), // display merchant
  count: z.number(), // charges from this merchant (whole history)
  total: z.number(), // sum of those charges
  lastDate: z.string().nullable(),
  lastAmount: z.number().nullable(),
});
export type LoanMerchant = z.infer<typeof loanMerchantSchema>;

export const loanRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  balance: z.number(), // as entered, at asOfDate
  asOfDate: z.string(),
  interestRate: z.number().nullable(),
  minimumPayment: z.number().nullable(),
  originalPrincipal: z.number().nullable(),
  dueDay: z.number().nullable(),
  lender: z.string().nullable(),
  createdAt: z.string(),
  // Computed by the API from the anchor balance + linked payments + rate:
  currentBalance: z.number(),
  accruedInterest: z.number(), // unpaid accrued interest inside currentBalance
  totalPaid: z.number(), // matched payments since asOfDate
  nextDueDate: z.string().nullable(), // from dueDay
  // Amortization estimate assuming the minimum payment continues monthly:
  payoffDate: z.string().nullable(), // when the balance clears
  projectedInterest: z.number().nullable(), // total interest still to be paid
  merchants: z.array(loanMerchantSchema), // linked merchant streams
  payments: z.array(loanPaymentSchema), // matched charges after asOfDate, newest first
  series: z.array(z.object({ date: z.string(), value: z.number() })), // balance over time
});
export type LoanRow = z.infer<typeof loanRowSchema>;

export const loansResponseSchema = z.object({
  loans: z.array(loanRowSchema),
  // student-loan-tagged merchants not yet linked to any loan
  unassigned: z.array(loanMerchantSchema),
  totals: z.object({ balance: z.number(), minimumPayment: z.number() }),
});
export type LoansResponse = z.infer<typeof loansResponseSchema>;

// Link / move / unlink a merchant stream to a loan. loanId null = unlink from
// whichever loan holds it.
export const loanAssignInputSchema = z.object({
  loanId: z.number().int().nullable(),
  merchantKey: z.string().min(1),
});
export type LoanAssignInput = z.infer<typeof loanAssignInputSchema>;

export const spendingTransactionSchema = z.object({
  id: z.number(),
  date: z.string(), // YYYY-MM-DD
  name: z.string(),
  amount: z.number(),
  category: z.string().nullable(),
  pending: z.boolean(),
  accountId: z.string().nullable(),
  // The confirmed recurring series this charge matches, if any — the
  // transaction row menu's Recurring toggle keys off it (null = not recurring;
  // toggling off deletes this series).
  recurringSeriesId: z.number().nullable(),
  // Normalized merchant key — the row menu's Tags section looks up this
  // merchant's tag state with it (client can't normalize; that's server logic).
  merchantKey: z.string(),
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

export const recurringFrequencySchema = z.enum(["weekly", "biweekly", "monthly", "yearly"]);
export type RecurringFrequency = z.infer<typeof recurringFrequencySchema>;

// A detected-but-unconfirmed recurring candidate (the widget's Suggested list).
export const recurringChargeSchema = z.object({
  name: z.string(),
  merchantKey: z.string(), // for tag lookup + the row's tag context menu
  avgAmount: z.number(),
  frequency: recurringFrequencySchema,
  count: z.number(),
  lastDate: z.string(), // YYYY-MM-DD
  nextExpected: z.string(), // YYYY-MM-DD
  active: z.boolean(), // false once a due charge stopped showing up
});
export type RecurringCharge = z.infer<typeof recurringChargeSchema>;

// A confirmed series (recurring_series row) with live stats recomputed from
// transaction history each request — matched by merchant + amount, so counts
// survive Plaid re-links.
export const confirmedRecurringSchema = z.object({
  id: z.number(),
  name: z.string(),
  merchantKey: z.string(), // for tag lookup + the row's tag context menu
  amount: z.number(), // expected charge (fixed at confirm time)
  frequency: recurringFrequencySchema,
  count: z.number(), // matching charges seen in history
  lastDate: z.string().nullable(), // last matching charge, null if none matched
  nextExpected: z.string().nullable(),
  active: z.boolean(), // false once overdue by >2 cycles (or never matched)
  expiresOn: z.string().nullable(), // expected end date; null = indefinite
  // A matched charge landed after expiresOn — still billing past when it
  // should have stopped. Drives the red warning in the widget.
  expired: z.boolean(),
});
export type ConfirmedRecurring = z.infer<typeof confirmedRecurringSchema>;

// Edit a confirmed series' expiration (PATCH /api/recurring/:id).
export const recurringExpirationInputSchema = z.object({
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
export type RecurringExpirationInput = z.infer<typeof recurringExpirationInputSchema>;

// Confirmed-series totals. `yearlyTotal` is annual-frequency charges only;
// `annualizedTotal` is the per-year cost of everything (weekly x52, biweekly
// x26, monthly x12, yearly x1). Inactive (lapsed) series are excluded.
export const recurringTotalsSchema = z.object({
  monthlyTotal: z.number(),
  monthlyCount: z.number(),
  yearlyTotal: z.number(),
  yearlyCount: z.number(),
  annualizedTotal: z.number(),
});
export type RecurringTotals = z.infer<typeof recurringTotalsSchema>;

export const recurringSectionSchema = z.object({
  suggested: z.array(recurringChargeSchema),
  confirmed: z.array(confirmedRecurringSchema),
  // Dismissed series, so a mis-click can be undone (restore = delete the row).
  dismissed: z.array(
    z.object({ id: z.number(), name: z.string(), frequency: recurringFrequencySchema }),
  ),
  totals: recurringTotalsSchema,
});
export type RecurringSection = z.infer<typeof recurringSectionSchema>;

// ---- Tags ------------------------------------------------------------------
// User-defined labels applied to merchants (tag_rules keyed on the normalized
// merchant key). Colors are token names so the web can map them to themed
// wash/text classes statically.
export const TAG_COLORS = [
  "zinc",
  "red",
  "amber",
  "emerald",
  "sky",
  "blue",
  "violet",
  "pink",
] as const;
export const tagColorSchema = z.enum(TAG_COLORS);
export type TagColor = z.infer<typeof tagColorSchema>;

export const tagSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: tagColorSchema,
  // How many merchants carry the tag. Filled by GET /api/tags (the editor's
  // delete confirmation states the blast radius); absent in embedded uses.
  merchants: z.number().optional(),
});
export type Tag = z.infer<typeof tagSchema>;

export const tagsResponseSchema = z.object({ tags: z.array(tagSchema) });
export type TagsResponse = z.infer<typeof tagsResponseSchema>;

export const tagCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
});
export type TagCreateInput = z.infer<typeof tagCreateInputSchema>;

export const tagUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: tagColorSchema.optional(),
});
export type TagUpdateInput = z.infer<typeof tagUpdateInputSchema>;

// Flip a tag on/off for a merchant (server normalizes the merchant name).
export const tagToggleInputSchema = z.object({
  merchant: z.string().trim().min(1),
});
export type TagToggleInput = z.infer<typeof tagToggleInputSchema>;

// A merchant with the tags applied to it (the Bank page's Tagged merchants
// widget + row-menu checkbox state, looked up by transaction merchantKey).
export const taggedMerchantSchema = z.object({
  merchant: z.string(),
  merchantKey: z.string(),
  tags: z.array(tagSchema),
});
export type TaggedMerchant = z.infer<typeof taggedMerchantSchema>;

// Confirm or dismiss a suggestion (upserts on the normalized merchant key).
export const recurringSeriesInputSchema = z.object({
  name: z.string().min(1),
  amount: z.number().positive(),
  frequency: recurringFrequencySchema,
  status: z.enum(["confirmed", "dismissed"]),
});
export type RecurringSeriesInput = z.infer<typeof recurringSeriesInputSchema>;

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
  // 12-month trend; tagSpend carries per-tag net spend sums for every tag
  // with movement that month (the Tag trend widget picks its monitored
  // subset client-side).
  trend: z.array(
    z.object({
      month: z.string(),
      spend: z.number(),
      income: z.number(),
      tagSpend: z.array(z.object({ tagId: z.number(), spend: z.number() })),
    }),
  ),
  daily: z.array(z.object({ date: z.string(), spend: z.number(), cumulative: z.number() })),
  categories: z.array(z.object({ category: z.string(), spend: z.number(), count: z.number() })),
  accounts: z.array(spendingAccountSchema),
  merchants: z.array(z.object({ name: z.string(), spend: z.number(), count: z.number() })),
  recurring: recurringSectionSchema,
  tagged: z.array(taggedMerchantSchema), // merchants with tags, sorted by name
  transactions: z.array(spendingTransactionSchema), // selected month, newest first
});
export type SpendingDashboard = z.infer<typeof spendingDashboardSchema>;

// UI settings (Settings > Style panel), stored as one jsonb row in `settings`
// under key "ui". Defaults make a missing/stale row safe to parse.
export const UI_FONTS = ["system", "inter", "jetbrains-mono", "consolas", "georgia"] as const;
export const uiFontSchema = z.enum(UI_FONTS);
export type UiFont = z.infer<typeof uiFontSchema>;

export const UI_THEMES = ["dark", "light", "royal-velvet", "sandbox"] as const;
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
  // Portion of `spend` matched to confirmed recurring series — the calendar's
  // Recurring filter subtracts it client-side, no refetch.
  recurring: z.number(),
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

// Dates with a non-blank day log — the calendar's Logged (pencil) datalet.
export const loggedDaysResponseSchema = z.object({
  days: z.array(z.string()), // YYYY-MM-DD
});
export type LoggedDaysResponse = z.infer<typeof loggedDaysResponseSchema>;

export const saveDayLogInputSchema = z.object({
  log: z.string().max(20000),
});
export type SaveDayLogInput = z.infer<typeof saveDayLogInputSchema>;
