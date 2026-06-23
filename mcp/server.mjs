// Easel MCP server - the agent-driven entry point.
// Generation/editing is delegated to the running Easel local server
// (/api/generate, /api/edit), which shares the same BYOK provider as the
// canvas UI. This server then inserts the result as an image card into the
// canvas snapshot via /api/canvas.
import readline from "node:readline";
import { generateKeyBetween } from "fractional-indexing";
import { nonEmptyString } from "../shared/image-provider.mjs";

const SERVER_NAME = "Easel MCP";
const SERVER_VERSION = "0.1.0";
const DEFAULT_URL = "http://127.0.0.1:43219";
const DISPLAY_LONG_SIDE = 360;

const TOOL_GET_SELECTION = "get_easel_selection";
const TOOL_GENERATE = "generate_easel_image";
const TOOL_EDIT = "edit_easel_image";
const TOOL_EDIT_REGION = "edit_easel_region";
const TOOL_REGENERATE = "regenerate_easel_image";
const TOOL_GET_REQUESTS = "get_easel_requests";
const TOOL_COMPLETE_REQUEST = "complete_easel_request";

const JsonRpcError = { METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602 };

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function normalizeUrl(args = {}) {
  const value =
    nonEmptyString(args.easelUrl) || nonEmptyString(process.env.EASEL_URL) || DEFAULT_URL;
  return value.replace(/\/+$/, "");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 500);
    try {
      message = JSON.parse(text)?.error || message;
    } catch {}
    throw new Error(`${response.status} ${response.statusText}: ${message}`);
  }
  return text ? JSON.parse(text) : {};
}

async function loadSnapshot(url) {
  const payload = await fetchJson(`${url}/api/canvas`);
  const snapshot = payload?.snapshot ?? payload;
  if (!snapshot || typeof snapshot !== "object" || !snapshot.store || !snapshot.schema) {
    throw new Error(`Could not load Easel canvas from ${url}. Is the canvas running?`);
  }
  return snapshot;
}

async function saveSnapshot(url, snapshot) {
  return fetchJson(`${url}/api/canvas`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot),
  });
}

async function getSelection(url) {
  try {
    const payload = await fetchJson(`${url}/api/selection`);
    return payload?.selection ?? payload ?? { selectedShapes: [] };
  } catch {
    return { selectedShapes: [] };
  }
}

function firstPageId(store) {
  return Object.values(store).find((record) => record?.typeName === "page")?.id ?? null;
}

function selectedSingleShape(selection, store) {
  const shapes = selection?.selectedShapes ?? [];
  if (shapes.length !== 1) return null;
  return store[shapes[0]?.id] ?? null;
}

function chooseIndex(store, parentId) {
  const siblingIndexes = Object.values(store)
    .filter((r) => r?.typeName === "shape" && r.parentId === parentId && typeof r.index === "string")
    .map((r) => r.index)
    .sort();
  return generateKeyBetween(siblingIndexes.at(-1) ?? null, null);
}

function imageShapeCount(store, pageId) {
  return Object.values(store).filter((r) => r?.typeName === "shape" && r.type === "image" && r.parentId === pageId).length;
}

function displaySize(width, height) {
  if (!width || !height) return { w: DISPLAY_LONG_SIDE, h: DISPLAY_LONG_SIDE };
  if (width >= height) return { w: DISPLAY_LONG_SIDE, h: Math.round((DISPLAY_LONG_SIDE * height) / width) };
  return { w: Math.round((DISPLAY_LONG_SIDE * width) / height), h: DISPLAY_LONG_SIDE };
}

function randomSeed() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function insertImageCard(store, pageId, anchor, gen, meta) {
  const seed = randomSeed();
  const assetId = `asset:easel-${seed}`;
  const shapeId = `shape:easel-${seed}`;
  const { w, h } = displaySize(gen.width, gen.height);

  let x;
  let y;
  if (anchor && typeof anchor.x === "number") {
    x = anchor.x + (Number(anchor.props?.w) || 300) + 40;
    y = typeof anchor.y === "number" ? anchor.y : 0;
  } else {
    const n = imageShapeCount(store, pageId);
    x = 80 + (n % 3) * (DISPLAY_LONG_SIDE + 40);
    y = 80 + Math.floor(n / 3) * (DISPLAY_LONG_SIDE + 40);
  }

  store[assetId] = {
    id: assetId,
    typeName: "asset",
    type: "image",
    props: {
      name: gen.fileName || "easel-image",
      src: gen.src,
      w: gen.width,
      h: gen.height,
      fileSize: gen.fileSize || 0,
      mimeType: "image/png",
      isAnimated: false,
    },
    meta: {},
  };
  store[shapeId] = {
    x,
    y,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: { easelImage: true, createdAt: Date.now(), ...meta },
    id: shapeId,
    type: "image",
    props: {
      w,
      h,
      assetId,
      playing: true,
      url: "",
      crop: null,
      flipX: false,
      flipY: false,
      altText: nonEmptyString(meta?.prompt) || "Easel image",
    },
    parentId: pageId,
    index: chooseIndex(store, pageId),
    typeName: "shape",
  };
  return { assetId, shapeId, x, y, w, h };
}

