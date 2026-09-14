import 'server-only';
import { createHash } from 'node:crypto';
import type { RohBekanntmachung } from './quelle.js';

/**
 * Bekanntmachungen einlesen — **idempotent, mit aufgehobener Beweiskette**
 * (RAD-03).
 *
 * **Was „idempotent" hier wirklich heisst.** Dieselbe Antwort zweimal
 * einzuspielen darf nichts verändern: keine zweite Zeile, kein neues
 * `geaendert_am`, keine zweite Benachrichtigung. Der Schlüssel dafür ist
 * `(quelle, quell_id)` — die Kennung der Quelle, nicht unsere. Und die
 * Entscheidung „hat sich etwas geändert?" fällt an einem Hash über die
 * Rohantwort, nicht an einem Feldvergleich: eine Quelle, die ein Feld
 * umbenennt, würde sonst als Änderung an jeder Zeile durchschlagen.
 *
 * **Die Rohantwort bleibt.** `ausschreibung_rohdaten` hält sie wortgetreu,
 * eine Zeile je Abruf, anhängend. Ohne sie liesse sich hinterher nicht
 * zeigen, woher ein normalisiertes Feld kam — und bei einer Vergabe, die
 * bestritten wird, ist genau das die Frage.
 *
 * **Der Job schreibt, nicht die Anwendung.** Diese Funktionen laufen unter
 * `cse_job`; `cse_app` hat auf `ausschreibung` kein Schreibrecht (0145).
 */

