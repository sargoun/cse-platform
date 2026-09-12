/**
 * Zeit → Auftrag (TIM-12, FIN-07, FIN-18).
 *
 * TIM-12 sagt: „Zeit haengt am Auftrag — keine manuelle Uebertragung in die
 * Abrechnung." Der Weg dorthin ist eine Kette aus Schluesseln und kein
 * Uebertrag:
 *
 *   einsatz.auftrag_leistung_id  →  (Ausloeser `z_erben`, 0034)
 *   zeiteintrag.auftrag_leistung_id
 *                                →  (`z_leistung_fk`, 0050)
 *   auftrag_leistung.auftrag_id (NOT NULL)
 *                                →  auftrag
 *
 * Damit loest jeder Eintrag mit Leistungsbezug auf GENAU EINEN Auftrag auf.
 * Das ist eine Eigenschaft der Schluessel, nicht eine Zusage dieses Moduls —
 * und deshalb steht die Aufloesung als Sicht in der Datenbank
 * (`zeiteintrag_auftrag`) und wird hier nur gelesen.
 *
 * **Der zweite Teil ist der wichtigere: was NICHT aufloest, wird gemeldet.**
 * Der naheliegende Entwurf schreibt einen `inner join` in die
 * Abrechnungsabfrage. Der laesst genau die Eintraege still verschwinden, die
 * jemand ansehen muesste — eine geleistete Stunde, die niemand abrechnet,
 * faellt erst auf, wenn der Kunde sie nicht bezahlt hat, und dann steht in
 * keiner Zeile, dass sie je da war. `listeOhneAuftrag` ist deshalb kein
 * Zusatz, sondern die Haelfte der Zusage.
 */
import type { LeseKontext } from '../../kontext/index.js';

export interface ZeitMitAuftrag {
  readonly zeiteintragId: string;
  readonly mandantId: string;
  readonly anstellungId: string;
  readonly personId: string;
  readonly einsatzId: string | null;
  readonly auftragLeistungId: string;
  readonly auftragId: string;
  readonly auftragsnummer: string;
  readonly positionNr: number;
  readonly leistung: string;
  readonly beginn: Date;
  readonly ende: Date | null;
  readonly nettoMinuten: number | null;
  readonly freigegebenAm: Date | null;
  readonly abgerechnetAm: Date | null;
}

/**
 * Warum ein Eintrag auf keinen Auftrag zeigt. Drei Ursachen, drei
 * Handlungen — deshalb ein Wert und nicht nur ein Fehlen.
 */
export type OhneAuftragUrsache =
  /** Ungeplante Arbeit: Abruf, Notdienst. Die Planung ordnet nachtraeglich zu. */
  | 'ohne_einsatz'
  /** Die Schicht selbst traegt keinen Abrechnungsanker — der Turnus oder der
   *  Posten dahinter ist nicht mit einer Leistungszeile verbunden. */
  | 'einsatz_ohne_leistung'
  /** Die Schicht hatte einen Anker, der Eintrag nicht — er wurde vor dem
   *  Erben gesetzt oder die Zeile wurde spaeter entfernt. */
  | 'leistung_entfernt';

export interface ZeitOhneAuftrag {
  readonly zeiteintragId: string;
  readonly mandantId: string;
  readonly anstellungId: string;
  readonly personId: string;
  readonly einsatzId: string | null;
  readonly objektId: string | null;
  readonly beginn: Date;
  readonly ende: Date | null;
  readonly nettoMinuten: number | null;
  readonly freigegebenAm: Date | null;
  readonly ursache: OhneAuftragUrsache;
}

export interface ZeitAuftragFilter {
  readonly auftragId?: string;
  readonly anstellungId?: string;
  readonly vonUtc?: Date;
  readonly bisUtc?: Date;
  /** FIN-07: die Abrechnung sieht nur, was freigegeben und offen ist. */
  readonly nurAbrechenbar?: boolean;
}

interface Bau { readonly wo: string; readonly werte: readonly unknown[] }

function bedingungen(filter: ZeitAuftragFilter, mitAuftrag: boolean): Bau {
  const werte: unknown[] = [];
  const teile: string[] = [];
  if (mitAuftrag && filter.auftragId !== undefined) {
    werte.push(filter.auftragId);
    teile.push(`auftrag_id = $${String(werte.length)}`);
  }
  if (filter.anstellungId !== undefined) {
    werte.push(filter.anstellungId);
    teile.push(`anstellung_id = $${String(werte.length)}`);
  }
  if (filter.vonUtc !== undefined) {
    werte.push(filter.vonUtc.toISOString());
    teile.push(`beginn_zeitpunkt >= $${String(werte.length)}::timestamptz`);
  }
  if (filter.bisUtc !== undefined) {
    werte.push(filter.bisUtc.toISOString());
    teile.push(`beginn_zeitpunkt < $${String(werte.length)}::timestamptz`);
  }
  if (mitAuftrag && filter.nurAbrechenbar === true) {
    teile.push('freigegeben_am is not null', 'abgerechnet_am is null');
  }
  return { wo: teile.length === 0 ? '' : `where ${teile.join(' and ')}`, werte };
}

