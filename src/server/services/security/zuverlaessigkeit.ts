/**
 * **Die Wiedervorlage der Zuverlässigkeitsüberprüfung** (V-320, O-140, SEC-02,
 * SEC-03, D-815).
 *
 * Sachkunde und Unterrichtung nach § 34a GewO sind unbefristet (O-140,
 * D-788); der einzige Anlass einer Nachprüfung ist die
 * Zuverlässigkeitsüberprüfung der Behörde, spätestens nach fünf Jahren
 * (§ 34a Abs. 1 GewO, Bewacherregister). `bewacher_eintrag` trägt
 * `letzte_pruefung_am` und `naechste_pruefung_am` seit 0031 — gelesen hat sie
 * kein Wächter.
 *
 * **Gespeichert wird nur, was ein Mensch einträgt.** Fehlt die nächste
 * Prüfung, leitet `app.bewacher_naechste_pruefung` (0511) sie beim Lesen aus
 * der letzten ab. Ein Voreinstellungswert in der Zeile sähe aus wie eine
 * Mitteilung der Behörde; beim Lesen abgeleitet bleibt er als solcher
 * erkennbar, und die Registerseite sagt es dazu.
 *
 * **Wer es erfährt:** in jeder Gesellschaft, in der die Person aktiv
 * beschäftigt ist und Security gebucht hat, die Mitglieder mit
 * `personal.bewacher_verwalten` — das Recht der Registerseite, auf die die
 * Meldung zeigt (NOT-03, `kern.bewacher_pruefung_empfaenger`). Einmal je
 * Konto und Wiedervorlagedatum (`waechter_meldung`, die Lage ist das Datum):
 * trägt jemand eine neue Prüfung ein, darf das neue Datum wieder melden.
 */
import { erzeuge, sicherRegistriert, type ArtDefinition } from '../../benachrichtigung/registry.js';
import { stelleZuAnKonto, type Abfrage } from '../../benachrichtigung/ablage.js';
import { modulAktiv } from '../../registry/modul.js';
import { gibQuittungZurueck, quittiere } from '../waechter/dienstplan.js';
import { BEWACHER_VORWARNUNG_TAGE, ZUVERLAESSIGKEIT_JAHRE } from './bewacherregister.js';

/**
 * Der Vorlauf der Wiedervorlage: derselbe wie für eine ablaufende
 * Bewacher-Erlaubnis (`BEWACHER_VORWARNUNG_TAGE`, O-707, 60 Tage) — zwei
 * Fristen am selben Eintrag, eine Zahl.
 *
 * TODO(client, O-707): Voreinstellung — 60 Tage Vorlauf auch für die
 * Zuverlässigkeitsüberprüfung. D-783, D-815.
 */
export const UEBERPRUEFUNG_VORLAUF_TAGE = BEWACHER_VORWARNUNG_TAGE;

const PERSONAL = 'personal';
/** Zusammengesetzt, aus demselben Grund wie die übrigen Arten (Katalogscanner). */
export const ART_UEBERPRUEFUNG_FAELLIG = `${PERSONAL}.bewacher_pruefung_faellig`;
/** Der Schlüssel der Wache in `waechter_meldung` (0149). */
export const WAECHTER_UEBERPRUEFUNG = 'bewacher_pruefung';

/**
 * **Deutsch, an die Verwaltung.** Die Meldung nennt den Menschen, die
 * Bewacher-ID und das Datum — und ob das Datum eingetragen oder abgeleitet
 * ist. Sie behauptet nicht, die Behörde habe etwas angekündigt: das Register
 * ist nicht verbunden (O-40).
 */
function ueberpruefungFaellig(): ArtDefinition {
  return ({
    schluessel: ART_UEBERPRUEFUNG_FAELLIG,
    titel: (k) => `Zuverlässigkeitsüberprüfung fällig: ${String(k.daten['person'] ?? 'unbekannt')}`,
    text: (k) => {
      const datum = String(k.daten['faellig'] ?? '?');
      const abgeleitet = k.daten['abgeleitet'] === true;
      return `${String(k.daten['person'] ?? 'Eine Beschäftigte')} (Bewacher-ID `
        + `${String(k.daten['bewacherId'] ?? '?')}): die Zuverlässigkeitsüberprüfung nach `
        + `§ 34a GewO ist am ${datum} fällig — `
        + (abgeleitet
          ? `abgeleitet, ${String(ZUVERLAESSIGKEIT_JAHRE)} Jahre nach der letzten eingetragenen `
            + 'Prüfung (Voreinstellung). '
          : 'so eingetragen. ')
        + 'Bitte den Stand im Bewacherregister nachsehen und die Prüfung eintragen; die '
        + 'Plattform ist mit dem Register nicht verbunden.';
    },
    ziel: (k) => (typeof k.mandantSlug === 'string' && k.mandantSlug !== ''
      ? `/portal/${k.mandantSlug}/security/bewacherregister` : null),
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: true,
  });
}

