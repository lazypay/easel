import { AssetRecordType, createShapeId, useEditor, useValue } from 'tldraw'
import { useEffect, useState } from 'react'

const RATIOS = [
  { id: '1:1', value: 1 },
  { id: '4:3', value: 4 / 3 },
  { id: '3:4', value: 3 / 4 },
  { id: '16:9', value: 16 / 9 },
  { id: '9:16', value: 9 / 16 },
  { id: '3:2', value: 3 / 2 },
  { id: '2:3', value: 2 / 3 }
]
const DISPLAY_LONG_SIDE = 360

function displaySize(width, height) {
  if (!width || !height) return { w: DISPLAY_LONG_SIDE, h: DISPLAY_LONG_SIDE }
  if (width >= height) return { w: DISPLAY_LONG_SIDE, h: Math.round((DISPLAY_LONG_SIDE * height) / width) }
  return { w: Math.round((DISPLAY_LONG_SIDE * width) / height), h: DISPLAY_LONG_SIDE }
}

// External images dragged/pasted in start as data: URLs (not yet localized to
// disk); send those as sourceDataUrl so they can be edited immediately.
function sourceField(src) {
  if (typeof src === 'string' && src.startsWith('data:')) return { sourceDataUrl: src }
  return { sourceSrc: src }
}

function createImageAsset(editor, result) {
  const assetId = AssetRecordType.createId()
  editor.createAssets([
    {
      id: assetId,
      typeName: 'asset',
      type: 'image',
      props: {
        name: result.fileName ?? 'easel-image',
        src: result.src,
        w: result.width,
        h: result.height,
        mimeType: 'image/png',
        isAnimated: false,
        fileSize: result.fileSize ?? 0
      },
      meta: {}
    }
  ])
  return assetId
}

function insertImageCard(editor, result, centerX, centerY, meta) {
  const assetId = createImageAsset(editor, result)
  const { w, h } = displaySize(result.width, result.height)
  const id = createShapeId()
  editor.createShape({
    id,
    type: 'image',
    x: centerX - w / 2,
    y: centerY - h / 2,
    props: { w, h, assetId },
    meta: {
      easelImage: true,
      createdAt: Date.now(),
      version: 1,
      model: result.model ?? null,
      size: result.size ?? null,
      provider: result.provider ?? null,
      ...meta
    }
  })
  editor.select(id)
  return id
}

function replaceImageInPlace(editor, shape, result, meta) {
  const assetId = createImageAsset(editor, result)
  const { w, h } = displaySize(result.width, result.height)
  editor.updateShape({
    id: shape.id,
    type: 'image',
    props: { ...shape.props, assetId, w, h },
    meta: {
      ...shape.meta,
      ...meta,
      model: result.model ?? shape.meta?.model ?? null,
      size: result.size ?? shape.meta?.size ?? null,
      provider: result.provider ?? shape.meta?.provider ?? null,
      version: (Number(shape.meta?.version) || 1) + 1,
      replacedAt: Date.now()
    }
  })
  editor.select(shape.id)
}

// Best-effort lineage arrow from source -> result (unbound; a visual hint).
function drawLineageArrow(editor, fromId, toId) {
  try {
    const a = editor.getShapePageBounds(fromId)
    const b = editor.getShapePageBounds(toId)
    if (!a || !b) return
    editor.createShape({
      id: createShapeId(),
      type: 'arrow',
      x: 0,
      y: 0,
      props: {
        start: { x: a.maxX, y: a.midY },
        end: { x: b.minX, y: b.midY },
        color: 'grey',
        size: 's',
        dash: 'dotted',
        arrowheadStart: 'none',
        arrowheadEnd: 'arrow'
      },
      meta: { easelLineage: true }
    })
  } catch {
    /* lineage arrow is best-effort */
  }
}

function downloadAsset(editor, shape) {
  const asset = shape?.props?.assetId ? editor.getAsset(shape.props.assetId) : null
  const src = asset?.props?.src
  if (!src) return false
  const link = document.createElement('a')
  link.href = src
  link.download = asset.props.name || 'easel-image.png'
  document.body.appendChild(link)
  link.click()
  link.remove()
  return true
}

// Map the selected rectangle(s) onto the image to get a region in source pixels.
function regionFromRects(editor, image, rects, aw, ah) {
  const ib = editor.getShapePageBounds(image.id)
  if (!ib || ib.w <= 0 || ib.h <= 0 || !aw || !ah) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rects) {
    const rb = editor.getShapePageBounds(r.id)
    if (!rb) continue
    minX = Math.min(minX, rb.minX)
    minY = Math.min(minY, rb.minY)
    maxX = Math.max(maxX, rb.maxX)
    maxY = Math.max(maxY, rb.maxY)
  }
  if (!Number.isFinite(minX)) return null
  const region = {
    x: ((minX - ib.minX) / ib.w) * aw,
    y: ((minY - ib.minY) / ib.h) * ah,
    w: ((maxX - minX) / ib.w) * aw,
    h: ((maxY - minY) / ib.h) * ah
  }
  return region.w > 0 && region.h > 0 ? region : null
}