/** Die aufgeloesten Eintraege — Zeit mit ihrem Auftrag. */
export async function listeMitAuftrag(
  kontext: LeseKontext,
  filter: ZeitAuftragFilter = {},
): Promise<readonly ZeitMitAuftrag[]> {
  const { wo, werte } = bedingungen(filter, true);
  const zeilen = await kontext.abfrage<{
    zeiteintrag_id: string; mandant_id: string; anstellung_id: string; person_id: string;
    einsatz_id: string | null; auftrag_leistung_id: string; auftrag_id: string;
    auftragsnummer: string; position_nr: number; leistung: string;
    beginn_zeitpunkt: Date; ende_zeitpunkt: Date | null;
    dauer_netto_minuten: number | null;
    freigegeben_am: Date | null; abgerechnet_am: Date | null;
  }>(
    `select zeiteintrag_id, mandant_id, anstellung_id, person_id, einsatz_id,
            auftrag_leistung_id, auftrag_id, auftragsnummer, position_nr, leistung,
            beginn_zeitpunkt, ende_zeitpunkt, dauer_netto_minuten,
            freigegeben_am, abgerechnet_am
       from zeiteintrag_auftrag
       ${wo}
      order by beginn_zeitpunkt asc, zeiteintrag_id asc`,
    werte,
  );
  return zeilen.map((z) => ({
    zeiteintragId: z.zeiteintrag_id,
    mandantId: z.mandant_id,
    anstellungId: z.anstellung_id,
    personId: z.person_id,
    einsatzId: z.einsatz_id,
    auftragLeistungId: z.auftrag_leistung_id,
    auftragId: z.auftrag_id,
    auftragsnummer: z.auftragsnummer,
    positionNr: Number(z.position_nr),
    leistung: z.leistung,
    beginn: z.beginn_zeitpunkt,
    ende: z.ende_zeitpunkt,
    nettoMinuten: z.dauer_netto_minuten === null ? null : Number(z.dauer_netto_minuten),
    freigegebenAm: z.freigegeben_am,
    abgerechnetAm: z.abgerechnet_am,
  }));
}

/**
 * Die Gegenliste: Eintraege, die auf keinen Auftrag aufloesen (FIN-18).
 *
 * Sie ist der Bericht, den PR 36 zusagt — „gemeldet, nie verworfen". Ohne ihn
 * waere die Zusage nur die Abwesenheit einer Zeile in einer anderen Liste.
 */
export async function listeOhneAuftrag(
  kontext: LeseKontext,
  filter: ZeitAuftragFilter = {},
): Promise<readonly ZeitOhneAuftrag[]> {
  const { wo, werte } = bedingungen(filter, false);
  const zeilen = await kontext.abfrage<{
    zeiteintrag_id: string; mandant_id: string; anstellung_id: string; person_id: string;
    einsatz_id: string | null; objekt_id: string | null;
    beginn_zeitpunkt: Date; ende_zeitpunkt: Date | null;
    dauer_netto_minuten: number | null; freigegeben_am: Date | null;
    ursache: OhneAuftragUrsache;
  }>(
    `select zeiteintrag_id, mandant_id, anstellung_id, person_id, einsatz_id, objekt_id,
            beginn_zeitpunkt, ende_zeitpunkt, dauer_netto_minuten, freigegeben_am, ursache
       from zeiteintrag_ohne_auftrag
       ${wo}
      order by beginn_zeitpunkt asc, zeiteintrag_id asc`,
    werte,
  );
  return zeilen.map((z) => ({
    zeiteintragId: z.zeiteintrag_id,
    mandantId: z.mandant_id,
    anstellungId: z.anstellung_id,
    personId: z.person_id,
    einsatzId: z.einsatz_id,
    objektId: z.objekt_id,
    beginn: z.beginn_zeitpunkt,
    ende: z.ende_zeitpunkt,
    nettoMinuten: z.dauer_netto_minuten === null ? null : Number(z.dauer_netto_minuten),
    freigegebenAm: z.freigegeben_am,
    ursache: z.ursache,
  }));
}

/**
 * Die Zahl fuer die Kachel — dieselbe Sicht wie die Liste darunter.
 *
 * Zwei Quellen fuer eine Aussage driften, und eine Kachel, die etwas anderes
 * sagt als die Liste, ist schlimmer als keine (DSH-04).
 */
export async function zaehleOhneAuftrag(kontext: LeseKontext): Promise<number> {
  const [zeile] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl from zeiteintrag_ohne_auftrag`,
  );
  return Number(zeile?.anzahl ?? '0');
}
