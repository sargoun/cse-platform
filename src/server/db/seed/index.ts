/**
 * `pnpm db:seed` — realistische Berliner Demodaten fuer alle vier Bereiche.
 *
 * Der Seed laeuft als Eigentuemer, ohne angemeldeten Benutzer. Die Trigger
 * kennen diesen Weg ausdruecklich (0008, 0013): ohne Benutzer laeuft kein
 * Editor, sondern eine Migration — und die hat keine Rolle, deren Rechte man
 * pruefen koennte. Die FACHLICHEN Pruefungen gelten fuer ihn genauso.
 *
 * Was hier PLATZHALTER ist, steht als Platzhalter drin und nicht als Tatsache:
 * die Rechnungsnummernmaske ist O-134 und unbeantwortet. Fuer die drei
 * Gesellschaften, die eine eigene Rechtseinheit sind, entsteht deshalb ein
 * Kreis mit `ist_platzhalter = true` — er vergibt keine Nummern, bis jemand
 * die Maske bestaetigt. Das ist kein Mangel des Seeds, sondern die richtige
 * Antwort auf eine offene Frage.
 */
import postgres from 'postgres';
import { DATENSCHUTZ_VERSION, FORMULARE } from './formulare.js';
import { seedOperations } from './operations.js';
import { seedDienstplan } from './dienstplan.js';
import { seedQualifikationen } from './qualifikation.js';
import { seedAuftrag } from './auftrag.js';
import { seedZeit } from './zeit.js';
import { seedKonten } from './konto.js';
import { seedSecurity } from './security.js';
import { seedWachbuch } from './wachbuch.js';
import { seedReinigung } from './reinigung.js';
import { seedVertrieb } from './vertrieb.js';
import { seedBau } from './bau.js';

const url = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
if (url === undefined || url === '') {
  throw new Error('DATABASE_URL fehlt — der Seed hat kein Ziel.');
}
const sql = postgres(url, { max: 1, onnotice: () => {} });

const heute = new Date().toISOString().slice(0, 10);

interface Bereich {
  readonly slug: string;
  readonly name: string;
  readonly firma: string;
  readonly rechtsform: string | null;
  readonly rechtseinheit: boolean | null;
  readonly farbe: string;
}

/**
 * Die vier Bereiche. `operations` traegt `ist_rechtseinheit = NULL`, weil
 * O-01 offen ist: ob CSE Operations eine GmbH mit eigenem Rechnungskreis ist
 * oder eine Abteilung, hat der Mandant nicht beantwortet. NULL ist der einzige
 * neutrale Wert — `true` oder `false` waere eine stille Entscheidung.
 */
const BEREICHE: readonly Bereich[] = [
  { slug: 'reinigung', name: 'CSE Dienstleistung', firma: 'CSE Dienstleistungen GmbH',
    rechtsform: 'GmbH', rechtseinheit: true, farbe: 'reinigung' },
  { slug: 'security', name: 'SSE Security', firma: 'Select-Security Event GmbH',
    rechtsform: 'GmbH', rechtseinheit: true, farbe: 'security' },
  { slug: 'bau', name: 'REALTIME Service', firma: 'REALTIME Service GmbH',
    rechtsform: 'GmbH', rechtseinheit: true, farbe: 'bau' },
  { slug: 'operations', name: 'CSE Operations', firma: 'CSE Operations',
    rechtsform: null, rechtseinheit: null, farbe: 'operations' },
];

/**
 * Holt oder legt eine `auth.users`-Zeile an — LESEN ZUERST.
 *
 * `insert … on conflict do nothing` half hier nicht: die Supabase-Attrappe
 * traegt auf `email` keine Eindeutigkeit, also gab es keinen Konflikt, den
 * Postgres haette verschlucken koennen. Der zweite Seed-Lauf legte eine ZWEITE
 * Zeile mit derselben Adresse an, bekam eine neue id und scheiterte erst eine
 * Anweisung spaeter an `benutzer_email_key` — mit einer Fehlermeldung, die auf
 * `benutzer` zeigte, waehrend der Fehler in `auth.users` lag.
 *
 * Ein Seed, der beim zweiten Lauf bricht, wird genau einmal ausgefuehrt und
 * danach gemieden.
 */
async function authBenutzer(email: string): Promise<string> {
  const [vorhanden] = await sql<{ id: string }[]>`
    select id from auth.users where email = ${email} limit 1`;
  if (vorhanden !== undefined) return vorhanden.id;
  const [neu] = await sql<{ id: string }[]>`
    insert into auth.users (email) values (${email}) returning id`;
  return neu!.id;
}

