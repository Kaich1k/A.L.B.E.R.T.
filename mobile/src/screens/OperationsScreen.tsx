import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native'
import { HudButton } from '../components/HudButton'
import { colors, fonts } from '../theme'
import type {
  ApprovalRequest,
  CaptureItem,
  Mission,
  MissionPriority,
  MissionState,
  MissionStep,
  OperationsSnapshot,
  Routine
} from '../types'

type MaybePromise<T> = T | Promise<T>
export type OperationsSectionId = 'missions' | 'approvals' | 'routines' | 'captures'
type SectionId = OperationsSectionId

export interface OperationsScreenProps {
  operations: OperationsSnapshot
  loading?: boolean
  refreshing?: boolean
  busy?: boolean
  offline?: boolean
  error?: string | null
  initialSection?: OperationsSectionId
  focusCaptureOnMount?: boolean
  onRefresh?: () => void
  onOpenMission?: (mission: Mission) => void
  onCreateMission?: (input: CreateMissionInput) => MaybePromise<void>
  onUpdateMission?: (missionId: string, patch: UpdateMissionInput) => MaybePromise<void>
  onDeleteMission?: (missionId: string) => MaybePromise<void>
  onAddMissionStep?: (missionId: string, title: string) => MaybePromise<void>
  onSetStepState?: (
    missionId: string,
    stepId: string,
    state: MissionStep['state']
  ) => MaybePromise<void>
  onResolveApproval?: (
    approvalId: string,
    resolution: 'approved' | 'declined'
  ) => MaybePromise<void>
  onToggleRoutine?: (routineId: string, enabled: boolean) => MaybePromise<void>
  onCreateRoutine?: (input: CreateRoutineInput) => MaybePromise<void>
  onUpdateRoutine?: (routineId: string, patch: UpdateRoutineInput) => MaybePromise<void>
  onDeleteRoutine?: (routineId: string) => MaybePromise<void>
  onAddCapture?: (input: Pick<CaptureItem, 'content' | 'kind'>) => MaybePromise<void>
  onFileCapture?: (captureId: string) => MaybePromise<void>
  onArchiveCapture?: (captureId: string) => MaybePromise<void>
}

export interface CreateMissionInput {
  title: string
  outcome: string
  priority: MissionPriority
  steps: string[]
}

export type UpdateMissionInput = Partial<Pick<Mission, 'title' | 'outcome' | 'priority' | 'state'>>

export interface CreateRoutineInput {
  name: string
  prompt: string
  schedule: string
  enabled: boolean
  quietStart?: string
  quietEnd?: string
}

export type UpdateRoutineInput = Partial<
  Pick<Routine, 'name' | 'prompt' | 'schedule' | 'enabled' | 'quietStart' | 'quietEnd'>
>

type MissionEditorState = { mode: 'create' } | { mode: 'edit'; mission: Mission }
type RoutineEditorState = { mode: 'create' } | { mode: 'edit'; routine: Routine }

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'missions', label: 'MISSIONS' },
  { id: 'approvals', label: 'APPROVALS' },
  { id: 'routines', label: 'ROUTINES' },
  { id: 'captures', label: 'CAPTURE' }
]

const CAPTURE_KINDS: CaptureItem['kind'][] = ['note', 'task', 'idea', 'url', 'reference']

function toneForState(state: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (state === 'complete' || state === 'approved' || state === 'filed') return 'ok'
  if (state === 'blocked' || state === 'failed' || state === 'declined' || state === 'expired') {
    return 'bad'
  }
  if (state === 'active' || state === 'approval' || state === 'waiting' || state === 'pending') {
    return 'warn'
  }
  return 'neutral'
}

function formatTime(value?: number): string {
  if (!value) return 'NO SCHEDULE'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'UNKNOWN'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).toUpperCase()
}

function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: ReturnType<typeof toneForState> }): React.JSX.Element {
  return (
    <View
      accessible
      accessibilityLabel={`Status: ${label}`}
      style={[
        styles.pill,
        tone === 'ok' && styles.pillOk,
        tone === 'warn' && styles.pillWarn,
        tone === 'bad' && styles.pillBad
      ]}
    >
      <View
        style={[
          styles.pillDot,
          tone === 'ok' && styles.dotOk,
          tone === 'warn' && styles.dotWarn,
          tone === 'bad' && styles.dotBad
        ]}
      />
      <Text style={styles.pillText}>{label.toUpperCase()}</Text>
    </View>
  )
}

function Frame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.frame}>
      <View pointerEvents="none" style={[styles.corner, styles.cornerTl]} />
      <View pointerEvents="none" style={[styles.corner, styles.cornerBr]} />
      {children}
    </View>
  )
}

