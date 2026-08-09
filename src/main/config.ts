import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_GROQ_MODEL, DEFAULT_SETTINGS } from '../shared/types'
import type { AlbertSettings } from '../shared/types'
import { normalizeGroqModelForDate } from '../shared/groqModels'
import { normalizePersonality } from '../shared/personality'

function configPath(): string {
  const dir = join(app.getPath('userData'), 'albert-data')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

function migrateSettings(raw: Partial<AlbertSettings>): AlbertSettings {
  const settings: AlbertSettings = {
    ...DEFAULT_SETTINGS,
    ...raw,
    anthropicApiKey: raw.anthropicApiKey || '',
    openaiApiKey: raw.openaiApiKey || raw.apiKey || ''
  }

  // Drop deprecated field from runtime object
  delete settings.apiKey

  if (
    !settings.realtimeModel ||
    settings.realtimeModel.includes('realtime-preview') ||
    settings.realtimeModel === 'gpt-4o-realtime'
  ) {
    settings.realtimeModel = DEFAULT_SETTINGS.realtimeModel
  }

  // Migrate old OpenAI chat models to Claude Opus
  if (!settings.model || settings.model.startsWith('gpt-')) {
    settings.model = DEFAULT_SETTINGS.powerModel
  }

  // Keep powerModel / model in sync for older settings files
  if (!raw.powerModel && raw.model && !raw.model.startsWith('gpt-')) {
    settings.powerModel = raw.model
  }
  settings.model = settings.powerModel || DEFAULT_SETTINGS.powerModel

  if (!settings.fastModel) {
    settings.fastModel = DEFAULT_SETTINGS.fastModel
  }
  if (!settings.routingMode) {
    settings.routingMode = DEFAULT_SETTINGS.routingMode
  }
  if (typeof settings.ttsRate !== 'number') {
    settings.ttsRate = DEFAULT_SETTINGS.ttsRate
  }
  if (typeof settings.ttsPitch !== 'number') {
    settings.ttsPitch = DEFAULT_SETTINGS.ttsPitch
  }
  if (typeof settings.ttsVoice !== 'string') {
    settings.ttsVoice = DEFAULT_SETTINGS.ttsVoice
  }
  if (typeof settings.ttsStripPunctuation !== 'boolean') {
    settings.ttsStripPunctuation = DEFAULT_SETTINGS.ttsStripPunctuation
  }
  if (typeof settings.allowBargeIn !== 'boolean') {
    settings.allowBargeIn = DEFAULT_SETTINGS.allowBargeIn
  }
  if (typeof settings.wakeWordEnabled !== 'boolean') {
    settings.wakeWordEnabled = DEFAULT_SETTINGS.wakeWordEnabled
  }
  if (typeof settings.performanceMode !== 'boolean') {
    settings.performanceMode = DEFAULT_SETTINGS.performanceMode
  }
  if (typeof settings.startupAnimationEnabled !== 'boolean') {
    settings.startupAnimationEnabled = DEFAULT_SETTINGS.startupAnimationEnabled
  }
  if (!['minimal', 'balanced', 'cinematic'].includes(settings.hudDensity)) {
    settings.hudDensity = DEFAULT_SETTINGS.hudDensity
  }
  if (
    settings.ttsProvider !== 'system' &&
    settings.ttsProvider !== 'elevenlabs' &&
    settings.ttsProvider !== 'kokoro'
  ) {
    settings.ttsProvider = DEFAULT_SETTINGS.ttsProvider
  }
  if (typeof settings.kokoroVoiceId !== 'string' || !settings.kokoroVoiceId.trim()) {
    settings.kokoroVoiceId = DEFAULT_SETTINGS.kokoroVoiceId
  }
  if (typeof settings.elevenLabsApiKey !== 'string') {
    settings.elevenLabsApiKey = ''
  }
  if (typeof settings.elevenLabsVoiceId !== 'string') {
    settings.elevenLabsVoiceId = ''
  }
  if (typeof settings.companionEnabled !== 'boolean') {
    settings.companionEnabled = DEFAULT_SETTINGS.companionEnabled
  }
  if (
    !Number.isInteger(settings.companionPort) ||
    settings.companionPort < 1024 ||
    settings.companionPort > 65_535
  ) {
    settings.companionPort = DEFAULT_SETTINGS.companionPort
  }
  if (typeof settings.companionToken !== 'string') {
    settings.companionToken = ''
  }
  if (typeof settings.godMode !== 'boolean') {
    settings.godMode = DEFAULT_SETTINGS.godMode
  }
  if (!Array.isArray(settings.allowedFsRoots)) {
    settings.allowedFsRoots = DEFAULT_SETTINGS.allowedFsRoots
  } else {
    settings.allowedFsRoots = settings.allowedFsRoots.map((r) => String(r)).filter(Boolean)
  }
  if (typeof settings.confirmDangerousTools !== 'boolean') {
    settings.confirmDangerousTools = DEFAULT_SETTINGS.confirmDangerousTools
  }
  if (typeof settings.ollamaApiKey !== 'string') {
    settings.ollamaApiKey = ''
  }
  if (typeof settings.groqApiKey !== 'string') {
    settings.groqApiKey = ''
  }
  if (typeof settings.geminiApiKey !== 'string') {
    settings.geminiApiKey = ''
  }
  if (!settings.geminiModel?.trim()) {
    settings.geminiModel = DEFAULT_SETTINGS.geminiModel
  }
  if (!settings.localModel) {
    settings.localModel = DEFAULT_SETTINGS.localModel
  }
  // Keep existing installs off already-retired Groq IDs. Announced-but-still-
  // live transition models are preserved because some organizations block the
  // replacement until an admin explicitly enables it.
  const groqModelMigrations: Record<string, string> = {
    'meta-llama/llama-4-scout-17b-16e-instruct': 'openai/gpt-oss-120b',
    'qwen/qwen3-32b': 'openai/gpt-oss-120b'
  }
  settings.groqModel = normalizeGroqModelForDate(
    settings.groqModel
      ? groqModelMigrations[settings.groqModel] || settings.groqModel
      : DEFAULT_GROQ_MODEL
  )
  if (
    settings.localProvider !== 'ollama' &&
    settings.localProvider !== 'groq' &&
    settings.localProvider !== 'gemini'
  ) {
    settings.localProvider = DEFAULT_SETTINGS.localProvider
  }
  if (
    settings.ollamaEndpoint !== 'auto' &&
    settings.ollamaEndpoint !== 'cloud' &&
    settings.ollamaEndpoint !== 'local'
  ) {
    settings.ollamaEndpoint = DEFAULT_SETTINGS.ollamaEndpoint
  }
  if (!settings.ollamaCloudBase) {
    settings.ollamaCloudBase = DEFAULT_SETTINGS.ollamaCloudBase
  }
  if (!settings.ollamaLocalBase) {
    settings.ollamaLocalBase = DEFAULT_SETTINGS.ollamaLocalBase
  }
  settings.personality = normalizePersonality(settings.personality)
  if (
    settings.routingMode !== 'auto' &&
    settings.routingMode !== 'local' &&
    settings.routingMode !== 'fast' &&
    settings.routingMode !== 'power'
  ) {
    settings.routingMode = 'auto'
  }
  if (!settings.ollamaApiKey && process.env.OLLAMA_API_KEY) {
    settings.ollamaApiKey = process.env.OLLAMA_API_KEY
  }
  if (!settings.groqApiKey && process.env.GROQ_API_KEY) {
    settings.groqApiKey = process.env.GROQ_API_KEY
  }
  if (!settings.geminiApiKey && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
    settings.geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
  }

  return settings
}

export function getSettings(): AlbertSettings {
  const path = configPath()
  let settings: AlbertSettings = { ...DEFAULT_SETTINGS }
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AlbertSettings>
      settings = migrateSettings(raw)
    } catch {
      settings = { ...DEFAULT_SETTINGS }
    }
  }

  if (!settings.anthropicApiKey && process.env.ANTHROPIC_API_KEY) {
    settings = { ...settings, anthropicApiKey: process.env.ANTHROPIC_API_KEY }
  }
  if (!settings.openaiApiKey && process.env.OPENAI_API_KEY) {
    settings = { ...settings, openaiApiKey: process.env.OPENAI_API_KEY }
  }
  if (!settings.ollamaApiKey && process.env.OLLAMA_API_KEY) {
    settings = { ...settings, ollamaApiKey: process.env.OLLAMA_API_KEY }
  }
  if (!settings.groqApiKey && process.env.GROQ_API_KEY) {
    settings = { ...settings, groqApiKey: process.env.GROQ_API_KEY }
  }
  return settings
}

export function setSettings(partial: Partial<AlbertSettings>): AlbertSettings {
  const next = migrateSettings({ ...getSettings(), ...partial })
  writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function getDataDir(): string {
  const dir = join(app.getPath('userData'), 'albert-data')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function requireAnthropicApiKey(): string {
  const key = getSettings().anthropicApiKey?.trim()
  if (!key) {
    throw new Error(
      'Anthropic API key is not set. Add it in Settings or set ANTHROPIC_API_KEY. Get a key at https://platform.claude.com/dashboard'
    )
  }
  return key
}

export function requireOpenAIApiKey(): string {
  const key = getSettings().openaiApiKey?.trim()
  if (!key) {
    throw new Error('OpenAI API key is not set. Add it in Settings for voice (optional).')
  }
  return key
}

/** @deprecated use requireOpenAIApiKey */
export function requireApiKey(): string {
  return requireOpenAIApiKey()
}
