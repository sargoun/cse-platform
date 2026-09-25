import { listeEigeneEinwaende, type EinwandZeile }
  from '@/server/services/zeit/einwand';
import { berlinHeute } from '@/server/db/heute';
import { EINWAND_FORM_TEXTE } from '@/lib/i18n/mein-formulare';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { vorbelegt } from '@/lib/formular/maske';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Abgewiesen, EinwandListe, Leer } from '../../bausteine';

/**
 * `/portal/mein/zeiten/einwand` — „Eine Zeit fehlt": der Einwand OHNE
 * Zeiteintrag (EMP-07, TIM-11, V-189).
 *
 * **Der Befund, der diese Seite gebaut hat.** `zeit_einwand.zeiteintrag_id`
 * ist fuer genau diesen Fall nullbar (0052: „ich habe gearbeitet, es steht
 * nichts da" — Einstempeln vergessen, Marke gescheitert), und V-067 hat auf
 * der Planerseite den Zweig `e.eintrag === null` samt „Zeit nacherfassen"
 * gebaut. Das einzige Formular der Arbeiterin lag aber unter
 * `/portal/mein/zeiten/[id]/einwand`, antwortete ohne Eintrag mit 404 und
 * schickte die Kennung des Eintrags immer mit. Wer KEINEN Eintrag hatte — der
 * haeufigste Fall im Lohnstreit —, hatte keinen Weg zum Widerspruch.
 *
 * **Was hier entsteht, aendert keine Zeit.** Es ist ein Vorgang mit Art
 * `eintrag_fehlt`, der BEHAUPTETEN Zeit (nie ein massgeblicher Zeitpunkt,
 * Invariante 5) und einer Begruendung; die Planung entscheidet und traegt
 * nach. Der Weg ist dieselbe Route `POST /api/zeit/einwand` wie beim Einwand
 * zu einem Eintrag: Mandant aus der Beschaeftigung (K-02), `withTenant` neu
 * betreten (K-18), bewacht von `t_selbst_einreichen`.
 *
 * **Die Beschaeftigung ist eine Pflichtwahl** — eine geratene waere ein
 * Einwand bei der falschen GmbH (D-09). Tag und Beschaeftigung lassen sich
 * vorbelegen (`?datum=`, `?anstellung=`): so verlinkt das Blatt einer
 * vergangenen Schicht ohne Eintrag hierher. Vorbelegt wird nur, was die Seite
 * anbietet (D-733 Nr. 4).
 *
 * Ein echtes `<form method="post">`, ohne JavaScript (SEITENKARTE §13).
 */
export const dynamic = 'force-dynamic';

const MASKE = '/portal/mein/zeiten/einwand';

interface Daten {
  readonly ohneEintrag: readonly EinwandZeile[];
}

