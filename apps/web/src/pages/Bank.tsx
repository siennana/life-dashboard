import { useQuery } from "@tanstack/react-query";
import { getSpending } from "../api";
import { money } from "../lib/finance";

// "FOOD_AND_DRINK" -> "food and drink"
const prettyCategory = (c: string) => c.toLowerCase().replace(/_/g, " ");

const spendDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Recent bank transactions from Plaid + this month's spend total.
function SpendingCard() {
  const spending = useQuery({ queryKey: ["spending"], queryFn: getSpending });
  const d = spending.data;
  const monthLabel = d
    ? new Date(`${d.month}-01T12:00:00`).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Spending</h2>
        {d && d.transactions.length > 0 && (
          <span className="text-sm text-zinc-300">
            {monthLabel}: <span className="font-semibold text-zinc-100">{money(d.monthSpend)}</span>
          </span>
        )}
      </div>

      {spending.isPending && <p className="mt-3 text-zinc-400">Loading…</p>}
      {spending.isError && (
        <p className="mt-3 text-red-400">
          Couldn't load spending — {(spending.error as Error).message}
        </p>
      )}
      {d && d.transactions.length === 0 && (
        <p className="mt-3 text-sm text-zinc-400">
          {!d.configured
            ? "No bank connected — set PLAID_CLIENT_ID / PLAID_SECRET in .env, then visit /plaid-link."
            : !d.linked
              ? "Plaid keys set — visit /plaid-link to connect your bank."
              : "Bank connected — transactions will appear after the next sync."}
        </p>
      )}

      {d && d.transactions.length > 0 && (
        <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {d.transactions.map((t) => (
            <li key={t.id} className="flex items-center gap-3 text-sm">
              <span className="w-12 shrink-0 text-xs text-zinc-500">{spendDate(t.date)}</span>
              <span className="min-w-0 flex-1 truncate text-zinc-200">
                {t.name}
                {t.pending && <span className="ml-1.5 text-xs text-amber-400/80">pending</span>}
              </span>
              {t.category && (
                <span className="hidden shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 sm:inline">
                  {prettyCategory(t.category)}
                </span>
              )}
              <span
                className={`w-20 shrink-0 text-right tabular-nums ${
                  t.amount < 0 ? "text-emerald-400" : "text-zinc-100"
                }`}
              >
                {t.amount < 0 ? `+${money(-t.amount)}` : money(t.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Bank() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Bank</h1>
      <SpendingCard />
    </>
  );
}
