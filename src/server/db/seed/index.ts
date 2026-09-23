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
import { normalisiereTelefon } from '../../../lib/telefon.js';
import { seedBewacherUndEvents, seedSecurity } from './security.js';
import { seedWachbuch } from './wachbuch.js';
import { seedReinigung, seedSonderUndQualitaet } from './reinigung.js';
import { seedVertrieb } from './vertrieb.js';
import { seedBau } from './bau.js';
import { seedFreigaben } from './freigaben.js';
import { seedEingang } from './eingang.js';
import { seedFinanzAusgaben } from './finanz-ausgabe.js';
import { seedRechnungen } from './rechnung.js';
import { seedSocial } from './social.js';
import { seedRecruiting } from './recruiting.js';
import { seedAkquise } from './akquise.js';
import { seedBerichtsdaten } from './berichtsdaten.js';
import { seedRadar } from './radar.js';
import { DEMO_KENNWORT, seedZugangsdaten } from './zugang.js';
import { seedBenachrichtigungen } from './benachrichtigung.js';
import { seedKern } from './kern.js';
import { seedDatenschutz } from './datenschutz.js';
import { seedCrm } from './crm.js';
import { devFlaechenAn } from '../../../lib/dev-flaechen.js';
import { waehleSpeicher } from '../../storage/waehle.js';

const url = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
if (url === undefined || url === '') {
  throw new Error('DATABASE_URL fehlt — der Seed hat kein Ziel.');
}
const sql = postgres(url, { max: 1, onnotice: () => {} });

const heute = new Date().toISOString().slice(0, 10);

/**
 * **Läuft dieser Seed für eine Vorführung oder für den Betrieb?**
 *
 * Dieselbe Weiche wie bei den Demokennwörtern (D-501): auf
 * Entwicklungsflächen entstehen Zeilen, die eine offene Frage sichtbar
 * ÜBERBRÜCKEN; in der Produktion bleibt die Frage offen und die Zeile aus.
 * Die Überbrückung ist nie unsichtbar — sie steht im Datensatz selbst
 * (`DEMO-` in der Rechnungsnummer, `anbieter = 'demo'` im Modellregister).
 *
 * **Sie verlangt die Flagge, und `devFlaechenAn()` allein reicht nicht.**
 * Jene Funktion ist für SEITEN gebaut und liest „allles außer einem
 * Produktionsbau ist eine Entwicklungsfläche" — richtig für eine Seite, die
 * niemand ausliefert, falsch für diesen Seed. Er legt festgeschriebene
 * Rechnungen an: unveränderliche Zeilen in einer lückenlosen Nummernfolge,
 * die kein späterer Lauf mehr entfernen kann (Invariante 4 und 8). Ein Seed,
 * versehentlich gegen die echte Datenbank gestartet — `NODE_ENV` ungesetzt,
 * wie in jeder Konsole — hätte DEMO-Nummern in den echten Kreis gebrannt.
 * Deshalb hier die ausdrückliche Flagge: wer Demodaten will, sagt es.
 */
const demodaten = process.env['CSE_DEV_FLAECHEN'] === '1' && devFlaechenAn();

/**
 * Was der bestehende Auftritt einer Gesellschaft SELBST veroeffentlicht —
 * Anschrift, Rufnummer, Adresse, Web (Stand 13.09.2026, siehe DECISIONS
 * D-473). Nur das steht hier; Registergericht, HRB und USt-IdNr. nennt keiner
 * der beiden Auftritte, also bleiben sie Platzhalter und
 * `angaben_bestaetigt_am` bleibt NULL (O-353).
 */
interface Auftritt {
  readonly strasse: string;
  readonly plz: string;
  readonly ort: string;
  readonly telefon: string;
  readonly email: string;
  readonly web: string;
}

interface Bereich {
  readonly slug: string;
  readonly name: string;
  readonly firma: string;
  readonly rechtsform: string | null;
  readonly rechtseinheit: boolean | null;
  readonly farbe: string;
  readonly auftritt?: Auftritt;
  /**
   * Die GEBUCHTEN Gewerkmodule (`mandant.module`, seit 0001 vorhanden und bis
   * jetzt leer).
   *
   * Das ist keine Erfindung, sondern steht in `CLAUDE.md`: CSE
   * Dienstleistungen macht Gebaeudereinigung, SSE Security Sicherheits- und
   * Objektschutzdienste, REALTIME Service Hochbau/Ausbau/Rueckbau. CSE
   * Operations fuehrt kein Gewerk — es ist die Gruppensteuerung.
   *
   * Was daraus folgt, ist sichtbar: der Hochbau-Admin sieht „Reinigung" und
   * „Security" nicht mehr in seiner Sidebar und bekommt auf
   * `/portal/bau/reinigung/reviere` einen 404 statt einer leeren Seite.
   *
   * // TODO(client, O-356): Bucht eine Gesellschaft je ein Gewerk, oder gibt
   * es Ueberschneidungen — etwa Bauendreinigung bei der REALTIME Service?
   */
  readonly module: readonly string[];
}

/**
 * Die vier Bereiche. `operations` traegt `ist_rechtseinheit = NULL`, weil
 * O-01 offen ist: ob CSE Operations eine GmbH mit eigenem Rechnungskreis ist
 * oder eine Abteilung, hat der Mandant nicht beantwortet. NULL ist der einzige
 * neutrale Wert — `true` oder `false` waere eine stille Entscheidung.
 */
