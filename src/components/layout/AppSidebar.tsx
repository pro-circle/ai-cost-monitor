import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Beaker,
  Cpu,
  Database,
  FileText,
  Gauge,
  LayoutDashboard,
  LineChart,
  Server,
  Sparkles,
  Wallet,
  Wand2,
} from "lucide-react";

import { cn } from "@/lib/utils";

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  group: string;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, group: "Observe", description: "Executive KPIs and fleet trends" },
  { to: "/workloads", label: "Workloads", icon: Server, group: "Observe", description: "Job inventory and drill-down" },
  { to: "/gpu-analytics", label: "GPU Analytics", icon: Cpu, group: "Observe", description: "Per-accelerator efficiency" },
  { to: "/cost", label: "Cost Intelligence", icon: Wallet, group: "Observe", description: "Spend attribution and waste" },
  { to: "/anomalies", label: "Anomaly Detection", icon: AlertTriangle, group: "Diagnose", description: "Isolation Forest + LOF" },
  { to: "/eda", label: "Exploratory Analysis", icon: BarChart3, group: "Diagnose", description: "Distributions and correlations" },
  { to: "/predict", label: "Prediction Studio", icon: LineChart, group: "Predict", description: "Cost and duration models" },
  { to: "/optimize", label: "Optimization Engine", icon: Wand2, group: "Predict", description: "Configuration search" },
  { to: "/what-if", label: "What-If Simulator", icon: Gauge, group: "Predict", description: "Scenario comparison" },
  { to: "/datasets", label: "Dataset Management", icon: Database, group: "Data", description: "Ingest, validate, clean" },
  { to: "/research", label: "Research Mode", icon: Beaker, group: "Data", description: "Statistical testing" },
  { to: "/reports", label: "Report Generation", icon: FileText, group: "Data", description: "Export executive briefs" },
];

const GROUPS = ["Observe", "Diagnose", "Predict", "Data"];

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4">
        <div className="flex size-9 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30">
          <Activity className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold tracking-tight text-sidebar-foreground">AIComputeGuard</p>
          <p className="truncate text-[11px] text-muted-foreground">Compute cost intelligence</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {GROUPS.map((group) => (
          <div key={group} className="mb-5">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {group}
            </p>
            <ul className="space-y-0.5">
              {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_var(--color-primary)]"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                      )}
                    >
                      <item.icon className={cn("size-4 shrink-0", active && "text-primary")} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          <span>Analytics engine v1 · demo data layer</span>
        </div>
      </div>
    </div>
  );
}
