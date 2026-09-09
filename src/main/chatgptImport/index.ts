/**
 * Import an official ChatGPT data export into A.L.B.E.R.T.'s memory.
 *
 * Accepts either the export `.zip` or an already-unzipped folder. Zips are
 * expanded with the system `unzip` so this needs no extra dependency.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  dedupeAgainstExisting,
  parseConversationsJson,
  parseMemoryJson,
  type ImportCandidate,
  type ImportScan
} from './parse'
import { listMemories, rememberFact } from '../memory/service'

/**
 * Counts only — the candidate arrays stay in the main process so a large export
 * doesn't get serialized across IPC just to render a summary line.
 */
export interface ChatGptImportScanResult {
  foundMemoryJson: boolean
  foundConversationsJson: boolean
  totalMemories: number
  disabledMemories: number
  totalHistory: number
  conversationsSeen: number
  messagesScanned: number
  newMemories: number
  newHistory: number
  warnings: string[]
}

export interface ChatGptImportRunResult {
  importedMemories: number
  importedHistory: number
  skippedDuplicates: number
  failed: number
  warnings: string[]
}

/** Find a file by name anywhere in the export, a few levels deep. */
function findFile(root: string, name: string, depth = 3): string | null {
  if (depth < 0) return null
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return null
  }

  const direct = entries.find((e) => e.toLowerCase() === name.toLowerCase())
  if (direct) return join(root, direct)

  for (const entry of entries) {
    if (entry.startsWith('.') || entry === '__MACOSX') continue
    const full = join(root, entry)
    try {
      if (!statSync(full).isDirectory()) continue
    } catch {
      continue
    }
    const nested = findFile(full, name, depth - 1)
    if (nested) return nested
  }
  return null
}

function readJson(path: string | null): { value: unknown; error?: string } {
  if (!path) return { value: null }
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (err) {
    return { value: null, error: `Could not read ${path}: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * Expand `.zip` inputs into a temp folder. The caller must call `cleanup()`.
 */
function resolveRoot(inputPath: string): { root: string; cleanup: () => void } {
  const path = inputPath.trim()
  if (!path || !existsSync(path)) {
    throw new Error(`No export found at ${path || '(empty path)'}`)
  }

  if (statSync(path).isDirectory()) {
    return { root: path, cleanup: () => {} }
  }
  if (!/\.zip$/i.test(path)) {
    throw new Error('Pick the ChatGPT export .zip or the unzipped folder, sir.')
  }

  const temp = mkdtempSync(join(tmpdir(), 'albert-chatgpt-import-'))
  try {
    execFileSync('/usr/bin/unzip', ['-qq', '-o', path, '-d', temp], {
      timeout: 180_000,
      stdio: ['ignore', 'ignore', 'pipe']
    })
  } catch (err) {
    rmSync(temp, { recursive: true, force: true })
    throw new Error(
      `Could not unzip the export: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  return { root: temp, cleanup: () => rmSync(temp, { recursive: true, force: true }) }
}

function scanRoot(root: string): {
  memories: ImportCandidate[]
  history: ImportCandidate[]
  scan: Omit<ChatGptImportScanResult, 'newMemories' | 'newHistory'>
} {
  const warnings: string[] = []

  const memoryPath = findFile(root, 'memory.json')
  const conversationsPath = findFile(root, 'conversations.json')

  const memoryRaw = readJson(memoryPath)
  if (memoryRaw.error) warnings.push(memoryRaw.error)
  const conversationsRaw = readJson(conversationsPath)
  if (conversationsRaw.error) warnings.push(conversationsRaw.error)

  const { memories, disabled } = parseMemoryJson(memoryRaw.value)
  const { history, conversationsSeen, messagesScanned } = parseConversationsJson(
    conversationsRaw.value
  )

  if (!memoryPath) {
    warnings.push(
      'No memory.json in this export — ChatGPT only includes it when saved memories are on.'
    )
  }
  if (!conversationsPath) warnings.push('No conversations.json in this export.')

  return {
    memories,
    history,
    scan: {
      totalMemories: memories.length,
      disabledMemories: disabled,
      totalHistory: history.length,
      conversationsSeen,
      messagesScanned,
      foundMemoryJson: Boolean(memoryPath),
      foundConversationsJson: Boolean(conversationsPath),
      warnings
    }
  }
}

/** Dry run: report what would be imported without writing anything. */
export function scanChatGptExport(inputPath: string): ChatGptImportScanResult {
  const { root, cleanup } = resolveRoot(inputPath)
  try {
    const { memories, history, scan } = scanRoot(root)
    const existing = listMemories().map((m) => m.content)
    return {
      ...scan,
      newMemories: dedupeAgainstExisting(memories, existing).length,
      newHistory: dedupeAgainstExisting(
        history,
        existing.concat(memories.map((m) => m.content))
      ).length
    }
  } finally {
    cleanup()
  }
}

export async function importChatGptExport(
  inputPath: string,
  options?: { includeHistory?: boolean }
): Promise<ChatGptImportRunResult> {
  const { root, cleanup } = resolveRoot(inputPath)
  try {
    const { memories, history, scan } = scanRoot(root)
    const existing = listMemories().map((m) => m.content)

    const savedMemories = dedupeAgainstExisting(memories, existing)
    const distilled =
      options?.includeHistory === false
        ? []
        : dedupeAgainstExisting(history, existing.concat(savedMemories.map((m) => m.content)))

    const total = memories.length + history.length
    let importedMemories = 0
    let importedHistory = 0
    let failed = 0

    for (const candidate of [...savedMemories, ...distilled]) {
      try {
        // rememberFact embeds each row, so this is intentionally sequential.
        await rememberFact(candidate.content, candidate.category)
        if (candidate.category === 'chatgpt-memory') importedMemories += 1
        else importedHistory += 1
      } catch {
        failed += 1
      }
    }

    return {
      importedMemories,
      importedHistory,
      skippedDuplicates: total - savedMemories.length - distilled.length,
      failed,
      warnings: scan.warnings
    }
  } finally {
    cleanup()
  }
}
