import 'server-only';
import { createHash } from 'node:crypto';
import { kanonisiere } from '../finanz/kanonisch.js';
import { alsKanonischerWert } from '../freigabe/diff-json.js';
import { ALGORITHMUS, GENESIS } from '../finanz/hash-chain.js';
import { AUFTRAGSVERARBEITER } from '../../registry/auftragsverarbeiter.js';
import type { JobDefinition } from '../../jobs/registry.js';
import { liesAufbewahrung } from '../dokument/aufbewahrung.js';
import { RAHMEN_NAME, istKontenrahmen } from './kontenrahmen.js';
import { liesWirtschaftsjahr, type Wirtschaftsjahr } from './wirtschaftsjahr.js';

/**
 * Die Verfahrensdokumentation — erzeugt aus der lebenden Konfiguration
 * (ACC-10, LEG-01, GoBD Rz. 151–155, PR 66, D-485).
 *
 * **Warum erzeugt und nicht geschrieben.** Die GoBD verlangen eine
 * Dokumentation, aus der „Inhalt, Aufbau, Ablauf und Ergebnisse des
 * DV-Verfahrens vollstaendig und schluessig ersichtlich sind" — und die zu
 * jeder Fassung des Systems passt, die im Aufbewahrungszeitraum lief. Ein
 * von Hand gepflegtes Dokument veraltet mit der ersten Migration und sagt
 * dann etwas, das nicht mehr stimmt. Dieses hier liest, was gilt: die
 * Gesellschaft, den Schemastand, die Nummernkreise, die Kontenzuordnung, die
 * Aufbewahrungsregeln, die Rollen und ihre Rechte, die Jobs mit ihrem
 * Zeitplan, die Auftragsverarbeiter — und beschreibt die Verfahren, die
 * im Code festliegen, in Worten, mit Verweis auf die Stelle.
 *
 * **Vier Teile, wie die GoBD sie nennen:** allgemeine Beschreibung,
 * Anwenderdokumentation (die Verfahren), technische Systemdokumentation,
 * Betriebsdokumentation — und ein fuenfter mit dem, was offen ist. Jeder
 * Abschnitt traegt seine Quelle: `datenbank` (gelesen beim Abruf),
 * `auslieferung` (aus dem Code dieser Fassung) oder `verfahren` (die Regel,
 * die der Code durchsetzt). Was ein Platzhalter ist, steht als Platzhalter.
 *
 * **Reproduzierbar.** Die Struktur ist kanonisches JSON ohne Uhr und traegt
 * ihren SHA-256; zwei Abrufe bei unveraenderter Konfiguration ergeben
 * denselben Hash — und ein anderer Hash heisst: etwas hat sich geaendert.
 * Der Abrufzeitpunkt steht daneben, nicht darin.
 *
 * Die Dokumentation rechnet nichts und entscheidet nichts (D-06); sie zaehlt.
 */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  readonly aktiverMandantId: string;
}

export type Quelle = 'datenbank' | 'auslieferung' | 'verfahren';

export interface Tabelle {
  readonly kopf: readonly string[];
  readonly zeilen: readonly (readonly string[])[];
}

export interface Abschnitt {
  readonly nummer: string;
  readonly titel: string;
  readonly quelle: Quelle;
  readonly absaetze: readonly string[];
  readonly tabelle: Tabelle | null;
  /**
   * Zahlen beim Abruf (Bestand: wie viele Rechnungen, Zeilen, Eintraege) —
   * NICHT Teil des Hashs. Der Hash sagt „dieselbe Konfiguration, dieselben
   * Verfahren"; der Bestand aendert sich mit jeder Buchung und mit jedem
   * Abruf (der selbst protokolliert wird) und steht deshalb daneben.
   */
  readonly bestand?: readonly string[];
}

export interface Auslieferung {
  /** Git-Commit der laufenden Fassung, oder `null` lokal. */
  readonly commit: string | null;
  readonly region: string | null;
  readonly umgebung: string | null;
}

export interface Verfahrensdokumentation {
  readonly mandantId: string;
  readonly firma: string;
  readonly auslieferung: Auslieferung;
  readonly schemastand: { readonly migration: string; readonly angewendetAm: string } | null;
  readonly migrationen: number;
  readonly wirtschaftsjahr: Wirtschaftsjahr;
  readonly abschnitte: readonly Abschnitt[];
  readonly offen: readonly string[];
  /** Kanonisches JSON der Abschnitte — ohne Uhr. */
  readonly kanonisch: Uint8Array;
  readonly sha256: string;
  /** Der Abrufzeitpunkt, Europe/Berlin — steht NEBEN dem Hash, nicht darin. */
  readonly abgerufenAm: string;
}

export const QUELLE_LABEL: Readonly<Record<Quelle, string>> = {
  datenbank: 'aus der Datenbank beim Abruf',
  auslieferung: 'aus der ausgelieferten Fassung',
  verfahren: 'Regel, die der Code durchsetzt',
};

/** Die Module, deren Rechte fuer die Buchfuehrung zaehlen. */
export const FINANZ_MODULE: readonly string[] = [
  'buchhaltung', 'buchhaltung_konfiguration', 'finanzen', 'eingang', 'zahlung',
  'dokument', 'nummernkreis', 'mahnung', 'freigabe',
];

export function auslieferungAusUmgebung(): Auslieferung {
  return {
    commit: process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['CSE_CODE_VERSION'] ?? null,
    region: process.env['VERCEL_REGION'] ?? null,
    umgebung: process.env['VERCEL_ENV'] ?? null,
  };
}

