/**
 * Der Angebotsdienst (OPS-08, OPS-09) — die drei Uebergaenge, die zaehlen.
 *
 * **Anlegen aus dem Raumbuch.** Aus der Kalkulation entsteht je Belagsart
 * eine Angebotsposition. Keine Zahl entsteht dabei hier: sie kommen aus
 * `services/kalkulation`, wo sie geprueft sind (Invariante 6).
 *
 * **Versenden.** Genau ein Weg, und er zieht die Nummer aus dem Nummernkreis
 * (`vergebeNummer`, FIN-03) und schreibt sie in DERSELBEN Anweisung, die
 * `versendet_am` setzt. Die Datenbank stempelt die Zeit, friert die
 * Kalkulation ein und schreibt die Steuerzeilen; dieser Dienst besorgt die
 * Nummer und die Freigabe. Ohne benannten menschlichen Freigeber weist die
 * Datenbank ab — Invariante 7 steht dort, nicht hier.
 *
 * **In den Auftrag wandeln.** Ein angenommenes Angebot wird zu genau einem
 * Auftrag; der Auftrag traegt den Angebotsbezug, damit FIN-07 spaeter zeigen
 * kann, aus welcher Zusage eine Rechnungszeile stammt.
 */
import { vergebeNummer, type Abfrage as NummernAbfrage }
  from '../finanz/nummernkreis.js';
import { formatiereMenge, type MilliMenge } from '../finanz/menge.js';
import { alsStundenText } from '../kalkulation/richtzeit.js';
import type { Kalkulation } from '../kalkulation/index.js';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class AngebotFehler extends Error {
  constructor(nachricht: string, readonly grund:
    | 'nicht_gefunden' | 'kein_entwurf' | 'ohne_positionen' | 'schon_gewandelt') {
    super(nachricht);
    this.name = 'AngebotFehler';
  }
}

export interface AngebotAnlegen {
  readonly kundeId: string;
  readonly titel: string;
  readonly objektId?: string;
  readonly ansprechpartnerId?: string;
  readonly gueltigBis?: string;
  readonly einleitungstext?: string;
}

/**
 * Der Regelsteuersatz einer Reinigungsleistung.
 *
 * // TODO(client, O-60): Kommen ermaessigte Saetze, steuerfreie Leistungen
 * oder § 13b-Faelle in einer der drei Gesellschaften vor? Bis dahin traegt
 * jede erzeugte Position den Regelsatz, und das steht sichtbar auf dem
 * Angebot.
 */
export const REGELSATZ_BP = 1900;

export async function legeAngebotAn(
  db: Abfrage, eingabe: AngebotAnlegen,
): Promise<string> {
  const [zeile] = await db.abfrage<{ id: string }>(
    `insert into angebot (mandant_id, kunde_id, objekt_id, ansprechpartner_id,
                          titel, einleitungstext, gueltig_bis)
     values (app.aktiver_mandant(), $1, $2, $3, $4, $5, $6::date)
     returning id`,
    [eingabe.kundeId, eingabe.objektId ?? null, eingabe.ansprechpartnerId ?? null,
     eingabe.titel, eingabe.einleitungstext ?? null, eingabe.gueltigBis ?? null],
  );
  if (zeile === undefined) {
    throw new AngebotFehler('Das Angebot wurde nicht angelegt', 'nicht_gefunden');
  }
  return zeile.id;
}

/**
 * Je Belagsart eine Position — mit dem Rechenweg im Langtext.
 *
 * Der Langtext ist nicht Schmuck: er ist das, was der Kunde liest, wenn er
 * fragt, wie der Preis zustande kommt. Ihn wegzulassen macht aus einem
 * nachvollziehbaren Angebot eine Zahl mit einer Ueberschrift.
 */
export async function uebernimmKalkulation(
  db: Abfrage, angebotId: string, kalkulation: Kalkulation,
  opts: { readonly objektId?: string; readonly turnusLabel: string },
): Promise<number> {
  let nr = 0;
  for (const zeile of kalkulation.zeilen) {
    nr += 1;
    const stunden = alsStundenText(zeile.sekundenJePeriode);
    const langtext =
      `${formatiereMenge(zeile.flaeche)} m² ÷ ${formatiereMenge(zeile.leistungswert)} m²/h `
      + `= ${stunden} Std. je Abrechnungsperiode (${opts.turnusLabel})`;
    await db.abfrage(
      `insert into angebotsposition
         (mandant_id, angebot_id, position_nr, typ, kurztext, langtext, objekt_id,
          menge, einheit, einzelpreis_cent, steuersatz_bp, sortierung)
       values (app.aktiver_mandant(), $1, $2, 'leistung', $3, $4, $5,
               1, 'psch', $6, $7, $2)`,
      [angebotId, nr, `Unterhaltsreinigung ${zeile.bezeichnung}`, langtext,
       opts.objektId ?? null, zeile.lohnkosten, REGELSATZ_BP],
    );
  }
  return nr;
}

export interface Versandergebnis {
  readonly angebotsnummer: string;
  readonly versendetAm: Date;
}

/**
 * Der Versand.
 *
 * Reihenfolge mit Absicht: erst die Nummer ziehen (`SELECT … FOR UPDATE`
 * sperrt die Zaehlerzeile), dann das UPDATE. Scheitert das UPDATE — etwa,
 * weil die Kalkulation noch auf Platzhaltern steht —, rollt die Transaktion
 * auch den Zug zurueck, und es entsteht keine Luecke.
 */
