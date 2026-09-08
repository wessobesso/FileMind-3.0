import type { TraceChatMessage, TraceHints } from "../types/trace-search"

const LLAMA_CHAT_URL = "http://127.0.0.1:11434/v1/chat/completions"

export const TRACE_SEARCH_SYSTEM_PROMPT =
  "You are a file search assistant. The user is trying to find a file by its CONTENT, not its name"

export function parseTraceHints(text: string): TraceHints | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    if (typeof parsed !== "object" || parsed === null) return null

    return {
      include_folders: Array.isArray(parsed.include_folders)
        ? parsed.include_folders.map(String)
        : [],
      exclude_folders: Array.isArray(parsed.exclude_folders)
        ? parsed.exclude_folders.map(String)
        : [],
      date_hint: String(parsed.date_hint ?? ""),
      file_type_hint: String(parsed.file_type_hint ?? ""),
    }
  } catch {
    return null
  }
}

export async function sendTraceChat(
  messages: TraceChatMessage[]
): Promise<string> {
  const response = await fetch(LLAMA_CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "default",
      messages: [
        { role: "system", content: TRACE_SEARCH_SYSTEM_PROMPT },
        ...messages,
      ],
      stream: false,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(
      body
        ? `llama-server error (${response.status}): ${body.slice(0, 200)}`
        : `llama-server error (${response.status})`
    )
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error("Empty response from llama-server")
  }

  return content
}
