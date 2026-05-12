import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, CheckCircle2, RefreshCw, Save, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api";
import { toast } from "../../components/Toaster";
import { useI18n } from "../../i18n";
import type {
  SceneSealDraft,
  SealDraftMemoryUpdate,
  SealDraftRelationshipUpdate,
  SealDraftTimelineEvent
} from "../../types";

export function SealResultsDialog({
  roomId,
  draft,
  onDraftChange,
  onClose,
  onCommitted
}: {
  roomId: string | null | undefined;
  draft: SceneSealDraft | null;
  onDraftChange: (draft: SceneSealDraft | null) => void;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const { t } = useI18n();
  const [summary, setSummary] = useState("");
  const [dateLabel, setDateLabel] = useState("");
  const [location, setLocation] = useState("");
  const [timelineEvents, setTimelineEvents] = useState<SealDraftTimelineEvent[]>([]);
  const [memoryUpdates, setMemoryUpdates] = useState<SealDraftMemoryUpdate[]>([]);
  const [relationshipUpdates, setRelationshipUpdates] = useState<SealDraftRelationshipUpdate[]>([]);

  useEffect(() => {
    if (!draft) return;
    setSummary(draft.scene_summary);
    setDateLabel(draft.date_label);
    setLocation(draft.location);
    setTimelineEvents(draft.timeline_events ?? []);
    setMemoryUpdates(draft.memory_updates ?? []);
    setRelationshipUpdates(draft.relationship_updates ?? []);
  }, [draft]);

  const retry = useMutation({
    mutationFn: () => api.retrySealDraft(roomId!, draft!.id),
    onSuccess: (nextDraft) => {
      onDraftChange(nextDraft);
      toast.success(t("sealResults.retryReady"));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });

  const commit = useMutation({
    mutationFn: async () => {
      if (!roomId || !draft) throw new Error("missing seal draft");
      await api.updateSealDraft(roomId, draft.id, {
        scene_summary: summary.trim(),
        date_label: dateLabel.trim(),
        location: location.trim(),
        timeline_events: timelineEvents,
        memory_updates: memoryUpdates,
        relationship_updates: relationshipUpdates
      });
      return api.commitSealDraft(roomId, draft.id);
    },
    onSuccess: () => {
      toast.success(t("room.scene.sealSuccess"));
      onCommitted();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });

  const ready = draft?.status === "ready";
  const selectedCounts = {
    timeline: timelineEvents.filter((item) => item.selected !== false).length,
    memory: memoryUpdates.filter((item) => item.selected !== false).length,
    relationship: relationshipUpdates.filter((item) => item.selected !== false).length
  };

  return (
    <Dialog.Root open={Boolean(draft)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[86vh] w-[94vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-panel shadow-soft">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-text">
                {t("sealResults.title")}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted">
                {t("sealResults.description")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-surface hover:text-text"
                aria-label={t("common.close")}
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="mai-scrollbar min-h-0 flex-1 overflow-auto p-5">
            {!draft ? null : (
              <div className="space-y-4">
                {draft.status === "failed" && (
                  <div className="flex gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>{draft.error || t("sealResults.failedDraft")}</span>
                  </div>
                )}

                {draft.warnings.length > 0 && (
                  <section className="rounded-md border border-warning/30 bg-warning/10 p-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-warning">
                      <AlertTriangle size={15} />
                      {t("sealResults.warnings")}
                    </h3>
                    <ul className="mt-2 space-y-1 text-xs text-warning">
                      {draft.warnings.map((warning) => (
                        <li key={warning.id}>{warning.message}</li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="rounded-md border border-border p-3">
                  <h3 className="text-sm font-semibold">{t("sealResults.sceneSummary")}</h3>
                  <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr]">
                    <input
                      className="input"
                      value={dateLabel}
                      onChange={(event) => setDateLabel(event.target.value)}
                      placeholder={t("sealResults.datePlaceholder")}
                    />
                    <input
                      className="input"
                      value={location}
                      onChange={(event) => setLocation(event.target.value)}
                      placeholder={t("sealResults.locationPlaceholder")}
                    />
                  </div>
                  <textarea
                    className="textarea mt-2 w-full"
                    rows={5}
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                  />
                </section>

                <DraftSection
                  title={t("sealResults.timelineEvents", { count: selectedCounts.timeline })}
                  empty={t("sealResults.timelineEmpty")}
                >
                  {timelineEvents.map((item, index) => (
                    <TimelineDraftItem
                      key={item.id}
                      item={item}
                      onChange={(next) => replaceAt(timelineEvents, setTimelineEvents, index, next)}
                    />
                  ))}
                </DraftSection>

                <DraftSection
                  title={t("sealResults.memoryUpdates", { count: selectedCounts.memory })}
                  empty={t("sealResults.memoryEmpty")}
                >
                  {memoryUpdates.map((item, index) => (
                    <MemoryDraftItem
                      key={item.id}
                      item={item}
                      onChange={(next) => replaceAt(memoryUpdates, setMemoryUpdates, index, next)}
                    />
                  ))}
                </DraftSection>

                <DraftSection
                  title={t("sealResults.relationshipUpdates", { count: selectedCounts.relationship })}
                  empty={t("sealResults.relationshipEmpty")}
                >
                  {relationshipUpdates.map((item, index) => (
                    <RelationshipDraftItem
                      key={item.id}
                      item={item}
                      onChange={(next) => replaceAt(relationshipUpdates, setRelationshipUpdates, index, next)}
                    />
                  ))}
                </DraftSection>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
            <button
              type="button"
              className="btn"
              disabled={!draft || retry.isPending || commit.isPending || draft.status === "committed"}
              onClick={() => retry.mutate()}
            >
              <RefreshCw size={15} />
              {retry.isPending ? t("sealResults.retrying") : t("sealResults.retry")}
            </button>
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <button type="button" className="btn">
                  {t("common.cancel")}
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!ready || commit.isPending}
                onClick={() => commit.mutate()}
              >
                {commit.isPending ? <RefreshCw size={15} /> : <Save size={15} />}
                {commit.isPending ? t("sealResults.committing") : t("sealResults.commit")}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DraftSection({
  title,
  empty,
  children
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const childArray = Array.isArray(children) ? children : [children];
  return (
    <section className="rounded-md border border-border p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 space-y-2">
        {childArray.length > 0 && childArray.some(Boolean) ? children : (
          <div className="rounded-md bg-surface px-3 py-2 text-sm text-muted">{empty}</div>
        )}
      </div>
    </section>
  );
}

function TimelineDraftItem({
  item,
  onChange
}: {
  item: SealDraftTimelineEvent;
  onChange: (item: SealDraftTimelineEvent) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-md bg-surface p-3">
      <DraftCheck selected={item.selected} onChange={(selected) => onChange({ ...item, selected })} />
      <div className="mt-2 grid gap-2 md:grid-cols-[180px_minmax(0,1fr)]">
        <input
          className="input"
          value={item.dateLabel ?? ""}
          onChange={(event) => onChange({ ...item, dateLabel: event.target.value })}
          placeholder={t("sealResults.datePlaceholder")}
        />
        <input
          className="input"
          value={item.title}
          onChange={(event) => onChange({ ...item, title: event.target.value })}
        />
      </div>
      <textarea
        className="textarea mt-2 w-full"
        rows={2}
        value={item.summary}
        onChange={(event) => onChange({ ...item, summary: event.target.value })}
      />
    </div>
  );
}

function MemoryDraftItem({
  item,
  onChange
}: {
  item: SealDraftMemoryUpdate;
  onChange: (item: SealDraftMemoryUpdate) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-md bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <DraftCheck selected={item.selected} onChange={(selected) => onChange({ ...item, selected })} />
        <span className="text-sm font-medium">{item.characterName || item.characterId}</span>
        <span className="rounded-full border border-border bg-panel px-2 py-0.5 text-xs text-muted">
          {item.type}
        </span>
        <select
          className="input h-8 w-auto text-xs"
          value={item.importance ?? "medium"}
          onChange={(event) => onChange({ ...item, importance: event.target.value as SealDraftMemoryUpdate["importance"] })}
        >
          {(["low", "medium", "high", "critical"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`sealResults.importance.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="textarea mt-2 w-full"
        rows={2}
        value={item.content}
        onChange={(event) => onChange({ ...item, content: event.target.value })}
      />
    </div>
  );
}

function RelationshipDraftItem({
  item,
  onChange
}: {
  item: SealDraftRelationshipUpdate;
  onChange: (item: SealDraftRelationshipUpdate) => void;
}) {
  return (
    <div className="rounded-md bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <DraftCheck selected={item.selected} onChange={(selected) => onChange({ ...item, selected })} />
        <span className="text-sm font-medium">
          {item.fromCharacterName || item.fromCharacterId} {"->"} {item.toCharacterName || item.toCharacterId}
        </span>
        <span className="rounded-full border border-border bg-panel px-2 py-0.5 text-xs text-muted">
          {item.sentimentDelta && item.sentimentDelta >= 0 ? "+" : ""}
          {(item.sentimentDelta ?? 0).toFixed(2)}
        </span>
      </div>
      <input
        className="input mt-2 w-full"
        value={item.label}
        onChange={(event) => onChange({ ...item, label: event.target.value })}
      />
      <textarea
        className="textarea mt-2 w-full"
        rows={2}
        value={item.description}
        onChange={(event) => onChange({ ...item, description: event.target.value })}
      />
    </div>
  );
}

function DraftCheck({
  selected,
  onChange
}: {
  selected: boolean;
  onChange: (selected: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-xs ${
        selected
          ? "border-success/40 bg-success/10 text-success"
          : "border-border bg-panel text-muted"
      }`}
      onClick={() => onChange(!selected)}
    >
      <CheckCircle2 size={13} />
      {selected ? t("sealResults.selected") : t("sealResults.unselected")}
    </button>
  );
}

function replaceAt<T>(items: T[], setItems: (items: T[]) => void, index: number, value: T) {
  const next = items.slice();
  next[index] = value;
  setItems(next);
}
