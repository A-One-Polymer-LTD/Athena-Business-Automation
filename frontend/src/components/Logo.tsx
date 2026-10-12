import { cx } from './ui'

/**
 * Athena OS brand lockup. The mark is served from /logo-mark.svg (frontend/public), so the official
 * logo can be dropped in by replacing that one file.
 */
export function Logo({ light, compact, className }: { light?: boolean; compact?: boolean; className?: string }) {
  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <img src="/logo-mark.svg" alt="" className={cx('rounded-[10px]', compact ? 'h-8 w-8' : 'h-9 w-9', light && 'ring-1 ring-white/20')} />
      <div className="leading-none">
        <p className={cx('font-display text-[19px] font-extrabold tracking-tight', light ? 'text-white' : 'text-brand-900')}>
          Athena <span className="text-gold-400">OS</span>
        </p>
        {!compact && <p className={cx('mt-1 text-[9.5px] font-semibold uppercase tracking-[0.2em]', light ? 'text-brand-300' : 'text-slate-500')}>Business Automation</p>}
      </div>
    </div>
  )
}
