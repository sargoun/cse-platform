import 'server-only';
import { createHash } from 'node:crypto';
import type { SchreibKontext } from '../../../kontext/index.js';
import { cent, formatiereGeld, type Cent } from '../geld.js';
import { kanonisiere } from '../kanonisch.js';
import { alsKanonischerWert, fuerJsonb } from '../../freigabe/diff-json.js';
import {
  anzahlUnsicher, bewerteAlle, gibWeiter, konfidenzText, minKonfidenz,
  type Befund, type BewertetesFeld, type ExtrahiertesFeld,
} from '../../freigabe/konfidenz.js';
import { risikoPunkte, stufeRisikoEin } from '../../freigabe/posteingang.js';
import { legeFreigabeVor } from '../../freigabe/vorlegen.js';
import { erfasseEingangsrechnung, pruefeDublette, setzeSteuerzeile } from '../eingangsrechnung.js';
import { extrahiereERechnung, type ERechnungExtrakt, type Rohfeld } from './erechnung.js';

/**
 * Der Vorschlag aus einer E-Rechnung — und seine Uebernahme bei Freigabe
 * (ACC-05, APR-01 … APR-03, PR 63).
 *
 * **Die Reihenfolge ist der Sinn.** Der Extraktor (`erechnung.ts`) liest die
 * Datei und prueft Form und Rechnung; dieser Dienst haelt das Gelesene an den
 * STAMM — gibt es den Lieferanten, gibt es die Rechnung schon, gibt es die
 * Steuersatzgruppe — und macht daraus einen Posteingangseintrag mit Feldern,
 * Quellen und Konfidenz. Dann WARTET er. Erst `uebernehmeEingangsVorschlag`
 * schreibt eine Eingangsrechnung, und zwar nur nach einer Genehmigung
 * (Invariante 7) und mit genau der Nutzlast, ueber die entschieden wurde.
 *
 * **Kein Modell, keine Schaetzung, kein Rechnen ausser der Probe.** Die
 * Betraege sind die der Datei; die Konfidenz ist abgeleitet
 * (`konfidenz.ts`): eine Rechenprobe, die nicht aufgeht, setzt sie auf 0,
 * ein Lieferant, der nicht im Stamm ist, ebenso — und ein unsicheres Feld
 * sperrt die Freigabe im Dienst (APR-03). Wer dann doch erfassen will, tut
 * es von Hand, mit den Werten vorbelegt (`/eingangsrechnungen/neu?von=`).
 *
 * **Wiederholbar** ueber `externe_ref = erechnung:<sha256>`: dieselbe Datei
 * zweimal hochgeladen ist derselbe Vorschlag.
 *
 * **Das Risiko ist `hoch`, immer.** `stufeRisikoEin` kennt fuer eine
 * Eingangsrechnung keinen Vergleich (kein Vormonat, keine Vorrechnung
 * desselben Lieferanten — O-363), und ohne Vergleich ist ein Vorschlag nach
 * §14.4 erstmalig. Das ist streng und ehrlich: Geld, das das Haus verlaesst,
 * steht oben im Posteingang.
 */

export class VorschlagFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: 'keine_erechnung' | 'nicht_gefunden' | 'nicht_genehmigt' | 'unvollstaendig'
      | 'schon_uebernommen' | 'kein_recht',
  ) {
    super(nachricht);
    this.name = 'VorschlagFehler';
  }
}

export const AKTION_UEBERNEHMEN = 'eingangsrechnung_uebernehmen' as const;
export const EXTRAKTION_KENNUNG = 'deterministisch:erechnung' as const;

export interface VorschlagAnlegen {
  readonly dokumentId: string;
  readonly belegId: string;
  readonly dateiname: string;
  readonly sha256: string;
  readonly xml: string;
}

export interface VorschlagErgebnis {
  readonly freigabeId: string;
  /** `false`, wenn dieselbe Datei schon einen Vorschlag hat. */
  readonly neu: boolean;
  readonly unsichereFelder: number;
  readonly risiko: string;
}

interface LieferantTreffer {
  readonly id: string;
  readonly name: string;
  readonly ust_id: string | null;
  /** `lieferant.leistungsart` — entscheidet bei § 13b zwischen den zwei Gruppen (O-363). */
  readonly leistungsart: string | null;
}

