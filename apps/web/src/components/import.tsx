import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
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
  const { t } = useLocale();
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
    <Dialog title={t("textImport.title")} onClose={() => void finish()} wide>
      {!analysis ? (
        <form onSubmit={(e) => void handleSubmit((v) => run.mutate(v))(e)} className="space-y-3">
          <Field label={t("textImport.sourceLabel")} htmlFor="import-label">
            <Input id="import-label" {...register("sourceLabel", { required: true, maxLength: 200 })} placeholder={t("textImport.sourceLabelPlaceholder")} />
          </Field>
          <Field
            label={t("textImport.sourceTextLabel")}
            htmlFor="import-text"
            error={formState.errors.sourceText?.message}
            hint={run.isPending ? t("textImport.reading") : t("textImport.hint")}
          >
            <Textarea id="import-text" rows={8} {...register("sourceText", { required: t("textImport.pasteFirst"), minLength: 20, maxLength: 60000 })} />
          </Field>
          {error ? <ErrorBanner message={error} /> : null}
          <Button type="submit" disabled={run.isPending} className="w-full">
            {run.isPending ? t("textImport.reading") : t("textImport.propose")}
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          {analysis.status === "FALLBACK" ? (
            <ErrorBanner message={analysis.error ?? t("textImport.aiUnavailable")} />
          ) : null}
          {analysis.status === "FAILED" ? <ErrorBanner message={t("textImport.importFailed", { error: analysis.error ?? t("textImport.unknownError") })} /> : null}
          {drafts.length === 0 && analysis.status === "SUCCEEDED" ? (
            <p className="text-sm text-slate-600">{t("textImport.noAsks")}</p>
          ) : null}
          {drafts.map((d, i) => (
            <Card key={`${d.title}-${i}`}>
              {d.accepted ? (
                <p className="text-sm font-medium text-emerald-800">{t("textImport.accepted")}</p>
              ) : (
                <div className="space-y-2">
                  <Field label={t("textImport.draftTitle")} htmlFor={`draft-title-${i}`}>
                    <Input
                      id={`draft-title-${i}`}
                      value={d.title}
                      maxLength={200}
                      onChange={(e) =>
                        setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value, edited: true } : x)))
                      }
                    />
                  </Field>
                  <Field label={t("textImport.draftDescription")} htmlFor={`draft-desc-${i}`}>
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
                    <Badge tone="slate">{t("textImport.confident", { pct: Math.round(d.confidence * 100) })}</Badge>
                    <Button
                      size="sm"
                      disabled={accept.isPending || d.title.trim().length === 0}
                      onClick={() =>
                        accept.mutate(d, {
                          onSuccess: () => setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, accepted: true } : x))),
                        })
                      }
                    >
                      {t("textImport.accept")}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
          {error ? <ErrorBanner message={error} /> : null}
          <Button variant="secondary" className="w-full" onClick={() => void finish()}>{t("textImport.done")}</Button>
        </div>
      )}
    </Dialog>
  );
}
