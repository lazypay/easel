import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { useCallback, useEffect, useState } from 'react'
import { EaselInspector } from './EaselInspector.jsx'

const CANVAS_ENDPOINT = '/api/canvas'
const CANVAS_EVENTS_ENDPOINT = '/api/canvas-events'
const SELECTION_ENDPOINT = '/api/selection'
const VIEW_STATE_ENDPOINT = '/api/view-state'
const SELECTION_STATE_ELEMENT_ID = 'easel-selection-state'

const easelComponents = {
  SharePanel: EaselInspector
}

function isCanvasSnapshot(value) {
  return value && typeof value === 'object' && value.store && value.schema
}

function recordsAreEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function applyRemoteCanvasSnapshot(editor, snapshot, { preserveLocalChanges = false } = {}) {
  if (!isCanvasSnapshot(snapshot)) return 0

  const migratedSnapshot = editor.store.migrateSnapshot(snapshot)
  const recordsToPut = Object.values(migratedSnapshot.store).filter((record) => {
    const localRecord = editor.store.get(record.id)
    if (!localRecord) return true
    if (preserveLocalChanges) return false
    return !recordsAreEqual(localRecord, record)
  })

  if (recordsToPut.length === 0) return 0

  editor.store.mergeRemoteChanges(() => {
    editor.store.put(recordsToPut)
  })

  return recordsToPut.length
}

// Collect plain text from a tldraw richText (TipTap) doc or a plain text prop,
// so the agent can read annotation labels (notes, arrow/geo labels, text shapes).
function richTextToPlain(node) {
  if (!node || typeof node !== 'object') return ''
  if (typeof node.text === 'string') return node.text
  const content = Array.isArray(node.content) ? node.content : []
  return content.map(richTextToPlain).join('')
}

function extractShapeText(shape) {
  const p = shape?.props
  if (!p) return ''
  if (typeof p.text === 'string' && p.text.trim()) return p.text.trim()
  if (p.richText) {
    const plain = richTextToPlain(p.richText).trim()
    if (plain) return plain
  }
  return ''
}

function getEaselSelection(editor) {
  const selectedShapeIds = editor.getSelectedShapeIds()
  return selectedShapeIds.map((id) => {
    const shape = editor.getShape(id)
    const asset = shape?.props?.assetId ? editor.getAsset(shape.props.assetId) : null
    const bounds = editor.getShapePageBounds(id)
    return {
      id,
      type: shape?.type ?? null,
      parentId: shape?.parentId ?? null,
      x: shape?.x ?? null,
      y: shape?.y ?? null,
      bounds: bounds ? { x: bounds.minX, y: bounds.minY, w: bounds.w, h: bounds.h } : null,
      text: extractShapeText(shape),
      meta: shape?.meta ?? null,
      isEaselImage: shape?.meta?.easelImage === true,
      props: shape?.props ?? null,
      asset: asset
        ? {
            id: asset.id,
            type: asset.type,
            name: asset.props?.name ?? null,
            src: asset.props?.src ?? null,
            w: asset.props?.w ?? null,
            h: asset.props?.h ?? null,
            mimeType: asset.props?.mimeType ?? null
          }
        : null
    }
  })
}

function getEaselViewState(editor) {
  const camera = editor.getCamera()
  return {
    version: 1,
    currentPageId: editor.getCurrentPageId(),
    camera: { x: camera.x, y: camera.y, z: camera.z }
  }
}

function isRestorableViewState(viewState) {
  return (
    viewState &&
    typeof viewState === 'object' &&
    typeof viewState.currentPageId === 'string' &&
    viewState.camera &&
    Number.isFinite(viewState.camera.x) &&
    Number.isFinite(viewState.camera.y) &&
    Number.isFinite(viewState.camera.z)
  )
}

function restoreEaselViewState(editor, viewState) {
  if (!isRestorableViewState(viewState)) return
  if (!editor.getPage(viewState.currentPageId)) return
  editor.setCurrentPage(viewState.currentPageId)
  editor.setCamera(viewState.camera, { immediate: true, force: true })
}

function writeEaselSelectionState(selectionSnapshot) {
  let stateElement = document.getElementById(SELECTION_STATE_ELEMENT_ID)
  if (!stateElement) {
    stateElement = document.createElement('script')
    stateElement.id = SELECTION_STATE_ELEMENT_ID
    stateElement.type = 'application/json'
    document.body.append(stateElement)
  }
  stateElement.textContent = JSON.stringify({
    ...selectionSnapshot,
    updatedAt: new Date().toISOString()
  })
}

