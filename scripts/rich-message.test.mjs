import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isImageArtifactTarget,
  localImageTargets,
  tokenizeRichMessage
} from '../src/renderer/src/chat/richMessage.ts'

test('assistant local image links become safe inline artifacts', () => {
  const tokens = tokenizeRichMessage(
    'Inspect [Sheet 1](/Users/kai/Documents/VS/ALBERT/output/page-1.png) and [the PDF](/Users/kai/Documents/VS/ALBERT/output/spec.pdf).'
  )
  assert.deepEqual(localImageTargets(tokens), [
    {
      label: 'Sheet 1',
      path: '/Users/kai/Documents/VS/ALBERT/output/page-1.png'
    }
  ])
  assert.equal(tokens.filter((token) => token.type === 'link').length, 2)
})

test('image markdown and Codex file citations render without raw control syntax', () => {
  const tokens = tokenizeRichMessage(
    '![Preview](/tmp/render.webp) :codex-file-citation{path="/Users/kai/Documents/report.pdf" purpose="output"}'
  )
  const links = tokens.filter((token) => token.type === 'link')
  assert.equal(links[0]?.image, true)
  assert.equal(links[1]?.label, 'report.pdf')
  assert.equal(tokens.some((token) => token.type === 'text' && token.value.includes('codex-file-citation')), false)
})

test('only supported raster extensions auto-expand', () => {
  assert.equal(isImageArtifactTarget('/tmp/drawing.jpeg'), true)
  assert.equal(isImageArtifactTarget('/tmp/drawing.svg'), false)
  assert.equal(isImageArtifactTarget('/tmp/drawing.pdf'), false)
})
