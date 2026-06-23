import { AssetRecordType, createShapeId, useEditor, useValue } from 'tldraw'
import { useState } from 'react'

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

function insertImageCard(editor, result, centerX, centerY, meta) {
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
  return { id, w, h }
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
  const [editPrompt, setEditPrompt] = useState('')
  const [ratio, setRatio] = useState('1:1')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const ratioValue = () => (RATIOS.find((r) => r.id === ratio) ?? RATIOS[0]).value

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

  async function handleGenerate() {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setStatus('生成中…')
    try {
      const data = await callApi('/api/generate', {
        prompt: text,
        pageId: editor.getCurrentPageId(),
        ratio: ratioValue()
      })
      const c = editor.getViewportPageBounds().center
      insertImageCard(editor, data, c.x, c.y, { prompt: text, kind: 'generate' })
      setStatus(`已生成 ${data.size}`)
    } catch (error) {
      setStatus(`失败：${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleVariants(count = 4) {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const c = editor.getViewportPageBounds().center
      for (let i = 0; i < count; i += 1) {
        setStatus(`变体 ${i + 1}/${count}…`)
        const data = await callApi('/api/generate', {
          prompt: text,
          pageId: editor.getCurrentPageId(),
          ratio: ratioValue()
        })
        const col = i % 2
        const row = Math.floor(i / 2)
        insertImageCard(editor, data, c.x + (col - 0.5) * 420, c.y + (row - 0.5) * 420, {
          prompt: text,
          kind: 'variant'
        })
      }
      setStatus(`已生成 ${count} 个变体`)
    } catch (error) {
      setStatus(`失败：${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleEdit() {
    const text = editPrompt.trim()
    if (!selectedImage || !text || busy) return
    const asset = selectedImage.props?.assetId ? editor.getAsset(selectedImage.props.assetId) : null
    const src = asset?.props?.src
    if (!src) {
      setStatus('选中图没有可用的本地源')
      return
    }
    setBusy(true)
    setStatus('图生图编辑中…（可能 30~50s）')
    try {
      const data = await callApi('/api/edit', {
        prompt: text,
        pageId: editor.getCurrentPageId(),
        sourceSrc: src
      })
      const bounds = editor.getShapePageBounds(selectedImage.id)
      const size = displaySize(data.width, data.height)
      const centerX = bounds ? bounds.maxX + 40 + size.w / 2 : editor.getViewportPageBounds().center.x
      const centerY = bounds ? bounds.midY : editor.getViewportPageBounds().center.y
      insertImageCard(editor, data, centerX, centerY, {
        prompt: text,
        kind: 'edit',
        sourceShapeId: selectedImage.id
      })
      setStatus('已生成编辑结果（放在原图右侧）')
    } catch (error) {
      setStatus(`失败：${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  const stop = (event) => event.stopPropagation()

  return (
    <div className="easel-inspector" onPointerDown={stop} onWheel={stop} onKeyDown={stop}>
      <div className="easel-inspector__title">Easel 图像工作站</div>

      <section className="easel-inspector__section">
        <label className="easel-inspector__label">提示词</label>
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
        <label className="easel-inspector__label">图生图（选中一张图）</label>
        <textarea
          className="easel-inspector__textarea"
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          placeholder={selectedImage ? '只改哪里，其余尽量保留…' : '先在画布选中一张图'}
          rows={3}
          disabled={!selectedImage}
        />
        <button
          type="button"
          className="easel-btn easel-btn--primary"
          disabled={busy || !selectedImage || !editPrompt.trim()}
          onClick={handleEdit}
        >
          按描述编辑选中图
        </button>
      </section>

      <div className="easel-inspector__status">{busy ? '⏳ ' : ''}{status}</div>
    </div>
  )
}
