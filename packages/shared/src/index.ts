import { z } from "zod";

export const SOURCES = ["todoist", "strava", "health", "calendar", "vault", "fidelity"] as const;
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
