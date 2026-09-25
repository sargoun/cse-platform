import Link from 'next/link';
import {
  leseAbwesenheitsarten, type AbwesenheitsartWahl,
} from '@/server/services/mitarbeiter/antraege';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Leer } from '../../bausteine';

/**
 * `/portal/mein/abwesenheit/neu` — Krankheit oder Abwesenheit melden (EMP-10).
 *
 * **Eine MELDUNG, kein Antrag** — die Seitenkarte fuehrt beide getrennt, und
 * der Unterschied ist der Vorgang dahinter: ueber einen Urlaubsantrag
 * entscheidet jemand, eine Krankmeldung wird zur Kenntnis genommen. Der
 * Zustand der entstehenden Zeile ist deshalb `erfasst`.
 *
 * **Dies ist der einzige Bildschirm des Portals hinter einem RECHT**
 * (`zeit.abwesenheit_melden`, SEITENKARTE §7). Es ist das eine Schreibrecht,
 * das die Rolle `mitarbeiter` von Haus aus haelt.
 *
 * **Eine Art mit ungeklaerter Lohnwirkung bleibt in der Liste** (O-139) — sie
 * wird sichtbar als ungeklaert gezeigt, statt still zu verschwinden. Der
 * Dienst weist sie beim Melden mit einer Meldung ab, die den Grund nennt;
 * eine Art, die aus dem Formular fehlt, erzeugt stattdessen einen Anruf.
 */
export const dynamic = 'force-dynamic';

export default async function NeueAbwesenheit() {
  const ergebnis = await meinPortal<readonly AbwesenheitsartWahl[]>(
    '/portal/mein/abwesenheit/neu',
    async (kontext, basis) => leseAbwesenheitsarten(kontext, basis.sprache),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const eingabe =
    'min-h-11 w-full rounded-md border border-line-strong bg-surface px-s3 py-s2 '
    + 'text-base text-text';

  return (
    <MeinRahmen basis={basis} titel={t.abwesenheitMelden} aktiverTab="heute">
      <Link
        href="/portal/mein/antraege"
        className="mb-s4 inline-block min-h-11 text-base text-text underline"
      >
        ← {t.antraege}
      </Link>
      <h1 className="mb-s5 text-h1 text-text">{t.abwesenheitMelden}</h1>

      {basis.anstellungen.length === 0 ? <Leer text={t.keineEintraege} /> : (
        <form
          method="post"
          action="/api/mein/abwesenheit"
          data-cse="abwesenheit-formular"
          className="flex max-w-prose flex-col gap-s4"
        >
          <input type="hidden" name="zurueck" value="/portal/mein/antraege" />

          <div className="flex flex-col gap-s2">
            <label htmlFor="abw-anstellung" className="text-base text-text">
              {t.gesellschaft} <span aria-hidden="true">*</span>
              <span className="sr-only">{t.pflichtfeld}</span>
            </label>
            <select id="abw-anstellung" name="anstellung" required className={eingabe}>
              {basis.anstellungen.map((a) => (
                <option key={a.anstellungId} value={a.anstellungId}>
                  {a.mandantName}
                  {a.personalnummer === null ? '' : ` · ${a.personalnummer}`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-s2">
            <label htmlFor="abw-art" className="text-base text-text">
              {t.abwesenheitArt} <span aria-hidden="true">*</span>
              <span className="sr-only">{t.pflichtfeld}</span>
            </label>
            <select id="abw-art" name="abwesenheitsart" required className={eingabe}>
              {daten.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bezeichnung}
                  {/* O-139 steht am Eintrag und nicht in einer Fussnote. */}
                  {a.bezahlt === null ? ` (${t.nichtHinterlegt})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-s4 sm:grid-cols-2">
            <div className="flex flex-col gap-s2">
              <label htmlFor="abw-von" className="text-base text-text">
                {t.von} <span aria-hidden="true">*</span>
                <span className="sr-only">{t.pflichtfeld}</span>
              </label>
              <input id="abw-von" name="von" type="date" required className={eingabe} />
            </div>
            <div className="flex flex-col gap-s2">
              <label htmlFor="abw-bis" className="text-base text-text">
                {t.bis} <span aria-hidden="true">*</span>
                <span className="sr-only">{t.pflichtfeld}</span>
              </label>
              <input id="abw-bis" name="bis" type="date" required className={eingabe} />
            </div>
          </div>

          {/*
            **Halbe Randtage** (V-057). Die Spalten `von_halbtags`/`bis_halbtags`,
            die Rechnung in `rechneTage` (je halber Randtag minus 0,5) und der
            Lohnexport standen seit 0073; die Route las beide Felder — und kein
            Formular schickte sie. Wer einen halben Tag krank war, meldete einen
            ganzen, und die Sollzeitgutschrift im Stundenkonto war um einen
            halben Tag falsch (EMP-04).
          */}
          <fieldset className="m-0 flex flex-col gap-s3 border-0 p-0">
            <legend className="mb-s1 p-0 text-base text-text">{t.halberTagBeginn}</legend>
            <label className="flex items-center gap-s3 text-base text-text">
              <input type="checkbox" name="von_halbtags" value="ja"
                     className="min-h-11 min-w-11 shrink-0" data-cse="abw-von-halb" />
              <span>{t.halberTagBeginn}</span>
            </label>
            <label className="flex items-center gap-s3 text-base text-text">
              <input type="checkbox" name="bis_halbtags" value="ja"
                     className="min-h-11 min-w-11 shrink-0" data-cse="abw-bis-halb" />
              <span>{t.halberTagEnde}</span>
            </label>
            <p className="m-0 text-base text-text-muted">{t.halberTagHinweis}</p>
          </fieldset>

          {/*
            **Die AU-Bescheinigung** (§ 5 EFZG). `au_bescheinigung_vorliegt` und
            `au_bis` stehen seit 0073 in der Tabelle und wurden von der Route
            gelesen — geschickt hat sie niemand. Ohne sie steht in der Akte bei
            jeder Krankmeldung „keine Bescheinigung", auch wenn sie auf dem
            Tisch der Personalstelle liegt.
          */}
          <fieldset className="m-0 flex flex-col gap-s3 border-0 p-0">
            <legend className="mb-s1 p-0 text-base text-text">{t.auVorliegt}</legend>
            <label className="flex items-center gap-s3 text-base text-text">
              <input type="checkbox" name="au_vorliegt" value="ja"
                     className="min-h-11 min-w-11 shrink-0" data-cse="abw-au-vorliegt" />
              <span>{t.auVorliegt}</span>
            </label>
            <div className="flex flex-col gap-s2">
              <label htmlFor="abw-au-bis" className="text-base text-text">{t.auBis}</label>
              <input id="abw-au-bis" name="au_bis" type="date" className={eingabe}
                     data-cse="abw-au-bis" />
            </div>
            <p className="m-0 text-base text-text-muted">{t.auHinweis}</p>
          </fieldset>

          <div className="flex flex-col gap-s2">
            <label htmlFor="abw-bemerkung" className="text-base text-text">
              {t.nachricht}
            </label>
            <textarea id="abw-bemerkung" name="bemerkung" rows={3} className={eingabe} />
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
