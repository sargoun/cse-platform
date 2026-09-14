import 'server-only';
import { createHash } from 'node:crypto';
import type { LeseKontext } from '../../kontext/index.js';
import { schreibeZip } from '../archiv/zip.js';
import { csvText, type Spalte } from '../buchhaltung/z3.js';
import { leseNachweis, type MiLoGNachweis } from './milog.js';
import type { BewegungArt, KontoStatus } from './stundenkonto.js';

/**
 * Der Lohnexport — Zeitdaten eines Monats fuer das Lohnsystem (ACC-12,
 * TIM-13, D-06, PR 67, D-486).
 *
 * **Was die Plattform liefert und was nicht.** Sie fuehrt die Zeit: jeden
 * Eintrag mit Beginn, Ende und Pause nach der Serveruhr, die Stundenkonten
 * je Beschaeftigung und Monat, die Abwesenheiten mit ihrer Art. Sie rechnet
 * KEIN Entgelt, keine Zuschlaege, keine Sozialversicherung (D-06) — das tut
 * das Lohnsystem, und dafuer bekommt es hier drei Tabellen je Monat: die
 * Konten (`monate.csv`), die Abwesenheiten (`abwesenheiten.csv`) und jeden
 * Zeiteintrag mit seinem Monatsanteil (`zeiten.csv`), aus dem sich Nacht-,
 * Sonntags- und Feiertagsstunden nach der jeweiligen Vereinbarung ableiten
 * lassen (O-37). Was die Plattform nicht weiss, laesst sie leer und zaehlt
 * es im `LIESMICH.txt`: ob eine Abwesenheitsart bezahlt ist und welche
 * Lohnart sie traegt (O-139), heisst „unklar", nicht „nein".
 *
 * **Das Format ist ein Platzhalter.** Welches Lohnsystem die Gesellschaften
 * nutzen und welches Importformat es erwartet, ist nicht entschieden
 * (O-27). Der Export laeuft deshalb hinter einer Schnittstelle
 * (`LohnexportFormat`); das generische CSV ist die eine Implementierung,
 * gekennzeichnet als Platzhalter, und die Seite sagt „nicht mit dem
 * Lohnsystem abgestimmt". Ein zweites Format ist eine Datei, kein Umbau.
 *
 * **Die Zeit kommt aus dem Nachweis.** `leseNachweis` (MiLoG, § 17) liefert
 * je Beschaeftigung die Zeilen des Monats — fuer einen gesperrten Monat das
 * gepraegte Artefakt, byte-gleich, mit Hash; fuer einen offenen die lebende
 * Sicht, als vorlaeufig gekennzeichnet. Der Export rechnet also nichts
 * zweimal: dieselbe Funktion, die den Nachweis fuer den Zoll erzeugt, liefert
 * die Zeilen fuer das Lohnbuero.
 *
 * **Reproduzierbar, personenbezogen, protokolliert.** Kein Zeitstempel im
 * Paket, totale Ordnung, STORE-ZIP — derselbe Monat, derselbe Hash. Das
 * Paket enthaelt Personalnummer und Name (das braucht das Lohnbuero) und
 * sonst nichts ueber den Menschen: kein Geburtsdatum, keine Anschrift,
 * kein Stundensatz (K-05). Jeder Abruf steht im Protokoll.
 *
 * // TODO(client, O-27): Welches Lohnsystem (DATEV LODAS, Lohn und Gehalt,
 * // ein anderes) je Gesellschaft, und welches Importformat erwartet es —
 * // Spalten, Zeichensatz, Lohnartenschluessel?
 */
export interface LohnexportFormat {
  readonly schluessel: string;
  readonly bezeichnung: string;
  /** `null`, solange kein Lohnsystem festgelegt ist (O-27). */
  readonly zielsystem: string | null;
  readonly istPlatzhalter: boolean;
  /** Die Dateien des Pakets aus den gelesenen Daten — ohne LIESMICH und Pruefsummen. */
  schreibe(daten: LohnexportDaten): readonly { readonly pfad: string; readonly bytes: Uint8Array }[];
}

