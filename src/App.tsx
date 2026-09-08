import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Loader2 } from "lucide-react"
import FileMind from "./FileMind"
import ModelSetup from "./components/ModelSetup"

type AppPhase = "checking" | "setup" | "ready"

export default function App() {
  const [phase, setPhase] = useState<AppPhase>("checking")
  useEffect(() => {
    invoke<boolean>("is_model_ready")
      .then((ready) => {
        if (ready) {
          return invoke("start_llama_server").then(() => {
            setPhase("ready")
          })
        }
        setPhase("setup")
      })
      .catch(() => {
        setPhase("setup")
      })
  }, [])

  if (phase === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#1a1a1a]">
        <Loader2 className="h-8 w-8 animate-spin text-orange-400" aria-label="Loading" />
      </div>
    )
  }

  if (phase === "setup") {
    return (
      <ModelSetup
        onComplete={() => setPhase("ready")}
        onSkip={() => setPhase("ready")}
      />
    )
  }

  return <FileMind />
}
