import * as Y from 'yjs'

const REMOTE_ORIGIN = Symbol('yjs-remote')

export type YjsConnection = {
  doc: Y.Doc
  dispose: () => void
}

export async function connectNarrative(narrativeId: string): Promise<YjsConnection> {
  const existing = await window.api.yjs.getNarrative(narrativeId)
  if (!existing) {
    await window.api.yjs.createNarrative({ id: narrativeId })
  }

  const doc = new Y.Doc()

  const state = await window.api.yjs.loadDocState(narrativeId)
  const stateBytes = state instanceof Uint8Array ? state : new Uint8Array(state)
  if (stateBytes.byteLength > 0) {
    Y.applyUpdate(doc, stateBytes)
  }

  const onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE_ORIGIN) return
    void window.api.yjs.appendUpdate(narrativeId, update).catch((err) => {
      console.error('[yjs] appendUpdate failed', err)
    })
  }
  doc.on('update', onLocalUpdate)

  const offRemote = window.api.yjs.onRemoteUpdate((payload) => {
    if (payload.narrativeId !== narrativeId) return
    const bytes =
      payload.update instanceof Uint8Array
        ? payload.update
        : new Uint8Array(payload.update)
    Y.applyUpdate(doc, bytes, REMOTE_ORIGIN)
  })

  const dispose = (): void => {
    doc.off('update', onLocalUpdate)
    offRemote()
    doc.destroy()
  }

  return { doc, dispose }
}
