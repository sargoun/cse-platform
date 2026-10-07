import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { istGueltigerKalendertag } from '../../../lib/datum/kalendertag.js';

/**
 * Die Freistellungsbescheinigungen nach § 48b EStG pflegen — anlegen,
 * widerrufen, den Beleg verknüpfen (FIN-10, LEG-06, V-283, V-388, O-604,
 * O-130, D-779, D-845, D-846).
 *
 * **Ohne sie werden 15 % einbehalten — mit ihr nicht** (0118), und zwar
 * immer die des LEISTENDEN (§ 48 Abs. 2 EStG). Darum zählen zwei Arten:
 *
 *  - die EIGENE der Gesellschaft (`eigene`, weder Kunde noch Lieferant,
 *    0531): sie legt sie ihren Kunden vor, und ohne sie behalten diese bei
 *    einer Bauleistung 15 % ein. Sie steht auf der Ausgangsrechnung
 *    (`steuerfall.ts`, `rechnung.ts`, V-388, D-846).
 *  - die eines LIEFERANTEN: sie befreit die Gesellschaft vom Einbehalt auf
 *    seine Eingangsrechnung.
 *
 * Bescheinigungen von KUNDEN (das Steuerblatt am Kunden) wirken auf keine
 * Rechnung der Gesellschaft; diese Seite zeigt sie, erfasst sie aber nicht.
 *
 * // TODO(client, O-604): Voreinstellung — die Buchhaltung pflegt Freistellungsbescheinigungen mit `finanzen.schreiben` (dem Recht der Policy, 0118); für die steuerliche Lage genügt das Leserecht. D-779, D-845.
 *
 * **Angelegt wird, nie geändert** (0530, `kern.freistellung_fest`): Träger,
 * Nummer, Finanzamt, Zeitraum, Umfang und Auftrag stehen nach dem Anlegen
 * fest — festgeschriebene Belege nennen sie. Eine falsch erfasste
 * Bescheinigung wird widerrufen und neu angelegt. Der Widerruf wirkt ab
 * seinem Tag, nie rückwirkend; der Beleg (`dokument_id`) wird einmal
 * verknüpft.
 */

export type FreistellungGrund =
  | 'traeger_fehlt' | 'traeger_unbekannt' | 'nummer_fehlt' | 'nummer_vergeben'
  | 'finanzamt_fehlt' | 'zeitraum_ungueltig' | 'auftrag_fehlt' | 'auftrag_unbekannt'
  | 'nicht_gefunden' | 'schon_widerrufen' | 'widerruf_rueckwirkend' | 'widerruf_nach_ablauf'
  | 'beleg_unbekannt' | 'beleg_vorhanden';

export class FreistellungFehler extends Error {
  readonly status: number;
  constructor(readonly grund: FreistellungGrund, nachricht: string) {
    super(nachricht);
    this.name = 'FreistellungFehler';
    this.status = grund === 'nicht_gefunden' ? 404 : grund.endsWith('_vergeben')
      || grund === 'schon_widerrufen' || grund === 'beleg_vorhanden' ? 409 : 422;
  }
}

export type FreistellungTraeger = 'eigene' | 'lieferant' | 'kunde';
export type FreistellungUmfang = 'unbeschraenkt' | 'auftragsbezogen';

/** Wo eine Bescheinigung an einem Tag steht. */
export type FreistellungStand = 'kuenftig' | 'gueltig' | 'abgelaufen' | 'widerrufen';

/**
 * Der Stand an einem Berliner Kalendertag — rein. Widerrufen ist sie ab dem
 * Tag des Widerrufs (einschliesslich); davor gilt sie in ihrem Zeitraum.
 */
export function freistellungStand(
  b: { readonly gueltigVon: string; readonly gueltigBis: string;
       readonly widerrufenAm: string | null },
  heute: string,
): FreistellungStand {
  if (b.widerrufenAm !== null && heute >= b.widerrufenAm) return 'widerrufen';
  if (heute < b.gueltigVon) return 'kuenftig';
  if (heute > b.gueltigBis) return 'abgelaufen';
  return 'gueltig';
}

