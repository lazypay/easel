// Shared BYOK image provider for Easel.
// Used by both the local canvas server (vite.config.js) and the MCP server,
// so the canvas UI and the agent share one generation/edit pipeline.
import { execFileSync } from "node:child_process";

export const IMAGE_BASE_URL_DEFAULT = "https://sub.g-aisc.com/v1";
export const IMAGE_MODEL_DEFAULT = "gpt-image-2";
export const IMAGE_SIZE_MULTIPLE = 16;
export const IMAGE_MIN_PIXELS = 655360;
export const IMAGE_MAX_PIXELS = 8294400;
export const IMAGE_MAX_SIDE = 4096;
export const IMAGE_DEFAULT_BUDGET_PIXELS = 1600000;
export const IMAGE_REQUEST_TIMEOUT_MS = 180000;

export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readWindowsUserEnv(name) {
  if (process.platform !== "win32") return null;
  try {
    const output = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, "i"));
      if (match?.[1]?.trim()) return match[1].trim();
    }
  } catch {
    return null;
  }
  return null;
}

function envValue(...names) {
  for (const name of names) {
    const direct = nonEmptyString(process.env[name]);
    if (direct) return direct;
  }
  for (const name of names) {
    const fromRegistry = nonEmptyString(readWindowsUserEnv(name));
    if (fromRegistry) return fromRegistry;
  }
  return null;
}

export function resolveImageApiKey(args = {}) {
  return (
    nonEmptyString(args.apiKey) ||
    envValue("EASEL_IMAGE_API_KEY", "COWART_IMAGE_API_KEY", "GAISC_API_KEY", "G_AISC_API_KEY", "OPENAI_API_KEY")
  );
}

export function resolveImageBaseUrl(args = {}) {
  const value =
    nonEmptyString(args.baseUrl) ||
    envValue("EASEL_IMAGE_BASE_URL", "COWART_IMAGE_BASE_URL", "GAISC_BASE_URL") ||
    IMAGE_BASE_URL_DEFAULT;
  return value.replace(/\/+$/, "");
}

export function resolveImageModel(args = {}) {
  return nonEmptyString(args.model) || envValue("EASEL_IMAGE_MODEL", "COWART_IMAGE_MODEL", "GAISC_MODEL") || IMAGE_MODEL_DEFAULT;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundToMultiple(value, multiple) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function floorToMultiple(value, multiple) {
  return Math.max(multiple, Math.floor(value / multiple) * multiple);
}

// Map an arbitrary ratio to a provider-legal pixel size: both sides multiples
// of IMAGE_SIZE_MULTIPLE and total pixels within the allowed range.
export function computeGenerationSize(ratio, budgetPixels) {
  const safeRatio = ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
  const budget = clampNumber(finiteNumber(budgetPixels, IMAGE_DEFAULT_BUDGET_PIXELS), IMAGE_MIN_PIXELS, IMAGE_MAX_PIXELS);

  let width = clampNumber(roundToMultiple(Math.sqrt(budget * safeRatio), IMAGE_SIZE_MULTIPLE), IMAGE_SIZE_MULTIPLE, IMAGE_MAX_SIDE);
  let height = clampNumber(roundToMultiple(Math.sqrt(budget / safeRatio), IMAGE_SIZE_MULTIPLE), IMAGE_SIZE_MULTIPLE, IMAGE_MAX_SIDE);

  for (let guard = 0; guard < 8 && width * height < IMAGE_MIN_PIXELS; guard += 1) {
    const factor = Math.sqrt(IMAGE_MIN_PIXELS / (width * height));
    width = clampNumber(roundToMultiple(width * factor, IMAGE_SIZE_MULTIPLE), IMAGE_SIZE_MULTIPLE, IMAGE_MAX_SIDE);
    height = clampNumber(roundToMultiple(height * factor, IMAGE_SIZE_MULTIPLE), IMAGE_SIZE_MULTIPLE, IMAGE_MAX_SIDE);
  }
  for (let guard = 0; guard < 8 && width * height > IMAGE_MAX_PIXELS; guard += 1) {
    const factor = Math.sqrt(IMAGE_MAX_PIXELS / (width * height));
    width = floorToMultiple(width * factor, IMAGE_SIZE_MULTIPLE);
    height = floorToMultiple(height * factor, IMAGE_SIZE_MULTIPLE);
  }

  return { width, height };
}

export function parseExplicitSize(value) {
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(value || "").trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = IMAGE_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Image API request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function parseImageApiResponse(response) {
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 600) };
    }
  }
  if (!response.ok) {
    const message =
      payload?.error?.message || payload?.error || payload?.raw || `${response.status} ${response.statusText}`;
    throw new Error(`Image API request failed (HTTP ${response.status}): ${message}`);
  }
  return payload;
}

function imageBufferFromPayload(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  for (const item of data) {
    const b64 = nonEmptyString(item?.b64_json);
    if (b64) return Buffer.from(b64, "base64");
  }
  return null;
}

function imageUrlFromPayload(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  for (const item of data) {
    const url = nonEmptyString(item?.url);
    if (url) return url;
  }
  return null;
}

async function requestImageGeneration({ apiKey, baseUrl, model, prompt, size, extra = {} }) {
  const response = await fetchWithTimeout(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, size, response_format: "b64_json", ...extra }),
  });
  return parseImageApiResponse(response);
}

