import { deleteMemory, listMemories, recallMemories, rememberFact } from '../memory/service'
import type { ToolDefinition } from './types'

export const memoryTools: ToolDefinition[] = [
  {
    name: 'remember',
    description:
      'Persist a long-term fact or preference about Kai. The app already auto-saves many durable facts; still use this when he explicitly asks, or for something lasting that the auto-filter might miss. App-code edits go through cursor_agent, not this tool.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact to remember' },
        category: {
          type: 'string',
          description: 'Optional category: preference, project, personal, general'
        }
      },
      required: ['content']
    },
    execute: async (args) => {
      const content = String(args.content ?? '').trim()
      if (!content) return { ok: false, result: 'Content is required.' }
      const category = String(args.category || 'general')
      const fact = await rememberFact(content, category)
      return { ok: true, result: `Remembered (${fact.id}): ${fact.content}` }
    }
  },
  {
    name: 'recall',
    description: 'Search long-term memory for relevant facts.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['query']
    },
    execute: async (args) => {
      const query = String(args.query ?? '').trim()
      if (!query) return { ok: false, result: 'Query is required.' }
      const limit = Number(args.limit || 6)
      const facts = await recallMemories(query, limit)
      if (facts.length === 0) return { ok: true, result: 'No matching memories.' }
      return {
        ok: true,
        result: facts
          .map((f) => `- [${f.category}] ${f.content}${f.score != null ? ` (score ${f.score.toFixed(2)})` : ''}`)
          .join('\n')
      }
    }
  },
  {
    name: 'forget',
    description: 'Delete a memory by id, or list memories if no id provided so the user can choose.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory id to delete' }
      }
    },
    execute: async (args) => {
      const id = String(args.id || '').trim()
      if (!id) {
        const all = listMemories().slice(0, 20)
        if (all.length === 0) return { ok: true, result: 'No memories stored.' }
        return {
          ok: true,
          result: all.map((m) => `${m.id}: ${m.content}`).join('\n')
        }
      }
      const ok = deleteMemory(id)
      return ok
        ? { ok: true, result: `Forgot memory ${id}.` }
        : { ok: false, result: `Memory ${id} not found.` }
    }
  }
]
