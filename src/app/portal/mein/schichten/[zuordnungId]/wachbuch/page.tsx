import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  WACHBUCH_ART_TEXTE, type WachbuchArtSchluessel,
} from '@/lib/i18n/texte';
import { findeEigeneSchicht, type EigeneSchicht }
  from '@/server/services/mitarbeiter/schichten';
import { leseSchichtbuch, type Schichtbuch }
  from '@/server/services/mitarbeiter/schichtbuch';
import { findeSchichtBezug } from '@/server/services/mitarbeiter/schicht-zugang';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../../rahmen';
import { Feld, Felder, Leer } from '../../../bausteine';

/**
 * `/portal/mein/schichten/[zuordnungId]/wachbuch` — das Buch auf der Schicht
 * (SEC-05, TIM-08, TIM-10, LEG-01, § 34a GewO).
 *
 * **Zuerst lesen, dann schreiben.** Oben steht, was an DIESEM Objekt zu sehen
 * ist: die eigenen Seiten immer, die Uebergabe der vorigen Schicht nur im
 * eingestellten Fenster (0302). Ist das Fenster nicht eingestellt, sagt die
 * Seite das ALS SATZ — „keine Eintraege" waere an dieser Stelle eine
 * Falschaussage ueber eine offene Geschaeftsfrage (O-151).
 *
 * **Der Eintrag ist ANFUEGBAR und nie aenderbar** (0070, § 34a GewO). Es gibt
 * hier deshalb kein Bearbeitungsfeld und keinen Loeschknopf; eine
 * Richtigstellung ist ein NEUER Eintrag, und beide bleiben lesbar. Nummer,
 * Serverzeit und Kettenglied kommen aus der Datenbank — der Dienst schickt sie
 * nicht einmal mit.
 *
 * **Die Serveruhr gilt** (Invariante 5, TIM-08). Das Formular schickt die
 * Geraetezeit als BEHAUPTUNG mit; `zeitabweichung_sek` wird daraus abgeleitet
 * und steht an der Zeile. Ein Telefon im Keller geht vor oder nach, und die
 * Plattform dokumentiert das, statt es wegzurechnen.
 *
 * **Ein echtes `<form method="post">`** ohne JavaScript: die Geraete sind alte
 * Diensttelefone im Treppenhaus (SEITENKARTE §13).
 *
 * **Kein Foto am Eintrag.** SEC-05 nennt Bilder; sie haengen an
 * `einsatz_medien`, und der Bezug, den diese Schicht traegt, ist ihr `einsatz`
 * — die Aufnahme geht deshalb ueber `/fotos` derselben Schicht und steht in
 * derselben Beweiskette. Ein zweiter Uploadweg mit einem zweiten Bezug waere
 * eine zweite Stelle, an der dasselbe Bild liegt.
 */
export const dynamic = 'force-dynamic';

interface Blatt {
  readonly schicht: EigeneSchicht;
  readonly buch: Schichtbuch | null;
}

/** Die vier Arten, die der Dienst heute annimmt. */
const ARTEN: readonly WachbuchArtSchluessel[] = [
  'rundgang', 'vorkommnis', 'uebergabe', 'alarm',
];

