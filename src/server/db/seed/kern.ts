import type postgres from 'postgres';

/**
 * Teams, Aufgaben und ein Nachrichtenfaden je Gesellschaft (OPS-11, EMP-11,
 * DSH-01).
 *
 * **Warum der Seed das braucht.** `/portal/[mandant]/aufgaben` und
 * `/portal/[mandant]/nachrichten` sind Listen. Eine Liste ohne Zeilen ist
 * nicht vorführbar und — schlimmer — nicht prüfbar: der Leerzustand sieht
 * genauso aus wie eine kaputte Abfrage. Deshalb entstehen hier echte Zeilen
 * an echten Bezügen.
 *
 * **Die Aufgaben hängen an vorhandenen Aufträgen und Leads.** Ein Bezug auf
 * eine erfundene Kennung wäre ein toter Verweis in der Liste, und genau den
 * soll die Bezugsauflösung nicht produzieren. Wo eine Gesellschaft keinen
 * Auftrag hat, entsteht die Aufgabe eben ohne Bezug — das ist der Fall, den
 * vier der sieben Wächter aus SPEC §14 ohnehin erzeugen.
 *
 * **Eine Aufgabe ist überfällig, eine heute fällig, eine ohne Frist.** Die
 * drei Fälle sind die drei Zweige von `fristlage()`; ohne sie zeigte der
 * Bildschirm nur einen davon, und die Farben für die anderen zwei wären
 * ungesehen.
 *
 * **Nichts geht hinaus.** Der Faden ist `richtung = 'intern'`, `kanal =
 * 'portal'`, `zustell_status = 'ausstehend'` — es ist kein Versender
 * verbunden (O-36), und eine Demozeile, die `gesendet` behauptet, wäre die
 * vorgetäuschte Anbindung, die CLAUDE.md ausschliesst.
 *
 * Idempotent: erkannt wird an Titel bzw. Betreff je Gesellschaft, ein zweiter
 * Lauf legt nichts nach.
 */

export interface KernErgebnis {
  readonly teams: number;
  readonly mitglieder: number;
  readonly aufgaben: number;
  readonly faeden: number;
}

interface Konto { id: string; mandant_id: string; slug: string; name: string }
interface Anstellung { id: string; mandant_id: string; person_id: string; name: string }
interface Bezug { mandant_id: string; auftrag_id: string | null; lead_id: string | null }

/** Je Gesellschaft ein Team — der Name sagt, dass es Demobestand ist. */
const TEAMS: Readonly<Record<string, string>> = {
  reinigung: 'Objektbetreuung Mitte',
  security: 'Revier Nord',
  bau: 'Bauleitung Ost',
  operations: 'Digitalbetrieb',
};

