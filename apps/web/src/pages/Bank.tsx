import { useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SpendingDashboard } from "@life/shared";
import { getSpending } from "../api";
import { quietBtnClass } from "../lib/controls";
import { money, PlaidLinkStatus } from "../lib/finance";

// Spending dashboard (Plaid). Chart color system: spend is one measure, so
// every chart uses a single accent (slot-1 blue #3987e5, validated ≥3:1 on the
// zinc-900 surface) with zinc de-emphasis gray for context marks — the
// "emphasis" form, never multi-hue. Text stays in text tokens, marks carry the
// color. All values are also reachable without hover: axis ticks, direct
// labels on the selected/extreme marks, and the transaction list as table view.
const ACCENT = "#3987e5";
const ACCENT_DIM = "#3f3f46"; // zinc-700 - de-emphasis bars
const GRID = "#2c2c2a"; // hairline gridlines
const INK_MUTED = "#898781";

// "FOOD_AND_DRINK" -> "Food and drink"
const prettyCategory = (c: string) => {
  const s = c.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const monthLabel = (m: string, style: "long" | "short" = "long") =>
  new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, {
    month: style === "long" ? "long" : "short",
    year: style === "long" ? "numeric" : undefined,
  });

const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Clean y-axis ticks: 0, half, top (top = a round number >= max).
function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const pow = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((t) => t >= max) ?? max;
  return [0, top / 2, top];
}

const compact = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`;

// ---------------------------------------------------------------------------

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function StatTile({ label, value, sub, subColor = "text-zinc-500" }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-100">{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${subColor}`}>{sub}</p>}
    </div>
  );
}

// Shared tooltip: absolutely positioned inside the chart's relative container.
type Tip = { x: number; y: number; lines: [string, string] } | null;

function TipBox({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-950/95 px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: tip.x, top: Math.max(tip.y - 8, 0), transform: "translate(-50%, -100%)" }}
    >
      <div className="font-semibold text-zinc-100">{tip.lines[0]}</div>
      <div className="text-zinc-400">{tip.lines[1]}</div>
    </div>
  );
}