function EmptyState({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return (
    <View style={styles.empty} accessible accessibilityRole="summary">
      <Text style={styles.emptyGlyph}>◇</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
    </View>
  )
}

function MissionCard({
  mission,
  busy,
  onOpen,
  onManage,
  onSetStepState
}: {
  mission: Mission
  busy: boolean
  onOpen?: (mission: Mission) => void
  onManage?: (mission: Mission) => void
  onSetStepState?: OperationsScreenProps['onSetStepState']
}): React.JSX.Element {
  const progress = Math.max(0, Math.min(100, Math.round(mission.progress)))
  return (
    <Frame>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.eyebrow}>MISSION / {mission.priority.toUpperCase()}</Text>
          <Text style={styles.cardTitle}>{mission.title}</Text>
        </View>
        <StatusPill label={mission.state} tone={toneForState(mission.state)} />
      </View>
      <Text style={styles.cardBody}>{mission.outcome}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>RISK / {mission.risk.toUpperCase()}</Text>
        <Text style={styles.meta}>{progress}%</Text>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${mission.title} progress`}
        accessibilityValue={{ min: 0, max: 100, now: progress }}
        style={styles.progressTrack}
      >
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
      {mission.deadline ? <Text style={styles.deadline}>DEADLINE / {formatTime(mission.deadline)}</Text> : null}
      {mission.steps.length ? (
        <View style={styles.steps}>
          {mission.steps
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((step, index) => {
              const actionable = Boolean(onSetStepState) && (step.state === 'pending' || step.state === 'complete')
              return (
                <Pressable
                  key={step.id}
                  disabled={!actionable || busy}
                  onPress={() =>
                    void onSetStepState?.(
                      mission.id,
                      step.id,
                      step.state === 'complete' ? 'pending' : 'complete'
                    )
                  }
                  accessibilityRole={actionable ? 'checkbox' : 'text'}
                  accessibilityLabel={`Step ${index + 1}: ${step.title}`}
                  accessibilityState={actionable ? { checked: step.state === 'complete', disabled: busy } : undefined}
                  accessibilityHint={actionable ? 'Marks this step complete or pending' : undefined}
                  style={({ pressed }) => [styles.step, pressed && actionable && styles.pressed]}
                >
                  <View style={[styles.stepNode, step.state === 'complete' && styles.stepNodeDone]}>
                    <Text style={styles.stepNodeText}>{step.state === 'complete' ? '✓' : index + 1}</Text>
                  </View>
                  <View style={styles.stepCopy}>
                    <Text style={[styles.stepTitle, step.state === 'complete' && styles.stepTitleDone]}>
                      {step.title}
                    </Text>
                    <Text style={styles.stepState}>{step.state.toUpperCase()}</Text>
                  </View>
                </Pressable>
              )
            })}
        </View>
      ) : null}
      {onOpen || onManage ? (
        <View style={styles.actionRow}>
          {onOpen ? (
            <HudButton
              label="Open mission"
              onPress={() => onOpen(mission)}
              disabled={busy}
              style={styles.flexAction}
            />
          ) : null}
          {onManage ? (
            <HudButton
              label="Manage mission"
              primary
              onPress={() => onManage(mission)}
              disabled={busy}
              style={styles.flexAction}
            />
          ) : null}
        </View>
      ) : null}
    </Frame>
  )
}

function ApprovalCard({
  approval,
  busy,
  onResolve
}: {
  approval: ApprovalRequest
  busy: boolean
  onResolve?: OperationsScreenProps['onResolveApproval']
}): React.JSX.Element {
  const pending = approval.state === 'pending'
  const resolve = (resolution: 'approved' | 'declined'): void => {
    if (!onResolve) return
    Alert.alert(
      resolution === 'approved' ? 'Authorize action?' : 'Decline request?',
      resolution === 'approved'
        ? `${approval.actionLabel}\n\n${approval.risk}`
        : `Albert will not perform “${approval.actionLabel}”.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: resolution === 'approved' ? 'Authorize' : 'Decline',
          style: resolution === 'approved' ? 'default' : 'destructive',
          onPress: () => void onResolve(approval.id, resolution)
        }
      ]
    )
  }
  return (
    <Frame>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.eyebrow}>AUTHORIZATION REQUEST</Text>
          <Text style={styles.cardTitle}>{approval.title}</Text>
        </View>
        <StatusPill label={approval.state} tone={toneForState(approval.state)} />
      </View>
      <Text style={styles.cardBody}>{approval.description}</Text>
      <View style={styles.riskBox}>
        <Text style={styles.riskLabel}>RISK ASSESSMENT</Text>
        <Text style={styles.riskText}>{approval.risk}</Text>
      </View>
      {approval.preview ? (
        <View style={styles.previewBox}>
          <Text style={styles.previewLabel}>ACTION PREVIEW</Text>
          <Text style={styles.previewText}>{approval.preview}</Text>
        </View>
      ) : null}
      {pending && onResolve ? (
        <View style={styles.actionRow}>
          <HudButton label="Decline" onPress={() => resolve('declined')} disabled={busy} style={styles.flexAction} />
          <HudButton
            label={approval.actionLabel}
            onPress={() => resolve('approved')}
            primary
            disabled={busy}
            style={styles.flexAction}
          />
        </View>
      ) : null}
    </Frame>
  )
}

function RoutineCard({
  routine,
  busy,
  onToggle,
  onEdit,
  onDelete
}: {
  routine: Routine
  busy: boolean
  onToggle?: OperationsScreenProps['onToggleRoutine']
  onEdit?: (routine: Routine) => void
  onDelete?: (routine: Routine) => void
}): React.JSX.Element {
  return (
    <Frame>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.eyebrow}>AUTOMATION PROTOCOL</Text>
          <Text style={styles.cardTitle}>{routine.name}</Text>
        </View>
        <Switch
          value={routine.enabled}
          onValueChange={(enabled) => void onToggle?.(routine.id, enabled)}
          disabled={busy || !onToggle}
          accessibilityLabel={`${routine.name} routine`}
          accessibilityHint="Enables or disables this routine"
          trackColor={{ false: colors.inkFaint, true: 'rgba(137, 207, 240, 0.48)' }}
          thumbColor={routine.enabled ? colors.accentStrong : colors.inkMuted}
        />
      </View>
      <Text style={styles.cardBody}>{routine.prompt}</Text>
      <View style={styles.telemetryGrid}>
        <View style={styles.telemetryCell}>
          <Text style={styles.telemetryLabel}>SCHEDULE</Text>
          <Text style={styles.telemetryValue}>{routine.schedule}</Text>
        </View>
        <View style={styles.telemetryCell}>
          <Text style={styles.telemetryLabel}>NEXT RUN</Text>
          <Text style={styles.telemetryValue}>{formatTime(routine.nextRunAt)}</Text>
        </View>
      </View>
      {routine.quietStart && routine.quietEnd ? (
        <Text style={styles.deadline}>QUIET WINDOW / {routine.quietStart}–{routine.quietEnd}</Text>
      ) : null}
      {onEdit || onDelete ? (
        <View style={styles.actionRow}>
          {onDelete ? (
            <HudButton
              label="Delete routine"
              variant="danger"
              onPress={() => onDelete(routine)}
              disabled={busy}
              style={styles.flexAction}
            />
          ) : null}
          {onEdit ? (
            <HudButton
              label="Edit routine"
              primary
              onPress={() => onEdit(routine)}
              disabled={busy}
              style={styles.flexAction}
            />
          ) : null}
        </View>
      ) : null}
    </Frame>
  )
}

