import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { formatKpi, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface KpiLike {
  key: string;
  label: string;
  value: number;
  changePct: number;
  unit: "currency" | "percent" | "hours" | "number";
  direction: "up-good" | "down-good";
  status: "good" | "warn" | "bad";
  sparkline: { t: number; v: number }[];
  hint: string;
}

export function KpiCard({ kpi }: { kpi: KpiLike }) {
  const improving = kpi.direction === "up-good" ? kpi.changePct >= 0 : kpi.changePct <= 0;
  const flat = Math.abs(kpi.changePct) < 0.05;
  const Icon = flat ? Minus : kpi.changePct >= 0 ? ArrowUpRight : ArrowDownRight;
  const deltaTone = flat ? "text-muted-foreground" : improving ? "text-success" : "text-destructive";
  const statusTone = { good: "bg-success", warn: "bg-warning", bad: "bg-destructive" }[kpi.status];

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card p-4 shadow-sm">
      <span className={cn("absolute inset-x-0 top-0 h-0.5", statusTone)} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
        <span className={cn("flex items-center gap-0.5 text-xs font-medium tabular-nums", deltaTone)}>
          <Icon className="size-3.5" />
          {formatPercent(Math.abs(kpi.changePct))}
        </span>
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
        {formatKpi(kpi.value, kpi.unit)}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground" title={kpi.hint}>
        {kpi.hint}
      </p>
      <div className="mt-3 h-10">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={kpi.sparkline} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`spark-${kpi.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="v"
              stroke="var(--color-primary)"
              strokeWidth={1.5}
              fill={`url(#spark-${kpi.key})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