export interface FreistellungZeile {
  readonly id: string;
  readonly traeger: FreistellungTraeger;
  /** `null` bei der eigenen — sie gehört der Gesellschaft. */
  readonly traegerId: string | null;
  readonly traegerName: string | null;
  readonly nummer: string;
  readonly finanzamt: string;
  /** Berliner Kalendertage `JJJJ-MM-TT`. */
  readonly gueltigVon: string;
  readonly gueltigBis: string;
  readonly widerrufenAm: string | null;
  readonly umfang: FreistellungUmfang;
  readonly auftragId: string | null;
  readonly auftragsnummer: string | null;
  readonly dokumentId: string | null;
  readonly dokument: string | null;
  /**
   * Wie viele Belege sie nennen — Ausgangs- und Eingangsrechnungen, soweit
   * diese Sitzung sie sieht (die RLS beider Tabellen gilt auch hier).
   */
  readonly belege: number;
  readonly stand: FreistellungStand;
}

export interface FreistellungListe {
  /** Der Berliner Kalendertag der DATENBANK — er entscheidet den Stand (Invariante 5). */
  readonly heute: string;
  readonly zeilen: readonly FreistellungZeile[];
}

/** Alle Bescheinigungen der Gesellschaft — die am längsten gültigen zuerst. */
export async function listeFreistellungen(
  kontext: LeseKontext,
): Promise<FreistellungListe> {
  const [tag] = await kontext.abfrage<{ heute: string }>(
    `select to_char(app.berlin_heute(), 'YYYY-MM-DD') as heute`);
  const heute = tag?.heute ?? '';
  const zeilen = await kontext.abfrage<Omit<FreistellungZeile, 'stand'>>(
    `select f.id::text as id,
            case when f.kunde_id is not null then 'kunde'
                 when f.lieferant_id is not null then 'lieferant'
                 else 'eigene' end as traeger,
            coalesce(f.kunde_id, f.lieferant_id)::text as "traegerId",
            coalesce(k.name, l.name, m.firma) as "traegerName",
            f.bescheinigung_nummer as nummer, f.finanzamt,
            to_char(f.gueltig_von, 'YYYY-MM-DD') as "gueltigVon",
            to_char(f.gueltig_bis, 'YYYY-MM-DD') as "gueltigBis",
            to_char(f.widerrufen_am, 'YYYY-MM-DD') as "widerrufenAm",
            f.umfang::text as umfang, f.auftrag_id::text as "auftragId",
            a.auftragsnummer, f.dokument_id::text as "dokumentId", d.titel as dokument,
            ((select count(*) from rechnung r
               where r.mandant_id = f.mandant_id and r.freistellungsbescheinigung_id = f.id)
             + (select count(*) from eingangsrechnung e
               where e.mandant_id = f.mandant_id
                 and e.freistellungsbescheinigung_id = f.id))::int as belege
       from freistellungsbescheinigung f
       join mandant m on m.id = f.mandant_id
       left join kunde k on k.mandant_id = f.mandant_id and k.id = f.kunde_id
       left join lieferant l on l.mandant_id = f.mandant_id and l.id = f.lieferant_id
       left join auftrag a on a.mandant_id = f.mandant_id and a.id = f.auftrag_id
       left join dokument d on d.mandant_id = f.mandant_id and d.id = f.dokument_id
      where f.mandant_id = app.aktiver_mandant()
      order by f.gueltig_bis desc, f.bescheinigung_nummer`);
  return { heute, zeilen: zeilen.map((z) => ({ ...z, stand: freistellungStand(z, heute) })) };
}

export interface NeueFreistellung {
  readonly traeger: string;
  /** Leer bei der eigenen Bescheinigung der Gesellschaft. */
  readonly traegerId: string;
  readonly nummer: string;
  readonly finanzamt: string;
  readonly gueltigVon: string;
  readonly gueltigBis: string;
  readonly umfang: string;
  readonly auftragId?: string | null;
  readonly dokumentId?: string | null;
}

