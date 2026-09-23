import { registriere, type JobDefinition } from './registry.js';
import { alsJobSitzung, type JobAbfrage, type JobVerbindung } from './sitzung.js';
import { erzeuge } from '../benachrichtigung/registry.js';
import { stelleZuAnKonto } from '../benachrichtigung/ablage.js';
import {
  ART_WIEDERVORLAGE_ERINNERUNG, registriereWiedervorlageArten,
} from '../services/crm/benachrichtigung.js';

/**
 * `wiedervorlage_erinnerung` — die Erinnerung, die jemand verlangt hat
 * (V-146, CRM-04, NOT-01, D-640).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lead- und Kontaktblatt bieten das Feld „Erinnerung", `legeWiedervorlageAn`
 * schreibt `erinnerung_am`, `verschiebe` führt es mit — und kein Lauf, keine
 * Meldungsart und kein Kalenderalarm las den Wert. Eine Erinnerung, die
 * gespeichert und nie zugestellt wird, ist schlimmer als keine: wer sie
 * einträgt, verlässt sich darauf und sieht nicht mehr in die Liste.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Je Mandant, als `cse_job`, mit gebundenem Mandanten.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `alsJobSitzung` setzt `set local role cse_job` und `app.aktiver_mandant()`;
 * die Policies aus 0405 hängen genau daran. Ein übergreifender Lauf hätte
 * eine Mandantengrenze überschritten, ohne dass es jemand entschieden hätte.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Erst der Anspruch, dann die Zustellung — in EINER Transaktion.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Das `update … set erinnert_am = now() … returning` IST die Auswahl. Zwei
 * gleichzeitige Läufe sperren dieselbe Zeile; der zweite wartet, sieht danach
 * `erinnert_am is not null` und nimmt sie nicht mehr. Scheitert die
 * Zustellung mit einem Fehler, rollt die Transaktion den Anspruch mit
 * zurück, und der nächste Lauf versucht es erneut.
 *
 * Wer bekommt sie? Der Zuständige; ist keiner eingetragen, wer die
 * Wiedervorlage angelegt hat (D-640). Hat dieser Mensch kein aktives Konto,
 * wird der Anspruch ZURÜCKGEGEBEN — dieselbe Regel wie beim Nachtrag
 * (`nachtragWache.ts`): ein wieder aktiviertes Konto soll die Erinnerung noch
 * bekommen, statt dass sie still als zugestellt gilt. Gibt es gar keinen
 * Menschen an der Zeile, bleibt der Anspruch stehen und die Zahl steht im
 * Laufbericht — da kann sich nichts mehr ändern, und ein Lauf alle fünfzehn
 * Minuten auf dieselbe Zeile wäre nur Lärm.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Alle fünfzehn Minuten, nicht stündlich.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Das Formular nimmt eine Uhrzeit auf die Minute. Ein stündlicher Lauf
 * brächte die Erinnerung für 08:05 um 09:00 — nach dem Termin, an den sie
 * erinnern soll, wenn beide dicht beieinanderliegen. Fünfzehn Minuten sind
 * der Abstand, den ein Mensch einem „erinnere mich" zugesteht; der Lauf
 * kostet je Mandant eine Anweisung auf einem Teilindex (0405).
 */

/** Was ein Lauf je Mandant berichtet. */
export interface ErinnerungsBefund {
  /** Wiedervorlagen, deren Erinnerungszeit erreicht war und die dieser Lauf nahm. */
  readonly faellig: number;
  readonly zugestellt: number;
  /** Der Empfänger hat kein aktives Konto — Anspruch zurückgegeben. */
  readonly ohneKonto: number;
  /** Weder zuständig noch angelegt von jemandem — Anspruch bleibt, gezählt. */
  readonly ohneEmpfaenger: number;
}

interface FaelligeZeile {
  readonly id: string;
  readonly betreff: string;
  readonly empfaenger: string | null;
  readonly faellig_text: string;
}