export type KontoLage = KontoStatus | 'kein_konto';

export interface LohnexportZeile {
  readonly anstellungId: string;
  readonly personalnummer: string;
  readonly person: string;
  readonly eintritt: string;
  readonly austritt: string | null;
  readonly arbeitszeitmodell: string;
  readonly wochenstunden: string | null;
  readonly konto: KontoLage;
  readonly sollMinuten: number;
  readonly istMinuten: number;
  readonly korrekturMinuten: number;
  readonly saldoVortragMinuten: number;
  readonly saldoMinuten: number;
  readonly urlaubTage: string;
  readonly krankTage: string;
  readonly bewegungen: Readonly<Record<BewegungArt, number>>;
  readonly zeiteintraege: number;
  readonly unfreigegeben: number;
  readonly nachweisQuelle: MiLoGNachweis['quelle'] | null;
  readonly nachweisHash: string | null;
}

export interface LohnexportAbwesenheit {
  readonly id: string;
  readonly anstellungId: string;
  readonly personalnummer: string;
  readonly person: string;
  readonly art: string;
  readonly bezeichnung: string;
  readonly bezahlt: boolean | null;
  readonly lohnart: string | null;
  readonly gesundheitsbezogen: boolean;
  readonly von: string;
  readonly bis: string;
  readonly vonHalbtags: boolean;
  readonly bisHalbtags: boolean;
  readonly tageAngerechnet: string | null;
  readonly status: string;
}

export interface LohnexportZeit {
  readonly anstellungId: string;
  readonly personalnummer: string;
  readonly zeiteintragId: string;
  readonly kalendertag: string;
  readonly beginn: string;
  readonly ende: string;
  readonly pauseMinuten: number;
  readonly bruttoMinuten: number;
  readonly nettoMinuten: number;
  readonly anteilBruttoMinuten: number;
  readonly anteilNettoMinuten: number;
  readonly nacherfasst: boolean;
}

export interface LohnexportDaten {
  readonly mandantId: string;
  readonly firma: string;
  /** `JJJJ-MM` */
  readonly monat: string;
  readonly von: string;
  readonly bis: string;
  readonly zeilen: readonly LohnexportZeile[];
  readonly abwesenheiten: readonly LohnexportAbwesenheit[];
  readonly zeiten: readonly LohnexportZeit[];
}

export interface LohnexportDatei {
  readonly pfad: string;
  readonly sha256: string;
  readonly groesseBytes: number;
}

export interface Lohnexport extends LohnexportDaten {
  readonly format: Pick<LohnexportFormat, 'schluessel' | 'bezeichnung' | 'zielsystem' | 'istPlatzhalter'>;
  readonly zahlen: {
    readonly beschaeftigte: number;
    readonly gesperrt: number;
    readonly vorlaeufig: number;
    readonly unfreigegeben: number;
    readonly abwesenheitenOhneLohnart: number;
    readonly abwesenheitenBezahltUnklar: number;
  };
  readonly hinweise: readonly string[];
  readonly dateien: readonly LohnexportDatei[];
  readonly zip: Uint8Array;
  readonly zipSha256: string;
}

export class LohnexportFehler extends Error {
  constructor(nachricht: string, readonly grund: 'monat' | 'mandant') {
    super(nachricht);
    this.name = 'LohnexportFehler';
  }
}

export const LIESMICH_NAME = 'LIESMICH.txt';
export const PRUEFSUMMEN_NAME = 'pruefsummen.txt';
export const HINWEIS_D06 =
  'Dieses Paket überlässt Zeitdaten. Es enthält kein Entgelt, keine Zuschläge und keine Sozialversicherung (D-06).';

export const BEWEGUNG_ARTEN: readonly BewegungArt[] = [
  'arbeitszeit', 'abwesenheit', 'feiertag', 'korrektur', 'uebertrag', 'auszahlung', 'freizeitausgleich',
];

/**
 * Minuten → Dezimalstunden mit zwei Nachkommastellen und Komma, kaufmaennisch
 * gerundet, rein ganzzahlig: `90` → `1,50`, `-45` → `-0,75`, `7` → `0,12`.
 */
