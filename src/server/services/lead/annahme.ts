/**
 * Die Formularannahme (REQ-01 … REQ-07, CRM-07, CRM-08, SEC-A4).
 *
 * Ein Vorgang, eine Transaktion: `formular_eingang` und `lead` entstehen
 * zusammen oder gar nicht. Ein Eingang ohne Lead liegt in einer Tabelle, die
 * niemand oeffnet; ein Lead ohne Eingang hat seinen Beweis verloren.
 *
 * **Die Reihenfolge ist die Sicherheit:**
 *   1. Honigtopf   — bevor irgendetwas geschrieben wird.
 *   2. Ratenlimit  — auf `ip_hash`, nicht auf der IP (LEG-09).
 *   3. Validierung — gegen die Felder DIESER Formularversion (SEC-A4).
 *   4. Datei       — Magic Bytes, nie der behauptete Typ.
 *   5. Schreiben   — in EINER Transaktion.
 *
 * Wer 3 nach 5 stellt, hat den unvalidierten Datensatz bereits gespeichert.
 */
import { createHash, randomUUID } from 'node:crypto';
import { eingabeSchema, fehlerAbbilden, FormularFehler, type FormularFeld }
  from '../../../lib/formular/schema.js';
import { slaFrist } from './sla.js';

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface FormularVersion {
  readonly id: string;
  readonly mandantId: string;
  readonly schluessel: string;
  readonly felder: readonly FormularFeld[];
  readonly datenschutzHinweisVersion: string;
  readonly slaStunden: number | null;
  readonly standardBesitzerBenutzerId: string;
}

export interface Attribution {
  readonly utmQuelle?: string | undefined;
  readonly utmMedium?: string | undefined;
  readonly utmKampagne?: string | undefined;
  readonly utmBegriff?: string | undefined;
  readonly utmInhalt?: string | undefined;
  readonly referrer?: string | undefined;
  readonly landingPage?: string | undefined;
}

export interface Einsendung {
  readonly werte: Record<string, unknown>;
  readonly attribution: Attribution;
  /** Was der Honigtopf einfing. Leer heisst: ein Mensch. */
  readonly honigtopf?: string | undefined;
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
  /** Die geprüfte LV-Datei, falls eine kam (REQ-04). */
  readonly datei?: { readonly dokumentId: string; readonly dateiname: string } | undefined;
}

export interface AnnahmeErgebnis {
  readonly eingangId: string;
  readonly leadId: string;
  readonly leadnummer: string;
  readonly slaFristAm: Date | null;
  readonly besitzerBenutzerId: string;
}

/**
 * Der Honigtopf.
 *
 * Ein Feld, das im Layout versteckt ist und `tabindex="-1"` sowie
 * `aria-hidden` traegt: ein Mensch sieht es nicht, ein Screenreader liest es
 * nicht vor, und ein Formularausfueller-Bot fuellt es aus. Es ersetzt kein
 * CAPTCHA — es kostet nur niemanden etwas, und ein CAPTCHA kostet genau die
 * Menschen etwas, fuer die BFSG gilt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum ein Treffer NICHT aufgezeichnet wird** (V-086, O-905).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `formular_eingang_status` fuehrt `neu`, `spam` und `verworfen`, und keiner
 * der drei hat einen Erzeuger. Der naheliegende Griff waere, hier eine Zeile
 * mit `status = 'spam'` zu schreiben — und er waere falsch: die Pruefung in
 * `api/anfrage` steht VOR jeder Datenbankberuehrung, ausdruecklich, damit ein
 * Bot nicht einmal eine Abfrage kostet. Eine Aufzeichnung machte daraus einen
 * Verstaerker: ein Ansturm, der heute nichts kostet, schriebe dann je Treffer
 * eine Zeile. Fuer das Ratenlimit gilt dasselbe doppelt — sein Zweck IST das
 * Begrenzen von Schreibvorgaengen.
 *
 * **Der Preis steht trotzdem, und er wird nicht verschwiegen:** ein falsch
 * positiver Treffer (Passwortverwalter, Browser-Autofill in einem versteckten
 * Feld) verschwindet spurlos, und der Absender bekommt dieselbe Dankseite wie
 * bei Erfolg. Ob das so bleibt, ist eine Abwaegung zwischen einer verlorenen
 * Anfrage und einer Angriffsflaeche — sie steht als O-905 beim Auftraggeber
 * und wird hier nicht nebenbei entschieden.
 */
// TODO(client, O-905): Soll eine als automatisiert abgewiesene Einsendung aufbewahrt werden — oder nur gezaehlt, oder gar nicht?
export function istBot(honigtopf: string | undefined): boolean {
  return honigtopf !== undefined && honigtopf.trim() !== '';
}

