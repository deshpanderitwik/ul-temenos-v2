# Caret Anchor System -- Design Document

## Problem

When writing in a full-screen editor, text starts at the top and grows downward. Eventually the cursor reaches the bottom of the viewport and the writer's eyes are forced to the bottom edge of the screen. This is ergonomically poor for long writing sessions. The cursor should stay near the vertical center of the screen so the writer's gaze stays comfortable.

Previous attempts at solving this caused scroll jerkiness because they fought with ProseMirror's built-in scroll behavior, fired too aggressively (every keystroke), and used fragile timeout-based suspension.

## Goal

Keep the cursor near the vertical midpoint of the screen as the writer types, without any perceptible scroll jumps. The system should feel invisible -- the page gently rises as new lines are created.

## Core Concept

The caret anchor does NOT scroll on every keystroke. It scrolls only when the **cursor drops to a new line** (via Enter or word-wrap) and that new line is **below the anchor point** (the vertical midpoint of the viewport).

When it scrolls, it scrolls by exactly the distance the cursor moved down -- typically one line height (~20-28px). This produces a small, smooth adjustment that matches the rhythm of writing.

---

## Architecture

### Three Layers

```
┌─────────────────────────────────────────┐
│  1. POLICY: shouldAnchor(editor)        │  ← decides IF we should anchor
│     v1: cursor is near end of document  │
│     v2: cursor is in active paragraph   │
├─────────────────────────────────────────┤
│  2. DETECTION: did the cursor move      │  ← decides WHEN to scroll
│     down to a new line?                 │
│     Compare previous vs current Y       │
├─────────────────────────────────────────┤
│  3. SCROLL: smooth-scroll by delta      │  ← executes the scroll
│     newCaretY - midpoint                │
│     behavior: 'smooth'                  │
└─────────────────────────────────────────┘
```

Each layer is independent. Changing the policy (layer 1) doesn't affect detection or scrolling. This is what makes the system extensible.

### Layer 1: Policy -- `shouldAnchor(editor)`

Determines whether the anchor system should engage at all for the current cursor position.

**v1 (initial implementation):**
The cursor must be near the end of the document. "Near the end" means the cursor's document position is within the last node (paragraph) of the document, or within a small threshold of the document's total content size.

```typescript
function shouldAnchor(editor: Editor): boolean {
  const { doc, selection } = editor.state
  const lastNode = doc.lastChild
  if (!lastNode) return false
  const lastNodeStart = doc.content.size - lastNode.nodeSize
  return selection.from >= lastNodeStart
}
```

This prevents the anchor from interfering when the user clicks into the middle of a long document to make an edit. The anchor only activates when they're writing at the frontier.

**v2 (future):**
The policy becomes "the cursor is in the active anchor paragraph." The anchor paragraph could be set explicitly (e.g., the user pins a paragraph) or implicitly (the paragraph the user has been continuously typing in for the last N seconds). This is a drop-in replacement for `shouldAnchor` -- everything downstream stays the same.

### Layer 2: Detection -- Did the cursor move to a new line?

On every TipTap `update` event (content change), we:

1. Get the cursor's current viewport-relative Y position using `editor.view.coordsAtPos(selection.from).top`
2. Compare it to the stored `lastCaretY`
3. If the Y increased (cursor moved down), the cursor dropped to a new line
4. If the Y is unchanged or decreased, the cursor stayed on the same line or moved up (backspace, delete)

```typescript
const currentY = editor.view.coordsAtPos(editor.state.selection.from).top
const movedDown = currentY > lastCaretY + 2  // 2px tolerance for subpixel jitter
lastCaretY = currentY
```

We also check: is the cursor below the anchor point (midpoint of the viewport)?

```typescript
const container = scrollRef.current
const midpoint = container.getBoundingClientRect().top + container.clientHeight * anchorRatio
const belowAnchor = currentY > midpoint
```

The anchor only scrolls when BOTH conditions are true: `movedDown && belowAnchor`.

### Layer 3: Scroll -- Smooth adjustment

When the anchor fires, we scroll by exactly the overshoot:

```typescript
const overshoot = currentY - midpoint
container.scrollBy({ top: overshoot, behavior: 'smooth' })
```

For a typical new line (~24px line height), this is a small smooth scroll that completes in ~150ms. Since new lines are created at most every few seconds during normal typing (word-wrap) or on each Enter press, there's ample time for each animation to complete before the next one.

