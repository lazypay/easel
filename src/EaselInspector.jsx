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
    meta: { easelImage: true, createdAt: Date.now(), ...meta }
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
    meta: { ...shape.meta, ...meta, replacedAt: Date.now() }
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

export function EaselInspector() {
  const editor = useEditor()
  const selectedIds = useValue('easel-selected', () => editor.getSelectedShapeIds(), [editor])
  const selectedImage = (() => {
    if (selectedIds.length !== 1) return null
    const shape = editor.getShape(selectedIds[0])
    return shape && shape.type === 'image' ? shape : null
  })()

  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('1:1')
  const [selPrompt, setSelPrompt] = useState('')
  const [editPrompt, setEditPrompt] = useState('')
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
      const data = await callApi('/api/edit', { prompt: text, pageId: pageId(), sourceSrc: src })
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

      <div className="easel-inspector__status">{busy ? '⏳ ' : ''}{status}</div>
    </div>
  )
}
