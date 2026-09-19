import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import {
  BESTAETIGUNGSTEXT, bereiteUnterschriftVor, type Unterschriftsvorschau,
} from '@/server/services/reinigung/leistungsnachweis';
import { findeEigeneSchicht, type EigeneSchicht }
  from '@/server/services/mitarbeiter/schichten';
import {
  listeSchichtNachweise, type SchichtNachweis,
} from '@/server/services/mitarbeiter/nachweis-schicht';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../../rahmen';
import { Feld, Felder, Hinweis, Leer } from '../../../bausteine';

/**
 * `/portal/mein/schichten/[zuordnungId]/leistungsnachweis` — der Nachweis auf
 * der Schicht, den der Kunde unterschreibt (CLN-04, FIN-05, TIM-08, LEG-01).
 *
 * **Zwei Schritte, und dass es zwei sind, ist die Zusage** (0066): erst wird
 * der Abzug gebaut, den der Kunde SIEHT, und sein Digest festgehalten; dann
 * wird unterschrieben, der Abzug NEU gebaut und gegen den mitgereisten Digest
 * gehalten. Zwischen dem Aufbau des Bildschirms und dem Fingerdruck liegen
 * Minuten, in denen das Buero eine Zeile korrigieren kann — ohne die Pruefsumme
 * unterschriebe der Kunde unter etwas, das er nicht gesehen hat.
 *
 * **Der Bestaetigungstext bleibt DEUTSCH.** Die Bedienoberflaeche ist
 * vierprachig (EMP-12); dieser Satz ist es nicht. Er ist die Erklaerung, an die
 * die Gesellschaft gebunden ist, und eine uebersetzte Fassung daneben waere
 * eine zweite Erklaerung mit moeglicherweise anderer Bedeutung (SEITENKARTE
 * §12).
 *
 * **Die Positionen tippt die Kraft.** Sie aus `auftrag_leistung` abzuleiten
 * ginge nicht: die Auftragszeilen sind die kaufmaennische Seite und der Kraft
 * bewusst verschlossen (EMP-13, K-05). Was geleistet wurde, weiss sie — der
 * Preis bleibt leer, weil offen ist, ob eine Position bei Monatspauschale
 * ueberhaupt einen Einzelpreis je Durchgang traegt (O-348).
 *
 * **Kein Kunde auf dem Bildschirm, ausser auf dem Blatt selbst.** In der Liste
 * steht der Zustand; im Abzug steht der Name, weil der Kunde unter seinem
 * eigenen Namen unterschreibt. Den holt `findeNachweis` ueber
 * `app.leistungsnachweis_kopf_schicht` (0304) — „ein anderes Recht, nicht kein
 * Recht".
 */
export const dynamic = 'force-dynamic';

interface Blatt {
  readonly schicht: EigeneSchicht;
  readonly nachweise: readonly SchichtNachweis[];
  /** Die Vorschau des EINEN vorgelegten Nachweises — oder `null`. */
  readonly vorschau: Unterschriftsvorschau | null;
}

function nachweisPille(n: SchichtNachweis): PillZustand {
  if (n.storniert) return 'Archiviert';
  switch (n.status) {
    case 'entwurf': return 'Entwurf';
    case 'vorgelegt': return 'Wartet';
    case 'signiert': return 'Abgeschlossen';
    case 'abgelehnt': return 'Abgelehnt';
    default: return 'Archiviert';
  }
}

