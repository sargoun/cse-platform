import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { erzeuge } from '../../benachrichtigung/registry.js';
import { ART_PLAN_VEROEFFENTLICHT, registriereDienstplanArten } from './benachrichtigung.js';

/**
 * Den Dienstplan eines Zeitraums bekanntgeben (TIM-01, NOT-01).
 *
 * ## Was hier bewusst NICHT entschieden wird
 *
 * `drizzle/0028_dienstplan.sql` und `04-PLANUNG-ZEIT.md` §224 sagen es
 * ausdruecklich (K-17): `einsatz_status` kennt kein `veroeffentlicht`, weil
 * `dienstplan.veroeffentlichen` ein Recht auf eine HANDLUNG ist. Einen
 * Veroeffentlichungsablauf zu modellieren, den die SPEC nicht beschreibt,
 * waere eine erfundene Geschaeftsregel. Vier Fragen sind offen, und dieser
 * Dienst beantwortet keine davon:
 *
 *  - **O-710** — welcher Zeitraum veroeffentlicht wird (Woche, Monat, freies
 *    Fenster). Die Vorgabe „kommende Woche" ist eine Oberflaechenvorgabe und
 *    keine Regel; `umfang` traegt den Platzhalter.
 *  - **O-711** — wer benachrichtigt wird. Heute: wer im Fenster eine lebende
 *    Einteilung hat. Wer eine GESTRICHENE Schicht hatte, bekommt nichts, und
 *    das ist der Fall, der am meisten wehtut — er steht deshalb in der
 *    Vorschau sichtbar daneben und nicht in einer Annahme.
 *  - **O-712** — was eine Aenderung nach der Bekanntgabe bedeutet. Heute:
 *    nichts von selbst. Eine zweite Bekanntgabe ist eine zweite Zeile.
 *  - **O-713** — ob eine bekanntgegebene Schicht gegen stille Aenderung
 *    geschuetzt ist. Heute nicht, und zwar nicht aus Versehen.
 *
 * ## Warum der Schreibweg durch einen Definer geht
 *
 * `cse_app` hat auf `benachrichtigung` **kein Tabellenrecht INSERT** — ein
 * `insert` aus einer Route bricht mit `permission denied` ab. Der einzige Weg
 * ist `app.dienstplan_veroeffentlichung_anlegen` (0266), und der stellt genau
 * die eine Art `dienstplan.plan_veroeffentlicht` zu. Titel, Text und Ziel
 * kommen aus dem Register (`erzeuge`), weil NOT-03 dort durchgesetzt wird:
 * eine Meldung ohne aufloesbares Ziel scheitert bei der ERZEUGUNG und nicht
 * beim Klick.
 *
 * ## Rechnen
 *
 * Gezaehlt wird in SQL, nicht in TypeScript und nie von einem Modell
 * (Invariante 6): Zahl der Schichten, Zahl der unbesetzten, Zahl der offenen
 * und der blockierenden Konflikte. Die Zahlen, die in der Vorschau stehen,
 * sind dieselben, die in der Zeile landen — eine zweite Abfrage waere eine
 * zweite Wahrheit.
 *
 * Das Fenster ist ein Paar BERLINER Kalendertage, beide Grenzen inklusiv
 * (K-11, Invariante 2). Aufgeloest wird es mit
 * `($1::date)::timestamp at time zone 'Europe/Berlin'` — ohne `::timestamp`
 * castet Postgres das Datum nach `timestamptz` und rechnet es DANN nach
 * Berlin; das Fenster begaenne im Sommer vier Stunden zu spaet, und genau die
 * Nachtschicht fehlte.
 */

/** Die drei kandidierenden Zeitraumarten — Platzhalter, O-710. */
export type Umfang = 'woche' | 'monat' | 'freier_zeitraum';

export const UMFAENGE: readonly Umfang[] = ['woche', 'monat', 'freier_zeitraum'];

export const UMFANG_TEXT: Readonly<Record<Umfang, string>> = {
  woche: 'Kalenderwoche',
  monat: 'Kalendermonat',
  freier_zeitraum: 'freier Zeitraum',
};

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
/** Hoechstens ein Jahr — dieselbe Wache wie `dv_zeitraum_begrenzt` in 0265. */
const MAX_TAGE = 366;

export class VeroeffentlichungFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'VeroeffentlichungFehler';
  }
}

