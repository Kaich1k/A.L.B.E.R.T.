import assert from 'node:assert/strict'
import test from 'node:test'

const intent = await import('../src/shared/computerIntent.ts')
const redact = await import('../src/shared/redact.ts')
const automation = await import('../src/main/computer/automation.ts')

const mail = [
  {
    id: '1',
    subject: 'University reply: project review',
    sender: 'advisor@university.edu',
    received: 'today',
    body: 'Please see the attached notes.',
    unread: true,
    flagged: false
  },
  {
    id: '2',
    subject: 'Newsletter',
    sender: 'news@example.com',
    received: 'yesterday',
    body: 'Sales.',
    unread: true,
    flagged: true
  }
]

test('outlook and download intents route without sending mail', () => {
  assert.equal(intent.classifyComputerIntent('Check Outlook for unread university replies')?.kind, 'outlook-check')
  assert.equal(intent.classifyComputerIntent('Open the newest reply and summarize the thread')?.kind, 'outlook-open-newest')
  assert.equal(intent.classifyComputerIntent('Draft a reply')?.kind, 'outlook-draft')
  assert.equal(intent.classifyComputerIntent('Send it')?.kind, 'outlook-send')
  assert.deepEqual(intent.classifyComputerIntent('Look in Downloads for the file beginning with 9d'), {
    kind: 'find-download',
    prefix: '9d'
  })
  assert.equal(intent.classifyComputerIntent('What is the weather?'), null)
})

test('unread university replies match only the real message', () => {
  const hits = intent.filterMail(mail, 'Check Outlook for unread university replies')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, '1')
  assert.match(intent.summarizeThread(hits[0]), /University reply/)
})

test('download prefix finds 9d and redacts secrets from history', () => {
  assert.deepEqual(intent.matchNamePrefix(['9d-notes.txt', 'readme.md', '9D-scan.pdf'], '9d'), [
    '9d-notes.txt',
    '9D-scan.pdf'
  ])
  const cleaned = redact.redactSensitive('Authorization: Bearer abc.def password=hunter2 code is 123456')
  assert.equal(cleaned.includes('hunter2'), false)
  assert.equal(cleaned.includes('abc.def'), false)
  assert.equal(cleaned.includes('123456'), false)
})

test('interrupting automation invalidates the captured epoch', () => {
  const captured = automation.automationEpoch()
  automation.cancelComputerWork()
  assert.equal(automation.computerWorkStale(captured), true)
})