export function dezimalstunden(minuten: number): string {
  if (!Number.isInteger(minuten)) throw new LohnexportFehler(`${String(minuten)} ist keine ganze Minutenzahl.`, 'monat');
  const negativ = minuten < 0;
  const betrag = BigInt(Math.abs(minuten));
  const hundertstel = (betrag * 100n + 30n) / 60n;
  const roh = hundertstel.toString().padStart(3, '0');
  return `${negativ ? '-' : ''}${roh.slice(0, -2)},${roh.slice(-2)}`;
}

const jaNein = (wert: boolean): string => (wert ? 'ja' : 'nein');
const jaNeinUnklar = (wert: boolean | null): string => (wert === null ? 'unklar' : jaNein(wert));

const MONATE_SPALTEN: readonly Spalte[] = [
  { name: 'personalnummer', typ: 'text', schluessel: true, text: 'Personalnummer' },
  { name: 'name', typ: 'text', text: 'Name' },
  { name: 'eintritt', typ: 'datum', text: 'Eintritt' },
  { name: 'austritt', typ: 'datum', text: 'Austritt' },
  { name: 'arbeitszeitmodell', typ: 'text', text: 'Arbeitszeitmodell' },
  { name: 'wochenstunden', typ: 'text', text: 'Wochenstunden' },
  { name: 'konto_status', typ: 'text', text: 'offen, vorlaeufig, gesperrt, kein_konto' },
  { name: 'soll_minuten', typ: 'zahl', text: 'Sollminuten (0 = nicht hinterlegt, O-18)' },
  { name: 'soll_stunden', typ: 'text', text: 'Sollstunden dezimal' },
  { name: 'ist_minuten', typ: 'zahl', text: 'Istminuten' },
  { name: 'ist_stunden', typ: 'text', text: 'Iststunden dezimal' },
  { name: 'korrektur_minuten', typ: 'zahl', text: 'Korrekturen' },
  { name: 'saldo_vortrag_minuten', typ: 'zahl', text: 'Saldo Vortrag' },
  { name: 'saldo_minuten', typ: 'zahl', text: 'Saldo' },
  { name: 'saldo_stunden', typ: 'text', text: 'Saldo dezimal' },
  { name: 'urlaub_tage', typ: 'text', text: 'Urlaubstage im Monat' },
  { name: 'krank_tage', typ: 'text', text: 'Kranktage im Monat' },
  ...BEWEGUNG_ARTEN.map((a): Spalte => ({ name: `${a}_minuten`, typ: 'zahl', text: `Bewegung ${a}` })),
  { name: 'zeiteintraege', typ: 'zahl', text: 'Zeiteinträge mit Anteil im Monat' },
  { name: 'unfreigegeben', typ: 'zahl', text: 'davon nicht freigegeben' },
  { name: 'nachweis_quelle', typ: 'text', text: 'live, artefakt, ungepraegt' },
  { name: 'nachweis_hash', typ: 'text', text: 'SHA-256 des MiLoG-Nachweises' },
];

const ABWESENHEIT_SPALTEN: readonly Spalte[] = [
  { name: 'id', typ: 'text', schluessel: true, text: 'Kennung' },
  { name: 'personalnummer', typ: 'text', text: 'Personalnummer' },
  { name: 'name', typ: 'text', text: 'Name' },
  { name: 'art', typ: 'text', text: 'Abwesenheitsart (Schlüssel)' },
  { name: 'bezeichnung', typ: 'text', text: 'Bezeichnung' },
  { name: 'von', typ: 'datum', text: 'Von' },
  { name: 'bis', typ: 'datum', text: 'Bis' },
  { name: 'von_halbtags', typ: 'text', text: 'ja/nein' },
  { name: 'bis_halbtags', typ: 'text', text: 'ja/nein' },
  { name: 'tage_angerechnet', typ: 'text', text: 'Angerechnete Tage' },
  { name: 'bezahlt', typ: 'text', text: 'ja, nein oder unklar (O-139)' },
  { name: 'lohnart', typ: 'text', text: 'Lohnartenschlüssel (leer: O-139)' },
  { name: 'status', typ: 'text', text: 'genehmigt oder erfasst' },
  { name: 'gesundheitsbezogen', typ: 'text', text: 'ja/nein' },
];

