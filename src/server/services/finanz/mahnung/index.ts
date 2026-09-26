import 'server-only';
import type { SchreibKontext } from '../../../kontext/index.js';
import { gate, nutzlastHash, type Freigabe, type Nutzlast, type Richtlinie }
  from '../../../agent/policy.js';
import type { Speicher } from '../../../storage/adapter.js';
import { ladeHoch } from '../../dokument/upload.js';
import { schreibeTextPdf } from '../../dokument/pdf.js';
import { erteileFreigabe } from '../../freigabe/erteilen.js';
import { cent, formatiereGeld, type Cent } from '../geld.js';
import { prozentText } from '../prozent.js';
import { tagDeutsch } from '../../../../lib/datum/kalendertag.js';

/**
 * Der Weg einer Mahnung vom Entwurf bis zum Briefkasten (FIN-15,
 * `05-FINANZEN.md` §10, PR 55).
 *
 * **Der Lauf schlägt vor, ein Mensch entscheidet, und erst danach geht etwas
 * hinaus.** `lauf.ts` erzeugt Entwürfe; hier sind die drei Schritte, die ein
 * Mensch auslöst:
 *
 *   1. `verwirf` — der Entwurf war falsch, und der Grund bleibt stehen.
 *   2. `gibFrei` — die Freigabe nach K-13 entsteht, DANN kippt der Zustand,
 *      und erst dabei zieht die Datenbank die Nummer. Ein Entwurf trägt
 *      keine (`mahnung_entwurf_ohne_nummer`).
 *   3. `dokumentiereVersand` — der Versand geht durch `agent/policy.ts`
 *      (Invariante 7), das Schreiben wird als PDF abgelegt, und erst danach
 *      steht das Absendedatum. Der Auslöser `mahnung_2_versand` schreibt
 *      dann `letzte_mahnstufe` und `letzte_mahnung_am` auf den Posten fort —
 *      das ist der Zeitpunkt, ab dem §286 BGB den Verzug laufen lässt.
 *
 * **Es gibt keinen Mailversand, und es wird keiner vorgetäuscht.** Die
 * Mahnung geht als Brief, Einschreiben oder durch Boten hinaus; ein Mensch
 * tut das und dokumentiert es hier. `e_mail` und `portal` werden abgewiesen,
 * solange kein Kanal verbunden ist — und das Kundenportal zeigt ohnehin keine
 * Mahnungen (§7.5).
 *
 * **Gerechnet wird hier nichts.** Beträge stehen auf der Mahnung, seit der
 * Lauf sie geschrieben hat; dieser Dienst liest sie und stellt sie dar.
 */

export type MahnungStatus =
  'entwurf' | 'freigegeben' | 'versendet' | 'erledigt' | 'verworfen';

export type Versandart = 'brief' | 'einschreiben' | 'bote' | 'e_mail' | 'portal';

/** Die Kanäle, die ein MENSCH bedient — hier wird dokumentiert, nicht gesendet. */
export const MENSCHLICHE_KANAELE: readonly Versandart[] = ['brief', 'einschreiben', 'bote'];

export class KanalNichtVerbundenFehler extends Error {
  readonly code = 'KANAL_NICHT_VERBUNDEN' as const;
  constructor(readonly kanal: Versandart) {
    super(
      `Der Kanal „${kanal}" ist nicht verbunden. Es gibt in dieser Anwendung `
      + 'keinen automatischen Versand (O-116); die Mahnung geht als Brief, '
      + 'Einschreiben oder durch Boten hinaus und wird hier dokumentiert.',
    );
    this.name = 'KanalNichtVerbundenFehler';
  }
}

export class MahnungFehler extends Error {
  constructor(
    readonly grund:
      | 'nicht_gefunden' | 'kein_entwurf' | 'nicht_freigegeben'
      | 'schon_versendet' | 'ohne_position' | 'ohne_grund'
      | 'zeichen_nicht_darstellbar'
      /** Erledigt wird nur, was versendet wurde (V-084). */
      | 'nicht_versendet',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'MahnungFehler';
  }
}

export interface MahnungZeile {
  readonly id: string;
  readonly nummer: string | null;
  readonly kundeId: string;
  readonly kundeName: string;
  readonly stufe: number;
  readonly bezeichnung: string;
  readonly status: MahnungStatus;
  readonly mahndatum: string;
  readonly zahlbarBis: string;
  readonly forderungCent: Cent;
  readonly gebuehrCent: Cent;
  readonly zinsenCent: Cent;
  readonly gesamtCent: Cent;
  readonly versendetAm: string | null;
  readonly verworfenGrund: string | null;
  readonly stufensprungGrund: string | null;
  /**
   * `mandant_identitaet.brief_fuss` — die stehende Briefzeile der
   * Gesellschaft (V-099, K-12).
   *
   * Sie war pflegbar unter Einstellungen › Identität und erreichte **kein
   * einziges Dokument**: der Spaltenname kam im ganzen Baum nur in der
   * Anzeige derselben Einstellungsseite vor.
   */
  readonly briefFuss: string | null;
  /**
   * Der Absender mit den Angaben, die auf einen Geschäftsbrief gehören
   * (V-213, § 35a GmbHG) — aus `mandant`, dieselben Spalten wie das
   * Angebotsblatt. Vorher stand im Schreiben kein Absender.
   */
  readonly absender: MahnAbsender;
  /** Die Postanschrift des Empfängers (V-213) — vorher nur „Kunde: Name". */
  readonly empfaenger: MahnEmpfaenger;
  /**
   * Der Mahntext der Stufe, WIE SIE GALT (`mahnstufe.textbaustein` der
   * Fassung, auf die die Mahnung zeigt) — `null`, wenn keiner hinterlegt ist
   * (V-214). Einen Wortlaut erfindet der Code nicht.
   */
  readonly textbaustein: string | null;
  /** Das abgelegte Schreiben (ab `versendet`) — `null` davor (V-213). */
  readonly dokumentId: string | null;
  /**
   * Kommen Kundenname, Stufenbezeichnung, Absender, Empfänger, Mahntext und
   * Fusszeile aus dem mit der Freigabe EINGEFRORENEN Brief (`mahnung.brief`,
   * 0449, V-217)? `false` im Entwurf (dort gilt, was heute in den Stammdaten
   * steht) und bei einer Mahnung, die vor 0449 freigegeben wurde.
   */
  readonly briefEingefroren: boolean;
}