function CaptureCard({
  capture,
  busy,
  onFile,
  onArchive
}: {
  capture: CaptureItem
  busy: boolean
  onFile?: OperationsScreenProps['onFileCapture']
  onArchive?: OperationsScreenProps['onArchiveCapture']
}): React.JSX.Element {
  const confirmArchive = (): void => {
    if (!onArchive) return
    Alert.alert('Archive capture?', 'This removes the item from the active capture inbox.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => void onArchive(capture.id) }
    ])
  }
  return (
    <Frame>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.eyebrow}>{capture.kind.toUpperCase()} / {formatTime(capture.createdAt)}</Text>
          <Text style={styles.captureText}>{capture.content}</Text>
        </View>
        <StatusPill label={capture.state} tone={toneForState(capture.state)} />
      </View>
      {capture.state === 'inbox' && (onFile || onArchive) ? (
        <View style={styles.actionRow}>
          {onArchive ? (
            <HudButton label="Archive" onPress={confirmArchive} disabled={busy} style={styles.flexAction} />
          ) : null}
          {onFile ? (
            <HudButton label="File item" onPress={() => void onFile(capture.id)} primary disabled={busy} style={styles.flexAction} />
          ) : null}
        </View>
      ) : null}
    </Frame>
  )
}

const MISSION_PRIORITIES: MissionPriority[] = ['low', 'normal', 'high', 'critical']
const MISSION_STATES: MissionState[] = [
  'draft',
  'queued',
  'active',
  'waiting',
  'approval',
  'blocked',
  'complete',
  'cancelled'
]