export default async function EintragFehlt(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const suche = await searchParams;
  const ergebnis = await meinPortal<Daten>(MASKE, async (kontext) => ({
    ohneEintrag: (await listeEigeneEinwaende(kontext)).filter((e) => e.zeiteintragId === null),
  }));
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const ft = EINWAND_FORM_TEXTE[basis.sprache];
  // Der Berliner Tag kommt aus der Datenbank (Invariante 5) — siehe `@/server/db/heute`.
  const heute = await berlinHeute();
  const eingabe =
    'min-h-11 w-full rounded-md border border-line-strong bg-surface px-s3 py-s2 '
    + 'text-base text-text';

  const fehler = vorbelegt(suche, 'fehler');
  const satz = fehler === undefined ? null : (eigenerEintrag(ft.gruende, fehler) ?? ft.unbekannt);
  const anstellung = vorbelegt(suche, 'anstellung');
  const gewaehlt = anstellung !== undefined
    && basis.anstellungen.some((a) => a.anstellungId === anstellung) ? anstellung : undefined;
  const datumRoh = vorbelegt(suche, 'datum');
  const datum = datumRoh !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(datumRoh)
    && datumRoh <= heute ? datumRoh : undefined;
  const uhrzeit = (feld: string): string | undefined => {
    const wert = vorbelegt(suche, feld);
    return wert !== undefined && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(wert) ? wert : undefined;
  };
  const pauseRoh = vorbelegt(suche, 'pause');
  const pause = pauseRoh !== undefined && /^\d{1,4}$/u.test(pauseRoh) ? pauseRoh : undefined;

  return (
    <MeinRahmen basis={basis} titel={ft.titel} aktiverTab="stunden"
      zurueck={{ ziel: '/portal/mein/zeiten', text: t.zeiten }}
    >
      <h1 className="mb-s4 text-h1 text-text">{ft.titel}</h1>
      <p className="mb-s5 max-w-prose text-base text-text-muted">{ft.erklaerung}</p>

      {satz !== null && (
        <Abgewiesen marke="eintrag-fehlt-abgewiesen" titel={ft.nichtGesendet} text={satz}
          zusatz={vorbelegt(suche, 'begruendung_neu') === 'ja' ? ft.begruendungErneut : null} />
      )}
      {satz === null && vorbelegt(suche, 'gemeldet') === '1' && (
        <p role="status" data-cse="eintrag-fehlt-gemeldet"
           className="mb-s4 max-w-prose rounded-lg border border-success bg-success-soft p-s4 text-base text-text">
          {ft.gemeldet}
        </p>
      )}

      {basis.anstellungen.length === 0 ? <Leer text={t.keineEintraege} /> : (
        <form
          method="post"
          action="/api/zeit/einwand"
          data-cse="eintrag-fehlt-formular"
          className="flex max-w-prose flex-col gap-s4"
        >
          {/*
            Die Art steht fest, und es reist KEIN `zeiteintrag` mit — genau
            das ist der Fall, fuer den `zeiteintrag_id` nullbar ist
            (`ze_bezug_ausser_eintrag_fehlt`, 0052).
          */}
          <input type="hidden" name="art" value="eintrag_fehlt" />
          <input type="hidden" name="maske" value={MASKE} />
          <input type="hidden" name="zurueck" value={MASKE} />

          <div className="flex flex-col gap-s2">
            <label htmlFor="fehlt-anstellung" className="text-base text-text">
              {t.gesellschaft} <span aria-hidden="true">*</span>
              <span className="sr-only">{t.pflichtfeld}</span>
            </label>
            <select id="fehlt-anstellung" name="anstellung" required className={eingabe}
              defaultValue={gewaehlt}>
              {basis.anstellungen.map((a) => (
                <option key={a.anstellungId} value={a.anstellungId}>
                  {a.mandantName}
                  {a.personalnummer === null ? '' : ` · ${a.personalnummer}`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-s2">
            <label htmlFor="fehlt-datum" className="text-base text-text">
              {t.datum} <span aria-hidden="true">*</span>
              <span className="sr-only">{t.pflichtfeld}</span>
            </label>
            <input id="fehlt-datum" name="datum" type="date" required max={heute}
              className={eingabe} defaultValue={datum} />
          </div>

          <fieldset className="m-0 flex flex-col gap-s3 border-0 p-0">
            <legend className="mb-s1 p-0 text-base text-text">{ft.wannGearbeitet}</legend>
            <div className="grid gap-s4 sm:grid-cols-2">
              <div className="flex flex-col gap-s2">
                <label htmlFor="fehlt-beginn" className="text-base text-text">{t.beginn}</label>
                <input id="fehlt-beginn" name="beginn" type="datetime-local"
                  className={eingabe} defaultValue={uhrzeit('beginn')} />
              </div>
              <div className="flex flex-col gap-s2">
                <label htmlFor="fehlt-ende" className="text-base text-text">{t.ende}</label>
                <input id="fehlt-ende" name="ende" type="datetime-local"
                  className={eingabe} defaultValue={uhrzeit('ende')} />
              </div>
            </div>
            <div className="flex flex-col gap-s2">
              <label htmlFor="fehlt-pause" className="text-base text-text">{t.pause} (min)</label>
              <input id="fehlt-pause" name="pause" type="number" min={0} step={1}
                inputMode="numeric" className={eingabe} defaultValue={pause} />
            </div>
          </fieldset>

          <div className="flex flex-col gap-s2">
            <label htmlFor="fehlt-begruendung" className="text-base text-text">
              {t.einwandBegruendung} <span aria-hidden="true">*</span>
              <span className="sr-only">{t.pflichtfeld}</span>
            </label>
            <textarea id="fehlt-begruendung" name="begruendung" required rows={4}
              className={eingabe} />
          </div>

          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand
                       px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
          >
            {t.absenden}
          </button>
        </form>
      )}

      <section className="mt-s6">
        <h2 className="mb-s3 text-h3 text-text">{ft.ohneEintragGemeldet}</h2>
        <EinwandListe einwaende={daten.ohneEintrag} texte={t} sprache={basis.sprache} />
      </section>
    </MeinRahmen>
  );
}