const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

async function protokolliere(
  kontext: SchreibKontext, aktion: string, id: string, nutzlast: Record<string, unknown>,
): Promise<void> {
  await kontext.schreibe(
    `select app.protokolliere($1, 'freistellungsbescheinigung', $2, null, $3::jsonb,
                              app.aktiver_mandant())`,
    // Das OBJEKT, nicht sein JSON-Text (D-467).
    [aktion, id, nutzlast]);
}

async function pruefeBeleg(kontext: SchreibKontext, dokumentId: string): Promise<void> {
  if (!KENNUNG.test(dokumentId)) {
    throw new FreistellungFehler('beleg_unbekannt', 'Diesen Beleg gibt es hier nicht.');
  }
  const [d] = await kontext.abfrage<{ id: string }>(
    `select id from dokument
      where id = $1::uuid and mandant_id = app.aktiver_mandant() and geloescht_am is null`,
    [dokumentId]);
  if (d === undefined) {
    throw new FreistellungFehler('beleg_unbekannt',
      'Diesen Beleg gibt es in dieser Gesellschaft nicht — oder Sie sehen ihn nicht.');
  }
}

/** Legt eine Bescheinigung an — für einen Kunden oder einen Lieferanten. */
export async function legeFreistellungAn(
  kontext: SchreibKontext, eingabe: NeueFreistellung,
): Promise<{ readonly id: string }> {
  const traeger = eingabe.traeger;
  if (traeger !== 'eigene' && traeger !== 'kunde' && traeger !== 'lieferant') {
    throw new FreistellungFehler('traeger_fehlt',
      'Wessen Bescheinigung ist es — die der Gesellschaft oder die eines Lieferanten?');
  }
  if (traeger !== 'eigene' && !KENNUNG.test(eingabe.traegerId)) {
    throw new FreistellungFehler('traeger_fehlt', 'Bitte wählen Sie, für wen sie gilt.');
  }
  const nummer = eingabe.nummer.trim();
  const finanzamt = eingabe.finanzamt.trim();
  if (nummer.length < 3) {
    throw new FreistellungFehler('nummer_fehlt',
      'Die Nummer der Bescheinigung steht auf ihr — mindestens drei Zeichen.');
  }
  if (finanzamt.length < 3) {
    throw new FreistellungFehler('finanzamt_fehlt',
      'Welches Finanzamt hat sie ausgestellt?');
  }
  if (!istGueltigerKalendertag(eingabe.gueltigVon) || !istGueltigerKalendertag(eingabe.gueltigBis)
      || eingabe.gueltigBis < eingabe.gueltigVon) {
    throw new FreistellungFehler('zeitraum_ungueltig',
      'Der Zeitraum braucht zwei Tage, und der zweite liegt nicht vor dem ersten.');
  }
  const umfang = eingabe.umfang === 'auftragsbezogen' ? 'auftragsbezogen' : 'unbeschraenkt';
  const auftragId = umfang === 'auftragsbezogen' ? (eingabe.auftragId ?? '').trim() : '';
  if (umfang === 'auftragsbezogen' && !KENNUNG.test(auftragId)) {
    throw new FreistellungFehler('auftrag_fehlt',
      'Eine auftragsbezogene Bescheinigung gilt für EINEN Auftrag — bitte wählen.');
  }

  if (traeger !== 'eigene') {
    const tabelle = traeger === 'kunde' ? 'kunde' : 'lieferant';
    const [t] = await kontext.abfrage<{ id: string }>(
      `select id from ${tabelle} where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
      [eingabe.traegerId]);
    if (t === undefined) {
      throw new FreistellungFehler('traeger_unbekannt',
        traeger === 'kunde' ? 'Diesen Kunden gibt es in dieser Gesellschaft nicht.'
          : 'Diesen Lieferanten gibt es in dieser Gesellschaft nicht.');
    }
  }
  if (umfang === 'auftragsbezogen') {
    const [a] = await kontext.abfrage<{ id: string }>(
      `select id from auftrag where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
      [auftragId]);
    if (a === undefined) {
      throw new FreistellungFehler('auftrag_unbekannt',
        'Diesen Auftrag gibt es in dieser Gesellschaft nicht.');
    }
  }
  const dokumentId = (eingabe.dokumentId ?? '').trim();
  if (dokumentId !== '') await pruefeBeleg(kontext, dokumentId);

  const [doppelt] = await kontext.abfrage<{ id: string }>(
    `select id from freistellungsbescheinigung
      where mandant_id = app.aktiver_mandant() and bescheinigung_nummer = $1`, [nummer]);
  if (doppelt !== undefined) {
    throw new FreistellungFehler('nummer_vergeben',
      'Eine Bescheinigung mit dieser Nummer ist schon erfasst.');
  }

  const [zeile] = await kontext.schreibe<{ id: string }>(
    `insert into freistellungsbescheinigung
       (mandant_id, kunde_id, lieferant_id, bescheinigung_nummer, finanzamt,
        gueltig_von, gueltig_bis, umfang, auftrag_id, dokument_id,
        erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3, $4, $5::date, $6::date,
             $7::freistellung_umfang, $8::uuid, $9::uuid, 'mensch', app.aktueller_benutzer())
     returning id::text as id`,
    [traeger === 'kunde' ? eingabe.traegerId : null,
      traeger === 'lieferant' ? eingabe.traegerId : null,
      nummer, finanzamt, eingabe.gueltigVon, eingabe.gueltigBis, umfang,
      umfang === 'auftragsbezogen' ? auftragId : null,
      dokumentId === '' ? null : dokumentId]);
  if (zeile === undefined) {
    throw new FreistellungFehler('nicht_gefunden', 'Die Bescheinigung wurde nicht angelegt.');
  }
  await protokolliere(kontext, 'freistellungsbescheinigung.angelegt', zeile.id, {
    traeger, nummer, finanzamt, gueltig_von: eingabe.gueltigVon,
    gueltig_bis: eingabe.gueltigBis, umfang,
  });
  return zeile;
}

