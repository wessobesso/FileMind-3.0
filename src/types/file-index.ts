export interface FileIndexLiveStatus {
  cacheRoot: string
  indexedCount: number
  lastIndexedFile: string | null
}

export interface FileIndexProgress {
  running: boolean
  paused: boolean
  indexed: number
  total: number
  errors: number
  lastIndexedFile: string | null
}

export interface FileIndexComplete {
  processed: number
  skipped: number
  errors: number
  cacheRoot: string
}

export interface FileIndexCacheStatus {
  cacheRoot: string
  indexedCount: number
  hasCache: boolean
}
