import type { ReactNode } from "react"
import { HelpCircle } from "lucide-react"

export type SearchModeVariant = "deep" | "trace"

const VARIANT_STYLES: Record<
  SearchModeVariant,
  { active: string; inactive: string; hover: string }
> = {
  deep: {
    active:
      "border-orange-500/50 bg-orange-500/20 text-orange-300 shadow-[0_0_20px_rgba(249,115,22,0.3)]",
    inactive: "border-white/10 bg-[#2a2a2a]/90 text-zinc-400",
    hover:
      "hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-orange-200 hover:shadow-[0_0_16px_rgba(249,115,22,0.28)]",
  },
  trace: {
    active:
      "border-purple-500/50 bg-purple-500/20 text-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.35)]",
    inactive: "border-white/10 bg-[#2a2a2a]/90 text-zinc-400",
    hover:
      "hover:border-purple-500/40 hover:bg-purple-500/10 hover:text-purple-200 hover:shadow-[0_0_16px_rgba(168,85,247,0.28)]",
  },
}

interface SearchModeToggleProps {
  label: string
  variant: SearchModeVariant
  enabled: boolean
  onToggle: () => void
  tooltip: string
  searchActive: boolean
  icon: ReactNode
}

export default function SearchModeToggle({
  label,
  variant,
  enabled,
  onToggle,
  tooltip,
  searchActive,
  icon,
}: SearchModeToggleProps) {
  const styles = VARIANT_STYLES[variant]

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium backdrop-blur-xl transition-all duration-300 ${
          enabled ? styles.active : `${styles.inactive} ${styles.hover}`
        }`}
      >
        {icon}
        <span>{label}</span>
      </button>

      <div className="group relative">
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#2a2a2a]/90 text-zinc-500 backdrop-blur-xl transition-colors hover:border-white/20 hover:text-zinc-400"
          aria-label={`${label} info`}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
        <div
          className={`pointer-events-none absolute z-[100] w-64 rounded-xl border border-white/10 bg-[#2a2a2a]/95 p-3 opacity-0 shadow-xl backdrop-blur-xl transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 ${
            searchActive ? "right-0 top-full mt-2" : "bottom-full left-0 mb-2"
          }`}
        >
          <p className="text-xs leading-relaxed text-zinc-300">{tooltip}</p>
          <div
            className={`absolute h-3 w-3 rotate-45 border-white/10 bg-[#2a2a2a]/95 ${
              searchActive
                ? "-top-1.5 right-4 border-l border-t"
                : "-bottom-1.5 left-4 border-b border-r"
            }`}
          />
        </div>
      </div>
    </div>
  )
}
