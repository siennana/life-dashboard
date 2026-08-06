import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getSpending } from "../api";
import { FinanceWidget } from "../components/FinanceWidget";
import { money } from "../lib/finance";

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
        <FinanceWidget />

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
