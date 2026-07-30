import type { PortfolioResponse } from "@life/shared";
import { Stat } from "../components/Stat";

// Shared finance formatting + the totals tiles, used by both the Finance page
// and the Home portfolio widget so the numbers render identically.

const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

export const money = (n: number | null) => (n == null ? "—" : usd.format(n));
export const pct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
export const gainColor = (n: number | null) =>
  n == null ? "text-zinc-400" : n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-zinc-300";

// Market value / cost basis / total gain / today's gain — the four portfolio
// totals. This is the entire Home finance widget body, and the header of the
// full Finance page.
export function Totals({ totals }: { totals: PortfolioResponse["totals"] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Market value" value={money(totals.marketValue)} />
      <Stat label="Cost basis" value={money(totals.costBasis)} />
      <Stat
        label="Total gain"
        value={`${money(totals.totalGain)} (${pct(totals.totalGainPct)})`}
        tone={gainColor(totals.totalGain)}
      />
      <Stat label="Today" value={money(totals.dayGain)} tone={gainColor(totals.dayGain)} />
    </div>
  );
}
