/**
 * Demodaten fuer Phase 5 — Einteilung und erfasste Zeit (TIM-05, TIM-08,
 * TIM-12, TIM-13, EMP-04).
 *
 * Ohne diese Datei zeigte der Plan Schichten, auf denen **niemand** stand, und
 * der ganze Zeitbereich — Wochenliste, Live-Brett, Korrekturbuch,
 * MiLoG-Aufzeichnung, Stundenkonto — blieb leer. Nicht mit einer Fehlermeldung,
 * sondern mit „0", und zwar auf jedem Bildschirm ueberzeugend gleich.
 *
 * **Die Einteilung laeuft ueber den ECHTEN Dienst** (`besetzeEinsatz`), nicht
 * ueber ein `insert`. Damit nehmen die Demodaten denselben Weg wie ein Planer:
 * Qualifikationssperre, Arbeitszeitpruefung, Besetzungszaehler,
 * ArbZG-Projektion, Konflikterkennung. Ein Seed, der die Tore umgeht, erzeugt
 * Zeilen, die es im Betrieb nie geben koennte — und verdeckt genau die Fehler,
 * fuer die er da waere.
 *
 * **Die Zeiteintraege dagegen entstehen als IMPORT**, und das ist kein
 * Schummeln, sondern die einzige ehrliche Form: `kern.stempel_feldzeit()`
 * ueberschreibt jeden Beginn mit `now()`, sobald die Quelle die Serveruhr ist
 * (Invariante 5, und richtig so). Eine Fixtur, die drei Wochen zurueckliegende
 * Schichten erfassen will, sagt deshalb, was sie ist: `erfassungsart_beginn =
 * 'import'`. In der Oberflaeche steht dann „importiert" — und das stimmt.
 *
 * **Idempotent durch LESEN ZUERST**, wie die uebrigen Seed-Dateien: der
 * natuerliche Schluessel eines Zeiteintrags ist hier die Einteilung, auf die
 * er zeigt.
 */
import type postgres from 'postgres';
import type { SchreibKontext } from '../../kontext/index.js';
import {
  ArbzgWarnungOffen, besetzeEinsatz,
} from '../../services/dienstplan/einteilung.js';
import { berlinHeute, type Abfrage } from '../../services/dienstplan/generator.js';
import { tagePlus } from '@/lib/datum/kalendertag';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface ZeitErgebnis {
  readonly einteilungen: number;
  readonly uebergangen: number;
  readonly zeiteintraege: number;
  readonly laufend: number;
  readonly abwesenheiten: number;
}

/** Wie weit zurueck und wie weit voraus besetzt wird. */
const RUECKBLICK_TAGE = 21;
const VORSCHAU_TAGE = 14;

interface SchichtZeile {
  readonly id: string;
  readonly beginn: Date;
  readonly ende: Date;
  readonly offen: number;
  readonly vergangen: boolean;
}

/**
 * Eine Sitzung wie im Portal — `cse_app` mit gebundenem Mandanten.
 *
 * Der Seed laeuft sonst als Eigentuemer, und der sieht alles. Die Einteilung
 * soll aber genau das durchlaufen, was ein Planer durchlaeuft: `app.hat_recht`,
 * die Policies, die Definer-Funktionen. Als Eigentuemer geprueft hiesse: nicht
 * geprueft.
 */
