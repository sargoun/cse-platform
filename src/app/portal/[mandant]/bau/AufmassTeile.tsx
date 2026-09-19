import {
  formatiereErgebnis,
  type AufmassZeileZeile, type FotoZeile, type SignaturZeile,
} from '@/server/services/bau/aufmass';

/**
 * Die drei Blöcke eines Aufmaßblattes, die an ZWEI Adressen stehen: auf der
 * Blattansicht (`…/aufmass/[aufmassId]`, BAU-02) und auf der Freigabeseite
 * (`…/freigabe`, BAU-03).
 *
 * **Warum sie hier stehen und nicht zweimal.** Die Freigabeseite muss zeigen,
 * WAS gegengezeichnet wird, bevor jemand unterschreibt — also denselben Kopf,
 * dieselben Zeilen mit Rechenansatz und Ergebnis, dieselben Nachweisfotos und
 * dieselben bereits vorhandenen Unterschriften. Zwei Abschriften desselben
 * Blocks liefen beim ersten zusätzlichen Feld auseinander, und dann zeigte die
 * Seite, auf der unterschrieben wird, etwas anderes als die, auf der geprüft
 * wird. Genau das darf bei einem Beweisdokument nicht passieren (§10.4).
 *
 * Die Blöcke rendern NUR — sie fragen nichts ab und rechnen nichts. Die Menge
 * kommt fertig aus `formatiereErgebnis`, die Zeitangaben fertig aus der
 * Datenbank (Invariante 2).
 */
export function AufmassZeilenBlock(
  { zeilen, ueberschrift = 'Zeilen' }: {
    readonly zeilen: readonly AufmassZeileZeile[];
    readonly ueberschrift?: string;
  },
) {
  return (
    <section className="mb-s6">
      <h2 className="mb-s3 text-h3 text-text">{ueberschrift}</h2>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full border-collapse text-sm" data-cse="aufmass-zeilen">
          <caption className="sr-only">
            Aufmaßzeilen mit Rechenansatz und Ergebnis
          </caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="px-s4 py-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">Nr.</th>
              <th scope="col" className="px-s4 py-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">Bezeichnung</th>
              <th scope="col" className="px-s4 py-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">OZ</th>
              <th scope="col" className="px-s4 py-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">Rechenansatz</th>
              <th scope="col" className="px-s4 py-s3 text-right text-micro uppercase tracking-[0.08em] text-text-subtle">Ergebnis</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.id} className="border-b border-line last:border-0" data-cse="aufmass-zeile">
                <td className="px-s4 py-s3 align-top tabular-nums text-text-muted">{z.reihenfolge}</td>
                <td className="px-s4 py-s3 align-top text-text">
                  {z.bezeichnung}
                  {z.ausserhalb_lv && (
                    <span className="ml-s2 text-xs text-warning">außerhalb des LV</span>
                  )}
                </td>
                <td className="px-s4 py-s3 align-top tabular-nums text-text-muted">{z.oz ?? '—'}</td>
                {/* Woertlich, wie er aufgeschrieben wurde — nicht normiert. */}
                <td className="px-s4 py-s3 align-top font-mono text-text-muted" data-cse="rechenansatz">
                  {z.rechenansatz}
                </td>
                <td
                  className="px-s4 py-s3 text-right align-top tabular-nums text-text"
                  data-cse="ergebnis"
                  data-skaliert={z.ergebnis_skaliert}
                >
                  {formatiereErgebnis(z.ergebnis_skaliert, z.einheit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-s2 text-xs text-text-subtle">
        Das Ergebnis wird als ganze Zahl in fester Skala gespeichert
        (10⁻⁴ der Einheit) und aus der Formel berechnet — nicht eingetippt.
        Abzüge nach VOB/C wendet die Anwendung nicht automatisch an (offene
        Frage O-23).
      </p>
    </section>
  );
}

export function MessfotoBlock({ fotos }: { readonly fotos: readonly FotoZeile[] }) {
  return (
    <section className="mb-s6">
      <h2 className="mb-s3 text-h3 text-text">Messfotos</h2>
      {fotos.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-warning">
          Keine Aufnahme. Ohne Messfoto lässt sich dieses Blatt nicht vorlegen
          und nicht gegenzeichnen (BAU-03).
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {fotos.map((f) => (
            <li
              key={f.id}
              className="mb-s2 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted"
            >
              <span className="text-text">{f.beschreibung ?? f.mime_typ}</span>
              {' · '}Eingang {f.empfangen_lokal}
              {' · '}Zweck {f.zweck}
              {f.zeitabweichung_sek !== null && Math.abs(f.zeitabweichung_sek) > 60 && (
                <span className="ml-s2 text-warning">
                  Geräteuhr weicht um {Math.round(f.zeitabweichung_sek / 60)} Min. ab
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-s2 text-xs text-text-subtle">
        Die Aufnahmen liegen ohne Metadaten in einem privaten Speicher. Eine
        Anzeige braucht eine befristet signierte Adresse; ist der Speicher
        nicht verbunden, wird hier nichts angezeigt und nichts vorgetäuscht.
      </p>
    </section>
  );
}

export function SignaturBlock(
  { signaturen }: { readonly signaturen: readonly SignaturZeile[] },
) {
  if (signaturen.length === 0) return null;
  return (
    <ul className="m-0 mb-s4 list-none p-0">
      {signaturen.map((s) => (
        <li
          key={s.id}
          className="mb-s2 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted"
          data-cse="signatur"
        >
          <strong className="text-text">{s.unterzeichner_name}</strong>
          {s.unterzeichner_funktion !== null && ` (${s.unterzeichner_funktion})`}
          {' · '}{s.rolle === 'auftraggeber' ? 'Auftraggeber' : 'Auftragnehmer'}
          {' · '}{s.unterzeichnet_lokal}
          {s.vorbehalt !== null && (
            <span className="ml-s2 text-warning">Vorbehalt: {s.vorbehalt}</span>
          )}
          <span className="mt-s1 block font-mono text-xs text-text-subtle">
            {/* Der Digest ueber den eingefrorenen Abzug — §10.4. */}
            SHA-256 {s.snapshot_hash.slice(0, 16)}…
          </span>
        </li>
      ))}
    </ul>
  );
}