/**
 * Der Absender eines Mahnschreibens (V-213).
 *
 * Jede Angabe ist, was in `mandant` steht; fehlt eine, fehlt sie im Brief —
 * und das Mahnungsblatt sagt, welche (`fehlendeBriefkopfangaben`). Erfunden
 * oder aus einer Konstante gefüllt wird nichts: drei Gesellschaften, drei
 * Registereinträge.
 */
export interface MahnAbsender {
  readonly firma: string;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly land: string | null;
  readonly telefon: string | null;
  readonly email: string | null;
  readonly web: string | null;
  readonly registergericht: string | null;
  readonly registernummer: string | null;
  /** Alle Geschäftsführer, mit Komma verbunden — `null`, wenn keiner eingetragen ist. */
  readonly geschaeftsfuehrung: string | null;
  readonly ustId: string | null;
  readonly steuernummer: string | null;
  readonly bank: string | null;
  readonly iban: string | null;
  readonly bic: string | null;
}

/**
 * Wohin das Schreiben geht: die RECHNUNGSanschrift des Kunden, wenn eine
 * abweichende gepflegt ist, sonst seine Anschrift — dieselbe Verzweigung wie
 * auf der Rechnung (`rechnung.ts`), denn gemahnt wird, wer die Rechnung
 * bekommen hat (D-705).
 */
export interface MahnEmpfaenger {
  readonly name: string;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly land: string | null;
}

export type BriefkopfAngabe =
  'anschrift' | 'registergericht' | 'registernummer' | 'geschaeftsfuehrung';

/**
 * Welche Angaben des Briefkopfs leer sind — für den Hinweis auf dem
 * Mahnungsblatt, nicht als Sperre. Ob eine Gesellschaft ohne Registereintrag
 * mahnen darf, entscheidet hier niemand; gesagt wird nur, was fehlt.
 */
export function fehlendeBriefkopfangaben(a: MahnAbsender): readonly BriefkopfAngabe[] {
  const leer = (w: string | null): boolean => w === null || w.trim() === '';
  const fehlt: BriefkopfAngabe[] = [];
  if (leer(a.strasse) || leer(a.plz) || leer(a.ort)) fehlt.push('anschrift');
  if (leer(a.registergericht)) fehlt.push('registergericht');
  if (leer(a.registernummer)) fehlt.push('registernummer');
  if (leer(a.geschaeftsfuehrung)) fehlt.push('geschaeftsfuehrung');
  return fehlt;
}

export interface MahnungPositionZeile {
  readonly rechnungsnummer: string | null;
  readonly offenCent: Cent;
  readonly faelligAm: string;
  readonly verzugsbeginnAm: string | null;
  readonly verzugstage: number;
  readonly zinsBp: number;
  readonly zinsCent: Cent;
}

const KOPF_SQL = `
  select m.id, m.nummer, m.kunde_id, k.name as kunde_name, m.stufe,
         ms.bezeichnung, m.status::text as status,
         m.mahndatum::text as mahndatum, m.zahlbar_bis::text as zahlbar_bis,
         m.forderung_cent::text, m.gebuehr_cent::text, m.zinsen_cent::text,
         m.gesamt_cent::text, m.versendet_am::text as versendet_am,
         m.verworfen_grund, m.stufensprung_grund,
         mi.brief_fuss,
         ms.textbaustein, m.dokument_id, m.brief,
         ma.firma as a_firma, ma.strasse as a_strasse, ma.plz as a_plz, ma.ort as a_ort,
         ma.land::text as a_land, ma.telefon as a_telefon, ma.email as a_email,
         ma.web as a_web,
         ma.handelsregister_gericht as a_gericht, ma.handelsregister_nummer as a_hrb,
         nullif(array_to_string(ma.geschaeftsfuehrer, ', '), '') as a_gf,
         ma.ust_id as a_ust_id, ma.steuernummer as a_steuernummer,
         ma.bank as a_bank, ma.iban as a_iban, ma.bic as a_bic,
         -- Die Rechnungsanschrift, wenn eine abweichende gepflegt ist (V-213,
         -- D-705) - dieselbe Verzweigung wie in rechnung.ts.
         coalesce(nullif(k.rechnung_name, ''), k.name) as e_name,
         case when k.rechnungsadresse_abweichend
              then nullif(concat_ws(' ', k.rechnung_strasse, k.rechnung_hausnummer), '')
              else nullif(concat_ws(' ', k.strasse, k.hausnummer), '')
         end as e_strasse,
         case when k.rechnungsadresse_abweichend then k.rechnung_plz else k.plz end as e_plz,
         case when k.rechnungsadresse_abweichend then k.rechnung_ort else k.ort end as e_ort,
         (case when k.rechnungsadresse_abweichend
               then coalesce(k.rechnung_land, k.land) else k.land end)::text as e_land
    from mahnung m
    join kunde k on k.id = m.kunde_id and k.mandant_id = m.mandant_id
    join mahnstufe ms on ms.id = m.mahnstufe_id and ms.mandant_id = m.mandant_id
    join mandant ma on ma.id = m.mandant_id
    -- LINKS verbunden (V-099): die Identitaetszeile entsteht mit dem Mandanten
    -- (Ausloeser in 0200) und sollte immer da sein — aber eine Mahnung, die
    -- wegen einer fehlenden Fusszeile gar nicht entsteht, waere der teurere
    -- Fehler. Fehlt sie, steht die Fusszeile eben nicht da.
    left join mandant_identitaet mi on mi.mandant_id = m.mandant_id`;