const ZEITEN_SPALTEN: readonly Spalte[] = [
  { name: 'zeiteintrag_id', typ: 'text', schluessel: true, text: 'Kennung des Zeiteintrags' },
  { name: 'personalnummer', typ: 'text', text: 'Personalnummer' },
  { name: 'kalendertag', typ: 'datum', text: 'Berliner Kalendertag des Anteilsbeginns' },
  { name: 'beginn', typ: 'text', text: 'Beginn, Europe/Berlin' },
  { name: 'ende', typ: 'text', text: 'Ende, Europe/Berlin' },
  { name: 'pause_minuten', typ: 'zahl', text: 'Pause' },
  { name: 'brutto_minuten', typ: 'zahl', text: 'Brutto des Eintrags' },
  { name: 'netto_minuten', typ: 'zahl', text: 'Netto des Eintrags' },
  { name: 'anteil_brutto_minuten', typ: 'zahl', text: 'Bruttoanteil in diesem Monat' },
  { name: 'anteil_netto_minuten', typ: 'zahl', text: 'Nettoanteil in diesem Monat' },
  { name: 'nacherfasst', typ: 'text', text: 'ja/nein' },
];

function berlin(iso: string): string {
  const d = new Date(iso);
  const teile = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const t = (typ: string): string => teile.find((x) => x.type === typ)?.value ?? '';
  return `${t('year')}-${t('month')}-${t('day')} ${t('hour')}:${t('minute')}`;
}

/** Das generische CSV — die eine Implementierung, ein Platzhalter bis O-27 beantwortet ist. */
export const GENERISCH_CSV: LohnexportFormat = {
  schluessel: 'generisch_csv',
  bezeichnung: 'Generisches CSV (UTF-8, Semikolon, Dezimalkomma)',
  zielsystem: null,
  istPlatzhalter: true,
  schreibe(d) {
    const enc = new TextEncoder();
    const monate = d.zeilen.map((z) => ({
      personalnummer: z.personalnummer, name: z.person, eintritt: z.eintritt, austritt: z.austritt,
      arbeitszeitmodell: z.arbeitszeitmodell, wochenstunden: z.wochenstunden, konto_status: z.konto,
      soll_minuten: z.sollMinuten, soll_stunden: dezimalstunden(z.sollMinuten),
      ist_minuten: z.istMinuten, ist_stunden: dezimalstunden(z.istMinuten),
      korrektur_minuten: z.korrekturMinuten, saldo_vortrag_minuten: z.saldoVortragMinuten,
      saldo_minuten: z.saldoMinuten, saldo_stunden: dezimalstunden(z.saldoMinuten),
      urlaub_tage: z.urlaubTage, krank_tage: z.krankTage,
      ...Object.fromEntries(BEWEGUNG_ARTEN.map((a) => [`${a}_minuten`, z.bewegungen[a]])),
      zeiteintraege: z.zeiteintraege, unfreigegeben: z.unfreigegeben,
      nachweis_quelle: z.nachweisQuelle, nachweis_hash: z.nachweisHash,
    }));
    const abwesenheiten = d.abwesenheiten.map((a) => ({
      id: a.id, personalnummer: a.personalnummer, name: a.person, art: a.art, bezeichnung: a.bezeichnung,
      von: a.von, bis: a.bis, von_halbtags: jaNein(a.vonHalbtags), bis_halbtags: jaNein(a.bisHalbtags),
      tage_angerechnet: a.tageAngerechnet, bezahlt: jaNeinUnklar(a.bezahlt), lohnart: a.lohnart,
      status: a.status, gesundheitsbezogen: jaNein(a.gesundheitsbezogen),
    }));
    const zeiten = d.zeiten.map((z) => ({
      zeiteintrag_id: z.zeiteintragId, personalnummer: z.personalnummer, kalendertag: z.kalendertag,
      beginn: z.beginn, ende: z.ende, pause_minuten: z.pauseMinuten, brutto_minuten: z.bruttoMinuten,
      netto_minuten: z.nettoMinuten, anteil_brutto_minuten: z.anteilBruttoMinuten,
      anteil_netto_minuten: z.anteilNettoMinuten, nacherfasst: jaNein(z.nacherfasst),
    }));
    return [
      { pfad: 'monate.csv', bytes: enc.encode(csvText(MONATE_SPALTEN, monate)) },
      { pfad: 'abwesenheiten.csv', bytes: enc.encode(csvText(ABWESENHEIT_SPALTEN, abwesenheiten)) },
      { pfad: 'zeiten.csv', bytes: enc.encode(csvText(ZEITEN_SPALTEN, zeiten)) },
    ];
  },
};

