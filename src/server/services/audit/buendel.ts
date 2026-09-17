import 'server-only';
import { createHash } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { kanonisiere } from '../finanz/kanonisch.js';
import { alsKanonischerWert } from '../freigabe/diff-json.js';
import { csvFeld } from '../bericht/ausgabe.js';
import { schreibeZip } from '../archiv/zip.js';

/**
 * Das Beweismittelbuendel ueber das Pruefprotokoll (SEC-A9, DOC-08, LEG-01,
 * 04-SEITENKARTE §5.24).
 *
 * **Zwei Schritte, wie beim Pruefbuendel** (`buchhaltung/pruefbuendel.ts`):
 * `erstelleAuditBuendel` liest und bildet das MANIFEST — welche Zeilen der
 * Zeitraum hat, welche davon gekettet sind, ob die Nutzlasten dabei sind und
 * warum nicht. `packeAuditBuendel` legt Manifest und CSV in ein ZIP. Der
 * erste Schritt geht immer und ist das, was der Bildschirm zeigt.
 *
 * **Nur `ebene = 'mandant'` dieser Gesellschaft.** Plattformzeilen — Login,
 * Zwei-Faktor, Sperre, Mandantenanlage, die Quellseite eines
 * Mandantenwechsels — gehoeren nie in ein Mandantenbuendel (K-16(d),
 * 04-SEITENKARTE Z. 1950-1957). Die Spalte `ebene` steht trotzdem in jeder
 * Zeile des Exports: ein Buendel, das die Ebene weglaesst, laesst die beiden
 * spaeter stillschweigend vermischen.
 *
 * **Vorher/Nachher haengen an einem ZWEITEN Recht.** `cse_app` haelt auf
 * `audit_log.vorher`/`nachher` keinen Spaltengrant; die Werte kommen
 * ausschliesslich aus `app.audit_nutzlast_buendel` (0204), und die verlangt
 * `system.audit_exportieren` UND `system.audit_sensitiv_lesen`
 * (05-API-KARTE Z. 369/591, 03-AUTH-BERECHTIGUNGEN Z. 2342). Fehlt das
 * zweite, liefert diese Datei ein REDIGIERTES Buendel und sagt es im
 * Manifest — kein Buendel, das aussieht, als sei nichts geaendert worden.
 *
 * **Und das Wort „revisionssicher" faellt hier nicht.** Signiert ist das
 * MANIFEST ueber seinen SHA-256. Die Hashkette ueber das Protokoll
 * (`kern.audit_kette`, 0204) wird beim Bilden des Buendels fortgeschrieben,
 * und das Manifest nennt, wieviele Zeilen des Zeitraums gekettet sind. Eine
 * ungekettete Zeile ist keine Luecke im Beweis — sie ist ein Beweis, der
 * noch nicht gebildet ist, und der Unterschied gehoert dem Pruefer.
 */

export const MANIFEST_NAME = 'manifest.json';
export const ZEILEN_NAME = 'protokoll.csv';
export const NUTZLAST_NAME = 'nutzlast.csv';

/** Die Obergrenze eines Buendels. Darueber sagt der Dienst es, statt zu liefern. */
export const MAX_ZEILEN = 50_000;

export class AuditBuendelFehler extends Error {
  constructor(
    readonly grund: 'zeitraum' | 'zu_gross' | 'kein_mandant',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'AuditBuendelFehler';
  }
}

export interface BuendelFilter {
  /** Berliner Kalendertag, einschliesslich (`YYYY-MM-DD`). */
  readonly von: string;
  /** Berliner Kalendertag, einschliesslich. */
  readonly bis: string;
  readonly objektTyp?: string | null;
  readonly objektId?: string | null;
  readonly akteurTyp?: string | null;
}

export interface BuendelZeile {
  readonly id: string;
  readonly ebene: string;
  readonly akteurTyp: string;
  readonly akteur: string | null;
  readonly aktion: string;
  readonly objektTyp: string | null;
  readonly objektId: string | null;
  readonly felder: readonly string[] | null;
  readonly ip: string | null;
  readonly sitzungId: string | null;
  /** UTC, RFC 3339 — gespeichert wird UTC (Invariante 2). */
  readonly zeitpunktUtc: string;
  /** Derselbe Zeitpunkt in Europe/Berlin, wie der Bildschirm ihn zeigt. */
  readonly zeitpunktBerlin: string;
}