interface GruppeTreffer {
  readonly schluessel: string;
  readonly bezeichnung: string;
}

/**
 * Die Nutzlast, ueber die entschieden wird. Im Speicher sind die Betraege
 * `Cent` (Invariante 1); in der `jsonb`-Spalte stehen sie als ganze Zahlen —
 * `alsKanonischerWert` uebersetzt hin, `nutzlastAus` prueft und uebersetzt
 * zurueck. Ein `number` lebt nur an dieser einen Grenze.
 */
export interface UebernahmeNutzlast {
  readonly aktion: typeof AKTION_UEBERNEHMEN;
  readonly vorgangTyp: 'buchung_uebernehmen';
  readonly quelle: { readonly format: string; readonly dateiname: string; readonly sha256: string };
  readonly dokumentId: string;
  readonly belegId: string;
  readonly lieferantId: string | null;
  readonly lieferantName: string | null;
  readonly rechnungsnummer: string | null;
  readonly rechnungsdatum: string | null;
  readonly leistungVon: string | null;
  readonly leistungBis: string | null;
  readonly faelligAm: string | null;
  readonly waehrung: string | null;
  readonly nettoCent: Cent | null;
  readonly steuerCent: Cent | null;
  readonly bruttoCent: Cent | null;
  readonly steuerzeilen: readonly {
    readonly steuergruppe: string | null;
    readonly kategorie: string;
    readonly satzBp: number;
    readonly nettoCent: Cent;
    readonly steuerCent: Cent;
  }[];
}

/**
 * Sucht den Lieferanten im Stamm — USt-IdNr. zuerst, dann der Name. Zwei
 * Treffer sind keiner: ein Vorschlag mit dem falschen Lieferanten waere
 * schlimmer als einer ohne.
 *
 * **Nicht ueber die IBAN.** `lieferant.iban` fehlt im Spaltenrecht der
 * Sitzung (K-05, 0123): die Bankverbindung ist die Betrugsflaeche, und wer
 * Vorschlaege anlegt, soll sie nicht lesen. Sie wird nach dem Treffer
 * GEPRUEFT, nicht gesucht — `pruefeBankverbindung` unten, ueber ein Tor,
 * das nur ja/nein sagt.
 */
async function findeLieferant(
  kontext: SchreibKontext,
  l: { ustId: string | null; name: string | null },
): Promise<{ treffer: LieferantTreffer | null; befund: Befund; ueber: string }> {
  const suche = async (sql: string, wert: string): Promise<readonly LieferantTreffer[]> =>
    kontext.abfrage<LieferantTreffer>(
      `select id, name, ust_id, leistungsart::text as leistungsart from lieferant
        where archiviert_am is null and ${sql} limit 2`, [wert]);

  if (l.ustId !== null) {
    const t = await suche('upper(replace(coalesce(ust_id, \'\'), \' \', \'\')) = $1', l.ustId);
    if (t.length === 1) return { treffer: t[0]!, befund: { pruefung: 'stammdatenabgleich', bestanden: true, hinweis: null }, ueber: 'USt-IdNr.' };
  }
  if (l.name !== null) {
    const t = await suche('lower(btrim(name)) = lower(btrim($1))', l.name);
    if (t.length === 1) return { treffer: t[0]!, befund: { pruefung: 'stammdatenabgleich', bestanden: true, hinweis: null }, ueber: 'Name' };
    if (t.length > 1) {
      return { treffer: null, ueber: '', befund: { pruefung: 'stammdatenabgleich', bestanden: false,
        hinweis: `Mehrere Lieferanten heissen „${l.name}" — nicht eindeutig` } };
    }
  }
  return { treffer: null, ueber: '', befund: { pruefung: 'stammdatenabgleich', bestanden: false,
    hinweis: 'Lieferant ist nicht im Stamm (weder USt-IdNr. noch IBAN noch Name bekannt)' } };
}

/**
 * Die IBAN der Datei gegen den Stamm — ueber `app.lieferant_iban_stimmt`
 * (0140), das nur ja/nein/nicht-pruefbar zurueckgibt und jede Pruefung
 * protokolliert. Die echte Rechnung mit der falschen IBAN ist der haeufigste
 * Angriff auf eine Kreditorenbuchhaltung; hier wird sie ein unsicheres Feld,
 * bevor ein Mensch freigibt.
 */