// --- Monthly trend: columns, selected month in accent, others gray. ---------
// Clicking a column selects that month for the whole page (the chart doubles
// as the month filter). Selected column carries a direct label; y ticks carry
// the rest; hover tooltip on every column.
function TrendChart({
  trend,
  selected,
  onSelect,
}: {
  trend: SpendingDashboard["trend"];
  selected: string;
  onSelect: (m: string) => void;
}) {
  const [tip, setTip] = useState<Tip>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 640;
  const H = 170;
  const PAD_L = 42;
  const PAD_B = 22;
  const PAD_T = 18;
  const plotW = W - PAD_L - 8;
  const plotH = H - PAD_T - PAD_B;
  const max = Math.max(...trend.map((t) => t.spend), 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const slot = plotW / Math.max(trend.length, 1);
  const barW = Math.min(24, slot * 0.6);
  const y = (v: number) => PAD_T + plotH * (1 - v / top);

  return (
    <div className="relative">
      <TipBox tip={tip} />
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Monthly spending trend">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - 8} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED}>
              {compact(t)}
            </text>
          </g>
        ))}
        {trend.map((t, i) => {
          const cx = PAD_L + slot * i + slot / 2;
          const h = Math.max((t.spend / top) * plotH, t.spend > 0 ? 2 : 0);
          const isSel = t.month === selected;
          return (
            <g key={t.month} className="cursor-pointer" onClick={() => onSelect(t.month)}>
              {/* hit target: full slot height, wider than the bar */}
              <rect
                x={cx - slot / 2}
                y={PAD_T}
                width={slot}
                height={plotH + PAD_B}
                fill="transparent"
                onPointerMove={() => {
                  const rect = ref.current?.getBoundingClientRect();
                  if (!rect) return;
                  setTip({
                    x: (cx / W) * rect.width,
                    y: (y(t.spend) / H) * rect.height,
                    lines: [money(t.spend), monthLabel(t.month)],
                  });
                }}
                onPointerLeave={() => setTip(null)}
              />
              {/* 4px rounded data-end, square baseline: round top corners only */}
              <path
                d={`M ${cx - barW / 2} ${y(0)}
                    L ${cx - barW / 2} ${y(t.spend) + 4}
                    Q ${cx - barW / 2} ${y(t.spend)} ${cx - barW / 2 + 4} ${y(t.spend)}
                    L ${cx + barW / 2 - 4} ${y(t.spend)}
                    Q ${cx + barW / 2} ${y(t.spend)} ${cx + barW / 2} ${y(t.spend) + 4}
                    L ${cx + barW / 2} ${y(0)} Z`}
                fill={isSel ? ACCENT : ACCENT_DIM}
                style={{ pointerEvents: "none", opacity: h <= 2 ? 0.6 : 1 }}
              />
              {isSel && (
                <text x={cx} y={y(t.spend) - 6} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="#e4e4e7">
                  {compact(t.spend)}
                </text>
              )}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill={isSel ? "#e4e4e7" : INK_MUTED}>
                {monthLabel(t.month, "short")}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// --- Daily cumulative spend: single-series line + 10% area wash. ------------
// Crosshair snaps to the nearest day; single series so no legend needed.
function DailyChart({ daily, month }: { daily: SpendingDashboard["daily"]; month: string }) {
  const [tip, setTip] = useState<Tip>(null);
  const [cross, setCross] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 640;
  const H = 160;
  const PAD_L = 42;
  const PAD_B = 20;
  const PAD_T = 12;
  const plotW = W - PAD_L - 12;
  const plotH = H - PAD_T - PAD_B;

  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const max = Math.max(...daily.map((d) => d.cumulative), 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const x = (day: number) => PAD_L + ((day - 1) / (daysInMonth - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH * (1 - v / top);
  const pts = daily.map((d) => ({ ...d, day: Number(d.date.slice(8, 10)) }));

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.day)} ${y(p.cumulative)}`).join(" ");
  const areaPath = pts.length > 0 ? `${linePath} L ${x(pts[pts.length - 1]!.day)} ${y(0)} L ${x(pts[0]!.day)} ${y(0)} Z` : "";

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (pts.length === 0 || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const nearest = pts.reduce((a, b) => (Math.abs(x(b.day) - px) < Math.abs(x(a.day) - px) ? b : a));
    setCross(x(nearest.day));
    setTip({
      x: (x(nearest.day) / W) * rect.width,
      y: (y(nearest.cumulative) / H) * rect.height,
      lines: [`${money(nearest.cumulative)} total`, `${dayLabel(nearest.date)} · ${money(nearest.spend)} that day`],
    });
  }

  return (
    <div className="relative">
      <TipBox tip={tip} />
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full"
        role="img"
        aria-label="Cumulative spend through the month"
        onPointerMove={onMove}
        onPointerLeave={() => {
          setTip(null);
          setCross(null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - 12} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED}>
              {compact(t)}
            </text>
          </g>
        ))}
        {[1, 10, 20, daysInMonth].map((d) => (
          <text key={d} x={x(d)} y={H - 5} textAnchor="middle" fontSize={10} fill={INK_MUTED}>
            {monthLabel(month, "short")} {d}
          </text>
        ))}
        {cross != null && <line x1={cross} x2={cross} y1={PAD_T} y2={PAD_T + plotH} stroke={INK_MUTED} strokeWidth={1} />}
        {areaPath && <path d={areaPath} fill={ACCENT} opacity={0.1} />}
        {pts.length > 0 && <path d={linePath} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {pts.length > 0 && (
          <g>
            {/* end marker: >=8px dot with 2px surface ring, end-labeled */}
            <circle cx={x(pts[pts.length - 1]!.day)} cy={y(pts[pts.length - 1]!.cumulative)} r={6} fill="#18181b" />
            <circle cx={x(pts[pts.length - 1]!.day)} cy={y(pts[pts.length - 1]!.cumulative)} r={4} fill={ACCENT} />
          </g>
        )}
      </svg>
    </div>
  );
}

// --- Categories: horizontal bars, one hue (magnitude of a single measure). --
function CategoryBars({ categories }: { categories: SpendingDashboard["categories"] }) {
  const shown = categories.filter((c) => c.spend > 0).slice(0, 8);
  const rest = categories.filter((c) => c.spend > 0).slice(8);
  const restTotal = rest.reduce((s, c) => s + c.spend, 0);
  const max = Math.max(...shown.map((c) => c.spend), 1);

  return (
    <ul className="mt-3 space-y-2">
      {shown.map((c) => (
        <li key={c.category} className="group flex items-center gap-3 text-sm" title={`${c.count} transactions`}>
          <span className="w-36 shrink-0 truncate text-zinc-300">{prettyCategory(c.category)}</span>
          <span className="relative h-3.5 min-w-0 flex-1">
            <span
              className="absolute inset-y-0 left-0 rounded-r-[4px] transition-opacity group-hover:opacity-80"
              style={{ width: `${(c.spend / max) * 100}%`, background: ACCENT }}
            />
          </span>
          <span className="w-20 shrink-0 text-right tabular-nums text-zinc-100">{money(c.spend)}</span>
        </li>
      ))}
      {restTotal > 0 && (
        <li className="flex items-center gap-3 text-sm">
          <span className="w-36 shrink-0 text-zinc-500">Other ({rest.length})</span>
          <span className="relative h-3.5 min-w-0 flex-1">
            <span
              className="absolute inset-y-0 left-0 rounded-r-[4px]"
              style={{ width: `${(restTotal / max) * 100}%`, background: ACCENT_DIM }}
            />
          </span>
          <span className="w-20 shrink-0 text-right tabular-nums text-zinc-400">{money(restTotal)}</span>
        </li>
      )}
      {shown.length === 0 && <li className="text-sm text-zinc-500">No spending this month.</li>}
    </ul>
  );
}

// ---------------------------------------------------------------------------

export function Bank() {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const spending = useQuery({
    queryKey: ["spending", month],
    queryFn: () => getSpending(month),
    placeholderData: keepPreviousData, // refetch keeps the frame - no skeleton flash
  });
  const d = spending.data;

  const doordash = useMemo(() => d?.merchants.find((m) => m.name === "DoorDash") ?? null, [d]);

  if (spending.isPending) return <p className="text-zinc-400">Loading…</p>;
  if (spending.isError)
    return <p className="text-red-400">Couldn't load spending — {(spending.error as Error).message}</p>;
  if (!d) return null;

  if (d.transactions.length === 0 && d.months.length === 0) {
    return (
      <>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Bank</h1>
          {/* only once the client keys exist — /plaid-link needs them */}
          {d.configured && <PlaidLinkStatus linked={d.linked} href="/plaid-link" />}
        </div>
        <p className="mt-3 text-sm text-zinc-400">
          {!d.configured
            ? "No bank connected — set PLAID_CLIENT_ID / PLAID_SECRET in .env, then visit /plaid-link."
            : !d.linked
              ? "Plaid keys set — visit /plaid-link to connect your bank."
              : "Bank connected — transactions will appear after the next sync."}
        </p>
      </>
    );
  }

  const idx = d.months.indexOf(d.month);
  const older = d.months[idx + 1]; // months are newest-first
  const newer = d.months[idx - 1];
  const spendDelta = d.summary.prevMonthSpend != null ? d.summary.spend - d.summary.prevMonthSpend : null;
  const net = d.summary.income - d.summary.spend;
  const accountLabel = new Map(d.accounts.map((a) => [a.accountId, a.mask ? `…${a.mask}` : a.name]));

  return (
    <div className="flex flex-col gap-3" style={{ opacity: spending.isFetching ? 0.6 : 1, transition: "opacity 150ms" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Bank</h1>
          <PlaidLinkStatus linked={d.linked} href="/plaid-link" />
        </div>
        {/* month switcher - the filter row; scopes everything below */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => older && setMonth(older)}
            disabled={!older}
            className={`${quietBtnClass} disabled:opacity-30 disabled:hover:bg-transparent`}
            aria-label="Earlier month"
          >
            ←
          </button>
          <span className="w-36 text-center text-sm font-medium text-zinc-100">{monthLabel(d.month)}</span>
          <button
            onClick={() => newer && setMonth(newer)}
            disabled={!newer}
            className={`${quietBtnClass} disabled:opacity-30 disabled:hover:bg-transparent`}
            aria-label="Later month"
          >
            →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Spent"
          value={money(d.summary.spend)}
          sub={
            spendDelta != null
              ? `${spendDelta >= 0 ? "+" : "−"}${money(Math.abs(spendDelta))} vs ${monthLabel(d.months[idx + 1]!, "short")}`
              : d.summary.projected != null
                ? `pace ${money(d.summary.projected)}`
                : undefined
          }
          subColor={spendDelta == null ? "text-zinc-500" : spendDelta > 0 ? "text-red-400" : "text-emerald-400"}
        />
        <StatTile label="Income" value={money(d.summary.income)} />
        <StatTile
          label="Net"
          value={`${net >= 0 ? "+" : "−"}${money(Math.abs(net))}`}
          sub={d.summary.refunds > 0 ? `incl. ${money(d.summary.refunds)} refunds` : undefined}
        />
        <StatTile
          label="DoorDash"
          value={doordash ? money(doordash.spend) : "$0"}
          sub={doordash ? `${doordash.count} order${doordash.count === 1 ? "" : "s"}` : "no orders 🎉"}
        />
      </div>

      <Card title="Monthly trend" right={<span className="text-xs text-zinc-500">click a bar to jump</span>}>
        <TrendChart trend={d.trend} selected={d.month} onSelect={(m) => setMonth(m)} />
      </Card>

      <Card
        title="Through the month"
        right={d.summary.projected != null ? <span className="text-xs text-zinc-500">projected {money(d.summary.projected)}</span> : undefined}
      >
        <DailyChart daily={d.daily} month={d.month} />
      </Card>

      <Card title="By category">
        <CategoryBars categories={d.categories} />
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Accounts">
          <ul className="mt-3 space-y-2.5">
            {d.accounts.map((a) => (
              <li key={a.accountId} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-zinc-200">{a.name}</span>
                  <span className="text-xs text-zinc-500">
                    {a.accountType === "credit" ? "credit" : (a.subtype ?? a.accountType ?? "")}
                    {a.balance != null && ` · bal ${money(a.balance)}`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block tabular-nums text-zinc-100">{money(a.spend)}</span>
                  <span className="text-xs text-zinc-500">{a.count} tx</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Top merchants">
          <ul className="mt-3 space-y-2">
            {d.merchants.slice(0, 8).map((m) => (
              <li key={m.name} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-zinc-200">{m.name}</span>
                <span className="shrink-0 text-xs text-zinc-500">×{m.count}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-zinc-100">{money(m.spend)}</span>
              </li>
            ))}
            {d.merchants.length === 0 && <li className="text-sm text-zinc-500">Nothing this month.</li>}
          </ul>
        </Card>
      </div>

      <Card title="Recurring charges" right={<span className="text-xs text-zinc-500">detected from history</span>}>
        <ul className="mt-3 space-y-2">
          {d.recurring.map((r) => (
            <li key={`${r.name}-${r.frequency}`} className={`flex items-center gap-3 text-sm ${r.active ? "" : "opacity-50"}`}>
              <span className="min-w-0 flex-1 truncate text-zinc-200">{r.name}</span>
              <span className="hidden shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 sm:inline">
                {r.frequency}
              </span>
              <span className="hidden shrink-0 text-xs text-zinc-500 md:inline">
                {r.active ? `next ~${dayLabel(r.nextExpected)}` : `lapsed ${dayLabel(r.lastDate)}`}
              </span>
              <span className="w-20 shrink-0 text-right tabular-nums text-zinc-100">{money(r.avgAmount)}</span>
            </li>
          ))}
          {d.recurring.length === 0 && <li className="text-sm text-zinc-500">None detected yet.</li>}
        </ul>
      </Card>

      <Card title="Transactions" right={<span className="text-xs text-zinc-500">{d.summary.txCount} in {monthLabel(d.month, "short")}</span>}>
        <ul className="mt-3 max-h-96 space-y-1.5 overflow-y-auto pr-1">
          {d.transactions.map((t) => (
            <li key={t.id} className="flex items-center gap-3 text-sm">
              <span className="w-12 shrink-0 text-xs text-zinc-500">{dayLabel(t.date)}</span>
              <span className="min-w-0 flex-1 truncate text-zinc-200">
                {t.name}
                {t.pending && <span className="ml-1.5 text-xs text-amber-400/80">pending</span>}
              </span>
              {t.accountId && (
                <span className="hidden shrink-0 text-xs text-zinc-600 sm:inline">{accountLabel.get(t.accountId)}</span>
              )}
              {t.category && (
                <span className="hidden shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 md:inline">
                  {prettyCategory(t.category).toLowerCase()}
                </span>
              )}
              <span className={`w-20 shrink-0 text-right tabular-nums ${t.amount < 0 ? "text-emerald-400" : "text-zinc-100"}`}>
                {t.amount < 0 ? `+${money(-t.amount)}` : money(t.amount)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
