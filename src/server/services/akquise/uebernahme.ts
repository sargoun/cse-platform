/**
 * Die Naht: aus einem Akquiseziel wird ein Lead (§12).
 *
 * **Hier endet die Recherche und beginnt der Vertrieb.** Ein Mensch hat die
 * Firma angesehen und entschieden, dass sie einen Vorgang wert ist. Ab der
 * Übernahme gelten die Lead-Regeln: ein Besitzer, eine Aktivitätenspur, und
 * für jede ausgehende Nachricht das UWG-Tor (`kern.uwg_sendetor`).
 *
 * **Der Lead entsteht OHNE Ansprechpartner — und das ist kein Mangel.**
 * `akquise_ziel` speichert keine Personendaten (0172, Art. 14 DSGVO), also
 * kann die Übernahme keinen erfinden. Die Folge ist gewollt und sichtbar: der
 * Lead trägt `firma_name`, aber `ansprechpartner_id is null`, und damit lässt
 * `app.darf_kontaktiert_werden` **keine** elektronische Werbung durch. Wer
 * diese Firma anschreiben will, muss zuerst einen Kontakt anlegen und dessen
 * Rechtsgrundlage benennen. Genau an dieser Stelle soll ein Mensch stehen.
 *
 * **Warum `quelle = 'akquise'` und nicht `manuell`.** Die Herkunft eines Leads
 * entscheidet später darüber, was mit ihm passieren darf. Ein Lead aus einer
 * eigenen Anfrage hat eine Rechtsgrundlage (`anfrage`), ein recherchierter hat
 * keine. Beide als `manuell` zu führen, hiesse, diesen Unterschied genau dort
 * zu verlieren, wo er zählt — in der Auswertung, welche Kontakte angesprochen
 * werden durften.
 */
import { randomUUID } from 'node:crypto';
import { leadnummerAus } from '../lead/annahme.js';
import { AkquiseFehler } from './ziel.js';
/**
 * Der Aufrufer öffnet die Transaktion und bindet die Sitzung (K-05) — dieser
 * Dienst kennt keine Verbindung, nur eine `Abfrage`. Die drei Schreibvorgänge
 * unten gehören trotzdem zusammen; wer sie ohne Transaktion aufruft, bekommt
 * einen Lead ohne Rückverknüpfung.
 */
import type { Abfrage } from './quelle.js';


export interface UebernahmeEingabe {
  readonly zielId: string;
  readonly besitzerBenutzerId: string;
  /** Freitext des Menschen, der übernimmt — sonst wird der Firmenname genommen. */
  readonly betreff?: string | undefined;
  readonly notiz?: string | undefined;
}

export interface UebernahmeErgebnis {
  readonly leadId: string;
  readonly leadnummer: string;
  readonly firmenname: string;
}

/**
 * Übernehmen — in EINER Transaktion.
 *
 * Drei Schreibvorgänge gehören zusammen oder gar nicht: der Lead, die
 * Rückverknüpfung am Ziel und der erste Eintrag in der Aktivitätenspur. Ein
 * Lead ohne Rückverknüpfung liesse dieselbe Firma beim nächsten Lauf wieder
 * als „neu" erscheinen; ein Ziel mit `lead_id` auf einen nicht existierenden
 * Lead bräche den CHECK `akquise_ziel_uebernommen_hat_lead`.
 *
 * Der Aufrufer öffnet die Transaktion und bindet die Sitzung (K-05) — dieser
 * Dienst kennt keine Verbindung, nur eine `Abfrage`.
 */
