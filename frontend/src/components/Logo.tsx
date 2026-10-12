import { cx } from './ui'

/**
 * Athena OS brand lockup: the official Athena logo with the "OS" product tag.
 * Assets live in frontend/public: athena-logo.png (full logo, for light backgrounds) and
 * athena-mark.png (the sun emblem, for compact spaces and the browser tab).
 */
export function Logo({ size = 'md', compact, className }: { size?: 'sm' | 'md' | 'lg'; compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <div className={cx('flex items-center gap-2', className)}>
        <img src="/athena-mark.png" alt="" className="h-8 w-8" />
        <p className="font-display text-[18px] font-extrabold leading-none tracking-tight text-brand-950">Athena <span className="text-brand-800">OS</span></p>
      </div>
    )
  }
  const h = { sm: 'h-10', md: 'h-12', lg: 'h-[68px]' }[size]
  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <img src="/athena-logo.png" alt="Athena's furniture & home decor" className={cx(h, 'w-auto select-none')} draggable={false} />
      <span className={cx('rounded-md bg-brand-800 font-display font-extrabold leading-none tracking-wide text-white', size === 'lg' ? 'px-2.5 py-1.5 text-base' : 'px-2 py-1 text-[13px]')}>OS</span>
    </div>
  )
}
