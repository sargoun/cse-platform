import { Geraetezeit } from '../../../Geraetezeit';
import { tagInSprache } from '@/lib/datum/kalendertag';
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
import { Feld, Felder, Hinweis, Leer } from '../../../bausteine';
import { FormularFehler } from '../../../FormularAntwort';

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
  { params, searchParams }: {
    params: Promise<{ zuordnungId: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { zuordnungId } = await params;
  /* Der Grund einer Abweisung, zurückgeschickt von der Route (V-198, D-692). */
  const fehler = (await searchParams)['fehler'];
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
  /*
   * Warum hier kein Formular mehr steht — und nicht: warum es scheitert.
   *
   * `einsatz_zuordnung.t_selbst_m1` (0300) verlangt `entfernt_am is null`, und
   * `app.ist_eingesetzt_auf_objekt` verlangt `ende_zeitpunkt >= now()` (0004).
   * Nach Schichtende und nach dem Herausnehmen aus dem Plan endet jeder
   * Schreibweg mit `404 nicht_gefunden` — eine Seite, die trotzdem zum
   * Ausfuellen einlaedt, behandelt den Menschen danach wie einen Fremden.
   */
  const sperre = schicht.entfernt ? t.schichtEntfernt
    : schicht.beendet ? t.schichtBeendet : null;
  const eingabe =
    'min-h-11 w-full rounded-md border border-line-strong bg-surface px-s3 py-s2 '
    + 'text-base text-text';

  return (
    <MeinRahmen basis={basis} titel={t.wachbuch} aktiverTab="schichten"
      zurueck={{ ziel: `/portal/mein/schichten/${zuordnungId}`, text: t.schichten }}
    >

      <h1 className="mb-s2 text-h1 text-text">{t.wachbuch}</h1>
      <p className="mb-s5 text-base text-text-muted">
        {schicht.objekt ?? '—'} · <span className="cse-zahl">{tagInSprache(schicht.planDatum, basis.sprache)}</span>
      </p>

      <FormularFehler sprache={basis.sprache} grund={fehler} />

      {schicht.objektId === null ? (
        <Leer text={t.keineEintraege} />
      ) : (
        <>
          <section className="mb-s6" data-cse="schichtbuch">
            <h2 className="mb-s3 text-h2 text-text">{t.uebergabe}</h2>
            {buch !== null && !buch.uebergabeOffen && (
              /*
                Der ehrliche Satz statt einer leeren Liste — und ZWEI Saetze,
                nicht einer: `uebergabeFenster === null` heisst „nie
                eingerichtet" (O-151 ist offen), `00:00:00` heisst
                „eingerichtet und abgeschaltet" (der Seed-Vorgabewert aus
                0033). Ein Satz fuer beide behauptete auf jedem
                Seed-Bildschirm etwas, das dort nicht stimmt.
              */
              <p data-cse="uebergabe-zu" className="mb-s3 max-w-prose text-base text-warning">
                {buch.uebergabeFenster === null
                  ? t.uebergabeNichtEingestellt
                  : t.uebergabeAus}
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
                      <StatusPill sprache={basis.sprache}
                        zustand={e.storniert ? 'Archiviert'
                          : e.art === 'alarm' ? 'Fehler' : 'Abgeschlossen'}
                      />
                      <span className="text-sm text-text-muted">
                        {arten[e.art as WachbuchArtSchluessel] ?? '—'}
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
            {sperre !== null ? <Hinweis text={sperre} marke="erfassung-zu" /> : (
            <>
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

              {/*
                Der Praesenznachweis (SEC-05): ein Eintrag AN einem
                Kontrollpunkt. Das Feld erscheint nur, wenn dieses Objekt
                ueberhaupt Kontrollpunkte fuehrt — eine leere Auswahlliste
                waere die Behauptung, es gaebe welche. Und „Praesenz
                bestaetigt" steht NUR daneben: `pruefeText` weist die Marke
                ohne Kontrollpunkt ab, also darf der Bildschirm sie ohne
                Kontrollpunkt gar nicht erst anbieten.
              */}
              {buch !== null && buch.kontrollpunkte.length > 0 && (
                <>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="wb-kp" className="text-base text-text">
                      {t.kontrollpunkt}
                    </label>
                    <select id="wb-kp" name="kontrollpunkt" className={eingabe}>
                      <option value="">—</option>
                      {buch.kontrollpunkte.map((k) => (
                        <option key={k.id} value={k.id}>{k.bezeichnung}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex min-h-11 items-center gap-s3 text-base text-text">
                    <input type="checkbox" name="praesenz" value="ja"
                           className="min-h-11 min-w-11 shrink-0" />
                    {t.praesenz}
                  </label>
                </>
              )}

              <label className="flex min-h-11 items-center gap-s3 text-base text-text">
                <input type="checkbox" name="polizei" value="ja"
                       className="min-h-11 min-w-11 shrink-0" />
                {t.polizei}
              </label>

              {/*
                * **Nachgetragen** (V-078, TIM-09).
                *
                * `wachbuch_eintrag.nachgetragen` steht seit `0070` da, der
                * Dienst nimmt es entgegen, die Route reicht es durch, und
                * ZWEI Seiten zeigen „· nachgetragen" an — geschickt hat es
                * nie ein Formular. Was auf dem Bildschirm stand, war also nie
                * die Aussage eines Menschen, sondern der Vorgabewert der
                * Spalte.
                *
                * **Das ist KEINE Uhrabweichung**, und die Spalte sagt das
                * ausdrücklich: „wer beides in eine Spalte legt, kann eine um
                * 14:00 verfasste und um 22:00 uebertragene Seite nicht mehr
                * von einer um 22:00 verfassten unterscheiden". Die Abweichung
                * misst die Gerätezeit; DIESES Häkchen ist die Aussage der
                * Wache, dass der Vorgang früher geschehen ist — aus dem Buch
                * am Objekt, nach der Schicht getippt.
                */}
              <label className="flex min-h-11 items-start gap-s3 text-base text-text">
                <input type="checkbox" name="nachgetragen" value="1"
                       className="min-h-11 min-w-11 shrink-0"
                       data-cse="wachbuch-nachgetragen" />
                <span>
                  {t.nachgetragen}
                  <span className="mt-s1 block text-base text-text-muted">
                    {t.nachgetragenHinweis}
                  </span>
                </span>
              </label>

              {/*
                Die Geraetezeit als BEHAUPTUNG (TIM-08). Sie ist versteckt, weil
                sie niemand tippt — und sie ist NICHT massgeblich: `erfasst_am`
                stempelt die Datenbank mit `now()` (Invariante 5), und die
                Abweichung leitet derselbe Ausloeser ab.
                Ohne JavaScript bleibt das Feld leer; dann steht in der Zeile
                keine Geraetezeit — richtig, denn behauptet hat niemand etwas.
              */}
              <Geraetezeit marke="geraetezeit" />

              <button
                type="submit"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand
                           px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
              >
                {t.absenden}
              </button>
            </form>
            </>
            )}
          </section>
        </>
      )}
    </MeinRahmen>
  );
}