// True image-to-image via /images/edits. Primary format is JSON with
// images:[{ image_url }] (accepts base64 data URLs); falls back to multipart.
async function requestImageEdit({ apiKey, baseUrl, model, prompt, imageBuffer, mimeType = "image/png", size, maskBuffer, maskMimeType = "image/png" }) {
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  const maskDataUrl = maskBuffer ? `data:${maskMimeType};base64,${maskBuffer.toString("base64")}` : null;
  try {
    const body = { model, prompt, images: [{ image_url: dataUrl }], response_format: "b64_json" };
    if (size) body.size = size;
    if (maskDataUrl) body.mask = { image_url: maskDataUrl };
    const response = await fetchWithTimeout(`${baseUrl}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await parseImageApiResponse(response);
  } catch (jsonError) {
    const form = new FormData();
    form.append("image", new Blob([imageBuffer], { type: mimeType }), "input.png");
    form.append("prompt", prompt);
    if (model) form.append("model", model);
    if (size) form.append("size", size);
    if (maskBuffer) form.append("mask", new Blob([maskBuffer], { type: maskMimeType }), "mask.png");
    form.append("response_format", "b64_json");
    const response = await fetchWithTimeout(`${baseUrl}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    try {
      return await parseImageApiResponse(response);
    } catch (multipartError) {
      throw new Error(`Image edit failed (json: ${jsonError.message}; multipart: ${multipartError.message})`);
    }
  }
}

async function downloadImageBuffer(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`Failed to download generated image: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function bufferFromPayload(payload) {
  let buffer = imageBufferFromPayload(payload);
  let downloadedFromUrl = null;
  if (!buffer) {
    downloadedFromUrl = imageUrlFromPayload(payload);
    if (downloadedFromUrl) buffer = await downloadImageBuffer(downloadedFromUrl);
  }
  if (!buffer) throw new Error("Image API returned no image data.");
  return { buffer, downloadedFromUrl };
}

// High-level: text-to-image -> PNG buffer.
export async function generateImageToBuffer({ apiKey, baseUrl, model, prompt, size, quality, background }) {
  const extra = {};
  if (nonEmptyString(quality)) extra.quality = nonEmptyString(quality);
  if (nonEmptyString(background)) extra.background = nonEmptyString(background);
  const payload = await requestImageGeneration({ apiKey, baseUrl, model, prompt, size, extra });
  return bufferFromPayload(payload);
}

// High-level: image-to-image (edit) -> PNG buffer.
export async function editImageToBuffer({ apiKey, baseUrl, model, prompt, imageBuffer, mimeType, size, maskBuffer, maskMimeType }) {
  const payload = await requestImageEdit({ apiKey, baseUrl, model, prompt, imageBuffer, mimeType, size, maskBuffer, maskMimeType });
  return bufferFromPayload(payload);
}

// Real regional edit (provider-agnostic). The hosted gpt-image proxies ignore
// edit masks, so instead of masking we crop the region, regenerate just that
// crop from the prompt, then composite it back with a feathered seam. Pixels
// outside the region are kept byte-for-byte. region is in source pixel coords.
export async function editRegionToBuffer({ apiKey, baseUrl, model, prompt, imageBuffer, region, budgetPixels }) {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(imageBuffer).metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) throw new Error("Could not read source image dimensions.");

  let x = Math.round(finiteNumber(region?.x, 0));
  let y = Math.round(finiteNumber(region?.y, 0));
  let w = Math.round(finiteNumber(region?.w, 0));
  let h = Math.round(finiteNumber(region?.h, 0));
  x = clampNumber(x, 0, Math.max(0, W - 1));
  y = clampNumber(y, 0, Math.max(0, H - 1));
  w = clampNumber(w, 1, W - x);
  h = clampNumber(h, 1, H - y);
  if (w < 8 || h < 8) throw new Error("Region is too small to edit.");

  // Crop the region, upscale it to a provider-legal size, regenerate, scale back.
  const cropBuf = await sharp(imageBuffer).extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
  const gen = computeGenerationSize(w / h, budgetPixels);
  const genStr = `${gen.width}x${gen.height}`;
  const cropResized = await sharp(cropBuf).resize(gen.width, gen.height, { fit: "fill" }).png().toBuffer();
  const { buffer: patchRaw } = await editImageToBuffer({
    apiKey, baseUrl, model, prompt, imageBuffer: cropResized, mimeType: "image/png", size: genStr,
  });

  // Feathered alpha (white center fading to transparent edges) for a soft seam.
  const feather = clampNumber(Math.round(Math.min(w, h) * 0.05), 2, 64);
  const innerW = Math.max(1, w - feather * 2);
  const innerH = Math.max(1, h - feather * 2);
  const whiteRect = await sharp({ create: { width: innerW, height: innerH, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  const maskRgb = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: whiteRect, left: feather, top: feather }])
    .blur(feather)
    .png()
    .toBuffer();
  const alpha = await sharp(maskRgb).extractChannel(0).raw().toBuffer();

  const patchRgb = await sharp(patchRaw).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const patchRgba = await sharp(patchRgb, { raw: { width: w, height: h, channels: 3 } })
    .joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();

  const outBuffer = await sharp(imageBuffer).composite([{ input: patchRgba, left: x, top: y }]).png().toBuffer();
  return { buffer: outBuffer, width: W, height: H, size: genStr };
}

// Read width/height from PNG/JPEG/WebP bytes (no deps).
export function readImageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const size = buffer.readUInt16BE(offset + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + size;
    }
  }
  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    if (buffer.toString("ascii", 12, 16) === "VP8X") {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
  }
  return null;
}
