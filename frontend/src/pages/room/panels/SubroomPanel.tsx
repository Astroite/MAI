import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { GitBranchPlus, Merge } from "lucide-react";
import { api } from "../../../api";
import type { Room } from "../../../types";

export function SubroomPanel({
  roomId,
  parentRoomId,
  title,
  formatId,
  personaIds,
  childRooms
}: {
  roomId: string;
  parentRoomId?: string | null;
  title: string;
  formatId?: string;
  personaIds: string[];
  childRooms: Room[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [subroomTitle, setSubroomTitle] = useState(`子讨论：${title}`);
  const [conclusion, setConclusion] = useState("");
  const [keyReasoning, setKeyReasoning] = useState("");
  const [unresolved, setUnresolved] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api.createSubroom(roomId, {
        title: subroomTitle,
        format_id: formatId,
        persona_ids: personaIds
      }),
    onSuccess: (state) => {
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
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
        void queryClient.invalidateQueries({ queryKey: ["room", parentRoomId] });
        navigate(`/rooms/${parentRoomId}`);
      }
    }
  });

  if (parentRoomId) {
    return (
      <section>
        <div className="label">合并回父讨论</div>
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs text-muted">结论</span>
            <textarea
              name="merge-conclusion"
              className="textarea mt-1 w-full"
              value={conclusion}
              onChange={(event) => setConclusion(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">关键推理，每行一条</span>
            <textarea
              name="merge-key-reasoning"
              className="textarea mt-1 w-full"
              value={keyReasoning}
              onChange={(event) => setKeyReasoning(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">未解决问题，每行一条</span>
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
            合并
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="label">子讨论</div>
      <div className="mt-3 space-y-2">
        {childRooms.map((room) => (
          <Link
            key={room.id}
            className="block rounded-md border border-border p-2 text-sm hover:border-brand"
            to={`/rooms/${roomId}/sub/${room.id}`}
          >
            <span className="font-medium">{room.title}</span>
            <span className="mt-0.5 block text-xs text-muted">{room.status}</span>
          </Link>
        ))}
        {!childRooms.length && <div className="text-sm text-muted">暂无子讨论</div>}
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
          开子讨论
        </button>
      </div>
    </section>
  );
}
