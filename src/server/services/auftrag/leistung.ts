import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import {
  HandAngebotFehler, mengeAusEingabe, preisAusEingabe, steuersaetzeAm,
} from '../angebot/von-hand.js';
import { istGueltigerKalendertag } from '../../../lib/datum/kalendertag.js';

/**
 * **Die Leistungszeilen eines Auftrags haben einen Schreibweg** (V-360,
 * O-921, D-796, D-825).
 *
 * `auftrag_leistung` (0050) ist der Anker, auf den Turnus, Einsatz,
 * Zeiteintrag, Aufmass, LV-Position und Rechnungszeile zeigen (FIN-07,
 * TIM-12) — und entstand bis hierher nur im Seed. `wandleInAuftrag` legte aus
 * einem angenommenen Angebot den Auftragskopf an und keine Zeile; ohne Zeile
 * setzte niemand einen Leistungsanker (V-191), die Zeit eines neuen Auftrags
 * erreichte keine Abrechnungsart, und eine Preisanpassung hatte keinen Ort.
 *
 * **Drei Wege:**
 *  1. **Übernahme** (`uebernehmeAngebotspositionen` in `./leistung-uebernahme.ts`,
 *     aus `wandleInAuftrag`):
 *     jede Position des Typs `leistung` wird eine Zeile, ab dem Start des
 *     Auftrags, mit Menge, Einheit, Preis und Steuer des Angebots und dem
 *     Verweis auf die Angebotsposition (OPS-09). Alternativ- und
 *     Bedarfspositionen sind nicht beauftragt, Text und Zwischensumme keine
 *     Leistung.
 *  2. **Anlegen** (`legeLeistungszeileAn`): eine nachträglich vereinbarte
 *     Leistung. Der Steuersatz kommt am Stichtag aus `steuersatz_gruppe`, nie
 *     als Zahl aus dem Formular (wie das Angebot von Hand).
 *  3. **Beenden** (`beendeLeistungszeile`): `gueltig_bis` EINSCHLIESSLICH;
 *     die Zeile bleibt (Invariante 8). Nicht vor einem schon erfassten
 *     Zeiteintrag und nicht vor einer geplanten Schicht, die an ihr hängt —
 *     sonst stünde Zeit an einer Position, die an ihrem Tag nicht vereinbart
 *     war.
 *
 * **Eine Preisanpassung ist eine neue, datierte Zeile** (Voreinstellung
 * O-921, D-796) — als eigener Vorgang (`passePreisAn`, D-826): die neue
 * Zeile nennt die bisherige (`ersetzt_id`), gilt ab dem Stichtag und
 * übernimmt alles ausser dem Preis; die bisherige endet am Vortag. Die
 * geplanten Schichten ab dem Stichtag hängt derselbe Vorgang um, und der
 * Auslöser `kern.einsatz_auftrag_ableiten` (0519) gibt jeder künftigen
 * Schicht die Fassung ihres Plantags — Turnus und Posten behalten ihren
 * Anker. Der Auftragswert ändert sich dabei nicht — bei einem Auftrag aus
 * einem Angebot bleibt er der Wert des Angebots (D-732, V-239).
 *
 * Was an einer Zeile hängt, zählt `app.leistung_bindung` (0519) als
 * `cse_definer`: unabhängig davon, ob der Aufrufer Zeiten und Dienstplan
 * lesen darf.
 *
 * Geschrieben wird unter `auftrag.schreiben` (die Policy `t_mandant` aus
 * 0050); das Prüfprotokoll schreibt der Auslöser `trg_auftrag_leistung_audit`.
 *
 * TODO(client, O-921): Voreinstellung — der Wert aus dem Angebot bleibt;
 * eine Preisanpassung ist eine neue datierte Zeile. D-796, D-825.
 */

export type LeistungFehlerGrund =
  | 'unbekannter_auftrag' | 'auftrag_beendet' | 'ohne_bezeichnung' | 'zu_lang'
  | 'keine_menge' | 'kein_betrag' | 'keine_einheit' | 'kein_steuersatz' | 'kein_datum'
  | 'vor_auftragsbeginn' | 'nach_laufzeit' | 'unbekannte_zeile' | 'schon_beendet'
  | 'ende_vor_beginn' | 'zeit_danach' | 'schichten_danach' | 'unbekannter_vorgang'
  | 'schon_ersetzt' | 'stichtag_zu_frueh' | 'gleicher_preis' | 'schichten_nicht_umhaengbar';

export class LeistungFehler extends Error {
  constructor(readonly grund: LeistungFehlerGrund, satz?: string) {
    super(satz ?? grund);
    this.name = 'LeistungFehler';
  }
}