async function pruefeBankverbindung(
  kontext: SchreibKontext, lieferantId: string, iban: string,
): Promise<Befund> {
  const [z] = await kontext.abfrage<{ stimmt: boolean | null }>(
    `select app.lieferant_iban_stimmt($1::uuid, $2) as stimmt`, [lieferantId, iban]);
  const stimmt = z?.stimmt ?? null;
  if (stimmt === true) return { pruefung: 'stammdatenabgleich', bestanden: true, hinweis: null };
  if (stimmt === false) {
    return { pruefung: 'stammdatenabgleich', bestanden: false,
      hinweis: 'Die IBAN weicht von der Bankverbindung im Stamm ab — vor jeder Zahlung klären' };
  }
  return { pruefung: 'stammdatenabgleich', bestanden: true,
    hinweis: 'Im Stamm ist keine Bankverbindung hinterlegt — nicht vergleichbar (O-183)' };
}

/**
 * Die § 13b-Gruppe je Gewerk des Lieferanten — die **Voreinstellung** (O-363,
 * D-787). § 13b Abs. 2 Nr. 4 UStG (Bauleistung) und Nr. 8 (Gebäudereinigung)
 * tragen beide 0 % / AE; welche gilt, sagt das Gewerk des LIEFERANTEN, das der
 * Stamm als `lieferant.leistungsart` führt. Ohne Gewerk im Stamm entscheidet
 * weiter ein Mensch — eine geratene Gruppe wäre eine Steueraussage.
 */
export const GRUPPE_JE_LEISTUNGSART: Readonly<Record<string, string>> = {
  bau: 'ust_0_13b_bau',
  gebaeudereinigung: 'ust_0_13b_reinigung',
};

// TODO(client, O-363): Voreinstellung — bei zwei passenden Gruppen entscheidet das Gewerk des Lieferanten (`lieferant.leistungsart`); ohne Gewerk wählt ein Mensch.
export function waehleGruppeNachLeistungsart(
  treffer: readonly { readonly schluessel: string }[], leistungsart: string | null,
): string | null {
  if (leistungsart === null) return null;
  const gesucht = GRUPPE_JE_LEISTUNGSART[leistungsart];
  if (gesucht === undefined) return null;
  return treffer.some((g) => g.schluessel === gesucht) ? gesucht : null;
}

/**
 * Die Steuersatzgruppe zu Satz und Kategorie — genau eine, sonst Befund.
 *
 * Zwei Treffer gibt es nur bei § 13b (0 %, AE); dann entscheidet das Gewerk
 * des Lieferanten (`waehleGruppeNachLeistungsart`), und der Befund sagt, dass
 * es die Voreinstellung war. Ohne Gewerk bleibt das Feld unsicher, und ein
 * Mensch wählt — wie vor D-787.
 */
async function findeGruppe(
  kontext: SchreibKontext, satzBp: number, kategorie: string, leistungsart: string | null,
): Promise<{ schluessel: string | null; befund: Befund }> {
  const t = await kontext.abfrage<GruppeTreffer>(
    `select schluessel, bezeichnung from steuersatz_gruppe
      where satz_bp = $1 and kategorie::text = $2 and gueltig_bis is null
      order by schluessel limit 2`, [satzBp, kategorie]);
  if (t.length === 1) {
    return { schluessel: t[0]!.schluessel, befund: { pruefung: 'katalogabgleich', bestanden: true, hinweis: null } };
  }
  if (t.length === 0) {
    return { schluessel: null, befund: { pruefung: 'katalogabgleich', bestanden: false,
      hinweis: `Keine Steuersatzgruppe für ${(satzBp / 100).toFixed(2).replace('.', ',')} % / ${kategorie} im Katalog` } };
  }
  const nachGewerk = waehleGruppeNachLeistungsart(t, leistungsart);
  if (nachGewerk !== null) {
    return { schluessel: nachGewerk, befund: { pruefung: 'katalogabgleich', bestanden: true,
      hinweis: `Steuersatzgruppe nach dem Gewerk des Lieferanten (${leistungsart ?? ''}) — Voreinstellung O-363` } };
  }
  return { schluessel: null, befund: { pruefung: 'katalogabgleich', bestanden: false,
    hinweis: `Mehrere Steuersatzgruppen für ${(satzBp / 100).toFixed(2).replace('.', ',')} % / ${kategorie} — ohne Gewerk im Lieferantenstamm wählt ein Mensch (O-363)` } };
}

