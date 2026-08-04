import { BrowserWindow, dialog } from 'electron'
import { getSettings } from '../config'
import { logActivity } from '../memory/service'
import { appTools } from './apps'
import { browserTools } from './browser'
import { computerTools } from './computer'
import { desktopTools } from './desktop'
import { fileTools } from './files'
import { memoryTools } from './memory'
import { projectTools } from './project'
import { shellTools } from './shell'
import { spotifyTools } from './spotify'
import { systemTools } from './system'
import { webTools } from './web'
import {
  toAnthropicTools,
  toOpenAITools,
  toRealtimeTools,
  type ToolDefinition,
  type ToolResult
} from './types'

const allTools: ToolDefinition[] = [
  ...appTools,
  ...spotifyTools,
  ...computerTools,
  ...browserTools,
  ...webTools,
  ...projectTools,
  ...fileTools,
  ...shellTools,
  ...desktopTools,
  ...systemTools,
  ...memoryTools
]

const byName = new Map(allTools.map((t) => [t.name, t]))

export function getTools(): ToolDefinition[] {
  return allTools
}

export function getOpenAIToolSchemas() {
  return toOpenAITools(allTools)
}

/** Smaller tool surface for Ollama — full schemas often 500 on cloud. */
const OLLAMA_TOOL_NAMES = new Set([
  'open_app',
  'list_running_apps',
  'spotify_control',
  'get_datetime',
  'remember',
  'recall',
  'forget',
  'desktop_screenshot',
  'desktop_click',
  'desktop_type_text',
  'desktop_hotkey',
  'desktop_frontmost_app',
  'browser_open_url',
  'browser_list_tabs',
  'computer_open_tab',
  'computer_youtube',
  'computer_navigate',
  'computer_list_tabs',
  'computer_focus_tab',
  'computer_get_page',
  'web_search',
  'web_fetch',
  'read_clipboard',
  'write_clipboard'
])

export function getOpenAIToolSchemasForOllama() {
  return toOpenAITools(allTools.filter((t) => OLLAMA_TOOL_NAMES.has(t.name)))
}

export function getRealtimeToolSchemas() {
  return toRealtimeTools(allTools)
}

export function getAnthropicToolSchemas() {
  return toAnthropicTools(allTools)
}

export function getTool(name: string): ToolDefinition | undefined {
  return byName.get(name)
}

async function confirmDangerous(
  name: string,
  args: Record<string, unknown>
): Promise<boolean> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const detail = JSON.stringify(args, null, 2)
  const god = getSettings().godMode ? '\n\n⚠ God mode is ON — broader FS/shell access is unlocked.' : ''
  const options = {
    type: 'warning' as const,
    buttons: ['Allow', 'Deny'],
    defaultId: 1,
    cancelId: 1,
    title: 'A.L.B.E.R.T. needs permission',
    message: `Allow A.L.B.E.R.T. to run “${name}”?`,
    detail: (detail.slice(0, 1100) + god).slice(0, 1400)
  }
  const result = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)
  return result.response === 0
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  options?: { confirmed?: boolean }
): Promise<ToolResult & { logged: boolean }> {
  const tool = byName.get(name)
  if (!tool) {
    const result = { ok: false, result: `Unknown tool: ${name}` }
    logActivity({ toolName: name, args, result: result.result, ok: false })
    return { ...result, logged: true }
  }

  const settings = getSettings()
  if (tool.dangerous && settings.confirmDangerousTools && !options?.confirmed) {
    const allowed = await confirmDangerous(name, args ?? {})
    if (!allowed) {
      const result = {
        ok: false,
        result: `User denied tool “${name}”.`
      }
      logActivity({ toolName: name, args: args ?? {}, result: result.result, ok: false })
      return { ...result, logged: true }
    }
  }

  try {
    const result = await tool.execute(args ?? {})
    // Always log writes/execs with full result prefix for Activity panel audit
    logActivity({
      toolName: name,
      args: args ?? {},
      result: result.result,
      ok: result.ok
    })
    return { ...result, logged: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const result = { ok: false, result: message }
    logActivity({ toolName: name, args: args ?? {}, result: message, ok: false })
    return { ...result, logged: true }
  }
}
