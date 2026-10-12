import { ImageOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { cx } from './ui'

/** Image stored on the server. Files are served only to signed-in users, so it is loaded with the token. */
export function AuthImage({ file, alt = '', className, onClick }: { file?: string | null; alt?: string; className?: string; onClick?: () => void }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setUrl('')
    setFailed(false)
    if (!file) { setFailed(true); return }
    api.fileUrl(file).then((u) => live && setUrl(u)).catch(() => live && setFailed(true))
    return () => { live = false }
  }, [file])
  if (failed) return <div className={cx('flex items-center justify-center bg-slate-100 text-slate-400', className)}><ImageOff className="h-5 w-5" /></div>
  if (!url) return <div className={cx('animate-pulse bg-slate-200', className)} />
  return <img src={url} alt={alt} onClick={onClick} className={cx('object-cover', onClick && 'cursor-zoom-in', className)} />
}

/** Row of thumbnails that open in a lightbox. */
export function ImageStrip({ images, size = 'h-20 w-24' }: { images?: { file: string; name?: string }[] | string[]; size?: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const list = (images ?? []).map((i) => (typeof i === 'string' ? { file: i, name: '' } : i))
  if (!list.length) return null
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {list.map((i) => <AuthImage key={i.file} file={i.file} alt={i.name} onClick={() => setOpen(i.file)} className={cx(size, 'rounded-lg border border-slate-200')} />)}
      </div>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-brand-950/80 p-4 no-print" onClick={() => setOpen(null)}>
          <button type="button" aria-label="Close" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X className="h-6 w-6" /></button>
          <AuthImage file={open} className="max-h-[88vh] max-w-full rounded-xl !object-contain shadow-pop" />
        </div>
      )}
    </>
  )
}