function alsExtrahiert(
  f: Rohfeld, dokumentId: string, zusatz: readonly Befund[] = [],
): ExtrahiertesFeld {
  return {
    feldPfad: f.feldPfad,
    bezeichnung: f.bezeichnung,
    wertVorher: null,
    wertNachher: f.wert,
    quelle: { art: 'dokument', dokumentId, seite: null, tabelle: 'xml', zelle: f.zelle, bbox: null,
      zitat: f.zitat },
    ocrKonfidenz: null,
    befunde: [...f.befunde, ...zusatz],
    extraktionModell: EXTRAKTION_KENNUNG,
  };
}

/** Der eine Satz — Schablone, kein Modell (D-464). */
function zusammenfassungAus(e: ERechnungExtrakt, lieferant: string | null): string {
  const n = e.nutzlast;
  const betrag = n.nettoCent === null || n.steuerCent === null || n.bruttoCent === null
    ? 'Beträge unvollständig'
    : `Netto ${formatiereGeld(n.nettoCent)} + USt ${formatiereGeld(n.steuerCent)} = ${formatiereGeld(n.bruttoCent)}`;
  const faellig = n.faelligAm === null ? 'ohne Fälligkeit'
    : `fällig ${n.faelligAm.slice(8, 10)}.${n.faelligAm.slice(5, 7)}.${n.faelligAm.slice(0, 4)}`;
  return `E-Rechnung (${e.format.toUpperCase()}) von ${lieferant ?? 'unbekanntem Lieferanten'}: ${betrag}, ${faellig}`;
}

