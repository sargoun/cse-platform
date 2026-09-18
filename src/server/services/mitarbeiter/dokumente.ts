/**
 * Die Dokumente, die diesem Menschen im Portal freigegeben sind (EMP-11,
 * DOC-01, DOC-03, DOC-04, K-05, K-18, AUT-05).
 *
 * ===========================================================================
 * Was diese Liste zeigt — und was noch nicht entschieden ist
 * ===========================================================================
 *
 * Gelesen wird im Personen-Scope. Dort stehen auf `dokument` zwei Policies aus
 * 0009, und sie sagen zusammen genau eine Sache:
 *
 *   p_ma_ceiling (restriktiv)  app.portal() <> 'mitarbeiter'
 *                              or (sichtbar_fuer_mitarbeiter
 *                                  and geloescht_am is null)
 *   t_person     (gewaehrend)  app.portal() = 'mitarbeiter'
 *                              and mandant_id = any(app.sichtbare_mandanten())
 *                              and sichtbar_fuer_mitarbeiter
 *                              and geloescht_am is null
 *
 * Sichtbar ist also, **was die Gesellschaft ihrer Belegschaft ausdruecklich
 * freigegeben hat** — `sichtbar_fuer_mitarbeiter` ist `default false` und wird
 * nur durch eine Handlung wahr (DOC-04). Das ist der Zugang, den die Plattform
 * heute kennt, und diese Datei erfindet keinen zweiten.
 *
 * **Was daran offen ist**, steht auf dem Bildschirm und nicht nur hier: „die
 * Dokumente, die diesen Menschen betreffen" und „die Dokumente, die der
 * Belegschaft freigegeben sind" sind nicht dasselbe. Ein Arbeitsvertrag, eine
 * Lohnabrechnung, ein Zeugnis betreffen EINEN Menschen — `dokument` traegt
 * aber weder `person_id` noch `anstellung_id`, sondern `kunde_id`,
 * `objekt_id` und `formular_eingang_id` (0009). Ohne diese Zuordnung waere
 * jede personenbezogene Auswahl hier geraten, und zwar in die teure Richtung:
 * eine Lohnabrechnung, die im Portal der falschen Kollegin steht.
 *
 * // TODO(client, O-850): Woran haengt „dieses Dokument betrifft DIESEN
 * Menschen" — bekommt `dokument` eine `person_id`/`anstellung_id` (mit eigener
 * Policy und eigener Freigabe), oder bleiben Personalunterlagen dem Lohnsystem
 * und dem Papierweg vorbehalten (D-06)? Bis zur Antwort zeigt diese Liste, was
 * der Belegschaft freigegeben ist, und sagt das auch so.
 *
 * // TODO(client, O-851): Welche der neun Kategorien (DOC-01) duerfen einer
 * Belegschaft ueberhaupt freigegeben werden? Heute prueft die Datenbank nur
 * die Freigabe, nicht die Kategorie — deshalb steht die Kategorie auf dem
 * Bildschirm gross daneben: sie ist die Stelle, an der eine falsche Freigabe
 * auffaellt. (Dieselbe Frage fuer den Kunden ist O-736.)
 *
 * ===========================================================================
 * Was die Projektion NICHT herausgibt
 * ===========================================================================
 *
 *  · **`bucket` und `objekt_schluessel`** — der Ablageort. Ausgeliefert wird
 *    ausschliesslich ueber eine kurzlebige signierte Adresse (DOC-03), nie
 *    ueber einen Pfad; es gibt keinen oeffentlichen Bucket.
 *  · **`kunde_id`** — EMP-13, K-05: das Mitarbeiterportal fuehrt keinen
 *    Kunden. Das Objekt steht mit seiner BEZEICHNUNG da, weil die Kraft dort
 *    arbeitet.
 *  · **`sichtbar_fuer_kunde`** — wer dasselbe Blatt ausserhalb sieht, geht die
 *    Kraft nichts an.
 *  · **`loeschsperre`, `aufbewahrung_bis`** — die Aufbewahrungspflicht ist
 *    eine Pflicht des Hauses (DOC-07, § 147 AO), keine Frist, die die Kraft
 *    bindet.
 *  · **`erstellt_von`, `geaendert_von`** — Namen aus dem Haus.
 *
 * **Diese Datei LIEST nur.** Die Abrufspur (`dokument_zugriff`, DOC-03) ist
 * ein Schreibvorgang und steht deshalb in der Abrufroute
 * `api/mein/dokumente/[id]/datei` — dieselbe Bauart wie die interne
 * `api/dokumente/[id]/datei` (0139), die die Spur ebenfalls im Handler
 * schreibt. `tests/kern/mitarbeiter.test.ts` haelt fest, dass kein Dienst
 * unter `mitarbeiter/` schreibt.
 */
