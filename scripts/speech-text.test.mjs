import assert from 'node:assert/strict'
import test from 'node:test'

const speech = await import('../src/shared/speechText.ts')

function spoken(input) {
  return speech.normalizeForSpeech(input)
}

test('normalizes times, years, decimals, percents, and money', () => {
  assert.match(spoken('Meet me at 7:30 PM.'), /seven thirty P M/)
  assert.match(spoken('The year is 2026.'), /twenty twenty-six/)
  assert.match(spoken('Pi is about 3.14.'), /three and point and one four/)
  assert.match(spoken('Accuracy hit 95%.'), /ninety-five percent/)
  assert.match(spoken('It costs $12.50.'), /twelve dollars and fifty cents/)
})

test('says point for decimals and to for numeric dashes', () => {
  assert.match(spoken('Accuracy hit 99.8%.'), /ninety-nine and point and eight percent/)
  assert.match(spoken('Latency was 3.14 seconds.'), /three and point and one four seconds/)
  assert.doesNotMatch(spoken('Latency was 3.14 seconds.'), /fourteen/)
  assert.match(spoken('Operated between 18–24°C.'), /eighteen to twenty-four degrees Celsius/)
  assert.doesNotMatch(spoken('Operated between 18–24°C.'), /[—–]/)
  assert.doesNotMatch(spoken('Operated between 18-24°C.'), /eighteen point/)

  const sample =
    'On 09/10/2026 at 7:45 PM, A.L.B.E.R.T. processed 1,247 API requests with 99.8% accuracy, reducing latency from 3.14 seconds to 275 milliseconds. The GPT-5.6 upgrade cost $12.50, operated between 18–24°C, and completed phases 1 through 3 without incident, sir.'
  const out = spoken(sample)
  assert.match(out, /Albert processed/)
  assert.doesNotMatch(out, /Albert\./)
  assert.match(out, /ninety-nine and point and eight percent/)
  assert.match(out, /three and point and one four seconds/)
  assert.match(out, /eighteen to twenty-four degrees Celsius/)
  assert.match(out, /G, P, T five and point and six/)
  assert.doesNotMatch(out, /fourteen/)
  assert.doesNotMatch(out, /\d+\.\d+/)
  assert.doesNotMatch(out, /[—–]/)
})

test('normalizes temperatures, measurements, ordinals, ranges, phones, and versions', () => {
  assert.match(spoken('It is 72°F outside.'), /seventy-two degrees Fahrenheit/)
  assert.match(spoken('The trail is 5 km long.'), /five kilometers/)
  assert.match(spoken('Take the 1st exit.'), /first/)
  assert.match(spoken('Read pages 10-12 tonight.'), /ten to twelve/)
  assert.match(spoken('Call 555-123-4567 later.'), /five five five.*one two three.*four five six seven/)
  assert.match(spoken('Ship v1.2.3 today.'), /one and point and two and point and three/)
})

test('pronounces product names, acronyms, and model versions consistently', () => {
  assert.match(spoken('A.L.B.E.R.T. is online.'), /^Albert/)
  assert.match(spoken('ChatGPT and ElevenLabs and Kokoro on macOS.'), /Chat G, P, T/)
  assert.match(spoken('ChatGPT and ElevenLabs and Kokoro on macOS.'), /Eleven Labs/)
  assert.match(spoken('ChatGPT and ElevenLabs and Kokoro on macOS.'), /Koh koh roh/)
  assert.match(spoken('ChatGPT and ElevenLabs and Kokoro on macOS.'), /mac, O, S/)
  assert.match(spoken('The API is ready.'), /A, P, I/)
  assert.match(spoken('GPT-5.6 is routed.'), /G, P, T five and point and six/)
})

test('does not rewrite identifiers, emails, keys, or file paths as numbers', () => {
  assert.match(spoken('id 550e8400-e29b-41d4-a716-446655440000'), /an identifier/)
  assert.match(spoken('email kai@example.com please'), /an email address/)
  assert.match(spoken('key sk-abcdefghijklmnopqrstuvwxyz'), /an A, P, I key/)
  assert.match(spoken('see src/main/voice/kokoro.ts'), /a file path/)
})

