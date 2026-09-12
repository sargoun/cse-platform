import 'server-only';
import { cent, type Cent } from '../geld.js';
import {
  AUFSCHLAG_B2B_BP, AUFSCHLAG_B2C_BP,
} from './stufen.platzhalter.js';
import { berechneVerzugszins, verzugstage, type ZinsMethode } from './zins.js';

/**
 * Der Mahnlauf (FIN-15; `05-FINANZEN.md` §7.5, §7.6, SPEC §14).
 *
 * **Er erzeugt einen VORSCHLAG, nie einen Brief.** Invariante 7 gilt hier
 * besonders scharf: eine Mahnung ist eine Willenserklärung mit Verzugsfolgen.
 * Was dieser Lauf herstellt, ist ein Entwurf im Freigabekorb — freigegeben
 * wird von einem Menschen, und erst die Freigabe zieht die Nummer.
 *
 * **Er erfindet keine Zahl.** Drei Dinge müssen dastehen, sonst rechnet er
 * nicht:
 *
 *   1. Eine BESTÄTIGTE Mahnstufe. Solange `ist_platzhalter` steht, entsteht
 *      kein Entwurf, und der Hinweis sagt warum (O-19).
 *   2. Ein Verzugsbeginn. §286 Abs. 1 BGB: der Verzug tritt durch die MAHNUNG
 *      ein. Vor der ersten Mahnung gibt es deshalb keinen Zins — nicht weil
 *      diese Datei zurückhaltend wäre, sondern weil das Gesetz es so sagt.
 *      Die Ausnahmen (§286 Abs. 2 und 3) hängen an Vereinbarungen und am
 *      Zugang der Rechnung; beides ist offen, und beides bleibt hier
 *      unangewandt.
 *   3. Ein Basiszinssatz, der das Mahndatum deckt. Fehlt er, wird KEIN Zins
 *      gerechnet und der Hinweis nennt es — ein veralteter Basiszins ergibt
 *      einen Anspruch, der falsch ist, und zwar in eine Richtung, die erst
 *      der Empfänger bemerkt.
 *
 * **Der Zahlungstermin ist der Mahntag.** Eine überfällige Forderung ist
 * bereits fällig (§271 BGB); eine im Brief gewährte Frist ist ein Entgegen-
 * kommen, keine Pflicht — und in welcher Höhe die Gruppe eines gewährt, ist
 * Teil von O-19.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type VerzugsbeginnRegel =
  'mit_faelligkeit' | 'nach_mahnung' | 'dreissig_tage_nach_zugang';

export interface VorschlagPosition {
  readonly offenerPostenId: string;
  readonly rechnungId: string;
  readonly rechnungsnummer: string;
  readonly offenCent: Cent;
  readonly faelligAm: string;
  readonly verzugsbeginnAm: string | null;
  readonly verzugsbeginnRegel: VerzugsbeginnRegel;
  readonly verzugstage: number;
  readonly zinsBp: number;
  readonly zinsMethode: ZinsMethode | null;
  readonly zinsCent: Cent;
}

export interface MahnVorschlag {
  readonly kundeId: string;
  readonly kundeName: string;
  readonly mahnstufeId: string;
  readonly stufe: number;
  readonly bezeichnung: string;
  readonly mahndatum: string;
  readonly zahlbarBis: string;
  readonly positionen: readonly VorschlagPosition[];
  readonly forderungCent: Cent;
  readonly gebuehrCent: Cent;
  readonly zinsenCent: Cent;
  readonly gesamtCent: Cent;
  /** Was der Lauf nicht rechnen konnte, im Klartext. */
  readonly hinweise: readonly string[];
}

export interface Uebergangen {
  /** Der Posten, um den es geht — der stabile Schluessel der Zeile. */
  readonly offenerPostenId: string;
  readonly rechnungsnummer: string;
  readonly kundeName: string;
  readonly grund: string;
}

export interface Lauflage {
  readonly vorschlaege: readonly MahnVorschlag[];
  readonly uebergangen: readonly Uebergangen[];
}

