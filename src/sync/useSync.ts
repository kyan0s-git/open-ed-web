import { useSyncExternalStore } from "react";
import { syncEngine, type SyncStatus } from "./engine";

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => syncEngine.subscribe(listener),
    () => syncEngine.status,
  );
}
