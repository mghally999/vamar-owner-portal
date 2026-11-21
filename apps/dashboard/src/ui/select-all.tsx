/**
 * The "select every row shown" checkbox of the lists with bulk actions (cheques, expenses). Some
 * but not all rows ticked shows the mixed state. Below 768 px ResponsiveTable hides the table
 * header, and its checkbox with it, so `MobileSelectAll` puts the same control above the cards.
 */
import { cx } from './primitives';

interface SelectAllProps {
  all: boolean;
  some: boolean;
  onToggle: () => void;
  label: string;
}

export function SelectAllBox({ all, some, onToggle, label }: SelectAllProps) {
  return (
    <input
      type="checkbox"
      className="size-5 accent-primary"
      checked={all}
      ref={(el) => {
        if (el) el.indeterminate = some && !all;
      }}
      onChange={onToggle}
      aria-label={label}
    />
  );
}

export function MobileSelectAll({ className, ...props }: SelectAllProps & { className?: string }) {
  return (
    <label
      className={cx(
        'flex min-h-11 items-center gap-3 border-b border-line px-4 text-[15px] md:hidden',
        className,
      )}
    >
      <SelectAllBox {...props} />
      {props.label}
    </label>
  );
}
