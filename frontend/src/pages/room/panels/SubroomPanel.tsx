import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { GitBranchPlus, Merge } from "lucide-react";
import { api } from "../../../api";
import type { Room } from "../../../types";
import { useI18n } from "../../../i18n";
import { queryKeys } from "../../../queryKeys";

export function SubroomPanel({
  roomId,
  parentRoomId,
  title,
  recipeId,
  formatId,
  personaIds,
  childRooms
}: {
  roomId: string;
  parentRoomId?: string | null;
  title: string;
  recipeId?: string | null;
  formatId?: string;
  personaIds: string[];
  childRooms: Room[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, display } = useI18n();
  const [subroomTitle, setSubroomTitle] = useState(`${t("room.childRoom")}: ${title}`);
  const [conclusion, setConclusion] = useState("");
  const [keyReasoning, setKeyReasoning] = useState("");
  const [unresolved, setUnresolved] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api.createSubroom(roomId, {
        title: subroomTitle,
        // Inherit the parent's recipe so the subroom keeps its phase plan,
        // personas, and format. If the parent has no recipe, fall back to
        // the format + persona ids the parent currently uses so we don't
        // silently regress to the global default room shape.
        recipe_id: recipeId ?? null,
        format_id: recipeId ? undefined : formatId,
        persona_ids: recipeId ? [] : personaIds
      }),
    onSuccess: (state) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
      navigate(`/rooms/${roomId}/sub/${state.room.id}`);
    }
  });
  const merge = useMutation({
    mutationFn: () =>
      api.mergeBack(roomId, {
        conclusion,
        key_reasoning: keyReasoning
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 3),
        unresolved: unresolved
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        rejected_alternatives: [],
        artifacts_ref: {}
      }),
    onSuccess: () => {
      if (parentRoomId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.room(parentRoomId) });
        navigate(`/rooms/${parentRoomId}`);
      }
    }
  });

  if (parentRoomId) {
    return (
      <section>
        <div className="label">{t("panel.subroom.merge")}</div>
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs text-muted">{t("panel.subroom.conclusion")}</span>
            <textarea
              name="merge-conclusion"
              className="textarea mt-1 w-full"
              value={conclusion}
              onChange={(event) => setConclusion(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">{t("panel.subroom.keyReasoning")}</span>
            <textarea
              name="merge-key-reasoning"
              className="textarea mt-1 w-full"
              value={keyReasoning}
              onChange={(event) => setKeyReasoning(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">{t("panel.subroom.unresolved")}</span>
            <textarea
              name="merge-unresolved"
              className="textarea mt-1 w-full"
              value={unresolved}
              onChange={(event) => setUnresolved(event.target.value)}
            />
          </label>
          <button
            className="btn btn-primary w-full"
            disabled={!conclusion.trim() || merge.isPending}
            onClick={() => merge.mutate()}
          >
            <Merge size={16} />
            {t("panel.subroom.submitMerge")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="label">{t("panel.subroom.title")}</div>
      <div className="mt-3 space-y-2">
        {childRooms.map((room) => (
          <Link
            key={room.id}
            className="block rounded-md border border-border bg-panel p-2 text-sm shadow-card hover:border-brand"
            to={`/rooms/${roomId}/sub/${room.id}`}
          >
            <span className="font-medium">{room.title}</span>
            <span className="mt-0.5 block text-xs text-muted">{display("roomStatus", room.status)}</span>
          </Link>
        ))}
        {!childRooms.length && <div className="text-sm text-muted">{t("panel.subroom.empty")}</div>}
      </div>
      <div className="mt-4 space-y-2">
        <input
          name="subroom-title"
          className="input w-full"
          value={subroomTitle}
          onChange={(event) => setSubroomTitle(event.target.value)}
        />
        <button className="btn w-full" disabled={!subroomTitle.trim() || create.isPending} onClick={() => create.mutate()}>
          <GitBranchPlus size={16} />
          {t("panel.subroom.open")}
        </button>
      </div>
    </section>
  );
}
