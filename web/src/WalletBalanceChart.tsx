import { useState, useRef, useCallback, useMemo } from "react";
import type { BalanceChartPoint, BalanceChartMeta } from "./api";

interface Props {
  points: BalanceChartPoint[];
  meta?: BalanceChartMeta | null;
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

function formatRangeLine(meta: BalanceChartMeta | null | undefined): string | null {
  if (!meta?.from || !meta?.to) return null;
  const same = meta.from === meta.to;
  const span = same
    ? formatTimestamp(meta.from)
    : `${formatTimestamp(meta.from)} → ${formatTimestamp(meta.to)}`;
  const detail =
    meta.rawCount != null && meta.count != null && meta.rawCount > meta.count
      ? ` (${meta.count} points shown, ${meta.rawCount} before downsample)`
      : meta.count != null
        ? ` (${meta.count} points)`
        : "";
  return `range: ${span}${detail}`;
}

export function WalletBalanceChart({ points, meta, width = 800, height = 240 }: Props) {
  const [hover, setHover] = useState<{ point: BalanceChartPoint; index: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || points.length < 2) return;
      const rect = svgRef.current.getBoundingClientRect();
      const xSvg = ((e.clientX - rect.left) / rect.width) * width;
      const padding = { left: 96, right: 24, top: 16, bottom: 44 };
      const chartW = width - padding.left - padding.right;
      const relX = (xSvg - padding.left) / chartW;
      const idx = Math.round(relX * (points.length - 1));
      const i = Math.max(0, Math.min(idx, points.length - 1));
      const p = points[i]!;
      setHover({ point: p, index: i });
    },
    [points, width]
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  const xTickIndices = useMemo(() => {
    const n = points.length;
    if (n <= 1) return n === 1 ? [0] : [];
    const want = Math.min(8, n);
    const tickSet = new Set([0, n - 1]);
    for (let k = 1; k < want - 1; k++) {
      tickSet.add(Math.round((k / (want - 1)) * (n - 1)));
    }
    return Array.from(tickSet).sort((a, b) => a - b);
  }, [points]);

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
  const range = maxBal - minBal || 0.1;
  const padding = { top: 16, right: 24, bottom: 44, left: 96 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const yTickCount = 8;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const t = i / yTickCount;
    return minBal + (1 - t) * range;
  });

  const x = (i: number) => padding.left + (i / (points.length - 1)) * chartW;
  const y = (v: number) => padding.top + chartH - ((v - minBal) / range) * chartH;

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.balanceSol)}`).join(" ");

  const rangeLine = formatRangeLine(meta);

  return (
    <div className="balance-chart">
      {rangeLine && <p className="balance-chart-range">{rangeLine}</p>}
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
          return (
            <g key={idx}>
              <line
                x1={x(idx)}
                y1={padding.top}
                x2={x(idx)}
                y2={padding.top + chartH}
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.4}
              />
              <text
                x={x(idx)}
                y={padding.top + chartH + 20}
                textAnchor="middle"
                className="balance-chart-label balance-chart-x-label"
              >
                {formatTimestamp(p.timestamp)}
              </text>
            </g>
          );
        })}
        <path
          d={`${pathD} L ${x(points.length - 1)} ${y(minBal)} L ${x(0)} ${y(minBal)} Z`}
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
              x1={x(hover.index)}
              y1={padding.top}
              x2={x(hover.index)}
              y2={padding.top + chartH}
              stroke="var(--chud-accent)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.45}
            />
            <circle
              cx={x(hover.index)}
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
