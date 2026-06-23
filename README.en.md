# Easel

Easel is a local **infinite-canvas AI image studio** for Codex, built on [tldraw](https://github.com/tldraw/tldraw). Generate images directly on the canvas, run true image-to-image edits, spin up variants, compare and iterate - all with your own image API (BYOK, multi-provider). The Codex agent can also read and drive the canvas. Canvas data is saved in the active project's `studio/`, not in the plugin repo.

中文说明: [README.md](README.md)

## Features

- **Inspector panel** (top-right of the canvas): type a prompt, pick a ratio, click Generate or "4 variants"; results land as clean image cards you can move/resize freely (no cropping).
- **Image-to-image editing**: select an image, describe the change, and Easel calls `/images/edits` to revise it while preserving the original, placing the result beside it.
- **BYOK multi-provider**: bring your own OpenAI-compatible key; no dependence on subscription quota.
- **Generation lives in the local server**: canvas buttons generate directly (no chat round-trip); the Codex agent can also drive it through MCP tools.
- Canvas and image assets are persisted locally with live hot-reload.

## Install

```bash
mkdir -p ~/plugins
git clone https://github.com/lazypay/easel.git ~/plugins/easel
cd ~/plugins/easel
npm install
npm run build
```

Make sure `~/.agents/plugins/marketplace.json` has an Easel entry (`source.path` -> `./plugins/easel`), then `codex plugin add easel@personal`. Start a new Codex conversation afterwards so the skills and MCP tools load cleanly.

## Configure the image API

Easel generates through an OpenAI-compatible image endpoint (default `gpt-image-2` on `https://sub.g-aisc.com/v1`). Set your API key as a local environment variable:

| Variable | Description | Default |
| --- | --- | --- |
| `EASEL_IMAGE_API_KEY` | Image API key (also accepts `COWART_IMAGE_API_KEY` / `OPENAI_API_KEY`) | none, required |
| `EASEL_IMAGE_BASE_URL` | OpenAI-compatible base URL | `https://sub.g-aisc.com/v1` |
| `EASEL_IMAGE_MODEL` | Image model | `gpt-image-2` |

Windows: `setx EASEL_IMAGE_API_KEY "YOUR_KEY"`. macOS/Linux: `export ... >> ~/.zshrc`. Reload the Codex plugin afterwards.

## Usage

1. Ask Codex: "Open the Easel canvas for this project." Default URL `http://127.0.0.1:43219/`.
2. Use the Inspector panel: prompt -> ratio -> Generate / 4 variants.
3. To revise an image: select it, describe the change in the edit box, click edit.
4. Or let the Codex agent drive it via the MCP tools below.

## MCP tools

- `get_easel_selection`: read the current selection (including geometry).
- `generate_easel_image`: generate (by `ratio` or `size`) and insert as a card.
- `edit_easel_image`: whole-image image-to-image on the selected image, placed beside the original.
- `edit_easel_region`: regenerate only a drawn rectangle and composite it back in place (real regional edit; no provider mask needed).

## Skills

- `easel:easel-open-canvas`: open the local Easel canvas.
- `easel:easel-image`: generate / edit canvas images via the MCP tools.

## Acknowledgements

Canvas powered by [tldraw/tldraw](https://github.com/tldraw/tldraw). Easel's early implementation drew on the local-canvas approach of [zhongerxin/Cowart](https://github.com/zhongerxin/Cowart).
