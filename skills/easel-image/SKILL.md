---
name: easel-image
description: Generate or edit images on the Easel canvas through the Easel MCP tools. Use when the user asks Codex to generate an image on the Easel canvas, or to edit / revise a selected Easel image (true image-to-image). Most users drive this from the canvas Inspector panel; these tools are the agent-driven path.
---

# Easel Image

Use the Easel MCP tools. The running Easel canvas generates through the user's own image provider (BYOK). Prefer these tools over drawing images locally with code. The Easel canvas must be running first (see `easel-open-canvas`); default URL `http://127.0.0.1:43219` (pass `easelUrl` if different).

## Generate

Call `generate_easel_image`:

```json
{
  "prompt": "<image prompt; include exact in-image text when needed>",
  "ratio": 1.0,
  "placeBesideSelection": false
}
```

- `ratio` is width / height (e.g. `1` square, `1.7778` for 16:9, `0.5625` for 9:16). Or pass an explicit `size` like `"1024x1536"`.
- The tool generates with the configured provider, saves the image into the page assets, and inserts it as an image card on the canvas.
- Set `placeBesideSelection: true` to place the new image beside the currently selected shape.

## Edit (true image-to-image)

To revise an existing image, have the user select exactly one image (or pass `sourceShapeId`), then call `edit_easel_image`:

```json
{ "prompt": "<what to change; keep the rest>" }
```

- It sends the original image to the provider's `/images/edits` endpoint and places the revised image beside the original, preserving the original and applying only the requested change.
- Image edits can take ~30-50s.

## Notes

- Requires `EASEL_IMAGE_API_KEY` (or `COWART_IMAGE_API_KEY` / `OPENAI_API_KEY`) in the environment.
- If the tool reports no API key, tell the user to set it locally and restart Codex.
- Do not crop or resize results locally; the canvas displays them at a clean ratio.