interface KopfRoh {
  id: string; nummer: string | null; kunde_id: string; kunde_name: string;
  stufe: number; bezeichnung: string; status: string; mahndatum: string;
  zahlbar_bis: string; forderung_cent: string; gebuehr_cent: string;
  zinsen_cent: string; gesamt_cent: string; versendet_am: string | null;
  verworfen_grund: string | null; stufensprung_grund: string | null;
  brief_fuss: string | null;
  textbaustein: string | null; dokument_id: string | null;
  a_firma: string; a_strasse: string | null; a_plz: string | null; a_ort: string | null;
  a_land: string | null; a_telefon: string | null; a_email: string | null;
  a_web: string | null; a_gericht: string | null; a_hrb: string | null;
  a_gf: string | null; a_ust_id: string | null; a_steuernummer: string | null;
  a_bank: string | null; a_iban: string | null; a_bic: string | null;
  e_name: string; e_strasse: string | null; e_plz: string | null; e_ort: string | null;
  e_land: string | null;
  brief: unknown;
}

/**
 * **Was im Brief aus Stammdaten kommt — eingefroren mit der Freigabe**
 * (V-217, D-709, 0449).
 *
 * Die Freigabe bindet den ganzen Brief über den Abdruck der Nutzlast
 * (Invariante 7). Gelesen wurde er aber LIVE, und aus `freigegeben` führt
 * kein Weg zurück: wer nach der Freigabe die Kundenanschrift, die
 * Telefonnummer oder die Geschäftsführung pflegte, hatte eine Mahnung, die
 * nie mehr hinausging, nicht verworfen werden konnte und ihre Posten für
 * immer sperrte. Jetzt schreibt `gibFrei` diese Angaben in `mahnung.brief`,
 * aus DENSELBEN Werten, über die der Abdruck entsteht, und ab da liest der
 * Dienst den Brief von dort — Versand, PDF und Mahnungsblatt zeigen den
 * freigegebenen Brief, eine spätere Pflege wirkt auf die nächste Mahnung.
 */
export interface EingefrorenerBrief {
  readonly kunde: string;
  readonly bezeichnung: string;
  readonly absender: MahnAbsender;
  readonly empfaenger: MahnEmpfaenger;
  readonly textbaustein: string | null;
  readonly briefFuss: string | null;
}

/** Der Brief einer Mahnung, wie `gibFrei` ihn in `mahnung.brief` schreibt. */
export function briefZumEinfrieren(kopf: MahnungZeile): EingefrorenerBrief {
  return {
    kunde: kopf.kundeName,
    bezeichnung: kopf.bezeichnung,
    absender: { ...kopf.absender },
    empfaenger: { ...kopf.empfaenger },
    textbaustein: kopf.textbaustein,
    briefFuss: kopf.briefFuss,
  };
}

/*
 * Jedes Feld ausser dem Namen darf leer sein — genau wie in den Stammdaten.
 * Als Satz mit ALLEN Schlüsseln geschrieben: kommt an `MahnAbsender` oder
 * `MahnEmpfaenger` ein Feld dazu, meldet der Übersetzer die Lücke hier, statt
 * dass es beim Zurücklesen still fehlte und der Abdruck nicht mehr passte.
 */
type AbsenderFeld = Exclude<keyof MahnAbsender, 'firma'>;
type EmpfaengerFeld = Exclude<keyof MahnEmpfaenger, 'name'>;
const ABSENDER_SATZ: Readonly<Record<AbsenderFeld, true>> = {
  strasse: true, plz: true, ort: true, land: true, telefon: true, email: true, web: true,
  registergericht: true, registernummer: true, geschaeftsfuehrung: true, ustId: true,
  steuernummer: true, bank: true, iban: true, bic: true,
};
const EMPFAENGER_SATZ: Readonly<Record<EmpfaengerFeld, true>> =
  { strasse: true, plz: true, ort: true, land: true };
const ABSENDER_FELDER = Object.keys(ABSENDER_SATZ) as AbsenderFeld[];
const EMPFAENGER_FELDER = Object.keys(EMPFAENGER_SATZ) as EmpfaengerFeld[];

/**
 * Liest `mahnung.brief` zurück — streng: jedes Feld mit seinem Typ.
 *
 * Eine Spalte, die nicht passt, ist kein Fall für einen stillen Rückfall auf
 * die Stammdaten: dann ginge ein Brief hinaus, den niemand freigegeben hat.
 * Sie wirft, und die Mahnung bleibt stehen, bis jemand hinsieht.
 */
export function briefAusSpalte(wert: unknown): EingefrorenerBrief {
  const kaputt = (feld: string): Error =>
    new Error(`mahnung.brief ist beschädigt (Feld „${feld}"). Der eingefrorene Brief `
      + 'einer Mahnung wird nicht aus den Stammdaten ergänzt.');
  const objekt = (w: unknown, feld: string): Record<string, unknown> => {
    if (typeof w !== 'object' || w === null || Array.isArray(w)) throw kaputt(feld);
    return w as Record<string, unknown>;
  };
  const text = (o: Record<string, unknown>, feld: string, pfad: string): string => {
    const w = o[feld];
    if (typeof w !== 'string') throw kaputt(pfad);
    return w;
  };
  const textOderNull = (o: Record<string, unknown>, feld: string, pfad: string): string | null => {
    const w = o[feld];
    if (w === null) return null;
    if (typeof w !== 'string') throw kaputt(pfad);
    return w;
  };
  /* postgres.js liest jsonb als Objekt; ein Text (anderer Treiber) wird gelesen. */
  const roh: unknown = typeof wert === 'string' ? JSON.parse(wert) as unknown : wert;
  const b = objekt(roh, 'brief');
  const a = objekt(b['absender'], 'absender');
  const e = objekt(b['empfaenger'], 'empfaenger');
  const absender = { firma: text(a, 'firma', 'absender.firma') } as Record<string, string | null>;
  for (const f of ABSENDER_FELDER) absender[f] = textOderNull(a, f, `absender.${f}`);
  const empfaenger = { name: text(e, 'name', 'empfaenger.name') } as Record<string, string | null>;
  for (const f of EMPFAENGER_FELDER) empfaenger[f] = textOderNull(e, f, `empfaenger.${f}`);
  return {
    kunde: text(b, 'kunde', 'kunde'),
    bezeichnung: text(b, 'bezeichnung', 'bezeichnung'),
    absender: absender as unknown as MahnAbsender,
    empfaenger: empfaenger as unknown as MahnEmpfaenger,
    textbaustein: textOderNull(b, 'textbaustein', 'textbaustein'),
    briefFuss: textOderNull(b, 'briefFuss', 'briefFuss'),
  };
}