---

## State

The system requires very little state, all stored in refs (no React state, no re-renders):

| Ref | Type | Purpose |
|-----|------|---------|
| `lastCaretY` | `number` | Previous cursor viewport Y position |
| `anchorSuspended` | `boolean` | Set when user scrolls manually |

### Manual Scroll Suspension

When the user scrolls manually (trackpad, mouse wheel, scrollbar), the anchor suspends. It resumes when the next content update moves the cursor to a new line. This means:

- User scrolls up to read something → anchor suspends
- User starts typing again at the end → first new line re-engages the anchor
- No timeouts, no race conditions

Detection: listen to `scroll` events on the container. If the scroll wasn't caused by our `scrollBy` call (tracked via a flag), it's a manual scroll.

```typescript
let programmaticScroll = false

container.addEventListener('scroll', () => {
  if (programmaticScroll) return
  anchorSuspended = true
})

// When we scroll:
programmaticScroll = true
container.scrollBy({ top: overshoot, behavior: 'smooth' })
// Reset after animation completes
setTimeout(() => { programmaticScroll = false }, 200)
```

When the anchor fires successfully (new line + below midpoint + policy passes), it clears `anchorSuspended`. This naturally resumes the anchor when the user returns to typing.

---

## CSS Variables

The system reads its configuration from CSS custom properties on the scroll container, making it easy to tune without touching JavaScript:

| Variable | Default | Purpose |
|----------|---------|---------|
| `--editor-anchor-ratio` | `0.5` | Where on the viewport the anchor targets (0 = top, 1 = bottom) |
| `--editor-anchor-dead-zone` | `24px` | Not used in v1 (was part of the old system, can be repurposed later) |
| `--editor-bottom-space` | `clamp(38vh, 50vh, 60vh)` | Bottom padding that provides scroll room past the end of content |

The `--editor-bottom-space` is critical: without large bottom padding, there wouldn't be enough scrollable space to push the last line up to the midpoint.

---

## What the Anchor Does NOT Do

These are explicit non-goals that caused problems in the previous implementation:

1. **Does not fire on every keystroke.** Only fires when the cursor moves to a new line.
2. **Does not fire on backspace/delete.** Only fires when the cursor moves DOWN.
3. **Does not fire on selection changes.** Clicking or arrow-keying around the document does not trigger scrolling.
4. **Does not fight ProseMirror.** We do not override `handleScrollToSelection` or `scrollIntoView`. ProseMirror handles keeping the cursor visible; we handle keeping it centered.
5. **Does not use timeouts for suspension.** Manual scroll suspension is cleared by user action (typing a new line), not by a timer.

---

## Integration Point

The anchor hooks into the existing `handleDocumentUpdate` callback in NarrativeEditor's `update` effect. It runs synchronously before the autosave logic:

```typescript
const handleDocumentUpdate = () => {
  // --- Caret anchor ---
  maybeAnchorScroll(editor)

  // --- Autosave (existing) ---
  if (inFlightRef.current) { ... }
  ...
}
```

Alternatively, it can be a separate `update` listener. Either way, it runs on every content change but only scrolls when all three conditions align (policy + new line + below midpoint).

---

## Future: Anchor Paragraph (v2)

In v2, the `shouldAnchor` policy changes from "cursor at end of document" to "cursor in the anchor paragraph." This enables:

- **Editing in the middle of a document**: If you're revising paragraph 5 of 20, the anchor keeps paragraph 5 stable as you add/remove text, preventing content above and below from shifting your focus.
- **Pinning**: The user could explicitly pin a paragraph as the anchor point.
- **Auto-detection**: The paragraph the user has been typing in for the last N seconds becomes the anchor automatically.

The detection and scroll layers are identical. Only the policy function changes.

---

## Summary

| Aspect | Approach |
|--------|----------|
| Trigger | TipTap `update` event (content changes only) |
| Condition | Cursor moved down to new line AND below midpoint AND policy passes |
| Scroll amount | Exact overshoot (cursorY - midpoint), typically ~24px |
| Scroll style | `behavior: 'smooth'` |
| Suspension | Manual scroll sets flag; next anchor-eligible update clears it |
| State | 2 refs (lastCaretY, anchorSuspended). No React state, no re-renders |
| CSS config | `--editor-anchor-ratio`, `--editor-bottom-space` |
| Extensibility | Swap `shouldAnchor` policy for v2 anchor-paragraph support |
