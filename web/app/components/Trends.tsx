// Felt-state trends — a small inline-SVG sparkline of how the user's logged
// felt state evolves over time. No external chart deps; pure SVG/CSS, themed to
// match the goal page (gold = assured/positive, accent = neutral, soft red =
// doubt/negative). The parent wraps this in its own <section> + heading, so we
// render only the chart + summary content here.

export type TrendPoint = { date: string; state: string; kind: string };

// Small keyword lexicon. Case-insensitive substring match against the free-text
// state. Positive => +1, negative => -1, otherwise 0 (neutral / unknown).
const POSITIVE = [
  "assured", "confident", "calm", "peaceful", "joy", "grateful", "certain",
  "faith", "fulfilled", "natural", "knowing", "happy", "excited",
];
const NEGATIVE = [
  "doubt", "doubtful", "anxious", "fear", "afraid", "worried", "frustrated",
  "impatient", "lack", "struggling", "uncertain", "restless",
];

function sentiment(state: string): -1 | 0 | 1 {
  const s = (state || "").toLowerCase();
  if (POSITIVE.some((w) => s.includes(w))) return 1;
  if (NEGATIVE.some((w) => s.includes(w))) return -1;
  return 0;
}

// Color per sentiment, matching the goal-page palette.
const dotColor = (v: number) =>
  v > 0
    ? "var(--color-gold)"
    : v < 0
    ? "rgb(248 113 113 / 0.7)"
    : "var(--color-accent)";

function fmtDate(d: string): string {
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleString();
}

export default function Trends({ points }: { points: TrendPoint[] }) {
  if (!points || points.length === 0) return null;

  const scored = points.map((p) => ({ ...p, score: sentiment(p.state) }));

  // SVG geometry. We use a viewBox so width can be 100%.
  const W = 600;
  const H = 120;
  const padX = 16;
  const padY = 24;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const n = scored.length;

  // x by chronological index; y maps +1 -> top, 0 -> middle, -1 -> bottom.
  const x = (i: number) => (n === 1 ? W / 2 : padX + (innerW * i) / (n - 1));
  const y = (score: number) => padY + innerH * ((1 - score) / 2);
  const baselineY = y(0);

  const coords = scored.map((p, i) => ({ ...p, cx: x(i), cy: y(p.score) }));
  const polyline = coords.map((c) => `${c.cx},${c.cy}`).join(" ");

  // Trend: avg sentiment of first half vs second half.
  const avg = (arr: { score: number }[]) =>
    arr.length ? arr.reduce((s, p) => s + p.score, 0) / arr.length : 0;
  const mid = Math.floor(n / 2);
  const firstAvg = avg(scored.slice(0, mid || 1));
  const secondAvg = avg(scored.slice(mid));
  const delta = secondAvg - firstAvg;
  const trend =
    n < 2 || Math.abs(delta) < 0.25
      ? "steady"
      : delta > 0
      ? "trending toward assurance"
      : "more doubt lately";

  // Tally: most common state (by normalized text), and counts.
  const stateCounts = new Map<string, number>();
  for (const p of scored) {
    const key = (p.state || "—").trim() || "—";
    stateCounts.set(key, (stateCounts.get(key) ?? 0) + 1);
  }
  const topState = [...stateCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const positiveCount = scored.filter((p) => p.score > 0).length;
  const negativeCount = scored.filter((p) => p.score < 0).length;

  const trendColor =
    trend === "trending toward assurance"
      ? "var(--color-gold)"
      : trend === "more doubt lately"
      ? "rgb(248 113 113 / 0.8)"
      : "var(--color-accent)";

  return (
    <div className="space-y-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Felt-state sentiment over time"
        className="block"
      >
        {/* zero baseline */}
        <line
          x1={padX}
          y1={baselineY}
          x2={W - padX}
          y2={baselineY}
          stroke="var(--color-line)"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
        {/* connecting path (only meaningful with >1 point) */}
        {n > 1 && (
          <polyline
            points={polyline}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {/* dots */}
        {coords.map((c, i) => (
          <g key={i}>
            <circle
              cx={c.cx}
              cy={c.cy}
              r={4}
              fill={dotColor(c.score)}
              stroke="var(--color-base)"
              strokeWidth={1}
              style={
                c.score > 0
                  ? { filter: "drop-shadow(0 0 4px var(--color-gold))" }
                  : undefined
              }
            >
              <title>{`${fmtDate(c.date)} — ${c.state || "no state"} (${c.kind})`}</title>
            </circle>
          </g>
        ))}
      </svg>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--color-gold)" }}
          />
          assured
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--color-accent)" }}
          />
          neutral
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "rgb(248 113 113 / 0.7)" }}
          />
          doubt
        </span>
      </div>

      {/* summary / tally */}
      <p className="text-sm text-[var(--color-muted)]">
        {n} {n === 1 ? "entry" : "entries"}
        {topState && (
          <>
            {" · "}
            <span className="text-[#ddd8ef]">
              {topState[1]} {topState[0]}
            </span>
          </>
        )}
        {positiveCount > 0 && (
          <span className="text-[var(--color-gold)]"> · {positiveCount} assured</span>
        )}
        {negativeCount > 0 && (
          <span className="text-red-400/80"> · {negativeCount} doubtful</span>
        )}
        {" · "}
        <span style={{ color: trendColor }}>{trend}</span>
      </p>
    </div>
  );
}
