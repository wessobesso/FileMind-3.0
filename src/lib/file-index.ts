import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { FileIndexComplete, FileIndexProgress } from "../types/file-index"

/** Resolve when the background file index pipeline is no longer running. */
export async function waitForFileIndexComplete(): Promise<void> {
  const running = await invoke<boolean>("is_file_index_running")
  if (!running) return

  return new Promise((resolve) => {
    let settled = false
    let unlistenComplete: (() => void) | null = null
    let unlistenProgress: (() => void) | null = null

    const finish = () => {
      if (settled) return
      settled = true
      unlistenComplete?.()
      unlistenProgress?.()
      resolve()
    }

    void listen<FileIndexComplete>("file-index-complete", finish).then((fn) => {
      unlistenComplete = fn
      void invoke<boolean>("is_file_index_running").then((stillRunning) => {
        if (!stillRunning) finish()
      })
    })

    void listen<FileIndexProgress>("file-index-progress", (event) => {
      if (!event.payload.running) finish()
    }).then((fn) => {
      unlistenProgress = fn
    })
  })
}