/** Die Zustände, in denen ein Auftrag noch Leistungen vereinbart (0389). */
export const PFLEGBARE_AUFTRAGSZUSTAENDE = ['angelegt', 'aktiv', 'pausiert'] as const;

export interface Leistungszeile {
  readonly id: string;
  readonly positionNr: number;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  /** Fertig formatiert aus der Datenbank (`numeric(12,3)`), nie in JavaScript gerechnet. */
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelpreisCent: bigint | null;
  readonly gesamtpreisCent: bigint;
  readonly steuersatzBp: number;
  readonly steuerKennzeichen: string;
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
  /** Lebt die Zeile heute (Berliner Tag)? */
  readonly lebt: boolean;
  readonly ausAngebot: boolean;
  /** Die Position, die diese Zeile ersetzt (Preisanpassung, D-826) — sonst `null`. */
  readonly ersetztPosition: number | null;
  /** Die Position, die diese Zeile ab ihrem Ende ersetzt — sonst `null`. */
  readonly ersetztDurchPosition: number | null;
}

/** Alle Zeilen eines Auftrags, laufende und beendete, nach Position. */
export async function leseLeistungszeilen(
  kontext: LeseKontext, auftragId: string,
): Promise<readonly Leistungszeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; position_nr: number; bezeichnung: string; beschreibung: string | null;
    menge: string | null; einheit: string | null; einzelpreis_cent: string | null;
    gesamtpreis_cent: string; steuersatz_bp: number; steuer_kennzeichen: string;
    gueltig_ab: string; gueltig_bis: string | null; lebt: boolean; aus_angebot: boolean;
    ersetzt_position: number | null; ersetzt_durch_position: number | null;
  }>(
    `select al.id, al.position_nr, al.bezeichnung, al.beschreibung,
            al.menge::text as menge, al.einheit, al.einzelpreis_cent::text as einzelpreis_cent,
            al.gesamtpreis_cent::text as gesamtpreis_cent, al.steuersatz_bp,
            al.steuer_kennzeichen::text as steuer_kennzeichen,
            al.gueltig_ab::text as gueltig_ab, al.gueltig_bis::text as gueltig_bis,
            (al.gueltig_ab <= app.berlin_heute()
              and (al.gueltig_bis is null or al.gueltig_bis >= app.berlin_heute())) as lebt,
            al.angebotsposition_id is not null as aus_angebot,
            vor.position_nr as ersetzt_position, nach.position_nr as ersetzt_durch_position
       from auftrag_leistung al
       left join auftrag_leistung vor
         on vor.mandant_id = al.mandant_id and vor.id = al.ersetzt_id
       left join auftrag_leistung nach
         on nach.mandant_id = al.mandant_id and nach.ersetzt_id = al.id
      where al.auftrag_id = $1::uuid and al.mandant_id = app.aktiver_mandant()
      order by al.position_nr`,
    [auftragId]);
  return zeilen.map((z) => ({
    id: z.id,
    positionNr: Number(z.position_nr),
    bezeichnung: z.bezeichnung,
    beschreibung: z.beschreibung,
    menge: z.menge,
    einheit: z.einheit,
    einzelpreisCent: z.einzelpreis_cent === null ? null : BigInt(z.einzelpreis_cent),
    gesamtpreisCent: BigInt(z.gesamtpreis_cent),
    steuersatzBp: z.steuersatz_bp,
    steuerKennzeichen: z.steuer_kennzeichen,
    gueltigAb: z.gueltig_ab,
    gueltigBis: z.gueltig_bis,
    lebt: z.lebt,
    ausAngebot: z.aus_angebot,
    ersetztPosition: z.ersetzt_position === null ? null : Number(z.ersetzt_position),
    ersetztDurchPosition:
      z.ersetzt_durch_position === null ? null : Number(z.ersetzt_durch_position),
  }));
}

/** Was nach einem Tag an einer Zeile hängt — als `cse_definer` gezählt (0519). */
async function bindungNach(
  kontext: SchreibKontext, zeileId: string, nach: string,
): Promise<{ readonly zeiten: number; readonly schichten: number }> {
  const [b] = await kontext.abfrage<{ zeiten: number; schichten: number }>(
    `select zeiten, schichten from app.leistung_bindung($1::uuid, $2::date)`,
    [zeileId, nach]);
  return { zeiten: Number(b?.zeiten ?? 0), schichten: Number(b?.schichten ?? 0) };
}

