import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  BAUTAG_PILLE, BAUTAG_STATUS_TEXT, WETTER_QUELLE_TEXT,
} from '@/app/portal/[mandant]/bau/bautagebuch-anzeige';
import {
  alsStunden, findeBautagZuDatum, gleicheMannstundenAb, leseMannstunden,
  lesePositionen, leseTagesfotos, listeGewerke, POSITION_ART_TEXT,
  type BautagKopfZeile, type GewerkZeile, type MannstundenAbgleich,
  type MannstundenZeile, type PositionArt, type PositionZeile, type TagesfotoZeile,
} from '@/server/services/bau/bautagebuch';
import { findeEigeneSchicht, type EigeneSchicht }
  from '@/server/services/mitarbeiter/schichten';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../../rahmen';
import { Feld, Felder, Leer } from '../../../bausteine';

/**
 * `/portal/mein/schichten/[zuordnungId]/bautagebuch` — der Bautag der Kolonne
 * (BAU-07, LEG-01, § 34a-Bauart des Wachbuchs auf der Baustelle).
 *
 * **Die Kolonne fuegt AN.** Den Tag schliessen und gegenzeichnen bleibt
 * `bau.schreiben` — das haelt die Rolle `mitarbeiter` nicht, und das ist kein
 * Versehen: „abgeschlossen" heisst, der Auftragnehmer hat den Tag geschlossen,
 * „gegengezeichnet" heisst, die Bauleitung des Auftraggebers hat ihn anerkannt
 * (0082). Beides ist ein anderes Beweisgewicht als eine Eintragung.
 *
 * **Korrigiert wird durch Storno und Ersatzzeile, nie durch Aendern** (BAU-07,
 * LEG-01). Es gibt deshalb hier kein Bearbeitungsfeld an einer bestehenden
 * Zeile; stornierte Zeilen bleiben stehen und tragen den Verweis auf ihre
 * Richtigstellung.
 *
 * **Drei offene Geschaeftsfragen stehen SICHTBAR auf der Seite** statt
 * stillschweigend im Code:
 *
 *  - O-159: welche Gewerke gefuehrt werden. Der Katalog wird LEER ausgeliefert,
 *    und ohne Gewerk gibt es keine Mannstundenzeile — die Seite sagt das, statt
 *    ein Formular anzubieten, das die Datenbank abweist.
 *  - O-281/O-282: der Abgleich vergleicht TAGESSUMMEN gegen
 *    `dauer_netto_minuten` und nicht je Gewerk, weil `zeiteintrag` kein
 *    `gewerk_id` traegt.
 *  - O-280: ab welcher Abweichung ein Befund auffaellig ist. Bis zur Antwort
 *    wird jede Differenz ab einer Minute gemeldet und keine geglaettet.
 *
 * **Der Abgleich zeigt der Kolonne KEINE fremden Zeiten.** `zeiteintrag`
 * verlangt `zeit.lesen`, und `gleicheMannstundenAb` fragt das Recht ZUERST:
 * ohne es gibt es den Befund `zeit_nicht_lesbar` und keine Zahl. Die
 * naheliegende Fassung meldete „100 % Abweichung" an einen Menschen, der nichts
 * falsch gemacht hat.
 */
export const dynamic = 'force-dynamic';

interface Blatt {
  readonly schicht: EigeneSchicht;
  readonly tag: BautagKopfZeile | null;
  readonly mannstunden: readonly MannstundenZeile[];
  readonly positionen: readonly PositionZeile[];
  readonly fotos: readonly TagesfotoZeile[];
  readonly abgleich: MannstundenAbgleich | null;
  readonly gewerke: readonly GewerkZeile[];
}

const ARTEN: readonly PositionArt[] = ['geraet', 'lieferung', 'vorkommnis'];

