export type SceneRoomLike = {
  world_id?: string | null;
};

export function isSceneRoom(room?: SceneRoomLike | null): room is SceneRoomLike & { world_id: string } {
  return Boolean(room?.world_id);
}
