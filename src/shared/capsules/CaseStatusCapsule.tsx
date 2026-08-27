// Case Status Capsule
//
// Generic, reusable "case/dispute status timeline" renderer. See capsules/SYBNB_REUSABLE_CAPSULES.md
// and CAPSULE_RULES.noFabricatedResolution in ./index.ts: a case/dispute status screen must render
// steps strictly from a real backend status field. This component never marks a step complete, a
// decision made, or a case closed on its own — every claim it renders comes from the `statusMap`
// (or `fallback`) the caller supplies for the real `status` value it was given.
//
// Intentionally has no SYBNB-STAYS-specific or dispute-specific copy baked in: callers (e.g.
// TrustProtectionRoutes.tsx's DisputeClosedFeedback) own their own bilingual copy and status→step
// mapping, and pass it in as data.

export type CaseStatusStepDef = {
  key: string
  label: string
}

export type CaseStatusOutcome = {
  /** Index into `steps` this status has reached. -1 means no step in the list applies (fallback/unknown status). */
  stepIndex: number
  /** When true, the step at stepIndex is still in progress and rendered as pending, not complete. */
  pending?: boolean
  title: string
  body: string
}

export type CaseStatusMap = Record<string, CaseStatusOutcome>

export type CaseStatusCapsuleProps = {
  /** The real backend status value (e.g. booking.status). Never a locally-tracked or assumed value. */
  status: string
  steps: CaseStatusStepDef[]
  /** Maps a real status value to the outcome copy/step it represents. Statuses not present here fall back to `fallback`. */
  statusMap: CaseStatusMap
  /** Used when `status` has no entry in `statusMap`, or when the fetch failed / found nothing. Must be an honest, generic message — never a fabricated "closed" claim. */
  fallback: CaseStatusOutcome
  loading: boolean
  loadingLabel: string
  caseLabel?: string
}

export function CaseStatusCapsule({ status, steps, statusMap, fallback, loading, loadingLabel, caseLabel }: CaseStatusCapsuleProps) {
  const outcome = loading ? null : statusMap[status] || fallback
  const isTerminalDone = !!outcome && !outcome.pending && outcome.stepIndex >= steps.length - 1

  return (
    <>
      {caseLabel && <span className="booking-code">{caseLabel}</span>}
      <section className="dispute-closed-card">
        <strong>{loading ? '◷' : isTerminalDone ? '✓' : '⏳'}</strong>
        <h2>{loading ? loadingLabel : outcome?.title}</h2>
        {!loading && outcome && <p>{outcome.body}</p>}
      </section>
      {!loading && outcome && outcome.stepIndex >= 0 && (
        <section className="case-timeline">
          {steps.map((step, index) => {
            const done = index < outcome.stepIndex || (index === outcome.stepIndex && !outcome.pending)
            const active = index === outcome.stepIndex && !!outcome.pending
            return (
              <span key={step.key}>
                {done ? '✓' : active ? '⏳' : '○'} {step.label}
              </span>
            )
          })}
        </section>
      )}
    </>
  )
}
