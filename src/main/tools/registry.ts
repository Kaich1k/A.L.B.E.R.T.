import { BrowserWindow, dialog } from 'electron'
import { getSettings } from '../config'
import { logActivity } from '../memory/service'
import { appTools } from './apps'
import { browserTools } from './browser'
import { computerTools } from './computer'
import { desktopTools } from './desktop'
import { fileTools } from './files'
import { memoryTools } from './memory'
import { contextTools } from './context'
import { cursorTools } from './cursor'
import { lifecycleTools } from './lifecycle'
import { operationsTools } from './operations'
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
import { takeoverSelfLifecycleCommand } from '../appLifecycle'
import { blockedLiveWrite } from '../cursor/selfEdit'
import { guideHudForTool, reportHudRuntime } from '../hud/miniHud'
import { pushTheaterEvent } from '../theater/bus'
import { QUICK_TOOL_DENY } from './quickPolicy'

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
  ...memoryTools,
  ...operationsTools,
  ...contextTools,
  ...cursorTools,
  ...lifecycleTools
]

const byName = new Map(allTools.map((t) => [t.name, t]))

export function getTools(): ToolDefinition[] {
  return allTools
}

export function getOpenAIToolSchemas() {
  return toOpenAITools(allTools)
}

/**
 * Tools the QUICK tier must never reach: arbitrary shell and AppleScript.
 *
 * Everything else is now exposed to the QUICK providers, including project and
 * file editing — the old allowlist left Gemini unable to read a file, which
 * meant even trivial project questions escalated. Shell-class tools stay behind
 * Codex and Anthropic, which have the reasoning to use them safely.
 */
export function getOpenAIToolSchemasForOllama() {
  return toOpenAITools(allTools.filter((t) => !QUICK_TOOL_DENY.has(t.name)))
}

/** Names the QUICK tier may call — exported so tests can assert the gap closed. */
export function getQuickToolNames(): string[] {
  return allTools.filter((t) => !QUICK_TOOL_DENY.has(t.name)).map((t) => t.name)
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
  if (name === 'run_shell' || name === 'run_project_command') {
    const taken = takeoverSelfLifecycleCommand(String(args?.command ?? ''))
    if (taken) {
      logActivity({ toolName: name, args: args ?? {}, result: taken.result, ok: taken.ok })
      return { ...taken, logged: true }
    }
  }
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

  const liveBlock = blockedLiveWrite(name, args ?? {})
  if (liveBlock) {
    const result = { ok: false, result: liveBlock }
    logActivity({ toolName: name, args: args ?? {}, result: liveBlock, ok: false })
    return { ...result, logged: true }
  }

  reportHudRuntime({ busy: true, tool: name })
  await guideHudForTool(name, args ?? {})

  const start = pushTheaterEvent({
    toolName: name,
    argsPreview: JSON.stringify(args ?? {}).slice(0, 180),
    phase: 'start'
  })
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('albert:chat:event', { type: 'theater', theater: start })
  }

  try {
    const result = await tool.execute(args ?? {})
    logActivity({
      toolName: name,
      args: args ?? {},
      result: result.result,
      ok: result.ok
    })
    const end = pushTheaterEvent({
      toolName: name,
      argsPreview: start.argsPreview,
      resultPreview: result.result,
      ok: result.ok,
      phase: 'end'
    })
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('albert:chat:event', { type: 'theater', theater: end })
    }
    reportHudRuntime({ tool: '' })
    return { ...result, logged: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const result = { ok: false, result: message }
    logActivity({ toolName: name, args: args ?? {}, result: message, ok: false })
    reportHudRuntime({ tool: '' })
    return { ...result, logged: true }
  }
}
