import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getPortfolio } from "../api";
import { Totals } from "../lib/finance";

export function FinanceWidget() {
  // Same query as the Finance page (React Query dedupes by key).
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: getPortfolio });
  const t = portfolio.data?.totals;
  const empty =
    t != null &&
    t.marketValue == null &&
    t.costBasis == null &&
    t.totalGain == null &&
    t.dayGain == null;

  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Portfolio</h2>
        <Link to="/finance" className="text-xs text-zinc-500 hover:text-zinc-300">
          Full portfolio →
        </Link>
      </div>

      {portfolio.isPending && <p className="mt-3 text-zinc-400">Loading…</p>}
      {portfolio.isError && (
        <p className="mt-3 text-red-400">
          Couldn't load portfolio — {(portfolio.error as Error).message}
        </p>
      )}
      {empty && (
        <p className="mt-3 text-sm text-zinc-400">
          No holdings yet — upload a Fidelity CSV on the Finance page.
        </p>
      )}
      {t && !empty && (
        <div className="mt-4">
          <Totals totals={t} />
        </div>
      )}
    </section>
  );
}
