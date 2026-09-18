/**
 * `sichtbar_fuer_kunde` — der Schalter, der ein Dokument aus dem Haus laesst
 * (DOC-03, DOC-04).
 *
 * **Was dieser Schalter heute wirklich tut — nachgemessen, nicht angenommen.**
 * Er ist die VORAUSSETZUNG der Kundensicht, nicht die Kundensicht selbst.
 * `dokument` traegt keine PERMISSIVE `t_kunde`-Policy; ein Konto im echten
 * Kundenportal (`app.scope() = 'kunde'`) sieht deshalb NULL Dokumente,
 * gleichgueltig wie der Schalter steht — `app.aktiver_mandant()` ist in
 * diesem Scope NULL, und `t_mandant` greift nicht. Ob das Kundenportal einen
 * Dokumentweg bekommt, ist O-671.
 *
 * Wirksam ist der Schalter dagegen, wo ein Konto mit `app.portal() = 'kunde'`
 * im Mandanten-Scope liest — dort entscheiden die restriktiven Decken
 * `p_kunde_ceiling` (Freigabe) und, seit 0297, `p_kunde_dokument_zuordnung`
 * (der richtige Kunde). Vor 0297 fehlte die zweite: ein freigegebenes
 * Dokument war in dieser Lage fuer JEDEN Kunden der Gesellschaft sichtbar,
 * auch ohne jeden Bezug zu ihm.
 *
 * Die Seite darf deshalb NICHT behaupten, sie gebe „an diesen Kunden" frei
 * und der Kunde sehe es jetzt. Sie sagt, was gilt: die Freigabe ist gesetzt,
 * der Kundenzugang zu Dokumenten ist offen (O-671), und ohne Kundenbezug
 * waere die Freigabe ohnehin auf niemanden gerichtet.
 *
 * **Das Recht liegt im Ausloeser, nicht nur hier.** `kern.dokument_
 * kundenfreigabe_pruefen` (0297) bindet jede Aenderung an
 * `dokument.kunde_freigeben`; `t_mandant` prueft `dokument.schreiben`, und
 * das haelt auch die Rolle `mitarbeiter`.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class DokumentfreigabeFehler extends Error {
  constructor(nachricht: string, readonly grund:
    | 'nicht_gefunden' | 'geloescht' | 'ohne_kunde' | 'schon_so'
    | 'ohne_grund' | 'kein_recht') {
    super(nachricht);
    this.name = 'DokumentfreigabeFehler';
  }
}

export interface Freigabestand {
  readonly id: string;
  readonly titel: string;
  readonly kategorie: string;
  readonly mime_typ: string | null;
  readonly groesse: string | null;
  readonly entstanden: string;
  readonly kunde_id: string | null;
  readonly kunde: string | null;
  readonly objekt: string | null;
  readonly sichtbar_fuer_kunde: boolean;
  readonly sichtbar_fuer_mitarbeiter: boolean;
  readonly beschreibung: string | null;
  readonly geaendert: string | null;
  readonly geaendert_von: string | null;
  /** Wie oft die Datei schon geholt wurde — der Grund, warum ein Rueckzug wiegt. */
  readonly zugriffe: string;
}

export async function ladeFreigabestand(
  db: Abfrage, dokumentId: string,
): Promise<Freigabestand | null> {
  const [z] = await db.abfrage<Freigabestand>(
    `select d.id, d.titel, d.kategorie::text as kategorie, d.mime_typ,
            d.groesse_bytes::text as groesse,
            to_char(d.entstanden_am, 'DD.MM.YYYY') as entstanden,
            d.kunde_id, k.name as kunde, o.bezeichnung as objekt,
            d.sichtbar_fuer_kunde, d.sichtbar_fuer_mitarbeiter, d.beschreibung,
            to_char(d.geaendert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as geaendert,
            b.name as geaendert_von,
            (select count(*) from dokument_zugriff dz
              where dz.dokument_id = d.id)::text as zugriffe
       from dokument d
       left join kunde k on k.id = d.kunde_id
       left join objekt o on o.id = d.objekt_id
       left join benutzer b on b.id = d.geaendert_von
      where d.id = $1 and d.geloescht_am is null`, [dokumentId]);
  return z ?? null;
}

export interface Zugriffszeile {
  readonly id: string;
  readonly art: string;
  readonly benutzer: string | null;
  readonly zeitpunkt: string;
}

/**
 * Das Zugriffsprotokoll — wer die Datei wann geholt hat (SEC-A9).
 *
 * Es steht auf dieser Seite und nicht nur auf der Metadatenseite, weil eine
 * Freigabe ZURUECKZUNEHMEN etwas anderes bedeutet, wenn schon jemand
 * heruntergeladen hat: die Datei ist dann draussen, und der Schalter aendert
 * daran nichts mehr. Wer das nicht sieht, haelt den Rueckzug fuer eine
 * Loeschung.
 */
export async function ladeZugriffe(
  db: Abfrage, dokumentId: string, grenze = 50,
): Promise<readonly Zugriffszeile[]> {
  return db.abfrage<Zugriffszeile>(
    `select dz.id, dz.art, b.name as benutzer,
            to_char(dz.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as zeitpunkt
       from dokument_zugriff dz
       left join benutzer b on b.id = dz.benutzer_id
      where dz.dokument_id = $1
      order by dz.erstellt_am desc
      limit $2`, [dokumentId, grenze]);
}

