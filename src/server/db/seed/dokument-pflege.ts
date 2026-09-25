/**
 * Die Pflege eines abgelegten Dokuments im Seed (DOC-04, DOC-05, V-219).
 *
 * **Über den echten Dienst, nicht per `update`.** Die Demo soll zeigen, was
 * ein Mensch auf dem Dokumentblatt tut:
 *
 *  (a) eine Freigabe für die Belegschaft, die versehentlich gesetzt war, wird
 *      mit Grund zurückgenommen (`setzeMitarbeiterfreigabe`) — samt Zeile im
 *      Prüfprotokoll;
 *  (b) ein Rahmenvertrag bekommt eine zweite Fassung (`legeFassungAn`), und
 *      die erste bleibt in der Kette.
 *
 * Ein Seed, der den Schalter direkt umlegt oder eine Fassung „hinschreibt",
 * erzeugte einen Zustand ohne Protokoll, den es im Betrieb nie gäbe.
 *
 * **Ohne Speicher Metadaten, keine Datei** — wie jede Demounterlage (V-131):
 * die Fassungskette steht dann als Zeilen da, mit der Prüfsumme der
 * Demobytes, und das Blatt sagt, dass der Speicher nicht verbunden ist. Die
 * zweite Fassung geht auch dann durch den Auslöser aus 0470 (lückenlos,
 * erlaubte Kategorie).
 *
 * Idempotent über den Titel: ein zweiter Lauf findet das Dokument und lässt
 * es, wie es ist.
 */
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import type { Speicher } from '../../storage/adapter.js';
import { setzeMitarbeiterfreigabe } from '../../services/dokument/mitarbeiterfreigabe.js';
import { legeAb, legeFassungAn } from '../../services/dokument/ablage.js';
import { demoPdf } from './demo-pdf.js';
import { alsPortalSitzung } from './sitzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface DokumentPflegeErgebnis {
  /** Wie viele Freigaben für die Belegschaft in diesem Lauf zurückgenommen wurden. */
  readonly zurueckgenommen: number;
  /** Wie viele Dokumente in diesem Lauf eine zweite Fassung bekamen. */
  readonly fassungen: number;
  /** Ob die Fassungen eine Datei im Speicher haben (sonst Metadaten). */
  readonly mitDatei: boolean;
}

/** Die Wiedererkennungsschlüssel der Demounterlagen — ihre Titel. */
export const RUECKNAHME_TITEL = 'Einsatzplanung Objektleitung — interne Fassung (Demodaten)';
export const FASSUNG_TITEL = 'Rahmenvertrag Unterhaltsreinigung — mit Nachtrag (Demodaten)';

const FASSUNG_TEXTE = [
  'Fassung 1 — Rahmenvertrag, wie unterzeichnet.',
  'Fassung 2 — mit Nachtrag zur Leistungsbeschreibung (Glasreinigung quartalsweise).',
] as const;

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

async function seedRuecknahme(sql: Sql, mandant: string, mensch: string): Promise<number> {
  const [da] = await sql<{ id: string }[]>`
    select id from dokument
     where mandant_id = ${mandant} and titel = ${RUECKNAHME_TITEL}
       and geloescht_am is null limit 1`;
  if (da !== undefined) return 0;
  const [neu] = await sql<{ id: string }[]>`
    insert into dokument
      (mandant_id, kategorie, titel, beschreibung, bucket, objekt_schluessel,
       mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt,
       sichtbar_fuer_kunde, sichtbar_fuer_mitarbeiter, entstanden_am, erstellt_von)
    values (${mandant}, 'unternehmen', ${RUECKNAHME_TITEL},
            'Einsatzplanung mit Namen und Stunden der Kräfte — nur für die Objektleitung.',
            'dokumente', 'demo/einsatzplanung/intern.pdf',
            'application/pdf', true, 20480, true, false, true, current_date, ${mensch})
    returning id`;
  if (neu === undefined) return 0;
  await alsPortalSitzung(sql, mandant, mensch, (k) => setzeMitarbeiterfreigabe(
    { abfrage: k.abfrage.bind(k) }, neu.id, {
      sichtbar: false,
      grund: 'Versehentlich beim Ablegen für die Belegschaft freigegeben — enthält '
        + 'Namen und Stunden einzelner Kräfte (Demodaten).',
    }));
  return 1;
}

