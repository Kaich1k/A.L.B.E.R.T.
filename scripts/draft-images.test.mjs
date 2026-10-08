import assert from 'node:assert/strict'
import test from 'node:test'

const draft = await import('../src/renderer/src/chat/draftImages.ts')

function fakeClipboard(files, types = files.map((file) => file.type)) {
  return {
    files,
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    types
  }
}

test('deferred image merge keeps newer typed text, not the text captured before the read', async () => {
  draft.resetDraftCache()
  draft.writeDraftCache('A', [])
  let finishRead
  const pendingRead = new Promise((resolve) => {
    finishRead = resolve
  })
  const attach = (async () => {
    const image = await pendingRead
    return image ? draft.mergeDraftImages([image]) : draft.getDraftCache()
  })()
  draft.writeDraftCache('B', draft.getDraftCache().images)
  finishRead({
    id: 'img-a',
    mediaType: 'image/png',
    data: 'aaa',
    previewUrl: 'data:image/png;base64,aaa'
  })
  const next = await attach
  assert.equal(next.text, 'B')
  assert.equal(next.images.length, 1)
  assert.equal(next.images[0].id, 'img-a')
  assert.equal(draft.getDraftCache().text, 'B')
})

test('typing after a merge keeps the new attachments', async () => {
  draft.resetDraftCache()
  draft.writeDraftCache('A', [])
  const next = draft.mergeDraftImages([
    {
      id: 'img-keep',
      mediaType: 'image/png',
      data: 'bbb',
      previewUrl: 'data:image/png;base64,bbb'
    }
  ])
  assert.equal(next.images.length, 1)
  const typed = draft.setDraftText('B')
  assert.equal(typed.text, 'B')
  assert.equal(typed.images.length, 1)
  assert.equal(typed.images[0].id, 'img-keep')
})

test('zero-accepted TIFF still asks for the native clipboard fallback', async () => {
  const tiff = new File([Uint8Array.from([0x49, 0x49, 0x2a, 0x00])], 'clip.tiff', { type: 'image/tiff' })
  assert.equal(draft.fileIsAttachable(tiff), false)
  assert.equal(await draft.fileToDraft(tiff), null)
  const found = draft.filesFromClipboard(fakeClipboard([tiff], ['image/tiff', 'Files']))
  assert.ok(found.length >= 1)
  const accepted = (await Promise.all(found.map((file) => draft.fileToDraft(file)))).filter(Boolean)
  assert.equal(accepted.length, 0)
  assert.equal(draft.pasteNeedsNativeFallback(found.length, accepted.length, true), true)
  assert.equal(draft.pasteNeedsNativeFallback(found.length, 1, true), false)
  assert.equal(draft.pasteNeedsNativeFallback(0, 0, false), false)
})

test('removeDraftImage drops only the selected attachment and keeps text', () => {
  draft.resetDraftCache()
  draft.writeDraftCache('keep typing', [
    {
      id: 'img-a',
      mediaType: 'image/png',
      data: 'aaa',
      previewUrl: 'data:image/png;base64,aaa'
    },
    {
      id: 'img-b',
      mediaType: 'image/jpeg',
      data: 'bbb',
      previewUrl: 'data:image/jpeg;base64,bbb'
    }
  ])
  const next = draft.removeDraftImage('img-a')
  assert.equal(next.text, 'keep typing')
  assert.deepEqual(
    next.images.map((image) => image.id),
    ['img-b']
  )
  assert.equal(draft.getDraftCache().images.length, 1)
  assert.equal(draft.removeDraftImage('missing').images.length, 1)
  assert.deepEqual(
    draft.withoutDraftImage(next.images, 'img-b').map((image) => image.id),
    []
  )
})