export interface SchreibAbfrage {
  unsafe(anweisung: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface EinlesErgebnis {
  readonly gelesen: number;
  readonly neu: number;
  readonly geaendert: number;
  readonly unveraendert: number;
  readonly uebersprungen: number;
  readonly ids: readonly string[];
}

/** Der Hash über die Rohantwort EINER Bekanntmachung — er entscheidet „geändert oder nicht". */
export function nutzlastHash(roh: string): string {
  return createHash('sha256').update(roh, 'utf8').digest('hex');
}

interface Zeile {
  readonly id: string;
  readonly neu: boolean;
  readonly geaendert: boolean;
}

/**
 * Eine Bekanntmachung schreiben oder bestätigen.
 *
 * `zuletzt_gesehen_am` wird IMMER gesetzt — auch wenn sich nichts geändert
 * hat. Das ist der Unterschied zwischen „diese Bekanntmachung gibt es noch"
 * und „die Quelle liefert sie nicht mehr", und daran hängt, ob ein Vorgang
 * weiter auf eine Frist zählt, die es nicht mehr gibt.
 */
async function schreibeEine(
  db: SchreibAbfrage, b: RohBekanntmachung, rohText: string, laufId: string | null,
): Promise<Zeile> {
  const hash = nutzlastHash(rohText);
  const [zeile] = (await db.unsafe(
    `insert into ausschreibung
       (quelle, quell_id, quell_url, titel, beschreibung, sprache,
        vergabestelle_name, vergabestelle_ort, vergabestelle_plz,
        cpv_haupt, cpv_weitere, verfahrensart_roh, oberhalb_schwellenwert,
        wert_geschaetzt_cent, waehrung, veroeffentlicht_am,
        frist_teilnahme, frist_angebot, frist_fragen, lose_anzahl,
        quell_status, ist_berichtigung, zuletzt_gesehen_am, rohdaten_hash)
     values ($1::ausschreibung_quelle, $2, $3, $4, $5, $6,
             $7, $8, $9, $10, $11::text[], $12, $13::boolean,
             $14::bigint, $15, $16::timestamptz,
             $17::timestamptz, $18::timestamptz, $19::timestamptz, $20::integer,
             $21::quell_status, $22::boolean, now(), $23)
     on conflict (quelle, quell_id) do update
       set quell_url = excluded.quell_url,
           titel = excluded.titel,
           beschreibung = excluded.beschreibung,
           sprache = excluded.sprache,
           vergabestelle_name = excluded.vergabestelle_name,
           vergabestelle_ort = excluded.vergabestelle_ort,
           vergabestelle_plz = excluded.vergabestelle_plz,
           cpv_haupt = excluded.cpv_haupt,
           cpv_weitere = excluded.cpv_weitere,
           verfahrensart_roh = excluded.verfahrensart_roh,
           oberhalb_schwellenwert = excluded.oberhalb_schwellenwert,
           wert_geschaetzt_cent = excluded.wert_geschaetzt_cent,
           waehrung = excluded.waehrung,
           veroeffentlicht_am = excluded.veroeffentlicht_am,
           frist_teilnahme = excluded.frist_teilnahme,
           frist_angebot = excluded.frist_angebot,
           frist_fragen = excluded.frist_fragen,
           lose_anzahl = excluded.lose_anzahl,
           quell_status = excluded.quell_status,
           ist_berichtigung = excluded.ist_berichtigung,
           rohdaten_hash = excluded.rohdaten_hash,
           geaendert_am = now(),
           zuletzt_gesehen_am = now()
       where ausschreibung.rohdaten_hash is distinct from excluded.rohdaten_hash
     returning id, (xmax = 0) as neu`,
    [b.quelle, b.quellId, b.quellUrl, b.titel, b.beschreibung, b.sprache,
      b.vergabestelleName, b.vergabestelleOrt, b.vergabestellePlz,
      b.cpvHaupt, b.cpvWeitere, b.verfahrensartRoh, b.oberhalbSchwellenwert,
      b.wertCent === null ? null : b.wertCent.toString(), b.waehrung, b.veroeffentlichtAm,
      b.fristTeilnahme, b.fristAngebot, b.fristFragen, b.loseAnzahl,
      b.aufgehoben ? 'aufgehoben' : 'aktiv', b.istBerichtigung, hash],
  )) as { id: string; neu: boolean }[];

  if (zeile === undefined) {
    /*
     * Der `where`-Zweig hat abgelehnt: die Zeile steht schon da, byte-gleich.
     * Ihre Kennung wird trotzdem gebraucht (die Bewertung läuft auch über
     * unveränderte Bekanntmachungen), und `zuletzt_gesehen_am` muss steigen —
     * sonst gälte sie nach zwei Läufen als verschwunden.
     */
    const [bestand] = (await db.unsafe(
      `update ausschreibung set zuletzt_gesehen_am = now()
        where quelle = $1::ausschreibung_quelle and quell_id = $2
        returning id`, [b.quelle, b.quellId])) as { id: string }[];
    if (bestand === undefined) {
      throw new Error(`Bekanntmachung ${b.quelle}/${b.quellId} liess sich weder schreiben noch finden.`);
    }
    return { id: bestand.id, neu: false, geaendert: false };
  }

  await db.unsafe(
    `insert into ausschreibung_rohdaten
       (ausschreibung_id, radar_ingest_lauf_id, quelle, quell_id, nutzlast_roh, nutzlast,
        nutzlast_hash, inhaltstyp)
     values ($1::uuid, $2::uuid, $3::ausschreibung_quelle, $4, $5, $6::jsonb, $7, 'application/json')
     on conflict (quelle, quell_id, nutzlast_hash) do nothing`,
    [zeile.id, laufId, b.quelle, b.quellId, rohText, rohText, hash]);

  /* NUTS-Zeilen: hinzufügen, was dazukam, und entfernen, was die Quelle nicht mehr nennt. */
  if (b.nutsCodes.length > 0) {
    await db.unsafe(
      `insert into ausschreibung_nuts (ausschreibung_id, nuts_code)
       select $1::uuid, unnest($2::text[])
       on conflict (ausschreibung_id, nuts_code) do nothing`,
      [zeile.id, b.nutsCodes]);
  }
  await db.unsafe(
    `delete from ausschreibung_nuts where ausschreibung_id = $1::uuid and not (nuts_code = any ($2::text[]))`,
    [zeile.id, b.nutsCodes]);

  /*
   * **Die Vergabeunterlagen werden ergaenzt, nie entfernt.** Anders als bei
   * NUTS: eine Unterlage, die die Quelle heute nicht mehr nennt, ist trotzdem
   * einmal veroeffentlicht worden — und eine Pruefliste kann darauf zeigen
   * (`quelle_ausschreibung_dokument_id`). Sie zu loeschen hiesse, die Herkunft
   * einer Forderung zu kappen, weil eine Vergabestelle ihre Seite umgebaut hat.
   */
  for (const d of b.dokumente) {
    await db.unsafe(
      `insert into ausschreibung_dokument
         (ausschreibung_id, bezeichnung, quell_url, dateiname, mime_typ, sprache,
          veroeffentlicht_am, zugriff_gesperrt)
       values ($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz, $8::boolean)
       on conflict (ausschreibung_id, coalesce(quell_url, bezeichnung)) do update
         set bezeichnung = excluded.bezeichnung,
             mime_typ = coalesce(excluded.mime_typ, ausschreibung_dokument.mime_typ),
             zugriff_gesperrt = excluded.zugriff_gesperrt,
             geaendert_am = now()`,
      [zeile.id, d.bezeichnung, d.quellUrl, d.dateiname, d.mimeTyp, d.sprache,
        d.veroeffentlichtAm, d.zugriffGesperrt]);
  }

  return { id: zeile.id, neu: zeile.neu, geaendert: !zeile.neu };
}

/**
 * Einen Stapel einlesen. `rohTexte` steht neben `zeilen`: zu jeder
 * normalisierten Bekanntmachung gehört genau der Text, aus dem sie entstand.
 */
export async function leseEin(
  db: SchreibAbfrage,
  zeilen: readonly { readonly bekanntmachung: RohBekanntmachung; readonly rohText: string }[],
  laufId: string | null = null,
): Promise<EinlesErgebnis> {
  let neu = 0;
  let geaendert = 0;
  let unveraendert = 0;
  let uebersprungen = 0;
  const ids: string[] = [];

  for (const [nummer, eintrag] of zeilen.entries()) {
    /**
     * **Ein Sicherungspunkt je Zeile — sonst ist der `catch` eine Lüge.**
     *
     * Der ganze Stapel läuft in EINER Transaktion. Nach dem ersten
     * SQL-Fehler ist sie abgebrochen: jede weitere Anweisung scheitert mit
     * „current transaction is aborted", und am Ende rollt alles zurück —
     * auch die neunundneunzig Zeilen, die in Ordnung waren. Der `catch`
     * zählte dann brav mit und meldete einen Erfolg, den es nicht gab.
     *
     * `savepoint` macht aus jeder Zeile eine Untertransaktion: sie scheitert
     * für sich, der Rest steht. Das ist der Unterschied zwischen „eine
     * Bekanntmachung trug ein kaputtes Feld" und „heute kam nichts an".
     */
    const punkt = `radar_${String(nummer)}`;
    await db.unsafe(`savepoint ${punkt}`);
    try {
      const z = await schreibeEine(db, eintrag.bekanntmachung, eintrag.rohText, laufId);
      await db.unsafe(`release savepoint ${punkt}`);
      ids.push(z.id);
      if (z.neu) neu += 1;
      else if (z.geaendert) geaendert += 1;
      else unveraendert += 1;
    } catch {
      await db.unsafe(`rollback to savepoint ${punkt}`);
      await db.unsafe(`release savepoint ${punkt}`);
      uebersprungen += 1;
    }
  }

  return { gelesen: zeilen.length, neu, geaendert, unveraendert, uebersprungen, ids };
}

/**
 * Was die Quelle in ihrem Fenster nicht mehr liefert, hört auf zu zählen.
 *
 * **Erst nach zwei aufeinanderfolgenden ERFOLGREICHEN Läufen derselben
 * Quelle.** Der Aufrufer weist das nach (`vorlaufErfolgreich`) — eine
 * Altersgrenze allein tut es nicht: war die Quelle eine Woche weg und
 * liefert dann eine leere Seite, wäre nach Alter ihr ganzer Bestand
 * „verschwunden", also genau der Ausfall, den diese Regel verhindern soll.
 * Und ein Lauf, der Zeilen übersprungen hat, räumt gar nicht auf: was er
 * nicht lesen konnte, sieht sonst aus wie nicht mehr da.
 */
export async function markiereVerschwundene(
  db: SchreibAbfrage, quelle: string, seit: Date,
  bedingungen: { readonly vorlaufErfolgreich: boolean; readonly vollstaendig: boolean },
): Promise<number> {
  if (!bedingungen.vorlaufErfolgreich || !bedingungen.vollstaendig) return 0;
  const zeilen = (await db.unsafe(
    `update ausschreibung set quell_status = 'verschwunden', geaendert_am = now()
      where quelle = $1::ausschreibung_quelle
        and quell_status = 'aktiv'
        and zuletzt_gesehen_am < $2::timestamptz
      returning id`, [quelle, seit])) as { id: string }[];
  return zeilen.length;
}
