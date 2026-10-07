import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

/**
 * Die Anspruchsgrundlagen der Nachträge pflegen — bestätigen, archivieren,
 * wieder aufnehmen (BAU-04, K-17, V-384, O-23, D-800, D-842).
 *
 * `kern.nachtrag_grundlagen_vorbelegen` (0080) legt je Gesellschaft die
 * vollständige Liste aus dem Gesetzestext an — § 1 Abs. 3 und 4, § 2 Abs. 3
 * bis 8 VOB/B, § 650b BGB —, jede Zeile als `ist_platzhalter`: der Text ist
 * das Gesetz, unbestätigt ist, welche dieser Grundlagen die Gesellschaft
 * verwendet (O-23). Bis V-384 schrieb kein Dienst `nachtrag_grundlage`; das
 * Formular des Nachtrags trug „unbestätigter Wert" an jeder Zeile, für
 * immer.
 *
 * // TODO(client, O-23): Voreinstellung — die vollständige Liste aus dem Gesetzestext; jede Gesellschaft bestätigt die Grundlagen, die sie verwendet, und archiviert die übrigen. D-800, D-842.
 *
 * **Bestätigen** nimmt den Platzhaltervermerk von der Zeile; Text und
 * Fundstelle bleiben, wie das Gesetz sie nennt — geändert wird hier kein
 * Wort, und eine eigene Grundlage legt niemand an (K-17: nie Freitext).
 * **Archivieren** nimmt die Grundlage aus der Auswahl eines neuen Nachtrags;
 * die Nachträge, die schon auf ihr stehen, behalten sie (der Fremdschlüssel
 * zeigt weiter auf die Zeile, gelöscht wird nie, Invariante 8).
 * **Wieder aufnehmen** macht ein Archivieren rückgängig — eine fehlende
 * Grundlage ist die, unter der der teuerste Nachtrag nicht erfasst werden
 * kann (0080).
 *
 * Das Recht ist `bau.schreiben` — dasselbe, das die `WITH CHECK`-Hälfte von
 * `nachtrag_grundlage.t_mandant` verlangt (0080), wie beim Gewerkekatalog
 * (V-182). Jede Handlung sperrt die Zeile, prüft den Zustand und schreibt eine
 * Protokollzeile mit Schlüssel und Fundstelle.
 */

export type NachtragGrundlageGrund =
  | 'nicht_gefunden' | 'schon_bestaetigt' | 'archiviert' | 'schon_archiviert'
  | 'nicht_archiviert' | 'schluessel_vergeben';

export class NachtragGrundlageFehler extends Error {
  readonly status: number;
  constructor(readonly grund: NachtragGrundlageGrund, nachricht: string) {
    super(nachricht);
    this.name = 'NachtragGrundlageFehler';
    this.status = grund === 'nicht_gefunden' ? 404 : 409;
  }
}

/** Eine Katalogzeile, wie die Pflegeseite sie zeigt. */
export interface GrundlageKatalogZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly fundstelle: string;
  readonly beschreibung: string;
  readonly ankuendigungErforderlich: boolean;
  readonly istPlatzhalter: boolean;
  readonly archiviert: boolean;
  /** Nachträge, die auf dieser Grundlage stehen — die Folge eines Archivierens. */
  readonly nachtraege: number;
}

/** Der ganze Katalog: lebende in der Reihenfolge des Gesetzes, archivierte danach. */
export async function leseGrundlagenKatalog(
  kontext: LeseKontext,
): Promise<readonly GrundlageKatalogZeile[]> {
  return kontext.abfrage<GrundlageKatalogZeile>(
    `select g.id, g.schluessel, g.bezeichnung, g.fundstelle, g.beschreibung,
            g.ankuendigung_erforderlich as "ankuendigungErforderlich",
            g.ist_platzhalter as "istPlatzhalter",
            g.archiviert_am is not null as archiviert,
            (select count(*) from nachtrag n
              where n.mandant_id = g.mandant_id and n.grundlage_id = g.id)::int as nachtraege
       from nachtrag_grundlage g
      where g.mandant_id = app.aktiver_mandant()
      order by (g.archiviert_am is not null), g.reihenfolge, g.schluessel, g.id`);
}

interface Kopf {
  schluessel: string; fundstelle: string; ist_platzhalter: boolean; archiviert: boolean;
}

