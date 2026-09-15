import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoanInput, LoanMerchant, LoanRow } from "@life/shared";
import { addLoan, assignLoanMerchant, deleteLoan, getLoans, updateLoan } from "../api";
import { Stat } from "../components/Stat";
import { XIcon } from "../components/icons";
import { money } from "../lib/finance";

const fieldClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none";

// Local calendar day - toISOString() alone is UTC, which rolls to "tomorrow"
// every evening ET and would anchor new loans a day in the future.
const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

// "2026-10-01" -> "Oct 1, 2026" (noon keeps the day TZ-stable).
const prettyDate = (d: string | null) =>
  d == null
    ? "—"
    : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

// One small labeled value inside a loan card.
function Field({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate text-sm tabular-nums text-zinc-200">{value}</div>
    </div>
  );
}

function LoanForm({ editing, onDone }: { editing: LoanRow | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [asOfDate, setAsOfDate] = useState(localToday);
  const [interestRate, setInterestRate] = useState("");
  const [minimumPayment, setMinimumPayment] = useState("");
  const [originalPrincipal, setOriginalPrincipal] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [lender, setLender] = useState("");

  useEffect(() => {
    if (!editing) return;
    setName(editing.name);
    setBalance(String(editing.balance));
    setAsOfDate(editing.asOfDate);
    setInterestRate(editing.interestRate != null ? String(editing.interestRate) : "");
    setMinimumPayment(editing.minimumPayment != null ? String(editing.minimumPayment) : "");
    setOriginalPrincipal(editing.originalPrincipal != null ? String(editing.originalPrincipal) : "");
    setDueDay(editing.dueDay != null ? String(editing.dueDay) : "");
    setLender(editing.lender ?? "");
  }, [editing]);

  const save = useMutation({
    mutationFn: async (input: LoanInput) => {
      if (editing) await updateLoan(editing.id, input);
      else await addLoan(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      onDone();
    },
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useMutation({
    mutationFn: () => deleteLoan(editing!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      onDone();
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate({
      name: name.trim(),
      balance: Number(balance),
      asOfDate,
      ...(interestRate !== "" ? { interestRate: Number(interestRate) } : {}),
      ...(minimumPayment !== "" ? { minimumPayment: Number(minimumPayment) } : {}),
      ...(originalPrincipal !== "" ? { originalPrincipal: Number(originalPrincipal) } : {}),
      ...(dueDay !== "" ? { dueDay: Number(dueDay) } : {}),
      ...(lender.trim() ? { lender: lender.trim() } : {}),
    });
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
        {editing ? `Editing: ${editing.name}` : "Add a loan"}
      </h2>
      {!editing && (
        <p className="mt-1 text-xs text-zinc-500">
          Balance + as-of date anchor the tracking: interest accrues daily from that day and
          linked bank payments subtract. Re-save a fresh balance whenever a statement drifts.
        </p>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-zinc-500">Name *</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Smart Option Loan 1"
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Lender</span>
          <input
            type="text"
            value={lender}
            onChange={(e) => setLender(e.target.value)}
            placeholder="e.g. Sallie Mae"
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Remaining balance *</span>
          <input
            type="number"
            required
            min="0"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="e.g. 12345.67"
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Balance as of *</span>
          <input
            type="date"
            required
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Interest rate (APR %)</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.001"
            value={interestRate}
            onChange={(e) => setInterestRate(e.target.value)}
            placeholder="e.g. 5.375"
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Minimum payment (monthly)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={minimumPayment}
            onChange={(e) => setMinimumPayment(e.target.value)}
            placeholder="e.g. 150"
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Payment due day (1–31)</span>
          <input
            type="number"
            min="1"
            max="31"
            step="1"
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            placeholder="e.g. 14"
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Original principal</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={originalPrincipal}
            onChange={(e) => setOriginalPrincipal(e.target.value)}
            placeholder="e.g. 20000"
            className={`${fieldClass} mt-1`}
          />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : editing ? "Save changes" : "Add loan"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Cancel
        </button>
        {save.isError && <span className="text-sm text-red-400">{(save.error as Error).message}</span>}
        {editing && (
          <div className="ml-auto flex items-center gap-2">
            {del.isError && <span className="text-xs text-red-400">{(del.error as Error).message}</span>}
            {confirmDelete ? (
              <>
                <span className="text-xs text-zinc-400">Delete this loan (and its links)?</span>
                <button
                  type="button"
                  onClick={() => del.mutate()}
                  disabled={del.isPending}
                  className="cursor-pointer rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {del.isPending ? "Deleting…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="cursor-pointer rounded-lg border border-red-900/60 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-950/40"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

function LoanCard({ loan, onEdit }: { loan: LoanRow; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const unlink = useMutation({
    mutationFn: (merchantKey: string) => assignLoanMerchant({ loanId: null, merchantKey }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["loans"] }),
  });
  const paidDown =
    loan.originalPrincipal != null && loan.originalPrincipal > 0
      ? Math.max(0, 1 - loan.currentBalance / loan.originalPrincipal)
      : null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-100">{loan.name}</span>
          {loan.lender && <span className="shrink-0 text-xs text-zinc-500">{loan.lender}</span>}
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 text-xs text-zinc-500 hover:text-zinc-200"
          >
            Edit
          </button>
        </div>
        <span
          title={`${money(loan.balance)} entered ${prettyDate(loan.asOfDate)} + ${money(loan.accruedInterest)} accrued interest − linked payments`}
          className="shrink-0 text-lg font-semibold tabular-nums text-zinc-100"
        >
          {money(loan.currentBalance)}
        </span>
      </div>

      {paidDown != null && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${Math.min(100, paidDown * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            {(paidDown * 100).toFixed(0)}% of the original {money(loan.originalPrincipal)} paid down
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
        <Field
          label="Rate"
          value={loan.interestRate != null ? `${loan.interestRate.toFixed(2)}%` : "—"}
        />
        <Field label="Min payment" value={money(loan.minimumPayment)} />
        <Field label="Next due" value={prettyDate(loan.nextDueDate)} />
        <Field
          label="Paid off by"
          title={
            loan.payoffDate
              ? "Estimated: assumes the minimum payment continues monthly at the current rate"
              : "Set a minimum payment (and check it outpaces interest) to project a payoff date"
          }
          value={prettyDate(loan.payoffDate)}
        />
        <Field
          label="Interest to payoff"
          title="Total interest you'll pay from today until the balance clears, at the current rate and minimum payment"
          value={money(loan.projectedInterest)}
        />
      </div>

      {/* Linked merchant streams: every past+future charge from these
          merchants counts as a payment on this loan. */}
      <div className="mt-3 border-t border-zinc-800/60 pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Pays via</span>
          {loan.merchants.length === 0 && (
            <span className="text-xs text-zinc-500">
              no merchant linked yet — link one from the list below
            </span>
          )}
          {loan.merchants.map((m) => (
            <span
              key={m.merchantKey}
              title={`${m.count} charges · ${money(m.total)} all-time`}
              className="flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200"
            >
              {m.name}
              <button
                type="button"
                aria-label={`Unlink ${m.name}`}
                title="Unlink this merchant (removes all its payments from the loan)"
                onClick={() => unlink.mutate(m.merchantKey)}
                disabled={unlink.isPending}
                className="cursor-pointer text-zinc-500 hover:text-red-400 disabled:cursor-not-allowed"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 text-[10px] uppercase tracking-wide text-zinc-500">
          Payments since {prettyDate(loan.asOfDate)} ({loan.payments.length})
        </div>
        {loan.payments.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500">
            No charges from the linked merchants after the anchor date yet.
          </p>
        ) : (
          <ul className="mt-1 max-h-40 overflow-y-auto">
            {loan.payments.map((p, i) => (
              <li
                key={`${p.date}-${p.amount}-${i}`}
                className="flex items-center justify-between gap-2 py-0.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 tabular-nums text-zinc-500">{prettyDate(p.date)}</span>
                  <span className="truncate text-zinc-300">{p.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-zinc-100">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Merchants tagged #student-loan not yet linked to a loan; linking one routes
// its entire charge stream (past + future) to that loan as payments.
function UnlinkedMerchants({
  merchants,
  loans,
}: {
  merchants: LoanMerchant[];
  loans: LoanRow[];
}) {
  const queryClient = useQueryClient();
  const assign = useMutation({
    mutationFn: (v: { loanId: number; merchantKey: string }) => assignLoanMerchant(v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["loans"] }),
  });

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
        Unlinked merchants
      </h2>
      <p className="mt-1 text-xs text-zinc-500">
        Merchants tagged <span className="text-zinc-300">#student-loan</span> with no loan yet.
        Linking one counts <em>all</em> of its charges — past and future — as payments on that
        loan.
      </p>
      {merchants.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Nothing to link — all caught up.</p>
      ) : (
        <ul className="mt-2">
          {merchants.map((m) => (
            <li
              key={m.merchantKey}
              className="flex items-center justify-between gap-2 border-t border-zinc-800/50 py-1.5 text-sm first:border-t-0"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-zinc-200">{m.name}</span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {m.count} charge{m.count === 1 ? "" : "s"}
                  {m.lastDate && ` · last ${money(m.lastAmount)} on ${prettyDate(m.lastDate)}`}
                </span>
              </span>
              <select
                aria-label={`Link ${m.name} to loan`}
                value=""
                disabled={assign.isPending || loans.length === 0}
                onChange={(e) => {
                  const loanId = Number(e.target.value);
                  if (loanId) assign.mutate({ loanId, merchantKey: m.merchantKey });
                }}
                className="shrink-0 cursor-pointer rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none disabled:cursor-not-allowed"
              >
                <option value="">{loans.length === 0 ? "Add a loan first" : "Link to…"}</option>
                {loans.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
      {assign.isError && (
        <p className="mt-2 text-xs text-red-400">{(assign.error as Error).message}</p>
      )}
    </section>
  );
}

export function Loans() {
  const loansQuery = useQuery({ queryKey: ["loans"], queryFn: getLoans });
  const data = loansQuery.data;
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LoanRow | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Loans</h1>
        {!formOpen && !editing && (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="cursor-pointer rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            + Loan
          </button>
        )}
      </div>

      {(formOpen || editing) && (
        <LoanForm
          editing={editing}
          onDone={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      )}

      {loansQuery.isPending && <p className="text-sm text-zinc-500">Loading…</p>}
      {loansQuery.isError && (
        <p className="text-sm text-red-400">{(loansQuery.error as Error).message}</p>
      )}

      {data && data.loans.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Total balance" value={money(data.totals.balance)} />
          <Stat label="Monthly payments" value={money(data.totals.minimumPayment)} />
          <Stat
            label="Next due"
            value={prettyDate(
              data.loans
                .map((l) => l.nextDueDate)
                .filter((d): d is string => d != null)
                .sort()[0] ?? null,
            )}
          />
        </div>
      )}

      {data && data.loans.length === 0 && !formOpen && (
        <p className="text-sm text-zinc-500">No loans yet — add one with the + Loan button.</p>
      )}

      {data?.loans.map((l) => (
        <LoanCard key={l.id} loan={l} onEdit={() => setEditing(l)} />
      ))}

      {data && <UnlinkedMerchants merchants={data.unassigned} loans={data.loans} />}
    </div>
  );
}