export async function legeEingangsVorschlagAn(
  kontext: SchreibKontext, e: VorschlagAnlegen,
): Promise<VorschlagErgebnis> {
  const externeRef = `erechnung:${e.sha256}`;
  const [da] = await kontext.abfrage<{ id: string; unsichere: number; risiko: string }>(
    `select id, unsichere_felder_anzahl as unsichere, risiko::text as risiko
       from freigabe where externe_ref = $1 and mandant_id = $2::uuid`,
    [externeRef, kontext.aktiverMandantId]);
  if (da !== undefined) {
    return { freigabeId: da.id, neu: false, unsichereFelder: da.unsichere, risiko: da.risiko };
  }

  const extrakt = extrahiereERechnung(e.xml);
  const n = extrakt.nutzlast;

  /* Stamm: der Lieferant */
  const lieferant = await findeLieferant(kontext, n.lieferant);
  /* Dubletten: erst mit Lieferant, Nummer und Datum sagt der Riegel etwas. */
  const dublette = lieferant.treffer === null ? null : await pruefeDublette(kontext, {
    lieferantId: lieferant.treffer.id, rechnungsnummerLieferant: n.rechnungsnummer,
    rechnungsdatum: n.rechnungsdatum,
  });
  /* Katalog: je Steuerzeile eine Gruppe */
  const gruppen = await Promise.all(n.steuerzeilen.map((z) =>
    findeGruppe(kontext, z.satzBp, z.kategorie, lieferant.treffer?.leistungsart ?? null)));

  const felder: ExtrahiertesFeld[] = [];
  for (const f of extrakt.felder) {
    if (f.feldPfad === '/lieferant/name') {
      felder.push(alsExtrahiert(f, e.dokumentId, [lieferant.befund]));
      continue;
    }
    if (f.feldPfad === '/lieferant/iban' && lieferant.treffer !== null && n.lieferant.iban !== null) {
      felder.push(alsExtrahiert(f, e.dokumentId,
        [await pruefeBankverbindung(kontext, lieferant.treffer.id, n.lieferant.iban)]));
      continue;
    }
    if (f.feldPfad === '/rechnungsnummer' && dublette !== null) {
      felder.push(alsExtrahiert(f, e.dokumentId, [dublette.istDublette
        ? { pruefung: 'dublettenpruefung', bestanden: false, hinweis: dublette.warnung ?? 'Diese Rechnung liegt bereits vor' }
        : { pruefung: 'dublettenpruefung', bestanden: true, hinweis: null }]));
      continue;
    }
    const zeile = /^\/steuerzeilen\/(\d+)$/u.exec(f.feldPfad);
    if (zeile !== null) {
      const g = gruppen[Number(zeile[1])];
      felder.push(alsExtrahiert(f, e.dokumentId, g === undefined ? [] : [g.befund]));
      continue;
    }
    felder.push(alsExtrahiert(f, e.dokumentId));
  }
  /* Der Lieferant als eigenes Feld: die Zuordnung ist ein Wert, den ein Mensch sieht. */
  felder.push({
    feldPfad: '/lieferantId', bezeichnung: 'Lieferant im Stamm',
    wertVorher: null,
    wertNachher: lieferant.treffer === null ? null : `${lieferant.treffer.name} (über ${lieferant.ueber})`,
    quelle: { art: 'dokument', dokumentId: e.dokumentId, seite: null, tabelle: 'stamm', zelle: 'lieferant',
      bbox: null, zitat: n.lieferant.ustId ?? n.lieferant.name },
    ocrKonfidenz: null,
    befunde: [lieferant.befund],
    extraktionModell: EXTRAKTION_KENNUNG,
  });

  const bewertet: readonly BewertetesFeld[] = gibWeiter(bewerteAlle(felder));
  const unsichere = anzahlUnsicher(bewertet);

  const nutzlast: UebernahmeNutzlast = {
    aktion: AKTION_UEBERNEHMEN,
    vorgangTyp: 'buchung_uebernehmen',
    quelle: { format: extrakt.format, dateiname: e.dateiname, sha256: e.sha256 },
    dokumentId: e.dokumentId,
    belegId: e.belegId,
    lieferantId: lieferant.treffer?.id ?? null,
    lieferantName: n.lieferant.name,
    rechnungsnummer: n.rechnungsnummer,
    rechnungsdatum: n.rechnungsdatum,
    leistungVon: n.leistungVon,
    leistungBis: n.leistungBis,
    faelligAm: n.faelligAm,
    waehrung: n.waehrung,
    nettoCent: n.nettoCent,
    steuerCent: n.steuerCent,
    bruttoCent: n.bruttoCent,
    steuerzeilen: n.steuerzeilen.map((z, i) => ({
      steuergruppe: gruppen[i]?.schluessel ?? null,
      kategorie: z.kategorie, satzBp: z.satzBp,
      nettoCent: z.nettoCent, steuerCent: z.steuerCent,
    })),
  };
  const kanonisch = alsKanonischerWert(nutzlast);
  const payloadHash = createHash('sha256').update(kanonisiere(kanonisch)).digest('hex');

  const urteil = stufeRisikoEin({
    vorgangTyp: 'buchung_uebernehmen',
    betragCent: n.bruttoCent,
    wirksameGrenzeCent: null,
    oeffentlicherAuftraggeber: false,
    neueGegenpartei: lieferant.treffer === null,
    unsichereFelder: unsichere,
    injektionsverdacht: false,
    personenbezogeneEntscheidung: false,
    arbzgVerdikt: 'keine',
    hatVergleich: false,
    diffLeer: true,
  });

  const titel = `E-Rechnung ${n.rechnungsnummer ?? 'ohne Nummer'} · ${lieferant.treffer?.name ?? n.lieferant.name ?? 'unbekannter Lieferant'}`;
  /*
   * Vorgelegt über `app.freigabe_vorlegen` (V-376, D-819), mit den Feldern im
   * selben Aufruf: vorlegen darf, wer die Eingangsrechnung erfasst
   * (`eingang.schreiben`, Modul des Entscheidungsrechts `eingang.freigeben`);
   * das Recht, über Freigaben zu entscheiden, braucht es dafür nicht mehr.
   */
  const freigabeId = await legeFreigabeVor(kontext, {
    aktion: AKTION_UEBERNEHMEN,
    vorgangTyp: 'buchung_uebernehmen',
    titel,
    zusammenfassung: zusammenfassungAus(extrakt, lieferant.treffer?.name ?? n.lieferant.name),
    risiko: urteil.risiko,
    risikoPunkte: risikoPunkte(urteil.risiko),
    vorschauPayload: fuerJsonb(kanonisch),
    payloadHash,
    betragCent: n.bruttoCent,
    minKonfidenz: (() => { const m = minKonfidenz(bewertet); return m === null ? null : konfidenzText(m); })(),
    stapelFaehig: false,
    stapelSperreGrund: 'Eingangsrechnungen werden einzeln geprüft (ACC-05)',
    erforderlichesRecht: 'eingang.freigeben',
    bezugTyp: 'beleg',
    bezugId: e.belegId,
    externeRef,
    felder: bewertet.map((f) => ({
      feldPfad: f.feldPfad,
      bezeichnung: f.bezeichnung,
      wertVorher: f.wertVorher,
      wertNachher: f.wertNachher,
      konfidenz: konfidenzText(f.konfidenz),
      unsicher: f.unsicher,
      grund: f.grund,
      quelleDokumentId: f.quelle.art === 'dokument' ? f.quelle.dokumentId : null,
      quelleTabelle: f.quelle.art === 'dokument' ? f.quelle.tabelle : null,
      quelleZelle: f.quelle.art === 'dokument' ? f.quelle.zelle : null,
      quelleZitat: f.quelle.art === 'dokument' || f.quelle.art === 'zitat' ? f.quelle.zitat : null,
      extraktionModell: f.extraktionModell,
    })),
  });

  return { freigabeId, neu: true, unsichereFelder: unsichere, risiko: urteil.risiko };
}

