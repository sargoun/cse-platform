/**
 * Demodaten fuer PR 36 — Auftrag, Leistungszeilen und der Weg Zeit → Auftrag
 * (TIM-12, FIN-07, FIN-18).
 *
 * **Warum das in den Seed gehoert.** Ohne eine Leistungszeile traegt jeder
 * Zeiteintrag `auftrag_leistung_id = NULL`, und dann sieht die
 * Abrechnungsseite genau so aus, wie sie bei einem kaputten Erben-Ausloeser
 * aussaehe: leer, ohne Fehler, ohne Luecke. Erst wenn die Kette in den
 * Demodaten steht — Auftrag → Leistungszeile → Turnus → Einsatz →
 * Zeiteintrag —, prueft ein Mensch beim Ansehen etwas.
 *
 * **Und die Gegenprobe steht auch drin.** Ein Turnus bleibt mit Absicht OHNE
 * Leistungszeile: seine Schichten erscheinen in `zeiteintrag_ohne_auftrag`,
 * also in dem Bericht, den FIN-18 verlangt. Demodaten, in denen alles
 * aufgeht, pruefen die Haelfte, auf die es ankommt, gerade nicht.
 *
 * **Idempotent durch LESEN ZUERST** — wie `dienstplan.ts` und aus demselben
 * Grund: die natuerlichen Schluessel liegen auf teilweisen Indizes.
 *
 * Laeuft NACH `seedDienstplan`, weil es dessen Turnusse und Einsaetze
 * nachtraeglich verankert. Die Reihenfolge ist eine Abhaengigkeit, keine
 * Vorliebe.
 */
import type postgres from 'postgres';
import { cent, type Cent } from '../../services/finanz/geld.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface AuftragErgebnis {
  readonly auftraege: number;
  readonly leistungen: number;
  readonly verankerteTurnusse: number;
  readonly verankerteEinsaetze: number;
}

const LEER: AuftragErgebnis = {
  auftraege: 0, leistungen: 0, verankerteTurnusse: 0, verankerteEinsaetze: 0,
};

/**
 * Der Regelsteuersatz in Basispunkten.
 *
 * 19 % ist kein erfundener Wert, sondern § 12 Abs. 1 UStG — und er steht als
 * Basispunkte da, weil Geld und Saetze in dieser Plattform ganzzahlig sind
 * (Invariante 1, K-16). Die Steuer wird JE Satzgruppe gebildet, nie aus einer
 * Bruttosumme zurueckgerechnet.
 */
const REGELSATZ_BP = 1900;