function zuZeile(r: KopfRoh): MahnungZeile {
  const zeile = zuZeileLive(r);
  if (r.brief === null || r.brief === undefined) return zeile;
  const b = briefAusSpalte(r.brief);
  return {
    ...zeile,
    kundeName: b.kunde,
    bezeichnung: b.bezeichnung,
    absender: b.absender,
    empfaenger: b.empfaenger,
    textbaustein: b.textbaustein,
    briefFuss: b.briefFuss,
    briefEingefroren: true,
  };
}

function zuZeileLive(r: KopfRoh): MahnungZeile {
  return {
    id: r.id, nummer: r.nummer, kundeId: r.kunde_id, kundeName: r.kunde_name,
    stufe: r.stufe, bezeichnung: r.bezeichnung, status: r.status as MahnungStatus,
    mahndatum: r.mahndatum, zahlbarBis: r.zahlbar_bis,
    forderungCent: cent(BigInt(r.forderung_cent)),
    gebuehrCent: cent(BigInt(r.gebuehr_cent)),
    zinsenCent: cent(BigInt(r.zinsen_cent)),
    gesamtCent: cent(BigInt(r.gesamt_cent)),
    versendetAm: r.versendet_am, verworfenGrund: r.verworfen_grund,
    stufensprungGrund: r.stufensprung_grund,
    briefFuss: r.brief_fuss,
    absender: {
      firma: r.a_firma, strasse: r.a_strasse, plz: r.a_plz, ort: r.a_ort,
      land: r.a_land, telefon: r.a_telefon, email: r.a_email, web: r.a_web,
      registergericht: r.a_gericht, registernummer: r.a_hrb,
      geschaeftsfuehrung: r.a_gf, ustId: r.a_ust_id, steuernummer: r.a_steuernummer,
      bank: r.a_bank, iban: r.a_iban, bic: r.a_bic,
    },
    empfaenger: {
      name: r.e_name, strasse: r.e_strasse, plz: r.e_plz, ort: r.e_ort, land: r.e_land,
    },
    textbaustein: r.textbaustein,
    dokumentId: r.dokument_id,
    briefEingefroren: false,
  };
}

export async function mahnungen(
  kontext: SchreibKontext, status?: MahnungStatus,
): Promise<readonly MahnungZeile[]> {
  const zeilen = await kontext.abfrage<KopfRoh>(
    `${KOPF_SQL}
      where ($1::text is null or m.status::text = $1)
      order by m.mahndatum desc, k.name`,
    [status ?? null]);
  return zeilen.map(zuZeile);
}

export async function findeMahnung(
  kontext: SchreibKontext, id: string,
): Promise<{ readonly kopf: MahnungZeile;
             readonly positionen: readonly MahnungPositionZeile[] } | null> {
  const [kopf] = await kontext.abfrage<KopfRoh>(`${KOPF_SQL} where m.id = $1::uuid`, [id]);
  if (kopf === undefined) return null;

  const roh = await kontext.abfrage<{
    rechnungsnummer: string | null; offener_betrag_cent: string; faellig_am: string;
    verzugsbeginn_am: string | null; verzugstage: number; zins_bp: number; zins_cent: string;
  }>(
    `select r.nummer as rechnungsnummer, mp.offener_betrag_cent::text,
            mp.faellig_am::text as faellig_am,
            mp.verzugsbeginn_am::text as verzugsbeginn_am,
            mp.verzugstage, mp.zins_bp, mp.zins_cent::text
       from mahnung_position mp
       join rechnung r on r.id = mp.rechnung_id and r.mandant_id = mp.mandant_id
      where mp.mahnung_id = $1::uuid
      order by mp.faellig_am, r.nummer`, [id]);

  return {
    kopf: zuZeile(kopf),
    positionen: roh.map((p) => ({
      rechnungsnummer: p.rechnungsnummer,
      offenCent: cent(BigInt(p.offener_betrag_cent)),
      faelligAm: p.faellig_am,
      verzugsbeginnAm: p.verzugsbeginn_am,
      verzugstage: p.verzugstage,
      zinsBp: p.zins_bp,
      zinsCent: cent(BigInt(p.zins_cent)),
    })),
  };
}

/** Ein Entwurf, der nicht hinausgehen soll — mit genanntem Grund (Invariante 8). */
export async function verwirf(
  kontext: SchreibKontext, id: string, grund: string,
): Promise<void> {
  if (grund.trim().length < 5) {
    throw new MahnungFehler(
      'ohne_grund',
      'Ein verworfener Entwurf nennt seinen Grund — er steht später allein da, '
      + 'wenn jemand fragt, warum nicht gemahnt wurde.');
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update mahnung
        set status = 'verworfen', verworfen_grund = $2,
            geaendert_am = now(), geaendert_von_art = 'mensch',
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and status = 'entwurf'
      returning id`, [id, grund.trim()]);
  if (zeilen.length === 0) {
    throw new MahnungFehler(
      'kein_entwurf',
      'Nur ein Entwurf wird verworfen — eine freigegebene Mahnung trägt eine Nummer.');
  }
}

/**
 * **Eine versendete Mahnung abschliessen** (V-084, FIN-15).
 *
 * `mahn_status` kennt `erledigt` seit `0125`, und beide Zustandsauslöser
 * (`0125:508`, `0130:476`) lassen `versendet → erledigt` ausdrücklich zu —
 * **geschrieben hat ihn nie jemand.** Jede jemals versendete Mahnung stand
 * für immer als offen da; die Mahnliste wuchs, und ob eine Sache erledigt
 * war, wusste nur, wer das Bankkonto danebenlegte.
 *
 * **Was `erledigt` NICHT ist.** Kein Widerruf und keine Korrektur: der Brief
 * ist heraus, die Nummer gezogen, der Auslöser `fin.mahnung_unveraenderlich`
 * friert ab `versendet` alles ein ausser dem Zustand. `erledigt` sagt nur,
 * dass diese Mahnung ihren Zweck erfüllt hat — bezahlt, verrechnet, oder auf
 * anderem Weg beigelegt.
 *
 * **Ob ein bezahlter offener Posten seine Mahnung von selbst schliesst, ist
 * offen (O-902)** und wird hier nicht entschieden. `mahnung_position` zeigt
 * auf `offener_posten`, ein Nachtlauf könnte es also — aber ob eine
 * Teilzahlung reicht, ob Gebühren und Zinsen mitzählen und was mit einer
 * Mahnung geschieht, deren Rechnung storniert wurde, steht nirgends. Bis
 * dahin setzt es ein Mensch, und er sieht dabei den Betrag.
 */
export async function erledige(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update mahnung
        set status = 'erledigt',
            geaendert_am = now(), geaendert_von_art = 'mensch',
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and status = 'versendet'
      returning id`, [id]);
  if (zeilen.length === 0) {
    throw new MahnungFehler(
      'nicht_versendet',
      'Erledigt wird nur, was versendet wurde. Ein Entwurf wird verworfen, und eine '
      + 'bereits erledigte Mahnung bleibt es.');
  }
}

