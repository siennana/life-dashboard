import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { StockAccount } from "@life/shared";
import { getPortfolio } from "../api";
import { Totals } from "../lib/finance";

// One stock account's totals as a 2x2 (market value / cost basis / total gain
// / today) — Home renders it twice, Individual and NM side by side. Same query
// keys as the Stocks page tabs (React Query dedupes by key); queryFn is
// wrapped so react-query's context object isn't passed as the account.
export function FinanceWidget({
  account = "individual",
  title = "Portfolio",
}: {
  account?: StockAccount;
  title?: string;
}) {
  const portfolio = useQuery({
    queryKey: ["portfolio", account],
    queryFn: () => getPortfolio(account),
  });
  const t = portfolio.data?.totals;
  const unlinked = portfolio.data != null && !portfolio.data.linked;
  const empty =
    t != null &&
    t.marketValue == null &&
    t.costBasis == null &&
    t.totalGain == null &&
    t.dayGain == null;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">{title}</h2>
        {/* Straight to this widget's tab — the tabs are routes now. */}
        <Link
          to={`/finance/stocks/${account}`}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Full portfolio →
        </Link>
      </div>

      {portfolio.isPending && <p className="mt-3 text-zinc-400">Loading…</p>}
      {portfolio.isError && (
        <p className="mt-3 text-red-400">
          Couldn't load portfolio — {(portfolio.error as Error).message}
        </p>
      )}
      {unlinked && (
        <p className="mt-3 text-sm text-zinc-400">
          Not linked yet — connect it from the Stocks page's NM tab.
        </p>
      )}
      {empty && !unlinked && (
        <p className="mt-3 text-sm text-zinc-400">
          {account === "individual"
            ? "No holdings yet — upload a Fidelity CSV on the Finance page."
            : "No holdings synced yet."}
        </p>
      )}
      {t && !empty && !unlinked && (
        <div className="mt-4">
          <Totals totals={t} gridClassName="grid-cols-2" />
        </div>
      )}
    </section>
  );
}
