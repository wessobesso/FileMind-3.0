export interface TraceHints {
  include_folders: string[]
  exclude_folders: string[]
  date_hint: string
  file_type_hint: string
}

export interface TraceChatMessage {
  role: "user" | "assistant"
  content: string
}
