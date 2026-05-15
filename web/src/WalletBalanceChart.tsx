import { useState, useRef, useCallback, useMemo } from "react";
import type { BalanceChartPoint } from "./api";
import { formatSolWithUsd } from "./formatSolUsd";

interface Props {
  points: BalanceChartPoint[];
  solPriceUsd?: number | null;
  width?: number;
  height?: number;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAxisDate(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const dayMs = 86_400_000;
  if (spanMs > 14 * dayMs) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (spanMs > 3 * dayMs) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric" });
}

/** Evenly spaced time labels with minimum pixel gap (no overlap). */
function buildTimeAxisLabels(
  tMin: number,
  span: number,
  chartLeft: number,
  chartW: number,
  maxLabels = 5,
  minGapPx = 88
): { x: number; text: string }[] {
  if (span <= 0) return [];
  const n = Math.min(maxLabels, 6);
  const raw: { x: number; text: string }[] = [];
  for (let k = 0; k < n; k++) {
    const t = tMin + (span * k) / Math.max(n - 1, 1);
    const x = chartLeft + ((t - tMin) / span) * chartW;
    raw.push({ x, text: formatAxisDate(t, span) });
  }
  const out: { x: number; text: string }[] = [];
  let lastX = -1e9;
  for (const lab of raw) {
    if (lab.x - lastX >= minGapPx) {
      out.push(lab);
      lastX = lab.x;
    }
  }
  return out;
}

export function WalletBalanceChart({ points, solPriceUsd, width = 1100, height = 260 }: Props) {
  const [hover, setHover] = useState<{ point: BalanceChartPoint; index: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const padding = { top: 14, right: 16, bottom: 40, left: 80 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const { times, tMin, span } = useMemo(() => {
    const t = points.map((p) => Date.parse(p.timestamp));
    const tMinV = Math.min(...t);
    const tMaxV = Math.max(...t);
    return { times: t, tMin: tMinV, span: Math.max(tMaxV - tMinV, 1) };
  }, [points]);

  const xFromTime = useCallback(
    (iso: string) => padding.left + ((Date.parse(iso) - tMin) / span) * chartW,
    [tMin, span, chartW, padding.left]
  );

  const xLabels = useMemo(
    () => buildTimeAxisLabels(tMin, span, padding.left, chartW),
    [tMin, span, padding.left, chartW]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || points.length < 2) return;
      const rect = svgRef.current.getBoundingClientRect();
      const xSvg = ((e.clientX - rect.left) / rect.width) * width;
      const relX = (xSvg - padding.left) / chartW;
      const clamped = Math.max(0, Math.min(1, relX));
      const targetT = tMin + clamped * span;
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < points.length; i++) {
        const d = Math.abs(times[i]! - targetT);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      setHover({ point: points[bestI]!, index: bestI });
    },
    [points, times, width, tMin, span, chartW, padding.left]
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  if (points.length < 2) {
    return <div className="balance-chart-empty">wallet history loading…</div>;
  }

  const balances = points.map((p) => p.balanceSol);
  const minBal = Math.min(0, ...balances);
  const maxBal = Math.max(...balances);
  const yRange = maxBal - minBal || 0.1;

  const y = (v: number) => padding.top + chartH - ((v - minBal) / yRange) * chartH;

  const yTicks = [0, 0.5, 1].map((t) => minBal + (1 - t) * yRange);

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFromTime(p.timestamp)} ${y(p.balanceSol)}`).join(" ");
  const xEnd = xFromTime(points[points.length - 1]!.timestamp);
  const xStart = xFromTime(points[0]!.timestamp);

  return (
    <div className="balance-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="balance-chart-svg"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        aria-label="wallet balance over time"
      >
        {yTicks.map((val, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y(val)}
              x2={padding.left + chartW}
              y2={y(val)}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.4}
            />
            <text x={padding.left - 6} y={y(val)} textAnchor="end" className="balance-chart-label" dominantBaseline="middle">
              {val.toFixed(2)}
            </text>
          </g>
        ))}
        {xLabels.map((lab, i) => (
          <text
            key={i}
            x={lab.x}
            y={padding.top + chartH + 18}
            textAnchor="middle"
            className="balance-chart-label balance-chart-x-label"
          >
            {lab.text}
          </text>
        ))}
        <path
          d={`${pathD} L ${xEnd} ${y(minBal)} L ${xStart} ${y(minBal)} Z`}
          fill="var(--chud-accent)"
          fillOpacity={0.12}
        />
        <path
          d={pathD}
          fill="none"
          stroke="var(--chud-accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hover && (
          <g>
            <line
              x1={xFromTime(hover.point.timestamp)}
              y1={padding.top}
              x2={xFromTime(hover.point.timestamp)}
              y2={padding.top + chartH}
              stroke="var(--text)"
              strokeWidth={1}
              strokeDasharray="4 4"
              opacity={0.35}
            />
            <circle
              cx={xFromTime(hover.point.timestamp)}
              cy={y(hover.point.balanceSol)}
              r={3}
              fill="var(--chud-accent)"
            />
          </g>
        )}
      </svg>
      {hover && (
        <div className="balance-chart-tooltip">
          <div className="balance-chart-tooltip-balance">
            {formatSolWithUsd(hover.point.balanceSol, solPriceUsd)}
          </div>
          <div className="balance-chart-tooltip-time">{formatTimestamp(hover.point.timestamp)}</div>
        </div>
      )}
    </div>
  );
}