interface Kopf { gueltig_von: string; gueltig_bis: string; widerrufen_am: string | null;
  dokument_id: string | null; nummer: string; heute: string }

async function sperre(kontext: SchreibKontext, id: string): Promise<Kopf> {
  if (!KENNUNG.test(id)) {
    throw new FreistellungFehler('nicht_gefunden', 'Diese Bescheinigung gibt es hier nicht.');
  }
  const [k] = await kontext.abfrage<Kopf>(
    `select to_char(gueltig_von, 'YYYY-MM-DD') as gueltig_von,
            to_char(gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
            to_char(widerrufen_am, 'YYYY-MM-DD') as widerrufen_am,
            dokument_id::text as dokument_id, bescheinigung_nummer as nummer,
            to_char(app.berlin_heute(), 'YYYY-MM-DD') as heute
       from freistellungsbescheinigung
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
      for update`, [id]);
  if (k === undefined) {
    throw new FreistellungFehler('nicht_gefunden', 'Diese Bescheinigung gibt es hier nicht.');
  }
  return k;
}

/**
 * Widerruft eine Bescheinigung ab einem Tag — heute oder später, nie davor
 * (0118, 0530): für die Zeit vor dem Widerruf durfte ohne Einbehalt
 * ausgezahlt werden. Ein Tag nach ihrem Ablauf widerriefe nichts mehr.
 */
