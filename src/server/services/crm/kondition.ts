import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { CrmFehler } from './anlegen.js';

/**
 * Die Zahlungskonditionen eines Kunden — Debitorennummer, Zahlungsziel,
 * Mahnsperre (CRM-01, FIN-15, K-05).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Diese vier Spalten sind `cse_app` SPALTENWEISE entzogen. Jeder Zugriff,
 * der sie nennt, scheitert mit `42501` — auch ein `where` und ein `order by`.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kunde.debitorennummer`, `kunde.zahlungsziel_tage`, `kunde.mahnsperre_bis`
 * und `kunde.mahnsperre_grund` haben für `cse_app` nur INSERT und UPDATE. Das
 * heisst:
 *
 *  - **Gelesen wird über `app.zahlungskondition_lesen(uuid)`** — `SECURITY
 *    DEFINER`, prüft `crm_entgelt.lesen` und **schreibt eine Protokollzeile
 *    bei jedem Aufruf**. Deshalb wird sie einmal je Seitenaufruf gerufen und
 *    nie in einer Liste.
 *  - **Ein `update` nennt sie nicht in `RETURNING` und nicht in `WHERE`.**
 *    Der erste naive Schreibweg (`… returning zahlungsziel_tage`) scheiterte
 *    nicht an der Policy, sondern am Spaltenrecht — mit einem rohen
 *    Berechtigungsfehler auf einer Seite, die gerade gespeichert hat.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Es gibt kein Standard-Zahlungsziel, und `14` wird hier nicht erfunden.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ermittleZahlungsziel` (`finanz/rechnung.ts`) löst in drei Stufen auf:
 * `vertrag_abrechnung.zahlungsziel_tage` (O-04, die Tabelle kommt später),
 * dann diese Spalte, dann `app.einstellung('finanzen.zahlungsziel_tage_
 * standard')` — gesät als NULL (O-66). Sind alle drei leer, schreibt die
 * Faktura kein `faellig_am` und die Festschreibung weist mit benanntem Grund
 * ab. Diese Seite zeigt deshalb „nicht gesetzt" und nicht „14".
 *
 * // TODO(client, O-66): Welches Standard-Zahlungsziel gilt je Gesellschaft,
 * wenn am Kunden und am Vertrag keines steht?
 * // TODO(client, O-05): Muss die Debitorennummer dem DATEV-Debitorenkreis
 * des SKR folgen (Nummernband, Länge, führende Ziffer)? Bis zur Antwort ist
 * es ein freies Textfeld mit Eindeutigkeit je Gesellschaft.
 */

export interface Kondition {
  readonly debitorennummer: string | null;
  readonly zahlungszielTage: number | null;
  readonly mahnsperreBis: string | null;
  readonly mahnsperreGrund: string | null;
}

/** `null` heisst: diesen Kunden gibt es nicht — oder er ist nicht lesbar. */
export async function leseKondition(
  kontext: LeseKontext, kundeId: string,
): Promise<Kondition | null> {
  const [z] = await kontext.abfrage<{
    debitorennummer: string | null;
    zahlungsziel_tage: number | null;
    mahnsperre_bis: string | null;
    mahnsperre_grund: string | null;
  }>(
    `select debitorennummer, zahlungsziel_tage,
            mahnsperre_bis::text as mahnsperre_bis, mahnsperre_grund
       from app.zahlungskondition_lesen($1::uuid)`, [kundeId]);
  if (z === undefined) return null;
  return {
    debitorennummer: z.debitorennummer,
    zahlungszielTage: z.zahlungsziel_tage,
    mahnsperreBis: z.mahnsperre_bis,
    mahnsperreGrund: z.mahnsperre_grund,
  };
}

/**
 * Hält die Mahnsperre den Lauf HEUTE an?
 *
 * Über `app.kunde_mahnsperre_aktiv` — dieselbe Funktion, die der Mahnlauf
 * fragt. Sie verlangt `mahnung.lesen`; wer das nicht hält, bekommt `null`
 * statt einer Antwort, und die Seite schreibt, welches Recht fehlt.
 */
