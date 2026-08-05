import { useState } from 'react'
import * as Clipboard from 'expo-clipboard'
import { normalizeMacUrl, parsePairInfo } from '../lib/pairInfo'
import type { CompanionConfig, MacLinkState, SyncState } from '../types'
import { SystemsScreen, type ModelOption } from './SystemsScreen'

export interface PairScreenProps {
  config: CompanionConfig
  busy: boolean
  error: string | null
  syncNote: string | null
  linkState?: MacLinkState
  syncState?: SyncState
  remoteName?: string
  modelOptions?: ReadonlyArray<ModelOption>
  onChange: (next: CompanionConfig) => void
  onSync: () => void | Promise<void>
  onSave: () => void | Promise<void>
  onPastePairInfo?: () => void | Promise<void>
  onUnpair?: () => void | Promise<void>
  onRequestVoicePermission?: () => void | Promise<void>
  onOpenPrivacy?: () => void
}

/**
 * Backwards-compatible name for the consolidated Systems surface.
 * Clipboard parsing remains here so the screen is still functional with the legacy App wiring.
 */
export function PairScreen(props: PairScreenProps): React.JSX.Element {
  const [pasteNote, setPasteNote] = useState<string | null>(null)

  const pastePairInfo = async (): Promise<void> => {
    if (props.onPastePairInfo) {
      await props.onPastePairInfo()
      return
    }
    try {
      const parsed = parsePairInfo(await Clipboard.getStringAsync())
      if (!parsed.macBaseUrl && !parsed.macToken) {
        setPasteNote('Clipboard does not contain enrollment information.')
        return
      }
      props.onChange({
        ...props.config,
        macBaseUrl: parsed.macBaseUrl
          ? normalizeMacUrl(parsed.macBaseUrl)
          : props.config.macBaseUrl,
        macToken: parsed.macToken || props.config.macToken
      })
      setPasteNote('Enrollment information pasted. Save or test the secure link to continue.')
    } catch (caught) {
      setPasteNote(caught instanceof Error ? caught.message : 'Clipboard read failed')
    }
  }

  return (
    <SystemsScreen
      {...props}
      syncNote={pasteNote || props.syncNote}
      onPastePairInfo={pastePairInfo}
    />
  )
}

export { SystemsScreen }
