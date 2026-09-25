/**
 * Die Pflege eines abgelegten Dokuments im Seed (DOC-04, DOC-05, V-219).
 *
 * **Über den echten Dienst, nicht per `update`.** Die Demo soll zeigen, was
 * ein Mensch auf dem Dokumentblatt tut: eine Freigabe für die Belegschaft,
 * die versehentlich gesetzt war, wird mit Grund zurückgenommen
 * (`setzeMitarbeiterfreigabe`) — samt Zeile im Prüfprotokoll. Ein Seed, der
 * den Schalter direkt umlegt, erzeugte einen Zustand ohne Protokoll, den es
 * im Betrieb nie gäbe.
 *
 * Idempotent über den Titel: ein zweiter Lauf findet das Dokument und lässt
 * es, wie es ist.
 */
import type postgres from 'postgres';
import { setzeMitarbeiterfreigabe } from '../../services/dokument/mitarbeiterfreigabe.js';
import { alsPortalSitzung } from './sitzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface DokumentPflegeErgebnis {
  /** Wie viele Freigaben für die Belegschaft in diesem Lauf zurückgenommen wurden. */
  readonly zurueckgenommen: number;
}

/** Der Wiedererkennungsschlüssel der Demounterlage — ihr Titel. */
export const RUECKNAHME_TITEL = 'Einsatzplanung Objektleitung — interne Fassung (Demodaten)';

/**
 * Ein Mensch dieser Gesellschaft, der Dokumente LESEN und ABLEGEN darf.
 *
 * Beide Rechte, weil `t_mandant` (0009) für ein UPDATE beide verlangt: die
 * Rolle `mitarbeiter` hält nur das zweite und träfe null Zeilen. Kein
 * Dienstkonto — eine Rücknahme hat einen Menschen dahinter.
 */
async function pflegerIn(sql: Sql, mandantId: string): Promise<string | null> {
  const [z] = await sql<{ id: string }[]>`
    select b.id from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
      join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id
      join berechtigung be on be.id = rb.berechtigung_id
     where be.schluessel in ('dokument.lesen', 'dokument.schreiben')
       and b.status = 'aktiv' and b.ist_dienstkonto = false and bm.entzogen_am is null
     group by b.id, b.email
    having count(distinct be.schluessel) = 2
     order by b.email limit 1`;
  return z?.id ?? null;
}

export async function seedDokumentPflege(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<DokumentPflegeErgebnis> {
  const reinigung = ids.get('reinigung');
  if (reinigung === undefined) return { zurueckgenommen: 0 };
  const mensch = await pflegerIn(sql, reinigung);
  if (mensch === null) return { zurueckgenommen: 0 };

  /*
   * (a) Eine Freigabe für die Belegschaft, die zurückgenommen wurde. Die
   * Unterlage entsteht so, wie das Uploadformular sie mit gesetztem Kästchen
   * anlegt, und wird danach über den Dienst zurückgenommen.
   */
  let zurueckgenommen = 0;
  const [da] = await sql<{ id: string }[]>`
    select id from dokument
     where mandant_id = ${reinigung} and titel = ${RUECKNAHME_TITEL}
       and geloescht_am is null limit 1`;
  if (da === undefined) {
    const [neu] = await sql<{ id: string }[]>`
      insert into dokument
        (mandant_id, kategorie, titel, beschreibung, bucket, objekt_schluessel,
         mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt,
         sichtbar_fuer_kunde, sichtbar_fuer_mitarbeiter, entstanden_am, erstellt_von)
      values (${reinigung}, 'unternehmen', ${RUECKNAHME_TITEL},
              'Einsatzplanung mit Namen und Stunden der Kräfte — nur für die Objektleitung.',
              'dokumente', 'demo/einsatzplanung/intern.pdf',
              'application/pdf', true, 20480, true, false, true, current_date, ${mensch})
      returning id`;
    if (neu !== undefined) {
      await alsPortalSitzung(sql, reinigung, mensch, (k) => setzeMitarbeiterfreigabe(
        { abfrage: k.abfrage.bind(k) }, neu.id, {
          sichtbar: false,
          grund: 'Versehentlich beim Ablegen für die Belegschaft freigegeben — enthält '
            + 'Namen und Stunden einzelner Kräfte (Demodaten).',
        }));
      zurueckgenommen += 1;
    }
  }
  return { zurueckgenommen };
}