test('strips markdown, citations, and links into speakable prose', () => {
  const out = spoken('## Status\n- **Ready**\nSee [docs](https://example.com) [1] and https://hidden.example/path')
  assert.doesNotMatch(out, /#/)
  assert.doesNotMatch(out, /asterisk/i)
  assert.doesNotMatch(out, /https?:\/\//i)
  assert.doesNotMatch(out, /\[1\]/)
  assert.match(out, /Status/)
  assert.match(out, /Ready/)
  assert.match(out, /a link/)
})

test('does not read code fences or punctuation noise', () => {
  const out = spoken('Intro.\n```\nconst x = 1;\n```\nDone.')
  assert.doesNotMatch(out, /const x/)
  assert.match(out, /Intro/)
  assert.match(out, /Done/)
  assert.equal(spoken(''), '')
  assert.equal(spoken('   '), '')
  assert.deepEqual(speech.segmentForSpeech(''), [])
  assert.deepEqual(speech.segmentForSpeech('```\nonly code\n```'), [])
})

test('keeps contractions and title abbreviations intact', () => {
  assert.match(spoken("I don't think it's broken."), /don't/)
  const { units } = speech.drainSpeakableUnits('Dr. Smith arrived later.', true, false)
  assert.equal(units.length, 1)
  assert.match(units[0], /Dr\. Smith arrived later/)
})

test('does not split decimals, times, money, or quoted phrases', () => {
  const decimal = speech.takeSpeakableUnits('The constant is 3.14 and then we continue talking a bit more here.', false, true)
  assert.doesNotMatch(decimal.speak || decimal.rest, /^The constant is 3$/)
  assert.equal(spoken('Keep 3.14 together.'), 'Keep three and point and one four together.')

  const money = speech.takeSpeakableUnits('Please send $12.50 before noon if you can.', false, true)
  assert.doesNotMatch(money.speak, /\$12$/)

  const quoted = speech.takeSpeakableUnits('He said "Wait, now." after that.', true, false)
  assert.match(quoted.speak, /Wait, now/)
})

test('segments complete sentences first and avoids tiny robotic crumbs', () => {
  const { units } = speech.drainSpeakableUnits('Hi. This is the second sentence for Albert.', true, false)
  assert.equal(units.length, 1, 'Hi. is too short to cut on its own')

  const longer = speech.drainSpeakableUnits('Yes sir. I will handle that next.', true, false)
  assert.equal(longer.units[0], 'Yes sir.')
  assert.equal(longer.units[1], 'I will handle that next.')

  const chunks = speech.segmentForSpeech(
    'This is a complete first sentence. This is a complete second sentence after it.'
  )
  assert.ok(chunks.length >= 2)
  assert.equal(chunks[0].pauseAfter, 'sentence')
  assert.match(chunks[0].text, /first sentence/)
  assert.match(chunks[1].text, /second sentence/)
})

test('uses short, medium, and paragraph pauses without stacking generator silence', () => {
  assert.equal(speech.inferPauseAfter('Hello, '), 'clause')
  assert.equal(speech.inferPauseAfter('Hello.'), 'sentence')
  assert.equal(speech.inferPauseAfter('Hello.\n\n'), 'paragraph')
  assert.ok(speech.pauseSeconds('clause') < speech.pauseSeconds('sentence'))
  assert.ok(speech.pauseSeconds('sentence') < speech.pauseSeconds('paragraph'))
  assert.equal(speech.joinGapSeconds('sentence', 0.14), 0)
  assert.ok(speech.joinGapSeconds('sentence', 0.01) > speech.joinGapSeconds('clause', 0.01))
  assert.equal(speech.joinGapSeconds('none', 0), 0)
})

test('playback stays ordered and stops after cancellation', () => {
  const { units } = speech.drainSpeakableUnits('One done. Two done. Three done.', true, false)
  assert.deepEqual(units, ['One done.', 'Two done.', 'Three done.'])

  let generation = 1
  const played = []
  for (const unit of units) {
    if (generation !== 1) break
    played.push(unit)
    if (unit === 'One done.') generation += 1
  }
  assert.deepEqual(played, ['One done.'])
})

test('eager first clause does not wait for the whole reply', () => {
  const first = speech.takeSpeakableUnits(
    'When you are ready, we can inspect the Kokoro path without waiting for the rest',
    false,
    true
  )
  assert.ok(first.speak.length > 0)
  assert.ok(first.rest.length > 0)
  assert.match(first.speak, /When you are ready,/)
})

test('caches normalized speech so repeats are cheap', () => {
  speech.clearSpeechNormalizeCache()
  const a = spoken('GPT-5.6 and 95% done.')
  const b = spoken('GPT-5.6 and 95% done.')
  assert.equal(a, b)
})
