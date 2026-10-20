import type { ReactNode } from 'react'
import { EmptyState, ErrorState, LoadingSkeleton } from './ui'
import type { AdminApiError } from '../api'

export type Column<T> = {
  key: string; header: string; render: (row: T) => ReactNode
  sortKey?: string; numeric?: boolean; primary?: boolean; hideOnMobile?: boolean; width?: number | string
}
export type SortState = { key: string; dir: 'asc' | 'desc' } | null

/** Dense, server-driven table. Sorting / paging are callbacks: the parent asks the API. Rows open on Enter/Space via the row button. */
export function DataTable<T>({
  caption, columns, rows, rowKey, loading, error, onRetry, empty, sort, onSort, page, totalPages, total, onPage, selectedId,
}: {
  caption: string; columns: Array<Column<T>>; rows: T[]; rowKey: (r: T) => string
  loading?: boolean; error?: AdminApiError | null; onRetry?: () => void; empty: ReactNode
  sort?: SortState; onSort?: (s: SortState) => void
  page?: number; totalPages?: number; total?: number; onPage?: (p: number) => void; selectedId?: string | null
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (loading && rows.length === 0) return <div className="adm-card adm-card-b"><LoadingSkeleton rows={6} label={`Loading ${caption}`} /></div>
  if (!loading && rows.length === 0) return <>{empty}</>
  const ariaSort = (c: Column<T>) => (c.sortKey && sort?.key === c.sortKey ? (sort.dir === 'asc' ? 'ascending' : 'descending') : c.sortKey ? 'none' : undefined)
  const nextSort = (c: Column<T>) => {
    if (!c.sortKey || !onSort) return
    if (sort?.key !== c.sortKey) onSort({ key: c.sortKey, dir: 'desc' })
    else if (sort.dir === 'desc') onSort({ key: c.sortKey, dir: 'asc' })
    else onSort(null)
  }
  return (
    <div aria-busy={loading ? true : undefined}>
      <div className="adm-tablewrap" tabIndex={0} role="region" aria-label={`${caption} table`}>
        <table className="adm-table is-cards">
          <caption className="adm-sr">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={ariaSort(c)} style={{ width: c.width, textAlign: c.numeric ? 'right' : undefined }}>
                  {c.sortKey && onSort
                    ? <button type="button" onClick={() => nextSort(c)}>{c.header}<span aria-hidden="true">{sort?.key === c.sortKey ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button>
                    : <span>{c.header}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const id = rowKey(r)
              return (
                <tr key={id} data-selected={selectedId === id ? 'true' : undefined}>
                  {columns.map((c) => (
                    <td key={c.key} data-label={c.header} data-primary={c.primary ? 'true' : undefined} data-hide-mobile={c.hideOnMobile ? 'true' : undefined} className={c.numeric ? 'adm-num' : undefined}>{c.render(r)}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {page !== undefined && totalPages !== undefined && onPage ? <Pager label={caption} page={page} totalPages={totalPages} total={total ?? 0} onPage={onPage} /> : null}
    </div>
  )
}

export function Pager({ label, page, totalPages, total, onPage }: { label: string; page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  return (
    <nav className="adm-pager" aria-label={`${label} pagination`}>
      <span aria-live="polite">{total} result{total === 1 ? '' : 's'} · page {page} of {totalPages}</span>
      <span style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="adm-btn adm-btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button type="button" className="adm-btn adm-btn-secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
      </span>
    </nav>
  )
}