const PRESETS = [
  { id: '电商主图', ratio: '1:1', text: '电商产品主图，纯白背景，居中构图，柔和影棚布光，高细节，干净，留出文案空间：' },
  { id: '竖版海报', ratio: '9:16', text: '竖版宣传海报，强视觉冲击，醒目标题文字，鲜明品牌色，留白排版：' },
  { id: '头像', ratio: '1:1', text: '人物头像，半身，柔光，简洁干净背景，专业质感：' },
  { id: '横幅Banner', ratio: '16:9', text: '网站横幅 banner，宽幅构图，主体偏一侧，大面积留白放标题：' },
  { id: '扁平插画', ratio: '4:3', text: '扁平矢量插画风格，清新配色，简洁线条，现代感：' }
]

// Composite the given images into one grid PNG and download it (local only).
async function exportContactSheet(editor, images) {
  const srcs = images.map((s) => editor.getAsset(s.props?.assetId)?.props?.src).filter(Boolean)
  if (srcs.length === 0) return false
  const loaded = await Promise.all(
    srcs.map(
      (src) =>
        new Promise((resolve) => {
          const im = new Image()
          im.onload = () => resolve(im)
          im.onerror = () => resolve(null)
          im.src = src
        })
    )
  )
  const imgs = loaded.filter(Boolean)
  if (imgs.length === 0) return false
  const cell = 512
  const gap = 16
  const cols = Math.min(imgs.length, 3)
  const rows = Math.ceil(imgs.length / cols)
  const width = cols * cell + (cols + 1) * gap
  const height = rows * cell + (rows + 1) * gap
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  imgs.forEach((im, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx = gap + col * (cell + gap)
    const cy = gap + row * (cell + gap)
    const scale = Math.min(cell / im.width, cell / im.height)
    const w = im.width * scale
    const h = im.height * scale
    ctx.drawImage(im, cx + (cell - w) / 2, cy + (cell - h) / 2, w, h)
  })
  const link = document.createElement('a')
  link.href = canvas.toDataURL('image/png')
  link.download = `easel-contact-sheet-${Date.now()}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
  return true
}

export function EaselInspector() {
  const editor = useEditor()
  const selectedIds = useValue('easel-selected', () => editor.getSelectedShapeIds(), [editor])
  const selectedImage = (() => {
    if (selectedIds.length !== 1) return null
    const shape = editor.getShape(selectedIds[0])
    return shape && shape.type === 'image' ? shape : null
  })()

  // Regional edit: an image plus one or more rectangles selected together.
  // Only rectangles (geo) count as regions; text/arrows are ignored.
  const inpaintShapes = (() => {
    if (selectedIds.length < 2) return null
    const shapes = selectedIds.map((id) => editor.getShape(id)).filter(Boolean)
    const image = shapes.find((s) => s.type === 'image')
    const regions = image ? shapes.filter((s) => s.type === 'geo') : []
    return image && regions.length > 0 ? { image, regions } : null
  })()

  const selectedImages = selectedIds.map((id) => editor.getShape(id)).filter((s) => s?.type === 'image')

  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('1:1')
  const [selPrompt, setSelPrompt] = useState('')
  const [editPrompt, setEditPrompt] = useState('')
  const [inpaintPrompt, setInpaintPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  // Prefill the selected image's prompt when selection changes.
  useEffect(() => {
    if (selectedImage) {
      setSelPrompt(typeof selectedImage.meta?.prompt === 'string' ? selectedImage.meta.prompt : '')
      setEditPrompt('')
    }
  }, [selectedImage?.id])

  const ratioValue = () => (RATIOS.find((r) => r.id === ratio) ?? RATIOS[0]).value
  const pageId = () => editor.getCurrentPageId()
  const center = () => editor.getViewportPageBounds().center

  async function callApi(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }

  async function run(label, fn) {
    if (busy) return
    setBusy(true)
    setStatus(label)
    try {
      await fn()
    } catch (error) {
      setStatus(`失败：${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  function handleGenerate() {
    const text = prompt.trim()
    if (!text) return
    run('生成中…', async () => {
      const data = await callApi('/api/generate', { prompt: text, pageId: pageId(), ratio: ratioValue() })
      const c = center()
      insertImageCard(editor, data, c.x, c.y, { prompt: text, kind: 'generate' })
      setStatus(`已生成 ${data.size}`)
    })
  }

  function handleVariants(count = 4) {
    const text = prompt.trim()
    if (!text) return
    run('生成变体…', async () => {
      const c = center()
      const groupId = `vg-${Date.now()}`
      for (let i = 0; i < count; i += 1) {
        setStatus(`变体 ${i + 1}/${count}…`)
        const data = await callApi('/api/generate', { prompt: text, pageId: pageId(), ratio: ratioValue() })
        const col = i % 2
        const row = Math.floor(i / 2)
        insertImageCard(editor, data, c.x + (col - 0.5) * 420, c.y + (row - 0.5) * 420, {
          prompt: text,
          kind: 'variant',
          variantGroupId: groupId
        })
      }
      setStatus(`已生成 ${count} 个变体`)
    })
  }

  function handleRegenerate() {
    const text = selPrompt.trim()
    if (!selectedImage || !text) return
    run('重新生成并替换…', async () => {
      const ratioOfSel = selectedImage.props?.h ? selectedImage.props.w / selectedImage.props.h : 1
      const data = await callApi('/api/generate', { prompt: text, pageId: pageId(), ratio: ratioOfSel })
      replaceImageInPlace(editor, selectedImage, data, { prompt: text, kind: 'regenerate' })
      setStatus('已用新图替换选中图')
    })
  }

  function handleVariantFromSelected() {
    const text = selPrompt.trim()
    if (!selectedImage || !text) return
    run('生成变体…', async () => {
      const ratioOfSel = selectedImage.props?.h ? selectedImage.props.w / selectedImage.props.h : 1
      const data = await callApi('/api/generate', { prompt: text, pageId: pageId(), ratio: ratioOfSel })
      const b = editor.getShapePageBounds(selectedImage.id)
      const size = displaySize(data.width, data.height)
      const cx = b ? b.maxX + 40 + size.w / 2 : center().x
      const cy = b ? b.midY : center().y
      const newId = insertImageCard(editor, data, cx, cy, { prompt: text, kind: 'variant', sourceShapeId: selectedImage.id })
      drawLineageArrow(editor, selectedImage.id, newId)
      setStatus('已在右侧生成变体')
    })
  }

  function handleEdit() {
    const text = editPrompt.trim()
    if (!selectedImage || !text) return
    const asset = selectedImage.props?.assetId ? editor.getAsset(selectedImage.props.assetId) : null
    const src = asset?.props?.src
    if (!src) {
      setStatus('选中图没有可用的本地源')
      return
    }
    run('图生图编辑中…（约 30~50s）', async () => {
      const data = await callApi('/api/edit', { prompt: text, pageId: pageId(), ...sourceField(src) })
      const b = editor.getShapePageBounds(selectedImage.id)
      const size = displaySize(data.width, data.height)
      const cx = b ? b.maxX + 40 + size.w / 2 : center().x
      const cy = b ? b.midY : center().y
      const newId = insertImageCard(editor, data, cx, cy, { prompt: text, kind: 'edit', sourceShapeId: selectedImage.id })
      drawLineageArrow(editor, selectedImage.id, newId)
      setStatus('已生成编辑结果（放在原图右侧）')
    })
  }

  function handleExport() {
    if (!selectedImage) return
    setStatus(downloadAsset(editor, selectedImage) ? '已导出 PNG' : '无可导出的源')
  }

  function handleDelete() {
    if (!selectedImage) return
    editor.deleteShapes([selectedImage.id])
    setStatus('已删除选中图')
  }

  function handleInpaint() {
    if (!inpaintShapes) return
    const text = inpaintPrompt.trim()
    if (!text) return
    const { image, regions } = inpaintShapes
    const asset = image.props?.assetId ? editor.getAsset(image.props.assetId) : null
    const src = asset?.props?.src
    const aw = Number(asset?.props?.w) || 0
    const ah = Number(asset?.props?.h) || 0
    if (!src || !aw || !ah) {
      setStatus('选中图缺少可用的源或尺寸')
      return
    }
    const region = regionFromRects(editor, image, regions, aw, ah)
    if (!region) {
      setStatus('矩形需与图片重叠')
      return
    }
    run('局部重绘中…（约 30~50s）', async () => {
      const data = await callApi('/api/edit', { prompt: text, pageId: pageId(), ...sourceField(src), region })
      editor.deleteShapes(regions.map((r) => r.id))
      replaceImageInPlace(editor, image, data, { prompt: text, kind: 'region' })
      setInpaintPrompt('')
      setStatus('已局部重绘并替换')
    })
  }

  function handleBatch() {
    const lines = prompt
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    run('批量生成…', async () => {
      const c = center()
      for (let i = 0; i < lines.length; i += 1) {
        setStatus(`批量 ${i + 1}/${lines.length}…`)
        const data = await callApi('/api/generate', { prompt: lines[i], pageId: pageId(), ratio: ratioValue() })
        const col = i % 3
        const row = Math.floor(i / 3)
        insertImageCard(editor, data, c.x + (col - 1) * 420, c.y + row * 420, { prompt: lines[i], kind: 'batch' })
      }
      setStatus(`批量完成：${lines.length} 张`)
    })
  }

  function handleContactSheet() {
    if (selectedImages.length < 2) return
    run('拼版导出…', async () => {
      const ok = await exportContactSheet(editor, selectedImages)
      setStatus(ok ? '已导出拼版 PNG' : '拼版失败')
    })
  }

  function applyPreset(preset) {
    setPrompt((current) => preset.text + (current || ''))
    setRatio(preset.ratio)
  }

  const stop = (event) => event.stopPropagation()

  return (
    <div className="easel-inspector" onPointerDown={stop} onWheel={stop} onKeyDown={stop}>
      <div className="easel-inspector__title">Easel 图像工作站</div>

      <section className="easel-inspector__section">
        <label className="easel-inspector__label">新建图片</label>
        <textarea
          className="easel-inspector__textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想要的图，例如：山西刀削面产品宣传海报，热气、暖色调"
          rows={4}
        />
        <div className="easel-inspector__ratios">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="easel-chip" onClick={() => applyPreset(p)} title={p.text}>
              {p.id}
            </button>
          ))}
        </div>
        <div className="easel-inspector__ratios">
          {RATIOS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`easel-chip${ratio === r.id ? ' is-on' : ''}`}
              onClick={() => setRatio(r.id)}
            >
              {r.id}
            </button>
          ))}
        </div>
        <div className="easel-inspector__actions">
          <button type="button" className="easel-btn easel-btn--primary" disabled={busy || !prompt.trim()} onClick={handleGenerate}>
            生成
          </button>
          <button type="button" className="easel-btn" disabled={busy || !prompt.trim()} onClick={() => handleVariants(4)}>
            4 变体
          </button>
        </div>
        <button type="button" className="easel-btn" disabled={busy || !prompt.trim()} onClick={handleBatch}>
          批量生成（每行一句）
        </button>
      </section>

      <section className="easel-inspector__section">
        <label className="easel-inspector__label">{selectedImage ? '选中图：迭代' : '选中一张图以迭代'}</label>
        <textarea
          className="easel-inspector__textarea"
          value={selPrompt}
          onChange={(e) => setSelPrompt(e.target.value)}
          placeholder="选中图的提示词（可改后重生成 / 出变体）"
          rows={3}
          disabled={!selectedImage}
        />
        <div className="easel-inspector__actions">
          <button type="button" className="easel-btn" disabled={busy || !selectedImage || !selPrompt.trim()} onClick={handleRegenerate}>
            重生成(替换)
          </button>
          <button type="button" className="easel-btn" disabled={busy || !selectedImage || !selPrompt.trim()} onClick={handleVariantFromSelected}>
            出变体
          </button>
        </div>

        <textarea
          className="easel-inspector__textarea"
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          placeholder={selectedImage ? '图生图：只改哪里，其余保留…' : ''}
          rows={2}
          disabled={!selectedImage}
        />
        <button
          type="button"
          className="easel-btn easel-btn--primary"
          disabled={busy || !selectedImage || !editPrompt.trim()}
          onClick={handleEdit}
        >
          按描述编辑(图生图)
        </button>

        <div className="easel-inspector__actions">
          <button type="button" className="easel-btn" disabled={!selectedImage} onClick={handleExport}>
            导出 PNG
          </button>
          <button type="button" className="easel-btn" disabled={busy || !selectedImage} onClick={handleDelete}>
            删除
          </button>
        </div>
      </section>

      <section className="easel-inspector__section">
        <label className="easel-inspector__label">{inpaintShapes ? '局部重绘：改框内区域' : '局部重绘：选中图 + 在图上画矩形'}</label>
        <textarea
          className="easel-inspector__textarea"
          value={inpaintPrompt}
          onChange={(e) => setInpaintPrompt(e.target.value)}
          placeholder={inpaintShapes ? '框内要变成什么…' : '在图上画一个矩形框住要改的区域，连同图片一起选中'}
          rows={2}
          disabled={!inpaintShapes}
        />
        <button
          type="button"
          className="easel-btn easel-btn--primary"
          disabled={busy || !inpaintShapes || !inpaintPrompt.trim()}
          onClick={handleInpaint}
        >
          局部重绘
        </button>
      </section>

      <section className="easel-inspector__section">
        <label className="easel-inspector__label">
          {selectedImages.length >= 2 ? `拼版导出（已选 ${selectedImages.length} 张）` : '拼版导出：多选 2+ 张图'}
        </label>
        <button type="button" className="easel-btn" disabled={busy || selectedImages.length < 2} onClick={handleContactSheet}>
          拼版导出 PNG
        </button>
      </section>

      <div className="easel-inspector__status">{busy ? '⏳ ' : ''}{status}</div>
    </div>
  )
}