/**
 * Die Nutzlast, über die entschieden wird — und die das Tor beim Versand
 * wiedererkennen muss.
 *
 * **Ohne die Nummer, und das ist kein Versehen.** Die Nummer entsteht erst
 * DURCH die Freigabe (der Auslöser zieht sie beim Zustandswechsel), sie kann
 * also zum Zeitpunkt der Entscheidung nicht darin stehen. Sie ist auch nichts,
 * worüber ein Mensch entscheidet: sie kommt lückenlos aus dem Zähler. Was ein
 * Mensch entscheidet, steht hier — Empfänger, Stufe, jede geforderte Position
 * und jeder Betrag.
 */
export function mahnungNutzlast(
  mandantId: string, kopf: MahnungZeile, positionen: readonly MahnungPositionZeile[],
): Nutzlast {
  return {
    aktion: 'mahnung_senden',
    mandantId,
    betragCent: kopf.gesamtCent,
    inhalt: {
      mahnungId: kopf.id,
      kundeId: kopf.kundeId,
      kunde: kopf.kundeName,
      stufe: kopf.stufe,
      bezeichnung: kopf.bezeichnung,
      mahndatum: kopf.mahndatum,
      zahlbarBis: kopf.zahlbarBis,
      forderungCent: String(kopf.forderungCent),
      gebuehrCent: String(kopf.gebuehrCent),
      zinsenCent: String(kopf.zinsenCent),
      gesamtCent: String(kopf.gesamtCent),
      positionen: positionen.map((p) => ({
        rechnung: p.rechnungsnummer,
        offenCent: String(p.offenCent),
        faelligAm: p.faelligAm,
        verzugstage: p.verzugstage,
        zinsBp: p.zinsBp,
        zinsCent: String(p.zinsCent),
      })),
      /**
       * **Die Fusszeile gehört in die Nutzlast, nicht nur in den Brief**
       * (V-099, Invariante 7).
       *
       * Sie ist stehender Text der Gesellschaft und keine Aussage über
       * diesen Vorgang — man könnte sie also für Briefkopf halten und
       * weglassen. Der Hash über die Nutzlast ist aber genau das, was eine
       * Freigabe an einen INHALT bindet: liegt sie draussen, geht Text
       * hinaus, den niemand gesehen hat, und die Freigabe bliebe trotzdem
       * gültig.
       *
       * Der Preis ist gewollt: wer die Fusszeile ändert, während eine
       * Mahnung auf Freigabe wartet, muss sie neu freigeben lassen. Genau so
       * soll es sein — der Brief ist danach ein anderer.
       */
      briefFuss: kopf.briefFuss ?? '',
      /**
       * **Briefkopf, Empfängeranschrift und Mahntext gehören ebenso hinein**
       * (V-213, V-214, Invariante 7) — aus demselben Grund wie die
       * Fusszeile: sie stehen im Brief, also bindet die Freigabe sie.
       *
       * **Seit V-217 kommen sie ab der Freigabe aus `mahnung.brief`** — mit
       * der Freigabe eingefroren (0449). Vorher wurden sie live gelesen:
       * eine Pflege der Kundenanschrift oder der Geschäftsführung nach der
       * Freigabe liess die Mahnung für immer stehen, denn aus `freigegeben`
       * führt kein Weg zurück. Jetzt geht genau der freigegebene Brief
       * hinaus, und das Tor weist nur noch ab, was jemand an der Mahnung
       * selbst ändert (Beträge, Positionen).
       */
      absender: { ...kopf.absender },
      empfaenger: { ...kopf.empfaenger },
      textbaustein: kopf.textbaustein ?? '',
    },
  };
}

/**
 * Die menschliche Freigabe — K-13 und Invariante 7 in einem Schritt.
 *
 * Der Abdruck im Schnappschuss ist `policy.nutzlastHash`, NICHT der
 * allgemeine Abdruck des Freigabedienstes: das Tor beim Versand vergleicht
 * gegen genau diesen Wert. Zwei Kanonisierungen derselben Nutzlast hiessen,
 * dass eine erteilte Freigabe nie zu dem passt, was hinausgeht.
 */
