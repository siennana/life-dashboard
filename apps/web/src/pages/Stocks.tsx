import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { PortfolioResponse, RiskTier } from "@life/shared";
import { getPortfolio, uploadHoldings } from "../api";
import { gainColor, money, pct, Totals } from "../lib/finance";
import { Stat } from "../components/Stat";

// Chart color system matches Bank.tsx: portfolio value / sector value are each
// a single measure, so every chart uses the one accent (slot-1 blue, validated
// >=3:1 on the zinc-900 surface) — the "emphasis" form, never multi-hue. Text
// wears text tokens; marks carry the color. Everything hoverable is also
// readable without hover (axis ticks, direct labels, the positions table).
const ACCENT = "#3987e5";
const GRID = "#2c2c2a";
const INK_MUTED = "#898781";

const qty = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 4 });

const compact = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`;

const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

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
function HistoryChart({ history }: { history: PortfolioResponse["history"] }) {
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

// Categorical slots for the donut (dark steps of the reference palette),
// validated against the zinc-900 surface: lightness band, chroma, ≥3:1
// contrast all pass; adjacent-pair CVD sits in the floor band, mitigated by
// the 2px slice gaps + the value-labeled legend (identity never color-alone).
const DONUT_SLOTS = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767"];
const OTHER_GRAY = "#52525b"; // zinc-600 — the residual "Other" bucket

type Slice = { sector: string; value: number; weightPct: number; positions: number; color: string };

// Top 5 sectors get palette slots in value order; everything after them (and
// any natural "Other" bucket) folds into one gray residual slice.
function buildSlices(sectors: PortfolioResponse["sectors"]): Slice[] {
  const named = sectors.filter((s) => s.sector !== "Other");
  const head = named.slice(0, 5);
  const tail = [...named.slice(5), ...sectors.filter((s) => s.sector === "Other")];
  const slices: Slice[] = head.map((s, i) => ({ ...s, color: DONUT_SLOTS[i]! }));
  if (tail.length > 0) {
    slices.push({
      sector: "Other",
      value: tail.reduce((a, s) => a + s.value, 0),
      weightPct: tail.reduce((a, s) => a + s.weightPct, 0),
      positions: tail.reduce((a, s) => a + s.positions, 0),
      color: OTHER_GRAY,
    });
  }
  return slices;
}

// --- Allocation by sector: donut (part-to-whole), total in the hole. --------
function SectorDonut({ sectors }: { sectors: PortfolioResponse["sectors"] }) {
  const [tip, setTip] = useState<Tip>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const slices = buildSlices(sectors);
  if (slices.length === 0) return <p className="mt-3 text-sm text-zinc-500">No priced holdings yet.</p>;

  const S = 168;
  const C = S / 2;
  const R = 60;
  const STROKE = 26;
  const total = slices.reduce((a, s) => a + s.value, 0);
  const totalWeight = slices.reduce((a, s) => a + s.weightPct, 0);
  const GAP = 2 / R; // 2px surface gap between slices, as an angle at mid-radius

  const arc = (a0: number, a1: number) => {
    const x = (a: number) => C + R * Math.cos(a);
    const y = (a: number) => C + R * Math.sin(a);
    return `M ${x(a0)} ${y(a0)} A ${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x(a1)} ${y(a1)}`;
  };

  let angle = -Math.PI / 2; // start at 12 o'clock, clockwise
  const paths = slices.map((s) => {
    const sweep = (s.weightPct / totalWeight) * Math.PI * 2;
    const a0 = angle + GAP / 2;
    const a1 = Math.max(angle + sweep - GAP / 2, a0 + 0.02);
    angle += sweep;
    return { slice: s, d: arc(a0, a1) };
  });

  function showTip(e: React.PointerEvent, s: Slice) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      lines: [s.sector, `${money(s.value)} · ${s.weightPct.toFixed(1)}%`],
    });
  }

  return (
    <div ref={boxRef} className="relative mt-3 flex flex-col items-center gap-4">
      <TipBox tip={tip} />
      <svg viewBox={`0 0 ${S} ${S}`} className="h-44 w-44" role="img" aria-label="Sector allocation">
        {slices.length === 1 ? (
          <circle cx={C} cy={C} r={R} fill="none" stroke={paths[0]!.slice.color} strokeWidth={STROKE} />
        ) : (
          paths.map((p) => (
            <path
              key={p.slice.sector}
              d={p.d}
              fill="none"
              stroke={p.slice.color}
              strokeWidth={STROKE}
              className="transition-opacity hover:opacity-80"
              onPointerMove={(e) => showTip(e, p.slice)}
              onPointerLeave={() => setTip(null)}
            />
          ))
        )}
        <text x={C} y={C - 2} textAnchor="middle" fontSize={17} fontWeight={600} fill="#f4f4f5">
          {compact(total)}
        </text>
        <text x={C} y={C + 14} textAnchor="middle" fontSize={9} fill={INK_MUTED}>
          priced value
        </text>
      </svg>
      {/* legend doubles as the no-hover value channel */}
      <ul className="w-full space-y-1.5 text-sm">
        {slices.map((s) => (
          <li
            key={s.sector}
            className="flex items-center gap-2.5"
            title={`${s.positions} position${s.positions === 1 ? "" : "s"}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-zinc-300">{s.sector}</span>
            <span className="w-12 shrink-0 text-right tabular-nums text-zinc-400">
              {s.weightPct.toFixed(s.weightPct < 10 ? 1 : 0)}%
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums text-zinc-100">{money(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Allocation by sector: horizontal bars, one hue (single measure). -------
function SectorBars({ sectors }: { sectors: PortfolioResponse["sectors"] }) {
  const max = Math.max(...sectors.map((s) => s.weightPct), 1);
  return (
    <ul className="mt-3 space-y-2">
      {sectors.map((s) => (
        <li
          key={s.sector}
          className="group flex items-center gap-3 text-sm"
          title={`${s.positions} position${s.positions === 1 ? "" : "s"}`}
        >
          <span className="w-36 shrink-0 truncate text-zinc-300">{s.sector}</span>
          <span className="relative h-3.5 min-w-0 flex-1">
            <span
              className="absolute inset-y-0 left-0 rounded-r-[4px] transition-opacity group-hover:opacity-80"
              style={{ width: `${(s.weightPct / max) * 100}%`, background: ACCENT }}
            />
          </span>
          <span className="w-12 shrink-0 text-right tabular-nums text-zinc-400">
            {s.weightPct.toFixed(s.weightPct < 10 ? 1 : 0)}%
          </span>
          <span className="w-20 shrink-0 text-right tabular-nums text-zinc-100">{money(s.value)}</span>
        </li>
      ))}
      {sectors.length === 0 && <li className="text-sm text-zinc-500">No priced holdings yet.</li>}
    </ul>
  );
}