interface MandantRoh {
  readonly firma: string;
  readonly name: string;
  readonly slug: string;
  readonly rechtsform: string | null;
  readonly ist_rechtseinheit: boolean | null;
  readonly eigener_nummernkreis: boolean;
  readonly module: readonly string[];
  readonly handelsregister_gericht: string | null;
  readonly handelsregister_nummer: string | null;
  readonly ust_id: string | null;
  readonly steuernummer: string | null;
  readonly finanzamt: string | null;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly geschaeftsfuehrer: readonly string[];
}

interface Zaehlung { readonly schluessel: string; readonly n: number }

const oder = (wert: string | null | undefined, sonst = '—'): string =>
  wert === null || wert === undefined || wert === '' ? sonst : wert;
const jaNein = (wert: boolean | null): string => (wert === true ? 'ja' : wert === false ? 'nein' : '—');

export async function erstelleVerfahrensdokumentation(
  db: Abfrage, eingabe: { readonly jobs: readonly JobDefinition[]; readonly auslieferung: Auslieferung },
): Promise<Verfahrensdokumentation> {
  const mandantId = db.aktiverMandantId;
  const [m] = await db.abfrage<MandantRoh>(
    `select firma, name, slug, rechtsform, ist_rechtseinheit, eigener_nummernkreis, module,
            handelsregister_gericht, handelsregister_nummer, ust_id, steuernummer, finanzamt,
            strasse, plz, ort, geschaeftsfuehrer
       from mandant where id = $1::uuid`, [mandantId]);
  if (m === undefined) throw new Error('Die Gesellschaft ist nicht lesbar.');

  const migrationen = await db.abfrage<{ name: string; am: string }>(
    `select name, to_char(angewendet_am at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI:SS') as am
       from app.migrationsstand() order by name`);
  const letzte = migrationen.at(-1);
  const schemastand = letzte === undefined ? null : { migration: letzte.name, angewendetAm: letzte.am };

  const wj = await liesWirtschaftsjahr(db);
  const [konfig] = await db.abfrage<{
    kontenrahmen: string | null; sachkontenlaenge: number | null; versteuerungsart: string | null;
    ist_platzhalter: boolean; verbunden: boolean; festschreibung_standard: boolean;
  }>(`select kontenrahmen::text as kontenrahmen, sachkontenlaenge, versteuerungsart::text as versteuerungsart,
             ist_platzhalter, verbunden, festschreibung_standard
        from datev_konfiguration where mandant_id = $1::uuid`, [mandantId]);

  const nummernkreise = await db.abfrage<{
    kreis_typ: string; bezeichnung: string; format_maske: string; lueckenlos: boolean;
    naechste: string; geoeffnet: string; geschlossen: string | null; ist_platzhalter: boolean;
  }>(`select kreis_typ::text as kreis_typ, bezeichnung, format_maske, lueckenlos,
             naechste_nummer::text as naechste, geoeffnet_am::text as geoeffnet,
             geschlossen_am::text as geschlossen, ist_platzhalter
        from nummernkreis where mandant_id = $1::uuid
       order by kreis_typ, jahr, geoeffnet_am, id`, [mandantId]);

  const zuordnungen = await db.abfrage<Zaehlung>(
    `select schluessel_typ::text as schluessel, count(*)::int as n from konto_mapping
      where mandant_id = $1::uuid and (gueltig_bis is null or gueltig_bis >= app.berlin_heute())
      group by 1 order by 1`, [mandantId]);
  const [zuordnungPlatzhalter] = await db.abfrage<{ n: number }>(
    `select count(*)::int as n from konto_mapping where mandant_id = $1::uuid and ist_platzhalter`, [mandantId]);

  const rechnungen = await db.abfrage<Zaehlung>(
    `select status::text as schluessel, count(*)::int as n from rechnung where mandant_id = $1::uuid
      group by 1 order by 1`, [mandantId]);
  const eingang = await db.abfrage<Zaehlung>(
    `select status::text as schluessel, count(*)::int as n from eingangsrechnung where mandant_id = $1::uuid
      group by 1 order by 1`, [mandantId]);
  const [buchung] = await db.abfrage<{ gesamt: number; fest: number; ohne_konto: number; ohne_beleg: number }>(
    `select count(*)::int as gesamt, count(*) filter (where festgeschrieben)::int as fest,
            count(*) filter (where konto is null)::int as ohne_konto,
            count(*) filter (where beleg_id is null)::int as ohne_beleg
       from buchungssatz where mandant_id = $1::uuid`, [mandantId]);
  const perioden = await db.abfrage<Zaehlung>(
    `select status::text as schluessel, count(*)::int as n from periode where mandant_id = $1::uuid
      group by 1 order by 1`, [mandantId]);
  const [dokumente] = await db.abfrage<{ gesamt: number; gesperrt: number; geloescht: number; archiv: number }>(
    `select count(*)::int as gesamt, count(*) filter (where loeschsperre)::int as gesperrt,
            count(*) filter (where geloescht_am is not null)::int as geloescht,
            count(*) filter (where bucket = 'archiv')::int as archiv
       from dokument where mandant_id = $1::uuid`, [mandantId]);
  const [kette] = await db.abfrage<{ glieder: number; kreise: number }>(
    `select count(*)::int as glieder, count(distinct nummernkreis_id)::int as kreise
       from rechnung_hash where mandant_id = $1::uuid`, [mandantId]);
  const aufbewahrung = await liesAufbewahrung(db);

  const rollen = await db.abfrage<{
    schluessel: string; bezeichnung: string; portal: string; zwei_faktor: boolean; eigene: boolean;
    mitglieder: number; rechte: number; finanzrechte: string | null;
  }>(`select r.schluessel, r.bezeichnung, r.portal, r.erfordert_2fa as zwei_faktor,
             (r.mandant_id is not null) as eigene,
             (select count(*) from benutzer_mandant bm
               where bm.rolle_id = r.id and bm.mandant_id = $1::uuid and bm.entzogen_am is null
                 and (bm.gueltig_bis is null or bm.gueltig_bis >= app.berlin_heute()))::int as mitglieder,
             (select count(*) from rolle_berechtigung rb
               where rb.rolle_id = r.id and rb.gewaehrt
                 and (rb.mandant_id is null or rb.mandant_id = $1::uuid))::int as rechte,
             (select string_agg(b.schluessel, ', ' order by b.schluessel)
                from rolle_berechtigung rb join berechtigung b on b.id = rb.berechtigung_id
               where rb.rolle_id = r.id and rb.gewaehrt
                 and (rb.mandant_id is null or rb.mandant_id = $1::uuid)
                 and b.modul = any($2::text[])) as finanzrechte
        from rolle r
       where r.archiviert_am is null and (r.mandant_id is null or r.mandant_id = $1::uuid)
       order by (r.mandant_id is not null), r.portal, r.schluessel`, [mandantId, FINANZ_MODULE]);

  const [protokoll] = await db.abfrage<{ n: number; erster: string | null; letzter: string | null }>(
    `select count(*)::int as n,
            to_char(min(erstellt_am) at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') as erster,
            to_char(max(erstellt_am) at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') as letzter
       from audit_log where mandant_id = $1::uuid`, [mandantId]);
  const [zeit] = await db.abfrage<{ jetzt: string }>(
    `select to_char(now() at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as jetzt`);

  const kontenrahmen = konfig?.kontenrahmen !== null && konfig?.kontenrahmen !== undefined
    && istKontenrahmen(konfig.kontenrahmen) ? RAHMEN_NAME[konfig.kontenrahmen] : 'nicht festgelegt';
  const offen: string[] = [];
  if (wj.istPlatzhalter) offen.push('Der Beginn des Wirtschaftsjahrs ist angenommen (Kalenderjahr) — O-05.');
  if (konfig === undefined || konfig.ist_platzhalter) {
    offen.push('Kontenrahmen, Sachkontenlänge und Versteuerungsart sind Platzhalter, bis der Steuerberater sie bestätigt — O-05.');
  }
  if ((zuordnungPlatzhalter?.n ?? 0) > 0) {
    offen.push(`${String(zuordnungPlatzhalter?.n ?? 0)} Kontenzuordnung(en) sind Platzhalter — O-05.`);
  }
  if (nummernkreise.some((n) => n.ist_platzhalter)) {
    offen.push('Mindestens ein Nummernkreis ist ein Platzhalter (Maske oder Rücksetzung noch nicht bestätigt).');
  }
  if (AUFTRAGSVERARBEITER.some((a) => a.vertragAm === null)) {
    offen.push('Für mindestens einen Auftragsverarbeiter ist kein Vertragsdatum hinterlegt (Art. 28 DSGVO) — die Geschäftsführung trägt es ein.');
  }
  offen.push('Ein geprüfter Wiederherstellungstest der Datensicherung steht aus (ROADMAP Phase 10).');
  offen.push('Unveränderlichkeit des Objektspeichers auf Bucket-Ebene beim Anbieter — O-364.');
  offen.push('Die DTD des Beschreibungsstandards liegt dem Z3-Paket nicht bei — O-365.');
  if (schemastand === null) {
    offen.push('Diese Datenbank führt kein Migrationsjournal (die Migrationen wurden direkt eingespielt); der Schemastand ist hier nicht ablesbar.');
  }

  const abschnitte: Abschnitt[] = [
    {
      nummer: '1.1', titel: 'Gesellschaft und Geltungsbereich', quelle: 'datenbank',
      absaetze: [
        `Diese Verfahrensdokumentation beschreibt die Buchführung der ${m.firma}${m.rechtsform === null ? '' : ` (${m.rechtsform})`} `
        + `auf der CSE-Plattform, Bereich „${m.name}“ (Kennung ${m.slug}). `
        + `${m.ist_rechtseinheit === true ? 'Die Gesellschaft ist eine eigene Rechtseinheit' : 'Der Bereich ist keine eigene Rechtseinheit'}`
        + `${m.eigener_nummernkreis ? ' mit eigenem Rechnungskreis.' : '; Rechnungen laufen über den Kreis einer Rechtseinheit.'}`,
        `Handelsregister: ${oder([m.handelsregister_gericht, m.handelsregister_nummer].filter((x) => x !== null).join(' '))}. `
        + `USt-IdNr.: ${oder(m.ust_id)}. Steuernummer: ${oder(m.steuernummer)}. Finanzamt: ${oder(m.finanzamt)}. `
        + `Anschrift: ${oder([m.strasse, [m.plz, m.ort].filter((x) => x !== null).join(' ')].filter((x) => x !== null && x !== '').join(', '))}. `
        + `Geschäftsführung: ${m.geschaeftsfuehrer.length === 0 ? '—' : m.geschaeftsfuehrer.join(', ')}.`,
        `Freigeschaltete Module: ${m.module.length === 0 ? '—' : m.module.join(', ')}.`,
      ],
      tabelle: null,
    },
    {
      nummer: '1.2', titel: 'System und Fassung', quelle: 'auslieferung',
      absaetze: [
        'Die CSE-Plattform ist eine Webanwendung (Next.js, TypeScript) mit einer PostgreSQL-Datenbank (Supabase, Region Frankfurt), '
        + 'privatem Objektspeicher für Dokumente und Ausführung der Serverfunktionen in einer EU-Region (Vercel). '
        + 'Das Schema wird ausschließlich über nummerierte Migrationen im Quellcode verändert; jede Auslieferung wendet '
        + 'die noch fehlenden in fester Reihenfolge an und vermerkt sie im Journal der Datenbank.',
        `Laufende Fassung: Commit ${oder(eingabe.auslieferung.commit, 'nicht bekannt (lokal)')}, `
        + `Umgebung ${oder(eingabe.auslieferung.umgebung, 'lokal')}, Region ${oder(eingabe.auslieferung.region, 'lokal')}.`,
        schemastand === null
          ? 'Schemastand: in dieser Datenbank wird kein Migrationsjournal geführt; der Stand ist hier nicht ablesbar (siehe Offene Punkte).'
          : `Schemastand: ${String(migrationen.length)} Migrationen angewendet, zuletzt ${schemastand.migration} am ${schemastand.angewendetAm} (Europe/Berlin).`,
      ],
      tabelle: null,
    },
    {
      nummer: '1.3', titel: 'Auftragsverarbeiter (Art. 28, Art. 30 DSGVO)', quelle: 'auslieferung',
      absaetze: [
        'Dienste, die im Auftrag Daten verarbeiten, mit Zweck, Datenarten und Region. Ein Vertragsdatum steht nur, '
        + 'wenn die Geschäftsführung es eingetragen hat; ein fehlendes ist ein offener Punkt, kein Versehen der Darstellung.',
      ],
      tabelle: {
        kopf: ['Dienst', 'Zweck', 'Daten', 'Region', 'Vertrag vom'],
        zeilen: AUFTRAGSVERARBEITER.map((a) => [a.dienst, a.zweck, a.daten, a.region, a.vertragAm ?? 'nicht hinterlegt']),
      },
    },
    {
      nummer: '2.1', titel: 'Ausgangsrechnungen und Nummernvergabe', quelle: 'verfahren',
      absaetze: [
        'Eine Rechnung entsteht als Entwurf ohne Nummer. Beim Festschreiben wird der Nummernkreis in derselben '
        + 'Transaktion gesperrt (SELECT … FOR UPDATE auf der Zählerzeile), die nächste Nummer vergeben und der Zähler '
        + 'erhöht — deshalb sind Lücken unmöglich und Doppelvergaben ausgeschlossen. Der Übergang Entwurf → '
        + 'festgeschrieben ist einseitig; eine festgeschriebene Rechnung wird nie geändert, sondern durch eine '
        + 'Stornorechnung mit eigener Nummer aufgehoben. Ein Entwurf kann verworfen werden und verbraucht dann keine Nummer.',
        `Jede festgeschriebene Rechnung erhält ein Glied der Hash-Kette: SHA-256 über die kanonische Nutzlast und den `
        + `Hash des Vorgängers im selben Nummernkreis (Verfahren ${ALGORITHMUS}; das erste Glied verweist auf `
        + `${GENESIS.slice(0, 8)}…). Ein Prüfjob rechnet die Kette regelmäßig nach (Abschnitt 3.3).`,
        'Nummernkreise dieser Gesellschaft (beim Abruf gelesen):',
      ],
      tabelle: {
        kopf: ['Kreis', 'Bezeichnung', 'Maske', 'Lückenlos', 'Geöffnet', 'Geschlossen', 'Platzhalter'],
        zeilen: nummernkreise.map((n) => [n.kreis_typ, n.bezeichnung, n.format_maske, jaNein(n.lueckenlos),
          n.geoeffnet, oder(n.geschlossen), jaNein(n.ist_platzhalter)]),
      },
      bestand: [
        `Kettenglieder: ${String(kette?.glieder ?? 0)} in ${String(kette?.kreise ?? 0)} Kreis(en).`,
        `Rechnungen nach Status: ${rechnungen.length === 0 ? 'keine' : rechnungen.map((r) => `${r.schluessel} ${String(r.n)}`).join(', ')}.`,
        ...nummernkreise.map((n) => `Nummernkreis „${n.bezeichnung}“ (${n.kreis_typ}): nächste Nummer ${n.naechste}.`),
      ],
    },
    {
      nummer: '2.2', titel: 'Eingangsrechnungen', quelle: 'verfahren',
      absaetze: [
        'Eine Eingangsrechnung wird mit ihrem Dokument abgelegt (ohne Dokument gibt es keine Eingangsrechnung). '
        + 'Elektronische Rechnungen (UBL, CII, ZUGFeRD-Anhang) werden gelesen und zu einem Vorschlag mit Quelle je '
        + 'Feld; gescannte Belege ohne eingebettete Daten werden nicht gelesen, sondern von Hand erfasst — eine '
        + 'Texterkennung ist nicht angebunden. Jeder Vorschlag wird von einem Menschen freigegeben oder abgelehnt; '
        + 'erst die Freigabe übernimmt die Werte in die Rechnung, in derselben Transaktion. Die Bankverbindung des '
        + 'Lieferanten wird beim Vorschlag gegen den Stamm geprüft, ohne dass die Anwendungsrolle sie lesen kann.',
        '§ 13b UStG (Steuerschuld des Empfängers) und § 48 EStG (Bauabzugsteuer) sind Angaben am Beleg mit '
        + 'Stichtag Leistungsdatum; die Plattform bewertet, ob eine Freistellungsbescheinigung am Stichtag galt, '
        + 'und rechnet nichts, was der Steuerberater rechnet.',
      ],
      tabelle: null,
      bestand: [
        `Eingangsrechnungen nach Status: ${eingang.length === 0 ? 'keine' : eingang.map((r) => `${r.schluessel} ${String(r.n)}`).join(', ')}.`,
      ],
    },
    {
      nummer: '2.3', titel: 'Buchung, Kontierung, Festschreibung, Periodenschloss', quelle: 'verfahren',
      absaetze: [
        'Buchungssätze entstehen automatisch aus festgeschriebenen Rechnungen, freigegebenen Eingangsrechnungen und '
        + 'Zahlungen; jede Zeile trägt ihre Herkunft und den Beleg, aus dem sie stammt. Konten werden über die '
        + 'Kontenzuordnung der Gesellschaft ermittelt (Erlös-, Steuer-, Debitoren-, Kreditoren-, Bank- und Kassenkonten); '
        + 'ist keine Zuordnung hinterlegt, bleibt die Zeile ohne Konto stehen und der Export ist gesperrt, bis ein '
        + 'Mensch sie kontiert. Beträge sind ganze Cent; Umsatzsteuer wird je Steuersatzgruppe gerechnet, nie aus einer Bruttosumme.',
        'Festgeschriebene Zeilen sind unveränderlich; Korrekturen erfolgen durch Gegenbuchung. Das Periodenschloss '
        + 'kennt drei Zustände: offen, vorläufig geschlossen (nur wer festschreiben darf, bucht noch hinein), '
        + 'geschlossen (endgültig, keine Buchung, kein Wiederöffnen). Ein laufender Monat wird nicht endgültig '
        + 'geschlossen. Beim endgültigen Schluss werden die Monatszahlen eingefroren.',
        `Kontenrahmen: ${kontenrahmen}${konfig?.sachkontenlaenge === null || konfig?.sachkontenlaenge === undefined ? '' : `, Sachkontenlänge ${String(konfig.sachkontenlaenge)}`}`
        + `${konfig?.versteuerungsart === null || konfig?.versteuerungsart === undefined ? '' : `, Versteuerungsart ${konfig.versteuerungsart}`}`
        + `${konfig === undefined || konfig.ist_platzhalter ? ' — Platzhalter (O-05)' : ''}. `
        + `Wirtschaftsjahr beginnt am ${String(wj.beginnTag)}.${String(wj.beginnMonat)}.${wj.istPlatzhalter ? ' (angenommen, O-05)' : ''}.`,
        `Gültige Kontenzuordnungen: ${zuordnungen.length === 0 ? 'keine' : zuordnungen.map((z) => `${z.schluessel} ${String(z.n)}`).join(', ')}`
        + `; davon Platzhalter: ${String(zuordnungPlatzhalter?.n ?? 0)}.`,
      ],
      tabelle: null,
      bestand: [
        `Buchungszeilen: ${String(buchung?.gesamt ?? 0)}, davon festgeschrieben ${String(buchung?.fest ?? 0)}, `
        + `ohne Konto ${String(buchung?.ohne_konto ?? 0)}, ohne Beleg ${String(buchung?.ohne_beleg ?? 0)}.`,
        `Perioden nach Status: ${perioden.length === 0 ? 'keine' : perioden.map((p) => `${p.schluessel} ${String(p.n)}`).join(', ')}.`,
      ],
    },
    {
      nummer: '2.4', titel: 'Zahlungen, Bank, offene Posten', quelle: 'verfahren',
      absaetze: [
        'Zahlungen werden erfasst oder aus Kontoauszügen (CAMT.053) eingelesen; die Datei wird mit ihrem SHA-256 '
        + 'archiviert. Umsätze werden nach Betrag, Rechnungsnummer und IBAN zugeordnet; was nicht eindeutig ist, '
        + 'wartet in der Klärungsliste auf einen Menschen. Jede Zuordnung zu einem offenen Posten steht als eigene, '
        + 'stornierbare Zeile; offene Posten führen Betrag, Ausgleich und Rest als erzeugte Spalte und werden gegen '
        + 'die Quellen abgestimmt (Debitoren gegen festgeschriebene Rechnungen, Kreditoren gegen gebuchte Eingangsrechnungen).',
        'Das Mahnwesen eskaliert in Stufen nach den Einstellungen der Gesellschaft; eine Mahnung verlässt das Haus '
        + 'erst nach menschlicher Freigabe.',
      ],
      tabelle: null,
    },
    {
      nummer: '2.5', titel: 'Archiv und Aufbewahrung', quelle: 'datenbank',
      absaetze: [
        'Jedes Dokument liegt in einem privaten Speicher und wird nur über signierte, kurzlebige Adressen '
        + 'ausgeliefert. Belege tragen den SHA-256 ihrer Datei; das Prüfbündel eines Jahrgangs vergleicht jede Datei '
        + 'damit. Die Aufbewahrungsfrist beginnt mit dem Schluss des Kalenderjahrs, in dem das Dokument entstand '
        + '(§ 147 Abs. 4 AO), gespeichert als eigener Entstehungstag; sie wird nie verkürzt. Ein Dokument mit '
        + 'Löschsperre kann weder aus der Anwendung noch mit der Anwendungsrolle in der Datenbank gelöscht werden; '
        + 'der einzige Löschweg im Code weist es ab, und ein Auslöser in der Datenbank hält es auch dann, wenn jemand '
        + 'diesen Weg umgeht.',
        'Aufbewahrungsregeln (Regel der Gesellschaft, sonst die Vorgabe der Plattform; gesetzliche Untergrenzen werden nie unterschritten):',
      ],
      tabelle: {
        kopf: ['Kategorie', 'Jahre', 'Löschsperre', 'Grundlage', 'Quelle', 'Platzhalter'],
        zeilen: aufbewahrung.map((a) => [a.kategorie, a.jahre === null ? '—' : String(a.jahre), jaNein(a.loeschsperre),
          a.grundlage, a.quelle, jaNein(a.istPlatzhalter)]),
      },
      bestand: [
        `Dokumente dieser Gesellschaft: ${String(dokumente?.gesamt ?? 0)}, davon im Archiv ${String(dokumente?.archiv ?? 0)}, `
        + `mit Löschsperre ${String(dokumente?.gesperrt ?? 0)}, als gelöscht markiert ${String(dokumente?.geloescht ?? 0)}.`,
      ],
    },
    {
      nummer: '2.6', titel: 'Export und Überlassung', quelle: 'verfahren',
      absaetze: [
        'DATEV: Buchungsstapel im EXTF-Format als Datei (Windows-1252, Dezimalkomma, Festschreibungskennzeichen), '
        + 'mit Beleg je Zeile; es gibt keine direkte Verbindung zu DATEV, und die Plattform behauptet keine. '
        + `Verbindung laut Konfiguration: ${konfig?.verbunden === true ? 'verbunden' : 'nicht verbunden'}. `
        + 'Das Format ist aus der Spezifikation abgeleitet, bis ein Muster des Steuerberaters vorliegt (O-05).',
        'Prüfbündel je Wirtschaftsjahr: Manifest mit jeder Rechnung, ihrem PDF und ihren Buchungszeilen, gegen das '
        + 'Rechnungsausgangsbuch gehalten, reproduzierbar (kanonisches JSON, ZIP ohne Uhr).',
        'Z3-Datenträgerüberlassung (§ 147 Abs. 6 AO): Journal, Rechnungen mit Positionen, Eingangsrechnungen, '
        + 'Zahlungen, offene Posten, Belege und Stammdaten als CSV mit Strukturbeschreibung nach dem '
        + 'Beschreibungsstandard und Prüfsummen. Jeder Abruf eines Exports steht im Protokoll.',
      ],
      tabelle: null,
    },
    {
      nummer: '3.1', titel: 'Datenhaltung und Mandantentrennung', quelle: 'verfahren',
      absaetze: [
        'Jede Tabelle einer Gesellschaft trägt die Spalte mandant_id; Row-Level Security ist erzwungen (FORCE) und '
        + 'gilt auch für den Eigentümer der Tabelle. Der aktive Mandant liegt in der Serversitzung, nie in einer '
        + 'Adresse oder im Browser. Drei Datenbankrollen: die Anwendungsrolle (cse_app) liest und schreibt unter den '
        + 'Policies, mit spaltenweise entzogenen Rechten auf Bankverbindungen und Kreditoren-/Debitorennummern; die '
        + 'Jobrolle (cse_job) hat nur die Rechte der Hintergrundläufe; die Definer-Rolle (cse_definer) besitzt die '
        + 'wenigen Funktionen, die kontrolliert über die Mandantengrenze lesen, jede protokolliert.',
        'Geldbeträge sind ganze Cent (bigint); Zeitpunkte sind timestamptz in UTC und werden in Europe/Berlin '
        + 'angezeigt; Dauern sind Differenzen von Zeitpunkten. Die Serveruhr ist maßgeblich; eine Geräteuhr wird '
        + 'daneben mit ihrer Abweichung gespeichert.',
      ],
      tabelle: null,
    },
    {
      nummer: '3.2', titel: 'Unveränderlichkeit und Protokoll', quelle: 'verfahren',
      absaetze: [
        'In Finanzen, Zeiterfassung und Protokoll gibt es kein physisches Löschen; Auslöser weisen DELETE ab, und '
        + 'Zeilen werden mit Zeitpunkt als storniert, verworfen oder gelöscht markiert. Festgeschriebene Rechnungen und '
        + 'Buchungszeilen sind unveränderlich. Das Protokoll (audit_log) ist anfügend: jede Handlung mit Akteur '
        + '(Mensch, Agent, System), Objekt, Vorher/Nachher, Zeitpunkt und Sitzung.',
        'Das Protokoll ist lesbar unter Einstellungen → Protokoll; ein Beweisbündel zum Export ist vorgesehen (SEC-A9) '
        + 'und noch nicht gebaut. Auch jeder Abruf dieser Dokumentation und jedes Exports steht darin.',
      ],
      tabelle: null,
      bestand: [
        `Protokoll dieser Gesellschaft: ${String(protokoll?.n ?? 0)} Einträge`
        + `${protokoll?.erster === null || protokoll?.erster === undefined ? '' : `, ${protokoll.erster} bis ${oder(protokoll.letzter)}`} (Europe/Berlin).`,
      ],
    },
    {
      nummer: '3.3', titel: 'Automatische Abläufe (Jobs)', quelle: 'auslieferung',
      absaetze: [
        'Hintergrundläufe sind im Code registriert, jeder mit Zeitplan (5-Feld-Cron, UTC), erklärtem Mandantenbezug '
        + 'und begrenzter Wiederholung; ein Job ohne erklärten Bezug lässt sich nicht registrieren. Jeder Lauf wird '
        + 'mit Ergebnis protokolliert. Kein Job rechnet Steuern oder Löhne.',
      ],
      tabelle: {
        kopf: ['Schlüssel', 'Bezeichnung', 'Zeitplan (UTC)', 'Bereich', 'Versuche'],
        zeilen: [...eingabe.jobs].sort((a, b) => (a.schluessel < b.schluessel ? -1 : 1))
          .map((j) => [j.schluessel, j.bezeichnung, j.zeitplan, j.bereich, String(j.versuche)]),
      },
    },
    {
      nummer: '3.4', titel: 'Änderungsverwaltung und Prüfung', quelle: 'verfahren',
      absaetze: [
        'Jede Änderung am System ist ein Commit im Repository mit Prüfung vor dem Zusammenführen: Typprüfung, Lint '
        + 'und Merge-Wachen (unter anderem: kein Gleitkomma bei Geld, kein zweiter Löschweg, jede API-Route im '
        + 'Rechtemanifest), Kerntests ohne Datenbank, Isolationstests gegen eine echte Datenbank (Mandantentrennung, '
        + 'Rollen, Unveränderlichkeit) und Browsertests. Schemaänderungen sind nummerierte Migrationen; eine '
        + 'angewendete Migration wird nie geändert, sondern durch eine neue ergänzt.',
        `Migrationen in dieser Datenbank laut Journal: ${schemastand === null ? 'nicht ablesbar' : String(migrationen.length)}.`,
      ],
      tabelle: null,
    },
    {
      nummer: '4.1', titel: 'Rollen und Zugriffsrechte', quelle: 'datenbank',
      absaetze: [
        'Rechte sind Schlüssel aus einem festen Katalog (Modul.Objekt.Aktion) und an Rollen gebunden; jede Seite '
        + 'und jede API-Route nennt das Recht, das sie öffnet, in einem Manifest, das ein Test gegen das Dateisystem '
        + 'hält. Ein unbekannter Schlüssel öffnet nichts. Rollen mit Zugriff auf Finanzdaten verlangen einen zweiten '
        + 'Faktor bei der Anmeldung. Mitgliedschaften sind je Gesellschaft und datiert; ein Entzug wird protokolliert.',
        'Rollen des internen Portals mit aktiven Mitgliedern in dieser Gesellschaft, Zahl der Rechte und den Rechten '
        + `aus den Modulen ${FINANZ_MODULE.join(', ')}:`,
      ],
      tabelle: {
        kopf: ['Rolle', 'Bezeichnung', 'Portal', '2. Faktor', 'Eigene Rolle', 'Mitglieder', 'Rechte', 'Finanzrelevante Rechte'],
        zeilen: rollen.map((r) => [r.schluessel, r.bezeichnung, r.portal, jaNein(r.zwei_faktor), jaNein(r.eigene),
          String(r.mitglieder), String(r.rechte), oder(r.finanzrechte, 'keine')]),
      },
    },
    {
      nummer: '4.2', titel: 'Internes Kontrollsystem', quelle: 'verfahren',
      absaetze: [
        'Nichts verlässt das System ohne menschliche Freigabe: Angebote, Rechnungen an öffentliche Auftraggeber, '
        + 'Mahnungen, E-Mails und Eingangsrechnungen laufen durch die Freigabe mit Vier-Augen-Prinzip; ein Vorschlag '
        + 'eines Agenten wird als solcher gekennzeichnet und entschieden, nie ausgeführt. Der Agent liest, ordnet zu '
        + 'und entwirft; jeder Betrag, jede Menge und jede Frist wird von einer geprüften Funktion gerechnet.',
        'Sperren: kein DATEV-Export und kein Prüfbündel, solange eine Buchungszeile des Zeitraums ohne Beleg oder '
        + 'Konto ist; keine Buchung in einen geschlossenen Monat; keine Rechnung ohne Nummer aus dem gesperrten Zähler. '
        + 'Prüfläufe: die Hash-Kette wird nachgerechnet, die offenen Posten werden gegen die Quellen abgestimmt, das '
        + 'Belegarchiv wird nachgeholt, wo ein PDF fehlt. Abweichungen erscheinen als Zahl auf dem Bildschirm, nicht '
        + 'als geglättetes Häkchen.',
      ],
      tabelle: null,
    },
    {
      nummer: '4.3', titel: 'Datensicherung und Betrieb', quelle: 'verfahren',
      absaetze: [
        'Datenbank und Objektspeicher werden vom Anbieter (Supabase, Frankfurt) gesichert; Zugang zur Datenbank '
        + 'hat nur die Serverumgebung, der Dienstschlüssel des Speichers liegt nur dort. Was der Anbieter auf '
        + 'Bucket-Ebene garantiert (Versionierung, Unveränderlichkeit), ist Teil der Vereinbarung mit ihm und wird '
        + 'hier nicht behauptet (O-364). Ein geprüfter Wiederherstellungstest ist eingeplant und noch nicht erbracht.',
        'Der Betrieb kennt kein Löschen von Finanzdaten durch Administration; ein Rückbau erfolgt, wenn überhaupt, '
        + 'über eine neue Migration mit Prüfung und Protokoll.',
      ],
      tabelle: null,
    },
    {
      nummer: '5', titel: 'Offene Punkte und Platzhalter', quelle: 'datenbank',
      absaetze: [
        'Was diese Dokumentation nicht als entschieden ausgibt — jeder Punkt trägt seine Nummer im Entscheidungsregister:',
        ...offen.map((o) => `• ${o}`),
      ],
      tabelle: null,
    },
  ];

  const struktur = {
    art: 'cse-verfahrensdokumentation', version: 1, mandantId, firma: m.firma,
    auslieferung: eingabe.auslieferung,
    schemastand, migrationen: migrationen.length,
    wirtschaftsjahr: { beginnMonat: wj.beginnMonat, beginnTag: wj.beginnTag, istPlatzhalter: wj.istPlatzhalter },
    abschnitte: abschnitte.map((a) => ({
      nummer: a.nummer, titel: a.titel, quelle: a.quelle, absaetze: [...a.absaetze],
      tabelle: a.tabelle === null ? null : { kopf: [...a.tabelle.kopf], zeilen: a.tabelle.zeilen.map((z) => [...z]) },
    })),
    offen,
  };
  const kanonisch = kanonisiere(alsKanonischerWert(struktur));
  return {
    mandantId, firma: m.firma, auslieferung: eingabe.auslieferung, schemastand,
    migrationen: migrationen.length, wirtschaftsjahr: wj, abschnitte, offen, kanonisch,
    sha256: createHash('sha256').update(kanonisch).digest('hex'),
    abgerufenAm: zeit?.jetzt ?? '',
  };
}

