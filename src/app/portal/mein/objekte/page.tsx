import Link from 'next/link';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  anschriftZeile, listeEigeneObjekte, type EigenesObjekt,
} from '@/server/services/mitarbeiter/objekte';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal, MeinRahmen } from '../rahmen';
import { Feld, Felder, Gesellschaft, Leer } from '../bausteine';

/**
 * `/portal/mein/objekte` — die Objekte, auf denen dieser Mensch arbeitet
 * (EMP-02, EMP-13, EMP-14, OPS-01).
 *
 * **Die laufenden stehen oben.** Wer um 05:55 im Treppenhaus auf das Telefon
 * sieht, sucht die Anschrift von HEUTE und nicht die von vorletztem Jahr. Die
 * Reihenfolge kommt aus `app.ist_eingesetzt_auf_objekt` — derselben Funktion,
 * an der auch der Zutrittshinweis haengt (0069, 0360). Zwei verschiedene
 * Antworten auf „bin ich hier eingeteilt" waeren eine Liste, deren Reihenfolge
 * etwas anderes verspricht als die Seite dahinter.
 *
 * **Die vergangenen bleiben stehen.** Ein Objekt verschwindet nicht mit der
 * letzten Schicht: wer den Weg von vorletzter Woche nachsehen will, findet ihn
 * sonst nicht mehr. Was dort NICHT mehr steht, ist der Zutritt — den zeigt
 * erst das Blatt, und nur, solange die Einteilung laeuft.
 * // TODO(client, O-852): Soll ein Objekt nach der letzten Schicht dauerhaft
 * in dieser Liste bleiben (heute) oder nach einer Frist verschwinden?
 *
 * **Jede Zeile traegt ihre Gesellschaft** (EMP-14, D-09): derselbe Mensch
 * steht morgens bei der einen und abends bei der anderen GmbH, und die beiden
 * haben verschiedene Objekte, verschiedene Vorgesetzte und verschiedene
 * Zutrittsregeln.
 *
 * **Kein Kunde, kein Auftrag, kein Preis** (EMP-13, K-05). Ein Objekt ist hier
 * ein ORT.
 */
export const dynamic = 'force-dynamic';

export default async function MeineObjekte() {
  const ergebnis = await meinPortal<readonly EigenesObjekt[]>(
    '/portal/mein/objekte',
    async (kontext) => listeEigeneObjekte(kontext),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;

  return (
    <MeinRahmen basis={basis} titel={t.objekte} aktiverTab="heute">
      <h1 className="mb-s5 text-h1 text-text">{t.objekte}</h1>

      {daten.length === 0 ? <Leer text={t.keineObjekte} /> : (
        <ul data-cse="objekte" className="m-0 flex list-none flex-col gap-s3 p-0">
          {daten.map((o) => (
            <li key={o.objektId}>
              <Link
                href={`/portal/mein/objekte/${o.objektId}`}
                data-cse="objekt"
                data-objekt={o.objektId}
                data-mandant={o.mandantSlug}
                data-aktuell={o.aktuellEingeteilt ? 'ja' : 'nein'}
                className="block min-h-11 rounded-lg border border-line bg-surface p-s4
                           no-underline transition-colors duration-fast hover:bg-surface-2"
              >
                <div className="mb-s2 flex flex-wrap items-center gap-s3">
                  <Gesellschaft slug={o.mandantSlug} name={o.mandantName} />
                  {/*
                    * Das Wort und nicht die Farbe (DESIGN §9): „Aktiv" heisst
                    * hier „Sie sind eingeteilt", und wer nur einen Punkt
                    * sieht, weiss nicht, was daraus folgt.
                    */}
                  {o.aktuellEingeteilt && (
                    <>
                      <StatusPill sprache={basis.sprache} zustand="Aktiv" />
                      <span data-cse="eingeteilt" className="text-sm text-text">
                        {t.aktuellEingeteilt}
                      </span>
                    </>
                  )}
                  {o.archiviert && <StatusPill sprache={basis.sprache} zustand="Archiviert" />}
                </div>

                <p className="m-0 text-base text-text">{o.bezeichnung}</p>

                <Felder>
                  <Feld label={t.anschrift}>{anschriftZeile(o)}</Feld>
                  {o.naechsteSchichtLokal !== null && (
                    <Feld label={t.naechsteSchicht}>
                      <span className="cse-zahl">{o.naechsteSchichtLokal}</span>
                    </Feld>
                  )}
                  {o.naechsteSchichtLokal === null && o.letzteSchichtLokal !== null && (
                    <Feld label={t.letzteSchicht}>
                      <span className="cse-zahl">{o.letzteSchichtLokal}</span>
                    </Feld>
                  )}
                </Felder>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MeinRahmen>
  );
}
