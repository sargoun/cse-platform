import 'server-only';
import { createHash } from 'node:crypto';
import type { Bucket, Speicher } from '../../storage/adapter.js';
import type { JobDefinition } from '../../jobs/registry.js';
import { schreibeZip } from '../archiv/zip.js';
import { nachCp1252 } from './datev/cp1252.js';
import { exportDateiname } from './datev/export.js';
import { csvText, baueZ3Tabellen, type Spalte, type Z3Kontext } from './z3.js';
import { monatszahlen } from './monatszahlen.js';
import { KLASSEN, altersstruktur, postenListe } from './offene-posten.js';
import { stimmeAb } from '../finanz/ausgangsbuch.js';
import { erstellePruefbuendel, type Pruefbuendel } from './pruefbuendel.js';
import {
  alsMarkdown, erstelleVerfahrensdokumentation, type Auslieferung,
} from './verfahrensdokumentation.js';
import type { Wirtschaftsjahr } from './wirtschaftsjahr.js';

/**
 * Das Jahrespaket — ein Klick, ein ZIP fuer den Steuerberater (ACC-11,
 * D-06, PR 67, D-486).
 *
 * **Was der Steuerberater zum Jahresabschluss braucht, liegt bereits vor**
 * — verstreut ueber acht Bildschirme. Das Paket sammelt es an einer Stelle,
 * je Wirtschaftsjahr: die Datentabellen des Z3-Exports (Journal, Rechnungen,
 * Eingangsrechnungen, Zahlungen, offene Posten, Belege, Stammdaten), die
 * Monatszahlen (BWA-artig), die offenen Posten zum Stichtag mit
 * Altersstruktur, das Rechnungsausgangsbuch, die erzeugten DATEV-Stapel des
 * Jahres (Liste immer, Dateien mit verbundenem Speicher), das
 * Pruefbuendel-Manifest mit den archivierten Belegen (mit Speicher, ohne
 * Sperre) und die Verfahrensdokumentation. Dazu `LIESMICH.txt`, das sagt,
 * was drin ist und was fehlt, und `pruefsummen.txt`.
 *
 * **Es rechnet nichts ab.** Jahresabschluss, E-Bilanz und Steuererklaerung
 * macht der Steuerberater (D-06); das Paket ist die Uebergabe. Es erzeugt
 * auch keinen DATEV-Stapel nebenbei: ein Stapel ist ein registrierter
 * Vorgang mit Stempel auf jeder Zeile (`datev/export.ts`), und den loest
 * ein Mensch unter Buchhaltung → DATEV aus. Zeilen des Jahres, die in keinem
 * Stapel stehen, zaehlt das Paket und nennt sie.
 *
 * **Ehrlich ueber Luecken, reproduzierbar im Rest.** Ohne Objektspeicher
 * fehlen die Dateien (EXTF, PDF), nicht die Listen; mit Exportsperre fehlen
 * die Belege, nicht das Manifest — jede Luecke steht im LIESMICH mit
 * Grund. Keine Uhr im Paket; die Verfahrensdokumentation geht ohne
 * Abrufzeit hinein. Derselbe Stand ergibt denselben Hash.
 */
export interface JahrespaketDatei {
  readonly pfad: string;
  readonly sha256: string;
  readonly groesseBytes: number;
}

export interface JahrespaketZahlen {
  readonly tabellen: number;
  readonly tabellenZeilen: number;
  readonly unvollstaendig: number;
  readonly datevStapel: number;
  readonly datevDateien: number;
  readonly zeilenOhneStapel: number;
  readonly belege: number;
  readonly belegeImPaket: number;
}

export interface Jahrespaket {
  readonly mandantId: string;
  readonly firma: string;
  readonly jahr: number;
  readonly von: string;
  readonly bis: string;
  readonly bezeichnung: string;
  readonly wirtschaftsjahr: Wirtschaftsjahr;
  readonly speicherVerbunden: boolean;
  readonly sperre: Pruefbuendel['sperre'];
  readonly zahlen: JahrespaketZahlen;
  readonly hinweise: readonly string[];
  readonly dateien: readonly JahrespaketDatei[];
  /** `null` im Manifestlauf (`nurManifest`) — die Seite zeigt, der Abruf packt. */
  readonly zip: Uint8Array | null;
  readonly zipSha256: string | null;
}

