import {
  leseAbwesenheitsarten, leseAntragsarten,
  type AbwesenheitsartWahl, type AntragsartWahl,
} from '@/server/services/mitarbeiter/antraege';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Leer } from '../../bausteine';
import { FormularFehler } from '../../FormularAntwort';
import { MEIN_FORMULAR_TEXTE } from '@/lib/i18n/mein-formular';
import { setzeEin } from '@/lib/i18n/vorlage';

/**
 * `/portal/mein/antraege/neu` — Urlaub oder Schichttausch beantragen (EMP-10).
 *
 * **Die Beschaeftigung ist eine PFLICHTWAHL und kein Vorgabewert.** Ein Mensch
 * mit zwei Arbeitsverhaeltnissen beantragt Urlaub bei EINER Gesellschaft; der
 * Anspruch besteht gegen sie, sie genehmigt, ihr Urlaubskonto wird belastet
 * (D-09). Eine geratene Vorauswahl waere ein Antrag bei der falschen GmbH —
 * und er saehe genauso aus wie ein richtiger. Wer nur eine Beschaeftigung hat,
 * sieht trotzdem das Feld: ein Formular, das sich je nach Datenlage anders
 * verhaelt, ist zweimal zu testen und einmal falsch.
 *
 * **Der Mandant steht NICHT im Formular.** Er wird serverseitig aus der
 * gewaehlten Beschaeftigung abgeleitet (K-02, Invariante 3) — ein Feld waere
 * genau die Stelle, an der jemand eine fremde Gesellschaft einsetzt.
 *
 * **Ein echtes `<form method="post">`.** Der Bildschirm muss auf einem alten
 * Diensttelefon funktionieren, also ohne JavaScript (SEITENKARTE §13).
 */
export const dynamic = 'force-dynamic';

interface Daten {
  readonly antragsarten: readonly AntragsartWahl[];
  readonly abwesenheitsarten: readonly AbwesenheitsartWahl[];
}

