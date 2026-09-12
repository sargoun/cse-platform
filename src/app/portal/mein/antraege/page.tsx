import Link from 'next/link';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import {
  listeEigeneAbwesenheiten, listeEigeneAntraege,
  type EigeneAbwesenheit, type EigenerAntrag,
} from '@/server/services/mitarbeiter/antraege';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal, MeinRahmen } from '../rahmen';
import { Feld, Felder, Gesellschaft, Leer } from '../bausteine';

/**
 * `/portal/mein/antraege` — eigene Antraege und Abwesenheiten mit Zustand
 * (EMP-10, EMP-15, NOT-03).
 *
 * **Zwei Listen und nicht eine**, weil es zwei Vorgaenge sind: ein ANTRAG ist
 * eine Bitte, ueber die jemand entscheidet (Urlaub, Schichttausch); eine
 * ABWESENHEIT ist die Tatsache, die daraus wird — oder die gemeldet wird, ohne
 * dass jemand entscheidet (Krankheit). Sie zusammenzuwerfen hiesse, einen
 * genehmigten Urlaub doppelt zu zeigen und eine Krankmeldung als Antrag
 * auszugeben, ueber den jemand noch befinden muss.
 *
 * **Der Grund einer Abwesenheit steht hier NICHT.** `abwesenheitsart_id`,
 * `au_*`, `dokument_id` und `bemerkung` gibt die Datenbank der Anwendungsrolle
 * gar nicht erst zu lesen (0073, Art. 9 DSGVO) — auch nicht fuer die eigene
 * Zeile. Wer den Grund braucht, geht ueber `leseGrund`, und das schreibt eine
 * Auditzeile.
 *
 * **Zurueckziehen wird hier nicht angeboten.** `zieheAntragZurueck` gibt es im
 * Dienst, aber `antrag` traegt heute keine permissive UPDATE-Policy fuer
 * `app.aktuelle_person()` — der Aufruf traefe null Zeilen und antwortete 404.
 * Ein Knopf, der 404 ergibt, ist schlechter als keiner; die fehlende Policy
 * ist im Abschlussbericht vermerkt, und sie braucht eine Migration, die zu
 * diesem PR nicht gehoert.
 */
export const dynamic = 'force-dynamic';

interface Daten {
  readonly antraege: readonly EigenerAntrag[];
  readonly abwesenheiten: readonly EigeneAbwesenheit[];
}

/**
 * Der Zustand eines Antrags auf das FESTE Pillenvokabular abgebildet
 * (DESIGN §5) — abgebildet und nicht erfunden.
 */
function antragPille(status: string): PillZustand {
  switch (status) {
    case 'eingereicht': return 'Wartet';
    case 'in_pruefung': return 'In Prüfung';
    case 'genehmigt': return 'Abgeschlossen';
    case 'abgelehnt': return 'Abgelehnt';
    default: return 'Archiviert';
  }
}

function abwesenheitPille(status: string): PillZustand {
  switch (status) {
    case 'beantragt': return 'Wartet';
    case 'genehmigt': return 'Abgeschlossen';
    case 'abgelehnt': return 'Abgelehnt';
    case 'erfasst': return 'Aktiv';
    default: return 'Archiviert';
  }
}

export default async function MeineAntraege() {
  const ergebnis = await meinPortal<Daten>('/portal/mein/antraege',
    async (kontext, basis) => ({
      antraege: await listeEigeneAntraege(kontext, basis.anstellungen),
      abwesenheiten: await listeEigeneAbwesenheiten(kontext, basis.anstellungen),
    }));
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const knopf =
    'inline-flex min-h-11 items-center justify-center rounded-md border '
    + 'border-line-strong px-s5 py-s3 text-base text-text no-underline hover:bg-surface-2';

  return (
    <MeinRahmen basis={basis} titel={t.antraege} aktiverTab="heute">
      <h1 className="mb-s4 text-h1 text-text">{t.antraege}</h1>

      <div className="mb-s6 flex flex-wrap gap-s3">
        <Link href="/portal/mein/antraege/neu" data-cse="zum-antrag" className={knopf}>
          {t.antragNeu}
        </Link>
        <Link
          href="/portal/mein/abwesenheit/neu"
          data-cse="zur-abwesenheit"
          className={knopf}
        >
          {t.abwesenheitMelden}
        </Link>
      </div>

      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">{t.antraege}</h2>
        {daten.antraege.length === 0 ? <Leer text={t.keineEintraege} /> : (
          <ul data-cse="antraege" className="m-0 flex list-none flex-col gap-s3 p-0">
            {daten.antraege.map((a) => (
              <li
                key={a.antrag.id}
                data-cse="antrag"
                data-mandant={a.mandantSlug}
                className="rounded-lg border border-line bg-surface p-s4"
              >
                <div className="mb-s3 flex flex-wrap items-center gap-s3">
                  <Gesellschaft slug={a.mandantSlug} name={a.mandantName} />
                  <StatusPill zustand={antragPille(a.antrag.status)} />
                </div>
                <Felder>
                  <Feld label={t.antragArt}>{a.antrag.art}</Feld>
                  <Feld label={t.von}>
                    <span className="cse-zahl">{a.antrag.vonDatum ?? '—'}</span>
                  </Feld>
                  <Feld label={t.bis}>
                    <span className="cse-zahl">{a.antrag.bisDatum ?? '—'}</span>
                  </Feld>
                  {a.antrag.entscheidungKommentar !== null && (
                    <Feld label={t.nachricht}>{a.antrag.entscheidungKommentar}</Feld>
                  )}
                </Felder>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-s3 text-h3 text-text">{t.abwesenheit}</h2>
        {daten.abwesenheiten.length === 0 ? <Leer text={t.keineEintraege} /> : (
          <ul data-cse="abwesenheiten" className="m-0 flex list-none flex-col gap-s3 p-0">
            {daten.abwesenheiten.map((a) => (
              <li
                key={a.abwesenheit.id}
                data-cse="abwesenheit"
                data-mandant={a.mandantSlug}
                className="rounded-lg border border-line bg-surface p-s4"
              >
                <div className="mb-s3 flex flex-wrap items-center gap-s3">
                  <Gesellschaft slug={a.mandantSlug} name={a.mandantName} />
                  <StatusPill zustand={abwesenheitPille(a.abwesenheit.status)} />
                </div>
                <Felder>
                  <Feld label={t.von}>
                    <span className="cse-zahl">{a.abwesenheit.von}</span>
                  </Feld>
                  <Feld label={t.bis}>
                    <span className="cse-zahl">{a.abwesenheit.bis}</span>
                  </Feld>
                  <Feld label={t.tage}>
                    <span className="cse-zahl">{a.abwesenheit.tageAngerechnet ?? '—'}</span>
                  </Feld>
                </Felder>
              </li>
            ))}
          </ul>
        )}
      </section>
    </MeinRahmen>
  );
}
