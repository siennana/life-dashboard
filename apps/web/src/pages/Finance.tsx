import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { PortfolioResponse, RiskTier } from "@life/shared";
import { getPortfolio, uploadHoldings } from "../api";
import { gainColor, money, pct, Totals } from "../lib/finance";
import { Stat } from "../components/Stat";

const qty = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 4 });

const TIER_LABEL: Record<RiskTier, string> = {
  low: "Low",
  moderate: "Moderate",
  elevated: "Elevated",
  high: "High",
  unknown: "—",
};
const TIER_STYLE: Record<RiskTier, string> = {
  low: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  moderate: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  elevated: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  high: "bg-red-500/15 text-red-300 ring-red-500/30",
  unknown: "bg-zinc-700/30 text-zinc-500 ring-zinc-600/30",
};

function RiskBadge({ tier, beta }: { tier: RiskTier; beta: number | null }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ring-1 ${TIER_STYLE[tier]}`}
    >
      {TIER_LABEL[tier]}
      {beta != null && <span className="tabular-nums opacity-70">β{beta.toFixed(2)}</span>}
    </span>
  );
}

function RiskCard({ risk }: { risk: PortfolioResponse["risk"] }) {
  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Portfolio risk</h2>
        <RiskBadge tier={risk.rating} beta={risk.portfolioBeta} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Portfolio beta"
          value={risk.portfolioBeta == null ? "—" : risk.portfolioBeta.toFixed(2)}
        />
        <Stat
          label="Top position"
          value={
            risk.topSymbol && risk.topWeightPct != null
              ? `${risk.topSymbol} · ${risk.topWeightPct.toFixed(0)}%`
              : "—"
          }
        />
        <Stat
          label="In volatile holdings"
          value={risk.highRiskPct == null ? "—" : `${risk.highRiskPct.toFixed(0)}%`}
        />
      </div>
      {risk.notes.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-sm text-zinc-400">
          {risk.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <span className="text-zinc-600">•</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-zinc-600">
        Risk is estimated from each holding's beta (volatility vs. the market) and how concentrated
        the portfolio is. Not investment advice.
      </p>
    </section>
  );
}

function Uploader() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: uploadHoldings,
    onSuccess: (res) => {
      setNote(`Imported ${res.imported} holdings${res.skipped ? `, skipped ${res.skipped} rows` : ""}.`);
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
    onError: (err) => setNote((err as Error).message),
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    upload.mutate(text);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
        Upload Fidelity CSV
      </h2>
      <div className="mt-3 flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          disabled={upload.isPending}
          className="block w-full text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-4 file:py-2 file:text-sm file:text-zinc-100 hover:file:bg-zinc-700 disabled:opacity-50"
        />
      </div>
      {upload.isPending && <p className="mt-3 text-sm text-zinc-400">Importing…</p>}
      {note && !upload.isPending && (
        <p className={`mt-3 text-sm ${upload.isError ? "text-red-400" : "text-emerald-400"}`}>
          {note}
        </p>
      )}
    </section>
  );
}

export function Finance() {
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: getPortfolio });
  const positions = portfolio.data?.positions ?? [];

  return (
    <>
      <h1 className="text-2xl font-semibold">Portfolio Analytics</h1>

      <Uploader />

      {portfolio.data && !portfolio.data.quotesConfigured && positions.length > 0 && (
        <p className="mt-6 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-sm text-amber-300">
          Live prices are off — set <code>FINNHUB_API_KEY</code> in <code>.env</code> to see current
          value and today's change.
        </p>
      )}

      <section className="mt-6">
        {portfolio.isPending && <p className="text-zinc-400">Loading…</p>}
        {portfolio.isError && (
          <p className="text-red-400">
            Couldn't load portfolio — {(portfolio.error as Error).message}
          </p>
        )}
        {portfolio.isSuccess && positions.length === 0 && (
          <p className="text-zinc-400">No holdings yet — upload a Fidelity CSV above to get started.</p>
        )}

        {positions.length > 0 && portfolio.data && (
          <>
            <Totals totals={portfolio.data.totals} />
            {portfolio.data.pricedAt && (
              <p className="mt-3 text-xs text-zinc-500">
                Priced {new Date(portfolio.data.pricedAt).toLocaleTimeString()}
              </p>
            )}
            <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-3 font-medium">Symbol</th>
                    <th className="px-4 py-3 text-right font-medium">Qty</th>
                    <th className="px-4 py-3 text-right font-medium">Price</th>
                    <th className="px-4 py-3 text-right font-medium">Today</th>
                    <th className="px-4 py-3 text-right font-medium">Value</th>
                    <th className="px-4 py-3 text-right font-medium">Cost basis</th>
                    <th className="px-4 py-3 text-right font-medium">Total gain</th>
                    <th className="px-4 py-3 text-right font-medium">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.symbol} className="border-b border-zinc-800/50 last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-100">{p.symbol}</div>
                        {p.description && (
                          <div className="max-w-[16rem] truncate text-xs text-zinc-500">
                            {p.description}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                        {qty(p.quantity)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                        {money(p.price)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${gainColor(p.dayChangePct)}`}>
                        {pct(p.dayChangePct)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-100">
                        {money(p.marketValue)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                        {money(p.costBasis)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${gainColor(p.totalGain)}`}>
                        {money(p.totalGain)}
                        <span className="ml-1 text-xs">({pct(p.totalGainPct)})</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RiskBadge tier={p.riskTier} beta={p.beta} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <RiskCard risk={portfolio.data.risk} />
          </>
        )}
      </section>
    </>
  );
}
