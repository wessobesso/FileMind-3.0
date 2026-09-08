import { useCallback, useEffect, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { Download, Loader2 } from "lucide-react"
import { useModelDownload } from "../hooks/useModelDownload"
import { waitForFileIndexComplete } from "../lib/file-index"
import type { DownloadProgress } from "../types/model-download"
import type { FileIndexProgress } from "../types/file-index"

const MODEL_NAME = "Qwen3-4B-Q4_K_M"
const MODEL_FILENAME = "Qwen3-4B-Q4_K_M.gguf"
const MODEL_SIZE_HINT = "~2.5 GB"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function buildSetupStatusLabel(
  progress: DownloadProgress | null,
  indexProgress: FileIndexProgress | null,
  isInstalling: boolean,
  modelInstallComplete: boolean,
): string {
  const parts: string[] = []

  if (!modelInstallComplete) {
    const downloadComplete =
      progress?.total != null && progress.downloaded >= progress.total
    const downloadActive = isInstalling && !downloadComplete

    if (downloadActive) {
      if (progress && progress.downloaded > 0) {
        parts.push(`Downloading ${MODEL_FILENAME} from Hugging Face`)
      } else {
        parts.push("Connecting to Hugging Face")
      }
    } else if (isInstalling && downloadComplete) {
      parts.push("Starting local AI server")
    }
  }

  if (indexProgress?.running || (modelInstallComplete && indexProgress)) {
    if (indexProgress && indexProgress.total > 0) {
      parts.push(`Indexing files (${indexProgress.indexed}/${indexProgress.total})`)
    } else {
      parts.push("Scanning your files")
    }
  }

  if (parts.length === 0) {
    return isInstalling ? "Preparing setup…" : "Setting up…"
  }

  return parts.join(" · ")
}

type SetupStatus = "prompt" | "downloading" | "error"

interface ModelSetupProps {
  onComplete: () => void
  onSkip: () => void
}

export default function ModelSetup({ onComplete, onSkip }: ModelSetupProps) {
  const { downloading, progress, error, setError, cancelDownload, runDownload } =
    useModelDownload()
  const [status, setStatus] = useState<SetupStatus>("prompt")
  const [indexProgress, setIndexProgress] = useState<FileIndexProgress | null>(null)
  const [modelInstallComplete, setModelInstallComplete] = useState(false)

  useEffect(() => {
    if (!downloading && status !== "downloading") {
      setIndexProgress(null)
      return
    }

    const unlisten = listen<FileIndexProgress>("file-index-progress", (event) => {
      setIndexProgress(event.payload)
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [downloading, status])

  const runInstall = useCallback(async () => {
    setStatus("downloading")
    setModelInstallComplete(false)
    setError(null)

    const result = await runDownload({ startServer: true })

    if (result === "cancelled") {
      setStatus("prompt")
      setModelInstallComplete(false)
      return
    }

    if (result === "error") {
      setStatus("error")
      setModelInstallComplete(false)
      return
    }

    setModelInstallComplete(true)
    await waitForFileIndexComplete()
    onComplete()
  }, [onComplete, runDownload, setError])

  const handleCancel = useCallback(async () => {
    await cancelDownload()
    setStatus("prompt")
    setModelInstallComplete(false)
    setError(null)
  }, [cancelDownload, setError])

  const percent = progress?.percent ?? null
  const downloaded = progress?.downloaded ?? 0
  const total = progress?.total ?? null
  const isInstalling = downloading || status === "downloading"
  const setupStatusLabel = buildSetupStatusLabel(
    progress,
    indexProgress,
    isInstalling,
    modelInstallComplete,
  )

  const indexPercent =
    indexProgress && indexProgress.total > 0
      ? (indexProgress.indexed / indexProgress.total) * 100
      : null
  const displayPercent = modelInstallComplete ? indexPercent : percent
  const progressLabel = modelInstallComplete
    ? indexPercent != null
      ? `${indexPercent.toFixed(1)}%`
      : "Indexing…"
    : percent != null
      ? `${percent.toFixed(1)}%`
      : "Downloading…"

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#1a1a1a] px-6 text-white">
      <div className="w-full max-w-md">
        <div className="mb-2 text-center">
          <h1 className="text-2xl font-semibold tracking-wide">Welcome to FileMind</h1>
          <p className="mt-2 text-sm text-zinc-400">
            {status === "prompt"
              ? "TraceSearch and AI features need a local model. You can install it now or skip and use filename search only."
              : "Installing the local AI model and indexing your files for TraceSearch and smart features."}
          </p>
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-[#242424]/95 p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-4">
            <p className="text-sm font-medium text-white">{MODEL_NAME}</p>
            <p className="mt-1 text-xs text-zinc-500">
              ~/.filemind/models/{MODEL_FILENAME} · {MODEL_SIZE_HINT}
            </p>
          </div>

          {status === "prompt" && !isInstalling && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={runInstall}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500/90 py-3 text-sm font-medium text-white transition-colors hover:bg-orange-500"
              >
                <Download className="h-4 w-4" />
                Download &amp; install model
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="w-full rounded-xl border border-white/10 bg-[#2a2a2a]/90 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Skip for now
              </button>
              <p className="text-center text-xs text-zinc-500">
                Without the model, filename search still works. TraceSearch will be unavailable.
              </p>
            </div>
          )}

          {status === "error" && !isInstalling && (
            <>
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error ?? "Download failed"}
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={runInstall}
                  className="w-full rounded-xl bg-orange-500/90 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-500"
                >
                  Retry download
                </button>
                <button
                  type="button"
                  onClick={onSkip}
                  className="w-full rounded-xl border border-white/10 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  Skip for now
                </button>
              </div>
            </>
          )}

          {isInstalling && (
            <>
              <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                <span>{progressLabel}</span>
                {!modelInstallComplete && (
                  <span>
                    {formatBytes(downloaded)}
                    {total != null ? ` / ${formatBytes(total)}` : ""}
                  </span>
                )}
                {modelInstallComplete && indexProgress && indexProgress.total > 0 && (
                  <span>
                    {indexProgress.indexed} / {indexProgress.total} files
                  </span>
                )}
              </div>

              <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-300 ease-out"
                  style={{
                    width:
                      displayPercent != null
                        ? `${Math.min(100, Math.max(0, displayPercent))}%`
                        : !modelInstallComplete && downloaded > 0
                          ? "40%"
                          : "0%",
                  }}
                />
              </div>

              <div className="mt-4 flex items-center justify-center gap-2 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin text-orange-400" />
                <span>{setupStatusLabel}</span>
              </div>

              <button
                type="button"
                onClick={handleCancel}
                className="mt-4 w-full rounded-xl border border-white/10 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Cancel download
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
