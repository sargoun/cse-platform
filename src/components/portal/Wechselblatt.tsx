import { Button } from '@/components/ui/Button';

/**
 * Das Zwischenblatt vor einem Bereichswechsel (03-AUTH §4.5).
 *
 * **Kein automatischer Redirect, sondern ein Knopf.** Genau darin besteht die
 * Regel: koennte ein GET den aktiven Bereich aendern, waere die URL der
 * Mandantenzustand — und ein aus einem Chat kopierter Link versetzte eine
 * Leitung lautlos in eine andere GmbH. Der Wechsel ist deshalb ein POST auf
 * `/api/sitzung/mandant`, ausgeloest von einem Menschen, der liest, was er
 * verlaesst.
 *
 * Ein echtes `<form>` ohne JavaScript: der Knopf funktioniert auch dann, wenn
 * das Skript nicht laedt, und ein Screenreader liest ihn als Schaltflaeche —
 * nicht als Link, der etwas aendert.
 */
export interface WechselblattProps {
  /** Was gerade aktiv ist, in Worten — `null` heisst: kein Bereich. */
  readonly aktuell: string | null;
  readonly zielTitel: string;
  /** Der Slug des Ziels, oder `null` fuer die Gruppenansicht. */
  readonly zielSlug: string | null;
}

export function Wechselblatt({ aktuell, zielTitel, zielSlug }: WechselblattProps) {
  return (
    <main className="mx-auto flex max-w-content flex-col gap-s5 p-s6">
      <h1 className="text-h1 text-text">Bereich wechseln?</h1>
      <p data-cse="wechsel-frage" className="max-w-[72ch] text-base text-text-muted">
        {aktuell === null
          ? `Sie arbeiten gerade ohne aktiven Bereich. Zu ${zielTitel} wechseln?`
          : `Sie arbeiten gerade in ${aktuell}. Zu ${zielTitel} wechseln?`}
      </p>
      <form method="post" action="/api/sitzung/mandant" data-cse="wechsel-formular">
        {zielSlug === null
          ? <input type="hidden" name="gruppe" value="true" />
          : <input type="hidden" name="mandantSlug" value={zielSlug} />}
        <Button type="submit" variante="primary" data-cse="wechsel-knopf">
          Zu {zielTitel} wechseln
        </Button>
      </form>
      <p className="max-w-[72ch] text-sm text-text-subtle">
        Der Wechsel wird protokolliert — in beiden Bereichen, dem verlassenen
        und dem betretenen (TEN-09).
      </p>
    </main>
  );
}
