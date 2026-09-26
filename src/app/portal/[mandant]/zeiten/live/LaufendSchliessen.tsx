import { Button } from '@/components/ui/Button';
import { type LaufendTexte, mitWerten } from '@/lib/i18n/verwaltung/zeit';

/**
 * Der Feierabend, den jemand vergessen hat — als Formular an der Karte
 * (V-064, TIM-11, Invariante 5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum ein `<details>` und kein zweiter Bildschirm.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Vorgang hat genau drei Angaben — Uhrzeit, Pause, Begründung — und die
 * Person, um die es geht, steht darüber. Ein eigener Bildschirm dafür hiesse:
 * hinklicken, den Namen noch einmal lesen, zurück. Auf dem Live-Brett stehen
 * bis zu dreissig Karten; wer morgens drei vergessene Abmeldungen aufräumt,
 * soll das an Ort und Stelle tun.
 *
 * `<details>` statt eines Umschalters in JavaScript: die Portalformulare
 * laufen ohne (SEITENKARTE §13), und ein Aufklapper ist genau das, was das
 * Element ist.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Begründung ist Pflicht, und das steht auf dem Bildschirm.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Was hier entsteht, ist keine gestempelte Zeit, sondern eine BEHAUPTUNG der
 * Verwaltung über die Arbeitszeit eines anderen Menschen. Sie wird als solche
 * gespeichert (`quelle_ende = 'planer_entscheidung'`, `nacherfasst = true`) —
 * und ohne Begründung wiese der Dienst sie ab. Der Satz daneben sagt, warum:
 * im Lohnstreit steht sonst da, dass jemand eine Zahl eingetragen hat.
 *
 * **Storno steht im selben Aufklapper, aber in `danger`.** Es ist der
 * Vorgang, mit dem erfasste Arbeitszeit VERSCHWINDET; ihn neben „Schliessen"
 * gleich aussehen zu lassen, wäre die teure Art von Symmetrie. Beide Knöpfe
 * gehören trotzdem zusammen: wer einen laufenden Eintrag vor sich hat, hat
 * genau diese zwei Möglichkeiten.
 */
export function LaufendSchliessen({
  eintragId, person, zurueck, mindestlaenge, t,
}: {
  readonly eintragId: string;
  readonly person: string;
  readonly zurueck: string;
  readonly mindestlaenge: number;
  readonly t: LaufendTexte;
}) {
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 '
    + 'text-sm text-text';

  return (
    <details className="mt-s3 border-t border-line pt-s3" data-cse="laufend-handlung">
      <summary className="min-h-11 cursor-pointer list-none text-sm text-text-muted
                          underline underline-offset-2 hover:text-text">
        {t.aufklappen}
      </summary>

      <form method="post" action="/api/zeit/laufend"
            data-cse="laufend-schliessen"
            className="mt-s3 flex flex-col gap-s3">
        <input type="hidden" name="zurueck" value={zurueck} />
        <input type="hidden" name="eintrag" value={eintragId} />
        <input type="hidden" name="aktion" value="schliessen" />

        <label className="flex flex-col gap-s1 text-sm text-text">
          {t.feierabend}
          <input type="datetime-local" name="ende" required className={feld}
                 data-cse="laufend-ende" />
        </label>

        <label className="flex flex-col gap-s1 text-sm text-text">
          {t.pause} <span className="text-text-subtle">{t.pauseLeer}</span>
          <input type="number" name="pause" min={0} step={1} className={feld} />
        </label>

        <label className="flex flex-col gap-s1 text-sm text-text">
          {t.begruendung}
          <textarea name="begruendung" required minLength={mindestlaenge} rows={2}
                    className="w-full rounded-md border border-line bg-surface-3 px-s3
                               py-s2 text-sm text-text"
                    placeholder={t.begruendungBeispiel}
                    data-cse="laufend-begruendung" />
          <span className="text-xs text-text-muted">
            {mitWerten(t.begruendungErklaerung,
              { n: String(mindestlaenge), person })}
          </span>
        </label>

        <div className="flex flex-wrap gap-s3">
          <Button type="submit" variante="primary" data-cse="laufend-speichern">
            {t.schliessen}
          </Button>
        </div>
      </form>

      {/*
        * Ein EIGENES Formular, kein zweiter Knopf im ersten: sonst müsste die
        * Stornierung die Pflichtfelder „Feierabend" und „Pause" mitschicken,
        * die sie gar nicht hat — und der Browser verweigerte das Absenden an
        * einem Feld, das für diesen Vorgang bedeutungslos ist.
        */}
      <form method="post" action="/api/zeit/laufend"
            data-cse="laufend-stornieren"
            className="mt-s4 flex flex-col gap-s3 border-t border-line pt-s3">
        <input type="hidden" name="zurueck" value={zurueck} />
        <input type="hidden" name="eintrag" value={eintragId} />
        <input type="hidden" name="aktion" value="stornieren" />

        <label className="flex flex-col gap-s1 text-sm text-text">
          {t.stornogrund}
          <textarea name="begruendung" required minLength={mindestlaenge} rows={2}
                    className="w-full rounded-md border border-line bg-surface-3 px-s3
                               py-s2 text-sm text-text"
                    placeholder={t.stornogrundBeispiel} />
          <span className="text-xs text-text-muted">{t.stornoErklaerung}</span>
        </label>

        <div>
          <Button type="submit" variante="danger" data-cse="laufend-storno">
            {t.stornieren}
          </Button>
        </div>
      </form>
    </details>
  );
}
