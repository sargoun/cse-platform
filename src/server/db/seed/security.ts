/**
 * Demodaten fuer die Security — Posten, Plan und Einteilung (SEC-01, D-09).
 *
 * **Ohne diese Datei hat die Security keinen einzigen Dienst.** Das war nicht
 * bloss eine Luecke im Schaufenster: Fatima Yildiz ist der D-09-Fall — ein
 * Mensch, zwei Gesellschaften —, und ihr Mitarbeiterportal versprach beide
 * Schichtlisten, beide Stundenkonten, beide Monatsnachweise. Geliefert wurde
 * eine Gesellschaft. Kein Fehler, keine Meldung, nur die halbe Wahrheit auf
 * einem Bildschirm, der vollstaendig aussah.
 *
 * **Der Posten laeuft ueber den ECHTEN Generator**, wie die Reinigung ihre
 * Turnusse: `posten` → `planungsserie` → `app.planungsbedarf` →
 * `generiereEinsaetze`. Ein Seed, der `einsatz`-Zeilen direkt schreibt, prueft
 * nur, dass sich Zeilen schreiben lassen.
 *
 * **Die Lage des Dienstes ist ausgerechnet, nicht gewaehlt:** Dienstag und
 * Donnerstag 08:00–16:00. Der erste Versuch legte ihn auf 14:00–22:00 — und
 * der Besetzungsdienst wies ihn zurueck, zu Recht: die Reinigung beginnt
 * Mittwoch und Freitag um 06:00, und zwischen 22:00 und 06:00 liegen acht
 * Stunden, nicht die elf des § 5 ArbZG. Die Grenzen gelten dem MENSCHEN und
 * nicht dem Mandanten (D-09), also stolperte die zweite Gesellschaft ueber
 * die erste. Mit 16:00 Dienstschluss bleiben vierzehn Stunden bis zur
 * Fruehschicht.
 *
 * Das ist keine Anekdote, sondern der Grund, warum dieser Seed ueber
 * `besetzeEinsatz` laeuft und nicht ueber ein `insert`: ein direktes Einfuegen
 * haette die Zeilen geschrieben, der Bildschirm haette voll ausgesehen, und
 * die erste echte Doppelbeschaeftigung waere in einen Verstoss gelaufen, den
 * die Demo taeglich vorgefuehrt hat, ohne ihn zu zeigen.
 *
 * // TODO(client, O-342): Welche Qualifikation verlangt welcher Posten —
 * genuegt die Unterrichtung nach §34a Abs. 1a GewO, oder verlangt der
 * Objektschutz am Kurfürstendamm die Sachkundeprüfung? Bis zur Antwort traegt
 * der Demoposten KEINE `einsatzanforderung`; die Sperre ist gebaut und
 * geprueft (`app.einsatz_qualifikation_erfuellt`), aber welche Zeile sie
 * scharf stellt, entscheidet der Vertrag und nicht dieser Seed.
 *
 * **Idempotent durch LESEN ZUERST** — wie die uebrigen Seed-Dateien.
 */
import type postgres from 'postgres';
import {
  berlinHeute, generiereEinsaetze, type Abfrage,
} from '../../services/dienstplan/generator.js';
import { montag, tagePlus } from '@/lib/datum/kalendertag';
import { besetzeUndErfasse } from './zeit.js';
import { alsPortalSitzung } from './sitzung.js';
import { erzeugeVeranstaltungsschicht } from '../../services/security/eventbesetzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface SecurityErgebnis {
  readonly posten: number;
  readonly einsaetze: number;
  readonly einteilungen: number;
  readonly zeiteintraege: number;
  /**
   * Posten und Objekt, auf die das Wachbuch aufsetzt — ZURUECKGEGEBEN und
   * nicht noch einmal gesucht.
   *
   * `seedWachbuch` koennte den Posten ueber sein Kurzzeichen nachschlagen;
   * dann stuende `OS-TD` an zwei Stellen, und die zweite erfuehre nie, wenn
   * die erste sich aendert — das Wachbuch bliebe still leer. Die Rueckgabe
   * macht die Abhaengigkeit sichtbar: ohne Posten kein Buch.
   *
   * `null`, wenn diese Datei fruehzeitig aussteigt (kein Objekt, kein Planer).
   */
  readonly postenId: string | null;
  readonly objektId: string | null;
}

