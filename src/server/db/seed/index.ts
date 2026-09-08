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
      on conflict (slug) do update set name = excluded.name
      returning id`;
    ids.set(b.slug, z!.id);
  }
  process.stdout.write(`  ${ids.size} Bereiche\n`);

  // ------------------------------------------------------------ Super-Admin
  /**
   * Ein Konto, das die Plattform aufschliesst. MIT zweitem Faktor, denn
   * `benutzer_2fa_pflicht` laesst `super_admin` sonst gar nicht `aktiv`
   * werden — und `app.ist_super_admin()` verlangt zusaetzlich eine
   * aal2-SITZUNG. Der Faktor gehoert der Anmeldung, nicht dem Konto.
   */
  const [u] = await sql<{ id: string }[]>`
    insert into auth.users (email) values ('admin@cse-gruppe.de')
    on conflict do nothing returning id`;
  const adminId = u?.id ?? (await sql<{ id: string }[]>`
    select id from auth.users where email = 'admin@cse-gruppe.de'`)[0]!.id;

  await sql`insert into auth.mfa_factors (user_id) values (${adminId})
            on conflict do nothing`;

  const [sa] = await sql<{ id: string }[]>`
    select id from rolle where schluessel = 'super_admin' and mandant_id is null`;

  await sql`
    insert into benutzer (id, email, name, globale_rolle_id, status)
    values (${adminId}, 'admin@cse-gruppe.de', 'Gruppen-Administration', ${sa!.id}, 'aktiv')
    on conflict (id) do update set status = 'aktiv'`;
  process.stdout.write('  1 Super-Admin (admin@cse-gruppe.de)\n');

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
  }
  process.stdout.write('  Nummernkreise: Rechnung als PLATZHALTER (O-134), Nachweis bestätigt\n');

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

  process.stdout.write('\nSeed fertig.\n');
  process.stdout.write('OFFEN, bevor eine Rechnung entstehen kann:\n');
  process.stdout.write('  • O-134 — Rechnungsnummern-Maske je Gesellschaft bestätigen\n');
  process.stdout.write('  • O-01  — ist CSE Operations eine GmbH oder eine Abteilung?\n');
  await sql.end();
}

await main();
