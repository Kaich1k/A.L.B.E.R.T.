import { useMemo, useState } from 'react'
import { approvalKindLabel, classifyApprovalKind } from '../../../shared/approvalKind'
import type { ApprovalRequest } from '../../../shared/types'

export function ApprovalInbox({
  approvals,
  refresh
}: {
  approvals: ApprovalRequest[]
  refresh: () => Promise<void>
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(approvals[0]?.id ?? null)
  const selected = useMemo(
    () => approvals.find((item) => item.id === selectedId) ?? approvals[0] ?? null,
    [approvals, selectedId]
  )
  const kind = selected ? selected.kind || classifyApprovalKind(selected) : 'other'

  return (
    <div className="approval-split">
      <div className="approval-rail">
        {approvals.length ? (
          approvals.map((approval) => (
            <button
              type="button"
              key={approval.id}
              className={selected?.id === approval.id ? 'selected' : ''}
              onClick={() => setSelectedId(approval.id)}
            >
              <span>{approvalKindLabel(approval.kind || classifyApprovalKind(approval))}</span>
              <strong>{approval.title}</strong>
              <small>{approval.state}</small>
            </button>
          ))
        ) : (
          <p className="operations-empty">Approval queue clear.</p>
        )}
      </div>
      <aside className="approval-preview">
        {selected ? (
          <>
            <div className="eyebrow">
              {approvalKindLabel(kind)} / {selected.risk} / {selected.state}
            </div>
            <h3>{selected.title}</h3>
            <p>{selected.description}</p>
            {selected.preview ? (
              <pre className={kind === 'diff' ? 'diff-preview' : ''}>{selected.preview}</pre>
            ) : (
              <p className="section-sub">No preview payload. Decline if you cannot verify the impact.</p>
            )}
            {selected.state === 'pending' ? (
              <div className="approval-actions">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={async () => {
                    await window.albert.resolveApproval(selected.id, 'declined')
                    await refresh()
                  }}
                >
                  Decline
                </button>
                <button
                  className="btn primary"
                  type="button"
                  onClick={async () => {
                    await window.albert.resolveApproval(selected.id, 'approved')
                    await refresh()
                  }}
                >
                  {selected.actionLabel}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p>Select an approval to inspect the email, diff, purchase, shell, or app action before it fires.</p>
        )}
      </aside>
    </div>
  )
}