export function registriereWiedervorlageErinnerung(sql: JobVerbindung): JobDefinition {
  registriereWiedervorlageArten();
  return registriere({
    schluessel: 'wiedervorlage_erinnerung',
    bezeichnung: 'Erinnerungen an Wiedervorlagen zustellen (CRM-04)',
    zeitplan: '*/15 * * * *',
    bereich: 'je_mandant',
    // Ein Netzfehler ist kein Grund aufzugeben; der Anspruch rollt mit zurück.
    versuche: 2,
    ausfuehren: async (kontext): Promise<Record<string, unknown>> => {
      if (kontext.mandantId === null) {
        throw new Error('wiedervorlage_erinnerung ist je_mandant und braucht einen Mandanten.');
      }
      return { ...(await laufe(sql, kontext.mandantId)) };
    },
  });
}

/** Der Lauf selbst — ohne Registrierung, damit der Test ihn direkt aufruft. */
export async function laufe(
  sql: JobVerbindung, mandantId: string,
): Promise<ErinnerungsBefund> {
  registriereWiedervorlageArten();
  /*
   * `nurLesen: false`, und geschrieben wird genau zweierlei: `erinnert_am`
   * auf `lead_aktivitaet` (Spaltenrecht aus 0405) und die Zeile im
   * Posteingang (`benachrichtigung`, 0099).
   */
  return alsJobSitzung(sql, mandantId, (db) => erinnere(db), { nurLesen: false });
}

async function erinnere(db: JobAbfrage): Promise<ErinnerungsBefund> {
  /* Kennung und Slug aus der SITZUNG — der Slug baut das Ziel (NOT-03). */
  const [m] = await db.abfrage<{ id: string; slug: string }>(
    `select id::text as id, slug from mandant where id = app.aktiver_mandant()`);
  if (m === undefined) {
    throw new Error('wiedervorlage_erinnerung: kein gebundener Mandant — der Lauf liefe ins Leere.');
  }
  /*
   * **Die Uhr ist die der Datenbank** (Invariante 5): `now()` ist derselbe
   * Zeitpunkt, gegen den `erinnerung_am` gespeichert wurde — als Berliner
   * Wanduhr gelesen und als Zeitpunkt abgelegt (`legeWiedervorlageAn`).
   */
  const faellige = await db.abfrage<FaelligeZeile>(
    `update lead_aktivitaet
        set erinnert_am = now()
      where mandant_id = app.aktiver_mandant()
        and faellig_am is not null
        and erinnerung_am is not null
        and erinnerung_am <= now()
        and erinnert_am is null
        and erledigt_am is null
      returning id, betreff,
                coalesce(zustaendig_benutzer_id, benutzer_id)::text as empfaenger,
                to_char(faellig_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as faellig_text`);

  const zustellung = { unsafe: (s: string, w?: readonly unknown[]) => db.abfrage(s, w) };
  let zugestellt = 0;
  let ohneKonto = 0;
  let ohneEmpfaenger = 0;
  const zurueck: string[] = [];

  for (const z of faellige) {
    if (z.empfaenger === null) { ohneEmpfaenger += 1; continue; }
    const benachrichtigung = erzeuge(ART_WIEDERVORLAGE_ERINNERUNG, {
      mandantId: m.id,
      mandantSlug: m.slug,
      objektTyp: 'lead_aktivitaet',
      objektId: z.id,
      daten: { betreff: z.betreff, faellig: z.faellig_text },
    });
    const e = await stelleZuAnKonto(zustellung, [{
      benachrichtigung, benutzerId: z.empfaenger,
      objektTyp: 'lead_aktivitaet', objektId: z.id,
    }]);
    if (e.zugestellt === 0) { ohneKonto += 1; zurueck.push(z.id); continue; }
    zugestellt += e.zugestellt;
  }

  if (zurueck.length > 0) {
    await db.abfrage(
      `update lead_aktivitaet set erinnert_am = null
        where mandant_id = app.aktiver_mandant() and id = any($1::uuid[])`,
      [zurueck]);
  }

  return { faellig: faellige.length, zugestellt, ohneKonto, ohneEmpfaenger };
}
