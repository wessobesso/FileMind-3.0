export const MODEL_DOWNLOAD_CANCELLED = "Download cancelled"

export function isDownloadCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message === MODEL_DOWNLOAD_CANCELLED
}
