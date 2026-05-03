import * as Y from 'yjs'
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror'
import { getSchema, type Extensions } from '@tiptap/core'
import StarterKitImport from '@tiptap/starter-kit'
import PlaceholderImport from '@tiptap/extension-placeholder'

type WithDefault<T> = T & { default?: T }
const StarterKit =
  (StarterKitImport as WithDefault<typeof StarterKitImport>).default ?? StarterKitImport
const Placeholder =
  (PlaceholderImport as WithDefault<typeof PlaceholderImport>).default ?? PlaceholderImport

// Must match the field used by the renderer's Collaboration extension and
// the migration. Mismatch here = migrated narratives appear empty in MCP.
const COLLAB_FIELD = 'default'

let cachedSchema: ReturnType<typeof getSchema> | null = null

function getCollabSchema() {
  if (!cachedSchema) {
    const extensions: Extensions = [
      StarterKit.configure({ orderedList: false, undoRedo: false }),
      Placeholder.configure({ placeholder: 'Start writing...' })
    ]
    cachedSchema = getSchema(extensions)
  }
  return cachedSchema
}

export function docToTipTapJSON(doc: Y.Doc): unknown {
  return yDocToProsemirrorJSON(doc, COLLAB_FIELD)
}

/**
 * Replace the entire content of a Y.Doc with `newJson`, returning the
 * resulting Yjs binary update.
 *
 * Strategy: clear the existing fragment within a transaction, then apply an
 * update encoding the new content. The returned update encodes the diff from
 * the doc's state before this call to its state after — feed it to
 * persistence.appendUpdate to commit.
 *
 * Concurrent-edit caveat: Yjs is a CRDT, so if another writer is concurrently
 * editing the same doc, BOTH sets of changes will survive merging. For an
 * MCP "rewrite the whole doc" call against a doc the user is also typing
 * into, the user's edits will not be lost — they will appear alongside the
 * MCP's content. This is correct CRDT semantics; if you need true
 * last-writer-wins, you'd need an out-of-band coordination layer.
 */
export function applyContentReplacement(
  doc: Y.Doc,
  newJson: unknown
): Uint8Array {
  const schema = getCollabSchema()
  const stateBefore = Y.encodeStateVector(doc)

  const fragment = doc.getXmlFragment(COLLAB_FIELD)
  doc.transact(() => {
    fragment.delete(0, fragment.length)
  })

  const tempDoc = prosemirrorJSONToYDoc(
    schema,
    newJson as Parameters<typeof prosemirrorJSONToYDoc>[1],
    COLLAB_FIELD
  )
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(tempDoc))

  return Y.encodeStateAsUpdate(doc, stateBefore)
}
