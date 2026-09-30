import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, ErrorBlock, PageHeader, Panel, StatTile } from "@/components/common/Panel";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMockData } from "@/lib/mock-data";
import { cleanUpload, fetchDatasetMeta, fetchSampleDataset, profileUpload } from "@/lib/api/acg.functions";
import { downloadText } from "@/lib/download";
import { formatNumber } from "@/lib/format";

export const Route = createFileRoute("/datasets")({
  head: () => ({
    meta: [
      { title: "Dataset Management — AIComputeGuard" },
      { name: "description", content: "Upload training logs, GPU metrics or billing exports; profile quality and clean them automatically." },
      { property: "og:title", content: "Dataset Management — AIComputeGuard" },
      { property: "og:description", content: "Upload, profile and clean AI infrastructure datasets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DatasetsPage,
});

type Profile = Awaited<ReturnType<typeof fetchSampleDataset>>["profile"];
type Rows = Record<string, unknown>[];

function ProfileView({ profile, headers, rows }: { profile: Profile; headers: string[]; rows: Rows }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Quality score" value={String(profile.qualityScore)} tone={profile.qualityScore >= 80 ? "good" : profile.qualityScore >= 60 ? "warn" : "bad"} />
        <StatTile label="Rows × columns" value={`${formatNumber(profile.rows)} × ${profile.columns}`} />
        <StatTile label="Missing cells" value={formatNumber(profile.missingCells)} hint={`${profile.missingPct}%`} />
        <StatTile label="Duplicate rows" value={formatNumber(profile.duplicateRows)} />
        <StatTile label="Outlier cells" value={formatNumber(profile.outlierCells)} />
        <StatTile label="Recognized as" value={profile.schema.recognizedAs} hint={profile.schema.missingRequired.length ? `missing: ${profile.schema.missingRequired.join(", ")}` : "all key columns present"} />
      </div>
      <Panel title="Columns">
        <div className="max-h-96 overflow-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Column</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Missing</TableHead><TableHead className="text-right">Unique</TableHead><TableHead className="text-right">Outliers</TableHead><TableHead className="text-right">Min</TableHead><TableHead className="text-right">Mean</TableHead><TableHead className="text-right">Max</TableHead></TableRow></TableHeader>
            <TableBody>
              {profile.columnProfiles.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="font-mono text-xs">{c.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.inferredType}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{c.missingPct}%</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatNumber(c.unique)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{c.outliers}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{c.min ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{c.mean ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{c.max ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>
      <Panel title="Preview" description="First 25 rows">
        <div className="max-h-96 overflow-auto">
          <Table>
            <TableHeader><TableRow>{headers.map((h) => <TableHead key={h} className="whitespace-nowrap text-xs">{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>{headers.map((h) => <TableCell key={h} className="whitespace-nowrap font-mono text-xs">{r[h] == null ? "—" : String(r[h])}</TableCell>)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>
    </>
  );
}

function DatasetsPage() {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const mock = useMockData();
  const meta = useQuery({ queryKey: ["dataset-meta"], queryFn: () => fetchDatasetMeta(), enabled: mock.loaded });
  const profile = useMutation({ mutationFn: (f: { name: string; content: string }) => profileUpload({ data: { fileName: f.name, content: f.content } }) });
  const sample = useMutation({ mutationFn: () => fetchSampleDataset({ data: { limit: 1000 } }) });
  const clean = useMutation({ mutationFn: (f: { name: string; content: string }) => cleanUpload({ data: { fileName: f.name, content: f.content } }) });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 4_000_000) {
      profile.reset();
      alert("Please choose a file under 4 MB.");
      return;
    }
    const content = await f.text();
    const next = { name: f.name, content };
    setFile(next);
    sample.reset();
    clean.reset();
    profile.mutate(next);
  };

  const loadSample = async () => {
    const s = await sample.mutateAsync();
    setFile({ name: s.fileName, content: s.csv });
    profile.reset();
    clean.reset();
  };

  const active = profile.data?.ok
    ? { profile: profile.data.profile, headers: profile.data.headers, rows: profile.data.preview as Rows }
    : sample.data
      ? { profile: sample.data.profile, headers: sample.data.headers, rows: sample.data.rows as Rows }
      : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Dataset Management" description="Bring your own training logs, GPU metrics, billing or token-usage files (CSV or JSON, up to 4 MB)." />
      <Panel title="Load data">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-raised">
            <input type="file" accept=".csv,.json,.tsv,.txt" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
            Upload a file
          </label>
          <Button variant="outline" onClick={() => void loadSample()} disabled={sample.isPending || !mock.loaded} title={mock.loaded ? undefined : "Load mock data first"}>{sample.isPending ? "Loading…" : "Use sample dataset"}</Button>
          <Button onClick={() => file && clean.mutate(file)} disabled={!file || clean.isPending}>{clean.isPending ? "Cleaning…" : "Clean & add features"}</Button>
          {file ? <span className="text-xs text-muted-foreground">Loaded: <span className="font-mono">{file.name}</span></span> : null}
        </div>
        {mock.loaded && meta.data ? (
          <p className="mt-3 text-xs text-muted-foreground">Mock dataset loaded: {meta.data.jobs.toLocaleString()} jobs · {meta.data.telemetry.toLocaleString()} telemetry points.</p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No mock data loaded — upload your own file, or press “Load Mock” at the top to use the sample dataset.</p>
        )}
      </Panel>

      {profile.error ? <ErrorBlock error={profile.error} /> : null}
      {profile.data && !profile.data.ok ? <ErrorBlock error={new Error(profile.data.error)} /> : null}
      {clean.error ? <ErrorBlock error={clean.error} /> : null}
      {clean.data && !clean.data.ok ? <ErrorBlock error={new Error(clean.data.error)} /> : null}

      {clean.data?.ok ? (
        <Panel
          title="Cleaning report"
          description={`Quality ${clean.data.before.qualityScore} → ${clean.data.after.qualityScore}`}
          actions={<Button size="sm" onClick={() => clean.data?.ok && downloadText("cleaned_dataset.csv", clean.data.csv, "text/csv")}>Download cleaned CSV</Button>}
        >
          <div className="space-y-1.5">
            {clean.data.steps.map((s) => (
              <div key={s.step} className="flex justify-between gap-3 text-xs">
                <span>{s.step} <span className="text-muted-foreground">· {s.detail}</span></span>
                <span className="font-mono">{formatNumber(s.affected)}</span>
              </div>
            ))}
          </div>
          {clean.data.engineeredFeatures.length ? <p className="mt-3 text-xs text-muted-foreground">New columns: <span className="font-mono">{clean.data.engineeredFeatures.join(", ")}</span></p> : null}
          {clean.data.truncated ? <p className="mt-1 text-[11px] text-warning">Download is limited to the first 5,000 rows.</p> : null}
        </Panel>
      ) : null}

      {active ? <ProfileView {...active} /> : <EmptyState title="No dataset loaded" description="Upload a file or use the sample dataset to see a quality profile." />}
    </div>
  );
}