export async function gibFrei(
  kontext: SchreibKontext, id: string, begruendung: string,
): Promise<{ readonly freigabeId: string; readonly nummer: string }> {
  const vorgang = await findeMahnung(kontext, id);
  if (vorgang === null) throw new MahnungFehler('nicht_gefunden', 'Nicht gefunden.');
  if (vorgang.kopf.status !== 'entwurf') {
    throw new MahnungFehler(
      'kein_entwurf', `Diese Mahnung steht auf „${vorgang.kopf.status}".`);
  }
  if (vorgang.positionen.length === 0) {
    throw new MahnungFehler(
      'ohne_position', 'Eine Mahnung ohne Position fordert nichts.');
  }

  const nutzlast = mahnungNutzlast(kontext.aktiverMandantId, vorgang.kopf, vorgang.positionen);
  const freigabeId = await erteileFreigabe(
    { abfrage: kontext.schreibe.bind(kontext) },
    {
      aktion: 'mahnung_senden',
      inhalt: nutzlast.inhalt,
      begruendung,
      abdruck: nutzlastHash(nutzlast),
    });

  /*
   * **Der Brief wird mit derselben Anweisung eingefroren** (V-217, 0449) —
   * aus `vorgang`, aus dem auch die Nutzlast und damit der Abdruck oben
   * entstand. Was jemand zwischen dem Lesen und diesem Schreiben an den
   * Stammdaten ändert, landet also weder im Abdruck noch im Brief.
   * `::text::jsonb` und nicht `::jsonb`: bei `jsonb` serialisiert der Treiber
   * den Text ein zweites Mal, und in der Spalte stünde eine Zeichenkette
   * statt eines Objekts (wie in `bau/abnahme.ts`).
   */
  const [zeile] = await kontext.schreibe<{ nummer: string | null }>(
    `update mahnung
        set status = 'freigegeben', freigabe_id = $2::uuid,
            freigegeben_am = now(), freigegeben_von = app.aktueller_benutzer(),
            brief = $3::text::jsonb,
            geaendert_am = now(), geaendert_von_art = 'mensch',
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and status = 'entwurf'
      returning nummer`,
    [id, freigabeId, JSON.stringify(briefZumEinfrieren(vorgang.kopf))]);
  if (zeile?.nummer == null) {
    throw new MahnungFehler(
      'kein_entwurf', 'Die Freigabe hat keine Nummer gezogen — der Zustand blieb stehen.');
  }
  return { freigabeId, nummer: zeile.nummer };
}

/**
 * Die Länderzeile einer Auslandsanschrift (V-217): der deutsche Name des
 * Landes in Grossbuchstaben, so wie die Deutsche Post das Bestimmungsland in
 * der letzten Zeile verlangt — nicht der Code aus `kunde.land` („AT").
 *
 * Gespeichert bleibt der Code (`char(2)`); der Name entsteht beim Schreiben.
 * Einen Code, den die Länderliste der Laufzeit nicht kennt, schreibt die
 * Zeile so, wie er gespeichert ist — erfunden wird kein Land.
 */
export function landZeile(code: string): string {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(c) || c === 'ZZ') return c;
  try {
    const name = new Intl.DisplayNames(['de'], { type: 'region', fallback: 'code' }).of(c);
    return name === undefined || name === c ? c : name.toLocaleUpperCase('de-DE');
  } catch {
    return c;
  }
}

/** Der Brief, wie er hinausgeht — dieselbe Quelle wie die Nutzlast. */
export function mahnungstext(
  kopf: MahnungZeile, positionen: readonly MahnungPositionZeile[],
): string {
  const zeilen: string[] = [];
  const a = kopf.absender;
  const e = kopf.empfaenger;
  const nichtLeer = (w: string | null | undefined): w is string =>
    typeof w === 'string' && w.trim() !== '';
  const ortZeile = (plz: string | null, ort: string | null): string | null => {
    const z = [plz, ort].filter(nichtLeer).join(' ');
    return z === '' ? null : z;
  };
  /* Ein Land steht nur, wenn es nicht Deutschland ist — so schreibt man Post. */
  const auslandsland = (land: string | null): string | null =>
    nichtLeer(land) && land.trim().toUpperCase() !== 'DE' ? landZeile(land) : null;

  /*
   * **Der Briefkopf** (V-213): die Absenderzeile über dem Anschriftfeld und
   * die Postanschrift des Empfängers. Vorher stand vom Absender nichts im
   * Schreiben und vom Empfänger nur „Kunde: Name" — bei Versand als Brief
   * oder Einschreiben kein Geschäftsbrief.
   */
  zeilen.push([a.firma, a.strasse, ortZeile(a.plz, a.ort)].filter(nichtLeer).join(' · '));
  zeilen.push('');
  for (const z of [e.name, e.strasse, ortZeile(e.plz, e.ort), auslandsland(e.land)]) {
    if (nichtLeer(z)) zeilen.push(z);
  }
  zeilen.push('');
  zeilen.push(`${kopf.bezeichnung} — ${kopf.nummer ?? '(ohne Nummer)'}`);
  zeilen.push('');
  zeilen.push(`Kunde: ${kopf.kundeName}`);
  /* Tage in der Hausschreibweise (V-213) — vorher `2026-09-23`. */
  zeilen.push(`Datum: ${tagDeutsch(kopf.mahndatum)}`);
  /*
   * **Der Mahntext der Stufe** (V-214) — zwischen Kopf und Forderungsliste,
   * wie ein Brief ihn trägt. Fehlt er, bleibt die Stelle leer: einen
   * Wortlaut für eine Zahlungserinnerung oder eine letzte Mahnung erfindet
   * der Code nicht, er kommt von der Gesellschaft.
   */
  if (nichtLeer(kopf.textbaustein)) {
    zeilen.push('');
    zeilen.push(kopf.textbaustein.trim());
  }
  zeilen.push('');
  zeilen.push('Offene Forderungen:');
  for (const p of positionen) {
    /* Der Satz als Prozent p. a., nicht als „900 Basispunkte" (V-213). */
    const zins = p.zinsCent === 0n
      ? ''
      : `, Verzugszins ${formatiereGeld(p.zinsCent)} `
        + `(${String(p.verzugstage)} Tage, ${prozentText(p.zinsBp)} p. a.)`;
    zeilen.push(
      `  · Rechnung ${p.rechnungsnummer ?? '—'}, fällig am ${tagDeutsch(p.faelligAm)}: `
      + `${formatiereGeld(p.offenCent)}${zins}`);
  }
  zeilen.push('');
  zeilen.push(`Forderung:      ${formatiereGeld(kopf.forderungCent)}`);
  zeilen.push(`Mahngebühr:     ${formatiereGeld(kopf.gebuehrCent)}`);
  zeilen.push(`Verzugszinsen:  ${formatiereGeld(kopf.zinsenCent)}`);
  zeilen.push(`Gesamtbetrag:   ${formatiereGeld(kopf.gesamtCent)}`);
  zeilen.push('');
  zeilen.push(`Wir bitten um Ausgleich bis zum ${tagDeutsch(kopf.zahlbarBis)}.`);
  /*
   * **Die stehende Briefzeile der Gesellschaft** (V-099, K-12).
   *
   * Sie steht am Ende und durch eine Trennlinie abgesetzt: darüber steht,
   * was DIESEN Vorgang betrifft, darunter, was unter jedem Brief dieser
   * Gesellschaft steht. Wer beides ineinanderlaufen liesse, machte aus einer
   * stehenden Angabe eine Aussage über diesen Fall.
   */
  if (kopf.briefFuss !== null && kopf.briefFuss.trim() !== '') {
    zeilen.push('');
    zeilen.push('—');
    zeilen.push(kopf.briefFuss.trim());
  }
  /*
   * **Die Pflichtangaben** (V-213, § 35a GmbHG) — dieselben Felder und
   * dieselbe Reihenfolge wie im Fuss des Angebotsblatts: Firma und
   * Anschrift, Kontakt, Registergericht und -nummer, Geschäftsführung,
   * Steuernummern, Bankverbindung. Die freie Fusszeile steht DAVOR, damit
   * sie nicht wie eine Auswahl aus den Pflichtangaben aussieht (V-099).
   */
  const pflicht: string[] = [
    [a.firma, [a.strasse, ortZeile(a.plz, a.ort)].filter(nichtLeer).join(', ')]
      .filter(nichtLeer).join(' · '),
    [nichtLeer(a.telefon) ? `Telefon ${a.telefon}` : null, a.email, a.web]
      .filter(nichtLeer).join(' · '),
    [nichtLeer(a.registergericht) || nichtLeer(a.registernummer)
      ? [a.registergericht, a.registernummer].filter(nichtLeer).join(' ') : null,
    nichtLeer(a.geschaeftsfuehrung) ? `Geschäftsführung: ${a.geschaeftsfuehrung}` : null]
      .filter(nichtLeer).join(' · '),
    [nichtLeer(a.ustId) ? `USt-IdNr. ${a.ustId}` : null,
      nichtLeer(a.steuernummer) ? `Steuernummer ${a.steuernummer}` : null]
      .filter(nichtLeer).join(' · '),
    nichtLeer(a.iban)
      ? [a.bank, `IBAN ${a.iban}`, nichtLeer(a.bic) ? `BIC ${a.bic}` : null]
        .filter(nichtLeer).join(' · ')
      : '',
  ].filter(nichtLeer);
  zeilen.push('');
  zeilen.push('—');
  for (const z of pflicht) zeilen.push(z);
  return zeilen.join('\n');
}

