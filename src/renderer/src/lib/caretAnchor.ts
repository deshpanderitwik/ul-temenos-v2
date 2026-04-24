import type { Editor } from '@tiptap/react'

export type AnchorSnapshot = {
  caretY: number
  absY: number
  midpoint: number
  selFrom: number
  inLastNode: boolean
  lineHeight: number
}

/**
 * Reads a snapshot of the current caret position and container geometry.
 *
 * Performs exactly one `coordsAtPos` call and one `getBoundingClientRect`
 * call per invocation (same cost as the original inline implementation).
 */
export function readAnchorSnapshot(editor: Editor, container: HTMLElement): AnchorSnapshot {
  const selection = editor.state.selection
  const selFrom = selection.from
  const caretY = editor.view.coordsAtPos(selFrom).top
  const absY = caretY + container.scrollTop
  const rect = container.getBoundingClientRect()
  const midpoint = rect.top + container.clientHeight * 0.5

  const doc = editor.state.doc
  const lastNode = doc.lastChild
  const inLastNode = lastNode ? selFrom >= doc.content.size - lastNode.nodeSize : false

  // Resolve a line height from the ProseMirror element's computed style.
  // Not used in Step 1; included so future steps don't have to reshape the type.
  let lineHeight = 0
  const proseMirrorEl = container.querySelector('.ProseMirror') as HTMLElement | null
  if (proseMirrorEl) {
    const cs = getComputedStyle(proseMirrorEl)
    const parsed = parseFloat(cs.lineHeight)
    if (Number.isFinite(parsed) && parsed > 0) {
      lineHeight = parsed
    } else {
      const fontSize = parseFloat(cs.fontSize)
      lineHeight = Number.isFinite(fontSize) ? fontSize * 1.2 : 0
    }
  }

  return { caretY, absY, midpoint, selFrom, inLastNode, lineHeight }
}

/**
 * v1 anchor policy: anchor only when the caret is inside the last top-level
 * node of the document.
 */
export function shouldAnchor(snapshot: AnchorSnapshot): boolean {
  return snapshot.inLastNode
}

/**
 * Detects that the caret has advanced to a new line (document-relative).
 * Preserves the original `+ 2` jitter tolerance and the `>= 0` guard that
 * skips the very first update after a reset.
 */
export function detectLineAdvance(snapshot: AnchorSnapshot, lastAbsY: number): boolean {
  return lastAbsY >= 0 && snapshot.absY > lastAbsY + 2
}

/**
 * Applies the anchor by scrolling the container by `overshoot` pixels.
 * Uses `'instant'` behavior to match the original inline implementation.
 */
export function applyAnchor(container: HTMLElement, overshoot: number): void {
  container.scrollBy({ top: overshoot, behavior: 'instant' })
}
