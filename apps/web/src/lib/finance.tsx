import { useRef, useState } from "react";
import type { PortfolioResponse } from "@life/shared";
import { Stat } from "../components/Stat";

// Shared finance formatting, the totals tiles, and the portfolio-value line
// chart — used by the Stocks page, the Finance landing page, and the Home
// portfolio widget so the numbers/charts render identically.

const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

export const money = (n: number | null) => (n == null ? "—" : usd.format(n));
export const pct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
export const gainColor = (n: number | null) =>
  n == null ? "text-zinc-400" : n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-zinc-300";

// Market value / cost basis / total gain / today's gain — the four portfolio
// totals. This is the entire Home finance widget body, and the header of the
// full Finance page.
export function Totals({
  totals,
  gridClassName = "grid-cols-2 sm:grid-cols-4",
}: {
  totals: PortfolioResponse["totals"];
  gridClassName?: string;
}) {
  return (
    <div className={`grid gap-3 ${gridClassName}`}>
      <Stat label="Market value" value={money(totals.marketValue)} />
      <Stat label="Cost basis" value={money(totals.costBasis)} />
      <Stat
        label="Total gain"
        value={`${money(totals.totalGain)} (${pct(totals.totalGainPct)})`}
        tone={gainColor(totals.totalGain)}
      />
      <Stat
        label="Today"
        value={`${money(totals.dayGain)}${totals.dayGainPct != null ? ` (${pct(totals.dayGainPct)})` : ""}`}
        tone={gainColor(totals.dayGain)}
      />
    </div>
  );
}

// ---- Chart primitives shared by the finance SVG charts ----------------------
// Single accent + dark-tuned ink/grid (see the Bank.tsx color system).
export const ACCENT = "#3987e5";
export const GRID = "#2c2c2a";
export const INK_MUTED = "#898781";

export const compact = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`;

export const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export type Tip = { x: number; y: number; lines: [string, string] } | null;

export function TipBox({ tip }: { tip: Tip }) {
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

// Round gridline values for a non-zero-baseline value range.
function rangeTicks(lo: number, hi: number): number[] {
  const span = hi - lo;
  if (span <= 0) return [lo];
  const pow = 10 ** Math.floor(Math.log10(span / 2));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => span / s <= 4) ?? span / 2;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);
  return ticks;
}

// --- Portfolio value over time: single-series line off the daily snapshots. --
// Value trends read against a zoomed (non-zero) baseline; crosshair snaps to
// the nearest day; end dot gets a 2px surface ring.
export function HistoryChart({ history }: { history: PortfolioResponse["history"] }) {
  const [tip, setTip] = useState<Tip>(null);
  const [cross, setCross] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 640;
  const H = 170;
  const PAD_L = 46;
  const PAD_B = 20;
  const PAD_T = 12;
  const plotW = W - PAD_L - 12;
  const plotH = H - PAD_T - PAD_B;

  const values = history.map((h) => h.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.15, max * 0.002, 1);
  const lo = min - pad;
  const hi = max + pad;
  const ticks = rangeTicks(lo, hi);

  const t0 = new Date(`${history[0]!.date}T12:00:00`).getTime();
  const t1 = new Date(`${history[history.length - 1]!.date}T12:00:00`).getTime();
  const x = (d: string) => {
    const t = new Date(`${d}T12:00:00`).getTime();
    return PAD_L + (t1 > t0 ? ((t - t0) / (t1 - t0)) * plotW : plotW / 2);
  };
  const y = (v: number) => PAD_T + plotH * (1 - (v - lo) / (hi - lo));

  const linePath = history.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.date)} ${y(p.value)}`).join(" ");
  const areaPath = `${linePath} L ${x(history[history.length - 1]!.date)} ${PAD_T + plotH} L ${x(history[0]!.date)} ${PAD_T + plotH} Z`;
  const last = history[history.length - 1]!;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const nearest = history.reduce((a, b) => (Math.abs(x(b.date) - px) < Math.abs(x(a.date) - px) ? b : a));
    setCross(x(nearest.date));
    // Backfilled days are daily closes (no wall time); live days show the time
    // the stored value was captured.
    const when = nearest.backfilled
      ? "daily close"
      : nearest.capturedAt
        ? `at ${timeLabel(nearest.capturedAt)}`
        : "";
    setTip({
      x: (x(nearest.date) / W) * rect.width,
      y: (y(nearest.value) / H) * rect.height,
      lines: [money(nearest.value), when ? `${dayLabel(nearest.date)} · ${when}` : dayLabel(nearest.date)],
    });
  }

  // x labels: first, last, and the middle snapshot once there's room.
  const xLabels = [history[0]!, ...(history.length > 4 ? [history[Math.floor(history.length / 2)]!] : []), last];

  return (
    <div className="relative">
      <TipBox tip={tip} />
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full"
        role="img"
        aria-label="Portfolio value over time"
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
        {xLabels.map((p) => (
          <text key={p.date} x={x(p.date)} y={H - 5} textAnchor="middle" fontSize={10} fill={INK_MUTED}>
            {dayLabel(p.date)}
          </text>
        ))}
        {cross != null && <line x1={cross} x2={cross} y1={PAD_T} y2={PAD_T + plotH} stroke={INK_MUTED} strokeWidth={1} />}
        <path d={areaPath} fill={ACCENT} opacity={0.1} />
        <path d={linePath} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.date)} cy={y(last.value)} r={6} fill="#18181b" />
        <circle cx={x(last.date)} cy={y(last.value)} r={4} fill={ACCENT} />
      </svg>
    </div>
  );
}
