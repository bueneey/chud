import { useState, useRef, useCallback, useMemo } from "react";
import type { BalanceChartPoint } from "./api";

interface Props {
  points: BalanceChartPoint[];
  width?: number;
  height?: number;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatChartTick(iso: string, spanMs: number): string {
  const d = new Date(iso);
  const dayMs = 86_400_000;
  if (spanMs > 14 * dayMs) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  if (spanMs > 2 * dayMs) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function WalletBalanceChart({ points, width = 1100, height = 300 }: Props) {
  const [hover, setHover] = useState<{ point: BalanceChartPoint; index: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const padding = { top: 16, right: 24, bottom: 44, left: 96 };
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

  const xTickIndices = useMemo(() => {
    const n = points.length;
    if (n <= 1) return n === 1 ? [0] : [];
    const want = Math.min(10, n);
    const tickSet = new Set([0, n - 1]);
    for (let k = 1; k < want - 1; k++) {
      const targetT = tMin + (span * k) / (want - 1);
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(times[i]! - targetT);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      tickSet.add(bestI);
    }
    return Array.from(tickSet).sort((a, b) => a - b);
  }, [points.length, times, tMin, span]);

  if (points.length < 2) {
    return (
      <div className="balance-chart-empty">
        need at least 2 points on the chart (closed trades and/or saved wallet snapshots). leave the site open a minute so the
        backend can record balance, or close a couple trades.
      </div>
    );
  }

  const balances = points.map((p) => p.balanceSol);
  const minBal = Math.min(...balances);
  const maxBal = Math.max(...balances);
  const yRange = maxBal - minBal || 0.1;

  const y = (v: number) => padding.top + chartH - ((v - minBal) / yRange) * chartH;

  const yTickCount = 8;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const t = i / yTickCount;
    return minBal + (1 - t) * yRange;
  });

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
              opacity={0.6}
            />
            <text x={padding.left - 8} y={y(val)} textAnchor="end" className="balance-chart-label" dominantBaseline="middle">
              {val.toFixed(2)} SOL
            </text>
          </g>
        ))}
        {xTickIndices.map((idx) => {
          const p = points[idx];
          if (!p) return null;
          const xt = xFromTime(p.timestamp);
          return (
            <g key={idx}>
              <line
                x1={xt}
                y1={padding.top}
                x2={xt}
                y2={padding.top + chartH}
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.4}
              />
              <text
                x={xt}
                y={padding.top + chartH + 20}
                textAnchor="middle"
                className="balance-chart-label balance-chart-x-label"
              >
                {formatChartTick(p.timestamp, span)}
              </text>
            </g>
          );
        })}
        <path
          d={`${pathD} L ${xEnd} ${y(minBal)} L ${xStart} ${y(minBal)} Z`}
          fill="var(--chud-accent)"
          fillOpacity={0.15}
        />
        <path
          d={pathD}
          fill="none"
          stroke="var(--chud-accent)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hover && (
          <g className="balance-chart-hover">
            <line
              x1={xFromTime(hover.point.timestamp)}
              y1={padding.top}
              x2={xFromTime(hover.point.timestamp)}
              y2={padding.top + chartH}
              stroke="var(--chud-accent)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.45}
            />
            <circle
              cx={xFromTime(hover.point.timestamp)}
              cy={y(hover.point.balanceSol)}
              r={2.75}
              fill="var(--chud-accent)"
              stroke="var(--text)"
              strokeWidth={1}
            />
          </g>
        )}
      </svg>
      {hover && (
        <div className="balance-chart-tooltip">
          <div className="balance-chart-tooltip-balance">{hover.point.balanceSol.toFixed(4)} SOL</div>
          <div className="balance-chart-tooltip-time">{formatTimestamp(hover.point.timestamp)}</div>
        </div>
      )}
    </div>
  );
}
