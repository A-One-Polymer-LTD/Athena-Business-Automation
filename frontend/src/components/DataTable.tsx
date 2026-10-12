// Standard list: search, sorting, paging and Excel export on every list (FR-GEN-03).
// Columns with no data in any row are hidden, and empty cells never show "null" (FR-GEN-04).
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { exportRows } from '../lib/export'
import { Button, Empty, cx } from './ui'

export interface Column<T> {
  key: string
  header: string
  /** Cell content. Defaults to the row's value. */
  render?: (row: T) => ReactNode
  /** Plain value used for sorting, searching and Excel export. Defaults to row[key]. */
  value?: (row: T) => string | number | null | undefined
  align?: 'left' | 'right' | 'center'
  /** Keep the column even when every row is empty (e.g. action columns). */
  always?: boolean
  /** Leave the column out of search and Excel export (e.g. action buttons, thumbnails). */
  noExport?: boolean
  sortable?: boolean
  /** Not shown as a table column, but still searched and exported (its value is shown inside another column). */
  hidden?: boolean
  className?: string
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey?: (row: T) => string | number
  onRowClick?: (row: T) => void
  /** File name (without extension) for the Excel export. Omit to hide the export button. */
  exportName?: string
  searchable?: boolean
  searchPlaceholder?: string
  /** Extra filter controls shown next to the search box. */
  filters?: ReactNode
  /** Extra buttons shown on the right of the toolbar. */
  actions?: ReactNode
  pageSize?: number
  emptyTitle?: string
  emptyHint?: ReactNode
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  /** Optional footer row (e.g. totals). */
  footer?: ReactNode
  rowClassName?: (row: T) => string | undefined
  dense?: boolean
}

const raw = <T,>(c: Column<T>, r: T) => (c.value ? c.value(r) : (r as any)[c.key])

export function DataTable<T>({
  rows, columns, rowKey, onRowClick, exportName, searchable = true, searchPlaceholder = 'Search…', filters, actions,
  pageSize = 15, emptyTitle = 'No records found', emptyHint, initialSort, footer, rowClassName, dense,
}: Props<T>) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(pageSize)

  const visible = useMemo(
    () => columns.filter((c) => c.always || c.noExport || rows.some((r) => { const v = raw(c, r); return v !== null && v !== undefined && v !== '' })),
    [columns, rows],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = rows
    if (needle) {
      const cols = columns.filter((c) => !c.noExport)
      out = rows.filter((r) => cols.some((c) => String(raw(c, r) ?? '').toLowerCase().includes(needle)))
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      if (col) {
        out = [...out].sort((a, b) => {
          const x = raw(col, a), y = raw(col, b)
          if (x === y) return 0
          if (x === null || x === undefined || x === '') return 1
          if (y === null || y === undefined || y === '') return -1
          const res = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
          return sort.dir === 'asc' ? res : -res
        })
      }
    }
    return out
  }, [rows, columns, q, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / size))
  useEffect(() => { if (page > pages) setPage(1) }, [page, pages])
  const shown = filtered.slice((page - 1) * size, page * size)

  const toggleSort = (key: string) => setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null))
  const doExport = () => {
    const cols = visible.filter((c) => !c.noExport)
    exportRows(exportName!, filtered.map((r) => Object.fromEntries(cols.map((c) => [c.header, raw(c, r) ?? '']))))
  }
  const shownCols = visible.filter((c) => !c.hidden)
  const pad = dense ? 'px-3 py-2' : 'px-4 py-3'

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
      {(searchable || filters || actions || exportName) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 no-print">
          {searchable && (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder={searchPlaceholder} aria-label="Search"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200" />
            </div>
          )}
          {filters}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {actions}
            {exportName && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={doExport} disabled={!filtered.length}>Excel</Button>}
          </div>
        </div>
      )}
      {filtered.length === 0 ? (
        <Empty title={emptyTitle} hint={q ? 'Try a different search or clear the filters.' : emptyHint} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {shownCols.map((c) => (
                  <th key={c.key} scope="col" className={cx(pad, 'whitespace-nowrap border-b border-slate-200', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                    {c.sortable === false || c.noExport ? c.header : (
                      <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-brand-800">
                        {c.header}
                        {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={rowKey ? rowKey(r) : i} onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cx('border-b border-slate-100 last:border-0', onRowClick && 'cursor-pointer hover:bg-slate-50', rowClassName?.(r))}>
                  {shownCols.map((c) => {
                    const content = c.render ? c.render(r) : raw(c, r)
                    return (
                      <td key={c.key} className={cx(pad, 'align-middle text-slate-800', c.align === 'right' && 'text-right tabular', c.align === 'center' && 'text-center', c.className)}>
                        {content === null || content === undefined || content === '' ? <span className="text-slate-300">—</span> : content}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            {footer && <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">{footer}</tfoot>}
          </table>
        </div>
      )}
      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 no-print">
          <span>Showing {(page - 1) * size + 1}–{Math.min(page * size, filtered.length)} of {filtered.length}{filtered.length !== rows.length ? ` (filtered from ${rows.length})` : ''}</span>
          <div className="flex items-center gap-2">
            <select aria-label="Rows per page" value={size} onChange={(e) => { setSize(+e.target.value); setPage(1) }} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs">
              {[10, 15, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
            <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-slate-300 p-1.5 disabled:opacity-40 enabled:hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
            <span className="tabular font-semibold text-slate-700">{page} / {pages}</span>
            <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-md border border-slate-300 p-1.5 disabled:opacity-40 enabled:hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  )
}