import type { LeseKontext } from '../../kontext/index.js';
import { SIGNATUR_SEKUNDEN } from '../../storage/adapter.js';

/**
 * Die Geltungsdauer einer signierten Adresse in MINUTEN — fuer den Satz auf
 * dem Bildschirm.
 *
 * **Abgeleitet, nicht abgeschrieben.** Die Wahrheit ist `SIGNATUR_SEKUNDEN`
 * im Speicher-Adapter (DOC-03: eine Codekonstante, keine Umgebungsvariable).
 * Eine „15" in einer Seite waere die zweite Fassung derselben Zahl und bliebe
 * stehen, wenn die erste sich aendert. Die Umrechnung steht hier und nicht in
 * der Seite: CLAUDE.md laesst in einer Komponente keine Rechnung zu.
 */
export const SIGNATUR_MINUTEN: number = Math.round(SIGNATUR_SEKUNDEN / 60);

/** Die neun Kategorien aus DOC-01, in der Reihenfolge des Enums. */
export const DOKUMENT_KATEGORIEN = [
  'kunde', 'vertrag', 'angebot', 'rechnung', 'beleg', 'mitarbeiter',
  'projekt', 'buchhaltung', 'unternehmen',
] as const;

export type DokumentKategorie = (typeof DOKUMENT_KATEGORIEN)[number];

export function istDokumentKategorie(wert: string): wert is DokumentKategorie {
  return (DOKUMENT_KATEGORIEN as readonly string[]).includes(wert);
}

/** Ein Dokument, wie das Mitarbeiterportal es zeigt. */
export interface MeinDokument {
  readonly id: string;
  readonly mandantSlug: string;
  readonly mandantName: string;
  readonly kategorie: string;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly mimeTyp: string;
  /**
   * Ganzzahltext, keine Zahl.
   *
   * `groesse_bytes` ist `bigint`, und `bigint` passt nicht verlustfrei in eine
   * JavaScript-Zahl. Gerechnet wird damit ohnehin nicht — die Groesse wird
   * angezeigt, und die Umrechnung in KB/MB macht `groesseText`.
   */
  readonly groesseBytes: string;
  /** Die Bezeichnung des Objekts, wenn das Dokument an einem haengt. */
  readonly objektBezeichnung: string | null;
  readonly objektId: string | null;
  /** `TT.MM.JJJJ` Berliner Ortszeit — fertig aus der Datenbank (Invariante 2). */
  readonly abgelegtLokal: string;
  /** Der fachliche Entstehungstag (0141, GoBD) — `JJJJ-MM-TT`. */
  readonly entstandenAm: string;
  /** Die hoechste Versionsnummer, oder `null`, wenn keine Version geschrieben wurde. */
  readonly version: number | null;
}

/**
 * Die festgeschriebene Feldliste (K-05, EMP-13). Steht in
 * `MITARBEITER_NUTZLASTEN`; die Abnahme vergleicht Feld fuer Feld.
 */
export const MEIN_DOKUMENT_FELDER = [
  'id', 'mandantSlug', 'mandantName', 'kategorie', 'titel', 'beschreibung',
  'mimeTyp', 'groesseBytes', 'objektBezeichnung', 'objektId', 'abgelegtLokal',
  'entstandenAm', 'version',
] as const;

interface DokumentRoh {
  readonly id: string;
  readonly mandant_slug: string;
  readonly mandant_name: string;
  readonly kategorie: string;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly mime_typ: string;
  readonly groesse_bytes: string;
  readonly objekt_bezeichnung: string | null;
  readonly objekt_id: string | null;
  readonly abgelegt_lokal: string;
  readonly entstanden_am: string;
  readonly version: number | null;
}

