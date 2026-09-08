import { useCallback, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { isDownloadCancelled } from "../lib/model-download"
import type { DownloadProgress } from "../types/model-download"

interface RunDownloadOptions {
  /** Start llama-server after a successful download (default: true). */
  startServer?: boolean
}

export function useModelDownload() {
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const unlistenRef = useRef<(() => void) | null>(null)

  const cancelDownload = useCallback(async () => {
    try {
      await invoke("cancel_model_download")
    } catch (err) {
      console.error("Failed to cancel download:", err)
    }
  }, [])

  const runDownload = useCallback(
    async (options?: RunDownloadOptions): Promise<"success" | "cancelled" | "error"> => {
      const startServer = options?.startServer !== false

      setDownloading(true)
      setError(null)
      setProgress(null)

      if (unlistenRef.current) {
        unlistenRef.current()
        unlistenRef.current = null
      }

      const unlisten = await listen<DownloadProgress>("model-download-progress", (event) => {
        setProgress(event.payload)
      })
      unlistenRef.current = unlisten

      try {
        await invoke("download_model")
        if (startServer) {
          await invoke("start_llama_server")
        }
        return "success"
      } catch (err) {
        if (isDownloadCancelled(err)) {
          return "cancelled"
        }
        setError(err instanceof Error ? err.message : String(err))
        return "error"
      } finally {
        unlisten()
        unlistenRef.current = null
        setDownloading(false)
        setProgress(null)
      }
    },
    []
  )

  return {
    downloading,
    progress,
    error,
    setError,
    cancelDownload,
    runDownload,
  }
}