// ---------------------------------------------------------------------------
// Die Uebernahme — nach der Genehmigung, mit der genehmigten Nutzlast
// ---------------------------------------------------------------------------

interface FreigabeRoh {
  readonly id: string;
  readonly status: string;
  readonly aktion: string;
  readonly ausfuehrung_status: string;
  readonly bezug_typ: string | null;
  readonly bezug_id: string | null;
  readonly vorschau_payload: unknown;
}

const unvollstaendig = (satz: string): VorschlagFehler => new VorschlagFehler(satz, 'unvollstaendig');

/** Eine ganze JSON-Zahl wird wieder `Cent`; alles andere ist ein Fehler, kein Rundungsversuch. */
function centAusJson(wert: unknown, name: string): Cent | null {
  if (wert === null || wert === undefined) return null;
  if (typeof wert !== 'number' || !Number.isSafeInteger(wert)) {
    throw unvollstaendig(`${name} ist in der Nutzlast keine ganze Zahl.`);
  }
  return cent(BigInt(wert));
}

function textAusJson(wert: unknown, name: string): string | null {
  if (wert === null || wert === undefined) return null;
  if (typeof wert !== 'string') throw unvollstaendig(`${name} ist in der Nutzlast keine Zeichenkette.`);
  return wert;
}

function textPflicht(wert: unknown, name: string): string {
  const t = textAusJson(wert, name);
  if (t === null) throw unvollstaendig(`${name} fehlt in der Nutzlast.`);
  return t;
}

/**
 * Liest die gespeicherte Nutzlast zurueck — Feld fuer Feld, mit Typpruefung.
 * Die Bytes hat der Definer gegen `payload_hash` geprueft; hier wird nur noch
 * die FORM geprueft, damit kein Wert als etwas anderes gelesen wird, als er
 * geschrieben wurde.
 */