async function generateEaselImage(args = {}) {
  const prompt = nonEmptyString(args.prompt);
  if (!prompt) throw new Error("prompt is required.");
  const url = normalizeUrl(args);
  const selection = await getSelection(url);
  const snapshot = await loadSnapshot(url);
  const store = snapshot.store;
  const anchor = selectedSingleShape(selection, store);
  const pageId = nonEmptyString(args.pageId) || anchor?.parentId || firstPageId(store);
  if (!pageId) throw new Error("Could not determine target page.");

  const gen = await fetchJson(`${url}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      pageId,
      ratio: args.ratio,
      size: args.size,
      model: args.model,
      baseUrl: args.baseUrl,
    }),
  });

  const placed = insertImageCard(store, pageId, args.placeBesideSelection ? anchor : null, gen, {
    prompt,
    kind: "generate",
  });
  await saveSnapshot(url, snapshot);
  return { pageId, requestedSize: gen.size, generatedSize: { width: gen.width, height: gen.height }, assetUrl: gen.src, ...placed };
}

async function editEaselImage(args = {}) {
  const prompt = nonEmptyString(args.prompt);
  if (!prompt) throw new Error("prompt is required.");
  const url = normalizeUrl(args);
  const selection = await getSelection(url);
  const snapshot = await loadSnapshot(url);
  const store = snapshot.store;

  const anchor =
    (nonEmptyString(args.sourceShapeId) && store[args.sourceShapeId]) || selectedSingleShape(selection, store);
  if (!anchor || anchor.type !== "image") {
    throw new Error("Select exactly one image to edit, or pass sourceShapeId of an image shape.");
  }
  const asset = anchor.props?.assetId ? store[anchor.props.assetId] : null;
  const sourceSrc = asset?.props?.src;
  if (!sourceSrc) throw new Error("Selected image has no local source to edit.");
  const pageId = anchor.parentId || firstPageId(store);

  const gen = await fetchJson(`${url}/api/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, pageId, sourceSrc, model: args.model, baseUrl: args.baseUrl }),
  });

  const placed = insertImageCard(store, pageId, anchor, gen, {
    prompt,
    kind: "edit",
    sourceShapeId: anchor.id,
  });
  await saveSnapshot(url, snapshot);
  return { pageId, requestedSize: gen.size, generatedSize: { width: gen.width, height: gen.height }, assetUrl: gen.src, ...placed };
}

function replaceImageInPlaceStore(store, shapeId, gen, meta) {
  const shape = store[shapeId];
  if (!shape) throw new Error("Image shape not found in canvas snapshot.");
  const seed = randomSeed();
  const assetId = `asset:easel-${seed}`;
  store[assetId] = {
    id: assetId,
    typeName: "asset",
    type: "image",
    props: {
      name: gen.fileName || "easel-image",
      src: gen.src,
      w: gen.width,
      h: gen.height,
      fileSize: gen.fileSize || 0,
      mimeType: "image/png",
      isAnimated: false,
    },
    meta: {},
  };
  store[shapeId] = {
    ...shape,
    props: { ...shape.props, assetId },
    meta: { ...shape.meta, ...meta, version: (Number(shape.meta?.version) || 1) + 1, replacedAt: Date.now() },
  };
  return { assetId, shapeId };
}

// Page-space bounds of a selected shape (prefer reported bounds; fall back to x/y/props).
function shapeBounds(s) {
  if (s?.bounds && Number.isFinite(s.bounds.x) && Number.isFinite(s.bounds.w)) {
    return { x: s.bounds.x, y: s.bounds.y, w: s.bounds.w, h: s.bounds.h };
  }
  const x = Number(s?.x), y = Number(s?.y), w = Number(s?.props?.w), h = Number(s?.props?.h);
  if ([x, y, w, h].every(Number.isFinite)) return { x, y, w, h };
  return null;
}

