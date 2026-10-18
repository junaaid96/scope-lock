import { useState } from "react";
import { api, errorMessage, putBytes, sha256Hex } from "../lib/api.js";
import type { AttachmentRow } from "../lib/types.js";
import { useLocale } from "../lib/i18n/index.js";
import { Button, ErrorBanner } from "./ui.js";

interface Intent {
  attachmentId: string;
  uploadUrl: string;
  expiresAt: string;
}

/** Full upload flow: intent → byte PUT → complete (scan runs server-side). */
export async function uploadFile(
  projectId: string,
  file: File,
  linked: { linkedType: "CHANGE" | "REQUIREMENT"; linkedId: string },
): Promise<AttachmentRow> {
  const bytes = await file.arrayBuffer();
  const checksum = await sha256Hex(bytes);
  const intent = await api.post<Intent>(`/projects/${projectId}/uploads/intents`, {
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: bytes.byteLength,
    checksumSha256: checksum,
    linkedType: linked.linkedType,
    linkedId: linked.linkedId,
  });
  await putBytes(intent.uploadUrl, bytes, file.type || "application/octet-stream");
  return api.post<AttachmentRow>(`/attachments/${intent.attachmentId}/complete`, { checksumSha256: checksum });
}

export function UploadBox({ projectId, linked, onDone }: {
  projectId: string;
  linked: { linkedType: "CHANGE" | "REQUIREMENT"; linkedId: string };
  onDone: () => void;
}): JSX.Element {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-teal-800 underline">
        <input
          type="file"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            setError(null);
            uploadFile(projectId, file, linked)
              .then(() => onDone())
              .catch((err: unknown) => setError(errorMessage(err)))
              .finally(() => setBusy(false));
          }}
        />
        {busy ? t("upload.uploading") : t("upload.attach")}
      </label>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
    </div>
  );
}

export function DownloadButton({ attachmentId, fileName }: { attachmentId: string; fileName: string }): JSX.Element {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        api.get<{ downloadUrl: string }>(`/attachments/${attachmentId}/download-url`)
          .then((res) => {
            const a = document.createElement("a");
            a.href = res.downloadUrl;
            a.download = fileName;
            a.rel = "noopener";
            document.body.appendChild(a);
            a.click();
            a.remove();
          })
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      {t("upload.download")}
    </Button>
  );
}
