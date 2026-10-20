import type { PageScope } from '../context'

export type ContextPanelProps = {
  legal: { label: string; names: string[]; note: string }
  scope: PageScope
  platform: string
  platforms: Array<{ code: string; displayName: string }>
  onPick: (code: string) => void
}
export function ContextPanel({ legal, scope, platform, platforms, onPick }: ContextPanelProps) {
  const selectable = scope.kind === 'platform-filter'
  const options = [{ code: 'ALL', displayName: 'All platforms' }, ...platforms]
  const shown = selectable ? platform : scope.kind === 'fixed-platform' ? scope.platformCode : 'ALL'
  return (
    <div role="group" aria-label="Context">
      <div className="adm-pop-title">Legal entity</div>
      <div className="adm-pop-static"><b>{legal.label}</b>{legal.names.length > 1 ? <ul className="adm-plain">{legal.names.map((n) => <li key={n}>{n}</li>)}</ul> : null}{legal.note ? <div className="adm-note">{legal.note}</div> : null}</div>
      <div className="adm-pop-title">Platform</div>
      <div role="radiogroup" aria-label="Platform scope">
        {options.map((p) => {
          const checked = shown === p.code
          const blocked = !selectable
          return (
            <button key={p.code} type="button" role="radio" aria-checked={checked} aria-disabled={blocked ? true : undefined} className="adm-pop-item" onClick={() => { if (!blocked) onPick(p.code) }}>
              <span aria-hidden="true">{checked ? '✓' : ''}</span>{p.displayName}
            </button>
          )
        })}
      </div>
      <div className="adm-note adm-pop-static" data-testid="scope-note">
        {selectable ? 'Applies to Command Center and My Work. Only platforms you are authorized for are listed.'
          : scope.kind === 'fixed-platform' ? `This page is about ${scope.label} only, so the platform choice is switched off here.`
          : 'This page covers the whole organization. The platform choice does not apply here, so it is switched off.'}
      </div>
    </div>
  )
}
