"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Plus, Upload, FileText, FolderPlus, Settings, X, Inbox, File, Folder, Loader2, MessagesSquare, ArrowUp } from "lucide-react"
import SearchModeToggle from "./components/SearchModeToggle"
import SettingsModal from "./components/SettingsModal"
import { parseTraceHints, sendTraceChat } from "./lib/trace-search"
import type { FileSearchResult } from "./types/file-search"
import type { TraceChatMessage, TraceHints } from "./types/trace-search"

const INITIAL_RESULTS = 15
const RESULTS_PAGE_SIZE = 8
const SEARCH_DEBOUNCE_MS = 250

export default function FileMind() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastDismissing, setToastDismissing] = useState(false)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [deepSearchEnabled, setDeepSearchEnabled] = useState(false)
  const [traceSearchEnabled, setTraceSearchEnabled] = useState(false)
  const [traceChatOpen, setTraceChatOpen] = useState(false)
  const [traceMessages, setTraceMessages] = useState<TraceChatMessage[]>([])
  const [traceHints, setTraceHints] = useState<TraceHints | null>(null)
  const [traceServerReady, setTraceServerReady] = useState(false)
  const [isTraceLoading, setIsTraceLoading] = useState(false)
  const [traceError, setTraceError] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<FileSearchResult[]>([])
  const [visibleResultCount, setVisibleResultCount] = useState(INITIAL_RESULTS)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultsListRef = useRef<HTMLDivElement>(null)
  const dragCounter = useRef(0)
  const searchRequestId = useRef(0)
  const traceChatEndRef = useRef<HTMLDivElement>(null)

  const performSearch = useCallback(async (query: string, hints?: TraceHints | null) => {
    const trimmed = query.trim()
    if (!trimmed) return

    setIsSearching(true)
    setSearchError(null)

    const requestId = ++searchRequestId.current

    try {
      const results = await invoke<FileSearchResult[]>("search_files", {
        query: trimmed,
        deep_search: deepSearchEnabled && !traceSearchEnabled,
        trace_search: traceSearchEnabled && !deepSearchEnabled,
        excluded_paths: [] as string[],
        include_folders: hints?.include_folders ?? [],
        exclude_folders: hints?.exclude_folders ?? [],
      })

      if (requestId !== searchRequestId.current) return

      setSearchResults(results)
      setVisibleResultCount(INITIAL_RESULTS)
      setSearchError(null)
    } catch (err) {
      if (requestId !== searchRequestId.current) return
      setSearchResults([])
      setSearchError(err instanceof Error ? err.message : String(err))
    } finally {
      if (requestId === searchRequestId.current) {
        setIsSearching(false)
      }
    }
  }, [deepSearchEnabled, traceSearchEnabled])

  const runTraceTurn = useCallback(async (messages: TraceChatMessage[]) => {
    setIsTraceLoading(true)
    setTraceError(null)

    try {
      const reply = await sendTraceChat(messages)
      const assistantMessage: TraceChatMessage = { role: "assistant", content: reply }
      const updated = [...messages, assistantMessage]
      setTraceMessages(updated)

      const hints = parseTraceHints(reply)
      if (hints) {
        setTraceHints(hints)
        setTraceServerReady(true)
        setSearchResults([])
        setSearchError(null)
        await invoke("capture_trace_search_json", {
          json: JSON.stringify(hints),
        })
      }
    } catch (err) {
      setTraceError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsTraceLoading(false)
    }
  }, [])

  const dismissToast = useCallback(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current)
      toastTimeoutRef.current = null
    }
    setToastDismissing(true)
    setTimeout(() => {
      setToastMessage(null)
      setToastDismissing(false)
    }, 200)
  }, [])

  const showToast = useCallback(
    (message: string) => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
      setToastMessage(message)
      setToastDismissing(false)
      toastTimeoutRef.current = setTimeout(() => {
        dismissToast()
        toastTimeoutRef.current = null
      }, 4000)
    },
    [dismissToast]
  )

  const handleSend = useCallback(async () => {
    const trimmed = searchValue.trim()
    if (!trimmed || isSearching || isTraceLoading) return

    if (traceSearchEnabled) {
      try {
        const modelReady = await invoke<boolean>("is_model_ready")
        if (!modelReady) {
          showToast(
            "TraceSearch requires the AI model. Install it from Settings (gear icon, bottom right)."
          )
          return
        }
      } catch {
        showToast(
          "TraceSearch requires the AI model. Install it from Settings (gear icon, bottom right)."
        )
        return
      }

      setTraceChatOpen(true)
      const userMessage: TraceChatMessage = { role: "user", content: trimmed }
      const nextMessages = [...traceMessages, userMessage]
      setTraceMessages(nextMessages)
      setSearchValue("")
      await runTraceTurn(nextMessages)
      return
    }

    await performSearch(trimmed)
  }, [
    searchValue,
    isSearching,
    isTraceLoading,
    traceSearchEnabled,
    traceMessages,
    runTraceTurn,
    performSearch,
    showToast,
  ])

  const clearTraceState = useCallback(() => {
    setTraceChatOpen(false)
    setTraceMessages([])
    setTraceHints(null)
    setTraceServerReady(false)
    setTraceError(null)
  }, [])

  const handleDeepSearchToggle = useCallback(() => {
    if (deepSearchEnabled) {
      setDeepSearchEnabled(false)
      return
    }
    setTraceSearchEnabled(false)
    clearTraceState()
    setDeepSearchEnabled(true)
  }, [deepSearchEnabled, clearTraceState])

  const handleTraceSearchToggle = useCallback(() => {
    if (traceSearchEnabled) {
      setTraceSearchEnabled(false)
      clearTraceState()
      return
    }
    setDeepSearchEnabled(false)
    setTraceSearchEnabled(true)
  }, [traceSearchEnabled, clearTraceState])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [searchValue])

  useEffect(() => {
    traceChatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [traceMessages, isTraceLoading])

  useEffect(() => {
    if (traceSearchEnabled || deepSearchEnabled || searchValue.trim().length > 0) {
      setIsMenuOpen(false)
    }
  }, [traceSearchEnabled, deepSearchEnabled, searchValue])

  // Debounced filename search (disabled while TraceSearch is active)
  useEffect(() => {
    if (traceSearchEnabled) return

    const trimmed = searchValue.trim()

    if (!trimmed) {
      setSearchResults([])
      setSearchError(null)
      setIsSearching(false)
      setVisibleResultCount(INITIAL_RESULTS)
      return
    }

    const timer = window.setTimeout(() => {
      performSearch(trimmed)
    }, SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [searchValue, deepSearchEnabled, traceSearchEnabled, performSearch])

  const handleResultsScroll = useCallback(() => {
    const el = resultsListRef.current
    if (!el) return

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (nearBottom && visibleResultCount < searchResults.length) {
      setVisibleResultCount((count) =>
        Math.min(count + RESULTS_PAGE_SIZE, searchResults.length)
      )
    }
  }, [visibleResultCount, searchResults.length])

  const handleRevealInFinder = useCallback(async (path: string) => {
    try {
      await invoke("reveal_in_finder", { path })
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const visibleResults = searchResults.slice(0, visibleResultCount)
  const hasMoreResults = visibleResultCount < searchResults.length
  const showResultsPanel =
    (!traceSearchEnabled && searchValue.trim().length > 0) ||
    (traceSearchEnabled && traceServerReady) ||
    (traceSearchEnabled &&
      traceChatOpen &&
      (searchResults.length > 0 || isSearching))
  const showTraceChat = traceChatOpen
  const searchActive = !!searchValue || showTraceChat
  const showModeToggles =
    deepSearchEnabled || traceSearchEnabled || searchValue.length === 0
  const searchInUse =
    traceSearchEnabled || deepSearchEnabled || searchValue.trim().length > 0
  const canSend = searchValue.trim().length > 0 && !isSearching && !isTraceLoading

  const MAX_FILES = 10

  // Handle file upload
  const handleFiles = useCallback((files: FileList | null) => {
    if (files) {
      const newFiles = Array.from(files)
      setUploadedFiles(prev => {
        const remaining = MAX_FILES - prev.length
        if (remaining <= 0) {
          showToast("Maximum 10 files allowed")
          return prev
        }
        if (newFiles.length > remaining) {
          showToast("Maximum 10 files allowed")
        }
        return [...prev, ...newFiles.slice(0, remaining)]
      })
    }
  }, [showToast])

  // Remove file
  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    dragCounter.current = 0
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  // Handle upload button click
  const handleUploadClick = () => {
    setIsMenuOpen(false)
    fileInputRef.current?.click()
  }

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <div 
      className="min-h-screen overflow-x-hidden bg-[#1a1a1a] text-white"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {toastMessage && (
        <div
          className={`fixed bottom-6 left-1/2 z-[200] flex max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/20 px-4 py-3 text-red-200 shadow-lg backdrop-blur-xl transition-all duration-200 ${
            toastDismissing ? "translate-y-2 opacity-0" : "animate-fade-in-up"
          }`}
        >
          <span className="text-sm font-medium">{toastMessage}</span>
          <button
            type="button"
            onClick={dismissToast}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-red-300 transition-colors hover:bg-red-500/30 hover:text-white"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#1a1a1a]/95 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center">
              <Inbox className="h-16 w-16 text-white" strokeWidth={1.5} />
            </div>
            <p className="text-lg font-medium text-white">Drop files to upload</p>
          </div>
        </div>
      )}

      {/* Header with gradient border */}
      <header className="relative">
        <div className="h-1 bg-gradient-to-r from-orange-500 via-orange-400 to-orange-500" />
        <div className="flex items-center justify-center py-6">
          <h1 className="text-2xl font-semibold tracking-wide">FileMind</h1>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-orange-500/50 to-transparent" />
      </header>

      {/* Main content */}
      <main className={`flex w-full flex-col items-center overflow-x-hidden px-4 transition-all duration-500 ease-out ${searchActive ? 'justify-start pt-8' : 'justify-center'}`} style={{ minHeight: "calc(100vh - 120px)" }}>
        
        {/* DeepSearch / TraceSearch — hidden while typing unless a mode is selected */}
        {showModeToggles && (
        <div
          className={`transition-all duration-500 ease-out ${
            searchActive ? "fixed top-4 right-4 z-50" : "mb-6"
          }`}
        >
          <div className="flex flex-row items-center gap-2">
            {!traceSearchEnabled && (
              <SearchModeToggle
                label="DeepSearch"
                variant="deep"
                enabled={deepSearchEnabled}
                onToggle={handleDeepSearchToggle}
                searchActive={searchActive}
                tooltip="The DeepSearch function searches through your FULL DISK, and may potentially crash the app. We advise to use the settings to minimize the search pool by deselecting folders."
                icon={
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                    <path d="M11 8v6M8 11h6" />
                  </svg>
                }
              />
            )}
            {!deepSearchEnabled && (
              <SearchModeToggle
                label="TraceSearch"
                variant="trace"
                enabled={traceSearchEnabled}
                onToggle={handleTraceSearchToggle}
                searchActive={searchActive}
                tooltip="TraceSearch uses AI to find any file you want, with no restriction on file type through a short conversation."
                icon={<MessagesSquare className="h-4 w-4" />}
              />
            )}
          </div>
        </div>
        )}

        {/* Uploaded files display */}
        {uploadedFiles.length > 0 && (
          <div className="mb-4 w-full max-w-2xl">
            <div className="flex flex-wrap gap-2">
              {uploadedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#2a2a2a]/90 px-3 py-2 backdrop-blur-xl"
                >
                  <File className="h-4 w-4 text-orange-400" />
                  <span className="max-w-[150px] truncate text-sm">{file.name}</span>
                  <span className="text-xs text-zinc-500">{formatFileSize(file.size)}</span>
                  <button
                    onClick={() => removeFile(index)}
                    className="ml-1 flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search + results — shared width, centered */}
        <div className="mx-auto w-full min-w-0 max-w-2xl">
        {/* Search bar with animated rainbow shimmer border */}
        <div className="relative w-full">
          {/* Animated rainbow border - flows around the perimeter (hidden when typing) */}
          <div 
            className={`absolute -inset-[2px] rounded-3xl transition-opacity duration-500 ${searchValue ? 'opacity-0' : 'opacity-100 animate-border-flow'}`}
            style={{
              background: "linear-gradient(90deg, #f43f5e, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #f43f5e, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #f43f5e)",
              backgroundSize: "200% 100%",
            }}
          />
          {/* Glow effect (hidden when typing) */}
          <div 
            className={`absolute -inset-[2px] rounded-3xl blur-md transition-opacity duration-500 ${searchValue ? 'opacity-0' : 'opacity-50 animate-border-flow'}`}
            style={{
              background: "linear-gradient(90deg, #f43f5e, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #f43f5e, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #f43f5e)",
              backgroundSize: "200% 100%",
            }}
          />
          {/* Grey border (shown when typing) */}
          <div 
            className={`absolute -inset-[2px] rounded-3xl bg-zinc-600 transition-opacity duration-500 ${searchValue ? 'opacity-100' : 'opacity-0'}`}
          />
          
          {/* Glass effect container */}
          <div className="relative flex items-center gap-3 rounded-3xl border border-white/10 bg-[#2a2a2a]/90 px-3 py-3 backdrop-blur-xl">
            {!searchInUse && (
              <button
                type="button"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-600/80 text-zinc-300 backdrop-blur-sm transition-colors hover:bg-zinc-500/80"
                aria-label="Open menu"
              >
                <Plus className="h-5 w-5" />
              </button>
            )}
            <textarea
              ref={textareaRef}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={
                traceSearchEnabled
                  ? "Describe the file you're looking for..."
                  : "Search files..."
              }
              rows={1}
              className="flex-1 resize-none bg-transparent text-white placeholder-zinc-500 outline-none leading-6"
              style={{ minHeight: "24px", maxHeight: "200px" }}
            />
            {(isSearching || isTraceLoading) && (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-orange-400" aria-label="Loading" />
            )}
            {searchValue && !isSearching && !isTraceLoading && (
              <>
                <button
                  type="button"
                  onClick={() => setSearchValue("")}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-600/80 text-zinc-300 backdrop-blur-sm transition-colors hover:bg-zinc-500/80"
                  aria-label="Clear search"
                >
                  <X className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full backdrop-blur-sm transition-all ${
                    canSend
                      ? traceSearchEnabled
                        ? "bg-orange-500/90 text-white shadow-[0_0_16px_rgba(249,115,22,0.4)] hover:bg-orange-500"
                        : "bg-zinc-100 text-zinc-900 hover:bg-white"
                      : "cursor-not-allowed bg-zinc-600/50 text-zinc-500"
                  }`}
                  aria-label="Send"
                >
                  <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
                </button>
              </>
            )}
          </div>

          {/* Dropdown Menu - Glass effect */}
          {isMenuOpen && !searchInUse && (
            <div className="absolute left-0 top-full z-50 mt-3 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#2a2a2a]/95 shadow-2xl backdrop-blur-xl">
              <div className="h-0.5 bg-gradient-to-r from-orange-500 to-orange-400" />
              <div className="p-2">
                <button 
                  onClick={handleUploadClick}
                  className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/5"
                >
                  <Upload className="h-5 w-5 text-zinc-400" />
                  <span>Upload File</span>
                </button>
                <button className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/5">
                  <FileText className="h-5 w-5 text-zinc-400" />
                  <span>Create Document</span>
                </button>
                <button className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/5">
                  <FolderPlus className="h-5 w-5 text-zinc-400" />
                  <span>New Folder</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* TraceSearch conversation */}
        {showTraceChat && (
          <div className="mt-4 w-full min-w-0 animate-results-in">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#242424]/95 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                <span className="text-xs font-medium uppercase tracking-wider text-orange-400/90">
                  TraceSearch
                </span>
                {traceServerReady && (
                  <span className="text-xs text-emerald-400">Ready to search</span>
                )}
              </div>

              {traceError && (
                <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {traceError}
                </div>
              )}

              <div className="max-h-[min(360px,45vh)] overflow-x-hidden overflow-y-auto overscroll-contain p-4">
                <div className="flex flex-col gap-3">
                  {traceMessages.map((msg, index) => (
                    <div
                      key={`${msg.role}-${index}`}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-orange-500/20 text-orange-50"
                            : "border border-white/10 bg-[#2a2a2a]/90 text-zinc-200"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {isTraceLoading && (
                    <div className="flex justify-start">
                      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#2a2a2a]/90 px-4 py-2.5 text-sm text-zinc-400">
                        <Loader2 className="h-4 w-4 animate-spin text-orange-400" />
                        Thinking…
                      </div>
                    </div>
                  )}
                  <div ref={traceChatEndRef} />
                </div>
              </div>

              {traceServerReady && (
                <div className="border-t border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-300/90">
                  Ready to search — sending to server
                </div>
              )}
            </div>
          </div>
        )}

        {/* Search results */}
        {showResultsPanel && (
          <div className="mt-4 w-full min-w-0 animate-results-in">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#242424]/95 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Results
                </span>
                {!isSearching && searchResults.length > 0 && (
                  <span className="text-xs text-zinc-500">
                    {searchResults.length.toLocaleString()} match{searchResults.length === 1 ? "" : "es"}
                  </span>
                )}
              </div>

              {searchError && (
                <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {searchError}
                </div>
              )}

              {traceSearchEnabled && traceServerReady && (
                <div className="px-4 py-10 text-center text-sm text-emerald-300/90">
                  Ready to search — sending to server
                </div>
              )}

              {!traceServerReady && isSearching && searchResults.length === 0 && (
                <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin text-orange-400" aria-hidden />
                  Searching…
                </div>
              )}

              {!traceServerReady &&
                !isSearching &&
                searchResults.length === 0 &&
                !searchError && (
                <div className="px-4 py-10 text-center text-sm text-zinc-500">
                  No files or folders match &ldquo;{searchValue.trim()}&rdquo;
                </div>
              )}

              {!traceServerReady && visibleResults.length > 0 && (
                <div
                  ref={resultsListRef}
                  onScroll={handleResultsScroll}
                  className="max-h-[min(420px,50vh)] overflow-x-hidden overflow-y-auto overscroll-contain"
                >
                  <ul className="divide-y divide-white/5 p-1.5">
                    {visibleResults.map((result) => (
                      <li key={result.path}>
                        <button
                          type="button"
                          onClick={() => handleRevealInFinder(result.path)}
                          className="group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
                        >
                          <span
                            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                              result.isDirectory
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-400 group-hover:border-amber-500/50 group-hover:bg-amber-500/15"
                                : "border-sky-500/30 bg-sky-500/10 text-sky-400 group-hover:border-sky-500/50 group-hover:bg-sky-500/15"
                            }`}
                          >
                            {result.isDirectory ? (
                              <Folder className="h-4 w-4" strokeWidth={2} />
                            ) : (
                              <File className="h-4 w-4" strokeWidth={2} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-white group-hover:text-orange-100">
                              {result.name}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-zinc-500 group-hover:text-zinc-400">
                              {result.path}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>

                  {hasMoreResults && (
                    <div className="border-t border-white/5 px-4 py-2.5 text-center text-xs text-zinc-500">
                      Scroll for more — showing {visibleResultCount} of {searchResults.length}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </main>

      <SettingsModal open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Settings — bottom right */}
      <button
        type="button"
        onClick={() => setIsSettingsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-[#2a2a2a]/95 text-zinc-400 shadow-lg backdrop-blur-xl transition-colors hover:border-white/20 hover:bg-[#333]/95 hover:text-white"
        aria-label="Open settings"
      >
        <Settings className="h-5 w-5" />
      </button>

      {/* Click outside to close menu */}
      {isMenuOpen && !searchInUse && (
        <div className="fixed inset-0 z-40" onClick={() => setIsMenuOpen(false)} />
      )}

      <style jsx>{`
        @keyframes border-flow {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 200% 50%;
          }
        }
        .animate-border-flow {
          animation: border-flow 3s linear infinite;
        }
        @keyframes fade-in-up {
          0% {
            opacity: 0;
            transform: translate(-50%, 10px);
          }
          100% {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.2s ease-out forwards;
        }
        @keyframes results-in {
          0% {
            opacity: 0;
            transform: translateY(8px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-results-in {
          animation: results-in 0.2s ease-out forwards;
        }
      `}</style>
    </div>
  )
}