export async function uebernehmen(
  tx: Abfrage, mandantId: string, eingabe: UebernahmeEingabe,
): Promise<UebernahmeErgebnis> {
  const ziele = (await tx.unsafe(
    `select id, firmenname, branche, ort, passender_bereich, bedarf_vermutung,
            punktzahl, punktzahl_begruendung, status, lead_id
       from akquise_ziel
      where mandant_id = $1 and id = $2 and archiviert_am is null
      for update`,
    [mandantId, eingabe.zielId],
  )) as {
    id: string; firmenname: string; branche: string | null; ort: string | null;
    passender_bereich: string | null; bedarf_vermutung: string | null;
    punktzahl: number | null; punktzahl_begruendung: string | null;
    status: string; lead_id: string | null;
  }[];

  const ziel = ziele[0];
  if (ziel === undefined) {
    throw new AkquiseFehler('Dieses Akquiseziel gibt es nicht.', 'nicht_gefunden');
  }
  /*
   * `for update` oben und diese Prüfung hier sind ein Paar. Zwei Menschen, die
   * gleichzeitig auf „übernehmen" klicken, erzeugten sonst zwei Leads zu
   * derselben Firma — und zwei Vertriebler riefen dort an.
   */
  if (ziel.status === 'uebernommen' || ziel.lead_id !== null) {
    throw new AkquiseFehler(
      `„${ziel.firmenname}" wurde bereits übernommen.`, 'schon_uebernommen',
    );
  }

  const leadId = randomUUID();
  const leadnummer = leadnummerAus(leadId);
  const betreff = eingabe.betreff?.trim() !== undefined && eingabe.betreff.trim() !== ''
    ? eingabe.betreff.trim()
    : `Akquise: ${ziel.firmenname}`;

  /*
   * Die Bedarfsvermutung wandert MIT in den Lead — samt ihres „Nicht
   * geprüft."-Satzes. Sie dort zu kürzen hiesse, eine Vermutung als Befund zu
   * übergeben; der Vertrieb läse im Lead dann eine Feststellung, die niemand
   * getroffen hat.
   */
  const zusammenfassung = [
    ziel.bedarf_vermutung,
    ziel.branche === null ? null : `Branche: ${ziel.branche}.`,
    eingabe.notiz?.trim() === undefined || eingabe.notiz.trim() === ''
      ? null : eingabe.notiz.trim(),
  ].filter((t): t is string => t !== null).join(' ');

  /*
   * `lead_punktzahl_begruendet` verlangt: eine Punktzahl OHNE Begruendung gibt
   * es nicht. Sollte am Ziel je eine Zahl ohne Text stehen — von Hand gesetzt,
   * aus einem aelteren Stand —, wandert lieber KEINE Zahl mit als eine ohne
   * Erklaerung. Eine Punktzahl, die niemand begruenden kann, ist im Vertrieb
   * schaedlicher als gar keine.
   */
  const punktzahl = ziel.punktzahl_begruendung === null ? null : ziel.punktzahl;

  await tx.unsafe(
    `insert into lead
       (id, mandant_id, leadnummer, quelle, firma_name, betreff,
        bedarf_zusammenfassung, besitzer_benutzer_id,
        punktzahl, punktzahl_begruendung, punktzahl_berechnet_am, akteur_art)
     values ($1, $2, $3, 'akquise', $4, $5, $6, $7, $8, $9,
             case when $8::smallint is null then null else now() end, 'mensch')`,
    [
      leadId, mandantId, leadnummer, ziel.firmenname, betreff,
      zusammenfassung === '' ? null : zusammenfassung,
      eingabe.besitzerBenutzerId,
      punktzahl, ziel.punktzahl_begruendung,
    ],
  );

  /*
   * `richtung = 'intern'` und `zweck = 'intern'`.
   *
   * Nicht `ausgehend`: `kern.setze_erste_reaktion()` stempelt auf die erste
   * ausgehende Aktivität. Wäre diese Zeile ausgehend, wäre jeder übernommene
   * Lead in der Sekunde seiner Entstehung „beantwortet". Und nicht `werbung`:
   * hier ging keine Nachricht hinaus, hier hat jemand eine Notiz geschrieben.
   * Ein `zweck = 'werbung'` liefe zudem durch das UWG-Tor und würde — korrekt —
   * abgewiesen, weil kein Kontakt mit Rechtsgrundlage dahintersteht.
   */
  await tx.unsafe(
    `insert into lead_aktivitaet
       (mandant_id, lead_id, typ, richtung, zweck, kanal, betreff, inhalt,
        akteur_art, rechtsgrundlage_snapshot)
     values ($1, $2, 'system', 'intern', 'intern', 'portal', $3, $4, 'mensch', 'keine')`,
    [
      mandantId, leadId, 'Aus der Akquiseliste übernommen',
      `${ziel.firmenname}${ziel.ort === null ? '' : `, ${ziel.ort}`}. `
      + 'Recherchierte Firma ohne Ansprechpartner: für eine Ansprache muss zuerst '
      + 'ein Kontakt mit Rechtsgrundlage angelegt werden (§7 UWG).',
    ],
  );

  await tx.unsafe(
    `update akquise_ziel set status = 'uebernommen', lead_id = $3
      where mandant_id = $1 and id = $2`,
    [mandantId, eingabe.zielId, leadId],
  );

  return { leadId, leadnummer, firmenname: ziel.firmenname };
}
