import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "../../../api";
import type { RoomState } from "../../../types";
import { useI18n } from "../../../i18n";

export function PhasePlanPanel({ state }: { state: RoomState }) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const phases = useQuery({ queryKey: ["phases"], queryFn: () => api.phases() });
  const [insertPhaseId, setInsertPhaseId] = useState("");
  const insertPhase = useMutation({
    mutationFn: () => api.insertPhase(state.room.id, insertPhaseId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["room", state.room.id] })
  });
  const currentPhaseTemplate = phases.data?.find((phase) => phase.id === state.current_phase?.phase_template_id);
  return (
    <section>
      <div className="label">{t("panel.phase.current")}</div>
      <div className="mt-2 font-medium">{currentPhaseTemplate?.name ?? "-"}</div>
      <p className="mt-1 text-sm text-muted">{currentPhaseTemplate?.description}</p>
      <ol className="mt-4 space-y-2">
        {state.phase_plan.map((slot) => {
          const phase = phases.data?.find((item) => item.id === slot.phase_template_id);
          const active = slot.position === state.current_phase?.plan_position;
          return (
            <li
              key={`${slot.room_id}-${slot.position}`}
              className={`rounded-md border p-2 text-sm ${active ? "border-brand" : "border-border"}`}
            >
              <div className="font-medium">
                {slot.position + 1}. {phase?.name ?? slot.phase_template_id}
              </div>
              <div className="mt-0.5 text-xs text-muted">{slot.source}</div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex gap-2">
        <select
          name="insert-phase"
          className="input min-w-0 flex-1"
          value={insertPhaseId}
          onChange={(event) => setInsertPhaseId(event.target.value)}
        >
          <option value="">{t("panel.phase.insert")}</option>
          {(phases.data ?? []).map((phase) => (
            <option key={phase.id} value={phase.id}>
              {phase.name}
            </option>
          ))}
        </select>
        <button
          className="btn w-9 px-0"
          disabled={!insertPhaseId || state.runtime.frozen}
          onClick={() => insertPhase.mutate()}
          title={t("panel.phase.insert")}
        >
          <Plus size={16} />
        </button>
      </div>
    </section>
  );
}