// Bars (compare magnitudes) or donut (part-to-whole) — same data, remembered
// choice. The toggle doesn't mutate anything, so it keeps the default cursor.
function SectorCard({ sectors }: { sectors: PortfolioResponse["sectors"] }) {
  const [view, setView] = useState<"bars" | "donut">(() =>
    localStorage.getItem("stocks.sectorView") === "donut" ? "donut" : "bars",
  );
  const select = (v: "bars" | "donut") => {
    setView(v);
    localStorage.setItem("stocks.sectorView", v);
  };
  return (
    <Card
      title="By sector"
      right={
        <div className="flex rounded-lg bg-zinc-800/60 p-0.5 text-xs">
          {(["bars", "donut"] as const).map((v) => (
            <button
              key={v}
              onClick={() => select(v)}
              aria-pressed={view === v}
              className={`rounded-md px-2 py-0.5 capitalize ${
                view === v ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      }
    >
      {view === "bars" ? <SectorBars sectors={sectors} /> : <SectorDonut sectors={sectors} />}
    </Card>
  );
}

// Where the live price sits in the 52-week range: a tick on a track.
function RangeIndicator({ p }: { p: PortfolioResponse["positions"][number] }) {
  if (p.fiftyTwoWeekPct == null) return <span className="text-zinc-500">—</span>;
  return (
    <span
      title={`52-week range ${money(p.fiftyTwoWeekLow)} – ${money(p.fiftyTwoWeekHigh)}`}
      className="relative inline-block h-1.5 w-14 rounded-full bg-zinc-700 align-middle"
    >
      <span
        className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 -translate-x-1/2 rounded-full bg-zinc-200"
        style={{ left: `${p.fiftyTwoWeekPct}%` }}
      />
    </span>
  );
}

function RiskCard({ risk }: { risk: PortfolioResponse["risk"] }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
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

// Just the browse control (no panel) — lives next to the page title. A hidden
// native file input triggered by a styled button; import feedback drops in as
// a small note beneath it rather than a whole card.
function UploadButton() {
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
    <div className="relative">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onFile}
        disabled={upload.isPending}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
        className="cursor-pointer rounded-lg bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-100 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {upload.isPending ? "Importing…" : "Upload CSV"}
      </button>
      {note && !upload.isPending && (
        <p
          className={`absolute left-0 top-full z-10 mt-1 whitespace-nowrap text-xs ${
            upload.isError ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {note}
        </p>
      )}
    </div>
  );
}

function PositionsTable({ positions }: { positions: PortfolioResponse["positions"] }) {
  return (
    <div className="max-h-96 overflow-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        {/* sticky header inside the scroll container; shadow stands in for the
            border-b, which wouldn't stick with the row */}
        <thead className="sticky top-0 z-10 bg-zinc-900 shadow-[0_1px_0_0_#27272a]">
          <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <th className="px-3 py-3 font-medium">Symbol</th>
            <th className="px-3 py-3 text-right font-medium">Qty</th>
            <th className="px-3 py-3 text-right font-medium">Price</th>
            <th className="px-3 py-3 text-right font-medium">Today</th>
            <th className="px-3 py-3 text-right font-medium">Value</th>
            <th className="px-3 py-3 text-right font-medium" title="Share of total market value">
              Alloc
            </th>
            <th className="px-3 py-3 text-right font-medium">Cost basis</th>
            <th className="px-3 py-3 text-right font-medium">Total gain</th>
            <th className="px-3 py-3 text-right font-medium" title="Dividend yield">
              Yield
            </th>
            <th className="px-3 py-3 text-right font-medium" title="Price within the 52-week range">
              52w
            </th>
            <th className="px-3 py-3 text-right font-medium">Risk</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.symbol} className="border-b border-zinc-800/50 last:border-0">
              <td className="px-3 py-3">
                <div className="font-medium text-zinc-100">{p.symbol}</div>
                {p.description && (
                  <div className="max-w-[13rem] truncate text-xs text-zinc-500">{p.description}</div>
                )}
                {p.sector && <div className="text-xs text-zinc-600">{p.sector}</div>}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-zinc-300">{qty(p.quantity)}</td>
              <td className="px-3 py-3 text-right tabular-nums text-zinc-300">{money(p.price)}</td>
              <td className={`px-3 py-3 text-right tabular-nums ${gainColor(p.dayGain ?? p.dayChangePct)}`}>
                {money(p.dayGain)}
                <span className="ml-1 text-xs">({pct(p.dayChangePct)})</span>
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-zinc-100">{money(p.marketValue)}</td>
              <td className="px-3 py-3 text-right tabular-nums text-zinc-300">
                {p.weightPct == null ? "—" : `${p.weightPct.toFixed(p.weightPct < 10 ? 1 : 0)}%`}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-zinc-300">{money(p.costBasis)}</td>
              <td className={`px-3 py-3 text-right tabular-nums ${gainColor(p.totalGain)}`}>
                {money(p.totalGain)}
                <span className="ml-1 text-xs">({pct(p.totalGainPct)})</span>
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-zinc-300">
                {p.dividendYieldPct == null ? "—" : `${p.dividendYieldPct.toFixed(2)}%`}
              </td>
              <td className="px-3 py-3 text-right">
                <RangeIndicator p={p} />
              </td>
              <td className="px-3 py-3 text-right">
                <RiskBadge tier={p.riskTier} beta={p.beta} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Stocks() {
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: getPortfolio });
  const positions = portfolio.data?.positions ?? [];
  const history = portfolio.data?.history ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Stocks</h1>
          <UploadButton />
        </div>
        {(portfolio.data?.holdingsAsOf || portfolio.data?.pricedAt) && (
          <span className="text-xs text-zinc-500">
            {portfolio.data.holdingsAsOf &&
              `Portfolio last updated ${new Date(portfolio.data.holdingsAsOf).toLocaleDateString(
                undefined,
                { month: "short", day: "numeric", year: "numeric" },
              )}`}
            {portfolio.data.holdingsAsOf && portfolio.data.pricedAt && " · "}
            {portfolio.data.pricedAt &&
              `priced ${new Date(portfolio.data.pricedAt).toLocaleTimeString()}`}
          </span>
        )}
      </div>

      {portfolio.data && !portfolio.data.quotesConfigured && positions.length > 0 && (
        <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-sm text-amber-300">
          Live prices are off — set <code>FINNHUB_API_KEY</code> in <code>.env</code> to see current
          value and today's change.
        </p>
      )}

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

          <Card
            title="Portfolio value"
            right={
              history.length > 0 ? (
                <span className="text-xs text-zinc-500">daily since {dayLabel(history[0]!.date)}</span>
              ) : undefined
            }
          >
            {history.length >= 2 ? (
              <HistoryChart history={history} />
            ) : (
              <p className="mt-3 text-sm text-zinc-500">
                A value snapshot is recorded once a day — the trend line appears after a few days of
                data{history.length === 1 ? ` (tracking since ${dayLabel(history[0]!.date)})` : ""}.
              </p>
            )}
          </Card>

          <PositionsTable positions={positions} />

          <div className="grid gap-3 lg:grid-cols-2">
            <SectorCard sectors={portfolio.data.sectors} />
            <RiskCard risk={portfolio.data.risk} />
          </div>
        </>
      )}
    </div>
  );
}