async function seedFassungen(
  sql: Sql, mandant: string, mensch: string, speicher: Speicher | null,
): Promise<number> {
  const [da] = await sql<{ id: string }[]>`
    select id from dokument
     where mandant_id = ${mandant} and titel = ${FASSUNG_TITEL}
       and geloescht_am is null limit 1`;
  if (da !== undefined) return 0;
  const bytes = await Promise.all(FASSUNG_TEXTE.map((z) => demoPdf(FASSUNG_TITEL, [z])));
  const [erste, zweite] = bytes as [Uint8Array, Uint8Array];

  if (speicher !== null) {
    /* Mit Speicher: beide Fassungen über die Dienste — Prüfkette, Datei, Protokoll. */
    const abgelegt = await alsPortalSitzung(sql, mandant, mensch, (k) => legeAb(k, speicher, {
      kategorie: 'vertrag', titel: FASSUNG_TITEL,
      beschreibung: 'Rahmenvertrag mit einer zweiten Fassung (Nachtrag) — die erste bleibt '
        + 'in der Kette.',
      tags: 'Rahmenvertrag, Demodaten', kundeId: '', objektId: '',
      sichtbarFuerMitarbeiter: false, dateiname: 'rahmenvertrag.pdf', daten: erste,
      behaupteterTyp: 'application/pdf',
    }));
    await alsPortalSitzung(sql, mandant, mensch, (k) => legeFassungAn(
      k, speicher, abgelegt.dokumentId, {
        dateiname: 'rahmenvertrag-nachtrag.pdf', daten: zweite,
        behaupteterTyp: 'application/pdf',
      }));
    return 1;
  }

  /*
   * Ohne Speicher: die Zeilen, keine Datei (V-131) — dieselbe Kette, die der
   * Dienst anlegen würde, mit der Prüfsumme der Demobytes. Die zweite Fassung
   * läuft durch `kern.dokument_fassung_pruefen` (0470).
   */
  const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
  const schluessel1 = `demo/rahmenvertrag/fassung-1.pdf`;
  const schluessel2 = `demo/rahmenvertrag/fassung-2.pdf`;
  await sql.begin(async (tx) => {
    const [d] = await tx<{ id: string }[]>`
      insert into dokument
        (mandant_id, kategorie, titel, beschreibung, tags, bucket, objekt_schluessel,
         mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt, entstanden_am,
         erstellt_von)
      values (${mandant}, 'vertrag', ${FASSUNG_TITEL},
              'Rahmenvertrag mit einer zweiten Fassung (Nachtrag) — die erste bleibt in der Kette.',
              ${['Rahmenvertrag', 'Demodaten']}, 'dokumente', ${schluessel2},
              'application/pdf', true, ${zweite.length}, true, current_date, ${mensch})
      returning id`;
    if (d === undefined) return;
    /* Zwei Anweisungen, nicht eine: der Auslöser der zweiten liest die erste. */
    await tx`
      insert into dokument_version
        (mandant_id, dokument_id, version, objekt_schluessel, sha256, groesse_bytes,
         mime_typ, erstellt_am, erstellt_von)
      values (${mandant}, ${d.id}, 1, ${schluessel1}, ${sha(erste)}, ${erste.length},
              'application/pdf', now() - interval '30 days', ${mensch})`;
    await tx`
      insert into dokument_version
        (mandant_id, dokument_id, version, objekt_schluessel, sha256, groesse_bytes,
         mime_typ, erstellt_von)
      values (${mandant}, ${d.id}, 2, ${schluessel2}, ${sha(zweite)}, ${zweite.length},
              'application/pdf', ${mensch})`;
  });
  return 1;
}

export async function seedDokumentPflege(
  sql: Sql, ids: ReadonlyMap<string, string>, speicher: Speicher | null = null,
): Promise<DokumentPflegeErgebnis> {
  const leer = { zurueckgenommen: 0, fassungen: 0, mitDatei: speicher !== null };
  const reinigung = ids.get('reinigung');
  if (reinigung === undefined) return leer;
  const mensch = await pflegerIn(sql, reinigung);
  if (mensch === null) return leer;
  return {
    zurueckgenommen: await seedRuecknahme(sql, reinigung, mensch),
    fassungen: await seedFassungen(sql, reinigung, mensch, speicher),
    mitDatei: speicher !== null,
  };
}