async function sperre(kontext: SchreibKontext, id: string): Promise<Kopf> {
  const [z] = await kontext.abfrage<Kopf>(
    `select g.schluessel, g.fundstelle, g.ist_platzhalter,
            g.archiviert_am is not null as archiviert
       from nachtrag_grundlage g
      where g.id = $1::uuid and g.mandant_id = app.aktiver_mandant()
      for update`, [id]);
  if (z === undefined) {
    throw new NachtragGrundlageFehler('nicht_gefunden', 'Diese Grundlage gibt es hier nicht.');
  }
  return z;
}

async function protokolliere(
  kontext: SchreibKontext, aktion: string, id: string, kopf: Kopf,
  mehr: Record<string, unknown> = {},
): Promise<void> {
  await kontext.schreibe(
    `select app.protokolliere($1, 'nachtrag_grundlage', $2, null, $3::jsonb,
                              app.aktiver_mandant())`,
    // Das OBJEKT, nicht sein JSON-Text (D-467).
    [aktion, id, { schluessel: kopf.schluessel, fundstelle: kopf.fundstelle, ...mehr }]);
}

/** Nimmt den Platzhaltervermerk von einer lebenden Grundlage. */
export async function bestaetigeGrundlage(kontext: SchreibKontext, id: string): Promise<void> {
  const kopf = await sperre(kontext, id);
  if (kopf.archiviert) {
    throw new NachtragGrundlageFehler('archiviert',
      'Diese Grundlage ist archiviert — erst wieder aufnehmen, dann bestätigen.');
  }
  if (!kopf.ist_platzhalter) {
    throw new NachtragGrundlageFehler('schon_bestaetigt', 'Diese Grundlage ist schon bestätigt.');
  }
  await kontext.schreibe(
    `update nachtrag_grundlage
        set ist_platzhalter = false, geaendert_am = now(),
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [id]);
  await protokolliere(kontext, 'nachtrag_grundlage.bestaetigt', id, kopf);
}

/** Nimmt eine Grundlage aus der Auswahl; bestehende Nachträge behalten sie. */
export async function archiviereGrundlage(kontext: SchreibKontext, id: string): Promise<void> {
  const kopf = await sperre(kontext, id);
  if (kopf.archiviert) {
    throw new NachtragGrundlageFehler('schon_archiviert', 'Diese Grundlage ist schon archiviert.');
  }
  const [n] = await kontext.abfrage<{ anzahl: number }>(
    `select count(*)::int as anzahl from nachtrag
      where mandant_id = app.aktiver_mandant() and grundlage_id = $1::uuid`, [id]);
  await kontext.schreibe(
    `update nachtrag_grundlage
        set archiviert_am = now(), archiviert_von = app.aktueller_benutzer(),
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [id]);
  await protokolliere(kontext, 'nachtrag_grundlage.archiviert', id, kopf,
    { nachtraege: n?.anzahl ?? 0 });
}

/** Nimmt eine archivierte Grundlage wieder in die Auswahl auf. */
export async function nimmGrundlageWiederAuf(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const kopf = await sperre(kontext, id);
  if (!kopf.archiviert) {
    throw new NachtragGrundlageFehler('nicht_archiviert', 'Diese Grundlage ist nicht archiviert.');
  }
  /*
   * `nachtrag_grundlage_schluessel_uk` gilt unter den LEBENDEN Zeilen. Steht
   * derselbe Schlüssel schon wieder lebend da, wäre das Wiederaufnehmen ein
   * 23505 — hier wird es ein Satz.
   */
  const [doppelt] = await kontext.abfrage<{ id: string }>(
    `select id from nachtrag_grundlage
      where mandant_id = app.aktiver_mandant() and schluessel = $1
        and archiviert_am is null and id <> $2::uuid`, [kopf.schluessel, id]);
  if (doppelt !== undefined) {
    throw new NachtragGrundlageFehler('schluessel_vergeben',
      'Eine lebende Grundlage trägt denselben Schlüssel — diese bleibt archiviert.');
  }
  await kontext.schreibe(
    `update nachtrag_grundlage
        set archiviert_am = null, archiviert_von = null,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [id]);
  await protokolliere(kontext, 'nachtrag_grundlage.wiederaufgenommen', id, kopf);
}