export default async function MeinLeistungsnachweis(
  { params }: { params: Promise<{ zuordnungId: string }> },
) {
  const { zuordnungId } = await params;
  const ergebnis = await meinPortal<Blatt | null>(
    `/portal/mein/schichten/${zuordnungId}/leistungsnachweis`,
    async (kontext) => {
      const schicht = await findeEigeneSchicht(kontext, zuordnungId);
      if (schicht === null) return null;
      if (schicht.objektId === null) return { schicht, nachweise: [], vorschau: null };

      const nachweise = await listeSchichtNachweise(kontext, {
        objektId: schicht.objektId,
        von: schicht.planDatum,
        bis: schicht.planDatum,
      });
      /*
       * Genau EIN vorgelegter Nachweis bekommt das Unterschriftsblatt. Gaebe es
       * zwei, waere die Frage „welcher wird jetzt unterschrieben" eine, die der
       * Bildschirm nicht beantworten kann — dann steht nur die Liste da.
       */
      const offen = nachweise.filter((n) => n.status === 'vorgelegt' && !n.storniert);
      /*
       * **Kein `.catch(() => null)` mehr.** Hier stand einer, und er hat den
       * einzigen Fehler verschluckt, der hier ueberhaupt auftreten kann:
       * `bereiteUnterschriftVor` wirft `NachweisNichtGefunden`, wenn der Kopf
       * nicht lesbar ist — und genau das tat er im Personen-Scope, weil
       * `app.leistungsnachweis_kopf_schicht` dort null Zeilen gab (der
       * `kunde`-Join, repariert in 0304). Die Folge auf dem Bildschirm war
       * nicht „kein Blatt", sondern das ANLEGEFORMULAR: jeder Klick ein
       * weiterer vorgelegter Nachweis auf derselben Schicht.
       *
       * Ein Fehler hier ist jetzt ein Fehler. Was die Kraft sieht, ist dann
       * die Fehlerseite — und nicht ein Formular, das etwas anderes tut, als
       * sie glaubt.
       */
      const vorschau = offen.length === 1 && offen[0] !== undefined
        ? await bereiteUnterschriftVor(kontext, offen[0].id)
        : null;
      return { schicht, nachweise, vorschau };
    },
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const { schicht, nachweise, vorschau } = ergebnis.daten;
  const t = basis.texte;
  /*
   * Mit der Minute des Schichtendes schliesst die Erfassung, und die Seite
   * sagt es, statt ein Formular anzubieten, das scheitert.
   *
   * `app.ist_eingesetzt_auf_objekt` verlangt `ende_zeitpunkt >= now()` (0004);
   * danach greifen weder `leistungsnachweis.t_selbst_m1_*` noch
   * `objekt.t_selbst_m1` (0300/0304), und der POST antwortete mit einem
   * nackten `422 kein_objekt`. Wie lange NACH Schichtende noch erfasst werden
   * darf, ist die offene Frage O-740; bis zur Antwort ist die Grenze das
   * Schichtende — und CLN-04 laesst den Kunden AM ENDE der Schicht
   * unterschreiben, also steht der Grund hier und nicht nur in 0300.
   */
  const sperre = schicht.entfernt ? t.schichtEntfernt
    : schicht.beendet ? t.schichtBeendet : null;
  const eingabe =
    'min-h-11 w-full rounded-md border border-line-strong bg-surface px-s3 py-s2 '
    + 'text-base text-text';
  const ZEILEN = [0, 1, 2];

  return (
    <MeinRahmen basis={basis} titel={t.leistungsnachweis} aktiverTab="schichten">
      <Link
        href={`/portal/mein/schichten/${zuordnungId}`}
        className="mb-s4 inline-block min-h-11 text-base text-text underline"
      >
        ← {t.schichten}
      </Link>

      <h1 className="mb-s2 text-h1 text-text">{t.leistungsnachweis}</h1>
      <p className="mb-s5 text-base text-text-muted">
        {schicht.objekt ?? '—'} · <span className="cse-zahl">{schicht.planDatum}</span>
      </p>

      {schicht.objektId === null ? <Leer text={t.keineEintraege} /> : (
        <>
          <section className="mb-s6" data-cse="nachweise">
            <h2 className="mb-s3 text-h2 text-text">{t.leistungsnachweis}</h2>
            {nachweise.length === 0 ? <Leer text={t.keineEintraege} /> : (
              <ul className="m-0 flex list-none flex-col gap-s3 p-0">
                {nachweise.map((n) => (
                  <li
                    key={n.id}
                    data-cse="nachweis"
                    className="rounded-lg border border-line bg-surface p-s4"
                  >
                    <div className="mb-s3 flex flex-wrap items-center gap-s3">
                      <StatusPill sprache={basis.sprache} zustand={nachweisPille(n)} />
                      {n.nummer !== null && (
                        <span className="cse-zahl text-sm text-text-subtle">{n.nummer}</span>
                      )}
                    </div>
                    <Felder>
                      <Feld label={t.leistungszeitraum}>
                        <span className="cse-zahl">{n.von} – {n.bis}</span>
                      </Feld>
                      <Feld label={t.positionen}>
                        <span className="cse-zahl">{n.positionen}</span>
                      </Feld>
                      {/*
                        `unterschriften` traegt die ROLLENSCHLUESSEL des Enums
                        (`auftraggeber`, `auftragnehmer`). Sie sind das
                        Vokabular der Datenbank und reisen unuebersetzt (D-83);
                        auf einen vierprachigen Bildschirm gehoeren sie nicht.
                        Was die Kraft wissen muss, ist: liegt eine Unterschrift
                        vor oder nicht.
                      */}
                      <Feld label={t.unterschrift}>
                        {n.unterschriften.length === 0 ? '—' : t.unterschrieben}
                      </Feld>
                    </Felder>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {vorschau === null ? (
            <section data-cse="nachweis-formular">
              <h2 className="mb-s3 text-h2 text-text">{t.entwurfAnlegen}</h2>
              {sperre !== null ? <Hinweis text={sperre} marke="erfassung-zu" /> : (
              <>
              <p className="mb-s4 max-w-prose text-base text-text-muted">
                {t.menge} · {t.einheit} — {t.offeneFrage} (O-348)
              </p>
              <form
                method="post"
                action={`/api/mein/schichten/${zuordnungId}/leistungsnachweis`}
                className="flex max-w-prose flex-col gap-s4"
              >
                <input
                  type="hidden"
                  name="zurueck"
                  value={`/portal/mein/schichten/${zuordnungId}/leistungsnachweis`}
                />
                {ZEILEN.map((i) => (
                  <fieldset
                    key={i}
                    className="m-0 flex flex-col gap-s3 rounded-lg border border-line p-s4"
                  >
                    <legend className="px-s2 text-micro uppercase tracking-[0.08em] text-text-subtle">
                      {t.positionen} <span className="cse-zahl">{i + 1}</span>
                    </legend>
                    <div className="flex flex-col gap-s2">
                      <label htmlFor={`ln-bez-${String(i)}`} className="text-base text-text">
                        {t.bezeichnung}
                      </label>
                      <input
                        id={`ln-bez-${String(i)}`}
                        name={`bezeichnung_${String(i)}`}
                        className={eingabe}
                      />
                    </div>
                    <div className="grid gap-s3 sm:grid-cols-2">
                      <div className="flex flex-col gap-s2">
                        <label htmlFor={`ln-menge-${String(i)}`} className="text-base text-text">
                          {t.menge}
                        </label>
                        <input
                          id={`ln-menge-${String(i)}`}
                          name={`menge_${String(i)}`}
                          inputMode="decimal"
                          className={eingabe}
                        />
                      </div>
                      <div className="flex flex-col gap-s2">
                        <label htmlFor={`ln-einheit-${String(i)}`} className="text-base text-text">
                          {t.einheit}
                        </label>
                        <input
                          id={`ln-einheit-${String(i)}`}
                          name={`einheit_${String(i)}`}
                          className={eingabe}
                        />
                      </div>
                    </div>
                  </fieldset>
                ))}
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand
                             px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
                >
                  {t.vorlegen}
                </button>
              </form>
              </>
              )}
            </section>
          ) : (
            <section data-cse="unterschriftsblatt">
              <h2 className="mb-s3 text-h2 text-text">{t.unterschrift}</h2>

              {/* Der Abzug — GENAU so, wie er unterschrieben wird. */}
              <div className="mb-s5 rounded-lg border border-line bg-surface p-s4">
                <Felder>
                  <Feld label={t.leistungszeitraum}>
                    <span className="cse-zahl">
                      {vorschau.kopf.leistungszeitraumVon} – {vorschau.kopf.leistungszeitraumBis}
                    </span>
                  </Feld>
                  <Feld label={t.objekt}>{vorschau.kopf.objekt ?? '—'}</Feld>
                  {/*
                    Die Nummer steht im Abzug und geht ueber `baueSchnappschuss`
                    in die Pruefsumme, die der Kunde unterschreibt. Fehlt sie,
                    SAGT die Seite es — ob Leistungsnachweise ueberhaupt
                    fortlaufend nummeriert werden, ist offen (O-147).
                  */}
                  <Feld label={t.nummer}>
                    {vorschau.kopf.nummer ?? '—'}
                  </Feld>
                </Felder>
                {vorschau.kopf.nummer === null && (
                  <Hinweis text={t.nummerOffen} marke="nummer-offen" />
                )}
                <table className="mt-s4 w-full border-collapse text-base text-text">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="py-s2 pe-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">
                        {t.bezeichnung}
                      </th>
                      <th className="py-s2 pe-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">
                        {t.menge}
                      </th>
                      <th className="py-s2 text-micro uppercase tracking-[0.08em] text-text-subtle">
                        {t.einheit}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vorschau.positionen.map((p) => (
                      <tr key={p.reihenfolge} className="border-b border-line">
                        <td className="py-s2 pe-s3">{p.bezeichnung}</td>
                        <td className="cse-zahl py-s2 pe-s3">{p.menge}</td>
                        <td className="py-s2">{p.einheit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-s4 max-w-prose text-base text-text" lang="de">
                  {BESTAETIGUNGSTEXT}
                </p>
                <p className="mt-s3 text-sm text-text-subtle">
                  {t.pruefsumme}:{' '}
                  <span className="cse-zahl break-all">{vorschau.pruefsumme}</span>
                </p>
              </div>

              <form
                method="post"
                /*
                  Die Adresse steht in EINEM Stueck, und das ist keine
                  Formatierungsfrage. `api-verdrahtung.test.ts` beweist, dass
                  jede gebaute Route einen Aufrufer hat, indem es die Adresse
                  als Muster im uebrigen Quelltext sucht — `[id]` wird dabei zu
                  „irgendein Segment ohne Schraegstrich". Ueber zwei
                  Zeichenketten und ein `+` verteilt, steht zwischen
                  `leistungsnachweis/` und `unterschrift` ein Zeilenumbruch, und
                  das Muster trifft nicht mehr. Die Route stand daraufhin als
                  verwaist da, obwohl genau dieses Formular sie ruft.
                */
                action={`/api/mein/schichten/${zuordnungId}/leistungsnachweis/${vorschau.kopf.id}/unterschrift`}
                className="flex max-w-prose flex-col gap-s4"
              >
                <input
                  type="hidden"
                  name="zurueck"
                  value={`/portal/mein/schichten/${zuordnungId}/leistungsnachweis`}
                />
                {/*
                  Die Pruefsumme reist MIT und wird beim Unterschreiben gegen
                  einen neu gebauten Abzug gehalten (0066). Ohne sie hiesse
                  „Schnappschuss genau wie angezeigt" nichts.
                */}
                <input type="hidden" name="pruefsumme" value={vorschau.pruefsumme} />
                <div className="flex flex-col gap-s2">
                  <label htmlFor="ln-name" className="text-base text-text">
                    {t.unterzeichnerName} <span aria-hidden="true">*</span>
                    <span className="sr-only">{t.pflichtfeld}</span>
                  </label>
                  <input id="ln-name" name="name" required className={eingabe} />
                </div>
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand
                             px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
                >
                  {t.unterschreiben}
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </MeinRahmen>
  );
}
