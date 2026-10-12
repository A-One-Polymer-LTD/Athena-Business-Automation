// Excel export and import helpers (SheetJS).
import * as XLSX from 'xlsx'

const stamp = () => new Date().toISOString().slice(0, 10)

/** Download rows as an .xlsx file. Keys of the first row become the header. */
export function exportRows(name: string, rows: Record<string, any>[], sheet = 'Data') {
  exportSheets(name, [{ name: sheet, rows }])
}

/** Download several sheets in one workbook. */
export function exportSheets(name: string, sheets: { name: string; rows: Record<string, any>[] }[]) {
  const wb = XLSX.utils.book_new()
  sheets.forEach((s) => {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{}])
    const keys = Object.keys(s.rows[0] ?? {})
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(48, Math.max(k.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[k] ?? '').length + 2))) }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  })
  XLSX.writeFile(wb, `${name} ${stamp()}.xlsx`)
}

/** Download an import template that holds only a header row and an example row. */
export function downloadTemplate(name: string, headers: string[], example?: any[]) {
  const ws = XLSX.utils.aoa_to_sheet(example ? [headers, example] : [headers])
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(16, h.length + 4) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Template')
  XLSX.writeFile(wb, `${name}.xlsx`)
}

/** Read the first sheet of an Excel or CSV file as objects keyed by lower-cased, trimmed header. */
export async function readSheet(file: File): Promise<Record<string, any>[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false })
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, '_'), typeof v === 'string' ? v.trim() : v])))
}