/**
 * **`left join objekt`, nicht `join`.** `dokument.objekt_id` ist nullbar (eine
 * Unternehmensunterlage haengt an keinem Gebaeude), und im Personen-Scope gibt
 * `objekt.t_person` nur die Objekte der eigenen Einteilungen heraus. Ein
 * `join` liesse jedes Dokument verschwinden, dessen Objekt diese Kraft nicht
 * sehen darf — still, und es saehe aus wie „es liegt nichts vor".
 *
 * Die Version kommt aus einem `lateral`-Zusatz und nicht aus einem
 * `group by`: `dokument_version` ist im Personen-Scope ueber
 * `t_version_lesen` an `dokument.lesen` gebunden und liefert der Kraft null
 * Zeilen. Das ist kein Defekt — die Versionshistorie ist eine Angabe des
 * Hauses —, aber ein `join` darauf laesse die Liste leer. `left join lateral`
 * traegt das: `version` ist dann schlicht `null`.
 */
const SPALTEN = `
  d.id,
  m.slug                                        as mandant_slug,
  m.name                                        as mandant_name,
  d.kategorie::text                             as kategorie,
  d.titel,
  d.beschreibung,
  d.mime_typ,
  d.groesse_bytes::text                         as groesse_bytes,
  o.bezeichnung                                 as objekt_bezeichnung,
  d.objekt_id,
  to_char(d.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY')
                                                as abgelegt_lokal,
  to_char(d.entstanden_am, 'YYYY-MM-DD')        as entstanden_am,
  v.version`;

const QUELLE = `
  from dokument d
  join mandant m on m.id = d.mandant_id
  left join objekt o on o.mandant_id = d.mandant_id and o.id = d.objekt_id
  left join lateral (
        select max(dv.version) as version
          from dokument_version dv
         where dv.mandant_id = d.mandant_id and dv.dokument_id = d.id
      ) v on true`;

/**
 * Die Obergrenze der Liste.
 *
 * Dieselbe Zahl wie im Kundenportal (`kundenportal/basis.ts`). Sie steht als
 * Konstante da, damit nicht zwei Listen zwei Grenzen haben und eine davon
 * still abschneidet — die Seite sagt es, wenn sie greift.
 */
export const GRENZE = 200;

function abbilden(d: DokumentRoh): MeinDokument {
  return {
    id: d.id,
    mandantSlug: d.mandant_slug,
    mandantName: d.mandant_name,
    kategorie: d.kategorie,
    titel: d.titel,
    beschreibung: d.beschreibung,
    mimeTyp: d.mime_typ,
    groesseBytes: d.groesse_bytes,
    objektBezeichnung: d.objekt_bezeichnung,
    objektId: d.objekt_id,
    abgelegtLokal: d.abgelegt_lokal,
    entstandenAm: d.entstanden_am,
    version: d.version === null ? null : Number(d.version),
  };
}

/** Wonach die Liste eingegrenzt werden kann — beides freiwillig. */
export interface DokumentFilter {
  /** Eine der neun Kategorien, oder `null` fuer alle. */
  readonly kategorie?: string | null;
  /** Der Slug einer Gesellschaft (D-09: ein Mensch, zwei GmbHs), oder `null`. */
  readonly mandantSlug?: string | null;
}

/**
 * Die freigegebenen Dokumente — neueste zuerst.
 *
 * **Die Filter sind PARAMETER, nie Zeichenketten in der Abfrage.** Ein
 * `kategorie`-Wert aus der Adressleiste, der in ein SQL eingesetzt wird, ist
 * die klassische Einschleusung; hier steht er in `$1` und wird von Postgres
 * gegen das Enum geprueft — ein unbekannter Wert ergibt einen Fehler und
 * keine stillschweigend leere Liste. Deshalb prueft die SEITE ihn vorher mit
 * `istDokumentKategorie` und schickt `null`, wenn er keine ist.
 */