const BEREICHE: readonly Bereich[] = [
  { slug: 'reinigung', name: 'CSE Dienstleistung', firma: 'CSE Dienstleistungen GmbH',
    rechtsform: 'GmbH', rechtseinheit: true, farbe: 'reinigung',
    module: ['reinigung'],
    // cse-dienstleistungen.de, Kontakt und Datenschutzerklaerung.
    auftritt: { strasse: 'Kurfürstendamm 201', plz: '10719', ort: 'Berlin',
      telefon: '+49 30 91203341', email: 'office@cse-dienstleistungen.de',
      web: 'https://www.cse-dienstleistungen.de' } },
  /*
   * `Select Security Event GmbH` — ohne Bindestrich, wie das Impressum von
   * select-security.de die Firma schreibt. CLAUDE.md hatte `Select-Security
   * Event GmbH`; das Impressum ist die Quelle, die zaehlt (D-473).
   */
  { slug: 'security', name: 'SSE Security', firma: 'Select Security Event GmbH',
    rechtsform: 'GmbH', rechtseinheit: true, farbe: 'security',
    module: ['security'],
    auftritt: { strasse: 'Kurfürstendamm 201', plz: '10719', ort: 'Berlin',
      telefon: '+49 30 80584400', email: 'office@select-security.de',
      web: 'https://select-security.de' } },
  { slug: 'bau', name: 'REALTIME Service', firma: 'REALTIME Service GmbH',
    rechtsform: 'GmbH', rechtseinheit: true, farbe: 'bau',
    module: ['bau'] },
  /*
   * `operations` bucht KEIN Gewerk — und das ist die Aussage, nicht eine
   * Luecke. Die Gruppensteuerung fuehrt weder Reviere noch Posten noch
   * Baustellen; was sie braucht (Uebersicht, CRM, Finanzen, Dokumente,
   * Personal), steht in `QUERSCHNITT` und wird nicht gebucht.
   */
  { slug: 'operations', name: 'CSE Operations', firma: 'CSE Operations',
    rechtsform: null, rechtseinheit: null, farbe: 'operations', module: [] },
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
    /**
     * **Diese Stammdaten sind ERFUNDEN, und `angaben_bestaetigt_am` bleibt
     * deshalb NULL.**
     *
     * `Kurfürstendamm 21`, `+49 30 555 0100`, `DE1000000xx`, `HRB 2000xx` —
     * fortlaufend hochgezaehlt, nie beim Mandanten erfragt. Als reine Fixtur
     * war das folgenlos. Seit das Impressum die Angaben nach § 5 TMG ausweist,
     * ist es das Gegenteil: eine rechtlich bindende Seite naennte eine
     * Registernummer, die es nicht gibt.
     *
     * Weglassen geht nicht — `mandant_ustg14_vollstaendig` verlangt Anschrift
     * und Steuernummer von jeder Gesellschaft mit eigenem Rechnungskreis
     * (§ 14 UStG). Die Werte muessen da sein, damit das System arbeitet; sie
     * duerfen nur nicht als gesichert AUFTRETEN. Genau dafuer gibt es seit
     * 0097 `angaben_bestaetigt_am`, und der Auftritt sagt es sichtbar, solange
     * die Spalte NULL ist (O-353).
     */
    const rechtseinheit = b.rechtseinheit === true;
    const [z] = await sql<{ id: string }[]>`
      insert into mandant
        (slug, name, firma, rechtsform, ist_rechtseinheit, eigener_nummernkreis,
         strasse, plz, ort, land, telefon, email, web, farbe_token, module,
         module_gepflegt, sortierung,
         ust_id, handelsregister_gericht, handelsregister_nummer,
         rechnung_kontakt_name,
         elektronische_adresse, elektronische_adresse_schema,
         iban, bic, bank)
      values
        (${b.slug}, ${b.name}, ${b.firma}, ${b.rechtsform}, ${b.rechtseinheit},
         ${rechtseinheit},
         -- Anschrift und Rufnummer aus dem bestehenden Auftritt, wo es einen
         -- gibt (D-473); sonst der alte, erkennbar erfundene Platzhalter.
         ${b.auftritt?.strasse ?? 'Kurfürstendamm 21'}, ${b.auftritt?.plz ?? '10719'}, ${b.auftritt?.ort ?? 'Berlin'}, 'DE', -- TODO(client, O-353): Anschrift von REALTIME und Operations
         ${b.auftritt?.telefon ?? '+49 30 555 0100'}, ${b.auftritt?.email ?? `kontakt@${b.slug}.cse-gruppe.de`}, -- TODO(client, O-353): Rufnummer von REALTIME und Operations
         ${b.auftritt?.web ?? null}, ${b.farbe},
         -- Die Umwandlung nach text[] steht AUSGESCHRIEBEN da: eine leere
         -- Liste (CSE Operations bucht kein Gewerk) kommt beim Treiber ohne
         -- Elementtyp an und wird als text gesendet — "column module is of
         -- type text[] but expression is of type text". Der Fehler trifft
         -- genau die eine Zeile, die ihn am schwersten auffindbar macht.
         -- (Keine Backticks in diesem Kommentar: er steht IN einem
         -- Template-Literal, und ein Backtick beendet es. Dafuer gibt es die
         -- Merge-Wache sql-backtick-im-kommentar — sie hat hier zugeschlagen.)
         ${b.module}::text[],
         -- Der Seed TRAEGT sie ein, also gilt die Liste — auch die leere von
         -- CSE Operations, und genau das ist dort die Aussage (0103).
         true, ${i},
         ${rechtseinheit ? `DE${String(100_000_000 + i)}` : null}, -- TODO(client, O-353): echte USt-IdNr.
         ${rechtseinheit ? 'Amtsgericht Charlottenburg' : null},
         ${rechtseinheit ? `HRB ${String(200_000 + i)}` : null},  -- TODO(client, O-353): echte HRB-Nummer
         -- BT-41, XRechnung BR-DE-6. Steht hier wie die Anschrift daneben:
         -- eingetragen, damit das System arbeitet, und ausdruecklich NICHT
         -- als gesicherte Angabe (angaben_bestaetigt_am bleibt NULL). Ohne
         -- einen Wert entstuende zu keinem oeffentlichen Auftraggeber eine
         -- XRechnung, und die Abnahme der Phase 6 waere nicht pruefbar.
         'Buchhaltung',  -- TODO(client, O-353): echte Kontaktstelle je Gesellschaft
         -- BT-34 und BT-34-1. Die USt-IdNr. unter EAS 9930 („deutsche
         -- USt-IdNr.") ist die uebliche Adresse eines deutschen Rechnungs-
         -- stellers — und sie steht hier als DEMOWERT, nicht als Ableitung:
         -- unter welcher Adresse eine Gesellschaft elektronische Rechnungen
         -- stellt, sagt die Gesellschaft. angaben_bestaetigt_am bleibt NULL,
         -- und ohne Rechtseinheit gibt es keine USt-IdNr. und damit auch hier
         -- nichts (der CHECK verlangt beide Haelften oder keine).
         -- (Keine Backticks: dieser Kommentar steht IN einem Template-Literal.)
         ${rechtseinheit ? `DE${String(100_000_000 + i)}` : null},
         ${rechtseinheit ? '9930' : null},  -- TODO(client, O-353): echte E-Adresse je Gesellschaft
         -- BT-84 und BG-17. Ohne Bankverbindung sperrt BR-DE-13 jede Rechnung
         -- mit SEPA-Ueberweisung an einen oeffentlichen Auftraggeber — und
         -- genau daran ist der erste Browsertest gescheitert, der einen Beleg
         -- an das Bezirksamt fuehren wollte. Eine oeffentlich dokumentierte
         -- TESTKENNUNG, keine Kontonummer: die echte Bankverbindung je
         -- Gesellschaft gehoert dem Mandanten und in keine Quelldatei.
         ${rechtseinheit ? 'DE02120300000000202051' : null},
         ${rechtseinheit ? 'BYLADEM1001' : null},
         ${rechtseinheit ? 'Testbank (Demodaten)' : null})  -- TODO(client, O-353): echte Bankverbindung
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
            handelsregister_nummer = excluded.handelsregister_nummer,
            rechnung_kontakt_name = excluded.rechnung_kontakt_name,
            elektronische_adresse = excluded.elektronische_adresse,
            elektronische_adresse_schema = excluded.elektronische_adresse_schema,
            -- Nur WAS FEHLT: wer eine echte Bankverbindung eingetragen hat,
            -- behaelt sie. Ein Seed, der eine Kontonummer ueberschreibt, ist
            -- ein Seed, den niemand mehr laufen laesst.
            iban = coalesce(mandant.iban, excluded.iban),
            bic  = coalesce(mandant.bic,  excluded.bic),
            bank = coalesce(mandant.bank, excluded.bank),
            -- Die Buchung gehoert zur Gesellschaft und nicht zum ersten Lauf:
            -- ohne diese Zeile blieben vier bereits angelegte Bereiche fuer
            -- immer bei '{}', und der Modulriegel griffe nirgends.
            module = excluded.module,
            module_gepflegt = excluded.module_gepflegt
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

  /**
   * **Die vier bindbaren Freigaberechte — an `admin`, damit die Demo sie
   * zeigt, und ausdrücklich, damit es niemand für selbstverständlich hält.**
   *
   * Der Katalog führt `freigabe.stapel_entscheiden`,
   * `freigabe.einspruch_erheben`, `freigabe.rueckgaengig` und
   * `freigabe.pruefdauer_lesen` als BINDBAR, nicht als gebunden: wer einzeln
   * entscheiden darf, darf damit nicht schon fünfzig auf einmal, und wer
   * entscheidet, darf deshalb noch keine Prüfdauern auswerten. Ohne diese
   * Zeilen wären die vier Bildschirme im Seed leer — nicht kaputt, leer, und
   * das sähe aus wie ein Fehler.
   *
   * // TODO(client) [O-367]: Wer soll diese vier Rechte tatsächlich halten —
   * // Geschäftsführung, Bereichsleitung, Buchhaltung?
   */
  const FREIGABE_BINDBAR = [
    'freigabe.stapel_entscheiden', 'freigabe.einspruch_erheben',
    'freigabe.rueckgaengig', 'freigabe.pruefdauer_lesen',
  ];
  for (const schluessel of FREIGABE_BINDBAR) {
    await sql`
      insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
      select r.id, b.id, null, true
        from rolle r, berechtigung b
       where r.schluessel = 'admin' and r.mandant_id is null
         and b.schluessel = ${schluessel}
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
   * den SECHS Fuehrungs- und Verwaltungsstellen `null` — nicht aus
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
   *
   * **Die Zahl stand auf „vier"**, und zwar hier und im Register, seit dem
   * Tag, an dem `admin.security` und `leitung.reinigung` dazukamen. Sie ist
   * kein Schmuck: O-347 zaehlt die betroffenen Konten AUF, und wer die offene
   * Frage nach dieser Liste beantwortet haette, haette zwei Beschaeftigungen
   * uebersehen — zwei Kostenstellen ohne Satz, die in der Antwort nicht
   * vorkommen und danach niemandem mehr auffallen.
   */
  const anstellungen: readonly (readonly [number, string, string, number | null])[] = [
    [0, 'reinigung', 'R-1001', 1450],   // Fatima, Reinigung
    [0, 'security', 'S-2001', 1780],    // dieselbe Fatima, Sicherheit
    [1, 'reinigung', 'R-1002', 1400],
    [2, 'security', 'S-2002', 1690],
    [3, 'bau', 'B-3001', 2150],
    [4, 'reinigung', 'R-1003', 1400],
    // Die sechs Fuehrungs- und Verwaltungsstellen, je in IHRER Gesellschaft.
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
  /**
   * **Je Beschaeftigung eine datierte Kondition** (01-KERN §6.15, 0192).
   *
   * Ohne sie zeigt `/personal/anstellungen/[id]/entgelt` eine Zahl ohne
   * Geschichte: der Satz kaeme aus dem Spiegel (dem Bestand vor der datierten
   * Tabelle), und die Seite koennte nicht vorfuehren, was sie leistet — dass
   * eine Erhoehung die Vergangenheit NICHT neu bewertet. `gilt_ab` ist der
   * Eintritt und nicht „heute": ein Default „heute" machte aus jeder
   * rueckwirkenden Kondition lautlos eine ab heute geltende.
   *
   * Der Ausloeser `kern.anstellung_kondition_spiegeln` schreibt den Spiegel
   * danach selbst — dieselben Werte, nur jetzt aus der datierten Quelle.
   */
  for (const [person, bereich, nummer, satz] of anstellungen) {
    await sql`
      insert into anstellung_kondition
        (mandant_id, anstellung_id, gilt_ab, stundensatz_intern_cent, grund)
      select a.mandant_id, a.id, a.eintritt, ${satz}, 'Eintritt (Seed)'
        from anstellung a
       where a.mandant_id = ${ids.get(bereich)!}
         and a.person_id = ${personIds[person]!}
         and a.personalnummer = ${nummer}
         and not exists (select 1 from anstellung_kondition k where k.anstellung_id = a.id)`;
  }

  /**
   * **Eine Personendublette — sonst ist `/personal/zusammenfuehren`
   * unpruefbar.**
   *
   * „Fatma Yildiz" ist derselbe Mensch wie „Fatima Yildiz", zweimal angelegt
   * (die Schreibweise aus dem Bewerbungsformular gegen die aus dem Vertrag).
   * Das ist NICHT der D-09-Fall: Fatima hat zwei Beschaeftigungen in zwei
   * Gesellschaften und ist EINE Zeile — hier sind es zwei Zeilen fuer einen
   * Menschen, und genau das hebt D-09 auf.
   */
  const [dublette] = await sql<{ id: string }[]>`
    insert into person (vorname, nachname, sprache, telefon)
    select 'Fatma', 'Yildiz', 'tr', '+49 170 1000099'
     where not exists (select 1 from person where vorname = 'Fatma' and nachname = 'Yildiz')
    returning id`;
  if (dublette !== undefined) {
    await sql`
      insert into anstellung
        (mandant_id, person_id, personalnummer, eintritt, stundensatz_intern, status)
      values (${ids.get('reinigung')!}, ${dublette.id}, 'R-1099', '2024-03-01', 1450, 'aktiv')
      on conflict do nothing`;
  }

  process.stdout.write(
    `  ${menschen.length} Menschen, ${anstellungen.length} Beschäftigungen, `
    + `${anstellungen.length} datierte Konditionen, 1 Dublette `
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
  /**
   * **Auf Entwicklungsflächen ein DEMO-Kreis statt des Platzhalters.**
   *
   * `nummernkreis_offen_key` lässt je Gesellschaft genau EINEN offenen
   * Rechnungskreis zu — beide nebeneinander geht nicht, es ist also eine
   * Entscheidung und keine Ergänzung. Sie fällt hier so:
   *
   *  · **Produktion:** der Platzhalter, wie bisher. Er vergibt keine Nummer,
   *    bis O-134 beantwortet ist, und das bleibt richtig: eine vergebene
   *    Rechnungsnummer nimmt man nicht zurück.
   *  · **Entwicklung und Vorführung:** ein bestätigter Kreis mit der Maske
   *    `DEMO-{jahr}-{nr:5}`.
   *
   * **Die Maske trägt das Wort.** Jede so entstandene Rechnung heisst
   * `DEMO-2026-00001` — die Demo-Eigenschaft steht damit in jeder einzelnen
   * Nummer und nicht in einem Kommentar, den beim Durchsehen niemand liest.
   * Das ist dieselbe Regel wie beim Demomodell (`anbieter = 'demo'`, D-499):
   * ein Platzhalter, den man am Datensatz erkennt, ist einer; ein Platzhalter,
   * den man nur an der Dokumentation erkennt, ist eine Falle.
   *
   * Der Tausch ist eine Zeile: Maske bestätigen, Kreis schliessen, Nachfolger
   * eröffnen — derselbe Weg, den jeder Jahreswechsel nimmt.
   *
   * TODO(client, O-134): Rechnungsnummern-Maske je Gesellschaft bestätigen.
   */
  for (const b of BEREICHE.filter((x) => x.rechtseinheit === true)) {
    await sql`
      insert into nummernkreis
        (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos, format_maske,
         zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
      values (${ids.get(b.slug)!}, 'ausgangsrechnung', 2026,
              ${demodaten
                ? 'Ausgangsrechnungen (DEMO — Maske unbestätigt, O-134)'
                : 'Ausgangsrechnungen (unbestätigt)'},
              true,
              ${demodaten ? 'DEMO-{jahr}-{nr:5}' : 'RE-{jahr}-{nr:5}'},
              ${demodaten ? 'jaehrlich' : null}, ${heute},
              ${!demodaten}, 'system', 'job:seed')
      on conflict (mandant_id, kreis_typ, kontext_id, jahr) do update
        set bezeichnung   = excluded.bezeichnung,
            format_maske  = excluded.format_maske,
            zuruecksetzung = excluded.zuruecksetzung,
            ist_platzhalter = excluded.ist_platzhalter,
            geaendert_am  = now()
        /*
         * **Nur, solange der Kreis nichts vergeben hat.** Ein zweiter Seed
         * auf einen Bestand, in dem schon Rechnungen stehen, darf die Maske
         * nicht mehr anfassen: die vergebenen Nummern tragen die alte, und
         * eine Folge aus zwei Masken ist keine lückenlose Folge mehr (§14
         * UStG, Invariante 4). Ohne diese Bedingung wäre der Seed ein Weg,
         * eine festgeschriebene Nummernfolge nachträglich umzubenennen.
         */
        where nummernkreis.naechste_nummer = 1
          and nummernkreis.geschlossen_am is null`;

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

    /**
     * Die interne Belegnummer der EINGANGSrechnung — bestaetigt, lueckenlos.
     *
     * Sie ist keine Rechnungsnummer nach §14 UStG: sie nummeriert nicht
     * unsere Ausgangsbelege, sondern unsere Ablage. Ihre Maske ist damit eine
     * Hausentscheidung und nicht die offene Frage O-134. Lueckenlos ist sie
     * trotzdem, weil GoBD eine fortlaufende Belegnummerierung verlangt — und
     * deshalb zieht sie die Nummer erst beim BUCHEN (0123).
     */
    await sql`
      insert into nummernkreis
        (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos, format_maske,
         zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
      values (${ids.get(b.slug)!}, 'eingangsrechnung_beleg', 2026,
              'Eingangsbelege', true, 'EB-{jahr}-{nr:5}',
              'jaehrlich', ${heute}, false, 'system', 'job:seed')
      on conflict do nothing`;

    /**
     * Der Mahnungskreis — bestaetigt, lueckenlos, und beides mit Grund.
     *
     * Er ist keine Rechnungsnummer nach §14 UStG, also faellt er nicht unter
     * O-134: die Maske ist eine Hausentscheidung. Lueckenlos ist er, weil er
     * es ohnehin ist — die Nummer entsteht erst mit der FREIGABE (0125), ein
     * verworfener Entwurf zieht keine, und damit kann die Folge keine Luecke
     * haben. Ein Platzhalterkreis hier hiesse: keine Mahnung kann jemals
     * freigegeben werden, ohne dass irgendwer eine Frage zu beantworten
     * haette.
     */
    await sql`
      insert into nummernkreis
        (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos, format_maske,
         zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
      values (${ids.get(b.slug)!}, 'mahnung', 2026,
              'Mahnungen', true, 'MA-{jahr}-{nr:5}',
              'jaehrlich', ${heute}, false, 'system', 'job:seed')
      on conflict do nothing`;

    /**
     * Drei Mahnstufen als PLATZHALTER (O-19) — und deshalb mahnt der Lauf
     * nichts.
     *
     * Fristen, Gebuehren und die Zinsart sind eine Entscheidung des
     * Mandanten; sie hier zu erfinden hiesse, echten Kunden Betraege zu
     * berechnen, die niemand beschlossen hat. Die Zeilen stehen trotzdem da,
     * damit der Bildschirm die Sperre ZEIGT statt einer leeren Liste: der
     * Lauf uebergeht jede Forderung mit „Mahnstufe … ist unbestaetigt".
     */
    for (const [stufe, bez, tage] of [
      [1, 'Zahlungserinnerung (unbestätigt)', 14],
      [2, 'Erste Mahnung (unbestätigt)', 28],
      [3, 'Letzte Mahnung (unbestätigt)', 42],
    ] as const) {
      await sql`
        insert into mahnstufe
          (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit, gebuehr_cent,
           zinsberechnung, ist_platzhalter, gueltig_ab,
           erstellt_von_art, erstellt_von_dienst)
        values (${ids.get(b.slug)!}, ${stufe}, ${bez}, ${tage}, 0,
                'keine', true, ${heute}, 'system', 'job:seed')
        on conflict do nothing`;
    }
  }
  process.stdout.write(
    '  Nummernkreise: Rechnung als PLATZHALTER (O-134); Nachweis, Angebot und Auftrag bestätigt\n',
  );
  /**
   * **Kein Basiszinssatz im Seed, und das ist kein Vergessen.**
   *
   * Der Satz nach § 247 BGB ist eine echte Zahl der Deutschen Bundesbank, die
   * halbjaehrlich wechselt. Einen plausiblen Wert einzutragen hiesse, eine
   * Zinsforderung auf eine erfundene Grundlage zu stellen — und sie sieht
   * dann genauso aus wie eine richtige. Ohne Zeile fordert jede Mahnung NULL
   * Zins und sagt es (`lauf.ts`), und der Waechter `basiszinssatz_pruefen`
   * meldet die Luecke am 15. Juni und am 15. Dezember.
   */
  process.stdout.write(
    '  Mahnstufen: drei je Rechtseinheit, alle PLATZHALTER (O-19) — es wird nichts gemahnt\n'
    + '  · Basiszinssatz (§ 247 BGB): NICHT gesetzt — eine echte Zahl der Bundesbank, '
    + 'kein Demowert\n',
  );

  // --------------------------------------------------- DATEV-Stammdaten (PR 58)
  /**
   * **Eine Zeile je Gesellschaft, und jede fachliche Spalte NULL** (ACC-01,
   * O-05).
   *
   * Die Zeile muss da sein, damit der Bildschirm die Sperre zeigt statt einer
   * leeren Seite — und damit `app.konto_aufloesen` antworten kann „Kontenrahmen
   * nicht festgelegt" statt „Zuordnung fehlt". Sie enthaelt aber nichts
   * Erfundenes: Beraternummer, Mandantennummer, SKR03/04, Sachkontenlaenge und
   * Versteuerungsart stehen beim Steuerberater. `konto_mapping` bleibt ganz
   * leer — eine Zuordnung mit geratenem Konto waere schlimmer als keine.
   */
  for (const b of BEREICHE) {
    await sql`
      insert into datev_konfiguration
        (mandant_id, ist_platzhalter, verbunden, erstellt_von_art, erstellt_von_dienst)
      values (${ids.get(b.slug)!}, true, false, 'system', 'job:seed')
      on conflict (mandant_id) do nothing`;
  }
  process.stdout.write(
    '  DATEV: eine leere Konfiguration je Rechtseinheit, ist_platzhalter = true (O-05)\n'
    + '  · Kontenzuordnung: KEINE Zeile — ein geratenes Erloeskonto faellt erst beim '
    + 'Steuerberater auf\n',
  );

  // -------------------------------------------------------------- Bankkonto
  /**
   * Ein Bankkonto je Rechtseinheit — AUS DER GESELLSCHAFT, nicht daneben.
   *
   * Die Kennungen stehen schon auf `mandant` (BT-84/BT-85, oben in diesem
   * Seed). Sie hier ein zweites Mal zu tippen hiesse, zwei Wahrheiten ueber
   * dieselbe Bankverbindung zu pflegen — und die eine, die auf der Rechnung
   * landet, waere dann Zufall. Das Konto liest sie deshalb aus der Zeile,
   * die es besitzt.
   *
   * `ist_standard`: eine neue Rechnung schlaegt dieses Konto vor. Ohne ein
   * Standardkonto muesste jeder Fakturierende es einzeln waehlen, und wer es
   * vergisst, stellt eine Rechnung ohne Zahlungsempfaenger — BR-DE-13 weist
   * sie beim oeffentlichen Auftraggeber zurueck.
   *
   * `on conflict do nothing` ueber den Teilindex auf der IBAN: der Seed ist
   * gegen seine eigene Ausgabe wiederholbar und ueberschreibt kein Konto,
   * das jemand gepflegt hat.
   */
  for (const b of BEREICHE.filter((x) => x.rechtseinheit === true)) {
    await sql`
      insert into bankkonto
        (mandant_id, bezeichnung, iban, bic, kontoinhaber, ist_standard,
         erstellt_von_art, erstellt_von_dienst)
      select m.id, 'Geschäftskonto', m.iban, m.bic, m.name, true,
             'system', 'job:seed'
        from mandant m
       where m.id = ${ids.get(b.slug)!} and m.iban is not null
      on conflict do nothing`;
  }
  process.stdout.write(
    '  Bankkonten: je Rechtseinheit eines, aus der Gesellschaft gelesen (O-353)\n',
  );

  // -------------------------------------------------------------- Lieferant
  /**
   * Zwei Lieferanten je Rechtseinheit — Stammdaten, mehr nicht.
   *
   * **Warum KEINE Eingangsrechnung mitkommt.** Eine Eingangsrechnung braucht
   * ihren Beleg, und ein Beleg zeigt auf eine Dokumentversion samt SHA-256
   * (ACC-03). Der Seed legt nirgends `dokument`-Zeilen an, und aus gutem
   * Grund: eine Zeile, die auf Bytes zeigt, die es im Speicher nicht gibt,
   * ist ein Beleg, den niemand oeffnen kann — genau die Sorte Demodatum, die
   * spaeter als Fehler gemeldet wird. Die Lieferanten dagegen sind echte
   * Stammdaten, und ohne sie ist die Erfassungsmaske unbenutzbar.
   *
   * Die Bankverbindung bleibt NULL: eine erfundene IBAN eines erfundenen
   * Lieferanten ist die Zeile, an der spaeter eine Zahlung haengt.
   * TODO(client, O-183): Wer im Haus pflegt Lieferantenstammdaten, und wer
   * darf eine Bankverbindung aendern?
   */
  const LIEFERANTEN: Readonly<Record<string, readonly string[]>> = {
    reinigung: ['Hygiene Nord Handels GmbH', 'Papier & Spender Berlin e.K.'],
    security:  ['Funktechnik Spandau GmbH', 'Dienstkleidung Meyer OHG'],
    bau:       ['Baustoffe Lichtenberg GmbH', 'Gerüstbau Treptow GmbH & Co. KG'],
  };
  let lieferanten = 0;
  for (const b of BEREICHE.filter((x) => x.rechtseinheit === true)) {
    const namen = LIEFERANTEN[b.slug] ?? [];
    for (const [i, name] of namen.entries()) {
      await sql`
        insert into lieferant
          (mandant_id, lieferantennummer, name, plz, ort, status,
           erstellt_von_art, erstellt_von_dienst)
        values (${ids.get(b.slug)!}, ${`L-${String(70_001 + i)}`}, ${name},
                '10115', 'Berlin', 'aktiv', 'system', 'job:seed')
        on conflict do nothing`;
      lieferanten += 1;
    }
  }
  process.stdout.write(
    `  ${lieferanten} Lieferanten (ohne Bankverbindung — O-183; keine `
    + 'Eingangsrechnung, weil ein Beleg ohne Datei keiner ist)\n',
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

  // ------------------------------------------- Erscheinungsbild je Gesellschaft
  /**
   * `mandant_identitaet` traegt nach dem Anlagetrigger nur `kurzname` und das
   * Token — alles andere ist NULL, und die Einstellungsseite zeigte deshalb
   * fuenfmal „nicht hinterlegt". Hier entsteht das, was jede Rechnung, jeder
   * Brief und jedes Angebot unten traegt (DESIGN §11).
   *
   * **Was hier NICHT entsteht:** kein Bildpfad. Es gibt keinen Marken-Bucket
   * und keinen Hochladeweg (O-12/O-13) — ein erfundener Pfad waere eine
   * vorgetaeuschte Ablage. Die ALTERNATIVTEXTE stehen trotzdem, denn sie sind
   * pflegbar und `mi_alt_text` prueft sie, sobald ein Bild dazukommt.
   *
   * **Kein Kartentext, kein Profiltext**: die stehen je Sprache in
   * `unternehmensprofil` (D-82) und nicht hier.
   */
  for (const b of BEREICHE) {
    const a = b.auftritt;
    const anschrift = a === undefined
      ? b.firma : `${b.firma} · ${a.strasse} · ${a.plz} ${a.ort}`;
    await sql`
      update mandant_identitaet
         set claim = ${`${b.name} · Berlin`},
             logo_alt = ${`Wortmarke ${b.name}`},
             avatar_alt = ${`Signet ${b.name}`},
             cover_alt = ${`Titelbild ${b.name}`},
             brief_fuss = ${a === undefined
               ? anschrift : `${anschrift} · ${a.telefon}`},
             rechnung_fuss = ${`${anschrift} · Zahlbar ohne Abzug — `
               + 'Zahlungsziel siehe Rechnungskopf'},
             angebot_fuss = ${a === undefined
               ? `${b.firma} · Es gelten unsere Allgemeinen Geschäftsbedingungen`
               : `${b.firma} · ${a.web} · `
                 + 'Es gelten unsere Allgemeinen Geschäftsbedingungen'},
             email_absender = ${a?.email ?? null},
             email_signatur = ${a === undefined
               ? b.firma
               : `${b.firma}\n${a.strasse}\n${a.plz} ${a.ort}\n${a.telefon}`},
             oeffentlich_sichtbar = true
       where mandant_id = ${ids.get(b.slug)!}`;
  }
  process.stdout.write(
    `  ${String(BEREICHE.length)} Identitaetszeilen (Claim, drei Fusszeilen, Absender, `
    + 'Alternativtexte — ohne Bildpfade: kein Marken-Bucket, O-12/O-13)\n',
  );

  // --------------------------------------------- Arbeitszeitmodell (O-18/O-626)
  /**
   * Je Bereich ZWEI Fassungen desselben Schluessels: eine abgeloeste und die
   * laufende. Damit laeuft der Anzeigepfad fuer die Ablösung — und nicht nur
   * der Leerzustand.
   *
   * **Beide sind PLATZHALTER** (`ist_platzhalter = true`, `sollzeitregel =
   * 'offen'`). O-18 ist unbeantwortet: wie viele Arbeitstage die Woche hat,
   * ob ein Feiertag Sollzeit senkt, wie das Konto rechnet. Eine bestaetigte
   * Demozeile behauptete, die Frage sei beantwortet — und die Sollzeitregel
   * antwortet weiterhin `null`, wie sie soll.
   *
   * Die Vorfassung beginnt 2020: genau der Altbestand, den
   * `/einstellungen/import` uebernimmt — und der Grund, warum es hier keine
   * Rueckwirkungssperre gibt (O-626).
   */
  for (const b of BEREICHE) {
    await sql`
      insert into arbeitszeitmodell
        (mandant_id, schluessel, bezeichnung, wochenstunden, arbeitstage_woche,
         ist_platzhalter, gueltig_ab, gueltig_bis)
      values (${ids.get(b.slug)!}, 'vollzeit', 'Vollzeit (Platzhalter, O-18)',
              39.000, 5.000, true, '2020-01-01', '2024-12-31'),
             (${ids.get(b.slug)!}, 'vollzeit', 'Vollzeit (Platzhalter, O-18)',
              39.000, 5.000, true, '2025-01-01', null)
      on conflict do nothing`;
  }

  /**
   * EINE Tarifregel, fuer EIN Gewerk — strenger als das Gesetz und als
   * Platzhalter markiert.
   *
   * Nur eine, weil jede weitere eine Behauptung ueber einen Tarifvertrag
   * waere, den niemand vorgelegt hat (O-50). 45 statt 30 Minuten Pause ab
   * sechs Stunden und 60 statt 45 ab neun: strenger, also wirksam — ein
   * schwaecherer Wert wuerde von `tv_mindestens_gesetz` abgewiesen, und das
   * ist der Sinn der Schranke.
   */
  await sql`
    insert into tarifvereinbarung
      (mandant_id, gewerk, bezeichnung, fundstelle,
       pause_ab_6h_minuten, pause_ab_9h_minuten, ist_platzhalter, gilt_ab)
    values (${ids.get('reinigung')!}, 'reinigung',
            'Rahmentarifvertrag Gebäudereinigung (Platzhalter, O-50)',
            '§ 5 RTV — Wortlaut nicht geprüft', 45, 60, true, '2025-01-01')
    on conflict do nothing`;
  process.stdout.write(
    `  ${String(BEREICHE.length * 2)} Arbeitszeitmodell-Fassungen (je Bereich eine `
    + 'abgeloeste und eine laufende, beide PLATZHALTER — O-18) und 1 Tarifregel '
    + 'fuer reinigung, strenger als das Gesetz (O-50)\n',
  );

  /*
   * `migration_lauf`/`migration_zeile` bleiben LEER — mit Absicht. Es gibt
   * keinen Parser und keinen Altsystem-Zugang (`MigrationImportPort` wirft
   * `NichtVerbundenFehler`); ein geseedeter Lauf taeuschte eine Uebernahme
   * vor, die nie stattgefunden hat. Die leere Liste ist dort die richtige
   * Aussage.
   */

  // -------------------------------------------------------- Agent-Werkzeuge
  /**
   * **Freigeschaltet wird genau, was ohne Modellzugang etwas kann** — und das
   * sind zwei der neun: `berechne_preis` (ruft die getestete Kalkulation) und
   * `suche_bestand` (beantwortet Fragen aus dem geprueften Katalog). Die
   * uebrigen sieben stehen als Zeile da, aber auf `ist_aktiv = false`.
   *
   * Warum nicht alle neun an: ein freigeschaltetes Werkzeug, das bei jedem
   * Aufruf „kein Modellzugang" zurueckgibt, sieht auf dem Bildschirm aus wie
   * eine kaputte Einstellung. Aus wie „noch nicht verbunden" — und das ist es
   * auch (D-435).
   *
   * `erfordert_freigabe` bleibt ueberall `true`. Das ist die Vorgabe, nicht
   * die Feineinstellung: wer sie lockern will, tut es bewusst, je Werkzeug.
   */
  let werkzeuge = 0;
  const OHNE_MODELL = new Set(['berechne_preis', 'suche_bestand']);
  /*
   * **Auch fuer die abgeschalteten vier.** `agent.ist_aktiv` ist `false`,
   * solange es keinen Modellzugang gibt (D-435) — aber die Werkzeugzeilen
   * gehoeren trotzdem angelegt: die Agentenseite zeigt sie, und ein leerer
   * Abschnitt saehe aus, als gaebe es die Werkzeuge nicht.
   */
  const agenten = await sql<{ id: string; kennung: string }[]>`select id, kennung from agent`;
  for (const b of BEREICHE) {
    for (const a of agenten) {
      for (const w of [
        'lies_dokument', 'extrahiere_lv', 'suche_bestand', 'berechne_preis',
        'pruefe_nachweise', 'pruefe_bilder', 'entwirf_text', 'sende_email',
        'erstelle_vorgang',
      ]) {
        const ergebnis = await sql<{ id: string }[]>`
          insert into agent_werkzeug
            (mandant_id, agent_id, werkzeug, ist_aktiv, erfordert_freigabe, erstellt_von_art)
          values (${ids.get(b.slug)!}, ${a.id}, ${w}::agent_werkzeug_name,
                  ${OHNE_MODELL.has(w)}, true, 'system')
          on conflict (mandant_id, agent_id, werkzeug) do nothing
          returning id`;
        werkzeuge += ergebnis.length;
      }
    }
  }
  process.stdout.write(
    `  ${String(werkzeuge)} Werkzeugzeilen (AGT-02) — freigeschaltet sind die zwei, die ohne `
    + 'Modell rechnen; die uebrigen sieben warten auf einen Anbieter (D-435)\n',
  );

  // --------------------------------------------------------- Agent-Budgets
  /**
   * Ein Monatsbudget je Rechtseinheit — **als klar markierter PLATZHALTER**.
   *
   * O-26 ist offen: wieviel Euro im Monat die KI kosten darf, entscheidet die
   * Geschaeftsfuehrung, nicht diese Datei. Ohne irgendeine Zeile laeuft aber
   * kein Agent (`budget_fehlt`), und dann zeigt das Agenten-Zentrum einen
   * leeren Bildschirm, auf dem nichts zu sehen ist ausser einem Fehler — auch
   * nicht, WIE die Obergrenze wirkt.
   *
   * Deshalb: 50,00 € je Gesellschaft und Monat, `ist_platzhalter = true`, und
   * der Bildschirm schreibt genau das hin. Die Zahl ist bewusst klein — ein
   * Platzhalter, der zu gross ist, faellt niemandem auf, bevor er kostet.
   *
   * `warnschwelle_prozent` bleibt NULL: AGT-05 nennt eine Obergrenze und einen
   * Hartstopp, zur Warnschwelle sagt die Vorgabe nichts, und „80 %" waere eine
   * still erfundene Finanzregel (O-195).
   *
   * TODO(client, O-26): Monatsbudget je Gesellschaft — und je Agent?
   */
  const JETZT_BERLIN = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit',
  }).format(new Date());
  const BUDGET_JAHR = Number(JETZT_BERLIN.slice(0, 4));
  const BUDGET_MONAT = Number(JETZT_BERLIN.slice(5, 7));
  const BUDGET_PLATZHALTER_CENT = 5_000n;

  for (const b of BEREICHE) {
    await sql`
      insert into agent_budget
        (mandant_id, geltungsbereich, jahr, monat, budget_cent, ist_platzhalter,
         erstellt_von_art, erstellt_von_dienst)
      values (${ids.get(b.slug)!}, 'mandant', ${BUDGET_JAHR}, ${BUDGET_MONAT},
              ${BUDGET_PLATZHALTER_CENT.toString()}, true, 'system', 'job:seed')
      on conflict do nothing`;
  }
  process.stdout.write(
    `  KI-Budget: ${BEREICHE.length} Zeilen fuer ${String(BUDGET_MONAT).padStart(2, '0')}/`
    + `${BUDGET_JAHR}, je 50,00 € — PLATZHALTER (O-26)\n`
    + '  · keine Warnschwelle: die Vorgabe nennt keine (O-195)\n',
  );

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
   * **Zwei Zeilen fuer dieselbe Kennung sind kein doppelter Eintrag, sondern
   * ein stilles Loeschen.**
   *
   * `admin.bau@cse-gruppe.de` stand hier zweimal — einmal mit Person 8, einmal
   * mit `null`, samt woertlich kopiertem Kommentar. Die Schleife laeuft beide
   * Zeilen, und die zweite trifft unten auf
   * `on conflict (id) do update set ... person_id = excluded.person_id`: bei
   * JEDEM Lauf verlor der Bau-Administrator seine Person. Ein Konto ohne
   * Person ist nach D-09 kein Mensch mehr — Zertifikate, Beschaeftigungen und
   * Zeiten haengen daran, und in den Demodaten sah es aus, als gehoere dieser
   * Zugang zu niemandem.
   *
   * Auffallen konnte das nicht: die Kennung ist eindeutig, der Upsert
   * erfolgreich, der Lauf gruen. Deshalb steht die Probe hier und nicht in
   * einem Test — sie faellt bei dem, der die Zeile einfuegt.
   */
  const doppelt = konten
    .map(([email]) => email)
    .filter((email, i, alle) => alle.indexOf(email) !== i);
  if (doppelt.length > 0) {
    throw new Error(
      `Seed: doppelte Kontokennung(en) ${[...new Set(doppelt)].join(', ')}. `
      + 'Die zweite Zeile ueberschreibt die erste — auch ihre person_id.',
    );
  }

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
   * **Die Telefonzugaenge — ohne die sich niemand anmelden kann** (EMP-01,
   * PR 20).
   *
   * Sie haengen an `person`, nicht an `anstellung`: Fatima putzt vormittags
   * fuer die CSE Dienstleistungen und bewacht abends fuer die SSE Security,
   * und sie hat EIN Telefon. `mitarbeiter_zugang.person_id` ist darum UNIQUE
   * (D-09, EMP-14) — haenge der Zugang an der Beschaeftigung, haette sie zwei
   * fuer dieselbe Nummer, und die Frage „welchen nehme ich?" haette keine
   * Antwort, die sie interessieren sollte.
   *
   * **Die Nummer wird normalisiert, nicht uebernommen.** `person.telefon`
   * steht so da, wie ein Mensch sie schreibt (`+49 170 1000000`);
   * `telefon_e164` verlangt `^\+[1-9][0-9]{6,14}$` und ist eindeutig. Ohne
   * `normalisiereTelefon` schlaegt die Einfuegung am CHECK fehl — und der
   * Seed muss dieselbe Regel benutzen wie die Anmeldung, sonst legt er
   * Zugaenge an, die niemand findet.
   *
   * Wer keine brauchbare Nummer traegt, bekommt keinen Zugang und keine
   * erfundene: eine ausgedachte Mobilnummer in Demodaten ist eine, die
   * irgendwann jemand anwaehlt.
   */
  const zugangsPersonen = await sql<{ id: string; telefon: string | null }[]>`
    select distinct p.id, p.telefon
      from person p
      join benutzer b on b.person_id = p.id
     where p.geloescht_am is null and b.status = 'aktiv' and not b.ist_dienstkonto`;

  let zugaenge = 0;
  let ohneNummer = 0;
  for (const p of zugangsPersonen) {
    const e164 = p.telefon === null ? null : normalisiereTelefon(p.telefon);
    if (e164 === null) { ohneNummer += 1; continue; }
    /*
     * `on conflict (person_id) do update` und nicht `do nothing`: der Seed ist
     * wiederholbar, und wer die Nummer eines Demomenschen aendert, will sie
     * beim naechsten Lauf geaendert sehen — nicht die alte behalten und sich
     * wundern, warum die SMS an ein Telefon geht, das es nicht mehr gibt.
     */
    await sql`
      insert into mitarbeiter_zugang (person_id, telefon_e164)
      values (${p.id}, ${e164})
      on conflict (person_id) do update set telefon_e164 = excluded.telefon_e164`;
    zugaenge += 1;
  }
  process.stdout.write(
    `  ${String(zugaenge)} Telefonzugaenge (EMP-01)`
    + `${ohneNummer === 0 ? '' : `, ${String(ohneNummer)} ohne brauchbare Nummer`}\n`);

  /**
   * Phase 4 — CRM und Operations.
   *
   * Erst HIER, nach den Konten: `kunde_zugang` braucht das Kundenkonto, und
   * ohne diesen Zugang kaeme niemand ins Kundenportal. Die Reihenfolge ist
   * also nicht Geschmack, sondern die Abhaengigkeit selbst.
   */
  const [kundenKonto] = await sql<{ id: string }[]>`
    select id from benutzer where email = 'kunde.demo@example.test' limit 1`;
  /*
   * Der Dateispeicher, einmal gewaehlt fuer den ganzen Lauf (V-131, D-623):
   * Supabase, wenn verbunden, sonst der Vorfuehrordner, sonst keiner.
   */
  const dateiSpeicher = waehleSpeicher();
  const verbundenerSpeicher = dateiSpeicher.verbunden ? dateiSpeicher : null;
  const ops = await seedOperations(sql, ids, kundenKonto?.id ?? null, verbundenerSpeicher);
  process.stdout.write(
    `  ${String(ops.objekte)} Objekte, ${String(ops.raeume)} Raeume, `
    + 'Belagsarten und Reinigungsklassen (Leistungswerte: Platzhalter, O-17)\n'
    + `  ${String(ops.belegschaftsdokumente)} der Belegschaft freigegebene `
    + 'Unterlagen (EMP-11, DOC-04) — '
    + (verbundenerSpeicher === null
      ? 'Metadaten ohne Datei, der Bucket ist nicht verbunden\n'
      : `${String(ops.mitDatei)} Dateien als DEMODATEN beschriftet im Speicher\n`),
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
   * Und daneben das Bewacherregister und die Eventdienste — NACH `seedSecurity`,
   * weil beide an derselben Belegschaft und demselben Objekt haengen.
   *
   * Beide Tabellen hatten im ganzen Seed null Zeilen: `/security/bewacherregister`
   * und `/security/veranstaltungen/[id]` waren damit baubar, aber nicht
   * belegbar. Eine Person bleibt bewusst OHNE Registereintrag — genau sie ist
   * die Luecke, die SEC-03 sichtbar machen soll.
   */
  const reg = await seedBewacherUndEvents(sql, ids, sec.objektId);
  process.stdout.write(
    `  ${String(reg.eintraege)} Bewachereintraege handerfasst `
    + `(${String(reg.ohneEintrag)} Person(en) bewusst ohne Eintrag — die Luecke, SEC-03; `
    + `kein Registerabgleich: nicht verbunden, O-40), `
    + `${String(reg.veranstaltungen)} Veranstaltungen `
    + `(Herkunft eines Eventauftrags offen: O-703)\n`,
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
   * Und darauf die Sonderleistungen und die Qualitaetspruefungen — NACH
   * `seedReinigung`, weil beide den Revierzuschnitt brauchen: ein Abruf haengt
   * an einem Revier, und ein Pruefbefund an einem REVIERRAUM. Ohne Zuschnitt
   * gaebe es keinen, und der Befund stuende ohne Ort da.
   *
   * `sonderleistung` und `qualitaetspruefung` hatten im ganzen Seed null
   * Zeilen, `leistungskatalog_position` genau eine. Die Zeitwerte der drei
   * Katalogzeilen sind PLATZHALTER und sagen es (O-17); ein Preis wird nicht
   * erfunden, weil bepreist wird ueber `auftrag_leistung` (0067).
   */
  const sonder = await seedSonderUndQualitaet(sql, ids);
  process.stdout.write(
    `  ${String(sonder.abrufe)} Einzelabrufe in vier Zustaenden `
    + `(„abgerechnet" fehlt absichtlich — den Stempel setzt die Rechnungsuebernahme), `
    + `${String(sonder.pruefungen)} Qualitaetspruefungen `
    + `(ohne Urteil: das Verfahren ist ein Platzhalter ohne Skala, O-29)\n`,
  );

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
  const bau = await seedBau(sql, ids, verbundenerSpeicher);
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
      `  ${String(bau.behinderungen)} Behinderungen nach \u00a7 6 VOB/B, davon `
      + `${String(bau.behinderungenLaufend)} laufend ohne angezeigten Wegfall (BAU-06) `
      + (bau.behinderungenMitBeleg > 0
        ? `\u2014 ${String(bau.behinderungenMitBeleg)} ueber dokumentiereVersand mit archiviertem Schreiben\n`
        : '\u2014 Versandbeleg fehlt: Medienspeicher nicht verbunden\n'),
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
  /**
   * Der Vergaberadar (Phase 8, D-490). Die Bekanntmachungen sind DEMODATEN
   * und tragen deshalb keine Quellenadresse: eine Adresse, die echt aussieht
   * und ins Leere fuehrt, waere eine Behauptung. Bewertet wird gleich danach
   * — sonst zeigt die Radarliste Bekanntmachungen ohne Punkte.
   */
  const radar = await seedRadar(sql, ids);
  process.stdout.write(
    `  ${String(radar.bekanntmachungen)} Bekanntmachungen (Demo, ohne Quellenlink) und `
    + `${String(radar.profile)} Suchprofile — CPV-Listen sind Platzhalter (O-98), `
    + `der Plattformkatalog bleibt leer (O-07); ${String(radar.bewertungen)} Bewertungen; `
    + `eine Vergabemappe in Arbeit mit ${String(radar.mappenpositionen)} Positionen `
    + `(nicht eingereicht — die Plattform reicht nichts ein, D-07); `
    + `${String(radar.empfaenger)} Benachrichtigungsempfaenger OHNE Punktschwelle — `
    + `Fristwarnungen laufen, Treffermeldungen erst mit einer Schwelle (O-15)\n`,
  );

  const frei = await seedFreigaben(sql, ids);
  process.stdout.write(
    frei.vorschlaege === 0
      ? `  Freigabe-Posteingang: ${String(frei.vorhanden)} Vorschlaege bereits vorhanden, nichts nachgelegt\n`
      : `  ${String(frei.vorschlaege)} wartende Vorschlaege im Freigabe-Posteingang mit `
        + `${String(frei.felder)} Feldnachweisen (Demo — kein Agent hat sie erzeugt, PR 62)\n`,
  );
  /**
   * Eine E-Rechnung im Posteingang (PR 63) — nur, wenn der Objektspeicher
   * verbunden ist; sonst sagt der Seed das und legt nichts an (ACC-03).
   */
  const eingang = await seedEingang(sql, ids, verbundenerSpeicher);
  process.stdout.write(
    eingang.status === 'angelegt'
      ? `  E-Rechnung im Freigabe-Posteingang: 1 Vorschlag (UBL, ${String(eingang.unsichereFelder)} unsichere Felder) — PR 63\n`
      : eingang.status === 'vorhanden'
        ? '  E-Rechnung im Freigabe-Posteingang: bereits vorhanden, nichts nachgelegt\n'
        : eingang.status === 'kein_konto'
          ? '  E-Rechnung im Freigabe-Posteingang: KEIN Vorschlag — kein Administrations- oder Leitungskonto der Reinigung\n'
          : '  E-Rechnung im Freigabe-Posteingang: KEIN Vorschlag — Belegspeicher nicht verbunden '
            + '(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY), und ein Beleg ohne Datei ist keiner (ACC-03)\n',
  );
  /**
   * Ausgaben, Kassen und die Eingangsseite des §48 EStG — eine eigene Datei
   * mit EINER Zeile hier: der Seed ist die Datei, an der alle
   * Domänenagenten gleichzeitig arbeiten.
   */
  const ausgaben = await seedFinanzAusgaben(sql, ids);
  process.stdout.write(
    `  ${String(ausgaben.kategorien)} Aufwandskategorien (alle ist_platzhalter — O-05), `
    + `${String(ausgaben.kassen)} Handkassen, ${String(ausgaben.ausgaben)} Ausgaben `
    + `mit ${String(ausgaben.steuerzeilen)} Steuerzeilen (alle in `
    + '`erfasst`: ab `freigegeben` verlangt der CHECK einen Beleg, und ein '
    + 'Beleg ohne Datei ist keiner — ACC-03)\n',
  );
  const konto = await seedKonten(sql, ids);
  process.stdout.write(
    `  ${String(konto.freigegeben)} Zeiteintraege freigegeben (Demo-Annahme), `
    + `${String(konto.konten)} Stundenkonten, ${String(konto.buchungen)} Buchungen `
    + `ueber ${String(konto.minuten)} Minuten (Sollzeit bleibt offen: O-18)\n`,
  );

  const post = await seedBenachrichtigungen(sql);
  process.stdout.write(
    `  Posteingang: ${String(post.angelegt)} Benachrichtigungen angelegt, `
    + `${String(post.vorhanden)} bereits vorhanden`
    + (post.ohneKonto === 0 ? '' : `, ${String(post.ohneKonto)} ohne Konto`)
    + (post.ohneEmpfaenger === 0
      ? '' : `, ${String(post.ohneEmpfaenger)} Ablaufwarnungen ohne Zugang zur Person (D-09)`)
    + ' — über erzeuge(), meldeAblaufwarnungen() und die Zustellung, NOT-01/NOT-03\n',
  );

  /*
   * Teams, Aufgaben und ein Nachrichtenfaden je Gesellschaft (OPS-11, EMP-11).
   *
   * NACH den Auftraegen und Leads, weil die Aufgaben daran haengen: ein Bezug
   * auf eine erfundene Kennung waere ein toter Verweis in der Liste, und genau
   * den soll die Bezugsaufloesung nicht produzieren.
   */
  const kern = await seedKern(sql);
  process.stdout.write(
    `  Kern: ${String(kern.teams)} Teams mit ${String(kern.mitglieder)} Mitgliedern, `
    + `${String(kern.aufgaben)} Aufgaben (eine ueberfaellig, eine heute, eine `
    + `ohne Frist und ohne Bezug) und ${String(kern.faeden)} Nachrichtenfaeden `
    + '— intern, Kanal Portal, nichts gesendet (kein Versender verbunden, O-36)\n',
  );

  /**
   * Zum Schluss: die Demokennwörter (D-501). Nach allen Konten, weil sie
   * jedes anfassen — auch die, die weiter oben erst entstanden sind.
   */
  const zugang = await seedZugangsdaten(sql, devFlaechenAn());
  process.stdout.write(
    zugang.uebersprungen
      ? '  Demokennwörter: KEINE — ohne CSE_DEV_FLAECHEN legt der Seed keines an. '
        + 'Die Konten kommen über eine Einladung zu ihrem eigenen (AUT-04).\n'
      : `  ${String(zugang.gesetzt)} Demokennwörter gesetzt, ${String(zugang.vorhanden)} `
        + `bereits vorhanden (unverändert). Anmeldung: /auth/login, Kennwort `
        + `„${DEMO_KENNWORT}" — Mitarbeiterkonten ausgenommen (EMP-01: kein Kennwort).\n`,
  );

  /**
   * Die Lücken der Berichte — Anfragen und Vergabevorgänge dort, wo eine
   * Gesellschaft sonst eine Null zeigte.
   */
  const berichtsdaten = await seedBerichtsdaten(sql, ids, demodaten);
  if (!berichtsdaten.uebersprungen) {
    process.stdout.write(
      `  Berichtslücken: ${String(berichtsdaten.leads)} Anfragen, `
      + `${String(berichtsdaten.vorgaenge)} Vergabevorgänge und `
      + `${String(berichtsdaten.zeiten)} freigegebene Zeiten und `
      + `${String(berichtsdaten.termine)} Termine — damit jede Gesellschaft in jedem der `
      + 'sechs Berichte und im Kalender eine Zeile hat\n');
  }

  /**
   * Das Social Media Center: die Kanäle IMMER (sie sind Struktur, kein
   * Demodatum), die Beiträge nur auf der Vorführfläche — sie landen auf einer
   * öffentlichen Gesellschaftsseite.
   */
  const social = await seedSocial(sql, ids, demodaten);
  process.stdout.write(
    `  Social: ${String(social.kanaele)} Kanäle (alle NICHT verbunden, O-10)`
    + (social.uebersprungen
      ? ' — keine Beiträge ohne CSE_DEV_FLAECHEN\n'
      : `, ${String(social.beitraege)} Beiträge in vier Zuständen, `
        + `${String(social.referenzen)} freigegebene Referenzen (SOC-04) und `
        + `${String(social.galeriebilder)} Galeriebilder — als PLATZHALTER markiert, `
        + `weil die fünf CC0-Motive kein Objekt dieser Gruppe zeigen (O-13)\n`));

  /**
   * Recruiting NACH den Freigaben: eine veröffentlichte Stelle hängt an einer
   * genehmigten Freigabe (`stelle_freigegeben_hat_freigabe`, 0166), und die
   * Demo umgeht den Riegel nicht — sie erfüllt ihn.
   */
  const recruiting = await seedRecruiting(sql, ids, demodaten);
  process.stdout.write(recruiting.uebersprungen
    ? '  Recruiting: keine Demodaten ohne CSE_DEV_FLAECHEN\n'
    : `  Recruiting: ${String(recruiting.stellen)} Stellen, `
      + `${String(recruiting.bewerbungen)} Bewerbungen `
      + `(eine je Stelle abgelaufen und eine gesperrt — REC-07), `
      + `${String(recruiting.bewertungen)} Bewertungskriterien, `
      + `${String(recruiting.antworten)} Antwortentwürfe (KEINER gesendet — `
      + `kein Postausgang verbunden, O-501)\n`);

  /*
   * Die Akquise. Die vier Quellen und der übersprungene Lauf entstehen immer;
   * die Firmen nur mit Demoflagge. Vor den Rechnungen, weil sie von nichts
   * abhängt — und nach dem CRM, weil ihr Zielbild der Lead ist.
   */
  const akquise = await seedAkquise(sql, ids, demodaten);
  process.stdout.write(
    `  Akquise: ${String(akquise.quellen)} Recherchequellen (KEINE verbunden, O-596), `
    + `${String(akquise.laeufe)} protokollierte Leerläufe`
    + (akquise.uebersprungen
      ? ' — keine Firmen ohne CSE_DEV_FLAECHEN\n'
      : `, ${String(akquise.ziele)} recherchierte Firmen OHNE Personendaten `
        + '(Art. 14 DSGVO — die Spalten dafür gibt es nicht)\n'));

  /*
   * Betroffenenrechte und Widersprueche — NACH dem CRM und dem Recruiting,
   * weil sie sich auf einen Kontakt und eine Bewerbung zuordnen, und nach
   * den Anstellungen, weil eine Anfrage einer Person zugeordnet wird.
   *
   * Vor diesem Aufruf legte der Seed NULL betroffenenanfrage-Zeilen an: es
   * gab keine `[id]`, die man haette aufrufen koennen, und die vier
   * Vorgangsseiten waren weder klickbar noch e2e-pruefbar.
   */
  const datenschutz = await seedDatenschutz(sql, ids, demodaten);
  process.stdout.write(datenschutz.uebersprungen
    ? '  Datenschutz: keine Betroffenenanfragen ohne CSE_DEV_FLAECHEN\n'
    : `  Datenschutz: ${String(datenschutz.anfragen)} Betroffenenanfragen `
      + '(eine ueberfaellig, eine verlaengert, eine beantwortet — Art. 12 Abs. 3), '
      + `${String(datenschutz.loeschentscheidungen)} Loeschentscheidungen, `
      + `${String(datenschutz.berichtigungsfelder)} Berichtigungsfelder, `
      + `${String(datenschutz.auskuenfte)} Auskunftsartefakte mit Pruefsumme, `
      + `${String(datenschutz.werbewiderspruch)} Werbewiderspruch (ueber den `
      + 'Token eingeloest, K-09) und '
      + `${String(datenschutz.art21)} Widerspruch nach Art. 21 `
      + '(rechtsgrundlage faellt auf „keine")\n');

  /*
   * Die CRM-Angaben der vier Unterseiten — NACH `seedOperations` (Kunden und
   * Ansprechpartner) und nach `seedZugangsdaten` (das Konto, dem die
   * Wiedervorlagen gehoeren).
   *
   * Vor diesem Aufruf standen auf `kunde` NULL Debitorennummern, NULL
   * Zahlungsziele, NULL Mahnsperren und NULL Uebertragungswege, in
   * `kunde_bauleistender_status` und `freistellungsbescheinigung` NULL Zeilen
   * und in `lead_aktivitaet` NULL Faelligkeiten. Vier Seiten hatten damit eine
   * Ueberschrift und sonst nichts.
   */
  const crm = await seedCrm(sql, ids, demodaten);
  process.stdout.write(crm.uebersprungen
    ? '  CRM: keine Konditionen und Nachweise ohne CSE_DEV_FLAECHEN\n'
    : `  CRM: ${String(crm.konditionen)} Zahlungskondition `
      + '(die uebrigen bleiben LEER — O-66 ist offen, 14 waere geraten), '
      + `${String(crm.mahnsperren)} Mahnsperre mit Grund, `
      + `${String(crm.erechnung)} Uebertragungsweg `
      + '(ozg_re, in dieser Installation NICHT verbunden — O-22), '
      + `${String(crm.zeitscheiben)} §-13b-Zeitscheiben `
      + '(erst kein Bauleistender, dann einer — der Stichtag entscheidet, O-21), '
      + `${String(crm.bescheinigungen)} §-48b-Bescheinigung, `
      + `${String(crm.wiedervorlagen)} Wiedervorlagen in allen vier Faechern und `
      + `${String(crm.aehnlicheLeistung)} begruendete §-7-Abs.-3-Wertung `
      + '(noch ohne Wirkung im Tor — O-660)\n');

  /**
   * Zuletzt die Ausgangsrechnungen — nach Kunden, Konten und Nummernkreisen,
   * weil sie alle drei brauchen.
   */
  const rechnungen = await seedRechnungen(sql, ids, demodaten);
  process.stdout.write(
    rechnungen.uebersprungen
      ? `  Ausgangsrechnungen: KEINE — ${rechnungen.grund ?? 'übersprungen'}\n`
      : `  ${String(rechnungen.festgeschrieben)} festgeschriebene Rechnungen `
        + `(${rechnungen.nummern.join(', ')}) und ${String(rechnungen.entwuerfe)} Entwürfe `
        + 'ohne Nummer — über legeEntwurfAn → fuegePositionHinzu → finalisiere, '
        + 'als cse_app mit gebundener Sitzung\n');

  process.stdout.write('\nSeed fertig.\n');
  if (demodaten) {
    process.stdout.write(
      'DEMOBETRIEB — was hier eine offene Frage überbrückt, steht IM DATENSATZ:\n'
      + '  • Rechnungsnummern beginnen mit DEMO- (O-134 unbeantwortet, die Maske ist '
      + 'geraten)\n'
      + '  • das KI-Modell trägt anbieter = \'demo\' (D-499)\n'
      + '  • das Monatsbudget ist ein Platzhalter (O-26)\n'
      + 'Ohne CSE_DEV_FLAECHEN entsteht nichts davon.\n');
  }
  process.stdout.write('OFFEN, unabhängig vom Demobetrieb:\n');
  process.stdout.write('  • O-134 — Rechnungsnummern-Maske je Gesellschaft bestätigen\n');
  process.stdout.write('  • O-01  — ist CSE Operations eine GmbH oder eine Abteilung?\n');
  await sql.end();
}

await main();
