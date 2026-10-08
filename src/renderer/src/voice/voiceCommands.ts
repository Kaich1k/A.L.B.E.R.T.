/** Re-export shared voice command matchers (main + renderer). */
export {
  correctTranscript,
  coreUtterance,
  isBareStandbyReply,
  isEndVoiceCommand,
  isHideCommand,
  isLikelyHallucination,
  isMuteCommand,
  isShowCommand
} from '../../../shared/voiceCommands'