const POSTEN = {
  bezeichnung: 'Objektschutz Empfang — Tagdienst',
  kurzzeichen: 'OS-TD',
  rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
  beginnLokal: '08:00',
  dauerMinuten: 480,
  /**
   * EINER, nicht zwei.
   *
   * `min_besetzung` ist die Spalte, die es nur beim Posten gibt, und sie ist
   * teuer: faellt die Besetzung darunter, steht der Posten im
   * Dringlichkeitsblock und ist nicht veroeffentlichbar (SEC-01). Ein
   * Demoposten mit zwei Plaetzen und einer Belegschaft von zwei Menschen
   * stuende dauerhaft rot da — und der Dringlichkeitsblock, der eine echte
   * Unterbesetzung melden soll, waere Grundrauschen.
   */
  minBesetzung: 1,
  sollBesetzung: 1,
} as const;

export async function seedSecurity(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<SecurityErgebnis> {
  const leer: SecurityErgebnis = {
    posten: 0, einsaetze: 0, einteilungen: 0, zeiteintraege: 0,
    postenId: null, objektId: null,
  };
  const mandantId = ids.get('security');
  if (mandantId === undefined) throw new Error('Bereich security fehlt');

  const [objekt] = await sql<{ id: string }[]>`
    select id from objekt
     where mandant_id = ${mandantId} and archiviert_am is null and kunde_id is not null
     order by objektnummer limit 1`;
  if (objekt === undefined) return leer;

  const [planer] = await sql<{ id: string }[]>`
    select b.id from benutzer b
     join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
     join rolle r on r.id = bm.rolle_id
    where r.schluessel in ('admin', 'leitung', 'super_admin') and b.status = 'aktiv'
      and bm.entzogen_am is null
    order by r.schluessel limit 1`;
  if (planer === undefined) return leer;

  /**
   * Derselbe Anker wie beim Dienstplan der Reinigung: drei Wochen vor dem
   * Montag dieser Woche. Ohne Vergangenheit gibt es nichts zu erfassen, und
   * ohne erfasste Zeit bleibt das zweite Stundenkonto leer — also genau der
   * Bildschirm, den diese Datei fuellen soll.
   */
  const heute = await berlinHeute(sql as unknown as Abfrage);
  const anker = tagePlus(montag(heute), -21);

  let posten = 0;
  const [da] = await sql<{ id: string }[]>`
    select id from posten
     where mandant_id = ${mandantId} and objekt_id = ${objekt.id}
       and kurzzeichen = ${POSTEN.kurzzeichen} and archiviert_am is null limit 1`;
  const postenId = da?.id ?? (await sql<{ id: string }[]>`
    insert into posten (mandant_id, objekt_id, bezeichnung, kurzzeichen,
                        min_besetzung, soll_besetzung, abdeckung_rrule, dtstart_lokal,
                        zeitzone, dauer_minuten, gueltig_ab, erstellt_von_art)
    values (${mandantId}, ${objekt.id}, ${POSTEN.bezeichnung}, ${POSTEN.kurzzeichen},
            ${POSTEN.minBesetzung}, ${POSTEN.sollBesetzung}, ${POSTEN.rrule},
            ${`${anker} ${POSTEN.beginnLokal}`}::timestamp, 'Europe/Berlin',
            ${POSTEN.dauerMinuten}, ${anker}::date, 'system')
    returning id`)[0]!.id;
  if (da === undefined) posten += 1;

  const [serieDa] = await sql<{ id: string }[]>`
    select id from planungsserie
     where mandant_id = ${mandantId} and posten_id = ${postenId}
       and archiviert_am is null limit 1`;
  if (serieDa === undefined) {
    /**
     * `feiertage_ueberspringen = false` — und das ist die Aussage, nicht die
     * Vorgabe. 0028 §8.5 laesst fuer Posten bewusst keinen Vorgabewert zu:
     * ein stillschweigend uebersprungener Feiertag liesse die Weihnachtsnacht
     * UNBESETZT, und das faellt erst auf, wenn niemand da ist.
     */
    await sql`
      insert into planungsserie (mandant_id, posten_id, quelle, zeitzone,
                                 feiertage_ueberspringen, feiertag_bundesland,
                                 horizont_tage, erstellt_von_art)
      values (${mandantId}, ${postenId}, 'posten', 'Europe/Berlin',
              false, 'BE', 56, 'system')`;
  }

  const berichte = await generiereEinsaetze(sql as unknown as Abfrage, mandantId, {
    heute: anker, laufId: null,
    /* Vom Anker aus, und der liegt drei Wochen zurück: nur der Seed legt
       Vergangenes an (V-135) — daran hängen Zeiteinträge und Nachweise. */
    vergangenheitAnlegen: true,
  });
  const einsaetze = berichte.reduce((a, b) => a + b.erzeugt + b.aktualisiert, 0);

  const anstellungen = (await sql<{ id: string }[]>`
    select a.id from anstellung a
     where a.mandant_id = ${mandantId} and a.status = 'aktiv' and a.geloescht_am is null
     order by a.personalnummer`).map((a) => a.id);
  // Auch ohne Belegschaft gehoeren Posten und Objekt in die Rueckgabe: das
  // Wachbuch haengt an der LEITUNG und nicht an der Einteilung — es kann
  // gefuehrt werden, wenn auf dem Posten (noch) niemand steht.
  if (anstellungen.length === 0) {
    return { ...leer, posten, einsaetze, postenId, objektId: objekt.id };
  }

  const lauf = await besetzeUndErfasse(sql, mandantId, planer.id, anstellungen, heute);
  return {
    posten, einsaetze,
    einteilungen: lauf.einteilungen,
    zeiteintraege: lauf.erfasst,
    postenId, objektId: objekt.id,
  };
}

/* ===========================================================================
 * Das Bewacherregister und der Eventdienst (SEC-03, SEC-08, LEG-04)
 *
 * **Warum das hier steht und nicht in einer eigenen Datei.** Beide haengen an
 * derselben Belegschaft und demselben Objekt, die `seedSecurity` oben schon
 * aufgebaut hat. Eine zweite Datei muesste Posten, Objekt und Anstellungen
 * erneut suchen — und die zweite Suche erfaehrt nie, wenn die erste sich
 * aendert (dieselbe Begruendung, aus der `postenId` zurueckgegeben wird).
 *
 * **Vier Zeilen waren null.** `bewacher_eintrag` und `veranstaltung` hatten im
 * ganzen Seed keine einzige Zeile, und im Baum gab es keinen Anlegeweg. Die
 * Seiten `/security/bewacherregister` und `/security/veranstaltungen/[id]`
 * waren damit baubar, aber nicht belegbar: „Definition of done: seed data
 * exercises it" war fuer sie nicht erfuellt.
 * ======================================================================== */

/** Was das Registerseed angelegt hat — nur fuer die Protokollzeile. */
export interface RegisterErgebnis {
  readonly eintraege: number;
  readonly ohneEintrag: number;
  readonly veranstaltungen: number;
}

/**
 * Bewachereintraege fuer die Belegschaft der Sicherheit.
 *
 * **Die Zeilen zeigen die vier Lagen, die die Seite unterscheiden muss** —
 * gueltig, im Vorwarnfenster, abgelaufen und „kein Eintrag erfasst". Die
 * letzte ist keine Auslassung: genau sie ist die Luecke, die SEC-03 sichtbar
 * machen soll, und eine Liste, in der alle einen Eintrag haben, prueft sie
 * nicht.
 *
 * **Kein Format wird erfunden, nur erkennbar Erfundenes.** Welches Format eine
 * Bewacher-ID hat, ist offen (O-40); die Nummern hier tragen deshalb das
 * Praefix `SEED-` und sind als Demodaten erkennbar. Eine plausibel aussehende
 * Behoerdennummer im Seed waere die schlechtere Wahl: irgendwann haelt sie
 * jemand fuer echt.
 *
 * **Und keine Frist wird abgeleitet.** `naechste_pruefung_am` steht nur da, wo
 * der Seed sie ausdruecklich setzt; in welchem Abstand das Register
 * nachzupruefen ist, steht in der GewO-Durchfuehrung und nicht hier.
 */
async function seedBewacherRegister(
  sql: Sql, mandantId: string, planerId: string, heute: string,
): Promise<{ eintraege: number; ohneEintrag: number }> {
  const personen = await sql<{ id: string; person_id: string }[]>`
    select a.id, a.person_id
      from anstellung a
      join person p on p.id = a.person_id
     where a.mandant_id = ${mandantId} and a.geloescht_am is null
       and a.status = 'aktiv'
     order by a.personalnummer`;
  if (personen.length === 0) return { eintraege: 0, ohneEintrag: 0 };

  /**
   * Die Lagen in fester Reihenfolge, damit der Seed wiederholbar ist. Die
   * LETZTE Person bekommt absichtlich KEINEN Eintrag — sie ist die Luecke.
   */
  const lagen: readonly {
    readonly status: string;
    readonly registriertSeit: number;
    readonly gueltigBis: number | null;
    readonly bemerkung: string | null;
  }[] = [
    // Gueltig und weit weg vom Ablauf.
    { status: 'registriert', registriertSeit: -800, gueltigBis: 900, bemerkung: null },
    // Im Vorwarnfenster: laeuft in 24 Tagen ab.
    { status: 'registriert', registriertSeit: -1100, gueltigBis: 24,
      bemerkung: 'Verlängerung beantragt' },
    // ABGELAUFEN — SEC-04 ist eine harte Sperre, nicht eine Warnung.
    { status: 'registriert', registriertSeit: -1500, gueltigBis: -12,
      bemerkung: 'Verlängerung liegt der Behörde vor' },
    // Beantragt, noch ohne Gueltigkeit: auch das sperrt die Einteilung.
    { status: 'beantragt', registriertSeit: -20, gueltigBis: null,
      bemerkung: 'Antrag beim Ordnungsamt eingegangen' },
  ];

  let eintraege = 0;
  for (const [index, person] of personen.entries()) {
    const lage = lagen[index];
    // Ohne Lage bleibt die Person OHNE Eintrag — die Luecke, absichtlich.
    if (lage === undefined) continue;
    const [da] = await sql<{ id: string }[]>`
      select id from bewacher_eintrag
       where person_id = ${person.person_id} and erloschen_am is null limit 1`;
    if (da !== undefined) continue;
    await sql`
      insert into bewacher_eintrag
        (person_id, bewacher_id, status, registriert_seit, gueltig_bis,
         letzte_pruefung_am, bemerkung, quelle, erstellt_von)
      values (${person.person_id},
              ${`SEED-${String(index + 1).padStart(6, '0')}`},
              ${lage.status}::bewacher_status,
              ${tagePlus(heute, lage.registriertSeit)}::date,
              ${lage.gueltigBis === null ? null : tagePlus(heute, lage.gueltigBis)}::date,
              ${tagePlus(heute, -180)}::date,
              ${lage.bemerkung}, 'manuell', ${planerId})`;
    eintraege += 1;
  }
  return { eintraege, ohneEintrag: Math.max(0, personen.length - lagen.length) };
}

/**
 * Ein Eventdienst mit Schicht — und einer ohne Objekt.
 *
 * **Warum ZWEI.** Der erste haengt an einem Objekt und bekommt seine Schicht
 * ueber den echten Dienst (`erzeugeVeranstaltungsschicht`), damit das
 * Einzelblatt einen Besetzungsstand zeigt. Der zweite traegt den Ort NUR als
 * Text — der Fall, den `VeranstaltungOhneObjekt` beschreibt: ein
 * Veranstaltungsort existiert oft, bevor es eine Objektakte gibt, und aus
 * Freitext laesst sich keine Schicht bauen (`einsatz.objekt_id` ist NOT NULL).
 * Ohne diese zweite Zeile ist der Warnhinweis auf der Seite eine Behauptung.
 *
 * **Woher ein Eventauftrag kommt, ist offen** (O-703): die Seitenkarte fuehrt
 * keine Route zum Anlegen, und ob er aus einer Auftragsleistung, aus dem
 * Vertrieb oder handerfasst entsteht, ist nicht entschieden. Der Seed schreibt
 * ihn deshalb handerfasst und OHNE `auftrag_leistung_id` — die Seite sagt das
 * und erfindet keine Herkunft.
 *
 * **`soll_besetzung` traegt keine Dringlichkeit** (O-210): vier Wachen sind
 * die vereinbarte Staerke, nicht die Mindeststaerke. `min_besetzung` bleibt
 * auf dem Spaltenvorgabewert der Schicht.
 */
async function seedVeranstaltungen(
  sql: Sql, mandantId: string, planerId: string, objektId: string, heute: string,
): Promise<number> {
  const [kunde] = await sql<{ id: string }[]>`
    select kunde_id as id from objekt
     where id = ${objektId} and mandant_id = ${mandantId} and kunde_id is not null`;
  if (kunde === undefined) return 0;

  const [leitung] = await sql<{ id: string }[]>`
    select a.id from anstellung a
     where a.mandant_id = ${mandantId} and a.status = 'aktiv' and a.geloescht_am is null
     order by a.personalnummer limit 1`;

  const [anweisung] = await sql<{ id: string }[]>`
    select id from dienstanweisung
     where mandant_id = ${mandantId} and objekt_id = ${objektId}
       and archiviert_am is null limit 1`;

  /** Beide liegen in der ZUKUNFT: ein Eventdienst wird im Voraus besetzt. */
  const fenster = [
    {
      bezeichnung: 'Sommerfest Bezirksamt',
      anlass: 'Mitarbeiterfest mit Aussenbewirtschaftung',
      tag: tagePlus(heute, 21), beginn: '18:00', ende: '02:00',
      besucher: 400, soll: 4, mitObjekt: true,
    },
    {
      bezeichnung: 'Firmenlauf Tiergarten',
      anlass: 'Streckensicherung',
      tag: tagePlus(heute, 35), beginn: '08:00', ende: '14:00',
      besucher: 1200, soll: 6, mitObjekt: false,
    },
  ] as const;

  let angelegt = 0;
  for (const v of fenster) {
    const [da] = await sql<{ id: string }[]>`
      select id from veranstaltung
       where mandant_id = ${mandantId} and bezeichnung = ${v.bezeichnung}
         and archiviert_am is null limit 1`;
    if (da !== undefined) continue;
    /*
     * Beginn und Ende werden IN DER DATENBANK aus Berliner Ortszeit
     * aufgeloest — nicht in Node zusammengesetzt (K-11). Das Ende liegt am
     * Folgetag, wenn es vor dem Beginn liegt.
     */
    const endeTag = v.ende < v.beginn ? tagePlus(v.tag, 1) : v.tag;
    const [neu] = await sql<{ id: string }[]>`
      insert into veranstaltung
        (mandant_id, objekt_id, veranstaltungsort_text, kunde_id, bezeichnung, anlass,
         beginn, ende, erwartete_besucher, soll_besetzung, leitung_anstellung_id,
         dienstanweisung_id, erstellt_von_art, erstellt_von)
      values (${mandantId},
              ${v.mitObjekt ? objektId : null},
              ${v.mitObjekt ? null : 'Strasse des 17. Juni, 10557 Berlin'},
              ${kunde.id}, ${v.bezeichnung}, ${v.anlass},
              (${`${v.tag} ${v.beginn}`}::timestamp at time zone 'Europe/Berlin'),
              (${`${endeTag} ${v.ende}`}::timestamp at time zone 'Europe/Berlin'),
              ${v.besucher}, ${v.soll},
              ${v.mitObjekt ? (leitung?.id ?? null) : null},
              ${v.mitObjekt ? (anweisung?.id ?? null) : null},
              'mensch', ${planerId})
      returning id`;
    if (neu === undefined) continue;
    angelegt += 1;

    /*
     * Die Schicht entsteht ueber den ECHTEN Dienst — idempotent ueber
     * `quell_schluessel`, mit derselben Ortszeitauflaesung, die der Generator
     * benutzt. Ein `insert into einsatz` hier waere eine zweite Fassung
     * derselben Rechnung.
     */
    if (v.mitObjekt) {
      await alsPortalSitzung(sql, mandantId, planerId, async (kontext) =>
        erzeugeVeranstaltungsschicht(kontext, neu.id));
    }
  }
  return angelegt;
}

/**
 * Register und Eventdienste — der Nachtrag zu `seedSecurity`.
 *
 * Eine eigene Funktion und kein Anhaengsel an `seedSecurity`: sie steigt
 * einzeln aus, wenn Objekt oder Planer fehlen, und ein fehlendes Register
 * soll nicht die Postenschichten verhindern.
 */
export async function seedBewacherUndEvents(
  sql: Sql, ids: ReadonlyMap<string, string>, objektId: string | null,
): Promise<RegisterErgebnis> {
  const leer: RegisterErgebnis = { eintraege: 0, ohneEintrag: 0, veranstaltungen: 0 };
  const mandantId = ids.get('security');
  if (mandantId === undefined || objektId === null) return leer;

  const [planer] = await sql<{ id: string }[]>`
    select b.id from benutzer b
     join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
     join rolle r on r.id = bm.rolle_id
    where r.schluessel in ('admin', 'leitung', 'super_admin') and b.status = 'aktiv'
      and bm.entzogen_am is null
    order by r.schluessel limit 1`;
  if (planer === undefined) return leer;

  const heute = await berlinHeute(sql as unknown as Abfrage);
  const register = await seedBewacherRegister(sql, mandantId, planer.id, heute);
  const veranstaltungen = await seedVeranstaltungen(
    sql, mandantId, planer.id, objektId, heute);
  return { ...register, veranstaltungen };
}
