import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  warning: "border-warning/40 bg-warning/10 text-warning",
  info: "border-info/40 bg-info/10 text-info",
  Completed: "border-success/40 bg-success/10 text-success",
  Running: "border-info/40 bg-info/10 text-info",
  Failed: "border-destructive/40 bg-destructive/10 text-destructive",
  Queued: "border-border bg-muted text-muted-foreground",
  Anomalous: "border-warning/40 bg-warning/10 text-warning",
};

export function ToneBadge({ value, className }: { value: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium capitalize", TONES[value] ?? "border-border", className)}>
      {value}
    </Badge>
  );
}
