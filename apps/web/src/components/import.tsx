import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage } from "../lib/api.js";
import { Badge, Button, Card, Dialog, ErrorBanner, Field, Input, Textarea } from "./ui.js";

interface ImportDraft {
  title: string;
  description: string;
  excerpt: string;
  confidence: number;
}

interface ImportAnalysis {
  id: string;
  status: string;
  error: string | null;
  output: { drafts?: ImportDraft[] };
}

/**
 * Transcript/thread import: paste text, get one draft per implicit ask with
 * source excerpts, accept or edit each into a real change request. Nothing
 * is created until the human accepts.
 */
export function ImportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }): JSX.Element {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [drafts, setDrafts] = useState<Array<ImportDraft & { accepted: boolean; edited: boolean }>>([]);
  const { register, handleSubmit, formState } = useForm<{ sourceText: string; sourceLabel: string }>({
    defaultValues: { sourceLabel: "transcript" },
  });

  const run = useMutation({
    mutationFn: (v: { sourceText: string; sourceLabel: string }) =>
      api.post<{ analysis: ImportAnalysis }>(`/projects/${projectId}/ai/import-changes`, v),
    onSuccess: (res) => {
      setAnalysis(res.analysis);
      setDrafts((res.analysis.output.drafts ?? []).map((d) => ({ ...d, accepted: false, edited: false })));
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const accept = useMutation({
    mutationFn: async (draft: ImportDraft) => {
      await api.post(`/projects/${projectId}/change-requests`, { title: draft.title, description: draft.description });
      await client.invalidateQueries({ queryKey: ["changes", projectId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const finish = async (): Promise<void> => {
    if (analysis && drafts.length > 0) {
      const accepted = drafts.filter((d) => d.accepted);
      const disposition = accepted.length === 0 ? "DISMISSED" : accepted.some((d) => d.edited) ? "EDITED" : "ACCEPTED";
      try {
        await api.patch(`/projects/${projectId}/ai/analyses/${analysis.id}`, { disposition });
      } catch {
        // Disposition is metrics-only; never block the human's workflow.
      }
    }
    onClose();
  };

  return (
    <Dialog title="Import from text" onClose={() => void finish()} wide>
      {!analysis ? (
        <form onSubmit={(e) => void handleSubmit((v) => run.mutate(v))(e)} className="space-y-3">
          <Field label="Source label" htmlFor="import-label">
            <Input id="import-label" {...register("sourceLabel", { required: true, maxLength: 200 })} placeholder="call transcript, email thread…" />
          </Field>
          <Field
            label="Paste the transcript or thread"
            htmlFor="import-text"
            error={formState.errors.sourceText?.message}
            hint={run.isPending ? "Reading…" : "One draft per implicit ask, each with the exact source excerpt. Treated as data, never instructions."}
          >
            <Textarea id="import-text" rows={8} {...register("sourceText", { required: "Paste some text first", minLength: 20, maxLength: 60000 })} />
          </Field>
          {error ? <ErrorBanner message={error} /> : null}
          <Button type="submit" disabled={run.isPending} className="w-full">
            {run.isPending ? "Reading…" : "Propose drafts"}
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          {analysis.status === "FALLBACK" ? (
            <ErrorBanner message={analysis.error ?? "AI is unavailable. Enter change requests manually."} />
          ) : null}
          {analysis.status === "FAILED" ? <ErrorBanner message={`Import failed: ${analysis.error ?? "unknown error"}`} /> : null}
          {drafts.length === 0 && analysis.status === "SUCCEEDED" ? (
            <p className="text-sm text-slate-600">No implicit asks found. Nothing to import.</p>
          ) : null}
          {drafts.map((d, i) => (
            <Card key={`${d.title}-${i}`}>
              {d.accepted ? (
                <p className="text-sm font-medium text-emerald-800">Accepted as a draft change ✓</p>
              ) : (
                <div className="space-y-2">
                  <Field label="Title" htmlFor={`draft-title-${i}`}>
                    <Input
                      id={`draft-title-${i}`}
                      value={d.title}
                      maxLength={200}
                      onChange={(e) =>
                        setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value, edited: true } : x)))
                      }
                    />
                  </Field>
                  <Field label="Description" htmlFor={`draft-desc-${i}`}>
                    <Textarea
                      id={`draft-desc-${i}`}
                      rows={3}
                      value={d.description}
                      maxLength={4000}
                      onChange={(e) =>
                        setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, description: e.target.value, edited: true } : x)))
                      }
                    />
                  </Field>
                  <blockquote className="border-l-2 border-slate-300 pl-2 text-sm italic text-slate-600">“{d.excerpt}”</blockquote>
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{Math.round(d.confidence * 100)}% confident</Badge>
                    <Button
                      size="sm"
                      disabled={accept.isPending || d.title.trim().length === 0}
                      onClick={() =>
                        accept.mutate(d, {
                          onSuccess: () => setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, accepted: true } : x))),
                        })
                      }
                    >
                      Accept as draft
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
          {error ? <ErrorBanner message={error} /> : null}
          <Button variant="secondary" className="w-full" onClick={() => void finish()}>Done</Button>
        </div>
      )}
    </Dialog>
  );
}
