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
import { seedAuftrag } from './auftrag.js';
import { seedZeit } from './zeit.js';

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
      on conflict (slug) do update
        set name = excluded.name,
            eigener_nummernkreis = excluded.eigener_nummernkreis
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
  /** Fatima ist der D-09-Fall: ein Mensch, zwei Gesellschaften, zwei Saetze. */
  const menschen: readonly (readonly [string, string, string])[] = [
    ['Fatima', 'Yildiz', 'tr'],
    ['Jonas', 'Berger', 'de'],
    ['Amir', 'Haddad', 'ar'],
    ['Marta', 'Kowalski', 'de'],
    ['Kwame', 'Mensah', 'en'],
  ];
  const personIds: string[] = [];
  for (const [vorname, nachname, sprache] of menschen) {
    const [p] = await sql<{ id: string }[]>`
      insert into person (vorname, nachname, sprache, telefon)
      values (${vorname}, ${nachname}, ${sprache},
              ${`+49 170 ${String(1_000_000 + personIds.length)}`})
      returning id`;
    personIds.push(p!.id);
  }

  /** Beschaeftigungen. Alles Kostenrelevante haengt hier, nicht an `person`. */
  const anstellungen: readonly (readonly [number, string, string, number])[] = [
    [0, 'reinigung', 'R-1001', 1450],   // Fatima, Reinigung
    [0, 'security', 'S-2001', 1780],    // dieselbe Fatima, Sicherheit
    [1, 'reinigung', 'R-1002', 1400],
    [2, 'security', 'S-2002', 1690],
    [3, 'bau', 'B-3001', 2150],
    [4, 'reinigung', 'R-1003', 1400],
  ];
  for (const [person, bereich, nummer, satz] of anstellungen) {
    await sql`
      insert into anstellung
        (mandant_id, person_id, personalnummer, eintritt, stundensatz_intern, status)
      values (${ids.get(bereich)!}, ${personIds[person]!}, ${nummer}, '2024-01-01',
              ${satz}, 'aktiv')
      on conflict do nothing`;
  }
  process.stdout.write(`  ${menschen.length} Menschen, ${anstellungen.length} Beschäftigungen\n`);

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
   */
  const rollenIds = new Map<string, string>();
  for (const r of await sql<{ id: string; schluessel: string }[]>`
    select id, schluessel from rolle where mandant_id is null and archiviert_am is null`) {
    rollenIds.set(r.schluessel, r.id);
  }

  const konten: readonly (readonly [string, string, string, string, number | null])[] = [
    ['admin.reinigung@cse-gruppe.de', 'Administration Reinigung', 'admin', 'reinigung', null],
    ['leitung.bau@cse-gruppe.de', 'Leitung Bau', 'leitung', 'bau', null],
    // Fatima: `mitarbeiter` in Reinigung UND Security (D-09).
    ['fatima.yildiz@cse-gruppe.de', 'Fatima Yildiz', 'mitarbeiter', 'reinigung', 0],
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
    // Fatima ist in zwei Gesellschaften beschaeftigt, also auch dort Benutzerin.
    if (rolle === 'mitarbeiter') {
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
    + `importiert, ${String(zeit.laufend)} laufend\n`,
  );

  process.stdout.write('\nSeed fertig.\n');
  process.stdout.write('OFFEN, bevor eine Rechnung entstehen kann:\n');
  process.stdout.write('  • O-134 — Rechnungsnummern-Maske je Gesellschaft bestätigen\n');
  process.stdout.write('  • O-01  — ist CSE Operations eine GmbH oder eine Abteilung?\n');
  await sql.end();
}

await main();
