import type { ReactNode } from "react";

export const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
];

export const axisProps = {
  stroke: "var(--color-muted-foreground)",
  tick: { fill: "var(--color-muted-foreground)", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "var(--color-border)" },
} as const;

export const gridProps = {
  stroke: "var(--color-border)",
  strokeDasharray: "3 3",
  vertical: false,
} as const;

export const tooltipStyles = {
  contentStyle: {
    background: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontSize: "12px",
    color: "var(--color-popover-foreground)",
  },
  labelStyle: { color: "var(--color-muted-foreground)", fontSize: "11px" },
  itemStyle: { color: "var(--color-popover-foreground)" },
} as const;

export function ChartFrame({ height = 280, children }: { height?: number; children: ReactNode }) {
  return (
    <div style={{ height }} className="w-full">
      {children}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-3">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: item.color }} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
