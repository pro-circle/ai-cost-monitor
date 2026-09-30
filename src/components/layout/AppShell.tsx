import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Database, DatabaseZap, Menu, PanelsTopLeft, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { AppSidebar, NAV_ITEMS } from "./AppSidebar";
import { FilterBar } from "./FilterBar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { fetchDatasetMeta } from "@/lib/api/acg.functions";
import { formatCompact } from "@/lib/format";
import { useMockData } from "@/lib/mock-data";

const NO_FILTER_ROUTES = ["/datasets", "/predict", "/optimize", "/what-if"];
/** Pages that work without any stored data (physics simulator + your own uploads). */
const DATA_FREE_ROUTES = ["/datasets", "/optimize", "/what-if"];

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = NAV_ITEMS.find((item) => (item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)));
  const mock = useMockData();
  const needsData = !DATA_FREE_ROUTES.some((route) => pathname.startsWith(route));
  const showFilters = mock.loaded && !NO_FILTER_ROUTES.some((route) => pathname.startsWith(route));

  const { data: meta } = useQuery({
    queryKey: ["dataset-meta"],
    queryFn: () => fetchDatasetMeta(),
    staleTime: Infinity,
    enabled: mock.ready && mock.loaded,
  });

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="fixed inset-y-0 left-0 w-64">
          <AppSidebar />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 lg:px-6">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open navigation">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <AppSidebar onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <PanelsTopLeft className="size-3.5" />
                <span>{current?.group ?? "Console"}</span>
                <span aria-hidden>/</span>
                <span className="truncate text-foreground">{current?.label ?? "Overview"}</span>
              </div>
              <p className="truncate text-[11px] text-muted-foreground">{current?.description}</p>
            </div>

            <div className="hidden items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] text-muted-foreground md:flex">
              <Database className="size-3.5 text-primary" />
              {!mock.loaded ? (
                <span>no data loaded</span>
              ) : meta ? (
                <span className="font-mono">
                  {formatCompact(meta.jobs)} jobs · {formatCompact(meta.telemetry)} telemetry
                </span>
              ) : (
                <span>loading dataset…</span>
              )}
            </div>

            {mock.loaded ? (
              <Button variant="outline" size="sm" onClick={mock.clear} disabled={!mock.ready}>
                <Trash2 className="size-3.5" /> Clear mock
              </Button>
            ) : (
              <Button size="sm" onClick={mock.load} disabled={!mock.ready}>
                <DatabaseZap className="size-3.5" /> Load Mock
              </Button>
            )}
          </div>

          {showFilters ? (
            <div className="border-t border-border px-4 py-2.5 lg:px-6">
              <FilterBar />
            </div>
          ) : null}
        </header>

        <main className="flex-1 px-4 py-6 lg:px-6">
          {!mock.ready ? null : needsData && !mock.loaded ? <EmptyState onLoad={mock.load} /> : children}
        </main>

        <footer className="border-t border-border px-4 py-4 text-[11px] text-muted-foreground lg:px-6">
          AIComputeGuard · analytics computed server-side from the workload telemetry store · Flask/Python parity
          backend in <span className="font-mono">backend/</span>
        </footer>
      </div>
    </div>
  );
}

function EmptyState({ onLoad }: { onLoad: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
      <Database className="size-8 text-muted-foreground" />
      <h2 className="mt-4 text-lg font-semibold">No data yet</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        This page needs workload data. Load the mock dataset to explore every page, or upload your own file on the
        Datasets page. The Optimizer and What-If pages work without any data.
      </p>
      <Button className="mt-6" onClick={onLoad}>
        <DatabaseZap className="size-4" /> Load Mock
      </Button>
    </div>
  );
}
