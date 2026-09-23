import { berlinHeute } from '@/server/db/heute';
import { formatiereMenge } from '@/server/services/finanz/menge';
import { leseUrlaub, type UrlaubAnsicht } from '@/server/services/mitarbeiter/stunden';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal, MeinRahmen } from '../rahmen';
import Link from 'next/link';
import { Feld, Felder, Gesellschaft, Jahreswechsler, Leer } from '../bausteine';

/**
 * `/portal/mein/urlaub` — Anspruch und verbrauchte Tage, je Beschaeftigung
 * (EMP-05, EMP-15).
 *
 * **Es gibt keine Gesamtzahl, und das ist die Aussage.** Zwei
 * Arbeitsverhaeltnisse sind zwei Urlaubsansprueche gegen zwei Arbeitgeber
 * (D-09). Sie zu addieren ergaebe eine Zahl, gegen die niemand einen Anspruch
 * hat — und der Mensch plante danach seinen Sommer.
 *
 * **Ohne hinterlegten Anspruch steht hier „nicht hinterlegt" und keine 0**
 * (O-18). `anspruch_tage = 0` heisst, dass niemand entschieden hat, wie viele
 * Tage gelten: gesetzlich sind es 24 Werktage bei Sechstagewoche (§ 3 BUrlG),
 * tariflich und vertraglich fast immer mehr, Teilzeit rechnet anders, das
 * Eintritts- und das Austrittsjahr rechnen anders (§ 5 BUrlG), und ob ein
 * Uebertrag am 31.03. verfaellt, ist eine betriebliche Regelung — nach der
 * Rechtsprechung des EuGH ausserdem nur nach Aufforderung und Belehrung.
 * „Resturlaub: 0 Tage" waere fuenf unbeantwortete Fragen als eine plausible
 * Zahl.
 *
 * **Tage sind `numeric(12,3)`, also `MilliMenge`** — ein halber Urlaubstag ist
 * ein Anspruch, kein Rundungsergebnis. Formatiert wird mit `formatiereMenge`,
 * derselben Funktion wie ueberall sonst.
 */
export const dynamic = 'force-dynamic';

const JAHR = /^\d{4}$/u;

function einzeln(wert: string | string[] | undefined): string | null {
  return typeof wert === 'string' && wert !== '' ? wert : null;
}

export default async function MeinUrlaub({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const frage = await searchParams;
  const heute = await berlinHeute();
  const roh = einzeln(frage['jahr']);
  const jahr = Number(roh !== null && JAHR.test(roh) ? roh : heute.slice(0, 4));

  const ergebnis = await meinPortal<readonly UrlaubAnsicht[]>(
    '/portal/mein/urlaub',
    async (kontext) => leseUrlaub(kontext, jahr),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;

  return (
    <MeinRahmen basis={basis} titel={t.urlaub} aktiverTab="stunden">
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.urlaub}</h1>
        <p className="m-0 text-base text-text-muted">
          <span data-cse="urlaubsjahr" className="cse-zahl">{String(jahr)}</span>
        </p>
      </div>

      {/*
        * **Zwei Wege, die es hier nicht gab** (V-054).
        *
        * Die Seite las `?jahr=` und bot nichts an, das ihn setzt — wer den
        * Resturlaub des Vorjahres sehen wollte, musste die Adresszeile tippen.
        * Und sie zeigte den Anspruch, ohne zu sagen, wie man ihn nimmt: der
        * Urlaubsantrag liegt zwei Ebenen weiter unter „Anträge", also genau
        * dort, wo niemand sucht, der auf sein Urlaubskonto schaut.
        */}
      <Jahreswechsler
        pfad="/portal/mein/urlaub"
        jahr={jahr}
        heute={heute}
        texte={t}
        sprache={basis.sprache}
      />

      <p className="mb-s5">
        <Link
          href="/portal/mein/antraege/neu"
          data-cse="zum-urlaubsantrag"
          className="inline-flex min-h-11 items-center rounded-md border border-line-strong px-s4 text-base text-text hover:bg-surface-2"
        >
          {t.antragNeu}
        </Link>
      </p>

      {daten.length === 0 ? <Leer text={t.keineEintraege} /> : (
        <ul data-cse="urlaubskonten" className="m-0 flex list-none flex-col gap-s4 p-0">
          {daten.map((u) => (
            <li
              key={u.konto.id}
              data-cse="urlaubskonto"
              data-mandant={u.mandantSlug}
              className="rounded-lg border border-line bg-surface p-s4"
            >
              <div className="mb-s3">
                <Gesellschaft slug={u.mandantSlug} name={u.mandantName} />
              </div>
              {u.konto.anspruchOffen ? (
                <p data-cse="anspruch-offen" className="m-0 max-w-prose text-base text-text-muted">
                  {t.anspruch}: <strong className="text-text">{t.nichtHinterlegt}</strong>
                </p>
              ) : (
                <Felder>
                  <Feld label={t.anspruch}>
                    <span className="cse-zahl">
                      {formatiereMenge(u.konto.anspruchTage)} {t.tage}
                    </span>
                  </Feld>
                  <Feld label={t.vortrag}>
                    <span className="cse-zahl">
                      {formatiereMenge(u.konto.uebertragTage)} {t.tage}
                    </span>
                  </Feld>
                  <Feld label={t.genommen}>
                    <span className="cse-zahl">
                      {formatiereMenge(u.konto.genommenTage)} {t.tage}
                    </span>
                  </Feld>
                  <Feld label={t.verplant}>
                    <span className="cse-zahl">
                      {formatiereMenge(u.konto.verplantTage)} {t.tage}
                    </span>
                  </Feld>
                  <Feld label={t.rest}>
                    <span data-cse="urlaub-rest" className="cse-zahl">
                      {formatiereMenge(u.konto.restTage)} {t.tage}
                    </span>
                  </Feld>
                </Felder>
              )}
            </li>
          ))}
        </ul>
      )}
    </MeinRahmen>
  );
}