/**
 * `SHA256(ip + pfeffer)`. Die rohe IP wird NIE gespeichert.
 *
 * Sie ist personenbezogen; die Missbrauchsabwehr braucht nur Gleichheit. Der
 * Pfeffer verhindert, dass jemand mit der Hash-Liste den ganzen IPv4-Raum
 * durchprobiert — vier Milliarden Hashes sind an einem Nachmittag gerechnet.
 */
export function ipHash(ip: string, pfeffer: string): string {
  if (pfeffer === '') {
    throw new FormularFehler(
      'Kein IP-Pfeffer gesetzt (CSE_IP_PFEFFER). Ohne ihn wäre der Hash über den '
      + 'gesamten IPv4-Raum an einem Nachmittag umkehrbar — das ist kein Schutz.',
    );
  }
  return createHash('sha256').update(`${ip}:${pfeffer}`).digest('hex');
}

export class RatenlimitFehler extends FormularFehler {
  constructor(readonly wartenSekunden: number) {
    super('Zu viele Anfragen von dieser Verbindung. Bitte versuchen Sie es später erneut.');
    this.name = 'RatenlimitFehler';
  }
}

/** Wie viele Einsendungen je IP-Hash im Fenster. VORLAEUFIG — siehe O-80. */
export const LIMIT_JE_IP = 5;
export const FENSTER_MINUTEN = 15;

export async function pruefeRatenlimit(
  db: Abfrage, hash: string, jetzt: Date,
): Promise<void> {
  /**
   * Ueber `app.formular_eingang_zaehlen` und nicht ueber die Tabelle.
   *
   * Ein gewoehnliches `select count(*)` ergab hier immer 0: der
   * Eingangsprinzipal haelt kein `formular.lesen`, die Policy gab keine Zeile
   * frei, und das Limit war eingebaut und wirkungslos. Die Definer-Funktion
   * gibt eine Zahl heraus und keine Zeile.
   */
  const [zeile] = (await db.unsafe(
    `select app.formular_eingang_zaehlen($1, $2) as n`,
    [hash, new Date(jetzt.getTime() - FENSTER_MINUTEN * 60_000).toISOString()],
  )) as { n: number }[];
  if ((zeile?.n ?? 0) >= LIMIT_JE_IP) {
    throw new RatenlimitFehler(FENSTER_MINUTEN * 60);
  }
}

/**
 * Nimmt eine Einsendung an und legt Eingang und Lead an.
 *
 * `db` ist eine TRANSAKTION. Der Aufrufer oeffnet sie, weil die Datei aus
 * REQ-04 in derselben geschrieben werden muss.
 *
 * **Kein `jetzt`-Argument.** Jeder Zeitpunkt, der hier entsteht, kommt aus
 * `now()` derselben Transaktion — genau der Wert, den auch
 * `kern.erzwinge_serverzeit()` schreibt. Ein uebergebener Zeitpunkt waere ein
 * zweiter, der davon abweichen kann (Invariante 5).
 */