interface AnstellungRoh {
  readonly anstellung_id: string;
  readonly personalnummer: string;
  readonly person: string;
  readonly eintritt: string;
  readonly austritt: string | null;
  readonly arbeitszeitmodell: string;
  readonly wochenstunden: string | null;
  readonly status: KontoStatus | null;
  readonly soll_minuten: number | null;
  readonly ist_minuten: number | null;
  readonly korrektur_minuten: number | null;
  readonly saldo_vortrag_minuten: number | null;
  readonly saldo_minuten: number | null;
  readonly urlaub_tage: string | null;
  readonly krank_tage: string | null;
}

interface BewegungRoh { readonly anstellung_id: string; readonly art: BewegungArt; readonly minuten: number }

interface AbwesenheitRoh {
  readonly id: string; readonly anstellung_id: string; readonly personalnummer: string; readonly person: string;
  readonly art: string; readonly bezeichnung: string; readonly bezahlt: boolean | null; readonly lohnart: string | null;
  readonly gesundheitsbezogen: boolean; readonly von: string; readonly bis: string;
  readonly von_halbtags: boolean; readonly bis_halbtags: boolean; readonly tage: string | null; readonly status: string;
}

function monatsgrenzen(monat: string): { von: string; bis: string; erster: string } {
  const treffer = /^(\d{4})-(\d{2})$/u.exec(monat);
  if (treffer === null) throw new LohnexportFehler(`"${monat}" ist kein Monat JJJJ-MM.`, 'monat');
  const jahr = Number(treffer[1]);
  const m = Number(treffer[2]);
  if (m < 1 || m > 12) throw new LohnexportFehler(`"${monat}" ist kein Monat JJJJ-MM.`, 'monat');
  const letzter = new Date(Date.UTC(jahr, m, 0)).getUTCDate();
  const erster = `${monat}-01`;
  return { von: erster, bis: `${monat}-${String(letzter).padStart(2, '0')}`, erster };
}