export const TEILE: readonly { readonly praefix: string; readonly titel: string }[] = [
  { praefix: '1', titel: 'Allgemeine Beschreibung' },
  { praefix: '2', titel: 'Anwenderdokumentation — die Verfahren' },
  { praefix: '3', titel: 'Technische Systemdokumentation' },
  { praefix: '4', titel: 'Betriebsdokumentation' },
  { praefix: '5', titel: 'Offene Punkte' },
];

function markdownZelle(text: string): string {
  return text.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

/**
 * Die Dokumentation als Markdown — mit Kopf, Teilen, Abschnitten und Tabellen.
 *
 * `ohneAbrufzeit`: fuer ein reproduzierbares Paket (Jahrespaket, ACC-11) —
 * dann steht kein Zeitpunkt im Text, und derselbe Stand ergibt dieselben Bytes.
 */
export function alsMarkdown(d: Verfahrensdokumentation, optionen: { readonly ohneAbrufzeit?: boolean } = {}): string {
  const zeilen: string[] = [
    `# Verfahrensdokumentation — ${d.firma}`,
    '',
    `Erzeugt aus der lebenden Konfiguration der CSE-Plattform (GoBD Rz. 151 ff., ACC-10). `
    + `${optionen.ohneAbrufzeit === true ? '' : `Abgerufen am ${d.abgerufenAm} (Europe/Berlin). `}`
    + `SHA-256 der Struktur: \`${d.sha256}\` — er deckt Konfiguration `
    + 'und Verfahren; Bestandszahlen („Bestand beim Abruf“) und Abrufzeit stehen daneben, nicht darin.',
    '',
    `Fassung: Commit ${d.auslieferung.commit ?? 'nicht bekannt (lokal)'} · Schemastand: `
    + `${d.schemastand === null ? 'nicht ablesbar' : `${d.schemastand.migration} (${d.schemastand.angewendetAm})`}.`,
    '',
    'Jeder Abschnitt nennt seine Quelle: aus der Datenbank beim Abruf, aus der ausgelieferten Fassung, '
    + 'oder die Regel, die der Code durchsetzt. Diese Dokumentation rechnet nichts und entscheidet nichts (D-06).',
    '',
  ];
  for (const teil of TEILE) {
    zeilen.push(`## ${teil.praefix}. ${teil.titel}`, '');
    for (const a of d.abschnitte.filter((x) => x.nummer === teil.praefix || x.nummer.startsWith(`${teil.praefix}.`))) {
      zeilen.push(`### ${a.nummer} ${a.titel}`, '', `*Quelle: ${QUELLE_LABEL[a.quelle]}.*`, '');
      for (const p of a.absaetze) zeilen.push(p, '');
      if (a.tabelle !== null) {
        zeilen.push(`| ${a.tabelle.kopf.map(markdownZelle).join(' | ')} |`);
        zeilen.push(`|${a.tabelle.kopf.map(() => '---').join('|')}|`);
        for (const z of a.tabelle.zeilen) zeilen.push(`| ${z.map(markdownZelle).join(' | ')} |`);
        if (a.tabelle.zeilen.length === 0) zeilen.push(`| ${a.tabelle.kopf.map(() => '—').join(' | ')} |`);
        zeilen.push('');
      }
      const bestand = a.bestand ?? [];
      if (bestand.length > 0) {
        zeilen.push('**Bestand beim Abruf** (nicht Teil des Hashs):', '', ...bestand.map((b) => `- ${b}`), '');
      }
    }
  }
  return zeilen.join('\n');
}

/** Die Dokumentation als Fliesstext fuer das Text-PDF (`dokument/pdf.ts`). */
export function alsText(d: Verfahrensdokumentation): string {
  const zeilen: string[] = [
    `Verfahrensdokumentation — ${d.firma}`,
    `Abgerufen am ${d.abgerufenAm} (Europe/Berlin). SHA-256 der Struktur (Konfiguration und Verfahren): ${d.sha256}`,
    `Fassung: Commit ${d.auslieferung.commit ?? 'nicht bekannt (lokal)'}; Schemastand: `
    + `${d.schemastand === null ? 'nicht ablesbar' : `${d.schemastand.migration} (${d.schemastand.angewendetAm})`}`,
    '',
  ];
  for (const teil of TEILE) {
    zeilen.push(`${teil.praefix}. ${teil.titel.toUpperCase()}`, '');
    for (const a of d.abschnitte.filter((x) => x.nummer === teil.praefix || x.nummer.startsWith(`${teil.praefix}.`))) {
      zeilen.push(`${a.nummer} ${a.titel} (${QUELLE_LABEL[a.quelle]})`, '');
      for (const p of a.absaetze) zeilen.push(p, '');
      if (a.tabelle !== null) {
        zeilen.push(a.tabelle.kopf.join(' | '));
        for (const z of a.tabelle.zeilen) zeilen.push(z.join(' | '));
        if (a.tabelle.zeilen.length === 0) zeilen.push('—');
        zeilen.push('');
      }
      const bestand = a.bestand ?? [];
      if (bestand.length > 0) {
        zeilen.push('Bestand beim Abruf (nicht Teil des Hashs):', ...bestand.map((b) => `- ${b}`), '');
      }
    }
  }
  return zeilen.join('\n');
}
