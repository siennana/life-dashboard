import { z } from "zod";

export const SOURCES = ["todoist", "strava", "health", "calendar", "vault", "fidelity", "manual"] as const;
export const sourceSchema = z.enum(SOURCES);
export type Source = z.infer<typeof sourceSchema>;

export const syncStatusSchema = z.object({
  source: z.string(),
  started_at: z.coerce.date(),
  finished_at: z.coerce.date().nullable(),
  status: z.enum(["running", "ok", "error"]),
  error: z.string().nullable(),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const statusResponseSchema = z.object({
  sources: z.array(syncStatusSchema),
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
});
export type Position = z.infer<typeof positionSchema>;

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
  }),
  risk: portfolioRiskSchema,
  pricedAt: z.string().nullable(),
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

export const weatherResponseSchema = z.object({
  configured: z.boolean(),
  location: z.string().nullable(),
  current: z
    .object({ temp: z.number(), code: z.number(), label: z.string() })
    .nullable(),
  daily: z.array(weatherDaySchema),
});
export type WeatherResponse = z.infer<typeof weatherResponseSchema>;
