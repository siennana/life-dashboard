// The gayness rainbow: five concentric arc rings that fill from the inside
// out as the day's score (1-5) climbs - full rainbow = SUPER MEGA GAY.
// Fixed hues (same hard-coded-hex exception as the SVG charts); unearned
// rings stay as faint zinc tracks so the arc shape reads at every tier.

const RING_COLORS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#8b5cf6"]; // outer -> inner
const EMPTY_TRACK = "#52525b"; // zinc-600

export function GayRainbow({ score, className }: { score: number; className?: string }) {
  const cx = 24;
  const base = 24;
  return (
    <svg viewBox="0 0 48 25" className={className} fill="none" aria-hidden="true">
      {RING_COLORS.map((color, i) => {
        const r = 21 - i * 4.2;
        const filled = i >= RING_COLORS.length - score;
        return (
          <path
            key={color}
            d={`M ${cx - r} ${base} A ${r} ${r} 0 0 1 ${cx + r} ${base}`}
            stroke={filled ? color : EMPTY_TRACK}
            strokeOpacity={filled ? 1 : 0.35}
            strokeWidth={3.6}
          />
        );
      })}
    </svg>
  );
}
