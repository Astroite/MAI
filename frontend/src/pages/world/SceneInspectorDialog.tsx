import { useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueries } from "@tanstack/react-query";
import { Heart, ScrollText, X } from "lucide-react";
import { api } from "../../api";
import { PersonaIcon } from "../../components/PersonaIcon";
import type { SceneTimelineEntry, WorldCharacter, WorldCharacterMemory, WorldCharacterRelation } from "../../types";

/**
 * Read-only inspector for "what did this scene actually produce?"
 *
 * After sealing a scene the LLM scribe writes new memory rows + updates
 * relation cards per AI character. Without a UI for this the user has no
 * way to verify the scribe ran correctly. Filters are by source/last-update
 * scene id so previous-scene history doesn't pollute the view.
 *
 * AI characters only — user characters don't have memory pipelines.
 */
export function SceneInspectorDialog({
  open,
  onOpenChange,
  worldId,
  scene,
  rosterCharacters
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldId: string;
  scene: SceneTimelineEntry | null;
  rosterCharacters: WorldCharacter[];
}) {
  const aiRoster = useMemo(
    () => rosterCharacters.filter((c) => c.kind === "ai"),
    [rosterCharacters]
  );
  const sceneId = scene?.id ?? "";
  // Run one memory + one relation query per character. React Query keys
  // make these auto-cached; the dialog reopening for the same scene/char
  // hits the cache.
  const memoryQueries = useQueries({
    queries: aiRoster.map((character) => ({
      queryKey: ["character-memories", worldId, character.id],
      queryFn: () => api.characterMemories(worldId, character.id),
      enabled: open && Boolean(sceneId)
    }))
  });
  const relationQueries = useQueries({
    queries: aiRoster.map((character) => ({
      queryKey: ["character-relations", worldId, character.id],
      queryFn: () => api.characterRelations(worldId, character.id),
      enabled: open && Boolean(sceneId)
    }))
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[80vh] w-[92vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-panel shadow-soft">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-semibold text-text">
                {scene ? `第 ${scene.scene_index} 幕：${scene.title}` : "本幕产出"}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted">
                封幕后由 LLM 提炼出来的角色记忆与关系卡变更（仅 AI 角色）。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-surface hover:text-text"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="mai-scrollbar min-h-0 flex-1 overflow-auto p-4">
            {!scene && (
              <div className="grid h-full place-items-center text-sm text-muted">
                未选中场景。
              </div>
            )}
            {scene && aiRoster.length === 0 && (
              <div className="grid h-full place-items-center text-sm text-muted">
                本幕没有 AI 角色，没有记忆/关系产出。
              </div>
            )}
            {scene && aiRoster.length > 0 && (
              <ul className="space-y-4">
                {aiRoster.map((character, index) => {
                  const memQuery = memoryQueries[index];
                  const relQuery = relationQueries[index];
                  const memoriesAll = memQuery.data ?? [];
                  const relationsAll = relQuery.data ?? [];
                  const sceneMemories = memoriesAll.filter(
                    (m) => m.source_scene_id === scene.id
                  );
                  const sceneRelations = relationsAll.filter(
                    (r) => r.last_updated_scene_id === scene.id
                  );
                  const peerLookup = new Map(rosterCharacters.map((c) => [c.id, c]));
                  return (
                    <CharacterInspectorBlock
                      key={character.id}
                      character={character}
                      memories={sceneMemories}
                      relations={sceneRelations}
                      peerLookup={peerLookup}
                      isLoading={memQuery.isLoading || relQuery.isLoading}
                    />
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <Dialog.Close asChild>
              <button type="button" className="btn">
                关闭
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CharacterInspectorBlock({
  character,
  memories,
  relations,
  peerLookup,
  isLoading
}: {
  character: WorldCharacter;
  memories: WorldCharacterMemory[];
  relations: WorldCharacterRelation[];
  peerLookup: Map<string, WorldCharacter>;
  isLoading: boolean;
}) {
  const empty = !isLoading && memories.length === 0 && relations.length === 0;
  return (
    <li className="rounded-md border border-border p-3">
      <header className="mb-3 flex items-center gap-2">
        <PersonaIcon icon={character.icon} color={character.color} size={32} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{character.name}</span>
            {character.identity && (
              <span className="text-xs text-muted">（{character.identity}）</span>
            )}
          </div>
          {isLoading && <div className="text-xs text-muted">加载中…</div>}
        </div>
      </header>

      {empty && (
        <div className="rounded bg-surface px-3 py-2 text-xs text-muted">
          本幕没有为此角色产出新记忆或关系卡变更。可能 LLM scribe 失败（看 backend trace
          里的 scene_memory_failed 事件），或者本幕场景里这个角色没什么值得记的。
        </div>
      )}

      {memories.length > 0 && (
        <section className="mb-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
            <ScrollText size={12} />
            新记忆（{memories.length}）
          </div>
          <ul className="space-y-1">
            {memories.map((memory) => (
              <li
                key={memory.id}
                className="rounded border border-border bg-surface px-2 py-1.5 text-xs"
              >
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
                  <span>{KIND_LABEL[memory.kind] ?? memory.kind}</span>
                  <span>·</span>
                  <span>salience {memory.salience.toFixed(2)}</span>
                  {memory.in_world_time_at_event && (
                    <>
                      <span>·</span>
                      <span>{memory.in_world_time_at_event}</span>
                    </>
                  )}
                </div>
                <div className="mt-0.5 whitespace-pre-wrap text-text">{memory.content}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {relations.length > 0 && (
        <section>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Heart size={12} />
            关系卡变更（{relations.length}）
          </div>
          <ul className="space-y-1">
            {relations.map((relation) => {
              const target = peerLookup.get(relation.to_character_id);
              return (
                <li
                  key={relation.id}
                  className="rounded border border-border bg-surface px-2 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    {target ? (
                      <PersonaIcon icon={target.icon} color={target.color} size={20} />
                    ) : (
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-panel text-xs text-muted">
                        ?
                      </span>
                    )}
                    <span className="font-medium text-text">
                      → {target?.name ?? relation.to_character_id}
                    </span>
                    <span
                      className={`text-xs ${
                        relation.sentiment > 0
                          ? "text-success"
                          : relation.sentiment < 0
                            ? "text-danger"
                            : "text-muted"
                      }`}
                    >
                      {relation.label || "（未命名）"} {relation.sentiment >= 0 ? "+" : ""}
                      {relation.sentiment.toFixed(2)}
                    </span>
                  </div>
                  {relation.notes && (
                    <div className="mt-1 whitespace-pre-wrap text-muted">{relation.notes}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </li>
  );
}

const KIND_LABEL: Record<string, string> = {
  episode: "经历",
  vow: "誓言",
  impression: "印象",
  fact: "事实",
  backstory: "背景"
};
