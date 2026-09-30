import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConfigInput } from "@/lib/api/acg.functions";
import { cn } from "@/lib/utils";

export const GPU_OPTIONS = ["H100", "A100", "L40S", "T4"] as const;
export const PRECISION_OPTIONS = ["BF16", "FP16", "FP32"] as const;
export const WORKLOAD_OPTIONS = ["Training", "Fine-tuning", "Inference", "Evaluation"] as const;

export const DEFAULT_CONFIG: ConfigInput = {
  gpuType: "A100",
  gpuCount: 8,
  paramsB: 7,
  batchSize: 16,
  sequenceLength: 4096,
  precision: "BF16",
  tokens: 20e9,
  epochs: 1,
  trainingSteps: 305176,
  workloadType: "Fine-tuning",
};

/** Keeps trainingSteps consistent with tokens / (batch × sequence). */
export function withSteps(c: ConfigInput): ConfigInput {
  return { ...c, trainingSteps: Math.max(50, Math.min(1e9, Math.round(c.tokens / Math.max(1, c.batchSize * c.sequenceLength)))) };
}

export function NativeSelect({
  value,
  onChange,
  options,
  id,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  id?: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <Input
      id={id}
      type="number"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      className="font-mono tabular-nums"
    />
  );
}

export function ConfigForm({
  value,
  onChange,
  idPrefix = "cfg",
  compact = false,
}: {
  value: ConfigInput;
  onChange: (next: ConfigInput) => void;
  idPrefix?: string;
  compact?: boolean;
}) {
  const set = <K extends keyof ConfigInput>(key: K, v: ConfigInput[K]) => onChange(withSteps({ ...value, [key]: v }));
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3")}>
      <Field label="GPU type" htmlFor={id("gpu")}>
        <NativeSelect id={id("gpu")} value={value.gpuType} options={GPU_OPTIONS} onChange={(v) => set("gpuType", v as ConfigInput["gpuType"])} />
      </Field>
      <Field label="GPU count" htmlFor={id("count")}>
        <NumberInput id={id("count")} value={value.gpuCount} min={1} max={64} onChange={(v) => set("gpuCount", Math.round(v))} />
      </Field>
      <Field label="Model size (B params)" htmlFor={id("params")}>
        <NumberInput id={id("params")} value={value.paramsB} min={0.1} max={2000} step={0.1} onChange={(v) => set("paramsB", v)} />
      </Field>
      <Field label="Batch size" htmlFor={id("batch")}>
        <NumberInput id={id("batch")} value={value.batchSize} min={1} max={1024} onChange={(v) => set("batchSize", Math.round(v))} />
      </Field>
      <Field label="Sequence length" htmlFor={id("seq")}>
        <NumberInput id={id("seq")} value={value.sequenceLength} min={128} max={131072} step={128} onChange={(v) => set("sequenceLength", Math.round(v))} />
      </Field>
      <Field label="Precision" htmlFor={id("prec")}>
        <NativeSelect id={id("prec")} value={value.precision} options={PRECISION_OPTIONS} onChange={(v) => set("precision", v as ConfigInput["precision"])} />
      </Field>
      <Field label="Tokens (billions)" htmlFor={id("tokens")}>
        <NumberInput id={id("tokens")} value={Number((value.tokens / 1e9).toFixed(3))} min={0.001} max={10000} step={0.5} onChange={(v) => set("tokens", v * 1e9)} />
      </Field>
      <Field label="Epochs" htmlFor={id("epochs")}>
        <NumberInput id={id("epochs")} value={value.epochs} min={1} max={20} onChange={(v) => set("epochs", Math.round(v))} />
      </Field>
      <Field label="Workload type" htmlFor={id("wl")}>
        <NativeSelect id={id("wl")} value={value.workloadType} options={WORKLOAD_OPTIONS} onChange={(v) => set("workloadType", v as ConfigInput["workloadType"])} />
      </Field>
    </div>
  );
}