// Turn selected rectangle shape(s) into a region in the image's pixel space.
function deriveRegionFromSelection(selection, imageSel) {
  const geos = (selection?.selectedShapes ?? []).filter((s) => s.type === "geo");
  if (geos.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of geos) {
    const b = shapeBounds(g);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) return null;
  const ib = shapeBounds(imageSel);
  const aw = Number(imageSel.asset?.w), ah = Number(imageSel.asset?.h);
  if (!ib || ![aw, ah].every(Number.isFinite) || ib.w <= 0 || ib.h <= 0) return null;
  return {
    x: ((minX - ib.x) / ib.w) * aw,
    y: ((minY - ib.y) / ib.h) * ah,
    w: ((maxX - minX) / ib.w) * aw,
    h: ((maxY - minY) / ib.h) * ah,
  };
}

async function editRegionImage(args = {}) {
  const prompt = nonEmptyString(args.prompt);
  if (!prompt) throw new Error("prompt is required.");
  const url = normalizeUrl(args);
  const snapshot = await loadSnapshot(url);
  const store = snapshot.store;

  let region = args.region && typeof args.region === "object" ? args.region : null;
  let shape = nonEmptyString(args.sourceShapeId) && store[args.sourceShapeId]?.type === "image" ? store[args.sourceShapeId] : null;
  let src = shape ? store[shape.props?.assetId]?.props?.src ?? null : null;
  let deleteIds = Array.isArray(args.deleteShapeIds) ? args.deleteShapeIds.filter((id) => typeof id === "string") : [];

  // Fall back to the live selection when the image or region was not given explicitly.
  if (!shape || !region) {
    const selection = await getSelection(url);
    const shapes = selection?.selectedShapes ?? [];
    let imageSel = nonEmptyString(args.sourceShapeId) ? shapes.find((s) => s.id === args.sourceShapeId && s.type === "image") : null;
    if (!imageSel) {
      const imgs = shapes.filter((s) => s.type === "image");
      if (imgs.length === 1) imageSel = imgs[0];
    }
    if (!imageSel) throw new Error("Select the image and a rectangle together, or pass sourceShapeId + region.");
    if (!shape) {
      shape = store[imageSel.id];
      src = imageSel.asset?.src;
    }
    if (!region) region = deriveRegionFromSelection(selection, imageSel);
    if (deleteIds.length === 0) deleteIds = shapes.filter((s) => s.type === "geo").map((s) => s.id);
  }

  if (!shape) throw new Error("Image shape not found in canvas snapshot.");
  if (!nonEmptyString(src)) throw new Error("Selected image has no local source to edit.");
  if (!region || !(region.w > 0) || !(region.h > 0)) {
    throw new Error("Provide a rectangle region (draw one + select with the image, or pass region {x,y,w,h} in image pixels).");
  }

  const pageId = shape.parentId || firstPageId(store);
  const srcField = src.startsWith("data:") ? { sourceDataUrl: src } : { sourceSrc: src };

  const gen = await fetchJson(`${url}/api/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, pageId, ...srcField, region, model: args.model, baseUrl: args.baseUrl }),
  });

  replaceImageInPlaceStore(store, shape.id, gen, { prompt, kind: "region" });
  for (const gid of deleteIds) {
    if (store[gid]) delete store[gid];
  }
  await saveSnapshot(url, snapshot);
  return { pageId, shapeId: shape.id, size: gen.size, width: gen.width, height: gen.height, assetUrl: gen.src };
}

async function regenerateEaselImage(args = {}) {
  const prompt = nonEmptyString(args.prompt);
  if (!prompt) throw new Error("prompt is required.");
  const url = normalizeUrl(args);
  const snapshot = await loadSnapshot(url);
  const store = snapshot.store;
  const shape = nonEmptyString(args.sourceShapeId) ? store[args.sourceShapeId] : selectedSingleShape(await getSelection(url), store);
  if (!shape || shape.type !== "image") throw new Error("sourceShapeId must reference an image shape (or select one image).");
  const pageId = shape.parentId || firstPageId(store);
  const gen = await fetchJson(`${url}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, pageId, ratio: args.ratio, size: args.size, model: args.model, baseUrl: args.baseUrl }),
  });
  replaceImageInPlaceStore(store, shape.id, gen, { prompt, kind: "regenerate" });
  await saveSnapshot(url, snapshot);
  return { pageId, shapeId: shape.id, size: gen.size, width: gen.width, height: gen.height, assetUrl: gen.src };
}

