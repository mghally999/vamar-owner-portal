import { logoAspect } from '@vamar/tokens';
import { cx } from './primitives';

/**
 * Official Vamar logo rendered through a CSS mask so it takes `currentColor`:
 * navy on light surfaces, silver (text-brand-silver) on navy.
 */
export function Logo({
  variant = 'mark',
  height = 28,
  className,
  title = 'Vamar',
}: {
  variant?: 'mark' | 'full';
  height?: number;
  className?: string;
  title?: string;
}) {
  const src = variant === 'full' ? '/vamar-logo.svg' : '/vamar-mark.svg';
  const ratio = variant === 'full' ? logoAspect.logo : logoAspect.mark;
  return (
    <span
      role="img"
      aria-label={title}
      className={cx('inline-block shrink-0 bg-current', className)}
      style={{
        height,
        width: Math.round(height * ratio),
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  );
}