export async function widerrufeFreistellung(
  kontext: SchreibKontext, id: string, ab: string,
): Promise<void> {
  const k = await sperre(kontext, id);
  if (k.widerrufen_am !== null) {
    throw new FreistellungFehler('schon_widerrufen',
      `Diese Bescheinigung ist schon zum ${k.widerrufen_am} widerrufen.`);
  }
  if (!istGueltigerKalendertag(ab) || ab < k.heute) {
    throw new FreistellungFehler('widerruf_rueckwirkend',
      'Ein Widerruf wirkt ab heute oder später — nie rückwirkend.');
  }
  if (ab > k.gueltig_bis) {
    throw new FreistellungFehler('widerruf_nach_ablauf',
      `Die Bescheinigung läuft am ${k.gueltig_bis} ohnehin ab — ein Widerruf danach `
      + 'widerriefe nichts.');
  }
  // `ab` liegt nicht vor heute; vor dem Beginn einer künftigen Bescheinigung
  // setzt der CHECK fsb_widerruf (0118) die Grenze — dann ab ihrem ersten Tag.
  const tag = ab < k.gueltig_von ? k.gueltig_von : ab;
  await kontext.schreibe(
    `update freistellungsbescheinigung
        set widerrufen_am = $2::date, geaendert_am = now(), geaendert_von_art = 'mensch',
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [id, tag]);
  await protokolliere(kontext, 'freistellungsbescheinigung.widerrufen', id,
    { nummer: k.nummer, widerrufen_am: tag });
}

/** Verknüpft den Beleg (den Scan) — einmal; getauscht wird er nicht (0530). */
export async function verknuepfeFreistellungsbeleg(
  kontext: SchreibKontext, id: string, dokumentId: string,
): Promise<void> {
  const k = await sperre(kontext, id);
  if (k.dokument_id !== null) {
    throw new FreistellungFehler('beleg_vorhanden',
      'Der Beleg ist schon verknüpft — er wird nicht getauscht.');
  }
  await pruefeBeleg(kontext, dokumentId);
  await kontext.schreibe(
    `update freistellungsbescheinigung
        set dokument_id = $2::uuid, geaendert_am = now(), geaendert_von_art = 'mensch',
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [id, dokumentId]);
  await protokolliere(kontext, 'freistellungsbescheinigung.beleg_verknuepft', id,
    { nummer: k.nummer, dokument: dokumentId });
}

/**
 * Die Auswahl für das Formular: Lieferanten, Aufträge und Belege. Kunden
 * stehen nicht darin — ihre Bescheinigungen erfasst das Steuerblatt am Kunden,
 * und auf Rechnungen der Gesellschaft wirken sie nicht (V-388, D-846).
 */
export interface FreistellungAuswahl {
  readonly lieferanten: readonly { readonly id: string; readonly name: string }[];
  readonly auftraege: readonly { readonly id: string; readonly name: string }[];
  readonly belege: readonly { readonly id: string; readonly name: string }[];
}

export async function ladeFreistellungAuswahl(
  kontext: LeseKontext,
): Promise<FreistellungAuswahl> {
  const lieferanten = await kontext.abfrage<{ id: string; name: string }>(
    `select id::text as id, name from lieferant
      where mandant_id = app.aktiver_mandant() and archiviert_am is null
      order by name limit 200`);
  const auftraege = await kontext.abfrage<{ id: string; name: string }>(
    `select id::text as id, auftragsnummer || ' — ' || bezeichnung as name from auftrag
      where mandant_id = app.aktiver_mandant() and status <> 'storniert'
      order by erstellt_am desc limit 200`);
  /*
   * Belege der Kategorien „beleg" und „buchhaltung" — dort legt die
   * Buchhaltung den Scan ab (Dokumente › Ablage). Die RLS auf `dokument`
   * entscheidet, was die Sitzung sieht.
   */
  const belege = await kontext.abfrage<{ id: string; name: string }>(
    `select id::text as id, titel || ' (' || to_char(entstanden_am, 'DD.MM.YYYY') || ')' as name
       from dokument
      where mandant_id = app.aktiver_mandant() and geloescht_am is null
        and kategorie in ('beleg', 'buchhaltung')
      order by entstanden_am desc limit 200`);
  return { lieferanten, auftraege, belege };
}