export default async function NeuerAntrag(
  { searchParams }: {
    readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  /*
   * **Der Rückweg eines abgewiesenen Formulars** (V-198, D-692). Ein
   * Urlaubsantrag ohne Datum scheitert am Auslöser `antrag_pflichtfelder`
   * (0074); das endete als 500 ohne Text. Jetzt kommt der Grund als
   * `?fehler=` hierher zurück.
   */
  const fehler = (await searchParams)['fehler'];
  const ergebnis = await meinPortal<Daten>('/portal/mein/antraege/neu',
    async (kontext, basis) => ({
      antragsarten: await leseAntragsarten(kontext, basis.sprache),
      abwesenheitsarten: await leseAbwesenheitsarten(kontext, basis.sprache),
    }));
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const f = MEIN_FORMULAR_TEXTE[basis.sprache];
  /*
   * **Was eine Art verlangt, steht VOR dem Absenden da** — aus denselben
   * Spalten, die der Auslöser prüft (`antragsart.erfordert_*`). Ohne
   * JavaScript kann ein Feld nicht je nach Auswahl `required` werden; der Satz
   * unter dem Feld nennt die Arten, für die es Pflicht ist.
   */
  const namen = (wo: (a: (typeof daten.antragsarten)[number]) => boolean): string =>
    daten.antragsarten.filter(wo).map((a) => a.bezeichnung).join(', ');
  const zeitraumPflicht = namen((a) => a.erfordertZeitraum);
  const artPflicht = namen((a) => a.erfordertAbwesenheitsart);
  const eingabe =
    'min-h-11 w-full rounded-md border border-line-strong bg-surface px-s3 py-s2 '
    + 'text-base text-text';

  return (
    <MeinRahmen basis={basis} titel={t.antragNeu} aktiverTab="heute"
      zurueck={{ ziel: "/portal/mein/antraege", text: t.antraege }}
    >
      <h1 className="mb-s5 text-h1 text-text">{t.antragNeu}</h1>

      <FormularFehler sprache={basis.sprache} grund={fehler} />

      {basis.anstellungen.length === 0 ? <Leer text={t.keineEintraege} /> : (
        <form
          method="post"
          action="/api/mein/antraege"
          data-cse="antrag-formular"
          className="flex max-w-prose flex-col gap-s4"
        >
          <input type="hidden" name="zurueck" value="/portal/mein/antraege" />
          {/* Ein Fehlschlag kommt HIERHER zurück, nicht auf die Liste (D-692). */}
          <input type="hidden" name="fehlerweg" value="/portal/mein/antraege/neu" />

          <div className="flex flex-col gap-s2">
            <label htmlFor="antrag-anstellung" className="text-base text-text">
              {t.gesellschaft} <span aria-hidden="true">*</span>
              <span className="sr-only">{t.pflichtfeld}</span>
            </label>
            <select id="antrag-anstellung" name="anstellung" required className={eingabe}>
              {basis.anstellungen.map((a) => (
                <option key={a.anstellungId} value={a.anstellungId}>
                  {a.mandantName}
                  {a.personalnummer === null ? '' : ` · ${a.personalnummer}`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-s2">
            <label htmlFor="antrag-art" className="text-base text-text">
              {t.antragArt} <span aria-hidden="true">*</span>
              <span className="sr-only">{t.pflichtfeld}</span>
            </label>
            <select id="antrag-art" name="antragsart" required className={eingabe}>
              {/*
                Eine Art, deren Pflichtfelder dieses Formular nicht anbietet
                (Schicht und Tauschpartner beim Schichttausch), bleibt
                sichtbar, ist aber nicht wählbar: angeboten wäre sie ein
                sicherer Fehlschlag (V-198). Die Lücke selbst — EMP-10 verlangt
                den Tauschantrag, kein Formular dieses Portals schickt
                `einsatz` und `tauschpartner` — ist V-260 (offen, mit O-613).
              */}
              {daten.antragsarten.map((a) => {
                const nichtHier = a.erfordertEinsatz || a.erfordertTauschpartner;
                return (
                  <option key={a.id} value={a.id} disabled={nichtHier}>
                    {nichtHier ? `${a.bezeichnung} ${f.nichtHier}` : a.bezeichnung}
                  </option>
                );
              })}
            </select>
          </div>

          {/*
            Die Abwesenheitsart gehoert zum Urlaubsantrag und nicht zum
            Schichttausch. Welche Art welche Felder verlangt, prueft der
            Ausloeser `antrag_pflichtfelder` (0074) — nicht diese Seite: eine
            Oberflaechenregel, die die Datenbank nicht kennt, ist eine Regel,
            die der zweite Weg umgeht.
          */}
          <div className="flex flex-col gap-s2">
            <label htmlFor="antrag-abwesenheitsart" className="text-base text-text">
              {t.abwesenheitArt}
            </label>
            <select id="antrag-abwesenheitsart" name="abwesenheitsart" className={eingabe}
                    aria-describedby={artPflicht === '' ? undefined : 'antrag-art-pflicht'}>
              <option value="">—</option>
              {daten.abwesenheitsarten.map((a) => (
                <option key={a.id} value={a.id}>{a.bezeichnung}</option>
              ))}
            </select>
            {artPflicht !== '' && (
              <p id="antrag-art-pflicht" className="m-0 text-base text-text-muted">
                {setzeEin(f.pflichtBei, { arten: artPflicht })}
              </p>
            )}
          </div>

          <div className="grid gap-s4 sm:grid-cols-2">
            <div className="flex flex-col gap-s2">
              <label htmlFor="antrag-von" className="text-base text-text">{t.von}</label>
              <input id="antrag-von" name="von" type="date" className={eingabe}
                     aria-describedby={zeitraumPflicht === '' ? undefined : 'antrag-zeitraum-pflicht'} />
            </div>
            <div className="flex flex-col gap-s2">
              <label htmlFor="antrag-bis" className="text-base text-text">{t.bis}</label>
              <input id="antrag-bis" name="bis" type="date" className={eingabe}
                     aria-describedby={zeitraumPflicht === '' ? undefined : 'antrag-zeitraum-pflicht'} />
            </div>
            {zeitraumPflicht !== '' && (
              <p id="antrag-zeitraum-pflicht" className="m-0 text-base text-text-muted sm:col-span-2">
                {setzeEin(f.pflichtBei, { arten: zeitraumPflicht })}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-s2">
            <label htmlFor="antrag-nachricht" className="text-base text-text">
              {t.nachricht}
            </label>
            <textarea id="antrag-nachricht" name="nachricht" rows={3} className={eingabe} />
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
    </MeinRahmen>
  );
}
