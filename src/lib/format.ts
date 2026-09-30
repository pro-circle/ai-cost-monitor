/**
 * Formatting helpers shared across the UI. Presentation only — all analytics
 * arrive pre-computed from the backend. Demo cost values are USD internally;
 * all money shown to users is converted to INR at a fixed illustrative rate.
 */

export const INR_PER_USD = 83;

export function toRupees(value: number): number {
  return value * INR_PER_USD;
}

export function formatCurrency(value: number, digits?: number): string {
  const rupees = toRupees(value);
  const d = digits ?? (Math.abs(rupees) >= 100 ? 0 : Math.abs(rupees) >= 1 ? 2 : 3);
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function formatCompactCurrency(value: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(toRupees(value))}`;
}

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatTokens(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}

export function formatHours(value: number): string {
  if (value < 1) return `${Math.round(value * 60)} min`;
  if (value < 48) return `${value.toFixed(value < 10 ? 2 : 1)} h`;
  return `${(value / 24).toFixed(1)} d`;
}

export function formatDateTime(iso: string | number): string {
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function formatDate(iso: string | number): string {
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatKpi(value: number, unit: "currency" | "percent" | "hours" | "number"): string {
  switch (unit) {
    case "currency":
      return formatCurrency(value);
    case "percent":
      return formatPercent(value);
    case "hours":
      return `${formatNumber(value, 0)} h`;
    default:
      return formatNumber(value);
  }
}
