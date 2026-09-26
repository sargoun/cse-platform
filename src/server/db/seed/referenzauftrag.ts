/**
 * Demodaten für V-161 — ein ABGESCHLOSSENER Auftrag mit geltender
 * Kundenfreigabe und die Referenz, die aus ihm entsteht (PRO-05, D-654).
 *
 * **Warum das in den Seed gehört.** Seit V-161 entsteht eine Referenz nur aus
 * einem abgeschlossenen Auftrag mit geltender Freigabe. Der Seed hatte keinen:
 * der Auftrag aus dem Demoangebot (`vertrieb.ts`) trägt eine Freigabe, steht
 * aber auf `angelegt`. Ohne diese Datei zeigte `/website/referenzen/neu` in der
 * Vorführung nur „Noch kein Auftrag ist bereit", und der Weg „Referenz aus
 * diesem Auftrag anlegen" wäre nirgends zu sehen — die Definition of Done
 * verlangt, dass die Demodaten ihn begehen.
 *
 * **Über die echten Dienste, in einer Portalsitzung.** Nummer aus dem Kreis
 * (`vergebeNummer`), Freigabe über `erfasseKundenfreigabe` (prüft
 * Ansprechpartner und Schreiben gegen den Kunden, `freigabe_am` stempelt die
 * Serveruhr), Abschluss über `schliesseAuftragAb` (der Auslöser verlangt
 * `auftrag.abschliessen` und stempelt `abgeschlossen_am`), die Referenz über
 * `legeReferenzAn` — dieselben Tore wie im Portal. Ein Seed, der sie umginge,
 * erzeugte Zeilen, die im Betrieb nie entstehen könnten.
 *
 * **Nur mit `CSE_DEV_FLAECHEN`, und als das, was es ist** (D-537): der
 * Wortlaut der Freigabe und das Kundenschreiben beginnen mit `DEMODATEN:`,
 * der Kundenname der Referenz trägt „(Demokunde)". Eine Kundenfreigabe ist
 * eine Aussage, die rechtlich zählt; in einem echten Bestand hat keine zu
 * stehen, die niemand gegeben hat.
 *
 * **Die Referenz bleibt Entwurf ohne eigene Freigabe** — der Stand nach dem
 * Anlegen (O-913). Wer die Vorführung weiterspielt, trägt die Zustimmung auf
 * ihrem Blatt ein; der Vorschlag aus dem Auftrag steht dort schon.
 *
 * **Idempotent durch LESEN ZUERST**, über die Bezeichnung: eine gezogene
 * Nummer kennt man vorher nicht (dieselbe Begründung wie `auftrag.ts`).
 */
import type postgres from 'postgres';
import { vergebeNummer } from '../../services/finanz/nummernkreis.js';
import { erfasseKundenfreigabe } from '../../services/auftrag/kundenfreigabe.js';
import { schliesseAuftragAb } from '../../services/auftrag/abschluss.js';
import { legeReferenzAn } from '../../services/inhalt/redaktion.js';
import { alsPortalSitzung } from './sitzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface ReferenzAuftragErgebnis {
  /** Die gezogene Nummer — `null`, wenn nichts entstand. */
  readonly auftragsnummer: string | null;
  /** Der Slug der Referenz aus diesem Auftrag — `null`, wenn keine entstand. */
  readonly referenz: string | null;
  /** Warum nichts entstand — ein Satz für die Ausgabe des Seeds. */
  readonly grund: string | null;
}

const NICHTS = (grund: string): ReferenzAuftragErgebnis =>
  ({ auftragsnummer: null, referenz: null, grund });

const AUFTRAG = {
  bezeichnung: 'Grundreinigung nach Umbau — Praxisetage',
  beschreibung: 'Einmalige Grundreinigung der Praxisetage nach Abschluss der Umbauarbeiten.',
} as const;

const SCHREIBEN = {
  titel: 'Referenzfreigabe Grundreinigung Praxisetage (Kundenschreiben)',
  beschreibung:
    'DEMODATEN: erfundenes Kundenschreiben zur Referenzfreigabe (PRO-05, D-537). Vor dem '
    + 'Echtbetrieb ersetzen.',
} as const;

const WORTLAUT =
  'DEMODATEN: Mail vom Kunden „Sie dürfen die Grundreinigung unserer Praxisetage als '
  + 'Referenz nennen." — erfundener Kunde, erfundene Freigabe (D-537).';

/** Die Rechte, die der Weg vom Auftrag bis zur Referenz verlangt — alle in EINEM Konto. */
const RECHTE = [
  'auftrag.lesen', 'auftrag.schreiben', 'auftrag.abschliessen',
  'referenz.schreiben', 'referenz.kundenfreigabe_erfassen', 'dokument.schreiben',
] as const;

