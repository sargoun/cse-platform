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
import { formatiereGeld } from '../finanz/geld.js';
import { formatiereMenge, mengeNachPostgres, type MilliMenge } from '../finanz/menge.js';
import { alsStundenText, stundenNachPostgres } from '../kalkulation/richtzeit.js';
import type { Frequenz, Tarif } from '../kalkulation/tarif.js';
import { verteileNetto, type Kalkulation } from '../kalkulation/index.js';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class AngebotFehler extends Error {
  constructor(nachricht: string, readonly grund:
    | 'nicht_gefunden' | 'kein_entwurf' | 'ohne_positionen' | 'schon_gewandelt'
    | 'unbepreiste_flaeche') {
    super(nachricht);
    this.name = 'AngebotFehler';
  }
}

/**
 * Ein Verstoss GEGEN GENAU DIESEN eindeutigen Index — nicht irgendeiner.
 *
 * `23505` allein zu pruefen faenge auch die Auftragsnummer und jede spaetere
 * Eindeutigkeit mit ein und uebersetzte sie in eine Aussage ueber das
 * Angebot, die nicht stimmt. Der Name steht deshalb im Vergleich.
 */
function istEindeutigkeitsverstoss(fehler: unknown, index: string): boolean {
  if (typeof fehler !== 'object' || fehler === null) return false;
  const f = fehler as { code?: unknown; constraint_name?: unknown };
  return f.code === '23505' && f.constraint_name === index;
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
  opts: {
    readonly objektId?: string;
    readonly turnusLabel: string;
    readonly tarif: Tarif;
    readonly frequenz: Frequenz;
  },
): Promise<number> {
  /**
   * Zuerst: KEIN Angebot ueber eine Flaeche, die niemand bepreisen konnte.
   *
   * `ladeKalkulationsgrundlage` meldet zwei Luecken getrennt — Raeume ohne
   * Belagsart und Belagsarten ohne am Stichtag gueltigen Leistungswert. Beide
   * sind in KEINER Zeile enthalten. Wer daraus trotzdem ein Angebot macht,
   * verschickt einen Preis fuer weniger Flaeche, als der Auftrag umfasst —
   * und nichts daran sieht falsch aus: die Zeilen stimmen, die Summe stimmt
   * zu den Zeilen, das Raumbuch ist vollstaendig, nur der Preis gilt fuer
   * einen Teil davon.
   *
   * Deshalb wird hier abgewiesen statt geschaetzt (D-97). Ein Preis, den wir
   * nicht rechnen koennen, ist keine Zahl, die wir waehlen duerfen.
   */
  if (kalkulation.flaecheOhneBelagsart > 0n
      || kalkulation.ohneGueltigenLeistungswert.length > 0) {
    const teile: string[] = [];
    if (kalkulation.flaecheOhneBelagsart > 0n) {
      teile.push(`${formatiereMenge(kalkulation.flaecheOhneBelagsart)} m² ohne Belagsart`);
    }
    if (kalkulation.ohneGueltigenLeistungswert.length > 0) {
      teile.push(
        `${kalkulation.ohneGueltigenLeistungswert.length} Belagsart(en) ohne gueltigen `
        + 'Leistungswert am Stichtag');
    }
    throw new AngebotFehler(
      `Nicht bepreisbare Flaeche: ${teile.join(', ')} — bitte zuerst das Raumbuch `
      + 'vervollstaendigen', 'unbepreiste_flaeche');
  }

  /**
   * Bepreist wird mit dem ANTEIL AM NETTO, nicht mit den Lohnkosten.
   *
   * `kalkuliere` rechnet Lohn → Gemeinkosten → Wagnis → Gewinn. Wer die
   * Positionen mit `zeile.lohnkosten` bepreist, verschickt ein Angebot ohne
   * alle drei Zuschlaege — die Zeilen stimmen, die Summe stimmt zu den
   * Zeilen, und der Auftrag wird zum Selbstkostenpreis unterschrieben.
   * `verteileNetto` verteilt nach groesstem Rest, damit die Zeilensumme
   * `kalkulation.netto` EXAKT trifft.
   */
  const preise = verteileNetto(kalkulation.zeilen, kalkulation.netto);

  /**
   * Der Kalkulationssatz wird MITGESCHRIEBEN — sonst greift die Sperre nicht.
   *
   * `kern.angebot_versand_pruefen` fragt die Sicht `kalkulation_platzhalter`,
   * und die kennt nur, was in `kalkulation` steht. Ein Angebot ohne
   * Kalkulationszeile war deshalb genau das, was diese Phase ausschliessen
   * wollte: ein Preis auf Platzhaltern (O-16, O-56), der die Pruefung
   * passiert, weil es nichts zu pruefen gab.
   *
   * Geschrieben werden die WIRKLICH benutzten Werte, nicht NULL: die
   * Kalkulation soll erklaeren, womit gerechnet wurde. `ist_platzhalter`
   * traegt daneben, dass diese Werte noch niemand bestaetigt hat.
   */
  const [kopf] = await db.abfrage<{ id: string }>(
    `insert into kalkulation
       (mandant_id, angebot_id, basis_objekt_id, basis_stand_am,
        stundenverrechnungssatz_cent, gemeinkosten_basis, gemeinkosten_bp,
        wagnis_gewinn_bp, ist_platzhalter, frequenz_ist_platzhalter, bemerkung)
     values (app.aktiver_mandant(), $1, $2, now(), $3, 'lohn', $4, $5, $6, $8, $7)
     returning id`,
    [angebotId, opts.objektId ?? null,
     String(opts.tarif.stundensatz), opts.tarif.gemeinkostenSatz,
     opts.tarif.wagnisSatz + opts.tarif.gewinnSatz,
     kalkulation.istPlatzhalter,
     kalkulation.offeneFragen.length === 0
       ? null
       : `Offene Fragen: ${kalkulation.offeneFragen.join(', ')}`,
     opts.frequenz.istPlatzhalter],
  );
  if (kopf === undefined) {
    throw new AngebotFehler('Die Kalkulation wurde nicht angelegt', 'nicht_gefunden');
  }

  let nr = 0;
  for (const [i, zeile] of kalkulation.zeilen.entries()) {
    nr += 1;
    const stunden = alsStundenText(zeile.sekundenJePeriode);
    const langtext =
      `${formatiereMenge(zeile.flaeche)} m² ÷ ${formatiereMenge(zeile.leistungswert)} m²/h `
      + `= ${stunden} Std. je Abrechnungsperiode (${opts.turnusLabel}); `
      + `Lohnkosten ${formatiereGeld(zeile.lohnkosten)}, `
      + 'zzgl. anteiliger Gemeinkosten, Wagnis und Gewinn';
    await db.abfrage(
      `insert into angebotsposition
         (mandant_id, angebot_id, position_nr, typ, kurztext, langtext, objekt_id,
          menge, einheit, einzelpreis_cent, steuersatz_bp, sortierung)
       values (app.aktiver_mandant(), $1, $2, 'leistung', $3, $4, $5,
               1, 'psch', $6, $7, $2)`,
      [angebotId, nr, `Unterhaltsreinigung ${zeile.bezeichnung}`, langtext,
       opts.objektId ?? null, preise[i], REGELSATZ_BP],
    );

    /**
     * Und dieselbe Zeile als Kalkulationsposition — mit den Eingangsgroessen
     * als SCHNAPPSCHUSS. Ein Join zeigte den heutigen Leistungswert; hier
     * steht der, mit dem gerechnet wurde. Genau darauf beruht spaeter jede
     * Antwort auf die Frage, wie der Preis zustande kam.
     */
    await db.abfrage(
      `insert into kalkulation_position
         (mandant_id, kalkulation_id, position_nr, kostenart, bezeichnung,
          belagsart_id, menge, einheit, einzelbetrag_cent, betrag_cent,
          leistungswert_qm_pro_stunde, frequenz_faktor, stundensatz_cent,
          rechenansatz, operanden, berechnungsweg, leistungswert_ist_platzhalter,
          sortierung)
       values (app.aktiver_mandant(), $1, $2, 'lohn', $3, $4, $5::numeric, 'std', $6, $7,
               $8::numeric, $9::numeric, $10, $11, $12::jsonb, $13, $14, $2)`,
      /**
       * `menge` sind STUNDEN, nicht Quadratmeter: nur so ist
       * `menge × einzelbetrag ≈ betrag` nachvollziehbar, und nur so traegt
       * die Zeile den Stundensatz, den `kp_lohn_mit_satz` verlangt. Flaeche
       * und Leistungswert stehen als Schnappschuss daneben.
       */
      [kopf.id, nr, zeile.bezeichnung, zeile.belagsartId,
       stundenNachPostgres(zeile.sekundenJePeriode),
       String(opts.tarif.stundensatz), String(zeile.lohnkosten),
       mengeNachPostgres(zeile.leistungswert),
       (Number(opts.frequenz.faktor) / 1000).toFixed(4),
       String(opts.tarif.stundensatz),
       'Flaeche ÷ Leistungswert × Frequenz × Stundensatz',
       {
         flaeche_milli: String(zeile.flaeche),
         leistungswert_milli: String(zeile.leistungswert),
         frequenz_faktor_milli: String(opts.frequenz.faktor),
         sekunden_je_durchgang: String(zeile.sekundenJeDurchgang),
         sekunden_je_periode: String(zeile.sekundenJePeriode),
         stundensatz_cent: String(opts.tarif.stundensatz),
         lohnkosten_cent: String(zeile.lohnkosten),
         nettoanteil_cent: String(preise[i]),
       },
       langtext, zeile.leistungswertIstPlatzhalter],
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
  /**
   * Auch hier `for update`: zwei gleichzeitige Versandversuche lesen sonst
   * beide `entwurf`, und der zweite zieht eine Nummer, bevor das erste
   * UPDATE sichtbar ist. Er scheitert danach am Unveraenderlichkeits-
   * Ausloeser — mit einem Fehler, der nichts erklaert, und einer verbrauchten
   * Nummer. Die Sperre laesst ihn stattdessen den benannten Fehler sehen.
   */
  const [vorher] = await db.abfrage<{ status: string; positionen: string }>(
    `select a.status,
            (select count(*) from angebotsposition p
              where p.angebot_id = a.id and p.typ = 'leistung')::text as positionen
       from angebot a where a.id = $1 for update`,
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
  /**
   * `for update` — die Zeile wird GESPERRT, nicht nur gelesen.
   *
   * Zwei gleichzeitige Klicks auf „Angenommen“ lesen sonst beide denselben
   * Zustand, sehen beide keinen Auftrag und legen beide einen an. Die Sperre
   * serialisiert sie; der eindeutige Index `auftrag_angebot_uk` faengt den
   * Rest, falls jemand einmal an diesem Dienst vorbeischreibt.
   */
  const [angebot] = await db.abfrage<{
    kunde_id: string; objekt_id: string | null; lead_id: string | null;
    titel: string; netto_cent: string; status: string; versendet_am: Date | null;
  }>(
    `select kunde_id, objekt_id, lead_id, titel, netto_cent::text as netto_cent,
            status, versendet_am
       from angebot where id = $1 for update`,
    [angebotId],
  );
  if (angebot === undefined) {
    throw new AngebotFehler('Angebot nicht gefunden', 'nicht_gefunden');
  }
  /**
   * Erst der bestehende Auftrag, DANN der Status — die Reihenfolge ist die
   * Nachricht.
   *
   * Die Wandlung setzt das Angebot am Ende auf `angenommen`. Ein zweiter
   * Klick liefe deshalb in die Statuspruefung und bekaeme „Status
   * angenommen“ zu lesen: richtig, und ohne Hinweis darauf, dass der Auftrag
   * bereits existiert und wo er steht. Der spezifische Fall gehoert zuerst
   * geprueft.
   */
  const [schonDa] = await db.abfrage<{ id: string }>(
    `select id from auftrag where angebot_id = $1`, [angebotId]);
  if (schonDa !== undefined) {
    throw new AngebotFehler(
      'Aus diesem Angebot ist bereits ein Auftrag entstanden', 'schon_gewandelt');
  }

  /**
   * Und dann der STATUS, nicht der Zeitstempel.
   *
   * `versendet_am` bleibt gesetzt, wenn ein Angebot spaeter abgelehnt,
   * zurueckgezogen oder abgelaufen ist — es WURDE ja versendet. Wer nur den
   * Zeitstempel prueft, macht aus einem abgelehnten Angebot einen Auftrag,
   * und der traegt dann einen Wert, den der Kunde ausdruecklich nicht
   * angenommen hat.
   */
  if (angebot.status !== 'versendet') {
    throw new AngebotFehler(
      `Ein Angebot im Status ${angebot.status} wird nicht zum Auftrag`, 'kein_entwurf');
  }

  const nummer = await vergebeNummer(db as NummernAbfrage, { kreisTyp: 'auftrag' });

  /**
   * Und wenn doch zwei gleichzeitig hier ankommen, entscheidet der eindeutige
   * Index `auftrag_angebot_uk`. Sein Verstoss wird in DENSELBEN benannten
   * Fehler uebersetzt wie die Vorabpruefung oben — sonst saehe der Verlierer
   * eines Rennens einen anderen Fehler als der zweite Klick eine Sekunde
   * spaeter, und beide meinen dasselbe.
   */
  const auftrag = await (async () => {
    try {
      const [z] = await db.abfrage<{ id: string; auftragsnummer: string }>(
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
      return z;
    } catch (fehler) {
      if (istEindeutigkeitsverstoss(fehler, 'auftrag_angebot_uk')) {
        throw new AngebotFehler(
          'Aus diesem Angebot ist bereits ein Auftrag entstanden', 'schon_gewandelt');
      }
      throw fehler;
    }
  })();
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