export class JahrespaketFehler extends Error {
  constructor(nachricht: string, readonly grund: 'integritaet' | 'speicher') {
    super(nachricht);
    this.name = 'JahrespaketFehler';
  }
}

export const LIESMICH_NAME = 'LIESMICH.txt';
export const PRUEFSUMMEN_NAME = 'pruefsummen.txt';
export const HINWEIS_D06 =
  'Dieses Paket ist eine Übergabe an den Steuerberater. Jahresabschluss, E-Bilanz und Steuererklärung '
  + 'entstehen dort — die Plattform bereitet vor und exportiert (D-06).';

interface StapelRoh {
  readonly id: string;
  readonly von: string;
  readonly bis: string;
  readonly status: string;
  readonly zeilen: number;
  readonly summe_soll_cent: string;
  readonly summe_haben_cent: string;
  readonly datei_sha256: string | null;
  readonly format_ungeprueft: boolean;
  readonly uebergeben_am: string | null;
  readonly erstellt_am: string;
  readonly dokument_id: string | null;
  readonly bucket: string | null;
  readonly objekt_schluessel: string | null;
}

const MONATE_SPALTEN: readonly Spalte[] = [
  { name: 'monat', typ: 'text', schluessel: true, text: 'JJJJ-MM' },
  { name: 'von', typ: 'datum', text: 'Beginn' },
  { name: 'bis', typ: 'datum', text: 'Ende' },
  { name: 'erloese', typ: 'betrag', text: 'Erlöse netto EUR (festgeschriebene Ausgangsrechnungen)' },
  { name: 'rechnungen', typ: 'zahl', text: 'Ausgangsrechnungen' },
  { name: 'aufwand', typ: 'betrag', text: 'Aufwand netto EUR (freigegebene/gebuchte Eingangsrechnungen)' },
  { name: 'eingangsrechnungen', typ: 'zahl', text: 'Eingangsrechnungen' },
  { name: 'ergebnis', typ: 'betrag', text: 'Ergebnis EUR' },
  { name: 'periode_status', typ: 'text', text: 'offen, vorlaeufig_geschlossen, geschlossen, keine' },
  { name: 'eingefroren_erloese', typ: 'betrag', text: 'Beim Schließen eingefroren' },
  { name: 'eingefroren_aufwand', typ: 'betrag', text: 'Beim Schließen eingefroren' },
  { name: 'eingefroren_ergebnis', typ: 'betrag', text: 'Beim Schließen eingefroren' },
  { name: 'abweichung', typ: 'text', text: 'ja, wenn die eingefrorenen Zahlen von den heutigen abweichen' },
];

const POSTEN_SPALTEN: readonly Spalte[] = [
  { name: 'id', typ: 'text', schluessel: true, text: 'Kennung des Postens' },
  { name: 'art', typ: 'text', text: 'debitor oder kreditor' },
  { name: 'gegenpartei', typ: 'text', text: 'Kunde oder Lieferant' },
  { name: 'belegnummer', typ: 'text', text: 'Rechnungsnummer' },
  { name: 'faellig_am', typ: 'datum', text: 'Fälligkeit' },
  { name: 'tage', typ: 'zahl', text: 'Tage seit Fälligkeit am Stichtag' },
  { name: 'klasse', typ: 'text', text: 'Altersklasse' },
  { name: 'betrag', typ: 'betrag', text: 'Forderung/Verbindlichkeit EUR' },
  { name: 'bezahlt', typ: 'betrag', text: 'Ausgeglichen EUR' },
  { name: 'offen', typ: 'betrag', text: 'Offen EUR' },
  { name: 'mahnstufe', typ: 'zahl', text: 'Mahnstufe' },
];

const ALTER_SPALTEN: readonly Spalte[] = [
  { name: 'art', typ: 'text', schluessel: true, text: 'debitor oder kreditor' },
  { name: 'klasse', typ: 'text', schluessel: true, text: 'Altersklasse' },
  { name: 'summe', typ: 'betrag', text: 'Offen EUR' },
];

