import Link from 'next/link';
import {
  listeEigeneDienstanweisungen, type EigeneDienstanweisung,
} from '@/server/services/mitarbeiter/dienstanweisungen';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal, MeinRahmen } from '../rahmen';
import { Gesellschaft, Leer } from '../bausteine';

/**
 * `/portal/mein/dienstanweisungen` — lesen und bestätigen, vom Telefon
 * (EMP-09, EMP-12, SEC-06, Abnahme 2).
 *
 * **Offene stehen oben, und zwar mit der nächsten Schicht daneben.** Wer um
 * 05:55 im Treppenhaus auf das Telefon sieht, will eine Antwort auf genau eine
 * Frage: was muss ich lesen, bevor ich anfange. Eine alphabetische Liste, in
 * der das Offene an dritter Stelle steht, beantwortet sie nicht.
 *
 * **Jede Zeile trägt ihre Gesellschaft** (EMP-14, D-09): Fatima arbeitet in
 * zwei GmbHs, und eine Dienstanweisung gilt für eine davon. Der Name steht
 * daneben, nicht nur die Farbe (DESIGN §9).
 *
 * **44-px-Ziele, 375 px ohne Querlauf** (DESIGN §8). Jede Zeile ist ein Link
 * mit `min-h-11`, Fliesstext nie unter 16 px, und die Karten stapeln statt zu
 * spalten — das Diensttelefon ist kein schmaler Schreibtisch.
 */
export const dynamic = 'force-dynamic';

export default async function MeineDienstanweisungen() {
  const ergebnis = await meinPortal<readonly EigeneDienstanweisung[]>(
    '/portal/mein/dienstanweisungen',
    async (kontext, basis) => listeEigeneDienstanweisungen(kontext, basis.sprache),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const offene = daten.filter((d) => d.offen);

  return (
    <MeinRahmen basis={basis} titel={t.dienstanweisungen} aktiverTab="heute">
      <h1 className="mb-s4 text-h1 text-text">{t.dienstanweisungen}</h1>

      {offene.length > 0 && (
        <p
          className="mb-s5 rounded-lg border border-line bg-surface p-s4 text-base text-warning"
          data-cse="offene-anweisungen"
        >
          <span className="cse-zahl">{offene.length}</span> · {t.nichtBestaetigt}
        </p>
      )}

      {daten.length === 0 ? <Leer text={t.keineEintraege} /> : (
        <ul className="m-0 list-none p-0">
          {daten.map((d) => (
            <li key={d.id} className="mb-s3">
              <Link
                href={`/portal/mein/dienstanweisungen/${d.id}`}
                data-cse="dienstanweisung"
                data-anweisung={d.id}
                data-offen={d.offen ? 'ja' : 'nein'}
                className="block min-h-11 rounded-lg border border-line bg-surface p-s4
                           no-underline transition-colors duration-fast hover:bg-surface-2"
              >
                <div className="mb-s2 flex flex-wrap items-center gap-s3">
                  <Gesellschaft slug={d.mandantSlug} name={d.mandantName} />
                  <span
                    className={`text-sm ${d.offen ? 'text-warning' : 'text-text-muted'}`}
                  >
                    {d.offen
                      ? (d.bestaetigteVersion === null ? t.nichtBestaetigt : t.neueFassung)
                      : `${t.bestaetigtAm} ${d.bestaetigtLokal ?? ''}`}
                  </span>
                </div>
                <p className="m-0 text-base text-text">{d.titel}</p>
                <p className="m-0 mt-s1 text-sm text-text-muted">
                  {d.objekt ?? '—'}
                  {' · '}
                  {t.fassung} <span className="cse-zahl">{d.version}</span>
                  {' · '}
                  {t.giltAb} <span className="cse-zahl">{d.gueltigAb}</span>
                </p>
                {d.naechsteSchichtLokal !== null && (
                  <p className="m-0 mt-s1 text-sm text-text-muted" data-cse="naechste-schicht">
                    {t.vorNaechsterSchicht}:{' '}
                    <span className="cse-zahl">{d.naechsteSchichtLokal}</span>
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MeinRahmen>
  );
}