/** Sperrt den Auftrag und prüft, dass er noch Leistungen vereinbart. */
async function sperreAuftrag(
  kontext: SchreibKontext, auftragId: string,
): Promise<{ readonly start: string; readonly bis: string | null }> {
  const [a] = await kontext.abfrage<{ status: string; start: string; bis: string | null }>(
    `select status::text as status, start_datum::text as start, laufzeit_bis::text as bis
       from auftrag
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
      for update`, [auftragId]);
  if (a === undefined) throw new LeistungFehler('unbekannter_auftrag');
  if (!(PFLEGBARE_AUFTRAGSZUSTAENDE as readonly string[]).includes(a.status)) {
    throw new LeistungFehler('auftrag_beendet');
  }
  return { start: a.start, bis: a.bis };
}

function text(wert: string | null | undefined, max: number): string | null {
  const t = (wert ?? '').trim();
  if (t === '') return null;
  if (t.length > max) throw new LeistungFehler('zu_lang');
  return t;
}

export interface LeistungEingabe {
  readonly bezeichnung: string;
  readonly beschreibung?: string | null;
  /** Deutsch oder englisch geschrieben, höchstens drei Nachkommastellen. */
  readonly menge: string;
  /** Der Schlüssel aus `masseinheit`. */
  readonly einheit: string;
  /** In Euro, deutsche Schreibweise. */
  readonly einzelpreis: string;
  /** Der Schlüssel aus `steuersatz_gruppe` — nie ein Satz als Zahl. */
  readonly steuersatz: string;
  /** `JJJJ-MM-TT`, der erste Tag, an dem die Zeile gilt. */
  readonly gueltigAb: string;
}