export async function seedKern(sql: postgres.Sql): Promise<KernErgebnis> {
  /** Je Gesellschaft ein internes Konto — Ersteller und Empfänger. */
  const konten = await sql<Konto[]>`
    select b.id, bm.mandant_id, m.slug, b.name
      from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.entzogen_am is null
      join rolle r on r.id = bm.rolle_id
      join mandant m on m.id = bm.mandant_id
     where b.status = 'aktiv' and b.deaktiviert_am is null and not b.ist_dienstkonto
       and r.schluessel in ('admin','leitung')
     order by m.slug, b.name`;

  const jeMandant = new Map<string, Konto>();
  for (const k of konten) if (!jeMandant.has(k.mandant_id)) jeMandant.set(k.mandant_id, k);

  let teams = 0;
  let mitglieder = 0;
  let aufgaben = 0;
  let faeden = 0;

  for (const konto of jeMandant.values()) {
    const teamName = TEAMS[konto.slug] ?? 'Team';

    /* ------------------------------------------------------------- Team */
    const [vorhandenesTeam] = await sql<{ id: string }[]>`
      select id from team
       where mandant_id = ${konto.mandant_id} and lower(name) = lower(${teamName})
         and geloescht_am is null`;
    const teamId = vorhandenesTeam?.id ?? (await sql<{ id: string }[]>`
      insert into team (mandant_id, name, bereich, leitung_benutzer_id, erstellt_von)
      values (${konto.mandant_id}, ${teamName}, ${konto.slug}, ${konto.id}, ${konto.id})
      returning id`)[0]!.id;
    if (vorhandenesTeam === undefined) teams += 1;

    /*
     * Mitglieder: bis zu drei Beschäftigungen DIESER Gesellschaft. `person_id`
     * reist mit, weil der zusammengesetzte Fremdschlüssel sie verlangt — und
     * weil die Decke im Mitarbeiterportal nach ihr fragt (D-09).
     */
    const beschaeftigungen = await sql<Anstellung[]>`
      select a.id, a.mandant_id, a.person_id,
             btrim(coalesce(p.vorname,'') || ' ' || p.nachname) as name
        from anstellung a
        join person p on p.id = a.person_id
       where a.mandant_id = ${konto.mandant_id} and a.geloescht_am is null
         and a.status = 'aktiv'
       order by p.nachname, p.vorname
       limit 3`;
    for (const a of beschaeftigungen) {
      const eingefuegt = await sql`
        insert into team_mitglied (mandant_id, team_id, anstellung_id, person_id,
                                   rolle, erstellt_von)
        values (${a.mandant_id}, ${teamId}, ${a.id}, ${a.person_id}, null, ${konto.id})
        on conflict (team_id, anstellung_id) do nothing
        returning id`;
      mitglieder += eingefuegt.length;
    }

    /* ---------------------------------------------------------- Aufgaben */
    const [bezug] = await sql<Bezug[]>`
      select ${konto.mandant_id}::uuid as mandant_id,
             (select a.id from auftrag a
               where a.mandant_id = ${konto.mandant_id}
               order by a.erstellt_am limit 1) as auftrag_id,
             (select l.id from lead l
               where l.mandant_id = ${konto.mandant_id} and l.archiviert_am is null
               order by l.erstellt_am limit 1) as lead_id`;

    const vorlagen: readonly {
      titel: string; beschreibung: string; prioritaet: string;
      tageVersatz: number | null; auftrag: boolean; lead: boolean;
      quelle: string; quelleJob: string | null; team: boolean;
    }[] = [
      {
        titel: 'Leistungsnachweis vom Kunden einholen',
        beschreibung:
          'Der Nachweis des letzten Monats liegt noch nicht gegengezeichnet vor. '
          + 'Ohne ihn lässt sich die Rechnung nicht belegen.',
        prioritaet: 'hoch',
        // ÜBERFÄLLIG: gestern. Der rote Zweig von `fristlage()`.
        tageVersatz: -1,
        auftrag: true, lead: false, quelle: 'mensch', quelleJob: null, team: false,
      },
      {
        titel: 'Anfrage beantworten',
        beschreibung: 'Der Kunde wartet auf eine Rückmeldung zum Angebot.',
        prioritaet: 'normal',
        // HEUTE fällig — der gelbe Zweig.
        tageVersatz: 0,
        auftrag: false, lead: true, quelle: 'mensch', quelleJob: null, team: true,
      },
      {
        titel: 'Postfach seit drei Tagen ohne Eingang',
        beschreibung:
          'Der Wächter hat keinen Eingang im Bewerbungspostfach gefunden. '
          + 'Das kann richtig sein — oder der Abruf ist stillgefallen.',
        prioritaet: 'normal',
        // OHNE FRIST und OHNE BEZUG: der Befund betrifft einen Job, nicht eine
        // Zeile. Genau der Fall, für den `aufgabe_job_uk` `NULLS NOT DISTINCT`
        // trägt.
        tageVersatz: null,
        auftrag: false, lead: false, quelle: 'zeitplan',
        quelleJob: 'waechter:postfach_stumm', team: false,
      },
    ];

    for (const v of vorlagen) {
      const [vorhanden] = await sql<{ id: string }[]>`
        select id from aufgabe
         where mandant_id = ${konto.mandant_id} and titel = ${v.titel}
           and geloescht_am is null`;
      if (vorhanden !== undefined) continue;

      const auftragId = v.auftrag ? bezug?.auftrag_id ?? null : null;
      const leadId = v.lead ? bezug?.lead_id ?? null : null;
      await sql`
        insert into aufgabe
          (mandant_id, titel, beschreibung, prioritaet, faellig_datum,
           zugewiesen_an, zugewiesen_team_id, auftrag_id, lead_id,
           quelle, quelle_job, erstellt_von)
        values (
          ${konto.mandant_id}, ${v.titel}, ${v.beschreibung},
          ${v.prioritaet}::prioritaet,
          ${v.tageVersatz === null
            ? null
            : sql`(app.berlin_heute() + ${v.tageVersatz}::int)`},
          ${v.team ? null : konto.id},
          ${v.team ? teamId : null},
          ${auftragId}, ${leadId},
          ${v.quelle}::ausloeser, ${v.quelleJob},
          ${v.quelle === 'mensch' ? konto.id : null})`;
      aufgaben += 1;
    }

    /* ------------------------------------------------------------- Faden */
    const betreff = 'Schlüsselübergabe abstimmen';
    const [vorhandenerFaden] = await sql<{ id: string }[]>`
      select id from nachricht
       where mandant_id = ${konto.mandant_id} and betreff = ${betreff}
         and geloescht_am is null`;
    if (vorhandenerFaden === undefined) {
      const [wurzel] = await sql<{ id: string; thread_id: string }[]>`
        insert into nachricht
          (mandant_id, betreff, koerper, richtung, kanal, akteur_art,
           absender_benutzer_id, erstellt_von)
        values (${konto.mandant_id}, ${betreff},
                ${'Bitte den Termin für die Übergabe am Objekt bestätigen — '
                  + 'danach hinterlegen wir die Quittung im Schlüsselbuch.'},
                'intern', 'portal', 'mensch', ${konto.id}, ${konto.id})
        returning id, thread_id`;

      /* Empfänger: die erste Beschäftigung dieser Gesellschaft — als PERSON
       * und nicht als Anmeldung, denn EMP-11 adressiert den Menschen (D-09). */
      const erste = beschaeftigungen[0];
      if (erste !== undefined) {
        await sql`
          insert into nachricht_empfaenger
            (mandant_id, nachricht_id, empfaenger_typ, empfaenger_id, art, erstellt_von)
          values (${konto.mandant_id}, ${wurzel!.id}, 'person', ${erste.person_id},
                  'an', ${konto.id})
          on conflict do nothing`;
      }

      /* Eine Antwort, damit der Faden ein Faden ist und nicht ein Zettel.
       * `antwortet_auf_id` setzt `trg_thread_id` die Wurzel. */
      await sql`
        insert into nachricht
          (mandant_id, koerper, richtung, kanal, akteur_art,
           absender_benutzer_id, antwortet_auf_id, erstellt_von)
        values (${konto.mandant_id},
                'Der Termin passt. Ich bringe die Quittungsmappe mit.',
                'intern', 'portal', 'mensch', ${konto.id}, ${wurzel!.id}, ${konto.id})`;
      faeden += 1;
    }
  }

  return { teams, mitglieder, aufgaben, faeden };
}