const AUSGANGSBUCH_SPALTEN: readonly Spalte[] = [
  { name: 'nummernkreis', typ: 'text', schluessel: true, text: 'Nummernkreis' },
  { name: 'anzahl', typ: 'zahl', text: 'Rechnungen' },
  { name: 'erste_nummer', typ: 'zahl', text: 'Erste laufende Nummer' },
  { name: 'letzte_nummer', typ: 'zahl', text: 'Letzte laufende Nummer' },
  { name: 'summe_buch', typ: 'betrag', text: 'Summe brutto laut Buch EUR' },
  { name: 'summe_belege', typ: 'betrag', text: 'Summe brutto laut Belegen EUR' },
  { name: 'luecken', typ: 'text', text: 'Fehlende Nummern' },
  { name: 'ohne_kettenglied', typ: 'zahl', text: 'Rechnungen ohne Glied der Hash-Kette' },
];

const STAPEL_SPALTEN: readonly Spalte[] = [
  { name: 'id', typ: 'text', schluessel: true, text: 'Kennung des Exports' },
  { name: 'von', typ: 'datum', text: 'Zeitraum Beginn' },
  { name: 'bis', typ: 'datum', text: 'Zeitraum Ende' },
  { name: 'status', typ: 'text', text: 'erzeugt, uebergeben, verworfen' },
  { name: 'zeilen', typ: 'zahl', text: 'Buchungszeilen' },
  { name: 'summe_soll', typ: 'betrag', text: 'Summe Soll EUR' },
  { name: 'summe_haben', typ: 'betrag', text: 'Summe Haben EUR' },
  { name: 'datei_sha256', typ: 'text', text: 'SHA-256 der EXTF-Datei' },
  { name: 'datei_im_paket', typ: 'text', text: 'Pfad im Paket oder leer' },
  { name: 'format_ungeprueft', typ: 'text', text: 'ja: aus der Spezifikation abgeleitet, kein Kundenmuster (O-05)' },
  { name: 'uebergeben_am', typ: 'text', text: 'Übergabe, Europe/Berlin' },
  { name: 'erstellt_am', typ: 'text', text: 'Erzeugt, Europe/Berlin' },
];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function csv(spalten: readonly Spalte[], zeilen: readonly Readonly<Record<string, unknown>>[]): Uint8Array {
  return nachCp1252(csvText(spalten, zeilen));
}