export interface Nutzlast {
  readonly auditId: string;
  readonly vorher: unknown;
  readonly nachher: unknown;
}

export interface Kettendeckung {
  readonly zeilen: number;
  readonly gekettet: number;
  readonly ketten: readonly string[];
  /** Neu gebildete Glieder bei DIESEM Abruf. */
  readonly neuGekettet: number;
}

export interface AuditBuendel {
  readonly mandantId: string;
  readonly filter: BuendelFilter;
  readonly vonUtc: string;
  readonly bisUtc: string;
  readonly zeilen: readonly BuendelZeile[];
  /** Leer, wenn `system.audit_sensitiv_lesen` fehlt — siehe `redigiert`. */
  readonly nutzlasten: readonly Nutzlast[];
  /** `true`: die Werte fehlen, weil das Recht fehlt. Das Manifest sagt es. */
  readonly redigiert: boolean;
  readonly deckung: Kettendeckung;
  readonly manifest: Uint8Array;
  readonly manifestSha256: string;
}

/** Die Auflösung eines Berliner Tagespaars in UTC-Instants. */
interface Fenster {
  readonly von_utc: string;
  readonly bis_utc: string;
}

const TAG = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Das Zeitfenster — IN DER DATENBANK aufgeloest, nicht in Node.
 *
 * `new Date('2026-03-29')` in einem Prozess, dessen Uhr UTC liest, ergibt
 * Mitternacht UTC und damit 01:00 oder 02:00 Berliner Zeit: ein Tagesfenster
 * begaenne im Sommer zwei Stunden zu spaet, und was fehlte, waere genau die
 * Nachtschicht. `app.loese_ortszeit` kennt die Zone und die Anomalie
 * (Invariante 2, K-11).
 *
 * `bis` ist EINSCHLIESSLICH gemeint und wird zum Folgetag 00:00 aufgeloest —
 * der Vergleich im Export ist dann `>= von and < bis`, und eine Zeile um
 * 23:59:59 am letzten Tag faellt nicht heraus.
 */
async function fenster(
  kontext: LeseKontext, filter: BuendelFilter,
): Promise<Fenster> {
  if (!TAG.test(filter.von) || !TAG.test(filter.bis)) {
    throw new AuditBuendelFehler('zeitraum',
      'Zeitraum bitte als Kalendertage angeben (JJJJ-MM-TT).');
  }
  if (filter.bis < filter.von) {
    throw new AuditBuendelFehler('zeitraum',
      'Das Ende des Zeitraums liegt vor seinem Beginn.');
  }
  const [f] = await kontext.abfrage<Fenster>(
    `select (select zeitpunkt from app.loese_ortszeit($1::date, time '00:00'))::text
              as von_utc,
            (select zeitpunkt from app.loese_ortszeit(($2::date + 1), time '00:00'))::text
              as bis_utc`,
    [filter.von, filter.bis]);
  if (f === undefined) {
    throw new AuditBuendelFehler('zeitraum', 'Der Zeitraum liess sich nicht auflösen.');
  }
  return f;
}

interface ZeileRoh {
  readonly id: string;
  readonly ebene: string;
  readonly akteur_typ: string;
  readonly akteur: string | null;
  readonly aktion: string;
  readonly objekt_typ: string | null;
  readonly objekt_id: string | null;
  readonly felder: readonly string[] | null;
  readonly ip: string | null;
  readonly sitzung_id: string | null;
  readonly utc: string;
  readonly berlin: string;
}

/**
 * Die Zeilen des Zeitraums — dieselbe Abfrage wie die Leseseite, mit Filter.
 *
 * `a.mandant_id = $1 and a.ebene = 'mandant'`: die Ebene wird ausdruecklich
 * gefiltert und nicht aus dem nicht-NULL-Mandanten gefolgert. Der `CHECK`
 * auf `audit_log` macht beides gleichwertig — aber die Bedingung, die das
 * Buendel MEINT, ist die Ebene, und sie soll auch dann noch stimmen, wenn
 * jemand den `CHECK` lockert.
 */
