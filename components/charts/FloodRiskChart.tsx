"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  RISK_COLORS,
  RISK_LABELS,
  RISK_FT,
  riskColor,
  riskTickLabel,
  riskProbabilities,
} from "@/lib/floodRiskMock";

import { ChartTooltipShell, TooltipDivider, TooltipRow } from "./ChartTooltip";

export type RiskScale = "hourly" | "daily" | "weekly" | "monthly";

/** Two visual modes — vertical bars (default) or a smooth line trend. */
export type FloodRiskVariant = "bar" | "line";

export interface FloodRiskDatum {
  name: string;
  level: number | null;
  count?: number;
}

export interface FloodRiskChartProps {
  data: FloodRiskDatum[];
  scale: RiskScale;
  isDark: boolean;
  /**
   * Show horizontal dashed reference lines at y = 1 / 2 / 3 with the
   * Alert / Warning / Critical labels. Used on /analytics to give admins
   * an at-a-glance view of which buckets have crossed which alarm line.
   */
  showThresholds?: boolean;
  /** Pixel height of the inner ResponsiveContainer. Defaults to 240. */
  height?: number;
  /** "bar" (default) renders discrete coloured bars; "line" renders a
   *  smooth monotone trend line over the same gradient area. */
  variant?: FloodRiskVariant;
}

/**
 * The canonical Flood Risk Analysis visualisation used by both /dashboard
 * and /analytics. Everything else (header, scale toggle, min-level filter,
 * legend) is owned by the page and surrounds this component.
 *
 * Visuals: a soft red→orange→amber→green vertical gradient sits behind
 * discrete bars coloured by riskColor(level). Hover reveals an XGBoost
 * probability table from riskProbabilities(count).
 */
export default function FloodRiskChart({
  data,
  scale,
  isDark,
  showThresholds = false,
  height = 240,
  variant = "bar",
}: FloodRiskChartProps) {
  const chartTextColor = isDark ? "#a0a0a0" : "#4E4B4B";
  const chartGridColor = isDark ? "var(--color-border, #30363d)" : "#E5E5E5";
  const thresholdStroke = isDark ? "#48484a" : "#cbd5e1";

  return (
    <ResponsiveContainer width="100%" height={height} minWidth={0}>
      <ComposedChart data={data} barCategoryGap="22%">
        <defs>
          <linearGradient id="floodRiskGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#dc2626" stopOpacity={0.55} />
            <stop offset="40%"  stopColor="#f97316" stopOpacity={0.35} />
            <stop offset="75%"  stopColor="#f59e0b" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: scale === "hourly" ? 8 : 10, fill: chartTextColor }}
          axisLine={false}
          tickLine={false}
          interval={scale === "hourly" ? 2 : 0}
        />
        <YAxis
          domain={[0, 3]}
          ticks={[0, 1, 2, 3]}
          tickFormatter={riskTickLabel}
          tick={{ fontSize: 10, fill: chartTextColor }}
          axisLine={false}
          tickLine={false}
          width={58}
        />

        {/* Optional Alert / Warning / Critical reference lines — shown on
            /analytics for evacuation-decision context. */}
        {showThresholds && (
          <>
            <ReferenceLine
              y={1}
              stroke={thresholdStroke}
              strokeDasharray="4 4"
              label={{
                value: "Alert",
                position: "right",
                fill: "#f59e0b",
                fontSize: 10,
                fontWeight: 600,
              }}
            />
            <ReferenceLine
              y={2}
              stroke={thresholdStroke}
              strokeDasharray="4 4"
              label={{
                value: "Warning",
                position: "right",
                fill: "#f97316",
                fontSize: 10,
                fontWeight: 600,
              }}
            />
            <ReferenceLine
              y={3}
              stroke={thresholdStroke}
              strokeDasharray="4 4"
              label={{
                value: "Critical",
                position: "right",
                fill: "#dc2626",
                fontSize: 10,
                fontWeight: 600,
              }}
            />
          </>
        )}

        <Tooltip
          cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.[0]) return null;
            const p = payload[0].payload as FloodRiskDatum;
            const v = Number(p.level ?? 0);
            const bucket = Math.max(0, Math.min(3, Math.round(v)));
            const probs = riskProbabilities(p.count ?? 0);
            return (
              <ChartTooltipShell isDark={isDark} title={label}>
                <TooltipRow
                  label={`Level ${v} — ${RISK_LABELS[v] ?? "Unknown"}`}
                  value={RISK_FT[bucket] ?? ""}
                  swatchHex={riskColor(bucket)}
                />
                <TooltipDivider isDark={isDark} />
                <div
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 4,
                    color: "var(--color-muted)",
                  }}
                >
                  XGBoost Probabilities
                </div>
                {(["Normal", "Alert", "Warning", "Critical"] as const).map((k, idx) => (
                  <TooltipRow
                    key={k}
                    label={k}
                    value={`${(probs[k] * 100).toFixed(0)}%`}
                    swatchHex={RISK_COLORS[idx]}
                  />
                ))}
              </ChartTooltipShell>
            );
          }}
        />

        <Area
          type="monotone"
          dataKey="level"
          stroke="none"
          fill="url(#floodRiskGradient)"
          isAnimationActive={false}
          connectNulls
        />
        {variant === "bar" ? (
          <Bar dataKey="level" name="Flood Risk Level" radius={[5, 5, 0, 0]} maxBarSize={40}>
            {data.map((entry, i) => (
              <Cell key={i} fill={riskColor(entry.level)} />
            ))}
          </Bar>
        ) : (
          <Line
            type="monotone"
            dataKey="level"
            name="Flood Risk Level"
            stroke="#f97316"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "#f97316", strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 0 }}
            isAnimationActive={false}
            connectNulls
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