interface FaelligZeile {
  readonly offener_posten_id: string;
  readonly rechnung_id: string;
  readonly rechnungsnummer: string;
  readonly kunde_id: string;
  readonly kunde_name: string;
  readonly offen_cent: string;
  readonly faellig_am: string;
  readonly ueberfaellig_tage: number;
  readonly letzte_mahnung_am: string | null;
  readonly naechste_stufe: number;
  readonly gesperrt_grund: string | null;
}

interface StufeZeile {
  readonly id: string;
  readonly stufe: number;
  readonly bezeichnung: string;
  readonly tage_nach_faelligkeit: number;
  readonly gebuehr_cent: string;
  readonly zinsberechnung: string;
  readonly zins_aufschlag_bp: number | null;
  readonly zins_methode: ZinsMethode | null;
  readonly ist_platzhalter: boolean;
}

/**
 * Was heute gemahnt werden könnte — und was nicht, mit Grund.
 *
 * Die Sperren (`gesperrt_grund`) kommen aus der Sicht `faellige_forderung`,
 * damit Lauf und Oberfläche dieselbe Zeile lesen und dasselbe sagen.
 */
export async function ermittleVorschlaege(db: Abfrage): Promise<Lauflage> {
  const [heuteZeile] = await db.abfrage<{ heute: string }>(
    `select app.berlin_heute()::text as heute`);
  const heute = heuteZeile!.heute;

  const faellig = await db.abfrage<FaelligZeile>(
    `select offener_posten_id, rechnung_id, rechnungsnummer, kunde_id, kunde_name,
            offen_cent::text, faellig_am::text, ueberfaellig_tage,
            letzte_mahnung_am::text, naechste_stufe, gesperrt_grund
       from faellige_forderung
      order by kunde_name, faellig_am`);

  const stufen = await db.abfrage<StufeZeile>(
    `select id, stufe, bezeichnung, tage_nach_faelligkeit, gebuehr_cent::text,
            zinsberechnung::text as zinsberechnung, zins_aufschlag_bp,
            zins_methode::text as zins_methode, ist_platzhalter
       from mahnstufe
      where gueltig_ab <= $1::date
        and (gueltig_bis is null or gueltig_bis >= $1::date)
      order by stufe`, [heute]);

  const [basis] = await db.abfrage<{ satz_bp: number }>(
    `select satz_bp from basiszinssatz
      where gueltig_von <= $1::date and (gueltig_bis is null or gueltig_bis >= $1::date)`,
    [heute]);

  const uebergangen: Uebergangen[] = [];
  /** Je Kunde und Stufe genau ein Brief. */
  const gesammelt = new Map<string, {
    zeilen: FaelligZeile[]; stufe: StufeZeile; hinweise: Set<string>;
  }>();

  for (const z of faellig) {
    if (z.gesperrt_grund !== null) {
      uebergangen.push({
        offenerPostenId: z.offener_posten_id,
        rechnungsnummer: z.rechnungsnummer, kundeName: z.kunde_name,
        grund: z.gesperrt_grund,
      });
      continue;
    }
    const stufe = stufen.find((s) => s.stufe === z.naechste_stufe);
    if (stufe === undefined) {
      uebergangen.push({
        offenerPostenId: z.offener_posten_id,
        rechnungsnummer: z.rechnungsnummer, kundeName: z.kunde_name,
        grund: `Für Stufe ${String(z.naechste_stufe)} ist keine Mahnstufe hinterlegt (O-19).`,
      });
      continue;
    }
    if (stufe.ist_platzhalter) {
      uebergangen.push({
        offenerPostenId: z.offener_posten_id,
        rechnungsnummer: z.rechnungsnummer, kundeName: z.kunde_name,
        grund: `Mahnstufe „${stufe.bezeichnung}" ist unbestätigt — es wird nicht gemahnt (O-19).`,
      });
      continue;
    }
    if (z.ueberfaellig_tage < stufe.tage_nach_faelligkeit) {
      uebergangen.push({
        offenerPostenId: z.offener_posten_id,
        rechnungsnummer: z.rechnungsnummer, kundeName: z.kunde_name,
        grund: `Erst ${String(z.ueberfaellig_tage)} Tage überfällig; Stufe `
          + `„${stufe.bezeichnung}" greift ab ${String(stufe.tage_nach_faelligkeit)}.`,
      });
      continue;
    }

    const schluessel = `${z.kunde_id}:${String(stufe.stufe)}`;
    const eintrag = gesammelt.get(schluessel)
      ?? { zeilen: [], stufe, hinweise: new Set<string>() };
    eintrag.zeilen.push(z);
    gesammelt.set(schluessel, eintrag);
  }

  const vorschlaege: MahnVorschlag[] = [];
  for (const eintrag of gesammelt.values()) {
    const stufe = eintrag.stufe;
    const hinweise = eintrag.hinweise;

    /**
     * **§286 Abs. 1 BGB.** Der Verzug tritt durch die Mahnung ein. Vor der
     * ersten gibt es deshalb keinen Zins — die Ausnahmen des Abs. 2 (bestimmte
     * Leistungszeit, Verweigerung) und des Abs. 3 (dreissig Tage nach
     * Fälligkeit UND Zugang, gegenüber Verbrauchern nur bei Hinweis) hängen an
     * Vereinbarungen und am Zugang der Rechnung. Beides ist offen; beides
     * bleibt unangewandt.
     */
    const rechnetZins = stufe.zinsberechnung !== 'keine';
    if (rechnetZins && basis === undefined && stufe.zinsberechnung !== 'vertraglich') {
      hinweise.add(
        `Kein Basiszinssatz deckt den ${heute} — es wird kein Verzugszins gefordert.`);
    }

    const aufschlag = stufe.zinsberechnung === 'vertraglich'
      ? (stufe.zins_aufschlag_bp ?? 0)
      : stufe.zinsberechnung === 'gesetzlich_b2c' ? AUFSCHLAG_B2C_BP : AUFSCHLAG_B2B_BP;
    const zinsBp = !rechnetZins || (basis === undefined && stufe.zinsberechnung !== 'vertraglich')
      ? 0
      : Math.max(0, (stufe.zinsberechnung === 'vertraglich' ? 0 : basis!.satz_bp) + aufschlag);

    const positionen: VorschlagPosition[] = eintrag.zeilen.map((z) => {
      const beginn = z.letzte_mahnung_am;
      if (rechnetZins && beginn === null) {
        hinweise.add(
          'Vor der ersten Mahnung läuft kein Verzug (§286 Abs. 1 BGB) — '
          + 'diese Forderung trägt keinen Zins.');
      }
      const tage = beginn === null ? 0 : verzugstage(beginn, heute);
      const methode = rechnetZins && beginn !== null ? stufe.zins_methode : null;
      const betrag = cent(BigInt(z.offen_cent));
      const zins = methode === null || zinsBp === 0 || tage === 0
        ? cent(0n)
        : berechneVerzugszins({ betragCent: betrag, zinsBp, von: beginn!, bis: heute, methode });

      return {
        offenerPostenId: z.offener_posten_id,
        rechnungId: z.rechnung_id,
        rechnungsnummer: z.rechnungsnummer,
        offenCent: betrag,
        faelligAm: z.faellig_am,
        verzugsbeginnAm: beginn,
        /* Die Regel, WIE SIE ANGEWANDT WURDE — eingefroren auf der Zeile. */
        verzugsbeginnRegel: 'nach_mahnung' as const,
        verzugstage: tage,
        zinsBp: methode === null ? 0 : zinsBp,
        zinsMethode: methode,
        zinsCent: zins,
      };
    });

    const forderung = cent(positionen.reduce((s, p) => s + p.offenCent, 0n));
    const zinsen = cent(positionen.reduce((s, p) => s + p.zinsCent, 0n));
    const gebuehr = cent(BigInt(stufe.gebuehr_cent));
    if (gebuehr === 0n) {
      hinweise.add('Für diese Stufe ist keine Mahngebühr hinterlegt (O-19).');
    }

    vorschlaege.push({
      kundeId: eintrag.zeilen[0]!.kunde_id,
      kundeName: eintrag.zeilen[0]!.kunde_name,
      mahnstufeId: stufe.id,
      stufe: stufe.stufe,
      bezeichnung: stufe.bezeichnung,
      mahndatum: heute,
      /* §271 BGB: eine überfällige Forderung ist bereits fällig. Eine im
         Brief gewährte Frist ist ein Entgegenkommen — und O-19. */
      zahlbarBis: heute,
      positionen,
      forderungCent: forderung,
      gebuehrCent: gebuehr,
      zinsenCent: zinsen,
      gesamtCent: cent(forderung + gebuehr + zinsen),
      hinweise: [...hinweise],
    });
  }

  return { vorschlaege, uebergangen };
}