export async function nimmAn(
  db: Abfrage,
  formular: FormularVersion,
  einsendung: Einsendung,
): Promise<AnnahmeErgebnis> {
  if (istBot(einsendung.honigtopf)) {
    throw new FormularFehler('Diese Anfrage wurde als automatisiert erkannt.');
  }

  const geprueft = eingabeSchema(formular.felder).safeParse(einsendung.werte);
  if (!geprueft.success) {
    throw new FormularFehler(
      'Bitte prüfen Sie die markierten Felder.',
      fehlerAbbilden(formular.felder, geprueft.error),
    );
  }
  const werte = geprueft.data;

  const bestaetigt = werte['datenschutz_hinweis'] === true;
  if (!bestaetigt) {
    throw new FormularFehler(
      'Bitte bestätigen Sie, dass Sie die Datenschutzhinweise gelesen haben.',
      { datenschutz_hinweis: 'Bitte bestätigen Sie die Datenschutzhinweise.' },
    );
  }
  const werbung = werte['einwilligung_werbung'] === true;

  const a = einsendung.attribution;

  /**
   * Die Kennungen entstehen HIER, nicht in der Datenbank — und es gibt kein
   * `RETURNING`.
   *
   * `INSERT … RETURNING` verlangt, dass die Zeile die SELECT-Policy besteht,
   * und die verlangt `formular.lesen` beziehungsweise `crm.lesen`. Der
   * Eingangsprinzipal haelt beides nicht und soll es nicht halten: er nimmt
   * Einsendungen entgegen und darf keine — auch keine fremde — zurueckholen.
   * Ein `RETURNING` haette ihn gezwungen, Leserechte zu bekommen, und damit
   * waere die ganze Trennung hinfaellig gewesen.
   */
  const eingangId = randomUUID();
  const leadId = randomUUID();

  /**
   * Der Zeitpunkt kommt aus DERSELBEN Transaktion.
   *
   * `kern.erzwinge_serverzeit()` stempelt `eingegangen_am` mit `now()`, und
   * `now()` ist in Postgres der Transaktionsbeginn — dieser Wert ist also
   * exakt der, den der Trigger schreibt. `jetzt` aus dem Aufrufer waere es
   * nicht: zwischen Anfrage und Transaktion liegt Zeit, und die Frist haengt
   * daran.
   */
  const [uhr] = (await db.unsafe(`select now() as jetzt`)) as { jetzt: Date | string }[];
  const eingegangen = uhr!.jetzt instanceof Date ? uhr!.jetzt : new Date(uhr!.jetzt);
  const frist = slaFrist(eingegangen, formular.slaStunden);

  const firma = typeof werte['firma'] === 'string' && werte['firma'] !== ''
    ? werte['firma'] : (werte['name'] as string | undefined) ?? 'Unbekannt';
  const betreff = `Anfrage ${formular.schluessel}`;

  /**
   * Eingang und Lead verweisen aufeinander, also ist die Fremdschluessel-
   * bedingung `DEFERRABLE INITIALLY DEFERRED` (0017). Geprueft wird beim
   * Commit — beide sind da oder keiner.
   */
  await db.unsafe(
    `insert into formular_eingang
       (id, mandant_id, formular_definition_id, daten,
        utm_quelle, utm_medium, utm_kampagne, utm_begriff, utm_inhalt,
        referrer, landing_page, ip_hash, user_agent,
        datenschutz_hinweis_bestaetigt, datenschutz_hinweis_version, einwilligung_werbung,
        lead_id, status, verarbeitet_am)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, $14, $15,
             $16, 'verarbeitet', now())`,
    [
      eingangId, formular.mandantId, formular.id, werte,
      a.utmQuelle ?? null, a.utmMedium ?? null, a.utmKampagne ?? null,
      a.utmBegriff ?? null, a.utmInhalt ?? null,
      a.referrer ?? null, a.landingPage ?? null,
      einsendung.ip ?? null, einsendung.userAgent ?? null,
      formular.datenschutzHinweisVersion, werbung, leadId,
    ],
  );

  const leadnummer = leadnummerAus(eingangId);
  await db.unsafe(
    `insert into lead
       (id, mandant_id, leadnummer, quelle, formular_eingang_id, firma_name, betreff,
        bedarf_zusammenfassung, besitzer_benutzer_id, sla_frist_am,
        utm_quelle, utm_medium, utm_kampagne, utm_begriff, utm_inhalt, referrer,
        akteur_art)
     values ($1, $2, $3, 'webformular', $4, $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, $15, 'system')`,
    [
      leadId, formular.mandantId, leadnummer, eingangId, firma, betreff,
      (werte['nachricht'] as string | undefined) ?? null,
      formular.standardBesitzerBenutzerId,
      frist === null ? null : frist.toISOString(),
      a.utmQuelle ?? null, a.utmMedium ?? null, a.utmKampagne ?? null,
      a.utmBegriff ?? null, a.utmInhalt ?? null, a.referrer ?? null,
    ],
  );

  /**
   * Die Eingangsaktivitaet ist `richtung = 'eingehend'`.
   *
   * Nicht `ausgehend`: der Trigger `kern.setze_erste_reaktion()` stempelt auf
   * die erste AUSGEHENDE Aktivitaet. Waere diese Zeile ausgehend, waere jeder
   * Lead in der Sekunde seiner Entstehung "beantwortet" und die REQ-06-
   * Eskalation liefe nie an.
   */
  await db.unsafe(
    `insert into lead_aktivitaet
       (mandant_id, lead_id, typ, richtung, zweck, kanal, betreff, inhalt,
        akteur_art, rechtsgrundlage_snapshot)
     values ($1, $2, 'system', 'eingehend', 'vertraglich', 'portal', $3, $4, 'system', $5)`,
    [
      formular.mandantId, leadId, betreff,
      einsendung.datei === undefined ? null : `LV: ${einsendung.datei.dateiname}`,
      // CRM-08: eine Anfrage begruendet `anfrage`, kein Werbeeinverstaendnis.
      // Nur das freiwillige Haekchen hebt sie auf `einwilligung`.
      werbung ? 'einwilligung' : 'anfrage',
    ],
  );

  return {
    eingangId,
    leadId,
    leadnummer,
    slaFristAm: frist,
    besitzerBenutzerId: formular.standardBesitzerBenutzerId,
  };
}

/**
 * Die Leadnummer.
 *
 * **Kein Nummernkreis.** K-12s lueckenlose Kette gehoert Rechnungen: dort ist
 * eine Luecke ein GoBD-Befund. Ein Lead ist kein Beleg, und eine abgebrochene
 * Einsendung darf eine Nummer verbrauchen. Den Rechnungszaehler dafuer zu
 * benutzen hiesse, ihn von aussen ausloesbar zu machen.
 */
export function leadnummerAus(eingangId: string): string {
  return `L-${eingangId.replace(/-/gu, '').slice(0, 10).toUpperCase()}`;
}
