import type { Editor } from '@tiptap/react'

export type AnchorSnapshot = {
  caretY: number
  absY: number
  midpoint: number
  selFrom: number
  inLastNode: boolean
  lineHeight: number
}

export type AnchorConfig = {
  anchorRatio: number
  deadZone: number
}

const DEFAULT_ANCHOR_RATIO = 0.5
const DEFAULT_DEAD_ZONE = 0

/**
 * Reads anchor configuration from CSS custom properties on the container.
 * Falls back to hardcoded defaults if vars are absent or unparseable.
 */
export function readAnchorConfig(container: HTMLElement): AnchorConfig {
  const cs = getComputedStyle(container)

  const rawRatio = cs.getPropertyValue('--editor-anchor-ratio').trim()
  const parsedRatio = parseFloat(rawRatio)
  const anchorRatio =
    Number.isFinite(parsedRatio) && parsedRatio > 0 ? parsedRatio : DEFAULT_ANCHOR_RATIO

  const rawDeadZone = cs.getPropertyValue('--editor-anchor-dead-zone').trim()
  const parsedDeadZone = parseFloat(rawDeadZone)
  const deadZone =
    Number.isFinite(parsedDeadZone) && parsedDeadZone >= 0 ? parsedDeadZone : DEFAULT_DEAD_ZONE

  return { anchorRatio, deadZone }
}

/**
 * Computes the viewport-relative midpoint Y that the anchor targets.
 * Callers cache this value and invalidate on resize / invalidation events
 * rather than recomputing per keystroke.
 */
export function computeMidpoint(container: HTMLElement, config: AnchorConfig): number {
  const rect = container.getBoundingClientRect()
  return rect.top + container.clientHeight * config.anchorRatio
}

/**
 * Reads a snapshot of the current caret position and container geometry.
 *
 * Performs exactly one `coordsAtPos` call per invocation. The `midpoint`
 * is passed in (cached by the caller) rather than recomputed, to avoid
 * a layout-forcing `getBoundingClientRect` on every keystroke.
 */
export function readAnchorSnapshot(
  editor: Editor,
  container: HTMLElement,
  _config: AnchorConfig,
  midpoint: number
): AnchorSnapshot {
  const selection = editor.state.selection
  const selFrom = selection.from
  const caretY = editor.view.coordsAtPos(selFrom).top
  const absY = caretY + container.scrollTop

  const doc = editor.state.doc
  const lastNode = doc.lastChild
  const inLastNode = lastNode ? selFrom >= doc.content.size - lastNode.nodeSize : false

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
