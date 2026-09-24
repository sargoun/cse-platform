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
 * Wiedervorlage angelegt hat (D-640). Gibt es gar keinen Menschen an der
 * Zeile, bleibt der Anspruch stehen und die Zahl steht im Laufbericht — da
 * kann sich nichts mehr ändern, und ein Lauf alle fünfzehn Minuten auf
 * dieselbe Zeile wäre nur Lärm.
 *
 * **Empfänger ist nur, wer die Wiedervorlage lesen darf** (V-153, D-647).
 * Die Zeile nannte bisher jeden, der an ihr stand — auch ein stillgelegtes
 * Konto, einen Menschen ohne Mitgliedschaft oder ohne `crm.lesen` in dieser
 * Gesellschaft, und der Betreff ging trotzdem in Posteingang und E-Mail.
 * Gefragt wird jetzt `kern.traeger_des_rechts(mandant, 'crm.lesen')`: aktive
 * Menschenkonten, die das Recht in DIESEM Bereich halten (dieselbe Auflösung
 * wie `app.hat_recht`). Hält der Zuständige es nicht, geht die Erinnerung an
 * den, der die Wiedervorlage angelegt hat; hält es keiner von beiden, wird
 * die Zeile gar nicht erst beansprucht. Sie bleibt offen, bis wieder jemand
 * berechtigt ist — ein wieder aktiviertes Konto bekommt sie noch —, und
 * steht als `wartend` im Laufbericht. Vorher nahm der Lauf den Anspruch alle
 * fünfzehn Minuten und gab ihn wieder zurück, ohne Ende.
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
  /**
   * Das Konto wurde zwischen Auswahl und Zustellung stillgelegt — Anspruch
   * zurückgegeben. Die Auswahl nimmt nur berechtigte Empfänger; das hier ist
   * das Fenster dazwischen.
   */
  readonly ohneKonto: number;
  /** Weder zuständig noch angelegt von jemandem — Anspruch bleibt, gezählt. */
  readonly ohneEmpfaenger: number;
  /**
   * Fällig, aber weder der Zuständige noch der Anlegende darf sie lesen —
   * nicht beansprucht, sie wartet auf einen berechtigten Menschen (V-153).
   */
  readonly wartend: number;
}

interface FaelligeZeile {
  readonly id: string;
  readonly betreff: string;
  readonly empfaenger: string | null;
  /** `zustaendig` oder `angelegt` — worauf sich der Text der Meldung stützt. */
  readonly rolle: 'zustaendig' | 'angelegt' | null;
  readonly ohne_zustaendigen: boolean;
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
  /*
   * `berechtigt`: die aktiven Menschenkonten mit `crm.lesen` in diesem
   * Bereich (0149, security definer, für `cse_job` freigegeben). Beansprucht
   * wird eine Zeile nur, wenn einer der beiden Menschen an ihr darunter ist —
   * oder wenn gar keiner an ihr steht (D-640: gezählt, Anspruch bleibt).
   * `erinnert_am is null` steht in der Aktualisierung noch einmal: ein
   * zweiter Lauf, der auf dieselbe Zeile wartet, prüft sie nach dem Warten
   * neu und nimmt sie dann nicht mehr.
   */
  const faellige = await db.abfrage<FaelligeZeile>(
    `with berechtigt as (
       select kern.traeger_des_rechts(app.aktiver_mandant(), 'crm.lesen') as ids
     ), faellig as (
       select la.id,
              case when la.zustaendig_benutzer_id = any (b.ids) then la.zustaendig_benutzer_id
                   when la.benutzer_id = any (b.ids) then la.benutzer_id
              end as empfaenger,
              case when la.zustaendig_benutzer_id = any (b.ids) then 'zustaendig'
                   when la.benutzer_id = any (b.ids) then 'angelegt'
              end as rolle,
              (la.zustaendig_benutzer_id is null and la.benutzer_id is null) as niemand
         from lead_aktivitaet la cross join berechtigt b
        where la.mandant_id = app.aktiver_mandant()
          and la.faellig_am is not null
          and la.erinnerung_am is not null
          and la.erinnerung_am <= now()
          and la.erinnert_am is null
          and la.erledigt_am is null
     )
     update lead_aktivitaet la
        set erinnert_am = now()
       from faellig f
      where la.id = f.id
        and la.mandant_id = app.aktiver_mandant()
        and (f.empfaenger is not null or f.niemand)
        and la.erinnert_am is null
        and la.erledigt_am is null
      returning la.id, la.betreff, f.empfaenger::text as empfaenger, f.rolle,
                (la.zustaendig_benutzer_id is null) as ohne_zustaendigen,
                to_char(la.faellig_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
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
      daten: {
        betreff: z.betreff, faellig: z.faellig_text,
        // Der Text sagt, WARUM die Meldung an diesen Menschen geht (V-153).
        rolle: z.rolle ?? 'zustaendig',
        ohneZustaendigen: z.ohne_zustaendigen,
      },
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

  /*
   * Was fällig ist und liegen blieb, weil niemand Berechtigtes an der Zeile
   * steht — gezählt, nicht beansprucht (V-153). Nach der Aktualisierung
   * oben ist das genau der Rest mit `erinnert_am is null`.
   */
  const [rest] = await db.abfrage<{ n: number }>(
    `select count(*)::int as n from lead_aktivitaet
      where mandant_id = app.aktiver_mandant()
        and faellig_am is not null
        and erinnerung_am is not null
        and erinnerung_am <= now()
        and erinnert_am is null
        and erledigt_am is null`);

  return {
    faellig: faellige.length, zugestellt, ohneKonto, ohneEmpfaenger,
    wartend: (rest?.n ?? 0) - zurueck.length,
  };
}