/**
 * Den Schalter setzen — in beide Richtungen, immer mit Grund.
 *
 * Der Grund landet in `app.protokolliere`, nicht in einer Spalte: `dokument`
 * hat kein Feld dafuer, und eines zu erfinden waere eine Schemaaenderung fuer
 * etwas, das ins Audit gehoert. Die Kategorie wird MITPROTOKOLLIERT, weil
 * O-736 offen ist: welche Kategorien ueberhaupt an einen Kunden duerfen,
 * entscheidet die Datenbank heute nicht, und dann muss zumindest nachlesbar
 * sein, welche freigegeben wurden.
 */
export async function setzeKundenfreigabe(
  db: Abfrage, dokumentId: string,
  eingabe: { readonly frei: boolean; readonly grund: string },
): Promise<{ readonly titel: string; readonly frei: boolean }> {
  if (eingabe.grund.trim() === '') {
    throw new DokumentfreigabeFehler(
      'Eine Freigabe — und ihre Rücknahme — nennt ihren Grund. Er steht im '
      + 'Prüfprotokoll, nicht in der Zeile.', 'ohne_grund');
  }
  const [vorher] = await db.abfrage<{
    titel: string; kategorie: string; kunde_id: string | null;
    sichtbar_fuer_kunde: boolean; geloescht_am: Date | null;
  }>(
    `select titel, kategorie::text as kategorie, kunde_id, sichtbar_fuer_kunde,
            geloescht_am
       from dokument where id = $1 for update`, [dokumentId]);
  if (vorher === undefined) {
    throw new DokumentfreigabeFehler('Dokument nicht gefunden', 'nicht_gefunden');
  }
  if (vorher.geloescht_am !== null) {
    throw new DokumentfreigabeFehler(
      'Dieses Dokument ist gelöscht — es wird nicht freigegeben', 'geloescht');
  }
  /**
   * **Keine Freigabe ohne Kundenzuordnung.**
   *
   * Sie waere nicht „an niemanden", sondern unbestimmt: `p_kunde_dokument_
   * zuordnung` verlangt seit 0297 eine passende `kunde_id`, ein Dokument
   * ohne sie erreicht also ohnehin keinen Kunden — und ohne die Decke waere
   * es fuer JEDEN Kunden sichtbar gewesen. Beide Faelle sind ein Grund, hier
   * abzuweisen statt stillschweigend zu speichern.
   *
   * Die RUECKNAHME bleibt moeglich: ein Dokument, dem nachtraeglich die
   * Kundenzuordnung genommen wurde, muss man wieder sperren koennen.
   */
  if (eingabe.frei && vorher.kunde_id === null) {
    throw new DokumentfreigabeFehler(
      'Ohne Kundenzuordnung gibt es keinen Kunden, dem dieses Dokument gehört — '
      + 'erst den Kunden in den Metadaten hinterlegen, dann freigeben',
      'ohne_kunde');
  }
  if (vorher.sichtbar_fuer_kunde === eingabe.frei) {
    throw new DokumentfreigabeFehler(
      eingabe.frei
        ? 'Dieses Dokument ist bereits für den Kunden freigegeben'
        : 'Dieses Dokument ist für den Kunden nicht freigegeben',
      'schon_so');
  }

  await db.abfrage(
    `update dokument set sichtbar_fuer_kunde = $2 where id = $1`,
    [dokumentId, eingabe.frei]);

  /**
   * **Die beiden jsonb-Werte gehen als OBJEKT, nicht als `JSON.stringify`.**
   *
   * Gegen die lebende Datenbank nachgemessen: eine Zeichenkette an einem
   * `$n::jsonb`-Platz wird vom Treiber NOCH EINMAL JSON-kodiert, und in der
   * Spalte steht dann ein jsonb-SKALAR (`"{\"a\":1}"`) statt eines Objekts.
   * `app.protokolliere` ruft darauf `jsonb_object_keys`, um die geaenderten
   * Felder zu ermitteln, und faellt mit „cannot call jsonb_object_keys on a
   * scalar" — also erst beim Protokollieren, nicht beim Schreiben der Zeile.
   *
   * Dieselbe Form wie in `services/stammdaten/antragsart.ts`. Wer stattdessen
   * eine Zeichenkette schicken will, schreibt `($n::text)::jsonb` — so macht
   * es `services/finanz/positionsquelle.ts`. Beide Wege sind richtig; sie zu
   * mischen ist es nicht.
   */
  await db.abfrage(
    `select app.protokolliere($1, 'dokument', $2, $3::jsonb, $4::jsonb,
                              app.aktiver_mandant())`,
    [eingabe.frei ? 'dokument.kunde_freigegeben' : 'dokument.kundenfreigabe_zurueckgenommen',
     dokumentId,
     { sichtbar_fuer_kunde: vorher.sichtbar_fuer_kunde },
     {
       sichtbar_fuer_kunde: eingabe.frei,
       kategorie: vorher.kategorie,
       kunde_id: vorher.kunde_id,
       grund: eingabe.grund.trim(),
     }]);

  return { titel: vorher.titel, frei: eingabe.frei };
}