export async function listeEigeneDokumente(
  kontext: LeseKontext, filter: DokumentFilter = {},
): Promise<readonly MeinDokument[]> {
  const kategorie = filter.kategorie ?? null;
  const slug = filter.mandantSlug ?? null;
  const roh = await kontext.abfrage<DokumentRoh>(
    `select ${SPALTEN} ${QUELLE}
      where ($1::text is null or d.kategorie::text = $1::text)
        and ($2::text is null or m.slug = $2::text)
      order by d.erstellt_am desc, d.titel asc
      limit ${String(GRENZE)}`,
    [kategorie, slug],
  );
  return roh.map(abbilden);
}

/**
 * Ein einzelnes Dokument — oder `null`.
 *
 * Kein 403: ein nicht freigegebenes oder fremdes Dokument ist fuer diese
 * Anmeldung nicht vorhanden (AUT-06). Der Unterschied waere die Auskunft, dass
 * es das Dokument gibt.
 */
export async function findeEigenesDokument(
  kontext: LeseKontext, id: string,
): Promise<MeinDokument | null> {
  const [d] = await kontext.abfrage<DokumentRoh>(
    `select ${SPALTEN} ${QUELLE} where d.id = $1::uuid`,
    [id],
  );
  return d === undefined ? null : abbilden(d);
}

/** Wie viele Dokumente je Kategorie — fuer die Filterzeile. */
export interface KategorieZaehlung {
  readonly kategorie: string;
  readonly anzahl: number;
}

/**
 * Die Kategorien, die in den eigenen Dokumenten wirklich vorkommen.
 *
 * Eine Filterzeile mit neun Knoepfen, von denen sieben auf eine leere Liste
 * fuehren, ist auf einem Diensttelefon kein Filter, sondern ein Irrgarten.
 * Gezaehlt wird gegen dieselben Policies, die auch die Liste liest — die
 * Zahlen stimmen deshalb mit ihr ueberein, statt eine zweite Wahrheit zu
 * behaupten.
 */
export async function zaehleEigeneKategorien(
  kontext: LeseKontext,
): Promise<readonly KategorieZaehlung[]> {
  const roh = await kontext.abfrage<{ kategorie: string; anzahl: string }>(
    `select d.kategorie::text as kategorie, count(*)::text as anzahl
       from dokument d
      group by d.kategorie
      order by d.kategorie`,
  );
  return roh.map((z) => ({ kategorie: z.kategorie, anzahl: Number(z.anzahl) }));
}

/**
 * Die Dateigroesse in Worten — KB und MB zu 1024, wie jedes Betriebssystem
 * sie zeigt.
 *
 * Sie steht im Dienst und nicht in der Seite: CLAUDE.md laesst in einer
 * Komponente keine Rechnung zu, auch keine harmlose. Gerechnet wird auf
 * `BigInt`, weil `groesse_bytes` ein `bigint` ist — 268 MB (das Maximum aus
 * 0009) passen zwar in eine JavaScript-Zahl, aber die Regel gilt fuer die
 * Spalte und nicht fuer den heutigen Wertebereich (K-16).
 *
 * Die ZAHL wird in jeder Sprache gleich geschrieben (SEITENKARTE §12); die
 * EINHEIT ist dieselbe in de/en/tr und steht in `ar` ebenfalls lateinisch, weil
 * „KB" und „MB" auch auf arabischen Geraeten so erscheinen.
 */
export function groesseText(bytes: string): string {
  /*
   * **Die leere Zeichenkette zuerst.** `BigInt('')` ist `0n` und wirft nicht —
   * eine fehlende Angabe saehe damit aus wie eine Datei von null Bytes, und
   * das ist eine Aussage ueber die Datei, die niemand geprueft hat. `0` selbst
   * kommt aus der Datenbank ohnehin nicht (CHECK `groesse_bytes > 0`, 0009).
   */
  if (bytes.trim() === '') return '—';
  let wert: bigint;
  try {
    wert = BigInt(bytes);
  } catch {
    // Eine unlesbare Groesse ist keine Groesse. Kein erfundener Wert.
    return '—';
  }
  if (wert <= 0n) return '—';
  if (wert < 1024n) return `${wert.toString()} B`;
  const kb = Number(wert) / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0).replace('.', ',')} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace('.', ',')} MB`;
}