export interface VersandEingabe {
  readonly id: string;
  readonly versandart: Versandart;
  readonly empfaenger: string;
}

/**
 * Dokumentiert den Versand — nach dem Tor, nicht davor.
 *
 * Die Reihenfolge ist dieselbe wie bei der Behinderungsanzeige, und aus
 * demselben Grund:
 *
 *   1. Kanal prüfen — ein nicht verbundener wird abgewiesen, BEVOR etwas
 *      entsteht.
 *   2. Freigabe laden und `gate()` fragen, mit dem Abdruck über die Nutzlast,
 *      wie sie JETZT in der Datenbank steht.
 *   3. Das PDF erzeugen und ablegen — ist der Speicher nicht verbunden,
 *      bricht es hier ab, und die Mahnung bleibt „freigegeben".
 *   4. Erst danach das Absendedatum. Der Auslöser schreibt dann den Posten
 *      fort, und ab diesem Tag läuft der Verzug.
 *
 * Wer 4 vor 3 stellt, hat eine versendete Mahnung ohne archiviertes
 * Schreiben; wer 2 nach 4 stellt, hat sie ohne Freigabe verschickt.
 */
export async function dokumentiereVersand(
  kontext: SchreibKontext,
  eingabe: VersandEingabe,
  speicher: Speicher,
  richtlinie: Richtlinie | null = null,
): Promise<{
  readonly dokumentId: string;
  /**
   * Berliner Ortszeit als `TT.MM.JJJJ HH:MM` (V-213) — für den Satz, den die
   * Route zurückgibt. Vorher der rohe UTC-Text mit Mikrosekunden.
   */
  readonly versendetAm: string;
}> {
  if (!MENSCHLICHE_KANAELE.includes(eingabe.versandart)) {
    throw new KanalNichtVerbundenFehler(eingabe.versandart);
  }

  const vorgang = await findeMahnung(kontext, eingabe.id);
  if (vorgang === null) throw new MahnungFehler('nicht_gefunden', 'Nicht gefunden.');
  if (vorgang.kopf.status === 'versendet' || vorgang.kopf.versendetAm !== null) {
    throw new MahnungFehler(
      'schon_versendet',
      'Diese Mahnung ist hinausgegangen. Eine zweite Mahnung ist die nächste Stufe, '
      + 'kein zweiter Versand.');
  }
  if (vorgang.kopf.status !== 'freigegeben') {
    throw new MahnungFehler(
      'nicht_freigegeben',
      `Diese Mahnung steht auf „${vorgang.kopf.status}" — es geht nur hinaus, was `
      + 'freigegeben ist (Invariante 7).');
  }

  const [freigabeZeile] = await kontext.abfrage<{
    id: string; aktion: string; status: string; freigegeben_von: string | null;
    nutzlast_hash: string | null;
  }>(
    `select f.id, f.aktion, f.status::text as status, f.freigegeben_von,
            (select s.nutzlast_hash from freigabe_snapshot s
              where s.freigabe_id = f.id and s.mandant_id = f.mandant_id
              order by s.kette_nr desc limit 1) as nutzlast_hash
       from freigabe f
       join mahnung m on m.freigabe_id = f.id and m.mandant_id = f.mandant_id
      where m.id = $1::uuid`, [eingabe.id]);

  const nutzlast = mahnungNutzlast(
    kontext.aktiverMandantId, vorgang.kopf, vorgang.positionen);
  const freigabe: Freigabe | null = freigabeZeile === undefined ? null : {
    id: freigabeZeile.id,
    aktion: freigabeZeile.aktion as Freigabe['aktion'],
    mandantId: kontext.aktiverMandantId,
    status: freigabeZeile.status as Freigabe['status'],
    freigegebenVon: freigabeZeile.freigegeben_von,
    nutzlastHash: freigabeZeile.nutzlast_hash ?? '',
  };

  const entscheidung = gate(nutzlast, freigabe, richtlinie);
  if (!entscheidung.erlaubt) throw entscheidung.fehler;

  const pdf = schreibeTextPdf({
    titel: `Mahnung ${vorgang.kopf.nummer ?? ''} — ${vorgang.kopf.kundeName}`,
    text: mahnungstext(vorgang.kopf, vorgang.positionen),
  });
  if (pdf.ersetzteZeichen > 0) {
    throw new MahnungFehler(
      'zeichen_nicht_darstellbar',
      `${String(pdf.ersetzteZeichen)} Zeichen des Schreibens lassen sich in der Schrift `
      + 'des PDF nicht darstellen und stünden als Fragezeichen darin. Es wurde NICHTS '
      + 'abgelegt und kein Absendedatum gesetzt.');
  }

  const [jahr] = await kontext.abfrage<{ jahr: number }>(
    `select extract(year from app.berlin_heute())::int as jahr`);
  if (jahr === undefined) {
    throw new Error('Die Datenbank lieferte kein Berliner Kalenderjahr.');
  }

  const hoch = await ladeHoch(
    {
      mandantId: kontext.aktiverMandantId,
      kategorie: 'buchhaltung',
      titel: `Mahnung ${vorgang.kopf.nummer ?? ''} (${vorgang.kopf.kundeName})`,
      dateiname: `mahnung-${vorgang.kopf.nummer ?? vorgang.kopf.id}.pdf`,
      daten: pdf.bytes,
      behaupteterTyp: 'application/pdf',
    },
    speicher, jahr.jahr);

  /**
   * **Ab hier liegt ein Brief im Bucket, den die Transaktion nicht mehr
   * zurücknehmen kann.**
   *
   * Vier Schreibvorgänge folgen — `dokument`, `dokument_version`, der
   * Zustandswechsel der Mahnung und die Versandzeile. Scheitert einer davon
   * (der Zustand hat sich geändert, ein Auslöser weist ab), rollt alles
   * zurück und dieses PDF bleibt: ein Mahnschreiben mit Name, Betrag und
   * Zahlungsfrist eines Kunden, auf das keine Zeile zeigt. Es ist unauffindbar
   * und deshalb auch nicht löschbar — genau die Sorte Datenbestand, die eine
   * Auskunft nach Art. 15 DSGVO nicht beantworten kann.
   *
   * Der Rest der Funktion läuft deshalb in einem `try`, und das `catch`
   * entfernt das Objekt, bevor es den Fehler weiterreicht. Dieselbe
   * Vorrichtung wie beim Schichtfoto (`api/check-in/[token]/medien`).
   */
  try {

    /**
     * Zwei Zeilen, weil das Schema sie so fuehrt (0009): `dokument` traegt
     * Titel, Kategorie und Aufbewahrung, `dokument_version` die Fassung mit
     * ihrem SHA-256. Der Digest ist hier kein Beiwerk — der Brief ist das
     * Beweisstueck fuer den Verzugsbeginn, und ohne Pruefsumme laesst sich
     * spaeter nicht zeigen, dass die abgelegte Datei noch dieselbe ist.
     */
    await kontext.schreibe(
      `insert into dokument (id, mandant_id, kategorie, titel, mime_typ,
                             mime_verifiziert, groesse_bytes, bucket,
                             objekt_schluessel, exif_entfernt, aufbewahrung_bis,
                             loeschsperre, kunde_id, erstellt_von)
       values ($1::uuid, $2::uuid, 'buchhaltung', $3, $4, true, $5::bigint, $6,
               $7, $8, $9::date, $10, $11::uuid, app.aktueller_benutzer())`,
      [hoch.dokumentId, kontext.aktiverMandantId,
       `Mahnung ${vorgang.kopf.nummer ?? ''} (${vorgang.kopf.kundeName})`,
       hoch.mimeTyp, String(hoch.groesseBytes), hoch.bucket, hoch.objektSchluessel,
       hoch.exifEntfernt, hoch.aufbewahrungBis, hoch.loeschsperre,
       vorgang.kopf.kundeId]);
    await kontext.schreibe(
      `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                     sha256, groesse_bytes, mime_typ, erstellt_von)
       values ($1::uuid, $2::uuid, 1, $3, $4, $5::bigint, $6, app.aktueller_benutzer())`,
      [kontext.aktiverMandantId, hoch.dokumentId, hoch.objektSchluessel,
       hoch.sha256, String(hoch.groesseBytes), hoch.mimeTyp]);

    const [nachher] = await kontext.schreibe<{ versendet_am: string }>(
      `update mahnung
          set status = 'versendet', versendet_am = now(), dokument_id = $2::uuid,
              geaendert_am = now(), geaendert_von_art = 'mensch',
              geaendert_von = app.aktueller_benutzer()
        where id = $1::uuid and status = 'freigegeben'
        returning to_char(versendet_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                    as versendet_am`,
      [eingabe.id, hoch.dokumentId]);
    if (nachher === undefined) {
      throw new MahnungFehler(
        'nicht_freigegeben', 'Der Zustand hat sich zwischenzeitlich geändert.');
    }

    /** Der einzige Ausgang trägt seine Freigabe (0012, `versand`). */
    await kontext.schreibe(
      `insert into versand (mandant_id, freigabe_id, aktion, kanal, empfaenger,
                            nutzlast_hash, gesendet_am, ergebnis)
       values ($1::uuid, $2::uuid, 'mahnung_senden', $3, $4, $5, now(), 'dokumentiert')`,
      [kontext.aktiverMandantId, freigabe?.id ?? null, eingabe.versandart,
       eingabe.empfaenger, nutzlastHash(nutzlast)]);

      return { dokumentId: hoch.dokumentId, versendetAm: nachher.versendet_am };
  } catch (fehler) {
    try {
      await speicher.entferne(hoch.bucket, hoch.objektSchluessel);
    } catch {
      /*
       * Auch das Aufräumen kann scheitern. Dann bleibt ein verwaistes Objekt —
       * und es bleibt AUFFINDBAR: es steht in keiner `dokument`-Zeile, und
       * genau daran erkennt es der Waisenlauf. Den ursprünglichen Fehler
       * verdeckt dieser zweite auf keinen Fall.
       */
    }
    throw fehler;
  }
}