function nutzlastAus(roh: unknown): UebernahmeNutzlast {
  if (roh === null || typeof roh !== 'object' || Array.isArray(roh)) {
    throw unvollstaendig('Die Nutzlast des Vorschlags ist kein Objekt.');
  }
  const p = roh as Record<string, unknown>;
  if (p['aktion'] !== AKTION_UEBERNEHMEN) {
    throw unvollstaendig('Die Nutzlast ist kein Eingangsrechnungs-Vorschlag.');
  }
  const quelle = p['quelle'];
  if (quelle === null || typeof quelle !== 'object' || Array.isArray(quelle)) {
    throw unvollstaendig('Die Quelle fehlt in der Nutzlast.');
  }
  const q = quelle as Record<string, unknown>;
  const zeilenRoh = p['steuerzeilen'];
  if (!Array.isArray(zeilenRoh)) throw unvollstaendig('Die Steuerzeilen fehlen in der Nutzlast.');
  const steuerzeilen = zeilenRoh.map((z: unknown, i) => {
    if (z === null || typeof z !== 'object' || Array.isArray(z)) {
      throw unvollstaendig(`Steuerzeile ${String(i + 1)} ist kein Objekt.`);
    }
    const r = z as Record<string, unknown>;
    const satz = r['satzBp'];
    if (typeof satz !== 'number' || !Number.isSafeInteger(satz)) {
      throw unvollstaendig(`Steuerzeile ${String(i + 1)}: der Satz ist keine ganze Zahl.`);
    }
    const netto = centAusJson(r['nettoCent'], `Steuerzeile ${String(i + 1)} netto`);
    const steuer = centAusJson(r['steuerCent'], `Steuerzeile ${String(i + 1)} Steuer`);
    if (netto === null || steuer === null) {
      throw unvollstaendig(`Steuerzeile ${String(i + 1)}: Betrag fehlt.`);
    }
    return {
      steuergruppe: textAusJson(r['steuergruppe'], 'Steuergruppe'),
      kategorie: textPflicht(r['kategorie'], 'Kategorie'),
      satzBp: satz, nettoCent: netto, steuerCent: steuer,
    };
  });
  return {
    aktion: AKTION_UEBERNEHMEN,
    vorgangTyp: 'buchung_uebernehmen',
    quelle: {
      format: textPflicht(q['format'], 'Format'),
      dateiname: textPflicht(q['dateiname'], 'Dateiname'),
      sha256: textPflicht(q['sha256'], 'Prüfsumme'),
    },
    dokumentId: textPflicht(p['dokumentId'], 'Dokument'),
    belegId: textPflicht(p['belegId'], 'Beleg'),
    lieferantId: textAusJson(p['lieferantId'], 'Lieferant'),
    lieferantName: textAusJson(p['lieferantName'], 'Lieferantenname'),
    rechnungsnummer: textAusJson(p['rechnungsnummer'], 'Rechnungsnummer'),
    rechnungsdatum: textAusJson(p['rechnungsdatum'], 'Rechnungsdatum'),
    leistungVon: textAusJson(p['leistungVon'], 'Leistung von'),
    leistungBis: textAusJson(p['leistungBis'], 'Leistung bis'),
    faelligAm: textAusJson(p['faelligAm'], 'Fälligkeit'),
    waehrung: textAusJson(p['waehrung'], 'Währung'),
    nettoCent: centAusJson(p['nettoCent'], 'Netto'),
    steuerCent: centAusJson(p['steuerCent'], 'Steuer'),
    bruttoCent: centAusJson(p['bruttoCent'], 'Brutto'),
    steuerzeilen,
  };
}

export interface Uebernommen {
  readonly eingangsrechnungId: string;
  /** `false`, wenn die Freigabe schon ausgefuehrt war — dann die bestehende Kennung. */
  readonly neu: boolean;
}

/**
 * Schreibt die Eingangsrechnung aus einer GENEHMIGTEN Freigabe.
 *
 * Laeuft in derselben Transaktion wie die Entscheidung
 * (`api/freigaben/[id]/entscheidung`): scheitert die Uebernahme, rollt die
 * Entscheidung mit zurueck — es gibt keinen Zustand „genehmigt, aber nicht
 * uebernommen", den jemand nachts aufraeumen muesste. Die Werte kommen aus
 * `vorschau_payload`, genau den Bytes, die der Definer gegen `payload_hash`
 * geprueft hat; nichts wird hier neu gelesen oder gerechnet.
 */