async function alsPlaner<T>(
  sql: Sql, mandantId: string, benutzerId: string,
  fn: (kontext: SchreibKontext) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_app`);
    const setze = async (name: string, wert: string): Promise<void> => {
      await tx.unsafe(`select set_config($1, $2, true)`, [name, wert]);
    };
    await setze('app.scope', 'mandant');
    await setze('app.mandant_id', mandantId);
    await setze('app.mandant_ids', mandantId);
    await setze('app.benutzer_id', benutzerId);
    await setze('app.portal', 'intern');
    await setze('app.readonly', 'off');
    await setze('app.akteur_typ', 'mensch');
    const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly R[];
    return fn({
      scope: 'mandant', portal: 'intern', benutzerId,
      aktiverMandantId: mandantId, mandantIds: [mandantId],
      abfrage, schreibe: abfrage,
    });
  }) as Promise<T>;
}

export async function seedZeit(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<ZeitErgebnis> {
  const mandantId = ids.get('reinigung');
  if (mandantId === undefined) throw new Error('Bereich reinigung fehlt');

  const [planer] = await sql<{ id: string }[]>`
    select b.id from benutzer b
     join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
     join rolle r on r.id = bm.rolle_id
    where r.schluessel in ('admin', 'leitung') and b.status = 'aktiv'
      and bm.entzogen_am is null
    order by r.schluessel limit 1`;
  if (planer === undefined) return leer();

  const anstellungen = (await sql<{ id: string }[]>`
    select a.id from anstellung a
     where a.mandant_id = ${mandantId} and a.status = 'aktiv' and a.geloescht_am is null
     order by a.personalnummer`).map((a) => a.id);
  if (anstellungen.length === 0) return leer();

  const heute = await berlinHeute(sql as unknown as Abfrage);
  const von = tagePlus(heute, -RUECKBLICK_TAGE);
  const bis = tagePlus(heute, VORSCHAU_TAGE);

  const schichten = await sql<SchichtZeile[]>`
    select e.id, e.beginn_zeitpunkt as beginn, e.ende_zeitpunkt as ende,
           (e.soll_besetzung - e.besetzt_anzahl)::int as offen,
           (e.ende_zeitpunkt < now())                 as vergangen
      from einsatz e
     where e.mandant_id = ${mandantId}
       and e.storniert_am is null
       and e.beginn_zeitpunkt >= (${von}::date::timestamp) at time zone 'Europe/Berlin'
       and e.beginn_zeitpunkt <  ((${bis}::date + 1)::timestamp) at time zone 'Europe/Berlin'
       and e.besetzt_anzahl < e.soll_besetzung
     order by e.beginn_zeitpunkt`;

  let einteilungen = 0;
  let uebergangen = 0;
  /**
   * GENAU EIN uebergangener Befund.
   *
   * Der Konflikteingang soll etwas zeigen — aber eine Demo, in der jede zweite
   * Schicht einen quittierpflichtigen Verstoss traegt, sieht nicht nach
   * Betrieb aus, sondern nach einem kaputten Plan. Alles Weitere bleibt
   * unbesetzt und faellt damit als Unterbesetzung auf, was es auch ist.
   */
  const UEBERGEHEN_HOECHSTENS = 1;
  const zugeteilt: { einsatzId: string; zuordnungId: string; vergangen: boolean }[] = [];

  let naechster = 0;
  for (const s of schichten) {
    for (let n = 0; n < s.offen; n += 1) {
      let gesetzt = false;
      // Reihum durch die Belegschaft — und bei einem Arbeitszeitbefund zur
      // naechsten Person, statt ihn wegzudruecken.
      for (let versuch = 0; versuch < anstellungen.length && !gesetzt; versuch += 1) {
        const anstellungId = anstellungen[(naechster + versuch) % anstellungen.length]!;
        try {
          const befund = await alsPlaner(sql, mandantId, planer.id, (k) =>
            besetzeEinsatz(k, { einsatzId: s.id, anstellungId }));
          zugeteilt.push({
            einsatzId: s.id, zuordnungId: befund.zuordnungId, vergangen: s.vergangen,
          });
          einteilungen += 1;
          gesetzt = true;
          naechster += 1;
        } catch (fehler) {
          if (!(fehler instanceof ArbzgWarnungOffen)) {
            // Eine Qualifikationssperre oder ein Doppeleintrag ist kein Grund,
            // den Seed abzubrechen — aber auch keiner, ihn zu verschweigen.
            if (versuch === anstellungen.length - 1) {
              process.stdout.write(
                `  · Schicht ${s.id.slice(0, 8)} bleibt offen: `
                + `${fehler instanceof Error ? fehler.message : String(fehler)}\n`,
              );
            }
            continue;
          }
          if (uebergangen < UEBERGEHEN_HOECHSTENS) {
            const befund = await alsPlaner(sql, mandantId, planer.id, (k) =>
              besetzeEinsatz(k, { einsatzId: s.id, anstellungId, bestaetigt: true }));
            zugeteilt.push({
              einsatzId: s.id, zuordnungId: befund.zuordnungId, vergangen: s.vergangen,
            });
            einteilungen += 1;
            uebergangen += 1;
            gesetzt = true;
            naechster += 1;
          }
        }
      }
    }
  }

  const { erfasst, laufend } = await erfasseZeiten(sql, mandantId, zugeteilt);
  const abwesenheiten = await seedAbwesenheiten(sql, mandantId, planer.id, anstellungen, heute);
  return { einteilungen, uebergangen, zeiteintraege: erfasst, laufend, abwesenheiten };
}

/**
 * Zwei Abwesenheiten und ein offener Antrag — damit die Personalseiten nicht
 * leer sind und der Dienstplan zeigt, was er bei einer Abmeldung tut.
 *
 * **Der Urlaubsanspruch wird VORHER eingetragen**, weil die Genehmigung sonst
 * mit „kein Urlaubsanspruch hinterlegt (O-18)" abbricht — und genau das soll
 * sie: eine Demo, die diesen Halt umgeht, zeigt eine Plattform, die es nicht
 * gibt. 30 Tage sind hier ein DEMOWERT und keine Zusage; die Frage steht
 * offen.
 */
async function seedAbwesenheiten(
  sql: Sql, mandantId: string, planerId: string,
  anstellungen: readonly string[], heute: string,
): Promise<number> {
  const [krank] = await sql<{ id: string }[]>`
    select id from abwesenheitsart where schluessel = 'krankheit' and mandant_id is null`;
  const [urlaub] = await sql<{ id: string }[]>`
    select id from abwesenheitsart where schluessel = 'urlaub' and mandant_id is null`;
  const [urlaubsantrag] = await sql<{ id: string }[]>`
    select id from antragsart where schluessel = 'urlaub' and mandant_id is null`;
  const ersteAnstellung = anstellungen[0];
  const zweiteAnstellung = anstellungen[1] ?? anstellungen[0];
  if (krank === undefined || urlaub === undefined || urlaubsantrag === undefined
      || ersteAnstellung === undefined || zweiteAnstellung === undefined) {
    return 0;
  }

  /**
   * Die Lohnfrage der beiden benutzten Arten wird hier beantwortet — und zwar
   * SICHTBAR als Demowert. Ohne Antwort verweigert der Dienst die Verwendung
   * (O-139), und das ist richtig so; ein Seed, der die Verweigerung umgeht,
   * ohne es zu sagen, waere die schlechtere Haelfte.
   */
  await sql`
    update abwesenheitsart set bezahlt = true
     where id in (${krank.id}, ${urlaub.id}) and bezahlt is null`;

  const [da] = await sql<{ anzahl: string }[]>`
    select count(*)::text as anzahl from abwesenheit where mandant_id = ${mandantId}`;
  if (Number(da?.anzahl ?? '0') > 0) return 0;

  let angelegt = 0;
  // Eine laufende Krankmeldung — der Fall, den der Dienstplan kennzeichnen soll.
  await sql`
    insert into abwesenheit
      (mandant_id, anstellung_id, abwesenheitsart_id, von, bis, tage_angerechnet,
       status, erstellt_von)
    values (${mandantId}, ${ersteAnstellung}, ${krank.id},
            ${tagePlus(heute, -1)}::date, ${tagePlus(heute, 2)}::date, 4,
            'erfasst', ${planerId})`;
  angelegt += 1;

  // Und ein offener Urlaubsantrag im Posteingang der Planung.
  const jahr = Number(tagePlus(heute, 30).slice(0, 4));
  await sql`
    insert into urlaubskonto (mandant_id, anstellung_id, jahr, anspruch_tage, erstellt_von)
    values (${mandantId}, ${zweiteAnstellung}, ${jahr}, 30, ${planerId})
    on conflict (anstellung_id, jahr) do nothing`;
  await sql`
    insert into antrag
      (mandant_id, anstellung_id, antragsart_id, von_datum, bis_datum,
       abwesenheitsart_id, nachricht, eingereicht_von_benutzer_id)
    values (${mandantId}, ${zweiteAnstellung}, ${urlaubsantrag.id},
            ${tagePlus(heute, 30)}::date, ${tagePlus(heute, 34)}::date,
            ${urlaub.id}, 'Kurzurlaub — Demodaten (Seed)', ${planerId})`;
  angelegt += 1;

  return angelegt;
}

function leer(): ZeitErgebnis {
  return { einteilungen: 0, uebergangen: 0, zeiteintraege: 0, laufend: 0, abwesenheiten: 0 };
}

/**
 * Die Zeit zu den vergangenen Schichten.
 *
 * Ein bisschen Streuung gehoert dazu: eine Demo, in der jede Schicht auf die
 * Sekunde ihrem Plan folgt, zeigt die Differenz nicht, um derentwillen es die
 * Zeiterfassung gibt. Die Streuung ist deterministisch aus der Kennung
 * abgeleitet — ein Seed, der bei jedem Lauf andere Zahlen erzeugt, ist als
 * Vergleichsgrundlage wertlos.
 */
async function erfasseZeiten(
  sql: Sql, mandantId: string,
  zugeteilt: readonly { einsatzId: string; zuordnungId: string; vergangen: boolean }[],
): Promise<{ erfasst: number; laufend: number }> {
  let erfasst = 0;
  let laufend = 0;
  let nacherfasstGesetzt = false;
  let geraeteAbweichungGesetzt = false;

  for (const z of zugeteilt) {
    if (!z.vergangen) continue;

    const [da] = await sql<{ id: string }[]>`
      select id from zeiteintrag where einsatz_zuordnung_id = ${z.zuordnungId}`;
    if (da !== undefined) continue;

    // Deterministisch: die ersten beiden Hexstellen der Zuordnungskennung.
    const streu = Number.parseInt(z.zuordnungId.slice(0, 2), 16);
    const beginnVersatz = (streu % 11) - 5;          // -5 … +5 Minuten
    const endeVersatz = ((streu >> 3) % 13) - 4;     // -4 … +8 Minuten
    const nacherfasst = !nacherfasstGesetzt && streu % 7 === 3;
    const geraeteVersatz = !geraeteAbweichungGesetzt && streu % 5 === 2 ? -127 : null;
    if (nacherfasst) nacherfasstGesetzt = true;
    if (geraeteVersatz !== null) geraeteAbweichungGesetzt = true;

    await sql`
      insert into zeiteintrag
        (mandant_id, anstellung_id, person_id, einsatz_id, einsatz_zuordnung_id,
         objekt_id, revier_id,
         beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
         erfassungsart_beginn, quelle_beginn, erfassungsart_ende, quelle_ende,
         geraete_zeit_beginn, nacherfasst, behauptet_beginn,
         status, notiz, erstellt_von_art)
      select ${mandantId}, zo.anstellung_id, zo.person_id, e.id, zo.id,
             e.objekt_id, e.revier_id,
             e.beginn_zeitpunkt + make_interval(mins => ${beginnVersatz}),
             e.ende_zeitpunkt   + make_interval(mins => ${endeVersatz}),
             /**
              * Die Pause nach § 4 ArbZG: 30 Minuten ueber sechs Stunden, 45
              * ueber neun. Das ist die gesetzliche MINDESTPAUSE und keine
              * Aussage darueber, was die Gruppe vereinbart hat — die Frage
              * steht offen (O-168), und dieser Seed erfindet sie nicht,
              * sondern nimmt den Wert, unter den niemand darf.
              */
             case
               when extract(epoch from (e.ende_zeitpunkt - e.beginn_zeitpunkt)) > 9 * 3600
                 then 45
               when extract(epoch from (e.ende_zeitpunkt - e.beginn_zeitpunkt)) > 6 * 3600
                 then 30
               else 0
             end,
             ${nacherfasst ? 'nacherfassung' : 'import'}::erfassungs_art, 'import'::zeitquelle,
             'import'::erfassungs_art, 'import'::zeitquelle,
             case when ${geraeteVersatz}::int is null then null
                  else e.beginn_zeitpunkt + make_interval(secs => ${geraeteVersatz}::int) end,
             ${nacherfasst},
             case when ${nacherfasst} then e.beginn_zeitpunkt else null end,
             'abgeschlossen', 'Demodaten (Seed)', 'system'
        from einsatz e
        join einsatz_zuordnung zo on zo.id = ${z.zuordnungId}
       where e.id = ${z.einsatzId}`;
    erfasst += 1;
  }

  /**
   * Und EIN laufender Eintrag, damit das Live-Brett nicht leer ist.
   *
   * Er haengt an der naechsten Einteilung, die schon begonnen hat — gibt es
   * keine, bleibt das Brett leer, und das ist die richtige Antwort: erfunden
   * wird hier nichts.
   */
  const [offen] = await sql<{ zuordnung: string; einsatz: string }[]>`
    select zo.id as zuordnung, e.id as einsatz
      from einsatz_zuordnung zo
      join einsatz e on e.mandant_id = zo.mandant_id and e.id = zo.einsatz_id
     where zo.mandant_id = ${mandantId} and zo.entfernt_am is null
       and e.beginn_zeitpunkt <= now() and e.ende_zeitpunkt > now()
       and not exists (select 1 from zeiteintrag z where z.einsatz_zuordnung_id = zo.id)
     order by e.beginn_zeitpunkt limit 1`;
  if (offen !== undefined) {
    await sql`
      insert into zeiteintrag
        (mandant_id, anstellung_id, person_id, einsatz_id, einsatz_zuordnung_id,
         objekt_id, revier_id, beginn_zeitpunkt, pause_minuten,
         erfassungsart_beginn, quelle_beginn, status, notiz, erstellt_von_art)
      select ${mandantId}, zo.anstellung_id, zo.person_id, e.id, zo.id,
             e.objekt_id, e.revier_id, e.beginn_zeitpunkt, 0,
             'import'::erfassungs_art, 'import'::zeitquelle,
             'laufend', 'Demodaten (Seed) — laufender Eintrag', 'system'
        from einsatz_zuordnung zo
        join einsatz e on e.mandant_id = zo.mandant_id and e.id = zo.einsatz_id
       where zo.id = ${offen.zuordnung}`;
    laufend = 1;
  }

  /**
   * Laeuft gerade keine Schicht, entsteht ein Eintrag OHNE Schicht — und das
   * ist keine Notluege, sondern der zweite echte Fall: ungeplante Arbeit auf
   * Abruf. Er hat keine Leistungszeile und taucht damit dort auf, wo FIN-18
   * ihn haben will (`zeiteintrag_ohne_auftrag`) — die Gegenliste, ohne die
   * eine geleistete Stunde still verschwaende.
   *
   * Zwei Stunden zurueck, damit auf dem Live-Brett eine Dauer steht und nicht
   * „0:00 h".
   */
  if (laufend === 0) {
    const [zeile] = await sql<{ anstellung: string; person: string; objekt: string }[]>`
      select a.id as anstellung, a.person_id as person, o.id as objekt
        from anstellung a
        cross join lateral (
          select id from objekt
           where mandant_id = ${mandantId} and archiviert_am is null
           order by objektnummer limit 1) o
       where a.mandant_id = ${mandantId} and a.status = 'aktiv' and a.geloescht_am is null
         and not exists (
           select 1 from zeiteintrag z
            where z.anstellung_id = a.id and z.ende_zeitpunkt is null
              and z.storniert_am is null and z.ersetzt_am is null)
       order by a.personalnummer limit 1`;
    if (zeile !== undefined) {
      await sql`
        insert into zeiteintrag
          (mandant_id, anstellung_id, person_id, objekt_id,
           beginn_zeitpunkt, pause_minuten,
           erfassungsart_beginn, quelle_beginn, status, notiz, erstellt_von_art)
        values (${mandantId}, ${zeile.anstellung}, ${zeile.person}, ${zeile.objekt},
                now() - interval '2 hours', 0,
                'import', 'import', 'laufend',
                'Demodaten (Seed) — Abrufeinsatz ohne Planung', 'system')`;
      laufend = 1;
    }
  }

  return { erfasst, laufend };
}
