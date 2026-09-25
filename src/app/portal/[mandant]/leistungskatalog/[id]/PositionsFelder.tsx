import type { PositionZeile } from '@/server/services/katalog/index';
import { berlinKalendertag } from '@/server/services/zeit/dauer';
import { FELD, KENNZEICHEN, KOSTENARTEN } from '../daten';

/**
 * Der Feldsatz einer Katalogposition — EINMAL, fuer Anlegen UND Aendern.
 *
 * Die Route fuehrt fuenf Handlungen, aber nur eine davon hatte ein Formular:
 * `position_aendern` und `position_ausser_kraft` waren gebaut, im
 * Routenmanifest eingetragen und von keiner Seite erreichbar. Eine falsch
 * angelegte Position liess sich damit weder korrigieren noch beenden — und
 * geloescht wird ohnehin nicht (`verhindere_loeschung`, Invariante 8).
 *
 * Der Feldsatz steht hier und nicht zweimal in `page.tsx`: `aenderePosition`
 * schreibt JEDE Spalte (es ist kein partielles Update), ein Aenderungsformular
 * mit weniger Feldern als das Anlegeformular loeschte also stillschweigend
 * Werte. Zwei Abschriften desselben Satzes liefen genau dort auseinander.
 *
 * `praefix` haelt die `id`-Attribute auseinander: auf der Fassungsseite steht
 * je Position ein eigenes Formular, und zwanzig Felder mit `id="oz"` waeren
 * zwanzig kaputte `<label for>`-Bezuege.
 */