export default async function MeinBautagebuch(
  { params }: { params: Promise<{ zuordnungId: string }> },
) {
  const { zuordnungId } = await params;
  const ergebnis = await meinPortal<Blatt | null>(
    `/portal/mein/schichten/${zuordnungId}/bautagebuch`,
    async (kontext) => {
      const schicht = await findeEigeneSchicht(kontext, zuordnungId);
      if (schicht === null) return null;
      const leer = {
        schicht, tag: null, mannstunden: [] as const, positionen: [] as const,
        fotos: [] as const, abgleich: null, gewerke: [] as const,
      };
      if (schicht.projektId === null) return leer;

      /*
       * Der Tag wird hier nur GESUCHT, nicht angelegt: eine Seite, die beim
       * Ansehen schreibt, legt bei jedem Vorauslader einen Bautag an. Angelegt
       * wird er mit der ersten Eintragung, ueber die Route.
       */
      const tag = await findeBautagZuDatum(kontext, schicht.projektId, schicht.planDatum);
      const gewerke = await listeGewerke(kontext);
      if (tag === null) return { ...leer, gewerke };

      return {
        schicht,
        tag,
        mannstunden: await leseMannstunden(kontext, tag.id),
        positionen: await lesePositionen(kontext, tag.id),
        fotos: await leseTagesfotos(kontext, tag.id),
        abgleich: await gleicheMannstundenAb(kontext, tag.id),
        gewerke,
      };
    },
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const { schicht, tag, mannstunden, positionen, fotos, abgleich, gewerke } = ergebnis.daten;
  const t = basis.texte;
  const eingabe =
    'min-h-11 w-full rounded-md border border-line-strong bg-surface px-s3 py-s2 '
    + 'text-base text-text';
  const knopf =
    'inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-s5 py-s3 '
    + 'text-base font-semibold text-white hover:bg-brand-hover';
  const offen = tag === null || (tag.status === 'entwurf' && !tag.storniert);
  const artText: Readonly<Record<string, string>> = {
    geraet: t.geraet, lieferung: t.lieferung, vorkommnis: t.vorkommnis,
  };

  return (
    <MeinRahmen basis={basis} titel={t.bautagebuch} aktiverTab="schichten">
      <Link
        href={`/portal/mein/schichten/${zuordnungId}`}
        className="mb-s4 inline-block min-h-11 text-base text-text underline"
      >
        ← {t.schichten}
      </Link>

      <h1 className="mb-s2 text-h1 text-text">{t.bautagebuch}</h1>
      <p className="mb-s5 text-base text-text-muted">
        {schicht.objekt ?? '—'} · <span className="cse-zahl">{schicht.planDatum}</span>
      </p>

      {schicht.projektId === null ? (
        /*
         * Keine Baustelle, kein Bautagebuch. Das ist kein Fehler — eine
         * Reinigungsschicht traegt kein Projekt, und ein leeres Formular
         * hier waere die Behauptung, es gehoere eins dazu.
         */
        <Leer text={t.keineEintraege} />
      ) : (
        <>
          {tag !== null && (
            <section
              className="mb-s6 rounded-lg border border-line bg-surface p-s4"
              data-cse="bautag"
            >
              <div className="mb-s3 flex flex-wrap items-center gap-s3">
                <StatusPill zustand={BAUTAG_PILLE[tag.status] ?? 'Entwurf'} />
                <span className="text-sm text-text-muted">
                  {BAUTAG_STATUS_TEXT[tag.status] ?? tag.status}
                </span>
              </div>
              <Felder>
                <Feld label={t.datum}>
                  <span className="cse-zahl">{tag.datum_lokal}</span>
                </Feld>
                <Feld label={t.objekt}>{tag.projekt}</Feld>
                <Feld label={t.beginn}>
                  <span className="cse-zahl">{tag.arbeitsbeginn_lokal ?? '—'}</span>
                </Feld>
                <Feld label={t.ende}>
                  <span className="cse-zahl">{tag.arbeitsende_lokal ?? '—'}</span>
                </Feld>
                <Feld label={t.status}>
                  {WETTER_QUELLE_TEXT[tag.wetter_quelle] ?? tag.wetter_quelle}
                </Feld>
              </Felder>
              {!offen && (
                <p className="mt-s3 m-0 text-base text-warning" data-cse="tag-geschlossen">
                  {t.tagGeschlossen}
                </p>
              )}
            </section>
          )}

          <section className="mb-s6" data-cse="mannstunden">
            <h2 className="mb-s3 text-h2 text-text">{t.mannstunden}</h2>
            {mannstunden.length === 0 ? <Leer text={t.keineEintraege} /> : (
              <ul className="m-0 flex list-none flex-col gap-s3 p-0">
                {mannstunden.map((m) => (
                  <li
                    key={m.id}
                    data-cse="mannstunden-zeile"
                    className="rounded-lg border border-line bg-surface p-s4"
                  >
                    <div className="mb-s3 flex flex-wrap items-center gap-s3">
                      <StatusPill zustand={m.storniert ? 'Archiviert' : 'Abgeschlossen'} />
                      <span className="text-sm text-text-muted">
                        {m.gewerk_code} · {m.gewerk}
                      </span>
                    </div>
                    <Felder>
                      <Feld label={t.anzahlPersonen}>
                        <span className="cse-zahl">{m.anzahl_personen}</span>
                      </Feld>
                      <Feld label={t.dauer}>
                        <span className="cse-zahl">{alsStunden(m.dauer_minuten)}</span> h
                      </Feld>
                      <Feld label={t.bezeichnung}>{m.taetigkeit ?? '—'}</Feld>
                      <Feld label={t.erfasstAm}>
                        <span className="cse-zahl">{m.erfasst_lokal}</span>
                      </Feld>
                      {m.storniert && (
                        <Feld label={t.entscheidung}>{m.storno_grund ?? '—'}</Feld>
                      )}
                    </Felder>
                  </li>
                ))}
              </ul>
            )}

            {offen && (
              gewerke.length === 0 ? (
                /*
                 * Regel 1 auf dem Bildschirm: der Gewerkekatalog wird leer
                 * ausgeliefert, bis feststeht, welche Gewerke gefuehrt werden.
                 * Ohne Gewerk nimmt `bautagebuch_mannstunden` keine Zeile an —
                 * ein Formular hier waere ein Knopf, den die Datenbank abweist.
                 */
                <p data-cse="gewerke-offen" className="mt-s4 max-w-prose text-base text-warning">
                  {t.gewerk}: {t.offeneFrage} (O-159)
                </p>
              ) : (
                <form
                  method="post"
                  action={`/api/mein/schichten/${zuordnungId}/bautagebuch/mannstunden`}
                  className="mt-s5 flex max-w-prose flex-col gap-s4"
                >
                  <input
                    type="hidden"
                    name="zurueck"
                    value={`/portal/mein/schichten/${zuordnungId}/bautagebuch`}
                  />
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="bt-gewerk" className="text-base text-text">
                      {t.gewerk} <span aria-hidden="true">*</span>
                      <span className="sr-only">{t.pflichtfeld}</span>
                    </label>
                    <select id="bt-gewerk" name="gewerk" required className={eingabe}>
                      {gewerke.map((g) => (
                        <option key={g.id} value={g.id}>{g.code} · {g.bezeichnung}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-s3 sm:grid-cols-2">
                    <div className="flex flex-col gap-s2">
                      <label htmlFor="bt-personen" className="text-base text-text">
                        {t.anzahlPersonen} <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="bt-personen" name="personen" type="number" min="1" step="1"
                        required className={eingabe}
                      />
                    </div>
                    <div className="flex flex-col gap-s2">
                      <label htmlFor="bt-minuten" className="text-base text-text">
                        {t.dauer} (min) <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="bt-minuten" name="minuten" type="number" min="0" max="1440"
                        step="1" required className={eingabe}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="bt-taetigkeit" className="text-base text-text">
                      {t.bezeichnung}
                    </label>
                    <input id="bt-taetigkeit" name="taetigkeit" className={eingabe} />
                  </div>
                  <button type="submit" className={knopf}>{t.hinzufuegen}</button>
                </form>
              )
            )}
          </section>

          <section className="mb-s6" data-cse="bautag-positionen">
            <h2 className="mb-s3 text-h2 text-text">
              {t.geraet} · {t.lieferung} · {t.vorkommnis}
            </h2>
            {positionen.length === 0 ? <Leer text={t.keineEintraege} /> : (
              <ul className="m-0 flex list-none flex-col gap-s3 p-0">
                {positionen.map((q) => (
                  <li
                    key={q.id}
                    data-cse="bautag-position"
                    className="rounded-lg border border-line bg-surface p-s4"
                  >
                    <div className="mb-s3 flex flex-wrap items-center gap-s3">
                      <StatusPill zustand={q.storniert ? 'Archiviert' : 'Abgeschlossen'} />
                      <span className="text-sm text-text-muted">
                        {artText[q.art] ?? POSITION_ART_TEXT[q.art]}
                      </span>
                    </div>
                    <Felder>
                      <Feld label={t.bezeichnung}>{q.bezeichnung}</Feld>
                      <Feld label={t.menge}>
                        <span className="cse-zahl">{q.menge ?? '—'}</span>{' '}
                        {q.einheit ?? ''}
                      </Feld>
                      <Feld label={t.eintragstext}>{q.beschreibung ?? '—'}</Feld>
                      <Feld label={t.erfasstAm}>
                        <span className="cse-zahl">{q.erfasst_lokal}</span>
                      </Feld>
                    </Felder>
                  </li>
                ))}
              </ul>
            )}

            {offen && (
              <form
                method="post"
                action={`/api/mein/schichten/${zuordnungId}/bautagebuch/position`}
                className="mt-s5 flex max-w-prose flex-col gap-s4"
              >
                <input
                  type="hidden"
                  name="zurueck"
                  value={`/portal/mein/schichten/${zuordnungId}/bautagebuch`}
                />
                <div className="flex flex-col gap-s2">
                  <label htmlFor="bp-art" className="text-base text-text">
                    {t.art} <span aria-hidden="true">*</span>
                    <span className="sr-only">{t.pflichtfeld}</span>
                  </label>
                  <select id="bp-art" name="art" required className={eingabe}>
                    {ARTEN.map((a) => (
                      <option key={a} value={a}>{artText[a]}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-s2">
                  <label htmlFor="bp-bez" className="text-base text-text">
                    {t.bezeichnung} <span aria-hidden="true">*</span>
                    <span className="sr-only">{t.pflichtfeld}</span>
                  </label>
                  <input id="bp-bez" name="bezeichnung" required className={eingabe} />
                </div>
                <div className="grid gap-s3 sm:grid-cols-2">
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="bp-menge" className="text-base text-text">{t.menge}</label>
                    <input id="bp-menge" name="menge" inputMode="decimal" className={eingabe} />
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="bp-einheit" className="text-base text-text">{t.einheit}</label>
                    <input id="bp-einheit" name="einheit" className={eingabe} />
                  </div>
                </div>
                <div className="flex flex-col gap-s2">
                  <label htmlFor="bp-text" className="text-base text-text">
                    {t.eintragstext}
                  </label>
                  <textarea id="bp-text" name="beschreibung" rows={3} className={eingabe} />
                </div>
                <button type="submit" className={knopf}>{t.hinzufuegen}</button>
              </form>
            )}
          </section>

          {fotos.length > 0 && (
            <section className="mb-s6" data-cse="tagesfotos">
              <h2 className="mb-s3 text-h2 text-text">{t.fotos}</h2>
              <ul className="m-0 flex list-none flex-col gap-s2 p-0">
                {fotos.map((f) => (
                  <li key={f.id} className="text-base text-text">
                    <span className="cse-zahl">{f.erfasst_lokal}</span>
                    {' · '}
                    {f.beschreibung ?? f.mime_typ}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {abgleich !== null && (
            <section data-cse="abgleich" className="rounded-lg border border-line bg-surface-2 p-s4">
              <h2 className="mb-s3 text-h3 text-text">{t.abgleich}</h2>
              {/*
                Der Satz kommt aus dem Dienst und ist nie leer — er sagt auch,
                WARUM es keinen Befund gibt (`zeit_nicht_lesbar`). Eine Zahl
                ohne diesen Satz waere im Mitarbeiterportal regelmaessig eine
                Falschmeldung.
              */}
              <p className="m-0 mb-s3 max-w-prose text-base text-text">{abgleich.text}</p>
              <Felder>
                <Feld label={t.mannstunden}>
                  <span className="cse-zahl">
                    {alsStunden(abgleich.tagebuchEigenMinuten)}
                  </span> h
                </Feld>
                <Feld label={t.zeiten}>
                  <span className="cse-zahl">
                    {abgleich.befund === 'zeit_nicht_lesbar'
                      ? '—' : alsStunden(abgleich.zeiteintragMinuten)}
                  </span>
                  {abgleich.befund === 'zeit_nicht_lesbar' ? '' : ' h'}
                </Feld>
              </Felder>
              <p className="mt-s3 m-0 max-w-prose text-sm text-text-subtle">
                {t.offeneFrage}: O-280 · O-281 · O-282
              </p>
            </section>
          )}
        </>
      )}
    </MeinRahmen>
  );
}
