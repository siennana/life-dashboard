import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { PortfolioResponse } from "@life/shared";
import { getPortfolio, getSpending } from "../api";
import { FinanceWidget } from "../components/FinanceWidget";
import { dayLabel, HistoryChart, money, Totals } from "../lib/finance";

// Sum the non-null values; null if there's nothing to sum (mirrors the API's
// semantics — "zero" and "no data" stay distinguishable).
function sumNullable(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

// Per-date sum of the two accounts' value series. Dates where only one
// account has a snapshot show that account alone (NM's series starts at link
// day, so the combined line steps up there — that's real data availability,
// not carry-forward invention). capturedAt/backfilled don't merge cleanly, so
// merged points carry neither and the tooltip shows just the date.
function mergeHistories(
  series: PortfolioResponse["history"][],
): PortfolioResponse["history"] {
  const byDate = new Map<string, number>();
  for (const s of series)
    for (const p of s) byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.value);
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, value]) => ({ date, value, capturedAt: null, backfilled: false }));
}

// Both portfolios' totals added together, plus the combined value-over-time
// line. Reuses the two widget queries above (same keys, so React Query
// dedupes — no extra fetches). Percentages are rebuilt from the combined
// bases: total gain over combined cost basis, and today over the combined
// previous-close value reconstructed from each account's dayGain/dayGainPct
// pair (exact, since pct = gain/prevBase).
function CombinedTotals() {
  const individual = useQuery({
    queryKey: ["portfolio", "individual"],
    queryFn: () => getPortfolio(),
  });
  const nm = useQuery({ queryKey: ["portfolio", "nm"], queryFn: () => getPortfolio("nm") });
  const parts = [individual.data?.totals, nm.data?.totals].filter(
    (t): t is PortfolioResponse["totals"] => t != null,
  );
  if (parts.length === 0) return null;

  const history = mergeHistories([
    individual.data?.history ?? [],
    nm.data?.history ?? [],
  ]);

  const marketValue = sumNullable(parts.map((t) => t.marketValue));
  const costBasis = sumNullable(parts.map((t) => t.costBasis));
  const totalGain = sumNullable(parts.map((t) => t.totalGain));
  const dayGain = sumNullable(parts.map((t) => t.dayGain));
  const prevCloseValue = sumNullable(
    parts.map((t) =>
      t.dayGain != null && t.dayGainPct ? t.dayGain / (t.dayGainPct / 100) : null,
    ),
  );

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Combined</h2>
        <span className="text-xs text-zinc-500">
          {history.length > 0 ? `both portfolios · daily since ${dayLabel(history[0]!.date)}` : "both portfolios"}
        </span>
      </div>
      <div className="mt-4">
        <Totals
          totals={{
            marketValue,
            costBasis,
            totalGain,
            totalGainPct: totalGain != null && costBasis ? (totalGain / costBasis) * 100 : null,
            dayGain,
            dayGainPct: dayGain != null && prevCloseValue ? (dayGain / prevCloseValue) * 100 : null,
          }}
        />
      </div>
      {history.length >= 2 && <HistoryChart history={history} />}
    </section>
  );
}

// Headline number: everything Plaid + the portfolios know about, in one
// figure. Bank depository balances count positive, credit-card balances
// subtract (Plaid reports them as positive amounts owed), and both portfolios'
// market values add. All three queries are shared with the cards below.
function NetValue() {
  const individual = useQuery({
    queryKey: ["portfolio", "individual"],
    queryFn: () => getPortfolio(),
  });
  const nm = useQuery({ queryKey: ["portfolio", "nm"], queryFn: () => getPortfolio("nm") });
  const spending = useQuery({ queryKey: ["spending", undefined], queryFn: () => getSpending() });

  const portfolios = sumNullable([
    individual.data?.totals.marketValue,
    nm.data?.totals.marketValue,
  ]);
  const accounts = spending.data?.accounts ?? [];
  const bank = sumNullable(
    accounts.filter((a) => a.accountType !== "credit").map((a) => a.balance),
  );
  const credit = sumNullable(
    accounts.filter((a) => a.accountType === "credit").map((a) => a.balance),
  );
  const net =
    portfolios == null && bank == null && credit == null
      ? null
      : (portfolios ?? 0) + (bank ?? 0) - (credit ?? 0);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Net value</h2>
      <p className="mt-2 text-3xl font-semibold text-zinc-100">{money(net)}</p>
      <p className="mt-1 text-xs text-zinc-500">
        Portfolios {money(portfolios)} · Bank {money(bank)} · Credit −{money(credit)}
      </p>
    </section>
  );
}

// Finance landing page: portfolio totals (shared Home widget) + a bank summary
// pulled from the spending dashboard endpoint (same query key as the Bank page
// default, so React Query dedupes).
export function Finance() {
  const spending = useQuery({ queryKey: ["spending", undefined], queryFn: () => getSpending() });
  const d = spending.data;

  const creditBalance =
    d?.accounts
      .filter((a) => a.accountType === "credit")
      .reduce((sum, a) => sum + (a.balance ?? 0), 0) ?? null;

  return (
    <>
      <h1 className="text-2xl font-semibold">Finance</h1>

      <div className="mt-3 flex flex-col gap-3">
        <NetValue />
        <div className="grid gap-3 lg:grid-cols-2 lg:items-stretch">
          <FinanceWidget title="Individual" />
          <FinanceWidget account="nm" title="NM" />
        </div>
        <CombinedTotals />

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Bank</h2>
            <Link to="/finance/bank" className="text-xs text-zinc-500 hover:text-zinc-300">
              Full dashboard →
            </Link>
          </div>

          {spending.isPending && <p className="mt-3 text-zinc-400">Loading…</p>}
          {spending.isError && (
            <p className="mt-3 text-red-400">
              Couldn't load bank data — {(spending.error as Error).message}
            </p>
          )}

          {d && d.accounts.length === 0 && (
            <p className="mt-3 text-sm text-zinc-400">
              No bank connected — see the Bank page to link one.
            </p>
          )}

          {d && d.accounts.length > 0 && (
            <>
              {/* this month, matching the Bank page's spend/income definitions
                  (transfers + card payments excluded, net of refunds) */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Outflow this month</p>
                  <p className="mt-1 text-xl font-semibold text-zinc-100">
                    {money(d.summary.spend)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Inflow this month</p>
                  <p className="mt-1 text-xl font-semibold text-zinc-100">
                    {money(d.summary.income)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Credit card balance</p>
                  <p className="mt-1 text-xl font-semibold text-zinc-100">{money(creditBalance)}</p>
                </div>
              </div>

              <ul className="mt-4 space-y-2 border-t border-zinc-800 pt-3">
                {d.accounts.map((a) => (
                  <li key={a.accountId} className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate text-zinc-200">{a.name}</span>
                    <span className="hidden shrink-0 text-xs text-zinc-500 sm:inline">
                      {a.accountType === "credit"
                        ? a.creditLimit != null
                          ? `credit · ${money(a.creditLimit)} limit`
                          : "credit"
                        : (a.subtype ?? a.accountType ?? "")}
                    </span>
                    <span className="w-24 shrink-0 text-right tabular-nums text-zinc-100">
                      {money(a.balance)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}