async function getEaselRequests(args = {}) {
  const url = normalizeUrl(args);
  const payload = await fetchJson(`${url}/api/requests`);
  return Array.isArray(payload?.requests) ? payload.requests : [];
}

async function completeEaselRequest(args = {}) {
  const url = normalizeUrl(args);
  return fetchJson(`${url}/api/requests/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: args.id, all: args.all === true }),
  });
}

function toolDefinitions() {
  return [
    {
      name: TOOL_GET_SELECTION,
      title: "Get Easel Selection",
      description: "Return the currently selected Easel canvas shapes and image asset metadata.",
      inputSchema: {
        type: "object",
        properties: {
          easelUrl: { type: "string", description: "Running Easel URL, default http://127.0.0.1:43219." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: TOOL_GENERATE,
      title: "Generate Easel Image",
      description:
        "Generate an image with the configured BYOK provider and insert it as a card on the Easel canvas. Pass a ratio (w/h) or an explicit size. Set placeBesideSelection to place it beside the selected shape.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Image prompt. Include in-image text when needed." },
          easelUrl: { type: "string", description: "Running Easel URL, default http://127.0.0.1:43219." },
          pageId: { type: "string", description: "Target page id. Optional." },
          ratio: { type: "number", description: "Aspect ratio width/height (e.g. 1, 1.7778, 0.5625). Defaults to 1." },
          size: { type: "string", description: "Explicit WIDTHxHEIGHT override." },
          model: { type: "string", description: "Override image model." },
          baseUrl: { type: "string", description: "Override OpenAI-compatible base URL." },
          placeBesideSelection: { type: "boolean", description: "Place beside the selected shape instead of a free slot." },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    {
      name: TOOL_EDIT,
      title: "Edit Easel Image",
      description:
        "True image-to-image edit of a selected Easel image via /images/edits, placing the revised image beside the original. Select one image (or pass sourceShapeId).",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Edit instruction." },
          easelUrl: { type: "string", description: "Running Easel URL, default http://127.0.0.1:43219." },
          sourceShapeId: { type: "string", description: "Image shape id to edit. Optional when one image is selected." },
          model: { type: "string", description: "Override image model." },
          baseUrl: { type: "string", description: "Override OpenAI-compatible base URL." },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    {
      name: TOOL_EDIT_REGION,
      title: "Edit Easel Region",
      description:
        "Regenerate ONLY a rectangular region of a selected image and composite it back in place (real regional edit; works even though the provider ignores edit masks). Ask the user to draw a rectangle over the area to change and select it together with the image, or pass an explicit region {x,y,w,h} in image pixel coordinates. Pass a complete, detailed prompt describing what that region should become, consistent with the rest of the image.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed description of what the region should become." },
          easelUrl: { type: "string", description: "Running Easel URL, default http://127.0.0.1:43219." },
          sourceShapeId: { type: "string", description: "Image shape id. Optional when one image is selected." },
          region: {
            type: "object",
            description: "Optional explicit region in source-image pixels. If omitted, derived from the selected rectangle(s).",
            properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
          },
          deleteShapeIds: { type: "array", description: "Shape ids (e.g. the rectangle) to remove after the edit.", items: { type: "string" } },
          model: { type: "string", description: "Override image model." },
          baseUrl: { type: "string", description: "Override OpenAI-compatible base URL." },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    {
      name: TOOL_REGENERATE,
      title: "Regenerate Easel Image",
      description:
        "Generate a fresh image from a detailed prompt and replace the selected image in place (text-to-image, same slot). Pass sourceShapeId or select one image.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Full, detailed image prompt." },
          easelUrl: { type: "string", description: "Running Easel URL, default http://127.0.0.1:43219." },
          sourceShapeId: { type: "string", description: "Image shape id to replace. Optional when one image is selected." },
          ratio: { type: "number", description: "Aspect ratio width/height. Defaults to the source's ratio." },
          size: { type: "string", description: "Explicit WIDTHxHEIGHT override." },
          model: { type: "string", description: "Override image model." },
          baseUrl: { type: "string", description: "Override OpenAI-compatible base URL." },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    {
      name: TOOL_GET_REQUESTS,
      title: "Get Easel Requests",
      description:
        "Read the pending request queue created by the canvas buttons (when the user runs them in 'send to Codex' mode). Each request has an action (generate/variants/batch/edit/region/regenerate), prompt, and (for edits) targetShapeId / region / regionShapeIds. Process each with the matching tool, then call complete_easel_request with its id.",
      inputSchema: {
        type: "object",
        properties: { easelUrl: { type: "string", description: "Running Easel URL, default http://127.0.0.1:43219." } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: TOOL_COMPLETE_REQUEST,
      title: "Complete Easel Request",
      description: "Remove a processed request from the queue by id (or pass all:true to clear the whole queue).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Request id to remove." },
          all: { type: "boolean", description: "Clear the entire queue." },
          easelUrl: { type: "string", description: "Running Easel URL, default http://127.0.0.1:43219." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
  ];
}

async function handleToolCall(id, params) {
  const name = params?.name;
  const args = params?.arguments ?? {};
  if (name === TOOL_GET_SELECTION) {
    const selection = await getSelection(normalizeUrl(args));
    const shapes = selection.selectedShapes ?? [];
    const summary =
      shapes.length === 0
        ? "No Easel shapes are currently selected."
        : shapes
            .map(
              (s) =>
                `${s.id} [${s.type ?? "unknown"}]${nonEmptyString(s.text) ? ` “${s.text}”` : ""}${s.asset?.name ? ` (${s.asset.name})` : ""}`
            )
            .join("\n");
    sendResult(id, { content: [{ type: "text", text: summary }], structuredContent: { selection } });
    return;
  }
  if (name === TOOL_GENERATE) {
    const result = await generateEaselImage(args);
    sendResult(id, {
      content: [{ type: "text", text: `Generated ${result.requestedSize} and inserted ${result.shapeId} on ${result.pageId}.` }],
      structuredContent: result,
    });
    return;
  }
  if (name === TOOL_EDIT) {
    const result = await editEaselImage(args);
    sendResult(id, {
      content: [{ type: "text", text: `Edited and inserted ${result.shapeId} beside the source on ${result.pageId}.` }],
      structuredContent: result,
    });
    return;
  }
  if (name === TOOL_EDIT_REGION) {
    const result = await editRegionImage(args);
    sendResult(id, {
      content: [{ type: "text", text: `Regenerated the region of ${result.shapeId} in place on ${result.pageId}.` }],
      structuredContent: result,
    });
    return;
  }
  if (name === TOOL_REGENERATE) {
    const result = await regenerateEaselImage(args);
    sendResult(id, {
      content: [{ type: "text", text: `Regenerated ${result.shapeId} in place on ${result.pageId}.` }],
      structuredContent: result,
    });
    return;
  }
  if (name === TOOL_GET_REQUESTS) {
    const requests = await getEaselRequests(args);
    const summary =
      requests.length === 0
        ? "No pending canvas requests."
        : requests
            .map((r) => `${r.id} [${r.action}]${nonEmptyString(r.prompt) ? ` “${r.prompt}”` : ""}${nonEmptyString(r.targetShapeId) ? ` -> ${r.targetShapeId}` : ""}`)
            .join("\n");
    sendResult(id, { content: [{ type: "text", text: summary }], structuredContent: { requests } });
    return;
  }
  if (name === TOOL_COMPLETE_REQUEST) {
    const result = await completeEaselRequest(args);
    sendResult(id, { content: [{ type: "text", text: `Queue updated. Pending: ${result?.pending ?? "?"}.` }], structuredContent: result });
    return;
  }
  sendError(id, JsonRpcError.INVALID_PARAMS, `Unknown tool: ${name ?? ""}`);
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions:
        "Drive the Easel canvas through conversation. get_easel_selection reads what is selected (including geometry and annotation text); generate_easel_image creates an image card; edit_easel_image does whole-image image-to-image; edit_easel_region regenerates only a drawn rectangle in place; regenerate_easel_image replaces a selected image in place. The canvas buttons can also enqueue work: get_easel_requests returns pending requests (each with action + prompt + targetShapeId/region), which you execute with the matching tool and then clear via complete_easel_request. Read the canvas, infer intent, write complete prompts, and iterate. Generation uses the running Easel local server's BYOK provider.",
    });
    return;
  }
  if (method === "ping") {
    sendResult(id, {});
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    sendResult(id, { tools: toolDefinitions() });
    return;
  }
  if (method === "tools/call") {
    try {
      await handleToolCall(id, params);
    } catch (error) {
      sendError(id, JsonRpcError.INVALID_PARAMS, error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (id !== undefined) sendError(id, JsonRpcError.METHOD_NOT_FOUND, `Method not found: ${method}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (line.trim().length === 0) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  handleRequest(message).catch((error) => {
    if (message.id !== undefined) {
      sendError(message.id, JsonRpcError.INVALID_PARAMS, error instanceof Error ? error.message : String(error));
    }
  });
});
