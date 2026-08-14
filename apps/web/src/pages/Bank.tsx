import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConfirmedRecurring,
  RecurringSection,
  SpendingDashboard,
  SpendingTransaction,
  Tag,
  TaggedMerchant,
} from "@life/shared";
import {
  deleteRecurringSeries,
  getSpending,
  setRecurringSeries,
  toggleTagMerchant,
  updateRecurringExpiration,
} from "../api";
import {
  CheckIcon,
  ChevronRightIcon,
  FunnelIcon,
  HashtagIcon,
  PlusIcon,
  WarningIcon,
  XIcon,
} from "../components/icons";
import { quietBtnClass } from "../lib/controls";
import { money, PlaidLinkStatus } from "../lib/finance";
import { TAG_DOT_CLASSES, TAG_HEX, TAG_TEXT_CLASSES, TagPill, useTags } from "../lib/tags";

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

// Track an element's rendered width so charts can use real pixels as their
// viewBox width — fixed viewBox charts scale their text down with the card
// (unreadable at half width in the side-by-side layout). 1 unit = 1 CSS px.
// Callback-ref based so it also works for charts that mount conditionally
// (Tag trend renders only once tags are picked — a mount-time effect never
// saw its element and left the chart scaled up huge).
function useMeasuredWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { ref: setEl, width };
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
  const { ref: boxRef, width: measured } = useMeasuredWidth<HTMLDivElement>();
  const W = Math.max(measured, 280);
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
    <div ref={boxRef} className="relative">
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
  const { ref: boxRef, width: measured } = useMeasuredWidth<HTMLDivElement>();
  const W = Math.max(measured, 280);
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
    <div ref={boxRef} className="relative">
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
        {/* Last label is end-anchored: centered on the final day it would
            straddle the viewBox edge and clip its trailing digit ("Aug 3"). */}
        {[1, 10, 20, daysInMonth].map((d) => (
          <text
            key={d}
            x={x(d)}
            y={H - 5}
            textAnchor={d === daysInMonth ? "end" : "middle"}
            fontSize={10}
            fill={INK_MUTED}
          >
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

// --- Tag trend: stacked monthly bars for hand-picked tags. ------------------
// Each monitored tag is one stacked segment in its own tag color (categorical
// series with user-assigned hues — the one chart here that's legitimately
// multi-hue). Selection starts empty and persists per machine.
const MONITORED_TAGS_KEY = "bank.monitoredTags";

function readMonitoredTags(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MONITORED_TAGS_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

function TagTrendCard({ d }: { d: SpendingDashboard }) {
  const tagsQuery = useTags();
  const allTags = tagsQuery.data?.tags ?? [];
  const [monitored, setMonitored] = useState<number[]>(readMonitoredTags);
  const [open, setOpen] = useState(false);
  // Two containers, two refs: the filter dropdown (outside-click closing)
  // and the chart box (tooltip coordinate space) — sharing one ref made
  // every dropdown click read as "outside" and close the menu.
  const filterRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const { ref: chartRef, width: measured } = useMeasuredWidth<HTMLDivElement>();

  useEffect(() => {
    localStorage.setItem(MONITORED_TAGS_KEY, JSON.stringify(monitored));
  }, [monitored]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (filterRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const toggle = (id: number) =>
    setMonitored((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Tag order follows the tag list (alphabetical) so stack order is stable.
  const series = allTags.filter((t) => monitored.includes(t.id));
  const sumsFor = (m: SpendingDashboard["trend"][number]) =>
    series.map((tag) => ({
      tag,
      // Negative (net-refund) months render as no segment; tooltip is exact.
      value: m.tagSpend.find((s) => s.tagId === tag.id)?.spend ?? 0,
    }));

  const W = Math.max(measured, 280);
  const H = 170;
  const PAD_L = 42;
  const PAD_B = 22;
  const PAD_T = 12;
  const plotW = W - PAD_L - 8;
  const plotH = H - PAD_T - PAD_B;
  // Grouped (side-by-side) bars, so the scale is the largest single tag-month.
  const max = Math.max(...d.trend.flatMap((m) => sumsFor(m).map((x) => Math.max(x.value, 0))), 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const slot = plotW / Math.max(d.trend.length, 1);
  // Each month's group splits the slot between the monitored tags.
  const groupW = Math.min(slot * 0.8, series.length * 14);
  const eachW = groupW / Math.max(series.length, 1);
  const barW = Math.max(eachW - 2, 2);

  function showTip(e: React.PointerEvent, lines: [string, string]) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top - 6, lines });
  }

  return (
    <Card
      title="Tag trend"
      right={
        <div ref={filterRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Choose monitored tags"
            aria-expanded={open}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <FunnelIcon className="h-3.5 w-3.5" />
            Filter
            {monitored.length > 0 && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
            )}
          </button>
          {open && (
            <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-zinc-700 bg-zinc-800 p-2 shadow-xl">
              <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Monitored tags
              </div>
              <div className="mt-1 max-h-56 overflow-y-auto">
                {allTags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-zinc-700/50"
                  >
                    <input
                      type="checkbox"
                      checked={monitored.includes(tag.id)}
                      onChange={() => toggle(tag.id)}
                      className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-zinc-600 bg-zinc-900 text-blue-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className={`h-2 w-2 shrink-0 rounded-full ${TAG_DOT_CLASSES[tag.color]}`} />
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{tag.name}</span>
                  </label>
                ))}
                {allTags.length === 0 && (
                  <p className="px-1 py-1 text-xs text-zinc-500">No tags yet — Edit Tags in the sidebar.</p>
                )}
              </div>
            </div>
          )}
        </div>
      }
    >
      {series.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          Nothing monitored yet — pick tags with the Filter button to chart their monthly spend.
        </p>
      ) : (
        <>
          <div ref={boxRef} className="relative">
            <TipBox tip={tip} />
            <div ref={chartRef}>
              <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Monthly spend per monitored tag">
                {ticks.map((t) => {
                  const y = PAD_T + plotH * (1 - t / top);
                  return (
                    <g key={t}>
                      <line x1={PAD_L} x2={W - 8} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
                      <text x={PAD_L - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED}>
                        {compact(t)}
                      </text>
                    </g>
                  );
                })}
                {d.trend.map((m, i) => {
                  const cx = PAD_L + slot * i + slot / 2;
                  return (
                    <g key={m.month}>
                      {sumsFor(m).map(({ tag, value }, idx) => {
                        const h = (Math.max(value, 0) / top) * plotH;
                        if (h <= 0) return null;
                        const x = cx - groupW / 2 + idx * eachW + (eachW - barW) / 2;
                        return (
                          <rect
                            key={tag.id}
                            x={x}
                            y={PAD_T + plotH - h}
                            width={barW}
                            height={h}
                            rx={1.5}
                            fill={TAG_HEX[tag.color]}
                            onPointerMove={(e) =>
                              showTip(e, [money(value), `#${tag.name} · ${monthLabel(m.month)}`])
                            }
                            onPointerLeave={() => setTip(null)}
                          />
                        );
                      })}
                      <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill={INK_MUTED}>
                        {monthLabel(m.month, "short")}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
          {/* Legend — multi-hue chart, so every series is named. */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
            {series.map((tag) => (
              <span key={tag.id} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${TAG_DOT_CLASSES[tag.color]}`} />
                {tag.name}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// --- Categories: horizontal bars, one hue (magnitude of a single measure). --
// The card's funnel dropdown hides categories (a dominating one like loan
// payments flattens everything else); exclusions persist in localStorage and
// affect only this widget — the stat tiles keep the full totals.
const HIDDEN_CATS_KEY = "bank.hiddenCategories";

function readHiddenCats(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_CATS_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function CategoryCard({
  categories,
  transactions,
  tagged,
}: {
  categories: SpendingDashboard["categories"];
  transactions: SpendingTransaction[];
  tagged: TaggedMerchant[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(readHiddenCats);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(HIDDEN_CATS_KEY, JSON.stringify([...hidden]));
  }, [hidden]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const toggle = (category: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const all = categories.filter((c) => c.spend > 0);
  const visible = all.filter((c) => !hidden.has(c.category));

  return (
    <Card
      title="By category"
      right={
        <div ref={boxRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Filter categories"
            aria-expanded={open}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <FunnelIcon className="h-3.5 w-3.5" />
            Filter
            {hidden.size > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
          </button>
          {open && (
            <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-lg border border-zinc-700 bg-zinc-800 p-2 shadow-xl">
              <div className="flex items-center justify-between px-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                <span>Categories</span>
                {hidden.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setHidden(new Set())}
                    className="cursor-pointer font-normal normal-case text-zinc-400 underline decoration-zinc-600 hover:text-zinc-200"
                  >
                    show all
                  </button>
                )}
              </div>
              <div className="mt-1 max-h-56 overflow-y-auto">
                {all.map((c) => (
                  <label
                    key={c.category}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-zinc-700/50"
                  >
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.category)}
                      onChange={() => toggle(c.category)}
                      className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-zinc-600 bg-zinc-900 text-blue-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                      {prettyCategory(c.category)}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                      {money(c.spend)}
                    </span>
                  </label>
                ))}
                {all.length === 0 && (
                  <p className="px-1 py-1 text-xs text-zinc-500">Nothing this month.</p>
                )}
              </div>
            </div>
          )}
        </div>
      }
    >
      <CategoryBars categories={visible} transactions={transactions} tagged={tagged} />
      {hidden.size > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          {hidden.size} categor{hidden.size === 1 ? "y" : "ies"} hidden
        </p>
      )}
    </Card>
  );
}

function CategoryBars({
  categories,
  transactions,
  tagged,
}: {
  categories: SpendingDashboard["categories"];
  transactions: SpendingTransaction[];
  tagged: TaggedMerchant[];
}) {
  const taggedByKey = useMemo(() => new Map(tagged.map((m) => [m.merchantKey, m])), [tagged]);

  // Right-click tag menu on the dropdown's transaction rows — same pattern as
  // the transaction/recurring grids, tags-only.
  const [menu, setMenu] = useState<{ merchant: string; merchantKey: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  function openTagMenu(e: React.MouseEvent, merchant: string, merchantKey: string) {
    e.preventDefault();
    const MENU_W = 208; // w-52
    setMenu({
      merchant,
      merchantKey,
      x: Math.min(e.clientX, window.innerWidth - MENU_W - 8),
      y: Math.min(e.clientY, window.innerHeight - 280),
    });
  }

  const shown = categories.filter((c) => c.spend > 0).slice(0, 8);
  const rest = categories.filter((c) => c.spend > 0).slice(8);
  const restTotal = rest.reduce((s, c) => s + c.spend, 0);
  const max = Math.max(...shown.map((c) => c.spend), 1);

  // Expanded rows (Tags-card pattern); "Other" expands under its own key.
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const toggleOpen = (key: string) =>
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // The month's transactions in the given categories, newest first (the
  // source list is already sorted). Matches on the raw category key; can show
  // a hair more than the bar's count for categories where some entries are
  // classified non-spend (e.g. card payments under Loan payments).
  const txsFor = (keys: Set<string>) => transactions.filter((t) => t.category != null && keys.has(t.category));

  const txRows = (keys: Set<string>) => (
    <ul className="mt-1 mb-1 ml-1 max-h-48 space-y-0.5 overflow-y-auto border-l border-zinc-700/60 pl-2.5">
      {txsFor(keys).map((t) => (
        <li
          key={t.id}
          onContextMenu={(e) => openTagMenu(e, t.name, t.merchantKey)}
          className={`flex items-center gap-3 rounded py-0.5 text-sm ${menu?.merchantKey === t.merchantKey ? "bg-zinc-800/40" : ""}`}
        >
          <span className="w-12 shrink-0 text-xs text-zinc-500">{dayLabel(t.date)}</span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 truncate text-zinc-300">{t.name}</span>
            {(taggedByKey.get(t.merchantKey)?.tags ?? []).map((tag) => (
              <TagPill key={tag.id} tag={tag} />
            ))}
          </span>
          <span
            className={`shrink-0 text-right tabular-nums ${t.amount < 0 ? "text-emerald-400" : "text-zinc-100"}`}
          >
            {t.amount < 0 ? `+${money(-t.amount)}` : money(t.amount)}
          </span>
        </li>
      ))}
      {txsFor(keys).length === 0 && (
        <li className="py-0.5 text-xs text-zinc-500">No transactions this month.</li>
      )}
    </ul>
  );

  const chevron = (open: boolean) => (
    <ChevronRightIcon
      className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    />
  );

  return (
    <>
    <ul className="mt-3 space-y-1">
      {shown.map((c) => {
        const open = openCats.has(c.category);
        return (
          <li key={c.category}>
            <button
              type="button"
              onClick={() => toggleOpen(c.category)}
              aria-expanded={open}
              title={`${prettyCategory(c.category)} · ${c.count} transaction${c.count === 1 ? "" : "s"}`}
              className="group flex w-full items-center gap-3 rounded py-0.5 text-left text-sm hover:bg-zinc-800/40"
            >
              <span className="flex w-36 shrink-0 items-center gap-1">
                {chevron(open)}
                <span className="min-w-0 truncate text-zinc-300">{prettyCategory(c.category)}</span>
              </span>
              <span className="relative h-3.5 min-w-0 flex-1">
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[4px] transition-opacity group-hover:opacity-80"
                  style={{ width: `${(c.spend / max) * 100}%`, background: ACCENT }}
                />
              </span>
              <span className="w-20 shrink-0 text-right tabular-nums text-zinc-100">{money(c.spend)}</span>
            </button>
            {open && txRows(new Set([c.category]))}
          </li>
        );
      })}
      {restTotal > 0 && (
        <li>
          <button
            type="button"
            onClick={() => toggleOpen("__other")}
            aria-expanded={openCats.has("__other")}
            title={`${rest.map((c) => prettyCategory(c.category)).join(", ")} · ${rest.reduce((s, c) => s + c.count, 0)} transactions`}
            className="flex w-full items-center gap-3 rounded py-0.5 text-left text-sm hover:bg-zinc-800/40"
          >
            <span className="flex w-36 shrink-0 items-center gap-1">
              {chevron(openCats.has("__other"))}
              <span className="min-w-0 truncate text-zinc-500">Other ({rest.length})</span>
            </span>
            <span className="relative h-3.5 min-w-0 flex-1">
              <span
                className="absolute inset-y-0 left-0 rounded-r-[4px]"
                style={{ width: `${(restTotal / max) * 100}%`, background: ACCENT_DIM }}
              />
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums text-zinc-400">{money(restTotal)}</span>
          </button>
          {openCats.has("__other") && txRows(new Set(rest.map((c) => c.category)))}
        </li>
      )}
      {shown.length === 0 && <li className="text-sm text-zinc-500">No spending this month.</li>}
    </ul>
    {menu && (
      <div
        ref={menuRef}
        style={{ left: menu.x, top: menu.y }}
        className="fixed z-40 w-52 rounded-lg border border-zinc-700 bg-zinc-800 p-1 shadow-xl"
      >
        <div className="truncate px-2 pt-1 text-xs font-medium text-zinc-300">{menu.merchant}</div>
        <TagMenuSection
          merchant={menu.merchant}
          merchantKey={menu.merchantKey}
          taggedByKey={taggedByKey}
        />
      </div>
    )}
    </>
  );
}

// ---------------------------------------------------------------------------

// Recurring charges: fresh detections (Suggested) vs series Sienna has
// confirmed as truly recurring (Confirmed) — confirming stores a durable
// merchant+amount+cadence pattern the API re-matches against history each
// request. Totals cover active confirmed series only; "Annual" is
// annual-billed charges alone, "Total" annualizes every cadence.
function RecurringTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 p-3">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-100">{value}</p>
      <p className="text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

// The confirm/dismiss/un-confirm mutations + invalidation, shared by the
// recurring widget and the transaction row menus. Everything recurring-shaped
// rides in the spending response; cashflow + day lists carry matched flags.
function useRecurringMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["spending"] });
    queryClient.invalidateQueries({ queryKey: ["cashflow"] });
    queryClient.invalidateQueries({ queryKey: ["day-transactions"] });
  };
  const setSeries = useMutation({ mutationFn: setRecurringSeries, onSuccess: invalidate });
  const removeSeries = useMutation({ mutationFn: deleteRecurringSeries, onSuccess: invalidate });
  const setExpiration = useMutation({
    mutationFn: ({ id, expiresOn }: { id: number; expiresOn: string | null }) =>
      updateRecurringExpiration(id, expiresOn),
    onSuccess: invalidate,
  });
  return {
    setSeries,
    removeSeries,
    setExpiration,
    busy: setSeries.isPending || removeSeries.isPending || setExpiration.isPending,
    error: setSeries.error ?? removeSeries.error ?? setExpiration.error,
  };
}

// Recurring rows: merchant | tags | cadence (sm+) | next (md+) | amount |
// actions. Confirmed rows add an editable expires column (sm+). Hidden cells
// and the responsive templates must move together — grid auto-placement skips
// display:none cells.
const REC_GRID =
  "grid grid-cols-[minmax(0,1fr)_3rem_5rem_4rem] gap-x-3 sm:grid-cols-[minmax(0,1fr)_3rem_5.5rem_5rem_4rem] md:grid-cols-[minmax(0,1fr)_3rem_5.5rem_7.5rem_5rem_4rem]";
const REC_GRID_CONFIRMED =
  "grid grid-cols-[minmax(0,1fr)_3rem_5rem_4rem] gap-x-3 sm:grid-cols-[minmax(0,1fr)_3rem_5.5rem_6.5rem_5rem_4rem] md:grid-cols-[minmax(0,1fr)_3rem_5.5rem_7.5rem_6.5rem_5rem_4rem]";

// Compact tag marks for grid tag columns: one hashtag glyph per tag in the
// tag's color, full name in the tooltip.
function TagMarks({ tags }: { tags: Tag[] }) {
  return (
    <span className="flex items-center gap-0.5 overflow-hidden">
      {tags.map((t) => (
        <span key={t.id} title={`#${t.name}`} className={`shrink-0 ${TAG_TEXT_CLASSES[t.color]}`}>
          <HashtagIcon className="h-3 w-3" />
        </span>
      ))}
    </span>
  );
}

// The Tags block of a merchant context menu: checkbox per tag, checking
// applies the tag to the merchant (rule — every past+future charge). Shared
// by the transaction and recurring row menus.
function TagMenuSection({
  merchant,
  merchantKey,
  taggedByKey,
}: {
  merchant: string;
  merchantKey: string;
  taggedByKey: Map<string, TaggedMerchant>;
}) {
  const tagsQuery = useTags();
  const queryClient = useQueryClient();
  const toggleTag = useMutation({
    mutationFn: (tagId: number) => toggleTagMerchant(tagId, merchant),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["spending"] }),
  });

  return (
    <>
      <div className="mt-1 border-t border-zinc-700/60 px-2 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        Tags
      </div>
      <div className="max-h-48 overflow-y-auto">
        {(tagsQuery.data?.tags ?? []).map((tag) => {
          const applied = taggedByKey.get(merchantKey)?.tags.some((x) => x.id === tag.id) ?? false;
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag.mutate(tag.id)}
              disabled={toggleTag.isPending}
              className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <input
                type="checkbox"
                checked={applied}
                readOnly
                tabIndex={-1}
                className="pointer-events-none h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-900 text-blue-500 focus:ring-0"
              />
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${TAG_DOT_CLASSES[tag.color]}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
            </button>
          );
        })}
        {tagsQuery.isSuccess && (tagsQuery.data?.tags.length ?? 0) === 0 && (
          <p className="px-2 py-1.5 text-xs text-zinc-500">
            No tags yet — Edit Tags in the sidebar.
          </p>
        )}
      </div>
    </>
  );
}

const ICON_BTN =
  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-40";

// Section title doubling as the grid's column-header row.
function RecHeader({
  title,
  note,
  grid,
  withExpires = false,
}: {
  title: string;
  note?: string;
  grid: string;
  withExpires?: boolean;
}) {
  return (
    <div className={`${grid} mt-4 items-center text-[10px] font-medium uppercase tracking-wide text-zinc-500`}>
      <span>
        {title}
        {note && <span className="ml-1.5 font-normal normal-case text-zinc-600">{note}</span>}
      </span>
      <span>tags</span>
      <span className="hidden sm:block">cadence</span>
      <span className="hidden md:block">next</span>
      {withExpires && <span className="hidden sm:block">expires</span>}
      <span className="text-right">amount</span>
      <span />
    </div>
  );
}

// "Aug 3, 27" — expiration labels carry the year (unlike dayLabel's chips).
const expLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });

function RecurringCard({ rec, tagged }: { rec: RecurringSection; tagged: TaggedMerchant[] }) {
  const { setSeries, removeSeries, setExpiration, busy, error } = useRecurringMutations();
  const plural = (n: number) => (n === 1 ? "" : "s");
  const t = rec.totals;

  const taggedByKey = useMemo(() => new Map(tagged.map((m) => [m.merchantKey, m])), [tagged]);

  // Right-click tag menu on recurring rows — same fixed-position pattern as
  // the transaction grid, tags-only (recurring state has its own buttons).
  const [menu, setMenu] = useState<{ merchant: string; merchantKey: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  function openTagMenu(e: React.MouseEvent, merchant: string, merchantKey: string) {
    e.preventDefault();
    const MENU_W = 208; // w-52
    setMenu({
      merchant,
      merchantKey,
      x: Math.min(e.clientX, window.innerWidth - MENU_W - 8),
      y: Math.min(e.clientY, window.innerHeight - 280),
    });
  }

  // Which confirmed row's expiration is in edit mode (date input shown).
  // Saving happens on blur/Enter; Escape cancels without saving.
  const [editingExpiry, setEditingExpiry] = useState<number | null>(null);
  const cancelExpiryRef = useRef(false);

  function saveExpiry(c: ConfirmedRecurring, value: string) {
    setEditingExpiry(null);
    if (cancelExpiryRef.current) {
      cancelExpiryRef.current = false;
      return;
    }
    const next = value === "" ? null : value;
    if (next !== c.expiresOn) setExpiration.mutate({ id: c.id, expiresOn: next });
  }

  return (
    <Card title="Recurring charges">
      {rec.confirmed.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-3">
          <RecurringTile
            label="Monthly"
            value={money(t.monthlyTotal)}
            sub={`${t.monthlyCount} charge${plural(t.monthlyCount)}/mo`}
          />
          <RecurringTile
            label="Annual"
            value={money(t.yearlyTotal)}
            sub={`${t.yearlyCount} annual-billed charge${plural(t.yearlyCount)}`}
          />
          <RecurringTile
            label="Total"
            value={`${money(t.annualizedTotal)}/yr`}
            sub="all cadences, per year"
          />
        </div>
      )}

      <RecHeader title="Confirmed" grid={REC_GRID_CONFIRMED} withExpires />
      <ul className="mt-1 divide-y divide-zinc-800/60">
        {rec.confirmed.map((c) => (
          <li
            key={c.id}
            onContextMenu={(e) => openTagMenu(e, c.name, c.merchantKey)}
            className={`${REC_GRID_CONFIRMED} items-center py-1.5 text-sm ${c.active ? "" : "opacity-50"} ${menu?.merchantKey === c.merchantKey ? "bg-zinc-800/40" : ""}`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-zinc-200">{c.name}</span>
              {c.expired && (
                <span
                  className="shrink-0"
                  title={`Still charging past its expected end (${expLabel(c.expiresOn!)}) — last charge ${dayLabel(c.lastDate!)}`}
                >
                  <WarningIcon className="h-3.5 w-3.5 text-red-400" />
                </span>
              )}
            </span>
            <TagMarks tags={taggedByKey.get(c.merchantKey)?.tags ?? []} />
            <span className="hidden text-xs text-zinc-400 sm:block">{c.frequency}</span>
            <span className="hidden truncate text-xs text-zinc-500 md:block">
              {c.lastDate == null
                ? "no matches"
                : c.active
                  ? `~${dayLabel(c.nextExpected!)}`
                  : `lapsed ${dayLabel(c.lastDate)}`}
            </span>
            <span className="hidden min-w-0 sm:block">
              {editingExpiry === c.id ? (
                <input
                  type="date"
                  autoFocus
                  defaultValue={c.expiresOn ?? ""}
                  onBlur={(e) => saveExpiry(c, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      cancelExpiryRef.current = true;
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100 [color-scheme:dark]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingExpiry(c.id)}
                  disabled={busy}
                  title="Edit expected end date (empty = indefinite)"
                  className={`max-w-full cursor-pointer truncate rounded px-1 py-0.5 text-xs hover:bg-zinc-800 disabled:cursor-not-allowed ${
                    c.expired ? "text-red-400" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {c.expiresOn ? expLabel(c.expiresOn) : "∞"}
                </button>
              )}
            </span>
            <span className="text-right tabular-nums text-zinc-100">{money(c.amount)}</span>
            <span className="flex justify-end">
              <button
                type="button"
                onClick={() => removeSeries.mutate(c.id)}
                disabled={busy}
                aria-label={`Un-confirm ${c.name}`}
                title="Un-confirm (back to suggestions)"
                className={`${ICON_BTN} text-zinc-500 hover:bg-red-500/10 hover:text-red-400`}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
        {rec.confirmed.length === 0 && (
          <li className="py-1.5 text-sm text-zinc-500">
            Nothing confirmed yet — review the suggestions below.
          </li>
        )}
      </ul>

      <RecHeader title="Suggested" note="detected from history" grid={REC_GRID} />
      <ul className="mt-1 divide-y divide-zinc-800/60">
        {rec.suggested.map((r) => (
          <li
            key={`${r.name}-${r.frequency}`}
            onContextMenu={(e) => openTagMenu(e, r.name, r.merchantKey)}
            className={`${REC_GRID} items-center py-1.5 text-sm ${r.active ? "" : "opacity-50"} ${menu?.merchantKey === r.merchantKey ? "bg-zinc-800/40" : ""}`}
          >
            <span className="min-w-0 truncate text-zinc-200">{r.name}</span>
            <TagMarks tags={taggedByKey.get(r.merchantKey)?.tags ?? []} />
            <span className="hidden text-xs text-zinc-400 sm:block">{r.frequency}</span>
            <span className="hidden truncate text-xs text-zinc-500 md:block">
              {r.active ? `~${dayLabel(r.nextExpected)}` : `lapsed ${dayLabel(r.lastDate)}`}
            </span>
            <span className="text-right tabular-nums text-zinc-100">{money(r.avgAmount)}</span>
            <span className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() =>
                  setSeries.mutate({
                    name: r.name,
                    amount: r.avgAmount,
                    frequency: r.frequency,
                    status: "confirmed",
                  })
                }
                disabled={busy}
                aria-label={`Confirm ${r.name} as recurring`}
                title="Confirm as recurring"
                className={`${ICON_BTN} text-emerald-400 hover:bg-emerald-500/10`}
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setSeries.mutate({
                    name: r.name,
                    amount: r.avgAmount,
                    frequency: r.frequency,
                    status: "dismissed",
                  })
                }
                disabled={busy}
                aria-label={`Dismiss ${r.name} suggestion`}
                title="Dismiss (just a place I go a lot)"
                className={`${ICON_BTN} text-zinc-500 hover:bg-zinc-700/60 hover:text-zinc-300`}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
        {rec.suggested.length === 0 && (
          <li className="py-1.5 text-sm text-zinc-500">No new suggestions.</li>
        )}
      </ul>

      {rec.dismissed.length > 0 && (
        <p className="mt-4 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
          Dismissed:{" "}
          {rec.dismissed.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              {s.name}{" "}
              <button
                type="button"
                onClick={() => removeSeries.mutate(s.id)}
                disabled={busy}
                className="cursor-pointer text-zinc-400 underline decoration-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed"
              >
                restore
              </button>
            </span>
          ))}
        </p>
      )}

      {menu && (
        <div
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-40 w-52 rounded-lg border border-zinc-700 bg-zinc-800 p-1 shadow-xl"
        >
          <div className="truncate px-2 pt-1 text-xs font-medium text-zinc-300">{menu.merchant}</div>
          <TagMenuSection
            merchant={menu.merchant}
            merchantKey={menu.merchantKey}
            taggedByKey={taggedByKey}
          />
        </div>
      )}

      {error != null && (
        <p className="mt-2 text-xs text-red-400">Couldn't save — {(error as Error).message}</p>
      )}
    </Card>
  );
}

// Transaction rows: date | merchant | tags | account (sm+) | category (md+) |
// amount. Same hidden-cell/template pairing rule as REC_GRID. Row actions
// live in the right-click context menu, not a per-row button.
const TX_GRID =
  "grid grid-cols-[3rem_minmax(0,1fr)_3rem_5rem] gap-x-3 sm:grid-cols-[3rem_minmax(0,1fr)_3rem_5.5rem_5rem] md:grid-cols-[3rem_minmax(0,1fr)_3rem_5.5rem_8.5rem_5rem]";

function TransactionsCard({ d, accountLabel }: { d: SpendingDashboard; accountLabel: Map<string, string> }) {
  const { setSeries, removeSeries, busy, error } = useRecurringMutations();

  // The right-click context menu, fixed-positioned at the cursor so the
  // list's overflow scroll can't clip it. Closed on outside pointerdown or
  // scroll.
  const [menu, setMenu] = useState<{ txId: number; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  function openMenu(e: React.MouseEvent, tx: SpendingTransaction) {
    e.preventDefault(); // replace the browser context menu on rows
    const MENU_W = 208; // w-52
    setMenu({
      txId: tx.id,
      x: Math.min(e.clientX, window.innerWidth - MENU_W - 8),
      y: Math.min(e.clientY, window.innerHeight - 280),
    });
  }

  const taggedByKey = useMemo(
    () => new Map(d.tagged.map((m) => [m.merchantKey, m])),
    [d.tagged],
  );

  // Always read the live row (not a snapshot) so the check flips in place
  // after the mutation refetches.
  const menuTx = menu ? (d.transactions.find((t) => t.id === menu.txId) ?? null) : null;

  // Marking from a transaction exists to catch what detection can't (a price
  // change broke the amount match, or too few charges yet): it confirms a
  // series from this charge's merchant + amount. Cadence defaults to monthly —
  // editable later by re-confirming from the widget. Toggling off deletes the
  // whole matched series (the merchant stops being recurring).
  function toggleRecurring() {
    if (!menuTx) return;
    if (menuTx.recurringSeriesId != null) removeSeries.mutate(menuTx.recurringSeriesId);
    else
      setSeries.mutate({
        name: menuTx.name,
        amount: Math.abs(menuTx.amount),
        frequency: "monthly",
        status: "confirmed",
      });
  }

  return (
    <Card
      title="Transactions"
      right={
        <span className="text-xs text-zinc-500">
          {d.summary.txCount} in {monthLabel(d.month, "short")} · right-click a row for options
        </span>
      }
    >
      <div className={`${TX_GRID} mt-3 items-center pr-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500`}>
        <span>date</span>
        <span>merchant</span>
        <span>tags</span>
        <span className="hidden sm:block">account</span>
        <span className="hidden md:block">category</span>
        <span className="text-right">amount</span>
      </div>
      <ul
        className="mt-1 max-h-96 divide-y divide-zinc-800/60 overflow-y-auto pr-1"
        onScroll={() => setMenu(null)}
      >
        {d.transactions.map((t) => (
          <li
            key={t.id}
            onContextMenu={(e) => openMenu(e, t)}
            className={`${TX_GRID} items-center py-1.5 text-sm ${menu?.txId === t.id ? "bg-zinc-800/40" : ""}`}
          >
            <span className="text-xs text-zinc-500">{dayLabel(t.date)}</span>
            <span className="min-w-0 truncate text-zinc-200">
              {t.name}
              {t.pending && <span className="ml-1.5 text-xs text-amber-400/80">pending</span>}
              {t.recurringSeriesId != null && (
                <span className="ml-1.5 rounded-full bg-zinc-800 px-1.5 py-px text-[10px] text-zinc-400">
                  recurring
                </span>
              )}
            </span>
            <TagMarks tags={taggedByKey.get(t.merchantKey)?.tags ?? []} />
            <span className="hidden truncate text-xs text-zinc-600 sm:block">
              {t.accountId ? accountLabel.get(t.accountId) : ""}
            </span>
            <span className="hidden min-w-0 md:block">
              {t.category && (
                <span className="inline-block max-w-full truncate rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                  {prettyCategory(t.category).toLowerCase()}
                </span>
              )}
            </span>
            <span className={`text-right tabular-nums ${t.amount < 0 ? "text-emerald-400" : "text-zinc-100"}`}>
              {t.amount < 0 ? `+${money(-t.amount)}` : money(t.amount)}
            </span>
          </li>
        ))}
      </ul>
      {menu && menuTx && (
        <div
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-40 w-52 rounded-lg border border-zinc-700 bg-zinc-800 p-1 shadow-xl"
        >
          {/* Both sections act on the merchant, so name it up top. */}
          <div className="truncate px-2 pt-1 text-xs font-medium text-zinc-300">{menuTx.name}</div>
          <div className="mt-1 px-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Types
          </div>
          <button
            type="button"
            onClick={toggleRecurring}
            disabled={busy}
            className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="flex-1">Recurring</span>
            {menuTx.recurringSeriesId != null && (
              <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
            )}
          </button>
          <TagMenuSection
            merchant={menuTx.name}
            merchantKey={menuTx.merchantKey}
            taggedByKey={taggedByKey}
          />
        </div>
      )}
      {error != null && (
        <p className="mt-2 text-xs text-red-400">Couldn't save — {(error as Error).message}</p>
      )}
    </Card>
  );
}

// Tag summary: one expandable row per tag — merchant count + what the tag's
// merchants netted in the selected month; the dropdown lists the merchants
// with their own month sums. Month scoping rides on d.transactions (already
// the selected month), so the card follows the month switcher for free.
const TAG_SUM_GRID = "grid grid-cols-[minmax(0,1fr)_5.5rem_6rem] items-center gap-x-3";

function TagsCard({ d }: { d: SpendingDashboard }) {
  const tagsQuery = useTags();
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());

  const toggleOpen = (id: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Per tag: its merchants (from the merchant→tags rules) and the selected
  // month's net sum over those merchants' transactions (refunds subtract —
  // same signs as the transaction list).
  const rows = useMemo(() => {
    const monthSumByKey = new Map<string, number>();
    for (const t of d.transactions) {
      monthSumByKey.set(t.merchantKey, (monthSumByKey.get(t.merchantKey) ?? 0) + t.amount);
    }
    return (tagsQuery.data?.tags ?? []).map((tag) => {
      const merchants = d.tagged
        .filter((m) => m.tags.some((x) => x.id === tag.id))
        .map((m) => ({
          merchant: m.merchant,
          merchantKey: m.merchantKey,
          monthSum: monthSumByKey.get(m.merchantKey) ?? 0,
        }))
        .sort((a, b) => b.monthSum - a.monthSum);
      return {
        tag,
        merchants,
        monthSum: merchants.reduce((s, m) => s + m.monthSum, 0),
      };
    });
  }, [tagsQuery.data, d.tagged, d.transactions]);

  const sumCell = (n: number) =>
    n < 0 ? (
      <span className="text-right tabular-nums text-emerald-400">+{money(-n)}</span>
    ) : (
      <span className="text-right tabular-nums text-zinc-100">{money(n)}</span>
    );

  return (
    <Card title="Tags">
      <div className={`${TAG_SUM_GRID} mt-3 text-[10px] font-medium uppercase tracking-wide text-zinc-500`}>
        <span>tag</span>
        <span>merchants</span>
        <span className="text-right">{monthLabel(d.month, "short")} sum</span>
      </div>
      <ul className="mt-1 divide-y divide-zinc-800/60">
        {rows.map(({ tag, merchants, monthSum }) => {
          const open = openIds.has(tag.id);
          return (
            <li key={tag.id} className="py-1">
              <button
                type="button"
                onClick={() => toggleOpen(tag.id)}
                aria-expanded={open}
                className={`${TAG_SUM_GRID} w-full rounded py-0.5 text-left text-sm hover:bg-zinc-800/40`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronRightIcon
                    className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
                  />
                  <TagPill tag={tag} />
                </span>
                <span className="text-xs text-zinc-400">{merchants.length}</span>
                {sumCell(monthSum)}
              </button>
              {open && (
                <ul className="mt-0.5 mb-1 ml-[1.35rem] space-y-0.5 border-l border-zinc-700/60 pl-2.5">
                  {merchants.map((m) => (
                    <li key={m.merchantKey} className="flex items-center gap-3 py-0.5 text-sm">
                      <span className="min-w-0 flex-1 truncate text-zinc-300">{m.merchant}</span>
                      {sumCell(m.monthSum)}
                    </li>
                  ))}
                  {merchants.length === 0 && (
                    <li className="py-0.5 text-xs text-zinc-500">
                      No merchants yet — right-click a transaction to apply this tag.
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
        {tagsQuery.isSuccess && rows.length === 0 && (
          <li className="py-1.5 text-sm text-zinc-500">
            No tags yet — Edit Tags in the sidebar.
          </li>
        )}
      </ul>
    </Card>
  );
}

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

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Monthly trend" right={<span className="text-xs text-zinc-500">click a bar to jump</span>}>
          <TrendChart trend={d.trend} selected={d.month} onSelect={(m) => setMonth(m)} />
        </Card>

        <Card
          title="Through the month"
          right={d.summary.projected != null ? <span className="text-xs text-zinc-500">projected {money(d.summary.projected)}</span> : undefined}
        >
          <DailyChart daily={d.daily} month={d.month} />
        </Card>
      </div>

      <TagTrendCard d={d} />

      <CategoryCard categories={d.categories} transactions={d.transactions} tagged={d.tagged} />

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

      <RecurringCard rec={d.recurring} tagged={d.tagged} />

      <TransactionsCard d={d} accountLabel={accountLabel} />

      <TagsCard d={d} />
    </div>
  );
}
