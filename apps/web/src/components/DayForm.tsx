import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closeTodo, getDayTransactions } from "../api";
import { money } from "../lib/finance";
import { CompleteButton, useTodosDueOn } from "../lib/todos";
import { DaySchedule } from "./DaySchedule";
import { DayLog } from "./DayLog";

// Todoist todos due on this day — shares the ["todos"] query with the Todos
// page/widget, so nothing extra is fetched to populate this.
function TodosForDay({ date }: { date: string }) {
  const queryClient = useQueryClient();
  const { due, completed } = useTodosDueOn(date);
  const complete = useMutation({
    mutationFn: closeTodo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Todos</span>
      {/* max-h caps long lists when the column is content-sized (mobile). */}
      <div className="max-h-56 min-h-16 flex-1 overflow-y-auto rounded-lg border border-zinc-700 p-2 md:max-h-none">
        {due.length === 0 && completed.length === 0 ? (
          <div className="flex h-full min-h-12 items-center justify-center text-[11px] text-zinc-600">
            None due
          </div>
        ) : (
          <ul className="space-y-1.5">
            {due.map((t) => (
              <li key={t.externalId} className="flex items-center gap-2 text-xs">
                <CompleteButton
                  title={t.title}
                  onComplete={() => complete.mutate(t.externalId)}
                  disabled={complete.isPending}
                />
                <span className="flex-1 truncate text-zinc-200">{t.title}</span>
              </li>
            ))}
            {completed.map((t) => (
              <li key={t.externalId} className="flex items-center gap-2 text-xs">
                <span
                  aria-hidden="true"
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[9px] text-emerald-400"
                >
                  ✓
                </span>
                <span className="flex-1 truncate text-zinc-500 line-through">{t.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Plaid transactions that hit the accounts on this day — read-only, shares the
// ["day-transactions", date] query. Money out (amount > 0) shows plain; money
// in (refunds/income, amount < 0) shows green with a leading +.
function TransactionsForDay({ date }: { date: string }) {
  const q = useQuery({ queryKey: ["day-transactions", date], queryFn: () => getDayTransactions(date) });
  const txs = q.data?.transactions ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        Transactions
      </span>
      <div className="max-h-56 min-h-16 flex-1 overflow-y-auto rounded-lg border border-zinc-700 p-2 md:max-h-none">
        {txs.length === 0 ? (
          <div className="flex h-full min-h-12 items-center justify-center text-[11px] text-zinc-600">
            {q.isPending ? "…" : "None"}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {txs.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-zinc-200">
                  {t.name}
                  {t.pending && <span className="ml-1 text-[10px] text-amber-400/80">pending</span>}
                </span>
                <span
                  className={`shrink-0 tabular-nums ${t.amount < 0 ? "text-emerald-400" : "text-zinc-100"}`}
                >
                  {t.amount < 0 ? `+${money(-t.amount)}` : money(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// The widened-day form. Left column: log + todos + transactions. Right column:
// schedule. On mobile the columns stack (page scrolls) and the schedule gets a
// fixed height so its timeline still scrolls internally.
export function DayForm({ date }: { date: string }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2">
      <div className="flex min-h-0 flex-col gap-2">
        <DayLog date={date} />
        <TodosForDay date={date} />
        <TransactionsForDay date={date} />
      </div>
      <div className="flex h-96 min-h-0 flex-col md:h-auto">
        <DaySchedule date={date} />
      </div>
    </div>
  );
}