export default function App() {
  const [snapshot, setSnapshot] = useState()
  const [viewState, setViewState] = useState()
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadCanvas() {
      try {
        const [canvasResponse, viewStateResponse] = await Promise.all([
          fetch(CANVAS_ENDPOINT, { signal: controller.signal }),
          fetch(VIEW_STATE_ENDPOINT, { signal: controller.signal })
        ])
        if (!canvasResponse.ok) throw new Error(`Failed to load canvas: ${canvasResponse.status}`)
        if (!viewStateResponse.ok) throw new Error(`Failed to load view state: ${viewStateResponse.status}`)
        const [canvasData, viewStateData] = await Promise.all([canvasResponse.json(), viewStateResponse.json()])
        setSnapshot(canvasData.snapshot ?? null)
        setViewState(viewStateData.viewState ?? null)
      } catch (error) {
        if (error.name === 'AbortError') return
        setLoadError(error)
        setSnapshot(null)
        setViewState(null)
      }
    }

    loadCanvas()
    return () => controller.abort()
  }, [])

  const handleMount = useCallback(
    (editor) => {
      window.__easelEditor = editor

      editor.timers.requestAnimationFrame(() => {
        restoreEaselViewState(editor, viewState)
      })

      let lastSelectionState = ''
      let isSelectionSaving = false
      let pendingSelection = false

      async function syncSelectionState() {
        const selectionSnapshot = { selectedShapes: getEaselSelection(editor) }
        writeEaselSelectionState(selectionSnapshot)
        const serialized = JSON.stringify(selectionSnapshot)
        if (serialized === lastSelectionState) return
        lastSelectionState = serialized
        if (isSelectionSaving) {
          pendingSelection = true
          return
        }
        isSelectionSaving = true
        try {
          await fetch(SELECTION_ENDPOINT, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...selectionSnapshot, updatedAt: new Date().toISOString() })
          })
        } catch (error) {
          console.error(error)
        } finally {
          isSelectionSaving = false
          if (pendingSelection) {
            pendingSelection = false
            syncSelectionState()
          }
        }
      }

      syncSelectionState()
      const selectionTimer = window.setInterval(syncSelectionState, 250)

      let lastViewState = ''
      async function syncViewState() {
        const viewStateSnapshot = { ...getEaselViewState(editor), updatedAt: new Date().toISOString() }
        const serialized = JSON.stringify(viewStateSnapshot)
        if (serialized === lastViewState) return
        lastViewState = serialized
        try {
          await fetch(VIEW_STATE_ENDPOINT, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: serialized
          })
        } catch (error) {
          console.error(error)
        }
      }
      const viewStateTimer = window.setInterval(syncViewState, 500)
      editor.timers.setTimeout(syncViewState, 100)

      let saveTimer = null
      let isSaving = false
      let hasPendingSave = false
      let hasUnsavedChanges = false
      let remoteLoadController = null

      async function saveCanvas() {
        if (!hasUnsavedChanges) return
        if (isSaving) {
          hasPendingSave = true
          return
        }
        isSaving = true
        try {
          const response = await fetch(CANVAS_ENDPOINT, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(editor.store.getStoreSnapshot())
          })
          if (!response.ok) throw new Error(`Failed to save canvas: ${response.status}`)
          hasUnsavedChanges = false
        } catch (error) {
          console.error(error)
        } finally {
          isSaving = false
          if (hasPendingSave) {
            hasPendingSave = false
            scheduleSave()
          }
        }
      }

      function scheduleSave() {
        hasUnsavedChanges = true
        window.clearTimeout(saveTimer)
        saveTimer = window.setTimeout(saveCanvas, 500)
      }

      async function loadRemoteCanvasSnapshot() {
        remoteLoadController?.abort()
        const controller = new AbortController()
        remoteLoadController = controller
        const preserveLocalChanges = hasUnsavedChanges || isSaving
        try {
          const response = await fetch(CANVAS_ENDPOINT, { signal: controller.signal })
          if (!response.ok) throw new Error(`Failed to refresh canvas: ${response.status}`)
          const canvasData = await response.json()
          const changed = applyRemoteCanvasSnapshot(editor, canvasData.snapshot, { preserveLocalChanges })
          if (changed > 0 && preserveLocalChanges) {
            hasUnsavedChanges = true
            if (isSaving) hasPendingSave = true
            else scheduleSave()
          }
        } catch (error) {
          if (error.name === 'AbortError') return
          console.error(error)
        } finally {
          if (remoteLoadController === controller) remoteLoadController = null
        }
      }

      const unsubscribe = editor.store.listen(scheduleSave, { source: 'user', scope: 'document' })

      let canvasEvents = null
      if ('EventSource' in window) {
        canvasEvents = new EventSource(CANVAS_EVENTS_ENDPOINT)
        canvasEvents.addEventListener('canvas-changed', loadRemoteCanvasSnapshot)
        canvasEvents.onerror = (error) => console.warn('Easel live refresh disconnected.', error)
      }

      return () => {
        window.clearTimeout(saveTimer)
        window.clearInterval(selectionTimer)
        window.clearInterval(viewStateTimer)
        remoteLoadController?.abort()
        canvasEvents?.close()
        if (window.__easelEditor === editor) delete window.__easelEditor
        document.getElementById(SELECTION_STATE_ELEMENT_ID)?.remove()
        unsubscribe()
        syncViewState()
        saveCanvas()
      }
    },
    [viewState]
  )

  if (snapshot === undefined || viewState === undefined) {
    return (
      <main className="easel-status" aria-live="polite">
        Loading canvas...
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="easel-status" aria-live="polite">
        Canvas could not be loaded.
      </main>
    )
  }

  return (
    <main className="easel-canvas" aria-label="Easel infinite canvas">
      <Tldraw
        snapshot={snapshot ?? undefined}
        inferDarkMode
        onMount={handleMount}
        components={easelComponents}
      />
    </main>
  )
}
