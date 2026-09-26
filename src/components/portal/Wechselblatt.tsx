import { Button } from '@/components/ui/Button';
import { Marke } from '@/components/marke/Marke';
import { istBereich } from '@/lib/design/theme';

/**
 * Das Zwischenblatt vor einem Bereichswechsel (03-AUTH §4.5, DESIGN §5
 * „Standalone pages").
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
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum die Seite BEIDE Seiten zeigt und nicht nur einen Satz.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Vorfassung war ein Satz, ein Knopf und ein Nachsatz, oben links in ein
 * schwarzes Rechteck gesetzt — gemessen **9 %** des Bildschirms, der Rest
 * leer. Und sie liess den Leser rekonstruieren, was er verlaesst.
 *
 * Das ist nicht nur unschoen: der Bereichswechsel ist die Handlung, die eine
 * Rechnung in die falsche GmbH legt (DESIGN §1 nennt genau diesen Fehler als
 * Grund fuer die vier Identitaetsfarben). Wer wechselt, soll VON und NACH in
 * einem Blick sehen — jedes mit seinem Zeichen und seiner Farbe, mit einem
 * Pfeil dazwischen.
 *
 * Am Telefon stehen die beiden untereinander und der Pfeil zeigt nach unten;
 * ab `sm` nebeneinander. Die Reihenfolge bleibt dieselbe, damit niemand sie
 * zweimal lesen muss.
 */
export interface WechselblattProps {
  /** Was gerade aktiv ist, in Worten — `null` heisst: kein Bereich. */
  readonly aktuell: string | null;
  readonly zielTitel: string;
  /** Der Slug des Ziels, oder `null` fuer die Gruppenansicht. */
  readonly zielSlug: string | null;
  /**
   * Die Adresse, die gemeint war. Nach dem Wechsel fuehrt der Server dorthin
   * — wenn sie im Ziel liegt (`rueckwegImBereich`); sonst auf dessen Wurzel.
   */
  readonly zurueck?: string | null;
  /** Der Slug des AKTUELLEN Bereichs — fuer sein Zeichen. `null` = Gruppe. */
  readonly aktuellSlug?: string | null;
}

/**
 * Eine Seite des Wechsels — Zeichen, Etikett, Name.
 *
 * Das Zeichen traegt die Identitaetsfarbe (§1); der NAME traegt die Bedeutung
 * (§9: Farbe ist nie das einzige Signal). Ein unbekannter Slug faellt auf das
 * Gruppenzeichen zurueck, statt die Seite mit einem Typfehler zu beenden.
 */
function Seite({ etikett, name, slug, cse }: {
  readonly etikett: string;
  readonly name: string;
  readonly slug: string | null;
  readonly cse: string;
}) {
  const art = slug !== null && istBereich(slug) ? slug : 'gruppe';
  return (
    <div data-cse={cse} data-bereich={art}
         className="flex flex-1 items-center gap-s4 rounded-lg border border-line
                    bg-surface-2 p-s4">
      <Marke art={art} groesse="lg" />
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-semibold uppercase tracking-widest text-text-subtle">
          {etikett}
        </span>
        <span className="truncate text-base font-semibold text-text">{name}</span>
      </span>
    </div>
  );
}

export function Wechselblatt({
  aktuell, zielTitel, zielSlug, zurueck, aktuellSlug = null,
}: WechselblattProps) {
  return (
    <div className="relative min-h-dvh">
      <div aria-hidden="true"
           className="pointer-events-none fixed inset-0 bg-wash-brand" />

      <main className="relative mx-auto flex min-h-dvh w-full max-w-wahl flex-col
                       justify-start gap-s5 p-s5 sm:justify-center sm:p-s6">
        <section className="flex flex-col gap-s5 rounded-xl border border-line
                            bg-surface p-s5 sm:p-s6">
          <header className="flex flex-col gap-s2">
            <h1 className="m-0 text-h1 text-text">Bereich wechseln?</h1>
            <p data-cse="wechsel-frage" className="m-0 max-w-[58ch] text-base text-text-muted">
              Sie arbeiten gerade {aktuell === null ? 'ohne aktiven Bereich' : `in ${aktuell}`}.
              {' '}Danach arbeiten Sie in {zielTitel}.
            </p>
          </header>

          {/* Von → Nach. Am Telefon untereinander, ab `sm` nebeneinander. */}
          <div className="flex flex-col items-stretch gap-s3 sm:flex-row sm:items-center">
            <Seite etikett="Jetzt" cse="wechsel-von" slug={aktuellSlug}
                   name={aktuell ?? 'Gruppenübersicht'} />
            <span aria-hidden="true"
                  className="self-center text-h3 leading-none text-text-subtle
                             sm:rotate-0 rotate-90">
              →
            </span>
            <Seite etikett="Danach" cse="wechsel-nach" slug={zielSlug}
                   name={zielTitel} />
          </div>

          <form method="post" action="/api/sitzung/mandant" data-cse="wechsel-formular"
                className="m-0">
            {zielSlug === null
              ? <input type="hidden" name="gruppe" value="true" />
              : <input type="hidden" name="mandantSlug" value={zielSlug} />}
            {zurueck === undefined || zurueck === null
              ? null
              : <input type="hidden" name="zurueck" value={zurueck} />}
            <Button type="submit" variante="primary" data-cse="wechsel-knopf"
                    className="w-full sm:w-auto">
              Zu {zielTitel} wechseln
            </Button>
          </form>
        </section>

        <p className="px-s2 text-sm text-text-subtle">
          Der Wechsel wird protokolliert — in beiden Bereichen, dem verlassenen
          und dem betretenen (TEN-09).
        </p>
      </main>
    </div>
  );
}