function ChoiceRow<T extends string>({
  label,
  values,
  value,
  disabled,
  onChange
}: {
  label: string
  values: T[]
  value: T
  disabled: boolean
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.choiceRow}
      >
        {values.map((item) => {
          const selected = item === value
          return (
            <Pressable
              key={item}
              disabled={disabled}
              onPress={() => onChange(item)}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={`${label}: ${item}`}
              style={({ pressed }) => [
                styles.choice,
                selected && styles.choiceActive,
                pressed && !disabled && styles.pressed
              ]}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextActive]}>
                {item.toUpperCase()}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

function MissionEditor({
  state,
  busy,
  error,
  onDismiss,
  onSave,
  onAddStep,
  onDelete
}: {
  state: MissionEditorState
  busy: boolean
  error: string | null
  onDismiss: () => void
  onSave?: (input: CreateMissionInput | UpdateMissionInput) => void
  onAddStep?: (title: string) => Promise<boolean>
  onDelete?: () => void
}): React.JSX.Element {
  const mission = state.mode === 'edit' ? state.mission : null
  const [title, setTitle] = useState(mission?.title ?? '')
  const [outcome, setOutcome] = useState(mission?.outcome ?? '')
  const [priority, setPriority] = useState<MissionPriority>(mission?.priority ?? 'normal')
  const [missionState, setMissionState] = useState<MissionState>(mission?.state ?? 'draft')
  const [initialSteps, setInitialSteps] = useState('')
  const [stepDraft, setStepDraft] = useState('')
  const canSave = Boolean(onSave && title.trim() && outcome.trim()) && !busy

  const submitStep = async (): Promise<void> => {
    const nextStep = stepDraft.trim()
    if (!nextStep || busy || !onAddStep) return
    if (await onAddStep(nextStep)) setStepDraft('')
  }

  const submit = (): void => {
    if (!canSave || !onSave) return
    if (state.mode === 'create') {
      onSave({
        title: title.trim(),
        outcome: outcome.trim(),
        priority,
        steps: initialSteps
          .split('\n')
          .map((step) => step.trim())
          .filter(Boolean)
      })
      return
    }
    onSave({ title: title.trim(), outcome: outcome.trim(), priority, state: missionState })
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close mission editor"
        />
        <View style={styles.editorPanel} accessibilityViewIsModal>
          <ScrollView
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.editorEyebrow}>
              {state.mode === 'create' ? 'NEW OBJECTIVE PROTOCOL' : `MISSION / ${mission?.id.slice(0, 8).toUpperCase()}`}
            </Text>
            <Text accessibilityRole="header" style={styles.editorTitle}>
              {state.mode === 'create' ? 'CREATE MISSION' : 'MANAGE MISSION'}
            </Text>

            <Text style={styles.fieldLabel}>MISSION TITLE</Text>
            <TextInput
              autoFocus
              value={title}
              onChangeText={setTitle}
              editable={!busy}
              maxLength={180}
              placeholder="Prepare the release"
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel="Mission title"
              returnKeyType="next"
              style={styles.editorInput}
            />

            <Text style={styles.fieldLabel}>DEFINITION OF DONE</Text>
            <TextInput
              value={outcome}
              onChangeText={setOutcome}
              editable={!busy}
              maxLength={2_000}
              multiline
              textAlignVertical="top"
              placeholder="Describe the verified outcome Albert should reach."
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel="Mission definition of done"
              style={[styles.editorInput, styles.editorTextArea]}
            />

            <ChoiceRow
              label="PRIORITY"
              values={MISSION_PRIORITIES}
              value={priority}
              disabled={busy}
              onChange={setPriority}
            />
            {state.mode === 'edit' ? (
              <ChoiceRow
                label="MISSION STATE"
                values={MISSION_STATES}
                value={missionState}
                disabled={busy}
                onChange={setMissionState}
              />
            ) : (
              <>
                <Text style={styles.fieldLabel}>INITIAL STEPS · ONE PER LINE</Text>
                <TextInput
                  value={initialSteps}
                  onChangeText={setInitialSteps}
                  editable={!busy}
                  maxLength={3_000}
                  multiline
                  textAlignVertical="top"
                  placeholder={'Run verification\nReview packaging\nPrepare recommendation'}
                  placeholderTextColor={colors.inkFaint}
                  accessibilityLabel="Initial mission steps, one per line"
                  style={[styles.editorInput, styles.stepsInput]}
                />
              </>
            )}

            {state.mode === 'edit' && onAddStep ? (
              <View style={styles.addStepBlock}>
                <Text style={styles.fieldLabel}>ADD NEXT STEP</Text>
                <View style={styles.inlineEditorRow}>
                  <TextInput
                    value={stepDraft}
                    onChangeText={setStepDraft}
                    editable={!busy}
                    maxLength={300}
                    placeholder="Describe the next verifiable step…"
                    placeholderTextColor={colors.inkFaint}
                    accessibilityLabel="New mission step"
                    returnKeyType="done"
                    onSubmitEditing={() => void submitStep()}
                    style={styles.inlineEditorInput}
                  />
                  <HudButton
                    label="Add"
                    glyph="＋"
                    disabled={busy || !stepDraft.trim()}
                    onPress={() => void submitStep()}
                    style={styles.inlineEditorButton}
                  />
                </View>
              </View>
            ) : null}

            {error ? (
              <Text accessibilityRole="alert" style={styles.editorError}>
                {error}
              </Text>
            ) : null}

            <View style={styles.editorActions}>
              <HudButton
                label="Cancel"
                onPress={onDismiss}
                disabled={busy}
                style={styles.flexAction}
              />
              {onSave ? (
                <HudButton
                  label={busy ? 'Saving mission' : state.mode === 'create' ? 'Create mission' : 'Save mission'}
                  primary
                  loading={busy}
                  disabled={!canSave}
                  onPress={submit}
                  style={styles.flexAction}
                />
              ) : null}
            </View>
            {state.mode === 'edit' && onDelete ? (
              <HudButton
                label="Delete mission"
                variant="danger"
                disabled={busy}
                onPress={onDelete}
                style={styles.deleteEditorButton}
              />
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function RoutineEditor({
  state,
  busy,
  error,
  onDismiss,
  onSave,
  onDelete
}: {
  state: RoutineEditorState
  busy: boolean
  error: string | null
  onDismiss: () => void
  onSave?: (input: CreateRoutineInput | UpdateRoutineInput) => void
  onDelete?: () => void
}): React.JSX.Element {
  const routine = state.mode === 'edit' ? state.routine : null
  const [name, setName] = useState(routine?.name ?? '')
  const [prompt, setPrompt] = useState(routine?.prompt ?? '')
  const [schedule, setSchedule] = useState(routine?.schedule ?? '08:00')
  const [quietStart, setQuietStart] = useState(routine?.quietStart ?? '')
  const [quietEnd, setQuietEnd] = useState(routine?.quietEnd ?? '')
  const [enabled, setEnabled] = useState(routine?.enabled ?? true)
  const canSave = Boolean(onSave && name.trim() && prompt.trim() && schedule.trim()) && !busy

  const submit = (): void => {
    if (!canSave || !onSave) return
    const input: CreateRoutineInput = {
      name: name.trim(),
      prompt: prompt.trim(),
      schedule: schedule.trim(),
      enabled,
      quietStart: quietStart.trim() || undefined,
      quietEnd: quietEnd.trim() || undefined
    }
    onSave(input)
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close routine editor"
        />
        <View style={styles.editorPanel} accessibilityViewIsModal>
          <ScrollView
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.editorEyebrow}>
              {state.mode === 'create' ? 'NEW AUTOMATION PROTOCOL' : `ROUTINE / ${routine?.id.slice(0, 8).toUpperCase()}`}
            </Text>
            <Text accessibilityRole="header" style={styles.editorTitle}>
              {state.mode === 'create' ? 'CREATE ROUTINE' : 'EDIT ROUTINE'}
            </Text>

            <Text style={styles.fieldLabel}>ROUTINE NAME</Text>
            <TextInput
              autoFocus
              value={name}
              onChangeText={setName}
              editable={!busy}
              maxLength={160}
              placeholder="Daily briefing"
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel="Routine name"
              style={styles.editorInput}
            />
            <Text style={styles.fieldLabel}>ACTION PROMPT</Text>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              editable={!busy}
              maxLength={4_000}
              multiline
              textAlignVertical="top"
              placeholder="Prepare my priorities and recommended first move."
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel="Routine action prompt"
              style={[styles.editorInput, styles.editorTextArea]}
            />
            <Text style={styles.fieldLabel}>SCHEDULE</Text>
            <TextInput
              value={schedule}
              onChangeText={setSchedule}
              editable={!busy}
              maxLength={120}
              autoCapitalize="none"
              placeholder="08:00 or every 30 minutes"
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel="Routine schedule"
              style={styles.editorInput}
            />
            <Text style={styles.scheduleHint}>Supports a time such as 08:00 or an interval such as every 30 minutes.</Text>

            <View style={styles.quietGrid}>
              <View style={styles.quietField}>
                <Text style={styles.fieldLabel}>QUIET FROM</Text>
                <TextInput
                  value={quietStart}
                  onChangeText={setQuietStart}
                  editable={!busy}
                  maxLength={5}
                  placeholder="22:00"
                  placeholderTextColor={colors.inkFaint}
                  accessibilityLabel="Quiet hours start"
                  keyboardType="numbers-and-punctuation"
                  style={styles.editorInput}
                />
              </View>
              <View style={styles.quietField}>
                <Text style={styles.fieldLabel}>QUIET UNTIL</Text>
                <TextInput
                  value={quietEnd}
                  onChangeText={setQuietEnd}
                  editable={!busy}
                  maxLength={5}
                  placeholder="07:00"
                  placeholderTextColor={colors.inkFaint}
                  accessibilityLabel="Quiet hours end"
                  keyboardType="numbers-and-punctuation"
                  style={styles.editorInput}
                />
              </View>
            </View>

            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: enabled, disabled: busy }}
              accessibilityLabel="Routine enabled"
              disabled={busy}
              onPress={() => setEnabled((value) => !value)}
              style={({ pressed }) => [styles.editorToggle, pressed && !busy && styles.pressed]}
            >
              <View style={styles.editorToggleCopy}>
                <Text style={styles.editorToggleTitle}>ARM ROUTINE</Text>
                <Text style={styles.editorToggleDetail}>Enabled routines create reviewable work when due.</Text>
              </View>
              <View style={[styles.editorToggleTrack, enabled && styles.editorToggleTrackOn]}>
                <View style={[styles.editorToggleThumb, enabled && styles.editorToggleThumbOn]} />
              </View>
            </Pressable>

            {error ? (
              <Text accessibilityRole="alert" style={styles.editorError}>
                {error}
              </Text>
            ) : null}
            <View style={styles.editorActions}>
              <HudButton label="Cancel" onPress={onDismiss} disabled={busy} style={styles.flexAction} />
              {onSave ? (
                <HudButton
                  label={busy ? 'Saving routine' : state.mode === 'create' ? 'Create routine' : 'Save routine'}
                  primary
                  loading={busy}
                  disabled={!canSave}
                  onPress={submit}
                  style={styles.flexAction}
                />
              ) : null}
            </View>
            {state.mode === 'edit' && onDelete ? (
              <HudButton
                label="Delete routine"
                variant="danger"
                disabled={busy}
                onPress={onDelete}
                style={styles.deleteEditorButton}
              />
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function OperationsScreen({
  operations,
  loading = false,
  refreshing = false,
  busy = false,
  offline = false,
  error,
  initialSection,
  focusCaptureOnMount = false,
  onRefresh,
  onOpenMission,
  onCreateMission,
  onUpdateMission,
  onDeleteMission,
  onAddMissionStep,
  onSetStepState,
  onResolveApproval,
  onToggleRoutine,
  onCreateRoutine,
  onUpdateRoutine,
  onDeleteRoutine,
  onAddCapture,
  onFileCapture,
  onArchiveCapture
}: OperationsScreenProps): React.JSX.Element {
  const pendingApprovals = operations.approvals.filter((approval) => approval.state === 'pending').length
  const [section, setSection] = useState<SectionId>(
    initialSection ?? (pendingApprovals ? 'approvals' : 'missions')
  )
  const [captureText, setCaptureText] = useState('')
  const [captureKind, setCaptureKind] = useState<CaptureItem['kind']>('note')
  const [captureBusy, setCaptureBusy] = useState(false)
  const [mutationBusy, setMutationBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [missionEditor, setMissionEditor] = useState<MissionEditorState | null>(null)
  const [routineEditor, setRoutineEditor] = useState<RoutineEditorState | null>(null)
  const [editorBusy, setEditorBusy] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const counts = useMemo<Record<SectionId, number>>(
    () => ({
      missions: operations.missions.length,
      approvals: pendingApprovals,
      routines: operations.routines.length,
      captures: operations.captures.filter((capture) => capture.state === 'inbox').length
    }),
    [operations, pendingApprovals]
  )

  const submitCapture = async (): Promise<void> => {
    const content = captureText.trim()
    if (!content || !onAddCapture || captureBusy) return
    setCaptureBusy(true)
    setLocalError(null)
    try {
      await onAddCapture({ content, kind: captureKind })
      setCaptureText('')
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCaptureBusy(false)
    }
  }

  const runMutation = async (action: () => MaybePromise<void>): Promise<void> => {
    if (mutationBusy) return
    setMutationBusy(true)
    setLocalError(null)
    try {
      await action()
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMutationBusy(false)
    }
  }

  const actionBusy = busy || mutationBusy

  const runEditorAction = async (action: () => MaybePromise<void>, close = true): Promise<boolean> => {
    if (editorBusy) return false
    setEditorBusy(true)
    setEditorError(null)
    try {
      await action()
      if (close) {
        setMissionEditor(null)
        setRoutineEditor(null)
      }
      return true
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setEditorBusy(false)
    }
  }

  const saveMission = (input: CreateMissionInput | UpdateMissionInput): void => {
    if (missionEditor?.mode === 'create' && onCreateMission) {
      void runEditorAction(() => onCreateMission(input as CreateMissionInput))
      return
    }
    if (missionEditor?.mode === 'edit' && onUpdateMission) {
      void runEditorAction(() => onUpdateMission(missionEditor.mission.id, input as UpdateMissionInput))
    }
  }

  const addMissionStep = (title: string): Promise<boolean> => {
    if (missionEditor?.mode !== 'edit' || !onAddMissionStep) return Promise.resolve(false)
    return runEditorAction(() => onAddMissionStep(missionEditor.mission.id, title), false)
  }

  const confirmDeleteMission = (): void => {
    if (missionEditor?.mode !== 'edit' || !onDeleteMission) return
    const mission = missionEditor.mission
    Alert.alert(
      'Delete mission?',
      `“${mission.title}” and its ${mission.steps.length} step${mission.steps.length === 1 ? '' : 's'} will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete mission',
          style: 'destructive',
          onPress: () => void runEditorAction(() => onDeleteMission(mission.id))
        }
      ]
    )
  }

  const saveRoutine = (input: CreateRoutineInput | UpdateRoutineInput): void => {
    if (routineEditor?.mode === 'create' && onCreateRoutine) {
      void runEditorAction(() => onCreateRoutine(input as CreateRoutineInput))
      return
    }
    if (routineEditor?.mode === 'edit' && onUpdateRoutine) {
      void runEditorAction(() => onUpdateRoutine(routineEditor.routine.id, input as UpdateRoutineInput))
    }
  }

  const confirmDeleteRoutine = (routine?: Routine): void => {
    const target = routine ?? (routineEditor?.mode === 'edit' ? routineEditor.routine : null)
    if (!target || !onDeleteRoutine) return
    Alert.alert(
      'Delete routine?',
      `“${target.name}” will no longer create scheduled work. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete routine',
          style: 'destructive',
          onPress: () => {
            if (routineEditor?.mode === 'edit' && routineEditor.routine.id === target.id) {
              void runEditorAction(() => onDeleteRoutine(target.id))
            } else {
              void runMutation(() => onDeleteRoutine(target.id))
            }
          }
        }
      ]
    )
  }
  const setStepState = onSetStepState
    ? (missionId: string, stepId: string, state: MissionStep['state']) =>
        runMutation(() => onSetStepState(missionId, stepId, state))
    : undefined
  const resolveApproval = onResolveApproval
    ? (approvalId: string, resolution: 'approved' | 'declined') =>
        runMutation(() => onResolveApproval(approvalId, resolution))
    : undefined
  const toggleRoutine = onToggleRoutine
    ? (routineId: string, enabled: boolean) =>
        runMutation(() => onToggleRoutine(routineId, enabled))
    : undefined
  const fileCapture = onFileCapture
    ? (captureId: string) => runMutation(() => onFileCapture(captureId))
    : undefined
  const archiveCapture = onArchiveCapture
    ? (captureId: string) => runMutation(() => onArchiveCapture(captureId))
    : undefined

  const isInitiallyLoading = loading && !operations.generatedAt
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={8}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>COMMAND DECK / FIELD CONSOLE</Text>
          <Text style={styles.title}>OPERATIONS</Text>
          <Text style={styles.subtitle}>Mission control, authorizations, routines, and rapid capture.</Text>
        </View>
        {loading && !isInitiallyLoading ? <ActivityIndicator color={colors.accent} accessibilityLabel="Updating operations" /> : null}
      </View>

      <View style={styles.summary} accessible accessibilityLabel={`${operations.missions.length} missions, ${pendingApprovals} pending approvals, ${counts.captures} captures in inbox`}>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryValue}>{operations.missions.length}</Text>
          <Text style={styles.summaryLabel}>MISSIONS</Text>
        </View>
        <View style={styles.summaryCell}>
          <Text style={[styles.summaryValue, pendingApprovals > 0 && styles.summaryAttention]}>{pendingApprovals}</Text>
          <Text style={styles.summaryLabel}>APPROVALS</Text>
        </View>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryValue}>{counts.captures}</Text>
          <Text style={styles.summaryLabel}>INBOX</Text>
        </View>
      </View>

      {offline ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeTitle}>◌ LOCAL MODE</Text>
          <Text style={styles.noticeText}>Changes remain queued until the Mac link returns.</Text>
        </View>
      ) : null}
      {error || localError ? (
        <View style={[styles.notice, styles.errorNotice]} accessibilityRole="alert">
          <Text style={[styles.noticeTitle, styles.errorText]}>⚠ OPERATION INTERRUPTED</Text>
          <Text style={styles.noticeText}>{localError ?? error}</Text>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sectionTabs}
        style={styles.sectionTabScroller}
        accessibilityRole="tablist"
      >
        {SECTIONS.map((item) => {
          const selected = section === item.id
          return (
            <Pressable
              key={item.id}
              onPress={() => setSection(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${item.label}, ${counts[item.id]}`}
              style={({ pressed }) => [styles.sectionTab, selected && styles.sectionTabActive, pressed && styles.pressed]}
            >
              <Text style={[styles.sectionTabText, selected && styles.sectionTabTextActive]}>{item.label}</Text>
              <Text style={[styles.sectionCount, selected && styles.sectionCountActive]}>{String(counts[item.id]).padStart(2, '0')}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {isInitiallyLoading ? (
        <View style={styles.loadingState} accessibilityRole="progressbar" accessibilityLabel="Loading operations">
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingText}>ESTABLISHING OPERATIONS LINK…</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroller}
          contentContainerStyle={styles.content}
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} /> : undefined}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {section === 'missions' ? (
            <>
              {onCreateMission ? (
                <View style={styles.sectionActionBar}>
                  <View style={styles.sectionActionCopy}>
                    <Text style={styles.sectionActionTitle}>OBJECTIVE CONTROL</Text>
                    <Text style={styles.sectionActionDetail}>Define a durable outcome and its first verifiable steps.</Text>
                  </View>
                  <HudButton
                    label="New mission"
                    glyph="＋"
                    primary
                    disabled={actionBusy}
                    onPress={() => {
                      setEditorError(null)
                      setMissionEditor({ mode: 'create' })
                    }}
                    style={styles.sectionActionButton}
                  />
                </View>
              ) : null}
              {operations.missions.length ? operations.missions.map((mission) => (
                <MissionCard
                  key={mission.id}
                  mission={mission}
                  busy={actionBusy}
                  onOpen={onOpenMission}
                  onManage={onUpdateMission || onDeleteMission || onAddMissionStep ? (target) => {
                    setEditorError(null)
                    setMissionEditor({ mode: 'edit', mission: target })
                  } : undefined}
                  onSetStepState={setStepState}
                />
              )) : <EmptyState title="NO ACTIVE MISSIONS" detail="Create an outcome and give Albert a concrete finish line." />}
            </>
          ) : null}

          {section === 'approvals' ? (
            operations.approvals.length ? operations.approvals
              .slice()
              .sort((a, b) => Number(a.state !== 'pending') - Number(b.state !== 'pending') || b.createdAt - a.createdAt)
              .map((approval) => <ApprovalCard key={approval.id} approval={approval} busy={actionBusy} onResolve={resolveApproval} />)
              : <EmptyState title="CLEARANCE QUEUE EMPTY" detail="Albert will hold consequential actions here until you authorize them." />
          ) : null}

          {section === 'routines' ? (
            <>
              {onCreateRoutine ? (
                <View style={styles.sectionActionBar}>
                  <View style={styles.sectionActionCopy}>
                    <Text style={styles.sectionActionTitle}>AUTOMATION GRID</Text>
                    <Text style={styles.sectionActionDetail}>Schedule reviewable preparation without surrendering approval control.</Text>
                  </View>
                  <HudButton
                    label="New routine"
                    glyph="＋"
                    primary
                    disabled={actionBusy}
                    onPress={() => {
                      setEditorError(null)
                      setRoutineEditor({ mode: 'create' })
                    }}
                    style={styles.sectionActionButton}
                  />
                </View>
              ) : null}
              {operations.routines.length ? operations.routines.map((routine) => (
                <RoutineCard
                  key={routine.id}
                  routine={routine}
                  busy={actionBusy}
                  onToggle={toggleRoutine}
                  onEdit={onUpdateRoutine || onDeleteRoutine ? (target) => {
                    setEditorError(null)
                    setRoutineEditor({ mode: 'edit', routine: target })
                  } : undefined}
                  onDelete={onDeleteRoutine ? confirmDeleteRoutine : undefined}
                />
              )) : <EmptyState title="NO ROUTINES CONFIGURED" detail="Create a scheduled briefing, review, watch, or recurring preparation." />}
            </>
          ) : null}

          {section === 'captures' ? (
            <>
              <Frame>
                <Text style={styles.eyebrow}>RAPID CAPTURE</Text>
                <TextInput
                  autoFocus={focusCaptureOnMount && initialSection === 'captures'}
                  value={captureText}
                  onChangeText={setCaptureText}
                  placeholder="Record a note, task, idea, or reference…"
                  placeholderTextColor={colors.inkFaint}
                  multiline
                  maxLength={2000}
                  editable={!captureBusy && Boolean(onAddCapture)}
                  accessibilityLabel="Capture content"
                  accessibilityHint="Enter an item for Albert's capture inbox"
                  style={styles.captureInput}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>
                  {CAPTURE_KINDS.map((kind) => (
                    <Pressable
                      key={kind}
                      onPress={() => setCaptureKind(kind)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: captureKind === kind }}
                      style={({ pressed }) => [styles.kindChip, captureKind === kind && styles.kindChipActive, pressed && styles.pressed]}
                    >
                      <Text style={[styles.kindText, captureKind === kind && styles.kindTextActive]}>{kind.toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <HudButton
                  label={captureBusy ? 'Transmitting…' : 'Add to inbox'}
                  onPress={() => void submitCapture()}
                  primary
                  disabled={!captureText.trim() || !onAddCapture || captureBusy}
                />
              </Frame>
              {operations.captures.length ? operations.captures
                .slice()
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((capture) => (
                  <CaptureCard key={capture.id} capture={capture} busy={actionBusy} onFile={fileCapture} onArchive={archiveCapture} />
                )) : <EmptyState title="CAPTURE INBOX CLEAR" detail="Record something above and Albert will hold it for triage." />}
            </>
          ) : null}
          <View style={styles.footerTelemetry}>
            <Text style={styles.footerText}>SNAPSHOT / {formatTime(operations.generatedAt)}</Text>
            <Text style={styles.footerText}>{offline ? 'UPLINK / QUEUED' : 'UPLINK / NOMINAL'}</Text>
          </View>
        </ScrollView>
      )}
      {missionEditor ? (
        <MissionEditor
          key={`${missionEditor.mode}-${missionEditor.mode === 'edit' ? missionEditor.mission.id : 'new'}`}
          state={missionEditor}
          busy={editorBusy}
          error={editorError}
          onDismiss={() => {
            if (!editorBusy) setMissionEditor(null)
          }}
          onSave={missionEditor.mode === 'create' || onUpdateMission ? saveMission : undefined}
          onAddStep={missionEditor.mode === 'edit' && onAddMissionStep ? addMissionStep : undefined}
          onDelete={missionEditor.mode === 'edit' && onDeleteMission ? confirmDeleteMission : undefined}
        />
      ) : null}
      {routineEditor ? (
        <RoutineEditor
          key={`${routineEditor.mode}-${routineEditor.mode === 'edit' ? routineEditor.routine.id : 'new'}`}
          state={routineEditor}
          busy={editorBusy}
          error={editorError}
          onDismiss={() => {
            if (!editorBusy) setRoutineEditor(null)
          }}
          onSave={routineEditor.mode === 'create' || onUpdateRoutine ? saveRoutine : undefined}
          onDelete={routineEditor.mode === 'edit' && onDeleteRoutine ? () => confirmDeleteRoutine() : undefined}
        />
      ) : null}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 6 },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, gap: 12 },
  headerCopy: { flex: 1 },
  kicker: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.8, color: colors.accent },
  title: { marginTop: 4, fontFamily: fonts.displayMed, fontSize: 24, letterSpacing: 3, color: colors.accentStrong },
  subtitle: { marginTop: 5, fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.inkMuted },
  summary: { flexDirection: 'row', marginHorizontal: 16, marginTop: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(5,14,20,0.78)' },
  summaryCell: { flex: 1, minHeight: 58, justifyContent: 'center', alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.line },
  summaryValue: { fontFamily: fonts.displayMed, fontSize: 18, color: colors.accentStrong },
  summaryAttention: { color: '#ffd166' },
  summaryLabel: { marginTop: 2, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.2, color: colors.inkMuted },
  notice: { marginHorizontal: 16, marginTop: 10, borderLeftWidth: 2, borderColor: '#ffd166', paddingVertical: 9, paddingHorizontal: 11, backgroundColor: 'rgba(255,209,102,0.08)' },
  errorNotice: { borderColor: colors.danger, backgroundColor: 'rgba(255,107,99,0.08)' },
  noticeTitle: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.1, color: '#ffd166' },
  noticeText: { marginTop: 3, fontFamily: fonts.body, fontSize: 14, lineHeight: 18, color: colors.ink },
  errorText: { color: colors.danger },
  sectionTabScroller: { flexGrow: 0, marginTop: 12 },
  sectionTabs: { minWidth: '100%', paddingHorizontal: 12, gap: 6 },
  sectionTab: { minHeight: 48, minWidth: 104, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(0,0,0,0.42)' },
  sectionTabActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  sectionTabText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.1, color: colors.inkMuted },
  sectionTabTextActive: { color: colors.accentStrong },
  sectionCount: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint },
  sectionCountActive: { color: colors.accent },
  scroller: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 32, gap: 12 },
  sectionActionBar: {
    minHeight: 76,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.accentFaint,
    padding: 12
  },
  sectionActionCopy: { flex: 1, minWidth: 190 },
  sectionActionTitle: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.35,
    color: colors.accentStrong
  },
  sectionActionDetail: {
    marginTop: 4,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 18,
    color: colors.inkMuted
  },
  sectionActionButton: { minWidth: 142 },
  loadingState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.6, color: colors.inkMuted },
  frame: { position: 'relative', borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(3,10,15,0.88)', padding: 14 },
  corner: { position: 'absolute', width: 13, height: 13, borderColor: colors.accent },
  cornerTl: { top: -1, left: -1, borderTopWidth: 2, borderLeftWidth: 2 },
  cornerBr: { bottom: -1, right: -1, borderBottomWidth: 2, borderRightWidth: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardHeaderCopy: { flex: 1 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, color: colors.accent },
  cardTitle: { marginTop: 5, fontFamily: fonts.bodyBold, fontSize: 19, lineHeight: 23, color: colors.ink },
  cardBody: { marginTop: 10, fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.inkMuted },
  pill: { minHeight: 27, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8, backgroundColor: 'rgba(255,255,255,0.03)' },
  pillOk: { borderColor: 'rgba(61,207,122,0.45)' },
  pillWarn: { borderColor: 'rgba(255,209,102,0.5)' },
  pillBad: { borderColor: 'rgba(255,107,99,0.5)' },
  pillDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.inkMuted },
  dotOk: { backgroundColor: colors.ok },
  dotWarn: { backgroundColor: '#ffd166' },
  dotBad: { backgroundColor: colors.danger },
  pillText: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.8, color: colors.inkMuted },
  metaRow: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between' },
  meta: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.7, color: colors.inkMuted },
  progressTrack: { height: 5, marginTop: 7, overflow: 'hidden', backgroundColor: colors.lineDim },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  deadline: { marginTop: 8, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.8, color: colors.inkMuted },
  steps: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  step: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineDim },
  stepNode: { width: 27, height: 27, borderRadius: 14, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  stepNodeDone: { borderColor: colors.ok, backgroundColor: 'rgba(61,207,122,0.12)' },
  stepNodeText: { fontFamily: fonts.mono, fontSize: 11, color: colors.accentStrong },
  stepCopy: { flex: 1 },
  stepTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  stepTitleDone: { color: colors.inkMuted, textDecorationLine: 'line-through' },
  stepState: { marginTop: 2, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.inkFaint },
  cardAction: { marginTop: 12, alignSelf: 'stretch' },
  riskBox: { marginTop: 12, borderLeftWidth: 2, borderColor: '#ffd166', padding: 10, backgroundColor: 'rgba(255,209,102,0.07)' },
  riskLabel: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.2, color: '#ffd166' },
  riskText: { marginTop: 4, fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink },
  previewBox: { marginTop: 10, padding: 10, borderWidth: 1, borderColor: colors.lineDim, backgroundColor: 'rgba(0,0,0,0.35)' },
  previewLabel: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.2, color: colors.inkMuted },
  previewText: { marginTop: 4, fontFamily: fonts.mono, fontSize: 12, lineHeight: 17, color: colors.ink },
  actionRow: { marginTop: 12, flexDirection: 'row', gap: 9 },
  flexAction: { flex: 1, minHeight: 46 },
  telemetryGrid: { flexDirection: 'row', gap: 8, marginTop: 12 },
  telemetryCell: { flex: 1, minHeight: 54, borderWidth: 1, borderColor: colors.lineDim, padding: 9 },
  telemetryLabel: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.inkFaint },
  telemetryValue: { marginTop: 4, fontFamily: fonts.mono, fontSize: 11, color: colors.ink },
  captureText: { marginTop: 5, fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 22, color: colors.ink },
  captureInput: { minHeight: 92, marginTop: 10, borderWidth: 1, borderColor: colors.line, padding: 12, textAlignVertical: 'top', fontFamily: fonts.body, fontSize: 16, lineHeight: 21, color: colors.ink, backgroundColor: 'rgba(0,0,0,0.38)' },
  kindRow: { gap: 7, paddingVertical: 10 },
  kindChip: { minHeight: 44, minWidth: 68, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  kindChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  kindText: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.8, color: colors.inkMuted },
  kindTextActive: { color: colors.accentStrong },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 24,
    backgroundColor: colors.scrim
  },
  editorPanel: {
    width: '100%',
    maxWidth: 680,
    maxHeight: '92%',
    alignSelf: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.bg2,
    shadowColor: colors.accent,
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12
  },
  editorContent: { padding: 16, paddingBottom: 24 },
  editorEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.accent
  },
  editorTitle: {
    marginTop: 5,
    marginBottom: 4,
    fontFamily: fonts.displayMed,
    fontSize: 20,
    letterSpacing: 2.2,
    color: colors.accentStrong
  },
  fieldLabel: {
    marginTop: 14,
    marginBottom: 6,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.15,
    color: colors.inkMuted
  },
  editorInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 21,
    color: colors.ink
  },
  editorTextArea: { minHeight: 108 },
  stepsInput: { minHeight: 120 },
  choiceRow: { gap: 7, paddingBottom: 2 },
  choice: {
    minWidth: 76,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingHorizontal: 11
  },
  choiceActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  choiceText: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.inkMuted
  },
  choiceTextActive: { color: colors.accentStrong },
  addStepBlock: {
    marginTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: 2
  },
  inlineEditorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inlineEditorInput: {
    flex: 1,
    minWidth: 190,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    paddingHorizontal: 12,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink
  },
  inlineEditorButton: { minWidth: 92 },
  scheduleHint: {
    marginTop: 5,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 17,
    color: colors.inkFaint
  },
  quietGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quietField: { flex: 1, minWidth: 132 },
  editorToggle: {
    minHeight: 62,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.accentFaint,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  editorToggleCopy: { flex: 1 },
  editorToggleTitle: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.1,
    color: colors.accentStrong
  },
  editorToggleDetail: {
    marginTop: 3,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 17,
    color: colors.inkMuted
  },
  editorToggleTrack: {
    width: 52,
    height: 30,
    justifyContent: 'center',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.lineDim,
    paddingHorizontal: 3
  },
  editorToggleTrackOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  editorToggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.inkMuted
  },
  editorToggleThumbOn: {
    backgroundColor: colors.accentStrong,
    transform: [{ translateX: 21 }]
  },
  editorError: {
    marginTop: 14,
    borderLeftWidth: 2,
    borderLeftColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    padding: 10,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 19,
    color: colors.danger
  },
  editorActions: { marginTop: 18, flexDirection: 'row', gap: 9 },
  deleteEditorButton: { marginTop: 10, minHeight: 46 },
  empty: { minHeight: 210, alignItems: 'center', justifyContent: 'center', padding: 24, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed' },
  emptyGlyph: { fontFamily: fonts.displayMed, fontSize: 32, color: colors.accent },
  emptyTitle: { marginTop: 10, fontFamily: fonts.displayMed, fontSize: 14, letterSpacing: 1.8, color: colors.accentStrong, textAlign: 'center' },
  emptyDetail: { marginTop: 8, maxWidth: 360, fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.inkMuted, textAlign: 'center' },
  footerTelemetry: { minHeight: 44, marginTop: 2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  footerText: { flexShrink: 1, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.8, color: colors.inkFaint },
  pressed: { opacity: 0.72 }
})