async function leseZeilen(
  kontext: LeseKontext, mandantId: string, f: Fenster, filter: BuendelFilter,
): Promise<readonly BuendelZeile[]> {
  const roh = await kontext.abfrage<ZeileRoh>(
    `select a.id::text as id, a.ebene::text as ebene, a.akteur_typ::text as akteur_typ,
            coalesce(b.name, ag.name) as akteur, a.aktion, a.objekt_typ, a.objekt_id,
            a.geaendert_felder as felder, a.ip::text as ip, a.sitzung_id::text as sitzung_id,
            to_char(a.erstellt_am at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MSZ') as utc,
            to_char(a.erstellt_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI:SS') as berlin
       from audit_log a
       left join benutzer b on b.id = a.akteur_id
       left join agent ag on ag.id = a.agent_id
      where a.mandant_id = $1::uuid
        and a.ebene = 'mandant'
        and a.erstellt_am >= $2::timestamptz
        and a.erstellt_am <  $3::timestamptz
        and ($4::text is null or a.objekt_typ = $4)
        and ($5::text is null or a.objekt_id = $5)
        and ($6::text is null or a.akteur_typ::text = $6)
      order by a.erstellt_am, a.id
      limit $7`,
    [mandantId, f.von_utc, f.bis_utc,
      filter.objektTyp ?? null, filter.objektId ?? null, filter.akteurTyp ?? null,
      MAX_ZEILEN + 1]);
  if (roh.length > MAX_ZEILEN) {
    throw new AuditBuendelFehler('zu_gross',
      `Der Zeitraum enthält mehr als ${String(MAX_ZEILEN)} Einträge. Bitte in `
      + 'kleinere Zeiträume teilen — ein Bündel, das der Browser nicht zu Ende '
      + 'lädt, ist kein Beweismittel.');
  }
  return roh.map((r) => ({
    id: r.id, ebene: r.ebene, akteurTyp: r.akteur_typ, akteur: r.akteur,
    aktion: r.aktion, objektTyp: r.objekt_typ, objektId: r.objekt_id,
    felder: r.felder, ip: r.ip, sitzungId: r.sitzung_id,
    zeitpunktUtc: r.utc, zeitpunktBerlin: r.berlin,
  }));
}

/** Wieviele Zeilen ein Buendel treffen WUERDE — fuer den Bildschirm. */
export async function zaehleAuditZeilen(
  kontext: LeseKontext, filter: BuendelFilter,
): Promise<number> {
  const mandantId = kontext.aktiverMandantId;
  if (mandantId === null) {
    throw new AuditBuendelFehler('kein_mandant',
      'Ein Bündel entsteht nur in genau einem Bereich (Invariante 10).');
  }
  const f = await fenster(kontext, filter);
  const [z] = await kontext.abfrage<{ n: number }>(
    `select count(*)::int as n
       from audit_log a
      where a.mandant_id = $1::uuid
        and a.ebene = 'mandant'
        and a.erstellt_am >= $2::timestamptz
        and a.erstellt_am <  $3::timestamptz
        and ($4::text is null or a.objekt_typ = $4)
        and ($5::text is null or a.objekt_id = $5)
        and ($6::text is null or a.akteur_typ::text = $6)`,
    [mandantId, f.von_utc, f.bis_utc,
      filter.objektTyp ?? null, filter.objektId ?? null, filter.akteurTyp ?? null]);
  return z?.n ?? 0;
}

/**
 * Das Buendel eines Zeitraums: Zeilen, Nutzlasten (soweit erlaubt),
 * Kettendeckung und das kanonische Manifest mit seinem SHA-256.
 *
 * **Schreibend, und das ist Absicht.** Der Abruf schreibt drei Dinge: die
 * Kettenglieder, die noch fehlten (`app.audit_kette_fortschreiben`), eine
 * Protokollzeile fuer das Lesen der Nutzlasten (in der Definer-Funktion) und
 * — vom Aufrufer — eine fuer den Abruf selbst. Ein Beweismittel verlaesst
 * das Haus, und das steht selbst im Protokoll.
 */