/**
 * Aus einem Vorschlag einen ENTWURF machen — mehr nicht.
 *
 * Der Brief bekommt hier keine Nummer und geht nirgendwohin. Das tut die
 * Freigabe, und die trifft ein Mensch.
 */
export async function legeMahnentwurfAn(
  db: Abfrage, vorschlag: MahnVorschlag,
): Promise<string> {
  const [kopf] = await db.abfrage<{ id: string }>(
    `insert into mahnung
       (mandant_id, kunde_id, mahnstufe_id, stufe, mahndatum, zahlbar_bis,
        forderung_cent, gebuehr_cent, zinsen_cent, gesamt_cent,
        erstellt_von_art, erstellt_von_dienst)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3, $4::date, $5::date,
             $6::bigint, $7::bigint, $8::bigint, $9::bigint, 'system', 'fin/mahnung/lauf')
     returning id`,
    [vorschlag.kundeId, vorschlag.mahnstufeId, vorschlag.stufe,
     vorschlag.mahndatum, vorschlag.zahlbarBis,
     vorschlag.forderungCent.toString(), vorschlag.gebuehrCent.toString(),
     vorschlag.zinsenCent.toString(), vorschlag.gesamtCent.toString()]);
  if (kopf === undefined) {
    throw new Error('Der Mahnungsentwurf wurde nicht angelegt.');
  }

  for (const p of vorschlag.positionen) {
    await db.abfrage(
      `insert into mahnung_position
         (mandant_id, mahnung_id, rechnung_id, offener_posten_id, offener_betrag_cent,
          faellig_am, verzugsbeginn_am, verzugsbeginn_regel, verzugstage,
          zins_bp, zins_methode, zins_cent, erstellt_von_art, erstellt_von_dienst)
       values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid, $4::bigint,
               $5::date, $6::date, $7::verzugsbeginn_regel, $8, $9,
               $10::zins_methode, $11::bigint, 'system', 'fin/mahnung/lauf')`,
      [kopf.id, p.rechnungId, p.offenerPostenId, p.offenCent.toString(),
       p.faelligAm, p.verzugsbeginnAm, p.verzugsbeginnRegel, p.verzugstage,
       p.zinsBp, p.zinsMethode, p.zinsCent.toString()]);
  }

  return kopf.id;
}

/** Die Meldung des Wächters — sie nennt Zahlen, nicht „es gibt etwas". */
export function meldung(lage: Lauflage): string {
  if (lage.vorschlaege.length === 0) {
    return lage.uebergangen.length === 0
      ? 'Keine überfällige Forderung.'
      : `Kein Mahnvorschlag: ${String(lage.uebergangen.length)} Forderung(en) übergangen — `
        + [...new Set(lage.uebergangen.map((u) => u.grund))].slice(0, 3).join(' · ');
  }
  const summe = lage.vorschlaege.reduce((s, v) => s + v.gesamtCent, 0n);
  return `${String(lage.vorschlaege.length)} Mahnvorschlag/-vorschläge über `
    + `${String(summe)} Cent, ${String(lage.uebergangen.length)} übergangen.`;
}
