import { useCallback, useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart"
import { Check, ChevronDown, Loader2, X } from "lucide-react"
import { useModelDownload } from "../hooks/useModelDownload"
import type { FileIndexComplete, FileIndexLiveStatus, FileIndexProgress } from "../types/file-index"

const FILEMIND_VERSION = "3.2.2"
const MODEL_LABEL = "Qwen3-4B-Q4_K_M"
const INDEX_LIVE_POLL_MS = 2000

const disabledButtonClass =
  "cursor-not-allowed rounded-lg bg-zinc-600/80 px-4 py-2 text-sm font-medium text-zinc-400 opacity-50"

const activeButtonClass =
  "rounded-lg bg-zinc-600/80 px-4 py-2 text-sm font-medium backdrop-blur-sm transition-colors hover:bg-zinc-500/80"

const uninstallButtonClass =
  "rounded-lg border border-red-500/50 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.35)] backdrop-blur-sm transition-all hover:border-red-500/60 hover:bg-red-500/30 hover:text-red-200 hover:shadow-[0_0_16px_rgba(239,68,68,0.4)] disabled:cursor-not-allowed disabled:opacity-50"

const linkButtonClass =
  "mt-2 w-full rounded-md border border-white/10 bg-white/[0.02] py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-white/15 hover:bg-white/[0.04] hover:text-zinc-200"

function SettingsCheckbox({ checked, dimmed }: { checked: boolean; dimmed?: boolean }) {
  return (
    <div
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${
        checked ? "border-orange-500 bg-orange-500" : "border-zinc-500 bg-zinc-700/50"
      } ${dimmed ? "opacity-50" : ""}`}
    >
      {checked && (
        <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </div>
  )
}

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [autoStart, setAutoStart] = useState(false)
  const [autoStartLoading, setAutoStartLoading] = useState(false)
  const [modelInstalled, setModelInstalled] = useState(false)
  const [modelChecking, setModelChecking] = useState(true)
  const {
    downloading: modelInstalling,
    progress: downloadProgress,
    error: modelError,
    setError: setModelError,
    cancelDownload,
    runDownload,
  } = useModelDownload()
  const [modelUninstalling, setModelUninstalling] = useState(false)
  const [indexRunning, setIndexRunning] = useState(false)
  const [indexProgress, setIndexProgress] = useState<FileIndexProgress | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [indexComplete, setIndexComplete] = useState<FileIndexComplete | null>(null)
  const [indexClearing, setIndexClearing] = useState(false)
  const [indexClearError, setIndexClearError] = useState<string | null>(null)
  const [indexLive, setIndexLive] = useState<FileIndexLiveStatus | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [verboseLogs, setVerboseLogs] = useState(false)
  const [developerMode, setDeveloperMode] = useState(false)

  const refreshIndexLive = useCallback(async () => {
    try {
      const live = await invoke<FileIndexLiveStatus>("get_file_index_live_status")
      setIndexLive(live)
    } catch {
      setIndexLive(null)
    }
  }, [])

  const refreshModelStatus = useCallback(async () => {
    setModelChecking(true)
    try {
      const ready = await invoke<boolean>("is_model_ready")
      setModelInstalled(ready)
    } catch {
      setModelInstalled(false)
    } finally {
      setModelChecking(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return

    setAdvancedOpen(false)

    isEnabled()
      .then(setAutoStart)
      .catch(() => setAutoStart(false))

    refreshModelStatus()
    void refreshIndexLive()
    setModelError(null)
    setIndexClearError(null)

    void invoke<FileIndexProgress | null>("get_file_index_progress").then((progress) => {
      if (progress) {
        setIndexProgress(progress)
      }
    })

    invoke<boolean>("is_file_index_running")
      .then((running) => {
        setIndexRunning(running)
      })
      .catch(() => setIndexRunning(false))
  }, [open, refreshModelStatus, refreshIndexLive, setModelError])

  useEffect(() => {
    if (!open) return

    void refreshIndexLive()
    const pollId = window.setInterval(() => {
      void refreshIndexLive()
    }, INDEX_LIVE_POLL_MS)

    return () => {
      window.clearInterval(pollId)
    }
  }, [open, refreshIndexLive])

  useEffect(() => {
    if (!open) return

    const unlistenProgress = listen<FileIndexProgress>("file-index-progress", (event) => {
      setIndexProgress(event.payload)
      setIndexRunning(event.payload.running)
    })

    const unlistenComplete = listen<FileIndexComplete>("file-index-complete", (event) => {
      setIndexComplete(event.payload)
      setIndexRunning(false)
      setIndexError(null)
      void refreshIndexLive()
    })

    return () => {
      unlistenProgress.then((fn) => fn())
      unlistenComplete.then((fn) => fn())
    }
  }, [open, refreshIndexLive])

  const handleAutoStartToggle = async () => {
    if (autoStartLoading) return
    setAutoStartLoading(true)
    try {
      if (autoStart) {
        await disable()
      } else {
        await enable()
      }
      setAutoStart(await isEnabled())
    } catch (err) {
      console.error("Autostart toggle failed:", err)
    } finally {
      setAutoStartLoading(false)
    }
  }

  const handleQuit = () => {
    invoke("quit_app").catch(console.error)
  }

  const handleInstallModel = async () => {
    if (modelInstalled || modelInstalling) return

    setModelError(null)
    const result = await runDownload({ startServer: true })

    if (result === "success") {
      setModelInstalled(true)
    }
  }

  const handleCancelInstall = async () => {
    await cancelDownload()
    setModelError(null)
  }

  const handleIndexFiles = async () => {
    if (indexRunning) return

    setIndexError(null)
    setIndexComplete(null)
    setIndexProgress(null)

    try {
      await invoke("start_file_index")
      setIndexRunning(true)
    } catch (err) {
      setIndexError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleStopIndex = async () => {
    if (!indexRunning) return

    try {
      await invoke("cancel_file_index")
    } catch (err) {
      setIndexError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleContinueIndex = async () => {
    if (indexRunning) return

    setIndexError(null)

    try {
      await invoke("continue_file_index")
      setIndexRunning(true)
    } catch (err) {
      setIndexError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleClearIndex = async () => {
    if (indexRunning || indexClearing) return

    setIndexClearError(null)
    setIndexClearing(true)

    try {
      await invoke("clear_file_index")
      setIndexComplete(null)
      setIndexProgress(null)
      await refreshIndexLive()
    } catch (err) {
      setIndexClearError(err instanceof Error ? err.message : String(err))
    } finally {
      setIndexClearing(false)
    }
  }

  const handleShowCacheInFinder = async () => {
    try {
      const path = await invoke<string>("get_file_index_cache_path")
      await invoke("reveal_in_finder", { path })
    } catch (err) {
      setIndexError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleUninstallModel = async () => {
    if (!modelInstalled || modelInstalling || modelUninstalling) return

    setModelUninstalling(true)
    setModelError(null)

    try {
      await invoke("uninstall_model")
      setModelInstalled(false)
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelUninstalling(false)
    }
  }

  if (!open) return null

  const installPercent = downloadProgress?.percent ?? null
  const hasIndexedFiles = (indexLive?.indexedCount ?? 0) > 0
  const displayIndexed = indexLive?.indexedCount ?? 0
  const displayTotal: number | null =
    (indexProgress?.total ?? 0) > 0 ? indexProgress!.total : displayIndexed > 0 ? displayIndexed : null
  const canContinueIndexing =
    !indexRunning &&
    (indexProgress?.total ?? 0) > 0 &&
    displayIndexed < (indexProgress?.total ?? 0)
  const displayPath = indexLive?.lastIndexedFile ?? null
  const indexPercentLive =
    indexRunning && displayTotal != null && displayTotal > 0
      ? (displayIndexed / displayTotal) * 100
      : null
  const showProgressBar = indexRunning && indexPercentLive != null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#2a2a2a]/95 p-8 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="mb-8 flex items-start justify-between gap-4">
          <h2 id="settings-title" className="text-3xl font-semibold text-white">
            General
          </h2>
          <div className="flex shrink-0 items-center gap-3">
            <span className="whitespace-nowrap text-sm text-zinc-400">
              FileMind Version: {FILEMIND_VERSION}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleAutoStartToggle}
              disabled={autoStartLoading}
              className="flex items-center gap-3 text-left disabled:opacity-60"
            >
              <SettingsCheckbox checked={autoStart} />
              <span>Auto-start at login</span>
            </button>
            <button type="button" onClick={handleQuit} className={activeButtonClass}>
              Quit FileMind
            </button>
          </div>
          <p className="text-sm leading-relaxed text-zinc-400">
            If selected, FileMind will still launch at login after using the &quot;Quit FileMind&quot;
            button.
          </p>
        </div>

        <div className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold text-white">Permissions:</span>
            <button type="button" className={activeButtonClass}>
              Request Permissions...
            </button>
          </div>
          <p className="text-sm leading-relaxed text-zinc-400">
            FileMind requires certain permissions to enable it to automate your Mac. This button
            will help you enable these permissions.
          </p>
        </div>

        <div className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">AI model:</span>
              {modelChecking ? (
                <Loader2 className="h-4 w-4 animate-spin text-zinc-500" aria-hidden />
              ) : modelInstalled ? (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400"
                  title="Model installed"
                >
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                </span>
              ) : (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20 text-red-400"
                  title="Model not installed"
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </span>
              )}
            </div>
            {modelInstalling ? (
              <button
                type="button"
                onClick={handleCancelInstall}
                className={activeButtonClass}
              >
                Cancel download
              </button>
            ) : modelInstalled ? (
              <button
                type="button"
                onClick={handleUninstallModel}
                disabled={modelChecking || modelUninstalling}
                className={uninstallButtonClass}
              >
                {modelUninstalling ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uninstalling…
                  </span>
                ) : (
                  "Uninstall model"
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleInstallModel}
                disabled={modelChecking}
                className={modelChecking ? disabledButtonClass : activeButtonClass}
              >
                Install model
              </button>
            )}
          </div>
          <p className="text-sm leading-relaxed text-zinc-400">
            {modelInstalled
              ? `${MODEL_LABEL} is installed and ready for TraceSearch. Uninstalling frees ~2.5 GB of disk space.`
              : `Install ${MODEL_LABEL} (~2.5 GB) for TraceSearch and AI features.`}
          </p>
          {modelInstalling && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-zinc-500">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-orange-400" />
                  {installPercent != null ? `${installPercent.toFixed(1)}%` : "Downloading…"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-700">
                <div
                  className="h-full rounded-full bg-orange-500 transition-all duration-300"
                  style={{
                    width:
                      installPercent != null
                        ? `${Math.min(100, Math.max(0, installPercent))}%`
                        : "30%",
                  }}
                />
              </div>
            </div>
          )}
          {modelError && (
            <p className="mt-2 text-sm text-red-400">{modelError}</p>
          )}
        </div>

        <div className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold text-white">Index files:</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleIndexFiles}
                disabled={indexRunning || indexClearing}
                className={indexRunning ? disabledButtonClass : activeButtonClass}
              >
                {indexRunning ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Indexing…
                  </span>
                ) : (
                  "Index files"
                )}
              </button>
              {(hasIndexedFiles || indexClearing) && (
                <button
                  type="button"
                  onClick={handleClearIndex}
                  disabled={indexRunning || indexClearing}
                  className={uninstallButtonClass}
                >
                  {indexClearing ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Clearing…
                    </span>
                  ) : (
                    "Clear index"
                  )}
                </button>
              )}
            </div>
          </div>
          <p className="text-sm leading-relaxed text-zinc-400">
            Build lightweight previews of your Documents, Downloads, and Desktop for TraceSearch.
            Saved to ~/TraceSearch/cache/.
          </p>
          <button type="button" onClick={handleShowCacheInFinder} className={linkButtonClass}>
            Show TraceSearch cache in Finder
          </button>
          <div className="mt-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-300">
                {displayIndexed.toLocaleString()} /{" "}
                {displayTotal != null ? displayTotal.toLocaleString() : "…"} files indexed
                {indexProgress && indexProgress.errors > 0 && (
                  <span className="text-zinc-500">
                    {" "}
                    · {indexProgress.errors} error{indexProgress.errors === 1 ? "" : "s"}
                  </span>
                )}
              </p>
              {indexRunning ? (
                <button
                  type="button"
                  onClick={handleStopIndex}
                  className="shrink-0 rounded-md border border-white/10 px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
                >
                  Stop indexing
                </button>
              ) : canContinueIndexing ? (
                <button
                  type="button"
                  onClick={handleContinueIndex}
                  className="shrink-0 rounded-md border border-white/10 px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
                >
                  Continue
                </button>
              ) : null}
            </div>
            <p className="mt-1 truncate font-mono text-xs text-zinc-500" title={displayPath ?? undefined}>
              {displayPath
                ? displayPath
                : indexRunning
                  ? indexProgress?.total
                    ? "Starting…"
                    : "Scanning your files…"
                  : displayIndexed > 0
                    ? "—"
                    : "No files indexed yet"}
            </p>
            {showProgressBar && (
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-zinc-700">
                <div
                  className="h-full rounded-full bg-orange-500 transition-all duration-300"
                  style={{
                    width: `${Math.min(100, Math.max(0, indexPercentLive))}%`,
                  }}
                />
              </div>
            )}
          </div>
          {indexComplete && !indexRunning && (
            <p className="mt-2 text-sm text-emerald-400/90">
              Index complete — {indexComplete.processed.toLocaleString()} file
              {indexComplete.processed === 1 ? "" : "s"} processed.
            </p>
          )}
          {indexError && (
            <p className="mt-2 text-sm text-red-400">{indexError}</p>
          )}
          {indexClearError && (
            <p className="mt-2 text-sm text-red-400">{indexClearError}</p>
          )}
        </div>

        <div className="mb-4 h-px bg-white/10" />

        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex w-full items-center justify-between py-2 font-semibold text-white transition-colors hover:text-zinc-300"
            aria-expanded={advancedOpen}
          >
            <span>Advanced</span>
            <ChevronDown
              className={`h-5 w-5 text-zinc-400 transition-transform duration-200 ${
                advancedOpen ? "rotate-180" : ""
              }`}
              aria-hidden
            />
          </button>

          <div
            className={`overflow-hidden transition-all duration-200 ${
              advancedOpen ? "mt-4 max-h-40 opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setVerboseLogs((v) => !v)}
                className="flex w-full items-center gap-3 text-left"
              >
                <SettingsCheckbox checked={verboseLogs} />
                <span>Verbose logs</span>
              </button>
              <button
                type="button"
                onClick={() => setDeveloperMode((v) => !v)}
                className="flex w-full items-center gap-3 text-left"
              >
                <SettingsCheckbox checked={developerMode} />
                <span>Developer mode</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