export function PositionsFelder(
  { praefix, zeile, auswahl }: {
    readonly praefix: string;
    /** Die Zeile, aus der vorbelegt wird — `null` beim Anlegen. */
    readonly zeile: PositionZeile | null;
    readonly auswahl: readonly { readonly id: string; readonly oz: string;
      readonly kurztext: string }[];
  },
) {
  const f = (name: string): string => `${praefix}-${name}`;
  return (
    <>
      <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
        <div>
          <label className="block text-sm text-text" htmlFor={f('oz')}>Ordnungszahl</label>
          <input id={f('oz')} name="oz" type="text" required placeholder="1.2"
                 defaultValue={zeile?.oz ?? ''} className={FELD} />
          <p className="mt-s1 text-xs text-text-muted">
            Je Fassung eindeutig, solange die Position gilt
            (<code>lkp_oz_uk</code>).
          </p>
        </div>
        <div>
          <label className="block text-sm text-text" htmlFor={f('einheit')}>Einheit</label>
          <input id={f('einheit')} name="einheit" type="text" required
                 placeholder="m², Std., psch"
                 defaultValue={zeile?.einheit ?? ''} className={FELD} />
        </div>
      </div>

      <label className="mt-s4 block text-sm text-text" htmlFor={f('kurztext')}>
        Kurztext
      </label>
      <input id={f('kurztext')} name="kurztext" type="text" required
             defaultValue={zeile?.kurztext ?? ''} className={FELD} />

      <label className="mt-s4 block text-sm text-text" htmlFor={f('langtext')}>
        Langtext
      </label>
      <textarea
        id={f('langtext')}
        name="langtext"
        rows={3}
        defaultValue={zeile?.langtext ?? ''}
        className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
      />
      <p className="mt-s1 text-xs text-text-muted">
        Was der Kunde liest, wenn er fragt, wie der Preis zustande kommt.
      </p>

      <label className="mt-s4 block text-sm text-text" htmlFor={f('parentId')}>
        Untergeordnet zu
      </label>
      <select id={f('parentId')} name="parentId" defaultValue={zeile?.parent_id ?? ''}
              className={FELD}>
        <option value="">— oberste Ebene —</option>
        {auswahl
          /*
           * Die Position selbst steht nicht in ihrer eigenen Auswahl.
           * `kern.pruefe_katalog_hierarchie` weist den Zyklus ohnehin ab und
           * der Dienst uebersetzt ihn — aber ein Feld anzubieten, das immer
           * scheitert, ist kein Angebot.
           */
          .filter((p) => p.id !== zeile?.id)
          .map((p) => (
            <option key={p.id} value={p.id}>{p.oz} · {p.kurztext}</option>
          ))}
      </select>

      <fieldset className="mt-s5 rounded-md border border-line p-s4">
        <legend className="px-s2 text-sm text-text">
          Werte — mindestens einer, offen (O-17, O-731)
        </legend>
        <div className="grid grid-cols-1 gap-s4 sm:grid-cols-3">
          <div>
            <label className="block text-sm text-text" htmlFor={f('zeitwertMinuten')}>
              Zeitwert (Minuten)
            </label>
            <input id={f('zeitwertMinuten')} name="zeitwertMinuten" type="text"
                   inputMode="decimal" placeholder="4,5"
                   defaultValue={deutsch(zeile?.zeitwert_minuten ?? null)}
                   className={FELD} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor={f('leistungswert')}>
              Leistungswert (m²/h)
            </label>
            <input id={f('leistungswert')} name="leistungswert" type="text"
                   inputMode="decimal" placeholder="250"
                   defaultValue={deutsch(zeile?.leistungswert ?? null)}
                   className={FELD} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor={f('standardEinzelpreis')}>
              Standardpreis (€)
            </label>
            <input id={f('standardEinzelpreis')} name="standardEinzelpreis" type="text"
                   inputMode="decimal" placeholder="12,50"
                   defaultValue={euroAus(zeile?.standard_einzelpreis_cent ?? null)}
                   className={FELD} />
          </div>
        </div>
        <p className="mt-s3 max-w-[72ch] text-xs text-text-muted">
          Deutsch geschrieben: <code>12,5</code>. Der Punkt ist der
          Tausendertrenner — <code>12.50</code> wäre mehrdeutig und wird
          als 12,50 gelesen. Geldbeträge werden in ganze Cent gewandelt,
          nie als Fließkommazahl gespeichert (Invariante 1).
        </p>
        <label className="mt-s4 flex items-start gap-s3 text-sm text-text">
          <input type="checkbox" name="bestaetigt" value="ja"
                 defaultChecked={zeile !== null && !zeile.ist_platzhalter}
                 className="mt-s1 min-h-5 min-w-5" />
          <span>
            Diese Werte sind für <strong>diese Fassung</strong> bestätigt.
            Ohne Häkchen trägt die Position <code>ist_platzhalter</code> und
            erscheint überall als unbestätigt. Das Häkchen beantwortet{' '}
            <strong>nicht</strong> O-17 oder O-731 — es sagt „für diese
            Fassung rechnen wir so".
          </span>
        </label>
      </fieldset>

      <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
        <div>
          <label className="block text-sm text-text" htmlFor={f('kostenart')}>
            Kostenart
          </label>
          <select id={f('kostenart')} name="kostenart" defaultValue={zeile?.kostenart ?? ''}
                  className={FELD}>
            <option value="">— keine —</option>
            {KOSTENARTEN.map((k) => (
              <option key={k.wert} value={k.wert}>{k.text}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-text" htmlFor={f('steuerKennzeichen')}>
            Steuerkennzeichen
          </label>
          <select id={f('steuerKennzeichen')} name="steuerKennzeichen"
                  defaultValue={zeile?.steuer_kennzeichen ?? 'regelsatz'} className={FELD}>
            {KENNZEICHEN.map((k) => (
              <option key={k.wert} value={k.wert}>{k.text}</option>
            ))}
          </select>
          <p className="mt-s1 text-xs text-text-muted">
            Vorgabe Regelsatz. Welche Leistung welches Kennzeichen trägt,
            hängt an der Lage des <strong>Kunden</strong>, nicht am Katalog
            — <strong>offen (O-60)</strong>.
          </p>
        </div>
      </div>

      <label className="mt-s4 block text-sm text-text" htmlFor={f('steuerbefreiungGrund')}>
        Norm der Steuerbefreiung
      </label>
      <input id={f('steuerbefreiungGrund')} name="steuerbefreiungGrund" type="text"
             placeholder="nur bei „steuerfrei“ — z. B. § 4 Nr. 12a UStG"
             defaultValue={zeile?.steuerbefreiung_grund ?? ''}
             className={FELD} />
      <p className="mt-s1 text-xs text-text-muted">
        Pflicht bei <code>steuerfrei</code> (<code>lkp_steuerfrei_mit_grund</code>)
        — eine Befreiung ohne genannte Norm ist im Streit mit dem Finanzamt
        nichts.
      </p>

      <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
        <div>
          <label className="block text-sm text-text" htmlFor={f('gueltigAb')}>
            Gültig ab
          </label>
          <input id={f('gueltigAb')} name="gueltigAb" type="date" required
                 defaultValue={zeile?.gueltig_ab_iso ?? berlinKalendertag(new Date())}
                 className={FELD} />
        </div>
        <div>
          <label className="block text-sm text-text" htmlFor={f('sortierung')}>
            Sortierung
          </label>
          <input id={f('sortierung')} name="sortierung" type="number" step="1"
                 defaultValue={String(zeile?.sortierung ?? 0)} className={FELD} />
        </div>
      </div>
    </>
  );
}

/**
 * `numeric` aus Postgres als deutsche Zahl — ohne den Umweg ueber `Number`.
 *
 * Postgres liefert `numeric(10,3)` als Zeichenkette (`"4.500"`). Ein
 * `Number()` dazwischen machte daraus eine Fliesskommazahl, und die
 * Vorbelegung waere nicht mehr der gespeicherte Wert. Getauscht wird nur das
 * Trennzeichen; die nachlaufenden Nullen fallen weg, weil sie in einem
 * Eingabefeld nur Laerm sind und beim Zurueckschreiben ohnehin wieder
 * entstehen.
 */
function deutsch(roh: string | null): string {
  if (roh === null) return '';
  const [ganz, bruch] = roh.split('.');
  const rest = (bruch ?? '').replace(/0+$/u, '');
  return rest === '' ? (ganz ?? '') : `${ganz ?? ''},${rest}`;
}

/**
 * Ganze Cent als deutscher Betrag — ganzzahlig gerechnet (Invariante 1).
 *
 * Kein `/100`: das waere eine Division in Fliesskomma auf einem Betrag.
 * `BigInt` teilt und rest-teilt ganzzahlig, und die zwei Nachkommastellen
 * entstehen aus dem Rest.
 */
function euroAus(roh: string | null): string {
  if (roh === null) return '';
  const cent = BigInt(roh);
  const negativ = cent < 0n;
  const betrag = negativ ? -cent : cent;
  const euro = betrag / 100n;
  const rest = betrag % 100n;
  return `${negativ ? '-' : ''}${String(euro)},${String(rest).padStart(2, '0')}`;
}