function liesmichText(e: Lohnexport): string {
  const z = e.zahlen;
  const zeilen = [
    `Lohnexport — ${e.firma} — Monat ${e.monat} (${e.von} bis ${e.bis})`,
    '',
    'FORMAT',
    `  ${e.format.bezeichnung}${e.format.istPlatzhalter ? ' — PLATZHALTER: das Lohnsystem und sein Importformat sind nicht festgelegt (O-27).' : ''}`,
    `  Zielsystem: ${e.format.zielsystem ?? 'nicht festgelegt — nicht verbunden'}`,
    '  CSV: Trennzeichen ";", Textfelder in Anführungszeichen, Zeilenende CRLF, erste Zeile Spaltennamen, UTF-8.',
    '  Minuten sind ganze Zahlen; Dezimalstunden sind kaufmännisch auf zwei Stellen gerundet und stehen daneben.',
    '',
    'INHALT',
    '  monate.csv         je Beschäftigung: Stundenkonto des Monats (Soll, Ist, Korrektur, Saldo, Urlaub, Krank),',
    '                     Bewegungen je Art, Zahl der Zeiteinträge, Quelle und Hash des MiLoG-Nachweises',
    '  abwesenheiten.csv  jede genehmigte oder erfasste Abwesenheit mit Anteil im Monat, mit Art, bezahlt/unbezahlt und Lohnart',
    '  zeiten.csv         jeder Zeiteintrag mit Anteil im Monat: Beginn, Ende, Pause, Brutto, Netto (Europe/Berlin)',
    '  pruefsummen.txt    SHA-256 jeder Datei; prüfen mit: sha256sum -c pruefsummen.txt',
    '',
    'STAND',
    `  Beschäftigte im Monat: ${String(z.beschaeftigte)} — Konten gesperrt: ${String(z.gesperrt)}, offen oder vorläufig: ${String(z.vorlaeufig)}`,
    `  Nicht freigegebene Zeiteinträge: ${String(z.unfreigegeben)}${z.unfreigegeben > 0 ? ' — ihre Minuten stehen in zeiten.csv, aber nicht im Konto' : ''}`,
    `  Abwesenheiten ohne Lohnart: ${String(z.abwesenheitenOhneLohnart)}, mit unklarem bezahlt/unbezahlt: ${String(z.abwesenheitenBezahltUnklar)} (O-139)`,
    '',
    'HINWEISE',
    ...e.hinweise.map((h) => `  ${h}`),
    `  ${HINWEIS_D06}`,
    '  Nacht-, Sonntags- und Feiertagsstunden leitet das Lohnsystem aus zeiten.csv nach der geltenden Vereinbarung ab (O-37).',
    '  Das Paket enthält Personalnummer und Name und sonst nichts über die Person; Stundensätze stehen nicht darin (K-05).',
    '  Reproduzierbar: derselbe Monat ergibt denselben SHA-256, solange sich die Daten nicht ändern; der Abruf steht im Protokoll.',
    '',
  ];
  return zeilen.map((x) => `${x}\r\n`).join('');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Liest den Monat und baut das Paket — nichts hier rechnet Entgelt. */
export async function erstelleLohnexport(
  kontext: LeseKontext, monat: string, format: LohnexportFormat = GENERISCH_CSV,
): Promise<Lohnexport> {
  const mandantId = kontext.aktiverMandantId;
  if (mandantId === null) throw new LohnexportFehler('Ein Lohnexport braucht genau eine aktive Gesellschaft.', 'mandant');
  const { von, bis, erster } = monatsgrenzen(monat);
  const jahr = Number(monat.slice(0, 4));
  const m = Number(monat.slice(5, 7));

  const [firma] = await kontext.abfrage<{ firma: string }>(
    `select firma from mandant where id = $1::uuid`, [mandantId]);
  if (firma === undefined) throw new LohnexportFehler('Die Gesellschaft ist nicht lesbar.', 'mandant');

  const anstellungen = await kontext.abfrage<AnstellungRoh>(
    `select an.id as anstellung_id, an.personalnummer, (p.vorname || ' ' || p.nachname) as person,
            an.eintritt::text as eintritt, an.austritt::text as austritt, an.arbeitszeitmodell,
            replace(an.wochenstunden::text, '.', ',') as wochenstunden,
            k.status::text as status, k.soll_minuten, k.ist_minuten, k.korrektur_minuten,
            k.saldo_vortrag_minuten, k.saldo_minuten,
            replace(k.urlaub_tage::text, '.', ',') as urlaub_tage, replace(k.krank_tage::text, '.', ',') as krank_tage
       from anstellung an
       join person p on p.id = an.person_id
       left join stundenkonto k on k.anstellung_id = an.id and k.mandant_id = an.mandant_id
                                and k.jahr = $2::int and k.monat = $3::int
      where an.mandant_id = $1::uuid and an.geloescht_am is null
        and an.eintritt <= $5::date and (an.austritt is null or an.austritt >= $4::date)
      order by an.personalnummer, an.id`,
    [mandantId, jahr, m, von, bis]);

  const bewegungen = await kontext.abfrage<BewegungRoh>(
    `select k.anstellung_id, b.art::text as art, sum(b.minuten)::int as minuten
       from stundenkonto_bewegung b
       join stundenkonto k on k.id = b.stundenkonto_id and k.mandant_id = b.mandant_id
      where b.mandant_id = $1::uuid and k.jahr = $2::int and k.monat = $3::int
      group by 1, 2`, [mandantId, jahr, m]);

  const unfreigegeben = await kontext.abfrage<{ anstellung_id: string; n: number; gesamt: number }>(
    `select anstellung_id, count(distinct zeiteintrag_id) filter (where freigegeben_am is null)::int as n,
            count(distinct zeiteintrag_id)::int as gesamt
       from zeiteintrag_monatsanteil
      where mandant_id = $1::uuid and monat = $2::date
      group by 1`, [mandantId, erster]);

  /*
   * Die ART einer Abwesenheit ist `cse_app` entzogen (0073: gesundheitsnah);
   * der Lohnexport bekommt sie ueber `app.lohnexport_abwesenheiten` (0143) —
   * nur unter `zeit.exportieren`, nur die aktive Gesellschaft.
   */
  const abwesenheitenRoh = await kontext.abfrage<AbwesenheitRoh>(
    `select x.id, x.anstellung_id, an.personalnummer, (p.vorname || ' ' || p.nachname) as person,
            x.art, x.bezeichnung, x.bezahlt, x.lohnart, x.gesundheitsbezogen,
            x.von::text as von, x.bis::text as bis, x.von_halbtags, x.bis_halbtags,
            replace(x.tage_angerechnet::text, '.', ',') as tage, x.status
       from app.lohnexport_abwesenheiten($1::date, $2::date) x
       join anstellung an on an.id = x.anstellung_id
       join person p on p.id = an.person_id
      order by an.personalnummer, x.von, x.id`, [von, bis]);

  const zeiten: LohnexportZeit[] = [];
  const nachweise = new Map<string, MiLoGNachweis>();
  for (const an of anstellungen) {
    const stand = unfreigegeben.find((u) => u.anstellung_id === an.anstellung_id);
    if (stand === undefined || stand.gesamt === 0) continue;
    const n = await leseNachweis(kontext, { anstellungId: an.anstellung_id, monat: erster });
    nachweise.set(an.anstellung_id, n);
    for (const z of n.zeilen) {
      zeiten.push({
        anstellungId: an.anstellung_id, personalnummer: an.personalnummer, zeiteintragId: z.zeiteintragId,
        kalendertag: z.kalendertag, beginn: berlin(z.beginn), ende: berlin(z.ende),
        pauseMinuten: z.pauseMinuten, bruttoMinuten: z.bruttoMinuten, nettoMinuten: z.nettoMinuten,
        anteilBruttoMinuten: z.anteilBruttoMinuten, anteilNettoMinuten: z.anteilNettoMinuten,
        nacherfasst: z.nacherfasst,
      });
    }
  }

  const zeilen: LohnexportZeile[] = anstellungen.map((an) => {
    const bew = Object.fromEntries(BEWEGUNG_ARTEN.map((a) => [a, 0])) as Record<BewegungArt, number>;
    for (const b of bewegungen) if (b.anstellung_id === an.anstellung_id) bew[b.art] = b.minuten;
    const stand = unfreigegeben.find((u) => u.anstellung_id === an.anstellung_id);
    const n = nachweise.get(an.anstellung_id);
    return {
      anstellungId: an.anstellung_id, personalnummer: an.personalnummer, person: an.person,
      eintritt: an.eintritt, austritt: an.austritt, arbeitszeitmodell: an.arbeitszeitmodell,
      wochenstunden: an.wochenstunden, konto: an.status ?? 'kein_konto',
      sollMinuten: an.soll_minuten ?? 0, istMinuten: an.ist_minuten ?? 0,
      korrekturMinuten: an.korrektur_minuten ?? 0, saldoVortragMinuten: an.saldo_vortrag_minuten ?? 0,
      saldoMinuten: an.saldo_minuten ?? 0, urlaubTage: an.urlaub_tage ?? '0', krankTage: an.krank_tage ?? '0',
      bewegungen: bew, zeiteintraege: stand?.gesamt ?? 0, unfreigegeben: stand?.n ?? 0,
      nachweisQuelle: n?.quelle ?? null, nachweisHash: n === undefined || n.zeilen.length === 0 ? null : n.hash,
    };
  });
  const abwesenheiten: LohnexportAbwesenheit[] = abwesenheitenRoh.map((a) => ({
    id: a.id, anstellungId: a.anstellung_id, personalnummer: a.personalnummer, person: a.person,
    art: a.art, bezeichnung: a.bezeichnung, bezahlt: a.bezahlt, lohnart: a.lohnart,
    gesundheitsbezogen: a.gesundheitsbezogen, von: a.von, bis: a.bis,
    vonHalbtags: a.von_halbtags, bisHalbtags: a.bis_halbtags, tageAngerechnet: a.tage, status: a.status,
  }));

  const daten: LohnexportDaten = {
    mandantId, firma: firma.firma, monat, von, bis, zeilen, abwesenheiten, zeiten,
  };
  const zahlen = {
    beschaeftigte: zeilen.length,
    gesperrt: zeilen.filter((z) => z.konto === 'gesperrt').length,
    vorlaeufig: zeilen.filter((z) => z.konto !== 'gesperrt').length,
    unfreigegeben: zeilen.reduce((s, z) => s + z.unfreigegeben, 0),
    abwesenheitenOhneLohnart: abwesenheiten.filter((a) => a.lohnart === null).length,
    abwesenheitenBezahltUnklar: abwesenheiten.filter((a) => a.bezahlt === null).length,
  };
  const hinweise: string[] = [];
  if (format.istPlatzhalter) {
    hinweise.push('Das Format ist ein Platzhalter; bis das Lohnsystem feststeht (O-27), ist dieser Export nicht mit ihm abgestimmt.');
  }
  if (zahlen.vorlaeufig > 0) {
    hinweise.push(`${String(zahlen.vorlaeufig)} Konto/Konten sind nicht gesperrt — ihre Zahlen sind vorläufig, bis der Monat abgeschlossen ist.`);
  }
  if (zahlen.unfreigegeben > 0) {
    hinweise.push(`${String(zahlen.unfreigegeben)} Zeiteintrag/-einträge sind nicht freigegeben und deshalb nicht im Konto gebucht.`);
  }
  if (zahlen.abwesenheitenOhneLohnart > 0 || zahlen.abwesenheitenBezahltUnklar > 0) {
    hinweise.push('Abwesenheitsarten ohne Lohnart oder ohne bezahlt/unbezahlt stehen so drin (leer, „unklar") — die Zuordnung ist offen (O-139), nicht geraten.');
  }
  if (zeilen.length === 0) hinweise.push('Keine Beschäftigung mit Eintritt vor Monatsende und ohne Austritt vor Monatsbeginn.');

  const eintraege = [...format.schreibe(daten)];
  const vorlaeufig: Lohnexport = {
    ...daten,
    format: { schluessel: format.schluessel, bezeichnung: format.bezeichnung,
      zielsystem: format.zielsystem, istPlatzhalter: format.istPlatzhalter },
    zahlen, hinweise, dateien: [], zip: new Uint8Array(), zipSha256: '',
  };
  eintraege.push({ pfad: LIESMICH_NAME, bytes: new TextEncoder().encode(liesmichText(vorlaeufig)) });
  const pruefsummen = new TextEncoder().encode(
    [...eintraege].sort((a, b) => (a.pfad < b.pfad ? -1 : 1)).map((e) => `${sha256(e.bytes)}  ${e.pfad}\n`).join(''));
  eintraege.push({ pfad: PRUEFSUMMEN_NAME, bytes: pruefsummen });
  const zip = schreibeZip(eintraege);
  return {
    ...vorlaeufig,
    dateien: eintraege.map((e) => ({ pfad: e.pfad, sha256: sha256(e.bytes), groesseBytes: e.bytes.byteLength })),
    zip, zipSha256: sha256(zip),
  };
}