export default async function MeinWachbuch(
  { params }: { params: Promise<{ zuordnungId: string }> },
) {
  const { zuordnungId } = await params;
  const ergebnis = await meinPortal<Blatt | null>(
    `/portal/mein/schichten/${zuordnungId}/wachbuch`,
    async (kontext) => {
      const schicht = await findeEigeneSchicht(kontext, zuordnungId);
      if (schicht === null) return null;
      /*
       * Ohne Objekt gibt es kein Buch: das Wachbuch ist nach § 34a GewO das
       * Buch EINER Liegenschaft, nicht das einer Person.
       */
      const bezug = await findeSchichtBezug(kontext, zuordnungId);
      const buch = schicht.objektId === null || bezug === null ? null
        : await leseSchichtbuch(kontext, {
          objektId: schicht.objektId, mandantId: bezug.mandantId,
        });
      return { schicht, buch };
    },
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const { schicht, buch } = ergebnis.daten;
  const t = basis.texte;
  const arten = WACHBUCH_ART_TEXTE[basis.sprache];
  const eingabe =
    'min-h-11 w-full rounded-md border border-line-strong bg-surface px-s3 py-s2 '
    + 'text-base text-text';

  return (
    <MeinRahmen basis={basis} titel={t.wachbuch} aktiverTab="schichten">
      <Link
        href={`/portal/mein/schichten/${zuordnungId}`}
        className="mb-s4 inline-block min-h-11 text-base text-text underline"
      >
        ← {t.schichten}
      </Link>

      <h1 className="mb-s2 text-h1 text-text">{t.wachbuch}</h1>
      <p className="mb-s5 text-base text-text-muted">
        {schicht.objekt ?? '—'} · <span className="cse-zahl">{schicht.planDatum}</span>
      </p>

      {schicht.objektId === null ? (
        <Leer text={t.keineEintraege} />
      ) : (
        <>
          <section className="mb-s6" data-cse="schichtbuch">
            <h2 className="mb-s3 text-h2 text-text">{t.uebergabe}</h2>
            {buch !== null && !buch.uebergabeOffen && (
              /*
                Der ehrliche Satz statt einer leeren Liste: das Fenster ist
                nicht eingestellt, also steht hier nur das Eigene (O-151).
              */
              <p data-cse="uebergabe-zu" className="mb-s3 max-w-prose text-base text-warning">
                {t.uebergabeZu}
              </p>
            )}
            {buch === null || buch.eintraege.length === 0 ? (
              <Leer text={t.keineEintraege} />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-s3 p-0">
                {buch.eintraege.map((e) => (
                  <li
                    key={e.id}
                    data-cse="wachbuch-eintrag"
                    className="rounded-lg border border-line bg-surface p-s4"
                  >
                    <div className="mb-s3 flex flex-wrap items-center gap-s3">
                      <span className="cse-zahl text-sm text-text-subtle">{e.nummer}</span>
                      <StatusPill
                        zustand={e.storniert ? 'Archiviert'
                          : e.art === 'alarm' ? 'Fehler' : 'Abgeschlossen'}
                      />
                      <span className="text-sm text-text-muted">
                        {arten[e.art as WachbuchArtSchluessel] ?? e.art}
                      </span>
                    </div>
                    <Felder>
                      <Feld label={t.betreff}>{e.betreff}</Feld>
                      <Feld label={t.eintragstext}>{e.eintragstext}</Feld>
                      <Feld label={t.erfasstAm}>
                        <span className="cse-zahl">{e.erfasstLokal}</span>
                      </Feld>
                      <Feld label={t.abweichung}>
                        <span className="cse-zahl">
                          {e.zeitabweichungSek === null
                            ? '—' : `${String(e.zeitabweichungSek)} s`}
                        </span>
                      </Feld>
                      {e.storniert && (
                        <Feld label={t.entscheidung}>{e.stornoGrund ?? '—'}</Feld>
                      )}
                    </Felder>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section data-cse="wachbuch-formular">
            <h2 className="mb-s3 text-h2 text-text">{t.wachbuchNeu}</h2>
            <p className="mb-s4 max-w-prose text-base text-text-muted">
              {t.unveraenderlich}
            </p>
            <form
              method="post"
              action={`/api/mein/schichten/${zuordnungId}/wachbuch`}
              className="flex max-w-prose flex-col gap-s4"
            >
              <input
                type="hidden"
                name="zurueck"
                value={`/portal/mein/schichten/${zuordnungId}/wachbuch`}
              />

              <div className="flex flex-col gap-s2">
                <label htmlFor="wb-art" className="text-base text-text">
                  {t.art} <span aria-hidden="true">*</span>
                  <span className="sr-only">{t.pflichtfeld}</span>
                </label>
                <select id="wb-art" name="art" required className={eingabe}>
                  {ARTEN.map((a) => (
                    <option key={a} value={a}>{arten[a]}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-s2">
                <label htmlFor="wb-betreff" className="text-base text-text">
                  {t.betreff} <span aria-hidden="true">*</span>
                  <span className="sr-only">{t.pflichtfeld}</span>
                </label>
                <input id="wb-betreff" name="betreff" required className={eingabe} />
              </div>

              <div className="flex flex-col gap-s2">
                <label htmlFor="wb-text" className="text-base text-text">
                  {t.eintragstext} <span aria-hidden="true">*</span>
                  <span className="sr-only">{t.pflichtfeld}</span>
                </label>
                <textarea id="wb-text" name="eintragstext" rows={4} required className={eingabe} />
              </div>

              <label className="flex min-h-11 items-center gap-s3 text-base text-text">
                <input type="checkbox" name="polizei" value="ja" />
                {t.polizei}
              </label>

              {/*
                Die Geraetezeit als BEHAUPTUNG (TIM-08). Sie ist versteckt, weil
                sie niemand tippt — und sie ist NICHT massgeblich: `erfasst_am`
                stempelt die Datenbank mit `now()` (Invariante 5), und die
                Abweichung leitet derselbe Ausloeser ab.
                Ohne JavaScript bleibt das Feld leer; dann steht in der Zeile
                keine Geraetezeit — richtig, denn behauptet hat niemand etwas.
              */}
              <input type="hidden" name="geraete_zeit" value="" data-cse="geraetezeit" />

              <button
                type="submit"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand
                           px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
              >
                {t.absenden}
              </button>
            </form>
          </section>
        </>
      )}
    </MeinRahmen>
  );
}
