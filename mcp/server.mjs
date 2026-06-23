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
    nonEmptyString(args.easelUrl) || nonEmptyString(args.cowartUrl) || nonEmptyString(process.env.EASEL_URL) || DEFAULT_URL;
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
        : shapes.map((s) => `${s.id} [${s.type ?? "unknown"}]${s.asset?.name ? ` (${s.asset.name})` : ""}`).join("\n");
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
        "Drive the Easel canvas: get_easel_selection reads selection; generate_easel_image creates an image and inserts it as a card; edit_easel_image does true image-to-image on the selected image. Generation uses the running Easel local server's BYOK provider.",
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
