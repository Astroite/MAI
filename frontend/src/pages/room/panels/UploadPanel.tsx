import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { api } from "../../../api";

export function UploadPanel({ roomId, frozen }: { roomId: string; frozen: boolean }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputId = `upload-${roomId}`;
  const selectFile = (nextFile: File | null | undefined) => {
    if (!nextFile) return;
    setFile(nextFile);
  };
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) return;
      const saved = await api.upload(roomId, file);
      await api.messageFromUpload(roomId, saved.id);
    },
    onSuccess: () => {
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
    }
  });
  return (
    <section>
      <div className="label">文档上传</div>
      <label
        htmlFor={inputId}
        className={`mt-3 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-3 py-4 text-center text-sm transition ${
          isDragging ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:bg-surface"
        } ${frozen ? "cursor-not-allowed opacity-60" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!frozen) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (!frozen) selectFile(event.dataTransfer.files.item(0));
        }}
      >
        <FileUp size={18} />
        <span className="mt-2 font-medium">{file?.name ?? "拖入或选择文档"}</span>
        <span className="mt-1 text-xs text-muted">md / txt / pdf</span>
      </label>
      <input
        id={inputId}
        name="room-upload"
        className="sr-only"
        type="file"
        accept=".md,.txt,.pdf"
        disabled={frozen}
        onChange={(event) => selectFile(event.target.files?.[0])}
      />
      <button className="btn mt-3 w-full" disabled={!file || frozen || upload.isPending} onClick={() => upload.mutate()}>
        <FileUp size={16} />
        作为附件消息加入
      </button>
    </section>
  );
}
