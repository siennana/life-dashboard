import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { PortfolioResponse } from "@life/shared";
import { getPortfolio, getSpending } from "../api";
import { dayLabel, gainColor, HistoryChart, money, pct, Totals } from "../lib/finance";

// Sum the non-null values; null if there's nothing to sum (mirrors the API's
// semantics — "zero" and "no data" stay distinguishable).
function sumNullable(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

// The three portfolio queries, shared by the grid + NetValue + CombinedTotals
// below (same keys as the Stocks tabs, so React Query dedupes — no extra
// fetches).
function usePortfolios() {
  const individual = useQuery({
    queryKey: ["portfolio", "individual"],
    queryFn: () => getPortfolio(),
  });
  const nm = useQuery({ queryKey: ["portfolio", "nm"], queryFn: () => getPortfolio("nm") });
  const factset = useQuery({
    queryKey: ["portfolio", "factset"],
    queryFn: () => getPortfolio("factset"),
  });
  return [individual, nm, factset];
}

const PORTFOLIO_ROWS = [
  { account: "individual", label: "Individual" },
  { account: "nm", label: "NM" },
  { account: "factset", label: "FactSet 401k" },
] as const;

// One compact table instead of three widget cards: rows = portfolios (linking
// to their Stocks tab), columns = the four stats. Unlinked/pending accounts
// degrade to a muted note in their row.
function PortfolioGrid() {
  const queries = usePortfolios();

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Portfolios</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="py-1.5 pr-3 font-medium">Account</th>
              <th className="py-1.5 pr-3 text-right font-medium">Market value</th>
              <th className="py-1.5 pr-3 text-right font-medium">Cost basis</th>
              <th className="py-1.5 pr-3 text-right font-medium">Total gain</th>
              <th className="py-1.5 text-right font-medium">Today</th>
            </tr>
          </thead>
          <tbody>
            {PORTFOLIO_ROWS.map((row, i) => {
              const q = queries[i]!;
              const t = q.data?.totals;
              const unlinked = q.data != null && !q.data.linked;
              return (
                <tr key={row.account} className="border-t border-zinc-800/50">
                  <td className="py-2 pr-3">
                    <Link
                      to={`/finance/stocks/${row.account}`}
                      className="whitespace-nowrap text-zinc-200 hover:text-zinc-100"
                    >
                      {row.label}
                    </Link>
                  </td>
                  {q.isPending && (
                    <td colSpan={4} className="py-2 text-right text-zinc-500">
                      Loading…
                    </td>
                  )}
                  {q.isError && (
                    <td colSpan={4} className="py-2 text-right text-red-400">
                      {(q.error as Error).message}
                    </td>
                  )}
                  {unlinked && (
                    <td colSpan={4} className="py-2 text-right text-zinc-500">
                      Not linked — connect from its Stocks tab
                    </td>
                  )}
                  {t && !unlinked && (
                    <>
                      <td className="py-2 pr-3 text-right tabular-nums text-zinc-100">
                        {money(t.marketValue)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-zinc-300">
                        {money(t.costBasis)}
                      </td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${gainColor(t.totalGain)}`}>
                        {money(t.totalGain)}
                        {t.totalGainPct != null && (
                          <span className="ml-1 text-xs">({pct(t.totalGainPct)})</span>
                        )}
                      </td>
                      <td className={`py-2 text-right tabular-nums ${gainColor(t.dayGain)}`}>
                        {money(t.dayGain)}
                        {t.dayGainPct != null && (
                          <span className="ml-1 text-xs">({pct(t.dayGainPct)})</span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Per-date sum of the accounts' value series. Dates where only some accounts
// have a snapshot show those alone (NM's/FactSet's series start at link day,
// so the combined line steps up there — that's real data availability, not
// carry-forward invention). capturedAt/backfilled don't merge cleanly, so
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

// All portfolios' totals added together, plus the combined value-over-time
// line. Percentages are rebuilt from the combined bases: total gain over
// combined cost basis, and today over the combined previous-close value
// reconstructed from each account's dayGain/dayGainPct pair (exact, since
// pct = gain/prevBase).
function CombinedTotals() {
  const queries = usePortfolios();
  const parts = queries
    .map((q) => q.data?.totals)
    .filter((t): t is PortfolioResponse["totals"] => t != null);
  if (parts.length === 0) return null;

  const history = mergeHistories(queries.map((q) => q.data?.history ?? []));

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
          {history.length > 0 ? `all portfolios · daily since ${dayLabel(history[0]!.date)}` : "all portfolios"}
        </span>
      </div>
      <div className="mt-4">
        <Totals
          totals={{
            cashValue: sumNullable(parts.map((t) => t.cashValue)),
            marketValue,
            costBasis,
            totalGain,
            // abs > 0.005: a sub-cent combined base is no denominator (guards
            // float residue from summed cost bases).
            totalGainPct:
              totalGain != null && costBasis != null && Math.abs(costBasis) > 0.005
                ? (totalGain / costBasis) * 100
                : null,
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
// subtract (Plaid reports them as positive amounts owed), and all portfolios'
// market values add. The queries are shared with the cards below.
function NetValue() {
  const portfolioQueries = usePortfolios();
  const spending = useQuery({ queryKey: ["spending", undefined], queryFn: () => getSpending() });

  const portfolios = sumNullable(portfolioQueries.map((q) => q.data?.totals.marketValue));
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
        <PortfolioGrid />
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