export async function uebernehmeEingangsVorschlag(
  kontext: SchreibKontext, freigabeId: string,
): Promise<Uebernommen> {
  const [f] = await kontext.abfrage<FreigabeRoh>(
    `select id, status::text as status, aktion, ausfuehrung_status::text as ausfuehrung_status,
            bezug_typ, bezug_id, vorschau_payload
       from freigabe where id = $1::uuid for update`,
    [freigabeId]);
  if (f === undefined) throw new VorschlagFehler('Die Freigabe ist nicht erreichbar.', 'nicht_gefunden');
  if (f.aktion !== AKTION_UEBERNEHMEN) {
    throw new VorschlagFehler('Diese Freigabe ist kein Eingangsrechnungs-Vorschlag.', 'unvollstaendig');
  }
  if (f.ausfuehrung_status === 'ausgefuehrt' && f.bezug_typ === 'eingangsrechnung' && f.bezug_id !== null) {
    return { eingangsrechnungId: f.bezug_id, neu: false };
  }
  if (f.status !== 'genehmigt') {
    throw new VorschlagFehler(
      `Übernommen wird nur eine genehmigte Freigabe (Stand: ${f.status}).`, 'nicht_genehmigt');
  }
  /*
   * Wer entscheiden darf, darf nicht deshalb schon erfassen. `freigabe.
   * entscheiden` und `eingang.schreiben` liegen bei den Systemrollen
   * beisammen, bei einer eigenen Rolle nicht zwingend — und die Policy auf
   * `eingangsrechnung` wuerde dann mit einem Datenbankfehler antworten, der
   * wie ein Absturz aussieht. Hier steht stattdessen der Satz; die
   * Entscheidung rollt mit zurueck (dieselbe Transaktion).
   */
  const [recht] = await kontext.abfrage<{ hat: boolean }>(
    `select app.hat_recht('eingang.schreiben', app.aktiver_mandant()) as hat`);
  if (recht?.hat !== true) {
    throw new VorschlagFehler(
      'Die Übernahme legt eine Eingangsrechnung an; dafür fehlt das Recht „eingang.schreiben". '
      + 'Die Entscheidung wurde nicht gespeichert.', 'kein_recht');
  }
  const n = nutzlastAus(f.vorschau_payload);
  if (n.lieferantId === null || n.rechnungsnummer === null || n.rechnungsdatum === null
      || n.nettoCent === null || n.steuerCent === null || n.bruttoCent === null) {
    throw new VorschlagFehler(
      'Der Vorschlag ist unvollständig (Lieferant, Nummer, Datum oder Beträge fehlen) — '
      + 'er lässt sich nur von Hand erfassen.', 'unvollstaendig');
  }
  if (n.waehrung !== null && n.waehrung !== 'EUR') {
    throw new VorschlagFehler(
      `Die Rechnung lautet auf ${n.waehrung}; Cent sind Euro-Cent, eine Fremdwährung wird nicht `
      + 'als Euro übernommen — von Hand erfassen.', 'unvollstaendig');
  }
  if (n.steuerzeilen.some((z) => z.steuergruppe === null)) {
    throw new VorschlagFehler(
      'Eine Steuerzeile hat keine eindeutige Steuersatzgruppe (O-363) — von Hand erfassen.',
      'unvollstaendig');
  }

  const id = await erfasseEingangsrechnung(kontext, {
    belegId: n.belegId,
    lieferantId: n.lieferantId,
    rechnungsnummerLieferant: n.rechnungsnummer,
    rechnungsdatum: n.rechnungsdatum,
    leistungsdatum: n.leistungBis ?? n.leistungVon ?? null,
    leistungVon: n.leistungVon,
    leistungBis: n.leistungBis,
    nettoCent: n.nettoCent,
    steuerCent: n.steuerCent,
    bruttoCent: n.bruttoCent,
    faelligAm: n.faelligAm,
  });
  for (const z of n.steuerzeilen) {
    await setzeSteuerzeile(kontext, {
      eingangsrechnungId: id, steuergruppe: z.steuergruppe!,
      nettoCent: z.nettoCent, steuerCent: z.steuerCent,
    });
  }
  await kontext.schreibe(
    `update freigabe
        set ausfuehrung_status = 'ausgefuehrt', ausgefuehrt_am = now(),
            ausfuehrung_versuch = ausfuehrung_versuch + 1,
            bezug_typ = 'eingangsrechnung', bezug_id = $2::uuid
      where id = $1::uuid`,
    [freigabeId, id]);
  return { eingangsrechnungId: id, neu: true };
}
