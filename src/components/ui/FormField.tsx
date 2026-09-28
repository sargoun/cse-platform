'use client';

import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

/**
 * DESIGN §5 Forms and §9 Accessibility.
 *
 * The label is always above and always bound — never placeholder-as-label,
 * which disappears the moment someone starts typing and leaves a screen reader
 * with an unnamed field. The error is announced through `aria-live` and bound
 * with `aria-describedby`, so it reaches a screen reader without stealing
 * focus mid-typing.
 */
export interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly label: string;
  readonly fehler?: string;
  readonly hinweis?: string;
  /**
   * `sm` setzt Beschriftung, Hinweis und Fehler in `xs` (DESIGN §5 „Forms");
   * `base` auf den Flächen der Beschäftigten, wo Fliesstext nie kleiner als
   * 16 px ist (§8, D-738) — dieselbe Regel wie `Hinweis groesse="base"`. Das
   * Eingabefeld selbst ist in beiden `base` (sonst zoomt iOS).
   */
  readonly groesse?: 'sm' | 'base';
}

export function FormField({
  label, fehler, hinweis, groesse = 'sm', className = '', ...rest
}: FormFieldProps) {
  const text = groesse === 'base' ? 'text-base' : 'text-xs';
  const id = useId();
  const fehlerId = `${id}-fehler`;
  const hinweisId = `${id}-hinweis`;
  const beschrieben = [fehler !== undefined ? fehlerId : null, hinweis !== undefined ? hinweisId : null]
    .filter((x): x is string => x !== null)
    .join(' ');

  return (
    <div className={`flex flex-col gap-s2 ${className}`}>
      <label htmlFor={id} className={`${text} text-text-muted`}>
        {label}
      </label>
      <input
        id={id}
        aria-invalid={fehler !== undefined}
        aria-describedby={beschrieben === '' ? undefined : beschrieben}
        className={[
          'min-h-11 rounded-md bg-surface-3 px-s4 py-s3 text-base text-text',
          'border transition-colors duration-fast ease-brand',
          'placeholder:text-text-subtle',
          fehler !== undefined ? 'border-danger' : 'border-line focus:border-brand',
        ].join(' ')}
        {...rest}
      />
      {hinweis !== undefined && (
        <p id={hinweisId} className={`${text} text-text-subtle`}>
          {hinweis}
        </p>
      )}
      {/* Always present, so the region exists before the message does — an
          aria-live region added at the same moment as its content is often
          not announced. */}
      <p id={fehlerId} role="alert" aria-live="polite" className={`${text} text-danger`}>
        {fehler ?? ''}
      </p>
    </div>
  );
}