export async function seedReferenzAusAuftrag(
  sql: Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<ReferenzAuftragErgebnis> {
  if (!demodaten) return NICHTS('nur mit CSE_DEV_FLAECHEN (D-537)');
  const reinigung = ids.get('reinigung');
  if (reinigung === undefined) return NICHTS('Bereich reinigung fehlt');

  const [schonDa] = await sql<{ id: string }[]>`
    select id from auftrag
     where mandant_id = ${reinigung} and bezeichnung = ${AUFTRAG.bezeichnung} limit 1`;
  if (schonDa !== undefined) return NICHTS('bereits vorhanden, nichts nachgelegt');

  /**
   * Ein Kunde MIT Ansprechpartner: die Freigabe verlangt einen, der sie erklärt
   * hat (`auftrag_referenzfreigabe_vollstaendig`), und nur einen, der noch da
   * ist — derselbe Filter wie die Auswahl auf der Kundenfreigabe.
   */
  const [kunde] = await sql<{ id: string; name: string; ansprechpartner: string }[]>`
    select k.id, k.name, ap.id as ansprechpartner
      from kunde k
      join ansprechpartner ap on ap.kunde_id = k.id and ap.archiviert_am is null
                              and ap.ausgeschieden_am is null and ap.anonymisiert_am is null
     where k.mandant_id = ${reinigung}
     order by k.kundennummer, ap.nachname limit 1`;
  if (kunde === undefined) return NICHTS('kein Kunde mit Ansprechpartner');

  /**
   * Ein Konto, das den GANZEN Weg gehen darf — gesucht über seine Rechte, nicht
   * über seine Rolle (dieselbe Regel wie `vertrieb.ts`): welche Rolle welches
   * Recht trägt, entscheidet der Katalog und nicht dieser Seed.
   */
  const [bearbeiter] = await sql<{ id: string }[]>`
    select b.id
      from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${reinigung}
     where b.status = 'aktiv' and b.ist_dienstkonto = false and bm.entzogen_am is null
       and (select count(distinct be.schluessel)
              from rolle_berechtigung rb
              join berechtigung be on be.id = rb.berechtigung_id
             where rb.rolle_id = bm.rolle_id and rb.gewaehrt and rb.mandant_id is null
               and be.schluessel = any(${[...RECHTE]}::text[])) = ${RECHTE.length}
     order by b.email limit 1`;
  if (bearbeiter === undefined) return NICHTS('kein Konto mit allen Rechten des Wegs');

  return alsPortalSitzung(sql, reinigung, bearbeiter.id, async (kontext) => {
    const db = {
      abfrage: kontext.abfrage.bind(kontext),
      unsafe: async (s: string, w: readonly unknown[] = []): Promise<readonly unknown[]> =>
        kontext.schreibe<unknown>(s, w),
    };

    const nummer = await vergebeNummer(db, { kreisTyp: 'auftrag' });
    const [auftrag] = await kontext.schreibe<{ id: string }>(
      `insert into auftrag
         (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung, beschreibung,
          verantwortlich_benutzer_id, start_datum)
       values (app.aktiver_mandant(), $1, $2, 'einzelauftrag', 'aktiv', $3, $4, $5,
               app.berlin_heute() - 60)
       returning id`,
      [nummer.formatiert, kunde.id, AUFTRAG.bezeichnung, AUFTRAG.beschreibung,
       bearbeiter.id]);
    if (auftrag === undefined) return NICHTS('der Auftrag ging nicht in die Tabelle');

    /*
     * Das Schreiben des Kunden — nur Metadaten, keine Datei: der Speicher ist
     * nicht verbunden, und ein erfundener Abruf wäre eine falsche Spur
     * (dieselbe Bauart wie das Kundenschreiben in `vertrieb.ts`). Es hängt
     * am Auftrag, dessen Beleg es ist (V-176, OPS-11).
     */
    const [schreiben] = await kontext.schreibe<{ id: string }>(
      `insert into dokument
         (mandant_id, kategorie, titel, beschreibung, kunde_id,
          bucket, objekt_schluessel, mime_typ, mime_verifiziert, groesse_bytes,
          exif_entfernt, sichtbar_fuer_kunde, sichtbar_fuer_mitarbeiter, entstanden_am,
          auftrag_id)
       values (app.aktiver_mandant(), 'kunde', $1, $2, $3,
               'dokumente', $4, 'application/pdf', true, 24576, true, false, false,
               app.berlin_heute() - 20, $5::uuid)
       returning id`,
      [SCHREIBEN.titel, SCHREIBEN.beschreibung, kunde.id,
       `demo/referenzfreigabe/${nummer.formatiert}.pdf`, auftrag.id]);
    if (schreiben === undefined) return NICHTS('das Kundenschreiben ging nicht in die Tabelle');

    await erfasseKundenfreigabe(db, auftrag.id, {
      ansprechpartnerId: kunde.ansprechpartner, dokumentId: schreiben.id, text: WORTLAUT,
    });
    await schliesseAuftragAb(db, auftrag.id, {});

    const referenz = await legeReferenzAn(kontext, {
      auftragId: auftrag.id,
      titel: AUFTRAG.bezeichnung,
      slug: null,
      kundeName: `${kunde.name} (Demokunde)`,
      beschreibung: null,
      jahr: null,
    });
    return { auftragsnummer: nummer.formatiert, referenz: referenz.slug, grund: null };
  });
}