export interface VorschauZeile {
  readonly personId: string;
  readonly person: string;
  readonly schichten: number;
  /** Fertig beschriftet, Europe/Berlin — genau die Zeilen, die die Meldung nennt. */
  readonly fenster: readonly string[];
  /** Hat dieser Mensch einen aktiven Zugang? Ohne ihn erreicht ihn keine Meldung (D-09). */
  readonly hatZugang: boolean;
  /**
   * `person.sprache` — die Sprache, in der SEINE Meldung entsteht (V-102).
   *
   * Sie steht auf der Vorschauzeile und nicht in einer zweiten Abfrage, weil
   * die Zeile ohnehin schon `join person` traegt: eine Meldung je Mensch
   * heisst eine Sprache je Mensch, und zwei Abfragen koennten auseinander
   * laufen.
   */
  readonly sprache: string | null;
}

export interface Vorschau {
  readonly von: string;
  readonly bis: string;
  readonly schichten: number;
  readonly unbesetzt: number;
  readonly konflikteOffen: number;
  readonly konflikteBlockierend: number;
  readonly personen: readonly VorschauZeile[];
  /** Zahl der Menschen ohne Zugang — die Meldung erreicht sie nicht. */
  readonly ohneZugang: number;
}

/** Ein Berliner Kalendertag `JJJJ-MM-TT` als `TT.MM.JJJJ` — reine Zeichenarbeit. */
export function deutschesDatum(iso: string): string {
  if (!DATUM.test(iso)) return iso;
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** „21.09.2026 bis 27.09.2026" — der Text, der in Titel und Meldung steht. */
export function zeitraumText(von: string, bis: string): string {
  return von === bis
    ? deutschesDatum(von)
    : `${deutschesDatum(von)} bis ${deutschesDatum(bis)}`;
}

/**
 * Prueft das Fenster — und verbiegt es nicht.
 *
 * Ein leeres oder verkehrtes Fenster ist kein „alles veroeffentlichen": es ist
 * eine Eingabe, die niemand so gemeint hat.
 */
export function pruefeZeitraum(von: string, bis: string, umfang: string): Umfang {
  if (!DATUM.test(von) || !DATUM.test(bis)) {
    throw new VeroeffentlichungFehler('Der Zeitraum besteht aus zwei Kalendertagen JJJJ-MM-TT.');
  }
  if (bis < von) {
    throw new VeroeffentlichungFehler('Das Ende des Zeitraums liegt vor seinem Anfang.');
  }
  const tage = Math.round(
    (Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000,
  );
  if (tage > MAX_TAGE) {
    throw new VeroeffentlichungFehler(
      'Der Zeitraum umfasst mehr als ein Jahr. Eine Bekanntgabe über zehn Jahre wäre '
      + 'nicht wiedergutzumachen — sie erzeugt eine Meldung je Person.');
  }
  if (!(UMFAENGE as readonly string[]).includes(umfang)) {
    throw new VeroeffentlichungFehler('Die Zeitraumart ist Woche, Monat oder freier Zeitraum.');
  }
  return umfang as Umfang;
}

interface RohZahlen {
  schichten: number;
  unbesetzt: number;
  konflikte_offen: number;
  konflikte_blockierend: number;
}

interface RohPerson {
  person_id: string;
  person: string;
  schichten: number;
  fenster: readonly string[];
  hat_zugang: boolean;
  sprache: string | null;
}

/**
 * Was hinausginge — und an wen.
 *
 * Diese Funktion SCHREIBT NICHTS. Sie ist die Vorschau der Seite und
 * gleichzeitig die Zahlenquelle der Bekanntgabe: dieselbe Abfrage, damit
 * Vorschau und Beleg nicht auseinanderlaufen koennen.
 */
export async function vorschau(
  kontext: LeseKontext, von: string, bis: string,
): Promise<Vorschau> {
  if (!DATUM.test(von) || !DATUM.test(bis) || bis < von) {
    throw new VeroeffentlichungFehler('Der Zeitraum ist leer oder verkehrt.');
  }

  const [zahlen] = await kontext.abfrage<RohZahlen>(
    `with fenster as (
       select ($1::date)::timestamp at time zone 'Europe/Berlin'       as von,
              (($2::date) + 1)::timestamp at time zone 'Europe/Berlin' as bis
     ),
     schichten as (
       select e.id, e.besetzt_anzahl, e.soll_besetzung, e.min_besetzung,
              (select count(*) from einsatz_zuordnung z
                where z.einsatz_id = e.id and z.entfernt_am is null
                  and z.status = 'zugesagt')::int as zugesagt
         from einsatz e
         cross join fenster f
        where e.storniert_am is null
          and e.status in ('geplant','laufend')
          and e.beginn_zeitpunkt >= f.von
          and e.beginn_zeitpunkt <  f.bis
     )
     select (select count(*) from schichten)::int as schichten,
            (select count(*) from schichten s
              where s.besetzt_anzahl < s.soll_besetzung
                 or s.zugesagt < s.min_besetzung)::int as unbesetzt,
            (select count(*) from planungs_konflikt k, fenster f
              where k.status = 'offen' and k.hinfaellig_am is null
                and k.zeitraum_beginn >= f.von
                and k.zeitraum_beginn <  f.bis)::int as konflikte_offen,
            (select count(*) from planungs_konflikt k, fenster f
              where k.status = 'offen' and k.hinfaellig_am is null and k.blockiert
                and k.zeitraum_beginn >= f.von
                and k.zeitraum_beginn <  f.bis)::int as konflikte_blockierend`,
    [von, bis],
  );

  const personen = await kontext.abfrage<RohPerson>(
    /*
     * Je Person EINE Zeile, und darin ihre Fenster als Text — genau die
     * Aufzaehlung, die in ihrer Meldung stuende. Sortiert nach Zeit, nicht
     * nach Kennung: ein Plan liest sich von vorn.
     *
     * `status <> 'abgesagt'` und `entfernt_am is null`: wer abgesagt hat, ist
     * nicht eingeteilt, und wer entfernt wurde, war es nie. Ob eine Absage
     * die Besetzung mindert, ist O-170 — fuer die Frage „wer bekommt eine
     * Meldung" ist die Absage aber eindeutig.
     */
    `with fenster as (
       select ($1::date)::timestamp at time zone 'Europe/Berlin'       as von,
              (($2::date) + 1)::timestamp at time zone 'Europe/Berlin' as bis
     ),
     eingeteilt as (
       select z.person_id, e.beginn_zeitpunkt,
              to_char((e.beginn_zeitpunkt at time zone 'Europe/Berlin'), 'DD.MM. HH24:MI')
                || ' – '
                || to_char((e.ende_zeitpunkt at time zone 'Europe/Berlin'), 'HH24:MI')
                || ' · ' || o.bezeichnung as zeile
         from einsatz_zuordnung z
         join einsatz e on e.mandant_id = z.mandant_id and e.id = z.einsatz_id
         join objekt  o on o.mandant_id = e.mandant_id and o.id = e.objekt_id
         cross join fenster f
        where z.entfernt_am is null
          and z.status <> 'abgesagt'
          and e.storniert_am is null
          and e.status in ('geplant','laufend')
          and e.beginn_zeitpunkt >= f.von
          and e.beginn_zeitpunkt <  f.bis
     )
     select ei.person_id,
            (p.vorname || ' ' || p.nachname) as person,
            p.sprache,
            count(*)::int as schichten,
            array_agg(ei.zeile order by ei.beginn_zeitpunkt) as fenster,
            exists (select 1 from benutzer b
                     where b.person_id = ei.person_id and b.status = 'aktiv'
                       and b.deaktiviert_am is null) as hat_zugang
       from eingeteilt ei
       join person p on p.id = ei.person_id
      group by ei.person_id, p.vorname, p.nachname, p.sprache
      order by p.nachname, p.vorname`,
    [von, bis],
  );

  return {
    von,
    bis,
    schichten: Number(zahlen?.schichten ?? 0),
    unbesetzt: Number(zahlen?.unbesetzt ?? 0),
    konflikteOffen: Number(zahlen?.konflikte_offen ?? 0),
    konflikteBlockierend: Number(zahlen?.konflikte_blockierend ?? 0),
    personen: personen.map((p) => ({
      personId: p.person_id,
      person: p.person,
      schichten: Number(p.schichten),
      fenster: p.fenster,
      hatZugang: p.hat_zugang === true,
      sprache: p.sprache,
    })),
    ohneZugang: personen.filter((p) => p.hat_zugang !== true).length,
  };
}

export interface VeroeffentlichungEingabe {
  readonly von: string;
  readonly bis: string;
  readonly umfang: string;
  readonly notiz?: string | null;
}

export interface VeroeffentlichungErgebnis {
  readonly id: string;
  readonly empfaenger: number;
  readonly ohneZugang: number;
  readonly vorschau: Vorschau;
}

/**
 * Bekanntgeben — der eine Schreibweg.
 *
 * **Blockierende Konflikte halten die Bekanntgabe NICHT auf.** Ob sie das
 * sollten, ist Teil von O-712 und hier nicht entschieden: eine Sperre, die
 * niemand bestellt hat, liesse die Disposition am Einsatztag stehen. Die
 * Zahl steht in der Vorschau obenan und wird im Beleg mitgeschrieben — wer
 * trotz drei Sperren veroeffentlicht hat, ist damit nachweisbar.
 */
export async function veroeffentliche(
  kontext: SchreibKontext, eingabe: VeroeffentlichungEingabe,
): Promise<VeroeffentlichungErgebnis> {
  const umfang = pruefeZeitraum(eingabe.von, eingabe.bis, eingabe.umfang);

  /**
   * **Erst die LESERECHTE, dann der Beleg.**
   *
   * Der Definer in 0266 prueft `dienstplan.veroeffentlichen` — und nur das.
   * Die Zahlen daneben kommen aber aus Tabellen mit eigenen Policies:
   * `einsatz`, `einsatz_zuordnung` und `planungs_konflikt` verlangen
   * `dienstplan.lesen`, der `join objekt` in der Empfaengerabfrage verlangt
   * `objekt.lesen`. Fehlt eines davon, liefert `vorschau()` lauter Nullen und
   * eine leere Empfaengerliste — nicht weil nichts geplant ist, sondern weil
   * die RLS gerade aufgeraeumt hat.
   *
   * Aus so einer Abfrage darf kein Beleg entstehen. `dienstplan_veroeffentlichung`
   * ist laut 0265 genau die Zeile, die im Streit zaehlt („der Zeitraum wurde an
   * diesem Zeitpunkt bekanntgegeben"); mit `schichten = 0` und
   * `empfaenger = 0` behauptete sie eine Bekanntgabe, die niemanden erreicht
   * hat, und der Bildschirm sagte daneben in gruen „Veröffentlicht.
   * 0 Person(en)".
   */
  const [sicht] = await kontext.abfrage<{ plan: boolean; objekt: boolean }>(
    `select app.hat_recht('dienstplan.lesen', app.aktiver_mandant()) as plan,
            app.hat_recht('objekt.lesen',     app.aktiver_mandant()) as objekt`);
  if (sicht?.plan !== true || sicht.objekt !== true) {
    throw new VeroeffentlichungFehler(
      'Zum Veröffentlichen fehlt ein Leserecht (dienstplan.lesen, objekt.lesen). '
      + 'Ohne es wäre der Vorgang ein Beleg über eine leere Abfrage und nicht über '
      + 'einen leeren Plan.');
  }

  const bild = await vorschau(kontext, eingabe.von, eingabe.bis);

  /*
   * Ein Fenster ohne Schicht UND ohne eingeteilten Menschen ist nichts, was
   * man bekanntgeben kann. Das ist keine erfundene Geschaeftsregel, sondern
   * die Weigerung, einen Beleg ueber nichts zu schreiben: welche Zeitraeume
   * veroeffentlicht werden, bleibt O-710.
   */
  if (bild.schichten === 0 && bild.personen.length === 0) {
    throw new VeroeffentlichungFehler(
      'In diesem Zeitraum steht keine Schicht und ist niemand eingeteilt — '
      + 'eine Bekanntgabe darüber wäre ein Beleg über nichts.');
  }

  // Idempotent (D-493). Ohne diesen Aufruf waere `erzeuge` von der Frage
  // abhaengig, ob in DIESER Anfrage schon irgendetwas den Bootstrap gerufen
  // hat — und „unbekannte Benachrichtigungsart" ist der Fehler, der nur dann
  // auftritt, wenn niemand hinsieht.
  registriereDienstplanArten();

  /**
   * Der Name der Gesellschaft steht in der Meldung, und er kommt aus der
   * DATENBANK — nicht aus einem Formularfeld.
   *
   * Ein doppelt Beschaeftigter (D-09) bekommt Meldungen aus zwei
   * Gesellschaften in EINEN Posteingang (EMP-14); ohne den Namen liest er
   * zwei Zeilen, die gleich aussehen und verschiedene Plaene meinen. Aus dem
   * Formular genommen waere er ein Wert, den der Klient bestimmt — in einer
   * Nachricht, die im Namen des Hauses hinausgeht.
   */
  const [g] = await kontext.abfrage<{ name: string }>(
    `select name from mandant where id = app.aktiver_mandant()`);
  const zeitraum = zeitraumText(eingabe.von, eingabe.bis);
  const empfaenger = bild.personen.map((p) => {
    const b = erzeuge(ART_PLAN_VEROEFFENTLICHT, {
      mandantId: kontext.aktiverMandantId,
      objektTyp: 'dienstplan_veroeffentlichung',
      objektId: '',
      /* Die Sprache der EMPFAENGERIN (V-102, O-889) — je Zeile eine andere:
         eine Kolonne aus vier Laendern bekommt vier Fassungen derselben
         Bekanntgabe, und jede liest ihre. */
      sprache: p.sprache,
      daten: {
        /* Beide Tage EINZELN: die Fügung („bis") ist ein deutsches Wort und
           gehört in die Sprachtabelle, nicht in den Wert. `zeitraum` bleibt
           daneben stehen — als Rückfall und für den Beleg. */
        von: deutschesDatum(eingabe.von),
        bis: deutschesDatum(eingabe.bis),
        zeitraum,
        schichten: p.schichten,
        gesellschaft: g?.name ?? '',
      },
    });
    return { person_id: p.personId, titel: b.titel, text: b.text, ziel: b.ziel };
  });

  const [ergebnis] = await kontext.schreibe<{
    id: string; empfaenger_anzahl: number; ohne_zugang_anzahl: number;
  }>(
    `select id, empfaenger_anzahl, ohne_zugang_anzahl
       from app.dienstplan_veroeffentlichung_anlegen(
              $1::date, $2::date, $3, $4::integer, $5::integer, $6::integer, $7::integer,
              $8::jsonb, $9, $10, $11::jsonb)`,
    [
      eingabe.von, eingabe.bis, umfang,
      bild.schichten, bild.unbesetzt, bild.konflikteOffen, bild.konflikteBlockierend,
      /* Das OBJEKT, nicht sein JSON-Text (D-467): `JSON.stringify` in einem
         `::jsonb`-Parameter legt eine JSON-ZEICHENKETTE in die Spalte, und
         jeder spaetere `->>`-Zugriff greift ins Leere. */
      {
        abgrenzung: 'lebende Einteilung im Fenster, Absagen ausgenommen (O-711)',
        personen: bild.personen.length,
        ohneZugang: bild.ohneZugang,
      },
      eingabe.notiz ?? null,
      ART_PLAN_VEROEFFENTLICHT,
      empfaenger,
    ],
  );
  if (ergebnis === undefined) {
    throw new Error('Die Veröffentlichung wurde nicht geschrieben.');
  }

  return {
    id: ergebnis.id,
    empfaenger: Number(ergebnis.empfaenger_anzahl),
    ohneZugang: Number(ergebnis.ohne_zugang_anzahl),
    vorschau: bild,
  };
}

export interface VorgangZeile {
  readonly id: string;
  readonly von: string;
  readonly bis: string;
  readonly umfang: Umfang;
  readonly schichten: number;
  readonly unbesetzt: number;
  readonly konflikteOffen: number;
  readonly konflikteBlockierend: number;
  readonly empfaenger: number;
  readonly ohneZugang: number;
  readonly notiz: string | null;
  readonly amLokal: string;
  readonly von_wem: string | null;
}

/** Die letzten Bekanntgaben — der Beleg, den die Seite zeigt. */
export async function letzteVorgaenge(
  kontext: LeseKontext, grenze = 10,
): Promise<readonly VorgangZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; von: string; bis: string; umfang: Umfang;
    schichten_anzahl: number; unbesetzt_anzahl: number;
    konflikte_offen: number; konflikte_blockierend: number;
    empfaenger_anzahl: number; ohne_zugang_anzahl: number;
    notiz: string | null; am_lokal: string; von_wem: string | null;
  }>(
    `select v.id,
            to_char(v.zeitraum_von, 'YYYY-MM-DD') as von,
            to_char(v.zeitraum_bis, 'YYYY-MM-DD') as bis,
            v.umfang, v.schichten_anzahl, v.unbesetzt_anzahl,
            v.konflikte_offen, v.konflikte_blockierend,
            v.empfaenger_anzahl, v.ohne_zugang_anzahl, v.notiz,
            to_char((v.veroeffentlicht_am at time zone 'Europe/Berlin'),
                    'DD.MM.YYYY HH24:MI') as am_lokal,
            b.name as von_wem
       from dienstplan_veroeffentlichung v
       left join benutzer b on b.id = v.veroeffentlicht_von
      order by v.veroeffentlicht_am desc
      limit $1`,
    [Math.max(1, Math.min(50, Math.trunc(grenze)))],
  );
  return zeilen.map((z) => ({
    id: z.id,
    von: z.von,
    bis: z.bis,
    umfang: z.umfang,
    schichten: Number(z.schichten_anzahl),
    unbesetzt: Number(z.unbesetzt_anzahl),
    konflikteOffen: Number(z.konflikte_offen),
    konflikteBlockierend: Number(z.konflikte_blockierend),
    empfaenger: Number(z.empfaenger_anzahl),
    ohneZugang: Number(z.ohne_zugang_anzahl),
    notiz: z.notiz,
    amLokal: z.am_lokal,
    von_wem: z.von_wem,
  }));
}
