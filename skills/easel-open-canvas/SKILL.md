---
name: easel-open-canvas
description: Open the Easel local web service, a tldraw-powered infinite-canvas AI image studio. Use when the user asks to open, launch, view, or work in the Easel canvas or studio.
---

# Easel Open Canvas

## Workflow

1. Start the local Easel web service from the Easel plugin directory, passing the user's current project directory, and keep the process running. Use the start script in the Easel plugin's `scripts/` folder that matches the operating system. Replace `<easel-plugin-dir>` with the actual Easel plugin install directory (the directory this skill lives in) and `<project-dir>` with the active project directory:

- Windows (PowerShell):

```powershell
pwsh -File "<easel-plugin-dir>/scripts/start-canvas.ps1" "<project-dir>"
```

- macOS / Linux:

```bash
"<easel-plugin-dir>/scripts/start-canvas.sh" "<project-dir>"
```

2. Open the resulting local URL in the in-app browser. The default URL is `http://127.0.0.1:43219/`. If the service prints a different `Local:` URL, open that instead. If browser control is unavailable, just give the user the local URL.

## Notes

- The canvas has an Inspector panel in the top-right: type a prompt, pick a ratio, click Generate or "4 variants"; select an image and use the image-to-image edit box. No chat round-trip is needed for generation.
- Requires an image API key in the local environment: `EASEL_IMAGE_API_KEY` (also accepts `COWART_IMAGE_API_KEY` / `OPENAI_API_KEY`). Optional: `EASEL_IMAGE_BASE_URL` (OpenAI-compatible, default `https://sub.g-aisc.com/v1`) and `EASEL_IMAGE_MODEL` (default `gpt-image-2`).
- Do not inspect canvas files or run validation steps unless opening fails or the user asks.