async function main(): Promise<void> {
  process.stdout.write('Seed startet…\n');

  // ---------------------------------------------------------------- Bereiche
  const ids = new Map<string, string>();
  for (const [i, b] of BEREICHE.entries()) {
    /**
     * Die USt-IdNr. steht IM SELBEN INSERT, nicht in einem UPDATE danach.
     *
     * `mandant_ustg14_vollstaendig` prueft beim Einfuegen: wer einen eigenen
     * Rechnungskreis hat, muss Anschrift und Steuernummer tragen — eine
     * Gesellschaft kann keine Rechnung aus einem Kreis stellen, aus dem sie
     * nicht rechtmaessig fakturieren darf (§ 14 UStG). Erst die Zeile anzulegen
     * und die Pflichtangaben nachzureichen, geht deshalb gar nicht, und das
     * ist richtig so.
     *
     * **`eigener_nummernkreis` wird beim Wiedertreffen MITGEZOGEN**, und das
     * ist kein Detail. Der Zweig weiter unten legt fuer jede Rechtseinheit
     * einen `nummernkreis`-Kreis an, und `kern.nummernkreis_pruefen` verlangt
     * dafuer `mandant.eigener_nummernkreis = true` (TEN-02). Trifft der Seed
     * auf Mandanten, die eine andere Fixtur schon angelegt hat — die
     * Isolationssuite tut genau das, `tests/isolation/harness.ts` legt die vier
     * Bereiche mit dem Vorgabewert `false` an —, dann liess das alte
     * `do update set name` diesen Wert stehen, und der Seed brach mit
     * „ausgangsrechnung erfordert mandant.eigener_nummernkreis = true" ab.
     *
     * Sichtbar wurde das als eine WANDERNDE Fehlermeldung: welche Testdatei es
     * traf, hing an der Reihenfolge, in der Vitest die Dateien ausfuehrt, und
     * die aendert sich mit jeder neuen Datei. Ein Seed, der auf einer frischen
     * Datenbank laeuft und auf einer benutzten nicht, ist genau die Sorte
     * Fehler, die man dreimal beim Falschen sucht.
     */
    const rechtseinheit = b.rechtseinheit === true;
    const [z] = await sql<{ id: string }[]>`
      insert into mandant
        (slug, name, firma, rechtsform, ist_rechtseinheit, eigener_nummernkreis,
         strasse, plz, ort, land, telefon, email, farbe_token, module, sortierung,
         ust_id, handelsregister_gericht, handelsregister_nummer)
      values
        (${b.slug}, ${b.name}, ${b.firma}, ${b.rechtsform}, ${b.rechtseinheit},
         ${rechtseinheit},
         'Kurfürstendamm 21', '10719', 'Berlin', 'DE',
         '+49 30 555 0100', ${`kontakt@${b.slug}.cse-gruppe.de`}, ${b.farbe},
         '{}', ${i},
         ${rechtseinheit ? `DE${String(100_000_000 + i)}` : null},
         ${rechtseinheit ? 'Amtsgericht Charlottenburg' : null},
         ${rechtseinheit ? `HRB ${String(200_000 + i)}` : null})
      -- ist_rechtseinheit MUSS mit: der CHECK verbindet beide Spalten, ein
      -- eigener Nummernkreis setzt eine Rechtseinheit voraus. Der Zweig setzte
      -- nur eigener_nummernkreis. Traf er eine Zeile, die von anderswo kam
      -- (tests/isolation/harness.ts gibt ist_rechtseinheit nicht an, es bleibt
      -- NULL), stand danach "eigener Kreis ja, Rechtseinheit unbekannt" da und
      -- der CHECK hielt den ganzen Seed an. Ein Seed, der nur auf einer leeren
      -- Datenbank laeuft, ist keiner: danach fasst ihn niemand mehr an.
      -- Die Identitaetsspalten haengen an derselben Entscheidung und gehen
      -- denselben Weg. (Kommentar als SQL-Zeilen: Backticks in einem
      -- Template-Literal beenden die Zeichenkette.)
      on conflict (slug) do update
        set name = excluded.name,
            ist_rechtseinheit = excluded.ist_rechtseinheit,
            eigener_nummernkreis = excluded.eigener_nummernkreis,
            ust_id = excluded.ust_id,
            handelsregister_gericht = excluded.handelsregister_gericht,
            handelsregister_nummer = excluded.handelsregister_nummer
      returning id`;
    ids.set(b.slug, z!.id);
  }
  process.stdout.write(`  ${ids.size} Bereiche\n`);

  // ------------------------------------------------------ Unternehmensprofile
  /**
   * Ein Profil je Gesellschaft — mit dem GEWERK als Kurzbeschreibung.
   *
   * Der Text ist kein Werbetext, sondern der Gewerkename, der ohnehin in
   * `CLAUDE.md` und in `routen.ts` steht: "Gebäudereinigung",
   * "Sicherheits- und Objektschutzdienste", "Hochbau, Ausbau, Rückbau". Was
   * darüber hinausgeht — Alleinstellung, Referenzen, Tonfall — schreibt der
   * Mandant; erfundene Werbesätze sähen fertig aus und würden nie ersetzt
   * (PR 14: "NOT: copywriting").
   *
   * Ohne diese Zeilen bleiben die vier Markenkarten der Startseite ohne
   * Anspruchstext, und PUB-03 verlangt sie.
   */
  const GEWERK: Readonly<Record<string, string>> = {
    reinigung: 'Gebäudereinigung',
    security: 'Sicherheits- und Objektschutzdienste',
    bau: 'Hochbau, Ausbau, Rückbau',
    operations: 'Digitale Abläufe, Auswertung und Gruppensteuerung',
  };
  /**
   * Dasselbe Gewerk auf Englisch — eine ZEILE je Sprache (D-82, 0019).
   *
   * Es ist eine Uebersetzung und keine zweite Aussage: was hier steht und in
   * `GEWERK` nicht, hat niemand geprueft. `operations` bleibt bewusst so
   * nuechtern wie deutsch.
   */
  const TRADE: Readonly<Record<string, string>> = {
    reinigung: 'Building cleaning',
    security: 'Security and premises protection services',
    bau: 'Structural work, fit-out, demolition',
    operations: 'Digital operations, analysis and group management',
  };
  for (const b of BEREICHE) {
    for (const [sprache, text] of [['de', GEWERK[b.slug]!], ['en', TRADE[b.slug]!]] as const) {
      await sql`
        insert into unternehmensprofil (mandant_id, sprache, kurzbeschreibung, status)
        values (${ids.get(b.slug)!}, ${sprache}, ${text}, 'veroeffentlicht')
        on conflict do nothing`;
    }
  }
  process.stdout.write('  8 Unternehmensprofile (de + en; Kurztext = Gewerk, Werbetext offen)\n');

  // ------------------------------------------------------------ Super-Admin
  /**
   * Ein Konto, das die Plattform aufschliesst. MIT zweitem Faktor, denn
   * `benutzer_2fa_pflicht` laesst `super_admin` sonst gar nicht `aktiv`
   * werden — und `app.ist_super_admin()` verlangt zusaetzlich eine
   * aal2-SITZUNG. Der Faktor gehoert der Anmeldung, nicht dem Konto.
   */
  const adminId = await authBenutzer('admin@cse-gruppe.de');

  /**
   * Erst lesen, dann schreiben — `on conflict do nothing` greift hier NICHT.
   *
   * `auth.mfa_factors` traegt nur einen Primaerschluessel auf der erzeugten
   * `id`, keine Eindeutigkeit auf `user_id`. Der Konflikt trat also nie ein,
   * und jeder Seed-Lauf legte einen weiteren Faktor an — bei einem Seed, der
   * ausdruecklich wiederholbar sein soll.
   */
  await sql`
    insert into auth.mfa_factors (user_id)
    select ${adminId}
     where not exists (select 1 from auth.mfa_factors f where f.user_id = ${adminId})`;

  const [sa] = await sql<{ id: string }[]>`
    select id from rolle where schluessel = 'super_admin' and mandant_id is null`;

  await sql`
    insert into benutzer (id, email, name, globale_rolle_id, status)
    values (${adminId}, 'admin@cse-gruppe.de', 'Gruppen-Administration', ${sa!.id}, 'aktiv')
    on conflict (id) do update set status = 'aktiv'`;
  process.stdout.write('  1 Super-Admin (admin@cse-gruppe.de)\n');

  // --------------------------------------------------- Website-Renderer
  /**
   * Der Dienstprinzipal, unter dem die oeffentliche Website liest
   * (03-AUTH §14.3).
   *
   * **Warum ueberhaupt einer.** `mandant` traegt RLS: `t_mandant_lesen` gibt
   * nur frei, was `app.sichtbare_mandanten()` nennt, und eine Verbindung ohne
   * Sitzung sieht darum NULL Gesellschaften. Firma, Anschrift und Telefon —
   * also der ganze NAP-Block, das Impressum und jeder `LocalBusiness`-Eintrag —
   * blieben leer. Nicht kaputt: leer, und eine leere Adresse faellt beim
   * Entwickeln niemandem auf.
   *
   * **Warum er nichts darf ausser lesen.** Er haelt `oeffentlich.lesen` und
   * `gruppe.oeffentlich.lesen` und sonst nichts, laeuft mit
   * `app.readonly = 'on'` und hat keine globale Rolle. Er ist die zum Internet
   * offene Haelfte des Systems; wer sie uebernimmt, bekommt damit keinen
   * Schreibpfad. Die Formularannahme (REQ-01) ist ein ZWEITER Prinzipal mit
   * anderen Rechten — deshalb zwei und nicht einer.
   */
  const rendererId = await authBenutzer('renderer@cse-gruppe.de');

  const [vorhandeneRolle] = await sql<{ id: string }[]>`
    select id from rolle
     where schluessel = 'website_renderer' and mandant_id is null
       and archiviert_am is null`;
  const rendererRolle = vorhandeneRolle?.id ?? (await sql<{ id: string }[]>`
    insert into rolle (schluessel, bezeichnung, beschreibung, geltungsbereich,
                       portal, ist_system)
    values ('website_renderer', 'Website-Renderer',
            'Liest die veröffentlichten Inhalte für die öffentliche Website. '
            || 'Kein Schreibrecht, keine globale Rolle (03-AUTH §14.3).',
            'mandant', 'intern', true)
    returning id`)[0]!.id;

  for (const schluessel of ['oeffentlich.lesen', 'gruppe.oeffentlich.lesen']) {
    await sql`
      insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
      select ${rendererRolle}, b.id, null, true
        from berechtigung b where b.schluessel = ${schluessel}
      on conflict (rolle_id, berechtigung_id, mandant_id) do nothing`;
  }

  await sql`
    insert into benutzer (id, email, name, ist_dienstkonto, status)
    values (${rendererId}, 'renderer@cse-gruppe.de', 'Website-Renderer', true, 'aktiv')
    on conflict (id) do update set status = 'aktiv', ist_dienstkonto = true`;

  for (const b of BEREICHE) {
    await sql`
      insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
      values (${rendererId}, ${ids.get(b.slug)!}, ${rendererRolle})
      on conflict do nothing`;
  }

  /**
   * Woher die Anwendung ihn kennt.
   *
   * Nicht aus einer Umgebungsvariablen: die haette in jeder Umgebung gesetzt
   * werden muessen, und eine fehlende haette die Website still leer
   * ausgeliefert. Die Zeile hier ist Teil desselben Seeds, der den Prinzipal
   * anlegt — beide sind da oder beide fehlen, und `withOeffentlich` sagt es
   * laut, wenn sie fehlen.
   */
  await sql`
    insert into plattform_einstellung (schluessel, wert, beschreibung, ist_vorlaeufig)
    values ('website.renderer_benutzer', to_jsonb(${rendererId}::text),
            'Dienstprinzipal der öffentlichen Website (03-AUTH §14.3).', false)
    on conflict (schluessel) do update set wert = excluded.wert`;
  process.stdout.write('  1 Website-Renderer (nur oeffentlich.lesen)\n');

  // -------------------------------------------------- Formular-Eingang
  /**
   * Der ZWEITE Dienstprinzipal (03-AUTH §14.3) — er schreibt, und er liest nicht.
   *
   * Der Website-Renderer haelt `oeffentlich.lesen` und laeuft mit
   * `app.readonly = 'on'`; er koennte eine Einsendung nicht speichern. Ein
   * einziger Prinzipal fuer beides haette bedeutet: wer die zum Internet offene
   * Leseflaeche uebernimmt, bekommt einen Schreibweg dazu.
   *
   * Er haelt `formular.schreiben` und `dokument.schreiben` (fuer das
   * REQ-04-Leistungsverzeichnis) — aber ausdruecklich **nicht**
   * `formular.lesen`: er nimmt Einsendungen entgegen und kann keine
   * zurueckholen. Wer ihn uebernimmt, bekommt kein Archiv fremder Anfragen.
   */
  const eingangId = await authBenutzer('formular@cse-gruppe.de');

  const [vorhandeneEingangRolle] = await sql<{ id: string }[]>`
    select id from rolle where schluessel = 'formular_eingang' and mandant_id is null
      and archiviert_am is null`;
  const eingangRolle = vorhandeneEingangRolle?.id ?? (await sql<{ id: string }[]>`
    insert into rolle (schluessel, bezeichnung, beschreibung, geltungsbereich,
                       portal, ist_system)
    values ('formular_eingang', 'Formular-Eingang',
            'Nimmt öffentliche Angebotsanfragen entgegen. Schreibt formular_eingang '
            || 'und dokument, liest keines von beiden (03-AUTH §14.3).',
            'mandant', 'intern', true)
    returning id`)[0]!.id;

  /**
   * Fuenf Rechte, und `crm.lesen` ist bewusst NICHT dabei.
   *
   * Er muss einen Lead ANLEGEN koennen, nicht Leads lesen. Mit `crm.lesen`
   * haette der zum Internet offene Prinzipal die gesamte Vertriebspipeline
   * lesen koennen — deshalb schreibt die Annahme ohne `RETURNING` und erzeugt
   * ihre Kennungen selbst.
   */
  for (const schluessel of ['oeffentlich.lesen', 'formular.schreiben',
                            'dokument.schreiben', 'crm.schreiben',
                            'crm.kommunikation_versenden']) {
    await sql`
      insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
      select ${eingangRolle}, b.id, null, true
        from berechtigung b where b.schluessel = ${schluessel}
      on conflict (rolle_id, berechtigung_id, mandant_id) do nothing`;
  }

  await sql`
    insert into benutzer (id, email, name, ist_dienstkonto, status)
    values (${eingangId}, 'formular@cse-gruppe.de', 'Formular-Eingang', true, 'aktiv')
    on conflict (id) do update set status = 'aktiv', ist_dienstkonto = true`;

  for (const b of BEREICHE) {
    await sql`
      insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
      values (${eingangId}, ${ids.get(b.slug)!}, ${eingangRolle})
      on conflict do nothing`;
  }

  await sql`
    insert into plattform_einstellung (schluessel, wert, beschreibung, ist_vorlaeufig)
    values ('website.eingang_benutzer', to_jsonb(${eingangId}::text),
            'Dienstprinzipal der Formularannahme (03-AUTH §14.3).', false)
    on conflict (schluessel) do update set wert = excluded.wert`;
  process.stdout.write('  1 Formular-Eingang (schreibt, liest nicht)\n');

  // ------------------------------------------------------------- Formulare
  /**
   * Ein Formular je Bereich — mit VORLAEUFIGEM SLA.
   *
   * `sla_stunden = 24` ist eine Annahme, keine Mandantenregel: ob die Frist in
   * Kalender- oder Werktagsstunden laeuft und wann sie an einem Freitagabend
   * beginnt, ist offen (O-14). Sie steht deshalb in der Zeile und nicht als
   * Spalten-DEFAULT — eine per Schema gesetzte Frist findet spaeter niemand
   * als Entscheidung wieder — und die Oberflaeche weist sie als vorlaeufig aus.
   *
   * Auch das Formular fuer CSE Operations ist vorlaeufig (O-61): welche
   * Felder der Bereich wirklich braucht, um ein Angebot zu rechnen, weiss der
   * Mandant.
   */
  let formulare = 0;
  for (const vorlage of FORMULARE) {
    const mandantId = ids.get(vorlage.slug)!;
    const [vorhanden] = await sql<{ id: string }[]>`
      select id from formular_definition
       where mandant_id = ${mandantId} and schluessel = ${vorlage.schluessel}
         and version = 1`;
    const formularId = vorhanden?.id ?? (await sql<{ id: string }[]>`
      insert into formular_definition
        (mandant_id, schluessel, version, titel, felder,
         datenschutz_hinweis_version, veroeffentlicht_am)
      values (${mandantId}, ${vorlage.schluessel}, 1, ${vorlage.titel},
              ${sql.json(vorlage.felder as never)}, ${DATENSCHUTZ_VERSION}, now())
      returning id`)[0]!.id;

    await sql`
      insert into formular_zustaendigkeit
        (mandant_id, formular_definition_id, sla_stunden,
         standard_besitzer_benutzer_id, eskalation_benutzer_id)
      values (${mandantId}, ${formularId}, 24, ${adminId}, ${adminId})
      on conflict (formular_definition_id) do nothing`;
    formulare += 1;
  }
  process.stdout.write(
    `  ${String(formulare)} Formulare — alle Werte VORLÄUFIG, siehe docs/ANNAHMEN.md\n`);

  // ------------------------------------------------- Anzeigename der Gruppe
  /**
   * Der Name, unter dem die Website auftritt — als VORLAEUFIGE Einstellung.
   *
   * Er steht in der Datenbank und nicht im Markup, weil er an drei Stellen
   * erscheint (Kopf, Fussbereich, `WebSite`-JSON-LD) und drei Literale
   * auseinanderlaufen. `ist_vorlaeufig` bleibt gesetzt: ob "CSE Gruppe" ein
   * Rechtstraeger ist oder nur eine Klammer ueber vier Gesellschaften, ist
   * offen (O-206) — und davon haengt ab, ob ein `Organization`-Block ueberhaupt
   * entstehen darf.
   *
   * Der Schluessel liegt unter `website.` und NICHT unter `gruppe.`: `gruppe`
   * ist der Modulname der Gruppenansicht im Rechtekatalog (K-19), und ein
   * Einstellungsschluessel, der wie ein Rechteschluessel aussieht, wird von der
   * K-19-Pruefung als unregistriertes Recht gemeldet — zu Recht, denn genau so
   * entsteht sonst ein dauerhaft leerer Bildschirm.
   */
  await sql`
    insert into plattform_einstellung (schluessel, wert, beschreibung, ist_vorlaeufig)
    values ('website.gruppenname', '"CSE Gruppe"'::jsonb,
            'Auftrittsname der Gruppe auf der Website (VORLÄUFIG, O-206).', true)
    on conflict (schluessel) do nothing`;

  // --------------------------------------------------------------- Menschen
  /**
   * Fatima ist der D-09-Fall: ein Mensch, zwei Gesellschaften, zwei Saetze.
   *
   * **Alle vier Portalsprachen stehen im Seed** (EMP-12) — und jede an EINEM
   * Menschen. Das ist keine Kosmetik: die Sprache haengt an `person.sprache`
   * und an sonst nichts (SEITENKARTE §12), eine Pruefung kann sie also nur
   * ansehen, indem sie sich als der betreffende Mensch anmeldet.
   *
   * Fatima spricht DEUTSCH, obwohl sie die meistbenutzte Fixtur ist — genau
   * deshalb. Solange sie tuerkisch war, setzte jede Pruefung, die einen
   * deutschen Satz erwartete, vorher `person.sprache` auf `de` zurueck; bei
   * `fullyParallel` schrieben mehrere Arbeiter gleichzeitig in dieselbe Zeile,
   * und die Suite fiel an wechselnden Stellen um. Eine gemeinsame Zeile, die
   * Pruefungen veraendern muessen, ist kein Fixturdetail, sondern ein Rennen.
   * Tuerkisch steht jetzt bei Marta, Arabisch bei Amir, Englisch bei Kwame.
   */
  const menschen: readonly (readonly [string, string, string])[] = [
    ['Fatima', 'Yildiz', 'de'],
    ['Jonas', 'Berger', 'de'],
    ['Amir', 'Haddad', 'ar'],
    ['Marta', 'Kowalski', 'tr'],
    ['Kwame', 'Mensah', 'en'],
    /**
     * **Und die vier, die bisher keine Menschen waren** (D-09).
     *
     * `leitung.security`, `leitung.bau`, `admin.reinigung` und `admin.bau`
     * standen als reine `benutzer`-Zeilen da: eine Anmeldung ohne Person und
     * ohne Beschaeftigung. Das sah wie ein Schoenheitsfehler aus und war
     * keiner. `schreibeEintrag` loest den Urheber einer Wachbuchseite ueber
     * `anstellung where person_id = app.aktuelle_person()` auf und wirft
     * sonst `KeinUrheber` (422, §10.5) — die Wachleitung der SSE Security
     * konnte im geseedeten Bestand also keine einzige Seite fuehren, und der
     * Grund stand nicht auf dem Bildschirm, sondern in einer Fremdschluessel-
     * bedingung. Dieselbe Luecke traf jede andere Stelle, die den HANDELNDEN
     * als Beschaeftigte fuehrt.
     *
     * Ein Konto ist keine Person, und eine Person ist keine Beschaeftigung:
     * deshalb entsteht hier der Mensch, unten die Beschaeftigung in SEINER
     * Gesellschaft, und beim Konto nur die Verbindung `benutzer.person_id`.
     */
    ['Katrin', 'Lehmann', 'de'],
    ['Thomas', 'Schröder', 'de'],
    ['Silke', 'Neumann', 'de'],
    ['Hakan', 'Demir', 'de'],
    /**
     * **Und die zwei, die den Bestand erst symmetrisch machen.**
     *
     * Der Seed trug `admin` in Reinigung und Bau, `leitung` in Bau und
     * Security — also in keiner der drei Gesellschaften BEIDE. Was daraus
     * folgte, sah je Gesellschaft nach einer fehlenden Funktion aus:
     *
     *   * In der SSE Security konnte NIEMAND eine Rechnung festschreiben
     *     (`finanzen.festschreiben` haelt `admin`, `leitung` nicht), keinen
     *     LV-Preis lesen (`bau.preis_lesen`) und die Einstellungen nicht
     *     oeffnen (`system.einstellung_lesen`).
     *   * In der Reinigung fehlte umgekehrt die Ebene, die planen und
     *     gegenzeichnen darf, ohne Verwaltungsrechte zu haben — und damit der
     *     Gegenbeweis, dass die Rechtematrix an dieser Grenze wirklich
     *     trennt.
     *
     * Eine Rolle, die in keiner Demogesellschaft besetzt ist, laesst sich
     * nicht vorfuehren und nicht widerlegen.
     */
    ['Nadia', 'Özkan', 'de'],
    ['Peter', 'Brandt', 'de'],
  ];

  /**
   * LESEN ZUERST, wie ueberall in diesem Seed — und hier ist es keine Kosmetik.
   *
   * `person` traegt keinen natuerlichen Schluessel, also gab es fuer den
   * frueheren blanken `insert` nie einen Konflikt: ein zweiter Seed-Lauf legte
   * fuenf WEITERE Menschen an. Die Beschaeftigungen darunter prallten dagegen
   * an `anstellung_personalnummer_uk` ab und blieben bei den ALTEN Personen —
   * und weil der Kontenzweig weiter unten `person_id = excluded.person_id`
   * setzt, zeigte danach jedes Konto auf einen Menschen OHNE Beschaeftigung.
   * Genau der Zustand, den Teil 1 dieser Aenderung beseitigt, waere beim
   * zweiten Lauf zurueckgekehrt: `app.aktuelle_person()` antwortet, die
   * Anstellung dazu gibt es nicht, und das Wachbuch wirft wieder
   * `KeinUrheber`.
   *
   * Vor- und Nachname sind fuer diese Fixtur der Schluessel. Das ist fuer
   * echte Personendaten keine Annahme, die man treffen duerfte — fuer
   * Demodaten, die dieselbe Datei erzeugt, ist es die einzige, die es gibt.
   */
  const personIds: string[] = [];
  for (const [vorname, nachname, sprache] of menschen) {
    const [da] = await sql<{ id: string }[]>`
      select id from person
       where vorname = ${vorname} and nachname = ${nachname} and geloescht_am is null
       limit 1`;
    if (da !== undefined) { personIds.push(da.id); continue; }
    const [p] = await sql<{ id: string }[]>`
      insert into person (vorname, nachname, sprache, telefon)
      values (${vorname}, ${nachname}, ${sprache},
              ${`+49 170 ${String(1_000_000 + personIds.length)}`})
      returning id`;
    personIds.push(p!.id);
  }

  /**
   * Beschaeftigungen. Alles Kostenrelevante haengt hier, nicht an `person`.
   *
   * Der vierte Wert ist `stundensatz_intern` in ganzen Cent (Invariante 1).
   * Er ist bei den sechs gewerblichen Beschaeftigungen ein DEMOWERT und bei
   * den vier Fuehrungs- und Verwaltungsstellen `null` — nicht aus
   * Bequemlichkeit:
   * // TODO(client, O-347): In welcher Beschäftigungsform stehen die
   * Führungs- und Verwaltungskräfte der drei Gesellschaften, und wird ihre
   * Vergütung als Stundensatz geführt oder als Festgehalt, das die Plattform
   * gar nicht trägt?
   * Eine erfundene Zahl waere genau der Fall, den `docs/DECISIONS.md`
   * verbietet: sie saehe bestaetigt aus, ginge in jede Kalkulation ein und
   * fiele niemandem mehr auf. `arbeitszeitmodell` bleibt bei allen auf dem
   * Vorgabewert `unbekannt` (O-18) — auch das ist eine offene Frage und kein
   * Versaeumnis.
   */
  const anstellungen: readonly (readonly [number, string, string, number | null])[] = [
    [0, 'reinigung', 'R-1001', 1450],   // Fatima, Reinigung
    [0, 'security', 'S-2001', 1780],    // dieselbe Fatima, Sicherheit
    [1, 'reinigung', 'R-1002', 1400],
    [2, 'security', 'S-2002', 1690],
    [3, 'bau', 'B-3001', 2150],
    [4, 'reinigung', 'R-1003', 1400],
    // Die vier Fuehrungs- und Verwaltungsstellen, je in IHRER Gesellschaft.
    [5, 'security', 'S-2003', null],    // Katrin Lehmann, Wachleitung
    [6, 'bau', 'B-3002', null],         // Thomas Schröder, Bauleitung
    [7, 'reinigung', 'R-1004', null],   // Silke Neumann, Objektverwaltung
    [8, 'bau', 'B-3003', null],         // Hakan Demir, Baubüro
    [9, 'security', 'S-2004', null],    // Nadia Özkan, Verwaltung Security
    [10, 'reinigung', 'R-1005', null],  // Peter Brandt, Objektleitung
  ];
  for (const [person, bereich, nummer, satz] of anstellungen) {
    await sql`
      insert into anstellung
        (mandant_id, person_id, personalnummer, eintritt, stundensatz_intern, status)
      values (${ids.get(bereich)!}, ${personIds[person]!}, ${nummer}, '2024-01-01',
              ${satz}, 'aktiv')
      on conflict do nothing`;
  }
  process.stdout.write(
    `  ${menschen.length} Menschen, ${anstellungen.length} Beschäftigungen `
    + '(Vergütung der Leitungen offen: O-347)\n');

  // --------------------------------------------------------- Nummernkreise
  /**
   * Fuer jede Rechtseinheit ein Rechnungskreis — als PLATZHALTER.
   *
   * O-134 ist offen: ob die Rechnungsnummer je Gesellschaft fortlaufend
   * weiterlaeuft oder am 1. Januar neu beginnt, und wie die Maske genau
   * lautet, hat niemand beantwortet. Ein bestaetigter Kreis mit erfundener
   * Maske saehe fertig aus und vergaebe Nummern, die spaeter falsch sind —
   * und eine vergebene Rechnungsnummer nimmt man nicht zurueck.
   */
  for (const b of BEREICHE.filter((x) => x.rechtseinheit === true)) {
    await sql`
      insert into nummernkreis
        (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos, format_maske,
         zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
      values (${ids.get(b.slug)!}, 'ausgangsrechnung', 2026,
              'Ausgangsrechnungen (unbestätigt)', true, 'RE-{jahr}-{nr:5}',
              null, ${heute}, true, 'system', 'job:seed')
      on conflict do nothing`;

    // Leistungsnachweise sind kein § 14 UStG-Dokument; ihre Maske ist
    // betrieblich und darf bestaetigt sein.
    await sql`
      insert into nummernkreis
        (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos, format_maske,
         zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
      values (${ids.get(b.slug)!}, 'leistungsnachweis', 2026,
              'Leistungsnachweise', true, 'LN-{jahr}-{nr:5}',
              'jaehrlich', ${heute}, false, 'system', 'job:seed')
      on conflict do nothing`;
    /**
     * Angebot und Auftrag: bestaetigt, weil sie es duerfen.
     *
     * Beide sind KEIN § 14 UStG-Dokument. Ihre Nummer ist betrieblich, ihre
     * Folge darf Luecken haben (ein verworfener Entwurf zieht keine Nummer),
     * und ihre Maske ist eine Hausentscheidung — nicht die offene Frage
     * O-134, die nur die Rechnungsnummer betrifft. Ein Platzhalterkreis hier
     * hiesse: kein Angebot kann versendet werden, und zwar ohne dass irgendwer
     * eine Frage beantworten muesste.
     */
    await sql`
      insert into nummernkreis
        (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos, format_maske,
         zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
      values (${ids.get(b.slug)!}, 'angebot', 2026,
              'Angebote', false, 'AN-{jahr}-{nr:5}',
              'jaehrlich', ${heute}, false, 'system', 'job:seed')
      on conflict do nothing`;

    await sql`
      insert into nummernkreis
        (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos, format_maske,
         zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
      values (${ids.get(b.slug)!}, 'auftrag', 2026,
              'Auftraege', false, 'AU-{jahr}-{nr:5}',
              'jaehrlich', ${heute}, false, 'system', 'job:seed')
      on conflict do nothing`;
  }
  process.stdout.write(
    '  Nummernkreise: Rechnung als PLATZHALTER (O-134); Nachweis, Angebot und Auftrag bestätigt\n',
  );

  // ------------------------------------------------------ Agent-Richtlinien
  /** Fail-closed: jede Zeile steht auf `auto_erlaubt = false`. */
  for (const b of BEREICHE) {
    for (const aktion of ['email_senden', 'mahnung_senden', 'social_veroeffentlichen']) {
      await sql`
        insert into agent_richtlinie (mandant_id, aktion, auto_erlaubt, begruendung)
        values (${ids.get(b.slug)!}, ${aktion}, false,
                'Vorgabe: nichts geht ohne menschliche Freigabe raus (Invariante 7).')
        on conflict do nothing`;
    }
  }

  // ------------------------------------------------ Ein Konto je Rolle (PR 19)
  /**
   * Vier Menschen, vier Rollen — damit die Rollenprobe echte Sitzungen hat.
   *
   * **Warum echte Zeilen und keine Testfixtures.** Die Phase-3-Zusage lautet:
   * "ein Mitarbeiterkonto erreicht nichts ausser seinen eigenen Daten,
   * bewiesen durch einen Test". Ein Test, der sich seine Rollen selbst baut,
   * prueft die Rollen, die ER baut. Diese hier sind die Zeilen, die der
   * geseedete Bestand ausliefert — und `benutzer_mandant.rolle_id` bestimmt,
   * was `app.hat_recht` beantwortet und in welches Portal `sitzung_aufloesen`
   * schickt.
   *
   * Der `mitarbeiter` haengt an FATIMA, dem D-09-Fall: ein Mensch, zwei
   * Gesellschaften. Ihr Portal muss beide Beschaeftigungen zeigen und trotzdem
   * keine fremde Zeile — das ist genau die Aussage, die sonst niemand prueft.
   *
   * **Die letzte Spalte ist kein Zierat, sondern `benutzer.person_id`** — und
   * seit dieser Aenderung traegt sie JEDES Konto ausser dem Kundenzugang.
   * Vier Konten standen ohne: `leitung.security`, `leitung.bau`,
   * `admin.reinigung`, `admin.bau`. `app.aktuelle_person()` antwortete fuer
   * sie mit NULL, und alles, was den Handelnden als BESCHAEFTIGTE fuehrt,
   * wies sie ab — das Wachbuch mit `KeinUrheber` (422, §10.5), also genau
   * dort, wo SEC-05 die Wachleitung das Buch fuehren laesst. Ein Konto ohne
   * Mensch ist im Portal nicht halb angemeldet, sondern an jeder zweiten
   * Stelle unerklaerlich ausgesperrt.
   *
   * **`benutzer.name` bleibt trotzdem die FUNKTION** („Leitung Security"),
   * nicht der Name des Menschen. Das Konto ist der Platz in der
   * Gesellschaft, der Mensch darauf steht in `person` — und genau von dort
   * liest das Wachbuch seinen Urheber. Die Browsersuite waehlt ihre Konten
   * ueber `data-email` (`tests/e2e/hilfen/anmeldung.ts`) und nicht ueber
   * diesen Text; er darf deshalb bleiben, was er beschreibt.
   */
  const rollenIds = new Map<string, string>();
  for (const r of await sql<{ id: string; schluessel: string }[]>`
    select id, schluessel from rolle where mandant_id is null and archiviert_am is null`) {
    rollenIds.set(r.schluessel, r.id);
  }

  const konten: readonly (readonly [string, string, string, string, number | null])[] = [
    ['admin.reinigung@cse-gruppe.de', 'Administration Reinigung', 'admin', 'reinigung', 7],
    ['leitung.bau@cse-gruppe.de', 'Leitung Bau', 'leitung', 'bau', 6],
    /**
     * Und eine Administration fuer den Bau.
     *
     * `bau.preis_lesen` halten laut Rechtematrix nur `admin` und
     * `super_admin` — `leitung` ausdruecklich NICHT. Ohne dieses Konto konnte
     * in den Demodaten KEIN Mensch der REALTIME Service GmbH einen
     * LV-Einheitspreis sehen: das Aufmassblatt zeigte Mengen ohne Geld, und
     * das sah aus wie eine fehlende Funktion. Dieselbe Luecke wie die
     * Gesellschaft ohne Leitung, nur eine Ebene tiefer.
     */
    ['admin.bau@cse-gruppe.de', 'Administration Bau', 'admin', 'bau', 8],
    /**
     * Und eine Leitung fuer die Security.
     *
     * Sie fehlte, und das war keine Kleinigkeit: `security` hatte ausser zwei
     * Mitarbeitenden und zwei Dienstkonten NIEMANDEN. Kein Mensch konnte den
     * Posten planen, eine Wachbuchseite gegenzeichnen oder eine Abwesenheit
     * entscheiden — `/portal/security/**` war fuer jede Anmeldung im Seed
     * leer oder 404. Eine Gesellschaft ohne Leitung ist kein Datenstand,
     * sondern eine Luecke, die wie eine fehlende Funktion aussieht.
     */
    ['leitung.security@cse-gruppe.de', 'Leitung Security', 'leitung', 'security', 5],
    // Fatima: `mitarbeiter` in Reinigung UND Security (D-09).
    ['fatima.yildiz@cse-gruppe.de', 'Fatima Yildiz', 'mitarbeiter', 'reinigung', 0],
    /**
     * Amir ist die Anmeldung, an der RTL zu sehen ist (EMP-12, DESIGN §9).
     *
     * Ohne ein Konto blieb Arabisch eine Zeile in `person` ohne Bildschirm:
     * `/portal/mein` verlangt eine Sitzung, und die einzige Mitarbeiterin im
     * Seed sprach Deutsch. Eine Pruefung konnte RTL deshalb nur ansehen,
     * indem sie die Sprache einer fremden Zeile umschrieb.
     */
    ['amir.haddad@cse-gruppe.de', 'Amir Haddad', 'mitarbeiter', 'security', 2],
    /**
     * Die beiden Konten, die den Bestand symmetrisch machen: jede der drei
     * Gesellschaften hat jetzt eine Verwaltung UND eine Leitung. Warum das
     * keine Kosmetik ist, steht bei den beiden Menschen weiter oben.
     */
    ['admin.security@cse-gruppe.de', 'Administration Security', 'admin', 'security', 9],
    ['leitung.reinigung@cse-gruppe.de', 'Leitung Reinigung', 'leitung', 'reinigung', 10],
    ['kunde.demo@example.test', 'Kundenzugang (Demo)', 'kunde', 'reinigung', null],
  ];

  /**
   * Welche Rollen einen zweiten Faktor verlangen (AUT-02).
   *
   * Gefragt wird GENAU DAS, was `kern.benutzer_2fa_pflicht()` fragt:
   * `rolle.erfordert_2fa`. Der erste Versuch las stattdessen
   * `berechtigung.erfordert_2fa` ueber die Rollenzuweisungen — eine plausible,
   * aber ANDERE Frage, und der Seed fiel weiter um. Zwei Quellen fuer dieselbe
   * Bedingung sind genau die Stelle, an der eine Zusicherung und ihre
   * Vorbereitung auseinanderlaufen.
   */
  const braucht2fa = new Set(
    (await sql<{ schluessel: string }[]>`
      select schluessel from rolle
       where mandant_id is null and erfordert_2fa`).map((r) => r.schluessel),
  );

  for (const [email, name, rolle, bereich, personIndex] of konten) {
    const id = await authBenutzer(email);
    const personId = personIndex === null ? null : personIds[personIndex] ?? null;
    /**
     * Der Faktor kommt VOR dem `aktiv`, und das ist der ganze Punkt.
     *
     * Beim ERSTEN Lauf entsteht die `benutzer`-Zeile, bevor ihr die Rolle
     * zugewiesen wird — `kern.benutzer_2fa_pflicht()` sieht also noch keine
     * 2FA-Rolle und laesst sie durch. Beim ZWEITEN Lauf ist die Rolle da, der
     * Ausloeser feuert, und der Seed starb mit "Konto benoetigt einen zweiten
     * Faktor". Ein Seed, der genau einmal laeuft, ist kein Seed: danach traut
     * sich niemand mehr, ihn anzufassen, und die Demodaten veralten.
     *
     * Der Faktor ist keine Umgehung der Zusicherung, sondern ihre Erfuellung:
     * AUT-02 verlangt, dass ein Konto mit einer 2FA-Rolle einen hinterlegten
     * Faktor HAT. Die aal2-SITZUNG verlangt `app.ist_super_admin()` zusaetzlich
     * — das bleibt unberuehrt.
     */
    if (braucht2fa.has(rolle)) {
      /**
       * `on conflict do nothing` griff hier NIE: `auth.mfa_factors` traegt
       * nur einen Primaerschluessel auf der erzeugten `id`, keine
       * Eindeutigkeit auf `user_id`. Jeder Seed-Lauf legte also einen
       * weiteren Faktor an — und der Seed ist ausdruecklich wiederholbar.
       * Erst lesen, dann schreiben.
       */
      await sql`
        insert into auth.mfa_factors (user_id)
        select ${id}
         where not exists (select 1 from auth.mfa_factors f where f.user_id = ${id})`;
    }
    await sql`
      insert into benutzer (id, email, name, person_id, status)
      values (${id}, ${email}, ${name}, ${personId}, 'aktiv')
      on conflict (id) do update
        set status = 'aktiv', person_id = excluded.person_id`;
    await sql`
      insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
      values (${id}, ${ids.get(bereich)!}, ${rollenIds.get(rolle)!}, true)
      on conflict do nothing`;
    /**
     * Fatima ist in ZWEI Gesellschaften beschaeftigt, also auch dort
     * Benutzerin — und zwar sie, nicht „jede mitarbeiter-Rolle". Die
     * Bedingung stand auf der Rolle, und damit haette jedes weitere
     * Mitarbeiterkonto stillschweigend eine zweite Mitgliedschaft bekommen,
     * die es im Betrieb nicht haette (D-09).
     */
    if (personIndex === 0) {
      await sql`
        insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
        values (${id}, ${ids.get('security')!}, ${rollenIds.get('mitarbeiter')!})
        on conflict do nothing`;
    }
  }
  process.stdout.write(`  ${konten.length} Rollenkonten (admin, leitung, mitarbeiter, kunde)\n`);

  /**
   * Phase 4 — CRM und Operations.
   *
   * Erst HIER, nach den Konten: `kunde_zugang` braucht das Kundenkonto, und
   * ohne diesen Zugang kaeme niemand ins Kundenportal. Die Reihenfolge ist
   * also nicht Geschmack, sondern die Abhaengigkeit selbst.
   */
  const [kundenKonto] = await sql<{ id: string }[]>`
    select id from benutzer where email = 'kunde.demo@example.test' limit 1`;
  const ops = await seedOperations(sql, ids, kundenKonto?.id ?? null);
  process.stdout.write(
    `  ${String(ops.objekte)} Objekte, ${String(ops.raeume)} Raeume, `
    + 'Belagsarten und Reinigungsklassen (Leistungswerte: Platzhalter, O-17)\n',
  );

  /**
   * Der Qualifikationskatalog kommt VOR dem Dienstplan und vor jeder
   * Einteilung: `besetzeEinsatz` fragt `app.einsatz_qualifikation_erfuellt`,
   * und ein leerer Katalog beantwortet jede Frage mit „erfuellt". Ein Seed,
   * der zuerst einteilt und danach die Sperre nachreicht, erzeugt genau die
   * Zeilen, die es im Betrieb nie geben koennte.
   */
  const qual = await seedQualifikationen(sql, ids);
  process.stdout.write(
    `  ${String(qual.qualifikationen)} Qualifikationen (§34a GewO, §11b GewO, `
    + `DGUV V1), ${String(qual.nachweise)} Nachweise — gültig, in der Warnfrist `
    + 'und abgelaufen (Ablauffrist des Bewacherausweises offen: O-341)\n',
  );

  /**
   * Der Dienstplan kommt NACH den Objekten und laesst den echten Generator
   * laufen. Er braucht das Raumbuch nicht, wohl aber ein Objekt mit Kunden —
   * die Reihenfolge ist deshalb eine Abhaengigkeit, keine Vorliebe.
   */
  const plan = await seedDienstplan(sql, ids);
  process.stdout.write(
    `  ${String(plan.reviere)} Reviere, ${String(plan.turnusse)} Turnusse, `
    + `${String(plan.einsaetze)} Einsaetze aus dem Generator (acht Wochen)\n`,
  );

  /**
   * Der Abrechnungsanker kommt NACH dem Dienstplan: er verankert dessen
   * Turnusse und die schon materialisierten Schichten nachtraeglich
   * (TIM-12, FIN-07). Ein Turnus bleibt mit Absicht ohne — er ist der Fall,
   * den `zeiteintrag_ohne_auftrag` melden muss (FIN-18).
   */
  const auftrag = await seedAuftrag(sql, ids);
  process.stdout.write(
    `  ${String(auftrag.auftraege)} Auftrag mit ${String(auftrag.leistungen)} `
    + `Leistungszeilen, ${String(auftrag.verankerteTurnusse)} Turnusse und `
    + `${String(auftrag.verankerteEinsaetze)} Einsaetze verankert (Preise: Demowerte)\n`,
  );

  /**
   * Und zuletzt die Einteilung samt erfasster Zeit — sie braucht den Plan UND
   * den Abrechnungsanker: ein Zeiteintrag erbt seine Leistungszeile von der
   * Schicht (`z_erben`), und ohne den Anker haetten alle Eintraege keinen
   * Auftrag. Die Reihenfolge ist eine Abhaengigkeit, keine Vorliebe.
   */
  const zeit = await seedZeit(sql, ids);
  process.stdout.write(
    `  ${String(zeit.einteilungen)} Einteilungen (davon ${String(zeit.uebergangen)} `
    + `mit bestaetigtem ArbZG-Befund), ${String(zeit.zeiteintraege)} Zeiteintraege `
    + `importiert, ${String(zeit.laufend)} laufend, `
    + `${String(zeit.abwesenheiten)} Abwesenheiten/Antraege, `
    + `${String(zeit.ansprueche)} wartende Nachreichung(en)\n`,
  );

  /**
   * Und die Security bekommt ihren eigenen Plan — NACH `seedZeit`, weil der
   * Besetzungslauf dieselbe Person greift: Fatima arbeitet in beiden
   * Gesellschaften, und die ArbZG-Grenzen gelten ihr und nicht dem Mandanten
   * (D-09). Erst die Reinigung, dann die Security heisst: der Spaetdienst
   * wird gegen die schon gesetzten Frueschichten geprueft und nicht
   * umgekehrt.
   */
  const sec = await seedSecurity(sql, ids);
  process.stdout.write(
    `  ${String(sec.posten)} Posten, ${String(sec.einsaetze)} Einsaetze aus dem `
    + `Generator, ${String(sec.einteilungen)} Einteilungen, `
    + `${String(sec.zeiteintraege)} Zeiteintraege (Qualifikationsbedarf offen: O-342)\n`,
  );

  /**
   * Und darauf das Wachbuch — NACH dem Posten, und das ist eine Abhaengigkeit
   * und keine Reihenfolge nach Geschmack: eine Wachbuchseite traegt das Objekt
   * und den Posten, auf den sie sich bezieht. Ohne `seedSecurity` gaebe es
   * beides nicht, und das Buch stuende leer da — also genau der Bildschirm,
   * den diese Datei fuellen soll.
   *
   * Die zweite Abhaengigkeit liegt weiter oben: der Urheber eines Eintrags ist
   * eine BESCHAEFTIGUNG (§10.5). Sie entsteht im Menschen-Abschnitt, lange
   * bevor hier geschrieben wird — bis dahin hatte die Wachleitung keine, und
   * der Dienst wies jede Seite mit `KeinUrheber` ab.
   */
  const buch = await seedWachbuch(sql, ids.get('security')!, sec.postenId, sec.objektId);
  process.stdout.write(
    `  ${String(buch.eintraege)} Wachbucheintraege über den echten Dienst `
    + `(davon ${String(buch.storniert)} richtiggestellt — beide Seiten bleiben stehen)\n`,
  );

  /**
   * Und die Reinigung bekommt ihren Zuschnitt, ihre Nachweise und ihre
   * Beanstandungen — NACH `seedZeit`, und das ist zweimal eine Abhaengigkeit
   * und keine Reihenfolge nach Geschmack.
   *
   * Erstens entsteht eine Nachweisposition aus einem ZEITEINTRAG, und zwar
   * ueber den dreispaltigen Schluessel Mandant → Auftragsleistung →
   * Zeiteintrag (`lnp_zeiteintrag_fk`). Ohne erfasste Zeit mit
   * Abrechnungsanker gaebe es kein einziges Blatt, und der Nachweisbereich
   * stuende leer da — ohne Fehler, ohne Luecke, nur nichts.
   *
   * Zweitens BESTREITET eine Beanstandung einen Leistungsnachweis (OPS-11,
   * FIN-18): erst der Nachweis, dann die Beschwerde ueber ihn. Umgekehrt
   * bliebe die Spalte, um die es geht, auf jeder Zeile ein Gedankenstrich.
   *
   * Und der Zuschnitt der Reviere selbst haengt an `seedOperations` (Raeume)
   * und `seedDienstplan` (Reviere): beide legen ihre Haelfte an, verbunden hat
   * sie bisher niemand.
   */
  const rein = await seedReinigung(sql, ids);
  process.stdout.write(
    `  ${String(rein.reviere)} Reviere zugeschnitten mit `
    + `${String(rein.revierRaeume)} Raumzuordnungen (davon `
    + `${String(rein.aufPlatzhalter)} auf einem Platzhalter-Leistungswert, O-17), `
    + `${String(rein.nachweise)} Leistungsnachweise mit `
    + `${String(rein.positionen)} Positionen aus erfasster Zeit, `
    + `${String(rein.unterschriften)} Unterschrift (Abzug eingefroren, CLN-04), `
    + `${String(rein.reklamationen)} Reklamationen (Frist bleibt offen: O-14)\n`,
  );
  if (rein.nummerOffen !== null) {
    process.stdout.write(`  · Nachweisnummer nicht gezogen: ${rein.nummerOffen}\n`);
  }

  /**
   * Und darauf der Vertrieb — NACH `seedOperations`, weil er das RAUMBUCH
   * bepreist und nicht eine Liste von Zahlen. Ohne Raeume mit Belagsart gibt
   * es keine Kalkulationsgrundlage, und `uebernimmKalkulation` weist ein
   * Angebot ueber nicht bepreisbare Flaeche ausdruecklich ab (D-97). Die
   * Reihenfolge ist eine Abhaengigkeit, keine Vorliebe.
   */
  const vertrieb = await seedVertrieb(sql, ids);
  if (vertrieb.angebote === 0) {
    // Zweiter Lauf: die Demoangebote stehen schon. Ein versendetes Angebot ist
    // unveraenderlich, und ein zweiter Zug aus dem Angebotskreis waere eine
    // verbrauchte Nummer ohne Beleg.
    process.stdout.write('  Angebote: bereits vorhanden, nichts nachgelegt\n');
  } else {
    process.stdout.write(
      `  ${String(vertrieb.angebote)} Angebote mit ${String(vertrieb.positionen)} `
      + `Positionen aus der Kalkulation (${vertrieb.angebotsnummer ?? 'ohne Nummer'} `
      + `versendet → Auftrag ${vertrieb.auftragsnummer ?? '—'}, `
      + `${String(vertrieb.entwuerfe)} Entwurf ohne Nummer — den sieht der Kunde nicht)\n`,
    );
    if (vertrieb.offeneFragen.length > 0) {
      process.stdout.write(
        `  \u00b7 gerechnet auf Platzhaltern, fuer dieses Angebot bestaetigt: `
        + `${vertrieb.offeneFragen.join(', ')}\n`,
      );
    }
  }

  /**
   * Und das Baugewerk — NACH `seedOperations`, weil Projekt und Bautagebuch am
   * OBJEKT haengen (die Baustelle), und ohne Abhaengigkeit zur Reinigung: es
   * ist eine andere Gesellschaft, ein anderer Kunde, ein anderer Nummernkreis.
   * Der Auftrag entsteht hier direkt, denn ein Bauauftrag kommt aus dem LV des
   * Auftraggebers und nicht aus der Reinigungskalkulation.
   */
  const bau = await seedBau(sql, ids);
  if (bau.projekte === 0) {
    // Zweiter Lauf: das Bauprojekt steht. Ein eingereichter Nachtrag laesst
    // sich nicht zurueckziehen und ein abgeschlossener Bautag nicht aendern.
    process.stdout.write('  Bau: Projekt bereits vorhanden, nichts nachgelegt\n');
  } else {
    process.stdout.write(
      `  ${String(bau.projekte)} Bauprojekt mit ${String(bau.lvZeilen)} LV-Zeilen `
      + `(Auftragssumme ${bau.lvSumme ?? '—'}, ${String(bau.ausgenommen)} Positionen `
      + `ausgenommen: Bedarf und Alternative, O-155), `
      + `${String(bau.aufmassblaetter)} Aufmassblatt mit ${String(bau.aufmassZeilen)} `
      + `Zeilen aus dem Rechenansatz, ${String(bau.nachtraege)} Nachtrag `
      + `${bau.nachtragsnummer ?? ''} eingereicht (mit gebundener Freigabe)\n`,
    );
    process.stdout.write(
      `  ${String(bau.bautage)} Bautage mit ${String(bau.mannstunden)} Mannstundenzeilen `
      + `und ${String(bau.tagespositionen)} Geraete-/Liefer-/Vorkommniszeilen ueber `
      + `${String(bau.gewerke)} Gewerke (Katalog unbestaetigt: O-159)\n`,
    );
    process.stdout.write(
      `  \u00b7 DWD Open Data: ${bau.wetterVerbunden ? 'verbunden' : 'NICHT verbunden'} `
      + `\u2014 Wetter am Bautag: ${bau.wetterBefund}\n`,
    );
  }

  /**
   * Und darauf das Stundenkonto: freigeben, Konto anlegen, buchen. Es kommt
   * NACH der Zeit, weil es nichts erfindet — es bucht, was erfasst und
   * freigegeben ist. Ohne diesen Schritt fuehrte PR 37 eine Buchhaltung, die
   * nie gebucht hat.
   */
  const konto = await seedKonten(sql, ids);
  process.stdout.write(
    `  ${String(konto.freigegeben)} Zeiteintraege freigegeben (Demo-Annahme), `
    + `${String(konto.konten)} Stundenkonten, ${String(konto.buchungen)} Buchungen `
    + `ueber ${String(konto.minuten)} Minuten (Sollzeit bleibt offen: O-18)\n`,
  );

  process.stdout.write('\nSeed fertig.\n');
  process.stdout.write('OFFEN, bevor eine Rechnung entstehen kann:\n');
  process.stdout.write('  • O-134 — Rechnungsnummern-Maske je Gesellschaft bestätigen\n');
  process.stdout.write('  • O-01  — ist CSE Operations eine GmbH oder eine Abteilung?\n');
  await sql.end();
}

await main();
