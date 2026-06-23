---
name: easel-image
description: Drive the Easel infinite canvas from Codex - generate images, do whole-image edits, and regenerate just a rectangular region (regional edit) of a selected image. Use whenever the user wants to create or change images on their Easel canvas through conversation, rather than clicking the canvas Inspector themselves.
---

# Easel Image

Easel is the user's infinite image canvas. The value of running it inside Codex is that **you** drive it: read what is on the canvas, understand the user's intent (even when their description is short), write the actual image instructions, act, then look at the result and iterate together. Don't treat these as fire-and-forget calls — converse.

The canvas must be running first (see `easel-open-canvas`); default URL `http://127.0.0.1:43219` (pass `easelUrl` if different). All generation uses the user's own provider (BYOK).

## How to behave on every request

- **Read first.** Call `get_easel_selection` to see what is selected (it includes each shape's geometry and image asset size). Use it to decide whether to generate fresh, edit the whole image, or edit a region.
- **Write the full prompt yourself.** Users are often brief ("画只猫", "换个背景"). Expand that into a complete, concrete image instruction using the context of the conversation and the canvas: subject, composition, setting, style, lighting, color, mood, and any **in-image text quoted verbatim**. Keep every explicit detail the user gave; fill in only what's missing. This is the main way Codex makes the output better.
- **Pick the aspect ratio** that fits the intent (poster → `9:16`, banner → `16:9`, product → `1:1`).
- **Iterate.** After acting, briefly say what you did and offer the next concrete step (variant, tweak, regional fix).

## Generate a new image

`generate_easel_image`:

```json
{ "prompt": "<full, detailed prompt; in-image text verbatim>", "ratio": 1.0, "placeBesideSelection": false }
```

- `ratio` = width / height (`1`, `1.7778` for 16:9, `0.5625` for 9:16), or pass explicit `size` like `"1024x1536"`.
- `placeBesideSelection: true` places it next to the selected shape.

## Whole-image edit

When the change affects the whole image (restyle, relight, global change), have the user select one image (or pass `sourceShapeId`), then `edit_easel_image`:

```json
{ "prompt": "<what to change; keep the rest>" }
```

Places the revised image beside the original. ~30-50s.

## Regional edit (change only a box) — the key canvas workflow

To change **only part** of an image (add/replace an object, fix one area), use `edit_easel_region`. This is a real regional edit (crop → regenerate → composite back); it does **not** rely on provider masks, which the hosted gpt-image providers ignore.

Workflow:
1. Ask the user to pick the rectangle tool, **draw a rectangle over the area to change**, then select that rectangle **together with the image** (Shift-click or marquee).
2. Call `edit_easel_region` with a full prompt describing what that region should become, consistent with the rest of the image:

```json
{ "prompt": "a small red plush toy resting on the bed, soft natural light matching the scene" }
```

- The region is taken from the selected rectangle automatically. You may instead pass an explicit `region: { x, y, w, h }` in **source-image pixels** (use the image asset's `w`/`h` from `get_easel_selection` to compute it).
- The image is updated **in place** at the same size; everything outside the box is kept unchanged. The rectangle is removed afterward.

## Annotation-driven editing (point and describe) — often the most natural

Frequently the easiest way to edit: the user draws arrows / text / notes on the canvas pointing at parts of an image (e.g. an arrow labeled “短发” at the hair, “短T” at the shirt, “ipad” at the hands), then selects the image **together with** those annotations.

`get_easel_selection` returns each shape's `text` and page `bounds`, so you can read what each annotation asks for and where it points. Then:

- Read every annotation: the requested change, and which part of the image its bounds/arrow indicate.
- Decide how to apply it:
  - **Several stylistic / overlapping changes** (hair + clothing + add a held object): compose ONE combined instruction and call `edit_easel_image` (whole-image img2img). Explicitly keep the person's identity, pose, framing, and background; apply only the annotated changes.
  - **One isolated, contained change** where the rest must stay pixel-identical: call `edit_easel_region` for the area that annotation points at.
- After editing, say what you changed and offer to clear the annotation shapes or iterate.

Annotations are ordinary tldraw arrow / text / note shapes — no special tool needed.

## Notes

- Requires `EASEL_IMAGE_API_KEY` (or `OPENAI_API_KEY`) in the environment. If a tool reports no key, tell the user to set it locally and restart Codex.
- Don't crop or resize results locally; the canvas already displays them cleanly.