/** Idempotent (D-493) — der Bootstrap läuft im Test mehrfach. */
export function registriereZuverlaessigkeitArten(): readonly ArtDefinition[] {
  return sicherRegistriert([ueberpruefungFaellig()]);
}

export interface UeberpruefungBericht {
  /** Lebende Einträge, deren Wiedervorlage im Vorlauf liegt oder überschritten ist. */
  readonly faellig: number;
  readonly zugestellt: number;
  /** Fällige Einträge, für die keine Gesellschaft mit Security und Empfänger da war. */
  readonly ohneEmpfaenger: number;
}

/**
 * Der Lauf: fällige Wiedervorlagen finden und je Gesellschaft melden.
 *
 * `heute` ist der Berliner Tag aus der Datenbank (der Job fragt ihn,
 * Invariante 5). Fällig ist, was bis `heute + UEBERPRUEFUNG_VORLAUF_TAGE`
 * ansteht — auch Überschrittenes: eine versäumte Wiedervorlage verschwindet
 * nicht, weil ihr Datum vorbei ist.
 */
export async function meldeFaelligeUeberpruefungen(
  db: Abfrage, heute: string,
): Promise<UeberpruefungBericht> {
  registriereZuverlaessigkeitArten();
  const eintraege = (await db.unsafe(
    `select b.id, b.person_id, b.bewacher_id,
            (p.vorname || ' ' || p.nachname) as person,
            to_char(app.bewacher_naechste_pruefung(
                      b.letzte_pruefung_am, b.naechste_pruefung_am, $2::int),
                    'DD.MM.YYYY') as faellig,
            to_char(app.bewacher_naechste_pruefung(
                      b.letzte_pruefung_am, b.naechste_pruefung_am, $2::int),
                    'YYYY-MM-DD') as kennung,
            (b.naechste_pruefung_am is null) as abgeleitet
       from bewacher_eintrag b
       join person p on p.id = b.person_id
      where b.erloschen_am is null
        and app.bewacher_naechste_pruefung(
              b.letzte_pruefung_am, b.naechste_pruefung_am, $2::int)
            <= $1::date + $3::int
      order by kennung, b.id`,
    [heute, ZUVERLAESSIGKEIT_JAHRE, UEBERPRUEFUNG_VORLAUF_TAGE],
  )) as readonly {
    id: string; person_id: string; bewacher_id: string; person: string;
    faellig: string; kennung: string; abgeleitet: boolean;
  }[];

  let zugestellt = 0;
  let ohneEmpfaenger = 0;
  for (const e of eintraege) {
    const empfaenger = (await db.unsafe(
      `select mandant_id, slug, module, module_gepflegt, benutzer_id
         from kern.bewacher_pruefung_empfaenger($1::uuid)`, [e.person_id],
    )) as readonly {
      mandant_id: string; slug: string; module: string[] | null;
      module_gepflegt: boolean; benutzer_id: string;
    }[];
    /* Dieselbe Regel wie die Registerseite (`securityGebucht`): ohne Security
       gibt es dort kein Register, also auch keine Meldung, die darauf zeigt. */
    const mitSecurity = empfaenger.filter((z) => modulAktiv(
      { module: z.module ?? [], gepflegt: z.module_gepflegt }, 'security.lesen'));
    let erreicht = 0;
    for (const z of mitSecurity) {
      const quittung = await quittiere(db, {
        mandantId: z.mandant_id, waechter: WAECHTER_UEBERPRUEFUNG,
        objektTyp: 'bewacher_eintrag', objektId: e.id,
        empfaengerId: z.benutzer_id, kennung: e.kennung,
      });
      if (quittung === null) { erreicht += 1; continue; }   // schon gemeldet
      const benachrichtigung = erzeuge(ART_UEBERPRUEFUNG_FAELLIG, {
        mandantId: z.mandant_id, mandantSlug: z.slug,
        objektTyp: 'bewacher_eintrag', objektId: e.id,
        daten: {
          person: e.person, bewacherId: e.bewacher_id, faellig: e.faellig,
          abgeleitet: e.abgeleitet,
        },
      });
      const r = await stelleZuAnKonto(db, [{
        benachrichtigung, benutzerId: z.benutzer_id,
        objektTyp: 'bewacher_eintrag', objektId: e.id,
      }]);
      if (r.zugestellt === 0) {
        await gibQuittungZurueck(db, quittung);
        continue;
      }
      zugestellt += r.zugestellt;
      erreicht += 1;
    }
    if (erreicht === 0) ohneEmpfaenger += 1;
  }
  return { faellig: eintraege.length, zugestellt, ohneEmpfaenger };
}
