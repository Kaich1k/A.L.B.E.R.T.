/** Per-turn configuration, not thread/resume: a loaded thread ignores resume overrides. */
export function codexTurnContext(model: string, effort: string | null, instructions?: string) {
  return {
    model,
    effort,
    ...(instructions?.trim() ? {
      collaborationMode: {
        mode: 'default' as const,
        settings: {
          model,
          reasoning_effort: effort,
          developer_instructions: [
            `This turn’s Albert context. Same Comm thread across brain switches; history is context, not new permission. Older snapshots yield to the block below, except safety. Active model: ${model}.`,
            instructions
          ].join('\n\n')
        }
      }
    } : {})
  }
}