export async function erstelleAuditBuendel(
  kontext: SchreibKontext, filter: BuendelFilter,
): Promise<AuditBuendel> {
  const mandantId = kontext.aktiverMandantId;
  const f = await fenster(kontext, filter);
  const zeilen = await leseZeilen(kontext, mandantId, f, filter);

  /*
   * Erst ketten, dann die Deckung lesen: die Reihenfolge ist der Unterschied
   * zwischen „19 von 21 gekettet" und „21 von 21". Ohne Recht antwortet die
   * Funktion mit 0, ohne zu werfen — dann bleibt die Deckung, wie sie ist,
   * und das Manifest sagt es.
   */
  const [kette] = await kontext.schreibe<{ n: number }>(
    `select app.audit_kette_fortschreiben() as n`);
  const [deckungRoh] = await kontext.abfrage<{
    zeilen: string; gekettet: string; ketten: readonly string[] | null;
  }>(`select zeilen::text, gekettet::text, ketten
        from app.audit_kette_deckung($1::timestamptz, $2::timestamptz)`,
    [f.von_utc, f.bis_utc]);
  const deckung: Kettendeckung = {
    zeilen: Number(deckungRoh?.zeilen ?? '0'),
    gekettet: Number(deckungRoh?.gekettet ?? '0'),
    ketten: deckungRoh?.ketten ?? [],
    neuGekettet: kette?.n ?? 0,
  };

  /*
   * Die Nutzlasten ueber die Definer-Funktion. Sie gibt NICHTS zurueck, wenn
   * `system.audit_sensitiv_lesen` fehlt — leer ist hier also nicht „es hat
   * sich nichts geaendert", sondern „es darf nicht gelesen werden", und die
   * beiden auseinanderzuhalten ist der ganze Punkt von `redigiert`.
   */
  const [darf] = await kontext.abfrage<{ ok: boolean }>(
    `select app.hat_recht('system.audit_sensitiv_lesen', app.aktiver_mandant()) as ok`);
  const redigiert = darf?.ok !== true;
  const nutzlasten: readonly Nutzlast[] = redigiert
    ? []
    : (await kontext.schreibe<{ audit_id: string; vorher: unknown; nachher: unknown }>(
      `select audit_id::text as audit_id, vorher, nachher
         from app.audit_nutzlast_buendel($1::timestamptz, $2::timestamptz)`,
      [f.von_utc, f.bis_utc])).map((n) => ({
      auditId: n.audit_id, vorher: n.vorher, nachher: n.nachher,
    }));

  const manifestWert = {
    art: 'cse-audit-buendel',
    version: 1,
    mandantId,
    /** Der angeforderte Zeitraum in Berliner Tagen UND das UTC-Fenster. */
    zeitraum: {
      vonBerlin: filter.von, bisBerlin: filter.bis,
      vonUtc: f.von_utc, bisUtc: f.bis_utc,
      zone: 'Europe/Berlin',
    },
    filter: {
      objektTyp: filter.objektTyp ?? null,
      objektId: filter.objektId ?? null,
      akteurTyp: filter.akteurTyp ?? null,
    },
    /** Was ausdruecklich NICHT enthalten ist. */
    ausgenommen: 'Zeilen mit ebene=plattform (Anmeldung, Zwei-Faktor, Sperre, '
      + 'Mandantenanlage, Quellseite eines Mandantenwechsels) sind nie Teil eines '
      + 'Mandantenbuendels (K-16(d)).',
    anzahlZeilen: zeilen.length,
    zeilen: zeilen.map((z) => ({
      id: z.id, ebene: z.ebene, akteurTyp: z.akteurTyp, akteur: z.akteur,
      aktion: z.aktion, objektTyp: z.objektTyp, objektId: z.objektId,
      geaenderteFelder: z.felder === null ? [] : [...z.felder],
      ip: z.ip, sitzungId: z.sitzungId, zeitpunktUtc: z.zeitpunktUtc,
    })),
    nutzlast: {
      redigiert,
      grund: redigiert
        ? 'Vorher/Nachher fehlen: die Sitzung hält system.audit_sensitiv_lesen nicht. '
          + 'Das Bündel ist damit unvollständig, und dieser Satz steht hier, statt '
          + 'ein Bündel auszuliefern, das aussieht, als sei nichts geändert worden.'
        : null,
      anzahl: nutzlasten.length,
    },
    kette: {
      zeilenImZeitraum: deckung.zeilen,
      gekettet: deckung.gekettet,
      ketten: [...deckung.ketten],
      neuGeketteteGlieder: deckung.neuGekettet,
      hinweis: 'Signiert ist DIESES Manifest über seinen SHA-256. Die Hashkette über '
        + 'das Protokoll liegt in kern.audit_kette/kern.audit_kettenglied und wird beim '
        + 'Bilden eines Bündels fortgeschrieben; app.audit_kette_pruefen rechnet sie nach. '
        + 'Was nicht gekettet ist, ist nicht bewiesen — und steht deshalb als Zahl hier.',
    },
  };
  const manifest = kanonisiere(alsKanonischerWert(manifestWert));

  return {
    mandantId, filter, vonUtc: f.von_utc, bisUtc: f.bis_utc,
    zeilen, nutzlasten, redigiert, deckung, manifest,
    manifestSha256: createHash('sha256').update(manifest).digest('hex'),
  };
}