export async function versendeAngebot(
  db: Abfrage & NummernAbfrage, angebotId: string, freigeberBenutzerId: string,
): Promise<Versandergebnis> {
  const [vorher] = await db.abfrage<{ status: string; positionen: string }>(
    `select a.status,
            (select count(*) from angebotsposition p
              where p.angebot_id = a.id and p.typ = 'leistung')::text as positionen
       from angebot a where a.id = $1`,
    [angebotId],
  );
  if (vorher === undefined) {
    throw new AngebotFehler('Angebot nicht gefunden', 'nicht_gefunden');
  }
  if (vorher.status !== 'entwurf' && vorher.status !== 'in_pruefung') {
    throw new AngebotFehler(
      `Ein Angebot im Status ${vorher.status} wird nicht erneut versendet`, 'kein_entwurf');
  }
  if (Number(vorher.positionen) === 0) {
    // Ein Angebot ohne Leistungszeile waere ein Dokument ueber nichts — und
    // seine Steuerzeilen entstuenden aus einer leeren Gruppierung.
    throw new AngebotFehler('Ein Angebot ohne Position wird nicht versendet', 'ohne_positionen');
  }

  const nummer = await vergebeNummer(db as NummernAbfrage, { kreisTyp: 'angebot' });

  const [nachher] = await db.abfrage<{ angebotsnummer: string; versendet_am: Date }>(
    `update angebot
        set status = 'versendet',
            angebotsnummer = $2,
            freigegeben_von = $3,
            freigegeben_am = now(),
            versendet_von = $3,
            versendet_am = now()
      where id = $1
      returning angebotsnummer, versendet_am`,
    [angebotId, nummer.formatiert, freigeberBenutzerId],
  );
  if (nachher === undefined) {
    throw new AngebotFehler('Der Versand hat keine Zeile getroffen', 'nicht_gefunden');
  }
  return { angebotsnummer: nachher.angebotsnummer, versendetAm: nachher.versendet_am };
}

export interface AuftragAnlegen {
  readonly art: 'einzelauftrag' | 'rahmenvertrag' | 'dauerauftrag' | 'projekt';
  readonly verantwortlichBenutzerId: string;
  readonly startDatum: string;
  readonly laufzeitBis?: string;
}

/**
 * OPS-09: aus dem angenommenen Angebot wird ein Auftrag — in einer Handlung.
 *
 * Der Auftragswert kommt aus dem Angebot und wird nicht neu gerechnet. Ein
 * zweites Mal gerechnet waere er eine zweite Wahrheit ueber denselben Betrag,
 * und die Abweichung faende niemand, weil beide plausibel aussehen.
 */
export async function wandleInAuftrag(
  db: Abfrage & NummernAbfrage, angebotId: string, eingabe: AuftragAnlegen,
): Promise<{ readonly auftragId: string; readonly auftragsnummer: string }> {
  const [angebot] = await db.abfrage<{
    kunde_id: string; objekt_id: string | null; lead_id: string | null;
    titel: string; netto_cent: string; status: string; versendet_am: Date | null;
  }>(
    `select kunde_id, objekt_id, lead_id, titel, netto_cent::text as netto_cent,
            status, versendet_am
       from angebot where id = $1`,
    [angebotId],
  );
  if (angebot === undefined) {
    throw new AngebotFehler('Angebot nicht gefunden', 'nicht_gefunden');
  }
  if (angebot.versendet_am === null) {
    throw new AngebotFehler(
      'Ein nicht versendetes Angebot wird nicht zum Auftrag', 'kein_entwurf');
  }
  const [schonDa] = await db.abfrage<{ id: string }>(
    `select id from auftrag where angebot_id = $1`, [angebotId]);
  if (schonDa !== undefined) {
    throw new AngebotFehler(
      'Aus diesem Angebot ist bereits ein Auftrag entstanden', 'schon_gewandelt');
  }

  const nummer = await vergebeNummer(db as NummernAbfrage, { kreisTyp: 'auftrag' });

  const [auftrag] = await db.abfrage<{ id: string; auftragsnummer: string }>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, angebot_id,
                          lead_id, art, bezeichnung, verantwortlich_benutzer_id,
                          start_datum, laufzeit_bis, auftragswert_netto_cent)
     values (app.aktiver_mandant(), $1, $2, $3, $4, $5, $6::auftrag_art, $7, $8,
             $9::date, $10::date, $11)
     returning id, auftragsnummer`,
    [nummer.formatiert, angebot.kunde_id, angebot.objekt_id, angebotId, angebot.lead_id,
     eingabe.art, angebot.titel, eingabe.verantwortlichBenutzerId,
     eingabe.startDatum, eingabe.laufzeitBis ?? null, angebot.netto_cent],
  );
  if (auftrag === undefined) {
    throw new AngebotFehler('Der Auftrag wurde nicht angelegt', 'nicht_gefunden');
  }

  await db.abfrage(
    `update angebot set status = 'angenommen', entschieden_am = now() where id = $1`,
    [angebotId],
  );
  return { auftragId: auftrag.id, auftragsnummer: auftrag.auftragsnummer };
}

/** Die Flaeche, die eine Kalkulation NICHT erfasst hat — fuer den Hinweis. */
export function nichtErfassteFlaeche(kalkulation: Kalkulation): MilliMenge {
  return kalkulation.flaecheOhneBelagsart;
}