/** Eine nachträglich vereinbarte Leistung — am Ende der Positionsliste. */
export async function legeLeistungszeileAn(
  kontext: SchreibKontext, auftragId: string, e: LeistungEingabe,
): Promise<string> {
  const bezeichnung = text(e.bezeichnung, 200);
  if (bezeichnung === null) throw new LeistungFehler('ohne_bezeichnung');
  const beschreibung = text(e.beschreibung, 2000);
  if (!istGueltigerKalendertag(e.gueltigAb)) throw new LeistungFehler('kein_datum');

  let menge: bigint;
  let preis: bigint;
  try {
    menge = mengeAusEingabe(e.menge) as bigint;
  } catch (fehler) {
    if (fehler instanceof HandAngebotFehler) throw new LeistungFehler('keine_menge');
    throw fehler;
  }
  try {
    preis = preisAusEingabe(e.einzelpreis) as bigint;
  } catch (fehler) {
    if (fehler instanceof HandAngebotFehler) throw new LeistungFehler('kein_betrag');
    throw fehler;
  }

  const auftrag = await sperreAuftrag(kontext, auftragId);
  if (e.gueltigAb < auftrag.start) throw new LeistungFehler('vor_auftragsbeginn');
  if (auftrag.bis !== null && e.gueltigAb > auftrag.bis) throw new LeistungFehler('nach_laufzeit');

  const [einheit] = await kontext.abfrage<{ schluessel: string }>(
    `select schluessel from masseinheit where schluessel = $1`, [e.einheit]);
  if (einheit === undefined) throw new LeistungFehler('keine_einheit');

  const satz = (await steuersaetzeAm(kontext, e.gueltigAb))
    .find((s) => s.schluessel === e.steuersatz);
  if (satz === undefined) throw new LeistungFehler('kein_steuersatz');

  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into auftrag_leistung
       (mandant_id, auftrag_id, position_nr, bezeichnung, beschreibung, menge, einheit,
        einzelpreis_cent, steuersatz_bp, steuer_kennzeichen, steuerbefreiung_grund,
        gueltig_ab, erstellt_von)
     select app.aktiver_mandant(), $1::uuid,
            coalesce((select max(position_nr) from auftrag_leistung
                       where auftrag_id = $1::uuid), 0) + 1,
            $2, $3, $4::numeric / 1000, $5, $6::bigint, $7::int, $8::steuer_kennzeichen, $9,
            $10::date, app.aktueller_benutzer()
     returning id`,
    [auftragId, bezeichnung, beschreibung, menge.toString(), einheit.schluessel,
      preis.toString(), satz.satzBp, satz.kennzeichen, satz.befreiungsgrundText,
      e.gueltigAb]);
  if (z === undefined) throw new LeistungFehler('unbekannter_auftrag');
  return z.id;
}

interface GesperrteZeile {
  readonly gueltig_ab: string;
  readonly gueltig_bis: string | null;
  readonly einzelpreis_cent: string | null;
  /** Hat die Zeile schon eine Nachfolgerin (Preisanpassung)? */
  readonly nachfolgerin: boolean;
  /** Das Ende der Laufzeit des Auftrags — `null` ohne. */
  readonly auftragBis: string | null;
}

/**
 * Erst der Auftrag, DANN die Zeile — und die gesperrt gelesen. Zwei
 * gleichzeitige Vorgänge an derselben Zeile läsen sonst beide den alten
 * Stand, und der zweite schöbe zurück, was der erste entschieden hat. Die
 * Sperre auf der Zeile hält zugleich jede Schicht und jede Zeit an, die
 * gerade auf sie zeigen will: deren Fremdschlüssel wartet, bis hier
 * entschieden ist, und was davor eingetragen war, zählt die Prüfung mit.
 */
async function sperreZeile(
  kontext: SchreibKontext, auftragId: string, zeileId: string,
): Promise<GesperrteZeile> {
  const auftrag = await sperreAuftrag(kontext, auftragId);
  const [z] = await kontext.abfrage<Omit<GesperrteZeile, 'auftragBis'>>(
    `select al.gueltig_ab::text as gueltig_ab, al.gueltig_bis::text as gueltig_bis,
            al.einzelpreis_cent::text as einzelpreis_cent,
            exists (select 1 from auftrag_leistung n
                     where n.mandant_id = al.mandant_id and n.ersetzt_id = al.id) as nachfolgerin
       from auftrag_leistung al
      where al.id = $1::uuid and al.auftrag_id = $2::uuid
        and al.mandant_id = app.aktiver_mandant()
      for update of al`, [zeileId, auftragId]);
  if (z === undefined) throw new LeistungFehler('unbekannte_zeile');
  return { ...z, auftragBis: auftrag.bis };
}

/**
 * Beendet eine Zeile zum `gueltigBis` (EINSCHLIESSLICH). Die Zeile bleibt —
 * mit ihren Zeiten, Nachweisen und Rechnungen.
 */
export async function beendeLeistungszeile(
  kontext: SchreibKontext, auftragId: string, zeileId: string, gueltigBis: string,
): Promise<void> {
  if (!istGueltigerKalendertag(gueltigBis)) throw new LeistungFehler('kein_datum');
  const z = await sperreZeile(kontext, auftragId, zeileId);
  if (z.nachfolgerin) throw new LeistungFehler('schon_ersetzt');
  if (z.gueltig_bis !== null && z.gueltig_bis <= gueltigBis) {
    throw new LeistungFehler('schon_beendet');
  }
  if (gueltigBis < z.gueltig_ab) throw new LeistungFehler('ende_vor_beginn');

  /*
   * Nicht vor dem, was schon an der Zeile hängt: ein Zeiteintrag, dessen
   * Berliner Tag nach dem Ende liegt, stünde an einer Position, die an
   * seinem Tag nicht vereinbart war; eine geplante Schicht danach ebenso.
   * Gezählt als `cse_definer` (0519) — auch was der Aufrufer nicht lesen darf.
   */
  const danach = await bindungNach(kontext, zeileId, gueltigBis);
  if (danach.zeiten > 0) throw new LeistungFehler('zeit_danach');
  if (danach.schichten > 0) throw new LeistungFehler('schichten_danach');

  const [geaendert] = await kontext.schreibe<{ id: string }>(
    `update auftrag_leistung
        set gueltig_bis = $2::date, geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
      returning id`, [zeileId, gueltigBis]);
  if (geaendert === undefined) throw new LeistungFehler('unbekannte_zeile');
}

export interface PreisAnpassung {
  /** Der neue Einzelpreis in Euro, deutsche Schreibweise. */
  readonly einzelpreis: string;
  /** `JJJJ-MM-TT`, der erste Tag des neuen Preises. */
  readonly stichtag: string;
}

/**
 * **Eine Preisanpassung** (Voreinstellung O-921, D-796, D-826): eine neue
 * Zeile ab dem Stichtag, die die bisherige ersetzt.
 *
 * Die neue Zeile übernimmt Bezeichnung, Beschreibung, Menge, Einheit, Steuer,
 * Objekt, Katalogposition, Erlöskonto, Frequenz und ein schon gesetztes Ende
 * der bisherigen; neu ist nur der Preis. Die bisherige endet am Vortag. Die
 * geplanten Schichten ab dem Stichtag, die noch nicht begonnen haben und
 * keine Zeit tragen, hängen danach an der neuen Zeile.
 *
 * Abgewiesen wird: ein Stichtag am ersten Tag der Zeile oder davor (das wäre
 * eine Berichtigung, keine Anpassung), nach ihrem Ende oder nach der
 * Laufzeit; eine Zeile, die schon ersetzt ist; derselbe Preis; erfasste Zeit
 * ab dem Stichtag (sie bleibt, wo sie ist — eine rückwirkende Anpassung
 * gehört dann in eine Berichtigung der Zeit); und jede Schicht ab dem
 * Stichtag, die sich nicht umhängen lässt — schon begonnen, oder ohne das
 * Recht, den Dienstplan zu schreiben. Dann bleibt alles, wie es war.
 *
 * Gibt die Kennung der neuen Zeile zurück.
 */
export async function passePreisAn(
  kontext: SchreibKontext, auftragId: string, zeileId: string, e: PreisAnpassung,
): Promise<string> {
  if (!istGueltigerKalendertag(e.stichtag)) throw new LeistungFehler('kein_datum');
  let preis: bigint;
  try {
    preis = preisAusEingabe(e.einzelpreis) as bigint;
  } catch (fehler) {
    if (fehler instanceof HandAngebotFehler) throw new LeistungFehler('kein_betrag');
    throw fehler;
  }

  const z = await sperreZeile(kontext, auftragId, zeileId);
  if (z.nachfolgerin) throw new LeistungFehler('schon_ersetzt');
  if (z.gueltig_bis !== null && z.gueltig_bis < e.stichtag) {
    throw new LeistungFehler('schon_beendet');
  }
  if (e.stichtag <= z.gueltig_ab) throw new LeistungFehler('stichtag_zu_frueh');
  if (z.auftragBis !== null && e.stichtag > z.auftragBis) throw new LeistungFehler('nach_laufzeit');
  if (z.einzelpreis_cent !== null && BigInt(z.einzelpreis_cent) === preis) {
    throw new LeistungFehler('gleicher_preis');
  }
  const [vortag] = await kontext.abfrage<{ tag: string }>(
    `select ($1::date - 1)::text as tag`, [e.stichtag]);
  const ende = vortag!.tag;
  if ((await bindungNach(kontext, zeileId, ende)).zeiten > 0) {
    throw new LeistungFehler('zeit_danach');
  }

  const [neu] = await kontext.schreibe<{ id: string }>(
    `insert into auftrag_leistung
       (mandant_id, auftrag_id, position_nr, ersetzt_id, leistungskatalog_position_id,
        objekt_id, bezeichnung, beschreibung, menge, einheit, einzelpreis_cent,
        steuersatz_bp, steuer_kennzeichen, steuerbefreiung_grund, erloeskonto_schluessel,
        leistungsfrequenz_text, gueltig_ab, gueltig_bis, erstellt_von)
     select al.mandant_id, al.auftrag_id,
            (select max(x.position_nr) from auftrag_leistung x
              where x.auftrag_id = al.auftrag_id) + 1,
            al.id, al.leistungskatalog_position_id, al.objekt_id, al.bezeichnung,
            al.beschreibung, al.menge, al.einheit, $2::bigint, al.steuersatz_bp,
            al.steuer_kennzeichen, al.steuerbefreiung_grund, al.erloeskonto_schluessel,
            al.leistungsfrequenz_text, $3::date, al.gueltig_bis, app.aktueller_benutzer()
       from auftrag_leistung al
      where al.id = $1::uuid and al.mandant_id = app.aktiver_mandant()
     returning id`,
    [zeileId, preis.toString(), e.stichtag]);
  if (neu === undefined) throw new LeistungFehler('unbekannte_zeile');

  await kontext.schreibe(
    `update auftrag_leistung
        set gueltig_bis = $2::date, geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [zeileId, ende]);

  /*
   * Die geplanten Schichten ab dem Stichtag — unter der RLS des Aufrufers
   * (`dienstplan.schreiben`). Was danach noch an der alten Zeile hängt, hat
   * schon begonnen oder liegt ausserhalb seines Rechts: dann bleibt alles,
   * wie es war, statt still einen Teil mit dem alten Preis stehen zu lassen.
   */
  await kontext.schreibe(
    `update einsatz e
        set auftrag_leistung_id = $2::uuid
      where e.mandant_id = app.aktiver_mandant() and e.auftrag_leistung_id = $1::uuid
        and e.plan_datum >= $3::date and e.storniert_am is null
        and e.beginn_zeitpunkt > now()
        and not app.einsatz_hat_zeiterfassung(e.id)`, [zeileId, neu.id, e.stichtag]);
  if ((await bindungNach(kontext, zeileId, ende)).schichten > 0) {
    throw new LeistungFehler('schichten_nicht_umhaengbar');
  }
  return neu.id;
}