/** Die Zeilen als CSV nach RFC 4180 — dieselbe Feldform wie die Berichte. */
export function zeilenCsv(b: AuditBuendel): string {
  const kopf = ['id', 'ebene', 'akteur_typ', 'akteur', 'aktion', 'objekt_typ',
    'objekt_id', 'geaenderte_felder', 'ip', 'sitzung_id', 'zeitpunkt_utc',
    'zeitpunkt_berlin'].map((k) => csvFeld(k, true)).join(';');
  const zeilen = b.zeilen.map((z) => [
    csvFeld(z.id, true), csvFeld(z.ebene), csvFeld(z.akteurTyp), csvFeld(z.akteur),
    csvFeld(z.aktion), csvFeld(z.objektTyp), csvFeld(z.objektId),
    csvFeld(z.felder === null ? null : z.felder.join(',')),
    csvFeld(z.ip), csvFeld(z.sitzungId),
    csvFeld(z.zeitpunktUtc, true), csvFeld(z.zeitpunktBerlin, true),
  ].join(';'));
  return [kopf, ...zeilen].join('\r\n');
}

/**
 * Die Nutzlasten als CSV. `vorher`/`nachher` als JSON-Text in einem Feld —
 * eine Spalte je Schluessel gab es nicht: die Schluessel sind je Tabelle
 * andere, und ein Buendel ueber zwanzig Tabellen haette hundert Spalten,
 * von denen jede Zeile zwei fuellt.
 */
export function nutzlastCsv(b: AuditBuendel): string {
  const kopf = ['audit_id', 'vorher', 'nachher'].map((k) => csvFeld(k, true)).join(';');
  const zeilen = b.nutzlasten.map((n) => [
    csvFeld(n.auditId, true),
    csvFeld(n.vorher === null || n.vorher === undefined ? null : JSON.stringify(n.vorher)),
    csvFeld(n.nachher === null || n.nachher === undefined ? null : JSON.stringify(n.nachher)),
  ].join(';'));
  return [kopf, ...zeilen].join('\r\n');
}

/**
 * Manifest, Protokoll-CSV und — wo erlaubt — die Nutzlasten als ZIP.
 *
 * Reproduzierbar: `schreibeZip` schreibt STORE mit Nullzeitstempel, das
 * Manifest ist kanonisches JSON ohne Uhr. Dasselbe Buendel zweimal gepackt
 * ergibt dieselben Bytes — und derselbe SHA-256 ist der Beweis, dass ein
 * Buendel von damals dasselbe ist wie eines von heute.
 */
export function packeAuditBuendel(b: AuditBuendel): Uint8Array {
  const kodierer = new TextEncoder();
  const eintraege = [
    { pfad: MANIFEST_NAME, bytes: b.manifest },
    { pfad: ZEILEN_NAME, bytes: kodierer.encode(zeilenCsv(b)) },
  ];
  if (!b.redigiert) {
    eintraege.push({ pfad: NUTZLAST_NAME, bytes: kodierer.encode(nutzlastCsv(b)) });
  }
  return schreibeZip(eintraege);
}