export async function seedAuftrag(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<AuftragErgebnis> {
  const reinigung = ids.get('reinigung');
  if (reinigung === undefined) return LEER;

  const [objekt] = await sql<{ id: string; kunde_id: string; bezeichnung: string }[]>`
    select id, kunde_id, bezeichnung from objekt
     where mandant_id = ${reinigung} and archiviert_am is null and kunde_id is not null
     order by objektnummer limit 1`;
  if (objekt === undefined) return LEER;

  const [leitung] = await sql<{ id: string }[]>`
    select b.id from benutzer b
     join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${reinigung}
     order by b.email limit 1`;
  if (leitung === undefined) return LEER;

  const nummer = 'AU-2026-DEMO1';
  let auftragId: string;
  const [vorhanden] = await sql<{ id: string }[]>`
    select id from auftrag where mandant_id = ${reinigung} and auftragsnummer = ${nummer}`;
  if (vorhanden === undefined) {
    const [neu] = await sql<{ id: string }[]>`
      insert into auftrag
        (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status, bezeichnung,
         verantwortlich_benutzer_id, start_datum)
      values (${reinigung}, ${nummer}, ${objekt.kunde_id}, ${objekt.id},
              'rahmenvertrag', 'aktiv',
              ${`Unterhaltsreinigung ${objekt.bezeichnung}`},
              ${leitung.id}, '2026-01-01')
      returning id`;
    if (neu === undefined) return LEER;
    auftragId = neu.id;
  } else {
    auftragId = vorhanden.id;
  }

  /**
   * Zwei Leistungszeilen, und sie stehen fuer die zwei Faelle, die die
   * Abrechnung unterscheidet: eine monatlich wiederkehrende Unterhaltsleistung
   * und eine gesondert beauftragte Grundreinigung. Die Preise sind
   * DEMOWERTE — sie tragen keine Aussage ueber echte Marktpreise, und die
   * Kalkulation dahinter ist der Weg, auf dem ein echter Preis entsteht.
   */
  const zeilen: readonly {
    nr: number; bezeichnung: string; menge: number; einheit: string;
    einzelpreisCent: Cent; frequenz: string;
  }[] = [
    {
      nr: 1, bezeichnung: 'Unterhaltsreinigung Bürogeschosse', menge: 1, einheit: 'Monat',
      einzelpreisCent: cent(189_000n), frequenz: '3× wöchentlich',
    },
    {
      nr: 2, bezeichnung: 'Grundreinigung Halle', menge: 1, einheit: 'Einsatz',
      einzelpreisCent: cent(96_000n), frequenz: 'samstags nachts',
    },
  ];

  const leistungIds: string[] = [];
  for (const z of zeilen) {
    const [da] = await sql<{ id: string }[]>`
      select id from auftrag_leistung
       where auftrag_id = ${auftragId} and position_nr = ${z.nr}`;
    if (da !== undefined) {
      leistungIds.push(da.id);
      continue;
    }
    const [neu] = await sql<{ id: string }[]>`
      insert into auftrag_leistung
        (mandant_id, auftrag_id, position_nr, objekt_id, bezeichnung, menge, einheit,
         einzelpreis_cent, steuersatz_bp, leistungsfrequenz_text, gueltig_ab)
      values (${reinigung}, ${auftragId}, ${z.nr}, ${objekt.id}, ${z.bezeichnung},
              ${z.menge}, ${z.einheit}, ${z.einzelpreisCent}, ${REGELSATZ_BP},
              ${z.frequenz}, '2026-01-01')
      returning id`;
    if (neu !== undefined) leistungIds.push(neu.id);
  }
  const unterhalt = leistungIds[0];
  const grund = leistungIds[1];
  if (unterhalt === undefined || grund === undefined) {
    return { ...LEER, auftraege: 1, leistungen: leistungIds.length };
  }

  /**
   * Der Turnus bekommt seinen Abrechnungsanker — und ZWEI von dreien, nicht
   * drei. Die Glasreinigung bleibt ohne: sie ist der Fall, den
   * `zeiteintrag_ohne_auftrag` melden muss.
   */
  const turnusse = await sql<{ id: string; bezeichnung: string }[]>`
    update turnus
       set auftrag_leistung_id = case
             when bezeichnung like 'Grundreinigung%' then ${grund}::uuid
             else ${unterhalt}::uuid end
     where mandant_id = ${reinigung}
       and auftrag_leistung_id is null
       and (bezeichnung like 'Unterhaltsreinigung%' or bezeichnung like 'Grundreinigung%')
     returning id, bezeichnung`;

  /**
   * Und die schon materialisierten Schichten nach. Der Generator hat sie
   * angelegt, bevor es einen Anker gab; die naechsten Laeufe erben ihn selbst.
   * `auftrag_id` MUSS mitgesetzt werden — `einsatz_leistung_braucht_auftrag`
   * (0028) verlangt es, und `einsatz_leistung_fk` (0050) ist der
   * Enkel-Schluessel, der beides zusammenhaelt.
   */
  const einsaetze = await sql<{ id: string }[]>`
    update einsatz e
       set auftrag_id = ${auftragId}, auftrag_leistung_id = t.auftrag_leistung_id
      from turnus t
     where t.mandant_id = e.mandant_id and t.id = e.turnus_id
       and e.mandant_id = ${reinigung}
       and e.auftrag_leistung_id is null
       and t.auftrag_leistung_id is not null
     returning e.id`;

  return {
    auftraege: 1,
    leistungen: leistungIds.length,
    verankerteTurnusse: turnusse.length,
    verankerteEinsaetze: einsaetze.length,
  };
}
