import type { RealtimeToolDefinition } from '../../shared/types'

export interface ToolImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  data: string
}

export interface ToolResult {
  ok: boolean
  result: string
  /** Optional image for vision models (e.g. desktop_screenshot) */
  image?: ToolImage
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** Show Allow/Deny dialog when confirmDangerousTools is on */
  dangerous?: boolean
  execute: (args: Record<string, unknown>) => Promise<ToolResult>
}

export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }))
}

export function toRealtimeTools(tools: ToolDefinition[]): RealtimeToolDefinition[] {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }))
}

export function toAnthropicTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      ...(t.parameters as Record<string, unknown>)
    }
  }))
}