export async function mahnsperreAktiv(
  kontext: LeseKontext, kundeId: string,
): Promise<boolean | null> {
  const [recht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('mahnung.lesen', app.aktiver_mandant()) as darf`);
  if (recht?.darf !== true) return null;
  const [z] = await kontext.abfrage<{ aktiv: boolean }>(
    `select app.kunde_mahnsperre_aktiv($1::uuid, app.aktiver_mandant()) as aktiv`,
    [kundeId]);
  return z?.aktiv ?? null;
}

export interface KonditionSetzen {
  readonly kundeId: string;
  readonly debitorennummer?: string | undefined;
  /** `0`–`180` (CHECK `kunde_zahlungsziel_plausibel`) oder leer. */
  readonly zahlungszielTage?: string | undefined;
  readonly mahnsperreBis?: string | undefined;
  readonly mahnsperreGrund?: string | undefined;
}

/**
 * Die drei Angaben setzen.
 *
 * **Die Mahnsperre ist ein PAAR.** Der CHECK `kunde_mahnsperre_begruendet`
 * verlangt `(mahnsperre_bis is null) = (mahnsperre_grund is null)`: entweder
 * beides oder keines. Das steht hier als Satz und nicht als
 * Datenbankfehler — „new row for relation kunde violates check constraint"
 * erklärt niemandem, dass der Grund fehlt.
 */
export async function setzeKondition(
  kontext: SchreibKontext, eingabe: KonditionSetzen,
): Promise<void> {
  const [recht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('crm.schreiben', app.aktiver_mandant()) as darf`);
  if (recht?.darf !== true) {
    throw new CrmFehler('Zum Ändern der Konditionen fehlt `crm.schreiben`.',
      'kein_schreibrecht', 403);
  }

  const debitor = eingabe.debitorennummer?.trim() ?? '';
  const zielRoh = eingabe.zahlungszielTage?.trim() ?? '';
  const bis = eingabe.mahnsperreBis?.trim() ?? '';
  const grund = eingabe.mahnsperreGrund?.trim() ?? '';

  let ziel: number | null = null;
  if (zielRoh !== '') {
    if (!/^\d{1,3}$/u.test(zielRoh)) {
      throw new CrmFehler('Das Zahlungsziel wird in ganzen Tagen angegeben.',
        'ziel_keine_zahl');
    }
    ziel = Number(zielRoh);
    if (ziel > 180) {
      throw new CrmFehler(
        'Mehr als 180 Tage nimmt der CHECK `kunde_zahlungsziel_plausibel` nicht an — '
        + 'ein halbes Jahr Zahlungsziel ist im Zweifel ein Tippfehler und treibt '
        + 'sonst den Mahnlauf und die §288-BGB-Zinsen.', 'ziel_zu_gross');
    }
  }

  if ((bis === '') !== (grund === '')) {
    throw new CrmFehler(
      'Eine Mahnsperre besteht aus BEIDEM: bis wann sie gilt und warum. Ohne Grund '
      + 'steht später nur da, dass nicht gemahnt wurde — und niemand weiss, ob das '
      + 'so gewollt war. Beide Felder leeren hebt die Sperre auf.',
      'mahnsperre_unvollstaendig');
  }
  if (bis !== '') {
    const [pruefung] = await kontext.abfrage<{ vergangen: boolean }>(
      `select ($1::date < app.berlin_heute()) as vergangen`, [bis]);
    if (pruefung?.vergangen === true) {
      throw new CrmFehler(
        'Eine Mahnsperre, die schon abgelaufen ist, hält nichts an. Wählen Sie '
        + 'heute oder einen späteren Tag — oder leeren Sie beide Felder.',
        'mahnsperre_vergangen');
    }
  }

  /*
   * `returning id` — und keine der vier entzogenen Spalten, weder hier noch
   * in der WHERE-Klausel. Siehe Kopf dieser Datei.
   */
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update kunde
        set debitorennummer = $2,
            zahlungsziel_tage = $3::smallint,
            mahnsperre_bis = $4::date,
            mahnsperre_grund = $5,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and archiviert_am is null
      returning id`,
    [eingabe.kundeId, debitor === '' ? null : debitor, ziel,
      bis === '' ? null : bis, grund === '' ? null : grund]);

  if (zeilen[0] === undefined) {
    throw new CrmFehler('Diesen Kunden gibt es nicht.', 'nicht_gefunden', 404);
  }

  await kontext.schreibe(
    `select app.protokolliere('kunde.zahlungskondition_gesetzt', 'kunde', $1::text,
              null,
              jsonb_build_object('debitor_gesetzt', $2::boolean,
                                 'ziel_gesetzt', $3::boolean,
                                 'mahnsperre_gesetzt', $4::boolean),
              app.aktiver_mandant())`,
    [eingabe.kundeId, debitor !== '', ziel !== null, bis !== '']);
}

/**
 * Welche Stufe der §4.2-Auflösung greift bei diesem Kunden — und was
 * passiert, wenn keine greift?
 *
 * Für den Bildschirm, nicht für die Faktura: die rechnet mit
 * `ermittleZahlungsziel`. Hier steht, was dort herauskommt und warum, damit
 * die Seite die Wirkung der Eingabe zeigt statt sie zu behaupten.
 */
export function zielHerkunft(kondition: Kondition | null): {
  readonly stufe: 'kunde' | 'keine';
  readonly text: string;
} {
  if (kondition?.zahlungszielTage != null) {
    return {
      stufe: 'kunde',
      text: `${String(kondition.zahlungszielTage)} Tage, gesetzt an diesem Kunden. `
        + 'Eine Vertragsabrechnung geht vor, sobald es sie gibt (O-04).',
    };
  }
  return {
    stufe: 'keine',
    text: 'Nicht gesetzt — und es wird nichts geraten. Ohne Zahlungsziel schreibt die '
      + 'Faktura kein Fälligkeitsdatum, und die Festschreibung weist die Rechnung mit '
      + 'genau diesem Grund ab. Ein stilles „14 Tage" wäre eine Geschäftsregel, die '
      + 'niemand getroffen hat (O-66).',
  };
}