export async function erstelleJahrespaket(
  db: Z3Kontext, speicher: Speicher, jahr: number,
  doku: { readonly jobs: readonly JobDefinition[]; readonly auslieferung: Auslieferung },
  optionen: { readonly nurManifest?: boolean } = {},
): Promise<Jahrespaket> {
  const mandantId = db.aktiverMandantId;
  const lauf = await baueZ3Tabellen(db, jahr);
  const { von, bis, bezeichnung, wirtschaftsjahr: wj } = lauf;
  const eintraege: { pfad: string; bytes: Uint8Array }[] = lauf.eintraege.map((e) => ({ pfad: `daten/${e.pfad}`, bytes: e.bytes }));
  const hinweise: string[] = [];

  /* Monatszahlen (BWA-artig) je Monat des Wirtschaftsjahrs. */
  const mz = await monatszahlen(db, jahr, wj);
  eintraege.push({ pfad: 'auswertung/monatszahlen.csv', bytes: csv(MONATE_SPALTEN, mz.monate.map((m) => ({
    monat: m.monat, von: m.von, bis: m.bis, erloese: String(m.erloeseCent), rechnungen: m.rechnungen,
    aufwand: String(m.aufwandCent), eingangsrechnungen: m.eingangsrechnungen, ergebnis: String(m.ergebnisCent),
    periode_status: m.periode?.status ?? 'keine',
    eingefroren_erloese: m.periode?.eingefroren === null || m.periode?.eingefroren === undefined ? null : String(m.periode.eingefroren.erloeseCent),
    eingefroren_aufwand: m.periode?.eingefroren === null || m.periode?.eingefroren === undefined ? null : String(m.periode.eingefroren.aufwandCent),
    eingefroren_ergebnis: m.periode?.eingefroren === null || m.periode?.eingefroren === undefined ? null : String(m.periode.eingefroren.ergebnisCent),
    abweichung: m.periode?.abweichung === true ? 'ja' : 'nein',
  }))) });

  /* Offene Posten zum letzten Tag des Wirtschaftsjahrs, mit Altersstruktur. */
  for (const art of ['debitor', 'kreditor'] as const) {
    const posten = await postenListe(db, art, bis, 100_000);
    eintraege.push({ pfad: `auswertung/offene-posten-${art}en.csv`, bytes: csv(POSTEN_SPALTEN, posten.map((p) => ({
      id: p.id, art: p.art, gegenpartei: p.gegenpartei, belegnummer: p.belegnummer, faellig_am: p.faelligAm,
      tage: p.tage, klasse: p.klasse, betrag: String(p.betragCent), bezahlt: String(p.bezahltCent),
      offen: String(p.offenCent), mahnstufe: p.mahnstufe,
    }))) });
  }
  const alter = await altersstruktur(db, bis);
  eintraege.push({ pfad: 'auswertung/altersstruktur.csv', bytes: csv(ALTER_SPALTEN, [
    ...KLASSEN.map((k) => ({ art: 'debitor', klasse: k, summe: String(alter.debitor[k]) })),
    { art: 'debitor', klasse: 'gesamt', summe: String(alter.debitor.gesamt) },
    ...KLASSEN.map((k) => ({ art: 'kreditor', klasse: k, summe: String(alter.kreditor[k]) })),
    { art: 'kreditor', klasse: 'gesamt', summe: String(alter.kreditor.gesamt) },
  ]) });

  /* Rechnungsausgangsbuch je Kreis — je Kalenderjahr; ein abweichendes Wirtschaftsjahr liest alle. */
  const kalender = wj.beginnMonat === 1 && wj.beginnTag === 1;
  const buch = await stimmeAb(db, { jahr: kalender ? jahr : null });
  eintraege.push({ pfad: 'auswertung/rechnungsausgangsbuch.csv', bytes: csv(AUSGANGSBUCH_SPALTEN, buch.kreise.map((k) => ({
    nummernkreis: k.nummernkreis, anzahl: k.anzahl, erste_nummer: k.ersteNummer, letzte_nummer: k.letzteNummer,
    summe_buch: String(k.summeBuchCent), summe_belege: String(k.summeBelegeCent),
    luecken: k.luecken.join(' '), ohne_kettenglied: k.ohneKettenglied,
  }))) });
  if (!buch.ok) hinweise.push('Das Rechnungsausgangsbuch weicht ab (Lücke, Summe oder Kettenglied) — siehe auswertung/rechnungsausgangsbuch.csv.');

  /* DATEV-Stapel des Jahres: die Liste immer, die Dateien mit Speicher. */
  const stapel = await db.abfrage<StapelRoh>(
    `select e.id::text as id, e.von::text as von, e.bis::text as bis, e.status::text as status, e.zeilen,
            e.summe_soll_cent::text as summe_soll_cent, e.summe_haben_cent::text as summe_haben_cent,
            e.datei_sha256, e.format_ungeprueft,
            to_char(e.uebergeben_am at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') as uebergeben_am,
            to_char(e.erstellt_am at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') as erstellt_am,
            e.dokument_id::text as dokument_id, d.bucket, d.objekt_schluessel
       from datev_export e
       left join dokument d on d.id = e.dokument_id and d.mandant_id = e.mandant_id
      where e.mandant_id = $1::uuid and e.von <= $3::date and e.bis >= $2::date
      order by e.von, e.bis, e.erstellt_am, e.id`, [mandantId, von, bis]);
  let datevDateien = 0;
  const stapelZeilen: Record<string, unknown>[] = [];
  for (const s of stapel) {
    let pfad: string | null = null;
    if (s.status !== 'verworfen' && s.dokument_id !== null && s.bucket !== null && s.objekt_schluessel !== null) {
      pfad = `datev/${exportDateiname(s.von, s.bis).replace(/\.csv$/u, '')}_${s.id.slice(0, 8)}.csv`;
      if (speicher.verbunden) {
        datevDateien += 1;
        if (optionen.nurManifest !== true) {
          const bytes = await speicher.hole(s.bucket as Bucket, s.objekt_schluessel);
          if (s.datei_sha256 !== null && sha256(bytes) !== s.datei_sha256) {
            throw new JahrespaketFehler(
              `Die EXTF-Datei des Exports ${s.id} hat nicht mehr ihren SHA-256 — das Paket wird nicht gepackt.`,
              'integritaet');
          }
          eintraege.push({ pfad, bytes });
        }
      } else {
        pfad = null;
      }
    }
    stapelZeilen.push({
      id: s.id, von: s.von, bis: s.bis, status: s.status, zeilen: s.zeilen,
      summe_soll: s.summe_soll_cent, summe_haben: s.summe_haben_cent, datei_sha256: s.datei_sha256,
      datei_im_paket: pfad, format_ungeprueft: s.format_ungeprueft ? 'ja' : 'nein',
      uebergeben_am: s.uebergeben_am, erstellt_am: s.erstellt_am,
    });
  }
  eintraege.push({ pfad: 'datev/stapel.csv', bytes: csv(STAPEL_SPALTEN, stapelZeilen) });
  const [ohneStapel] = await db.abfrage<{ n: number }>(
    `select count(*)::int as n from buchungssatz
      where mandant_id = $1::uuid and belegdatum between $2::date and $3::date and datev_export_id is null`,
    [mandantId, von, bis]);
  const zeilenOhneStapel = ohneStapel?.n ?? 0;
  if (zeilenOhneStapel > 0) {
    hinweise.push(`${String(zeilenOhneStapel)} Buchungszeile(n) des Jahres stehen in keinem DATEV-Stapel — `
      + 'ein Stapel entsteht unter Buchhaltung → DATEV, nicht nebenbei im Paket.');
  }
  if (!speicher.verbunden && stapel.some((s) => s.dokument_id !== null)) {
    hinweise.push('EXTF-Dateien der Stapel sind nicht enthalten: der Belegspeicher ist nicht verbunden; die Liste (datev/stapel.csv) nennt jede mit Hash.');
  }

  /* Pruefbuendel: Manifest immer, Belege mit Speicher und ohne Sperre. */
  const buendel = await erstellePruefbuendel(db, jahr);
  eintraege.push({ pfad: 'pruefbuendel/manifest.json', bytes: buendel.manifest });
  const belege = buendel.paket?.dateien.length ?? buendel.rechnungen.filter((r) => r.belegId !== null).length;
  let belegeImPaket = 0;
  if (buendel.sperre !== null) {
    hinweise.push(`Belege sind nicht enthalten: ${buendel.sperre.satz}`);
  } else if (!speicher.verbunden) {
    hinweise.push('Belege (PDF) sind nicht enthalten: der Belegspeicher ist nicht verbunden; das Manifest nennt jede Datei mit SHA-256.');
  } else if (buendel.paket !== null) {
    belegeImPaket = buendel.paket.dateien.length;
    if (optionen.nurManifest !== true) {
      for (const d of buendel.paket.dateien) {
        const bytes = await speicher.hole(d.bucket as Bucket, d.objektSchluessel);
        if (sha256(bytes) !== d.sha256) {
          throw new JahrespaketFehler(
            `Die Datei ${d.pfad} hat nicht mehr den SHA-256 ihres Belegs — das Paket wird nicht gepackt.`, 'integritaet');
        }
        eintraege.push({ pfad: `pruefbuendel/${d.pfad}`, bytes });
      }
    }
  }

  /* Verfahrensdokumentation — ohne Abrufzeit, damit das Paket reproduzierbar bleibt. */
  const vd = await erstelleVerfahrensdokumentation(db, doku);
  eintraege.push({ pfad: 'verfahrensdokumentation.md', bytes: new TextEncoder().encode(alsMarkdown(vd, { ohneAbrufzeit: true })) });
  eintraege.push({ pfad: 'verfahrensdokumentation.json', bytes: vd.kanonisch });

  if (lauf.unvollstaendig > 0) {
    hinweise.push(`${String(lauf.unvollstaendig)} Buchungszeile(n) des Jahres tragen keinen Beleg oder kein Konto; sie stehen im Journal (daten/buchungen.csv) mit leeren Feldern.`);
  }
  if (wj.istPlatzhalter) hinweise.push('Der Beginn des Wirtschaftsjahrs ist angenommen (Kalenderjahr, O-05).');

  const zahlen: JahrespaketZahlen = {
    tabellen: lauf.tabellen.length,
    tabellenZeilen: lauf.tabellen.reduce((s, t) => s + t.zeilen, 0),
    unvollstaendig: lauf.unvollstaendig,
    datevStapel: stapel.length, datevDateien, zeilenOhneStapel,
    belege, belegeImPaket,
  };

  const liesmich = [
    `Jahrespaket ${bezeichnung} — ${lauf.mandant.firma}${lauf.mandant.rechtsform === null ? '' : ` (${lauf.mandant.rechtsform})`}`,
    `Wirtschaftsjahr ${von} bis ${bis}${wj.istPlatzhalter ? ' (Beginn angenommen, O-05)' : ''}`,
    '',
    'INHALT',
    '  daten/*.csv                      die Tabellen der Datenträgerüberlassung (Journal, Rechnungen mit Positionen, Eingangsrechnungen,',
    '                                   Zahlungen, Zuordnungen, offene Posten, Belege, Kunden, Lieferanten, Konten, Steuersätze,',
    '                                   Nummernkreise, Perioden) — Windows-1252, ";", Dezimalkomma, erste Zeile Spaltennamen',
    '  auswertung/monatszahlen.csv      Erlöse, Aufwand, Ergebnis je Monat (BWA-artig — keine Betriebswirtschaftliche Auswertung)',
    '  auswertung/offene-posten-*.csv   Debitoren und Kreditoren zum Stichtag ' + bis + ', mit Altersklasse',
    '  auswertung/altersstruktur.csv    Summen je Altersklasse zum Stichtag',
    '  auswertung/rechnungsausgangsbuch.csv  je Nummernkreis: Anzahl, erste/letzte Nummer, Summen, Lücken',
    '  datev/stapel.csv                 die erzeugten DATEV-Stapel des Jahres mit Hash' + (datevDateien > 0 ? '; datev/*.csv die EXTF-Dateien' : ''),
    '  pruefbuendel/manifest.json       jede festgeschriebene Rechnung mit Beleg-Hash und Buchungszeilen, kanonisch' + (belegeImPaket > 0 ? '; pruefbuendel/belege/*.pdf die Belege' : ''),
    '  verfahrensdokumentation.md/.json die Verfahrensdokumentation aus der lebenden Konfiguration (ohne Abrufzeit)',
    '  pruefsummen.txt                  SHA-256 jeder Datei; prüfen mit: sha256sum -c pruefsummen.txt',
    '',
    'STAND',
    `  Tabellen: ${String(zahlen.tabellen)} mit ${String(zahlen.tabellenZeilen)} Zeilen · DATEV-Stapel: ${String(zahlen.datevStapel)} (Dateien im Paket: ${String(zahlen.datevDateien)})`,
    `  Belege laut Manifest: ${String(zahlen.belege)} (im Paket: ${String(zahlen.belegeImPaket)}) · Zeilen ohne Stapel: ${String(zahlen.zeilenOhneStapel)} · unvollständige Zeilen: ${String(zahlen.unvollstaendig)}`,
    '',
    'HINWEISE',
    ...(hinweise.length === 0 ? ['  keine'] : hinweise.map((h) => `  ${h}`)),
    `  ${HINWEIS_D06}`,
    '  Reproduzierbar: derselbe Stand ergibt denselben SHA-256; der Abruf steht im Protokoll der Plattform.',
    '',
  ].map((z) => `${z}\r\n`).join('');
  eintraege.push({ pfad: LIESMICH_NAME, bytes: new TextEncoder().encode(liesmich) });
  const pruefsummen = new TextEncoder().encode(
    [...eintraege].sort((a, b) => (a.pfad < b.pfad ? -1 : 1)).map((e) => `${sha256(e.bytes)}  ${e.pfad}\n`).join(''));
  eintraege.push({ pfad: PRUEFSUMMEN_NAME, bytes: pruefsummen });

  const zip = optionen.nurManifest === true ? null : schreibeZip(eintraege);
  return {
    mandantId, firma: lauf.mandant.firma, jahr, von, bis, bezeichnung, wirtschaftsjahr: wj,
    speicherVerbunden: speicher.verbunden, sperre: buendel.sperre, zahlen, hinweise,
    dateien: eintraege.map((e) => ({ pfad: e.pfad, sha256: sha256(e.bytes), groesseBytes: e.bytes.byteLength })),
    zip, zipSha256: zip === null ? null : sha256(zip),
  };
}
