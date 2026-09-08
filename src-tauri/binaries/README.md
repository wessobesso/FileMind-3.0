# Sidecar binaries

Place the **llama-server** executable here with a Rust target-triple suffix.

## Naming

For `externalBin: ["binaries/llama-server"]` in `tauri.conf.json`, the file must be named:

```text
llama-server-<TARGET_TRIPLE>
```

Examples:

| Platform | Filename |
|----------|----------|
| macOS Apple Silicon | `llama-server-aarch64-apple-darwin` |
| macOS Intel | `llama-server-x86_64-apple-darwin` |
| Linux x86_64 | `llama-server-x86_64-unknown-linux-gnu` |
| Windows | `llama-server-x86_64-pc-windows-msvc.exe` |

Find your triple:

```bash
rustc --print host-tuple
```

## Build from llama.cpp

Build [llama.cpp](https://github.com/ggerganov/llama.cpp) with server support, then copy the `llama-server` binary:

```bash
# Example (adjust paths for your machine)
cp path/to/llama-server "src-tauri/binaries/llama-server-$(rustc --print host-tuple)"
chmod +x "src-tauri/binaries/llama-server-$(rustc --print host-tuple)"
```

The app starts it automatically on **`http://127.0.0.1:11434`** when FileMind launches. Model files are not configured yet.
