import { useState, useRef, useCallback } from "react";
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

export function WalletBalanceChart({ points, width = 800, height = 240 }: Props) {
  const [hover, setHover] = useState<{ point: BalanceChartPoint; index: number; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || points.length < 2) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * width;
      const padding = { left: 96, right: 24, top: 16, bottom: 44 };
      const chartW = width - padding.left - padding.right;
      const relX = (x - padding.left) / chartW;
      const idx = Math.round(relX * (points.length - 1));
      const i = Math.max(0, Math.min(idx, points.length - 1));
      const p = points[i]!;
      const yPos = 20;
      setHover({ point: p, index: i, x: e.clientX - rect.left, y: yPos });
    },
    [points, width]
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  if (points.length < 2) {
    return (
      <div className="balance-chart-empty">
        need at least 2 completed trades to show wallet balance chart.
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

  const xTickCount = Math.min(6, points.length);
  const xTickIndices = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i / (xTickCount - 1 || 1)) * (points.length - 1))
  );

  const x = (i: number) => padding.left + (i / (points.length - 1)) * chartW;
  const y = (v: number) => padding.top + chartH - ((v - minBal) / range) * chartH;

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.balanceSol)}`).join(" ");

  return (
    <div className="balance-chart">
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        aria-label="wallet balance over time"
      >
        {/* Y-axis grid lines */}
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
        {/* X-axis labels (time) */}
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
        {/* Area fill */}
        <path
          d={`${pathD} L ${x(points.length - 1)} ${y(minBal)} L ${x(0)} ${y(minBal)} Z`}
          fill="var(--lobbi-orange)"
          fillOpacity={0.15}
        />
        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke="var(--lobbi-orange)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Hover point */}
        {hover && (
          <g>
            <circle
              cx={x(hover.index)}
              cy={y(hover.point.balanceSol)}
              r={6}
              fill="var(--lobbi-orange)"
              stroke="var(--text)"
              strokeWidth={2}
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
