/**
 * PR 35 gegen die echte Datenbank — die vier Abnahmekriterien, jedes als
 * eigener Fall, und jedes so gebaut, dass es OHNE die Umsetzung fehlschlaegt.
 *
 * Zwei davon entscheiden diesen PR, und sie sind hier die ausfuehrlichsten:
 * die doppelt eingespielte Warteschlange und die nachgereichte Behauptung, die
 * einen bereits serverseitig erfassten Datensatz NICHT anfasst. Beides sind
 * Fehler, die in Produktion nicht auffallen — sie erzeugen plausible Zahlen,
 * keine Ausnahmen: eine doppelt abgerechnete Nachtschicht und ein
 * ueberschriebener § 17-Nachweis sehen beide voellig normal aus.
 *
 * Der Test legt seine Stammdaten selbst an (Kunde, Objekt, Einsatz, Zuordnung,
 * Konto), weil der Seed sie noch nicht kennt.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

interface Aufbau {
  readonly mandant: string;
  readonly objekt: string;
  readonly einsatz: string;
  readonly zuordnung: string;
  readonly anstellung: string;
  readonly person: string;
  readonly benutzer: string;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string, personId: string | null = null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId] as never[]);
  return u!.id;
}

async function mitglied(b: string, m: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [b, m, await rolleId(rolle)]);
}

async function baueEinsatz(opts: {
  beginn?: string; ende?: string; person?: 'fatima' | 'jonas';
} = {}): Promise<Aufbau> {
  const mandant = f.reinigung;
  const person = opts.person === 'jonas' ? f.jonas : f.fatima;
  const anstellung = opts.person === 'jonas' ? f.jonasReinigung : f.fatimaReinigung;
  const beginn = opts.beginn ?? new Date(Date.now() + 10 * 60_000).toISOString();
  const ende = opts.ende ?? new Date(Date.now() + 8 * 3_600_000).toISOString();

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Testkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Buerohaus Nord','Teststr. 3','10115','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                          endet_am_folgetag, objekt_id, kunde_id, erstellt_von_art)
     values ($1,'manuell',$2, (($3::timestamptz) at time zone 'Europe/Berlin')::date,
             $3::timestamptz, $4::timestamptz,
             (($3::timestamptz) at time zone 'Europe/Berlin')::time,
             (($4::timestamptz) at time zone 'Europe/Berlin')::time,
             (($4::timestamptz) at time zone 'Europe/Berlin')::date
               > (($3::timestamptz) at time zone 'Europe/Berlin')::date,
             $5, $6, 'system')
     returning id`,
    [mandant, `manuell:${zufall()}${zufall()}`, beginn, ende, o!.id, k!.id] as never[]);
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
     values ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,'system') returning id`,
    [mandant, e!.id, anstellung, person, beginn, ende] as never[]);

  const benutzer = await konto(`kraft-${zufall()}@cse.test`, person);
  await mitglied(benutzer, mandant, 'mitarbeiter');
  return { mandant, objekt: o!.id, einsatz: e!.id, zuordnung: z!.id, anstellung, person, benutzer };
}

/** Gibt eine Marke aus und liefert sie im Klartext — wie `app.checkin_ausgeben`. */
async function marke(zuordnung: string, zweck: 'checkin' | 'checkout',
                     planer: string): Promise<string> {
  const [zeile] = await alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId: planer,
      portal: 'intern', readonly: false },
    async (tx) => tx.unsafe<{ marke: string }[]>(
      `select app.checkin_ausgeben($1::uuid, $2::token_zweck) as marke`,
      [zuordnung, zweck] as never[]),
  );
  return zeile!.marke;
}

interface Ereignis {
  readonly client_ereignis_id: string;
  readonly art: string;
  readonly behauptete_zeit: string;
  readonly geraete_zeit?: string | null;
  readonly geraet_id?: string | null;
  readonly user_agent?: string | null;
  readonly roh?: string;
  readonly geo?: unknown;
  readonly medium?: unknown;
}

interface Annahme { ereignis_kennung: string; vorgang_id: string; ergebnis: string }

/**
 * Der sitzungslose Wiedergabepfad — genau das, was die Route tut (K-08).
 *
 * `alsRolle('cse_checkin')` und nicht der Eigentuemer: der Prinzipal ist Teil
 * der Zusage. Liefe der Test als Eigentuemer, bestuende er auch dann, wenn der
 * Grant fehlte und der Endpunkt in Produktion mit „function does not exist"
 * geschlossen fiele.
 */
async function reiche(token: string, ereignisse: readonly Ereignis[],
                      ip = '203.0.113.7'): Promise<readonly Annahme[]> {
  return alsRolle('cse_checkin', async (tx) =>
    tx.unsafe<Annahme[]>(
      `select ereignis_kennung, vorgang_id, ergebnis
         from app.offline_ereignis_annehmen(
           encode(digest($1,'sha256'),'hex'), $2::jsonb, $3::inet)`,
      [token, ereignisse.map((e) => ({ roh: JSON.stringify(e), ...e })), ip] as never[]));
}

function ereignis(art: string, behauptet: Date, extra: Partial<Ereignis> = {}): Ereignis {
  return {
    client_ereignis_id: randomUUID(),
    art,
    behauptete_zeit: behauptet.toISOString(),
    geraete_zeit: behauptet.toISOString(),
    geraet_id: 'testgeraet',
    user_agent: 'Testgeraet',
    ...extra,
  };
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) beide Zeitpunkte stehen nebeneinander, keiner ueberschreibt den anderen', () => {
  it('die Behauptung und der Servereingang sind zwei Spalten, und die Planung sieht beide',
    async () => {
      const a = await baueEinsatz();
      const planer = await konto(`planer-${zufall()}@cse.test`);
      await mitglied(planer, f.reinigung, 'leitung');
      const token = await marke(a.zuordnung, 'checkin', planer);

      // Vor drei Stunden getippt, jetzt erst uebertragen — das Funkloch.
      const getippt = new Date(Date.now() - 3 * 3_600_000);
      const [ok] = await reiche(token, [ereignis('checkin', getippt)]);
      expect(ok!.ergebnis).toBe('empfangen');

      const [zeile] = await sql.unsafe<{
        behauptete_zeit: Date; empfangen_am: Date; verzoegerung_sek: number;
        zeitabweichung_sek: number; mandant_id: string; anstellung_id: string;
        person_id: string; status: string;
      }[]>(
        `select behauptete_zeit, empfangen_am, verzoegerung_sek, zeitabweichung_sek,
                mandant_id, anstellung_id, person_id, status::text as status
           from offline_ereignis where id = $1`, [ok!.vorgang_id]);

      // Die Behauptung steht unveraendert da …
      expect(zeile!.behauptete_zeit.toISOString()).toBe(getippt.toISOString());
      // … und der Eingang ist die SERVERUHR, nicht sie.
      expect(Math.abs(zeile!.empfangen_am.getTime() - Date.now())).toBeLessThan(10_000);
      /**
       * Rund drei Stunden Verspaetung, aus der Differenz abgeleitet — nicht
       * vom Geraet mitgeschickt. Ohne diese Zahl waere „verspaetet" eine
       * Behauptung des Absenders.
       */
      expect(zeile!.verzoegerung_sek).toBeGreaterThan(10_700);
      expect(zeile!.verzoegerung_sek).toBeLessThan(10_900);

      // Mandant, Beschaeftigung und Mensch kommen AUS DER MARKE (K-08).
      expect(zeile!.mandant_id).toBe(f.reinigung);
      expect(zeile!.anstellung_id).toBe(a.anstellung);
      expect(zeile!.person_id).toBe(a.person);
      expect(zeile!.status).toBe('empfangen');
    });

  it('und es entsteht KEIN Zeiteintrag, bis ein Mensch entschieden hat (§9.4)', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    await reiche(await marke(a.zuordnung, 'checkin', planer),
      [ereignis('checkin', new Date(Date.now() - 3_600_000))]);

    const [zahl] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text n from zeiteintrag where einsatz_zuordnung_id = $1`, [a.zuordnung]);
    /**
     * Der Kern der Entscheidung aus B11. Wuerde hier ein Eintrag entstehen,
     * stuende ein vom Telefon behaupteter Zeitpunkt in einer massgeblichen
     * Spalte — und Invariante 5 haenge daran, ob spaeter jemand prueft.
     */
    expect(zahl!.n).toBe('0');
  });

  it('die Uebernahme durch einen Menschen schreibt Eintrag UND Korrekturzeile', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    const getippt = new Date(Date.now() - 4 * 3_600_000);
    const [ok] = await reiche(await marke(a.zuordnung, 'checkin', planer),
      [ereignis('checkin', getippt)]);

    // Der Beginn, den der MENSCH eintraegt — hier zehn Minuten spaeter als
    // behauptet, damit der Test die Unterscheidung ueberhaupt sehen kann.
    const entschieden = new Date(getippt.getTime() + 600_000);
    const [erg] = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: planer,
        portal: 'intern', readonly: false },
      async (tx) => tx.unsafe<{ id: string }[]>(
        `select app.offline_uebernehmen($1::uuid, $2::timestamptz, $3::timestamptz, $4) as id`,
        [ok!.vorgang_id, entschieden.toISOString(),
          new Date(entschieden.getTime() + 3_600_000).toISOString(),
          'Kraft hat per Zettel gemeldet, Netz war im Keller weg.'] as never[]));

    const [z] = await sql.unsafe<{
      beginn_zeitpunkt: Date; behauptet_beginn: Date; quelle_beginn: string;
      erfassungsart_beginn: string; nacherfasst: boolean; offline_ereignis_id: string;
    }[]>(
      `select beginn_zeitpunkt, behauptet_beginn, quelle_beginn, erfassungsart_beginn,
              nacherfasst, offline_ereignis_id
         from zeiteintrag where id = $1`, [erg!.id]);

    // Der MASSGEBLICHE Beginn ist der des Menschen …
    expect(z!.beginn_zeitpunkt.toISOString()).toBe(entschieden.toISOString());
    // … und die Behauptung steht daneben, unveraendert.
    expect(z!.behauptet_beginn.toISOString()).toBe(getippt.toISOString());
    expect(z!.quelle_beginn).toBe('planer_entscheidung');
    expect(z!.erfassungsart_beginn).toBe('nacherfassung');
    expect(z!.nacherfasst).toBe(true);
    expect(z!.offline_ereignis_id).toBe(ok!.vorgang_id);

    /**
     * Die Korrekturzeile ist der Beleg, ohne den `planer_entscheidung` nicht
     * rechtmaessig ist (§1.8). `vorher` traegt die Behauptung, `nachher` den
     * Datensatz — genau die Frage, um die es im Lohnstreit geht.
     */
    const [k] = await sql.unsafe<{
      art: string; grund_kategorie: string; durchgefuehrt_von: string;
      vorher: Record<string, unknown>; begruendung: string;
    }[]>(
      `select art::text as art, grund_kategorie::text as grund_kategorie, durchgefuehrt_von,
              vorher, begruendung
         from zeiteintrag_korrektur where ursprung_zeiteintrag_id = $1`, [erg!.id]);
    expect(k!.art).toBe('nacherfassung');
    expect(k!.grund_kategorie).toBe('nachtrag_offline');
    expect(k!.durchgefuehrt_von).toBe(planer);
    expect(k!.vorher['offline_ereignis_id']).toBe(ok!.vorgang_id);
    expect(k!.begruendung).toContain('Keller');

    // Und der Anspruch ist entschieden, mit benanntem Menschen.
    const [o] = await sql.unsafe<{ status: string; entschieden_von: string }[]>(
      `select status::text as status, entschieden_von from offline_ereignis where id = $1`,
      [ok!.vorgang_id]);
    expect(o!.status).toBe('uebernommen');
    expect(o!.entschieden_von).toBe(planer);
  });
});

describe('(2) doppelt eingespielt heisst EINE Zeile (K-09)', () => {
  it('dieselbe Warteschlange zweimal gesendet ergibt einen Vorgang, nicht zwei', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    const token = await marke(a.zuordnung, 'checkin', planer);

    const e = ereignis('checkin', new Date(Date.now() - 3_600_000));
    const erst = await reiche(token, [e]);
    // Das Telefon hat die Antwort nicht gesehen und sendet noch einmal.
    const zweit = await reiche(token, [e]);

    expect(zweit[0]!.vorgang_id).toBe(erst[0]!.vorgang_id);
    const [zahl] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text n from offline_ereignis where client_ereignis_id = $1`,
      [e.client_ereignis_id]);
    expect(zahl!.n).toBe('1');
  });

  it('AUCH DANN, wenn die Geraetekennung ausgeschaltet ist — die ausgelieferte Vorgabe',
    async () => {
      /**
       * **Der Fall, an dem sich dieser PR entscheidet.**
       *
       * §5.9 nennt `(geraet_id, client_ereignis_id)` als Schluessel gegen die
       * Doppeleinspielung. §1.15 sagt aber: solange `zeit.geraetekennung` aus
       * ist — und sie wird AUS ausgeliefert —, ist `geraet_id` ein Zufallswert
       * je Einreichung. Dann ist der zusammengesetzte Schluessel bei jeder
       * Wiedergabe ein anderer, und dieselbe Nachtschicht steht zweimal in der
       * Warteschlange: zwei Ansprueche auf eine Stunde, beide plausibel.
       *
       * Ohne den zweiten Index `oe_client_uk` schlaegt dieser Fall fehl.
       */
      const a = await baueEinsatz();
      const planer = await konto(`planer-${zufall()}@cse.test`);
      await mitglied(planer, f.reinigung, 'leitung');
      const token = await marke(a.zuordnung, 'checkin', planer);

      const [an] = await sql.unsafe<{ wert: string }[]>(
        `select wert::text as wert from mandant_einstellung
          where mandant_id = $1 and schluessel = 'zeit.geraetekennung'`, [f.reinigung]);
      expect(an?.wert ?? 'false').toBe('false');

      const e = ereignis('checkin', new Date(Date.now() - 3_600_000));
      // Das Telefon schickt beim zweiten Mal EINE ANDERE Geraetekennung mit —
      // so wie es ein Browser ohne stabile Installations-id tut.
      const erst = await reiche(token, [{ ...e, geraet_id: `zufall-${zufall()}` }]);
      const zweit = await reiche(token, [{ ...e, geraet_id: `zufall-${zufall()}` }]);

      expect(zweit[0]!.vorgang_id).toBe(erst[0]!.vorgang_id);
      const [zahl] = await sql.unsafe<{ n: string }[]>(
        `select count(*)::text n from offline_ereignis where einsatz_zuordnung_id = $1`,
        [a.zuordnung]);
      expect(zahl!.n).toBe('1');

      /**
       * Und die Sperre haengt an der DATENBANK, nicht an einer Klausel in der
       * Funktion: auch als EIGENTUEMER, unter Umgehung jeder Policy und jedes
       * `on conflict`, entsteht keine zweite Zeile mit derselben
       * Geraetekennung des Ereignisses. Ohne diese Zusicherung koennte ein
       * spaeterer Schreibweg die Doppelerkennung schlicht auslassen.
       */
      await expect(sql.unsafe(
        `insert into offline_ereignis
              (mandant_id, client_ereignis_id, geraet_id, einsatz_id, einsatz_zuordnung_id,
               anstellung_id, person_id, art, behauptete_zeit,
               geraete_zeit_bei_uebertragung, zeitabweichung_sek, verzoegerung_sek,
               nutzlast_roh, nutzlast_sha256, erstellt_von_art, erstellt_von)
         values ($1,$2,$3,$4,$5,$6,$7,'checkin',now(),now(),0,0,'{}',$8,'mensch',$9)`,
        [f.reinigung, e.client_ereignis_id, `noch-ein-zufall-${zufall()}`, a.einsatz,
          a.zuordnung, a.anstellung, a.person, 'f'.repeat(64), a.benutzer] as never[]),
      ).rejects.toThrow(/oe_client_uk/u);
    });

  it('eine Marke, die nicht aufloest, verschwindet nicht — sie landet im Vorbereich', async () => {
    const unbekannt = 'gibtesnicht-' + zufall();
    const e = ereignis('checkin', new Date(Date.now() - 3_600_000));
    const [ok] = await reiche(unbekannt, [e]);

    /**
     * Die Antwort ist DIESELBE wie bei einer gueltigen Marke. Eine Antwort,
     * die die Faelle unterscheidet, beantwortet jedem Durchprobierenden genau
     * die Frage, die er stellt (AUT-06).
     */
    expect(ok!.ergebnis).toBe('empfangen');
    expect(ok!.vorgang_id).not.toBeNull();

    const [zeile] = await sql.unsafe<{ grund: string; nutzlast_roh: string }[]>(
      `select grund::text as grund, nutzlast_roh
         from zeit_intern.offline_eingang where id = $1`, [ok!.vorgang_id]);
    expect(zeile!.grund).toBe('token_ungueltig');
    // Der Beweis ist BYTE-TREU da: „ich habe mit dem Link gestempelt, den ihr
    // mir geschickt habt" ist genau der strittige Fall (B13, LEG-02).
    expect(zeile!.nutzlast_roh).toContain(e.client_ereignis_id);

    // Und in `offline_ereignis` steht nichts: es gibt keinen Mandanten dafuer.
    const [zahl] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text n from offline_ereignis where client_ereignis_id = $1`,
      [e.client_ereignis_id]);
    expect(zahl!.n).toBe('0');

    // Auch der Vorbereich dedupliziert.
    await reiche(unbekannt, [e]);
    const [zahl2] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text n from zeit_intern.offline_eingang where client_ereignis_id = $1`,
      [e.client_ereignis_id]);
    expect(zahl2!.n).toBe('1');
  });
});

describe('(3) eine nachgereichte Behauptung ueberschreibt nie einen erfassten Datensatz',
  () => {
    it('nach einem echten Check-in bleibt der Zeiteintrag Byte fuer Byte, wie er war',
      async () => {
        const a = await baueEinsatz();
        const planer = await konto(`planer-${zufall()}@cse.test`);
        await mitglied(planer, f.reinigung, 'leitung');
        const token = await marke(a.zuordnung, 'checkin', planer);

        // Erst der echte, serverseitige Check-in.
        const [ein] = await alsRolle('cse_checkin', async (tx) =>
          tx.unsafe<{ zeiteintrag_id: string }[]>(
            `select zeiteintrag_id from app.checkin_verbrauchen(
               encode(digest($1,'sha256'),'hex'), null::timestamptz, $2::inet, 'Testgeraet', null)`,
            [token, '203.0.113.7'] as never[]));
        expect(ein!.zeiteintrag_id).not.toBeNull();

        const vorher = await sql.unsafe<Record<string, unknown>[]>(
          `select to_jsonb(z) as z from zeiteintrag z where z.id = $1`, [ein!.zeiteintrag_id!]);

        // Und jetzt kommt das Telefon aus dem Funkloch und behauptet dasselbe
        // Bein — drei Stunden frueher.
        const [ok] = await reiche(token,
          [ereignis('checkin', new Date(Date.now() - 3 * 3_600_000))]);

        const nachher = await sql.unsafe<Record<string, unknown>[]>(
          `select to_jsonb(z) as z from zeiteintrag z where z.id = $1`, [ein!.zeiteintrag_id!]);
        // Nicht „ungefaehr gleich": IDENTISCH. Ein veraenderter Beginn waere
        // ein gefaelschter § 17-Nachweis, und er saehe voellig plausibel aus.
        expect(nachher[0]!['z']).toEqual(vorher[0]!['z']);

        // Es gibt weiterhin GENAU EINEN Zeiteintrag.
        const [zahl] = await sql.unsafe<{ n: string }[]>(
          `select count(*)::text n from zeiteintrag where einsatz_zuordnung_id = $1`,
          [a.zuordnung]);
        expect(zahl!.n).toBe('1');

        /**
         * Und die Behauptung liegt sichtbar in der MANUELLEN PRUEFUNG, nicht
         * still in der Warteschlange: zu diesem Bein gibt es bereits einen
         * Datensatz, also muss ein Mensch hinsehen.
         */
        const [o] = await sql.unsafe<{ status: string }[]>(
          `select status::text as status from offline_ereignis where id = $1`, [ok!.vorgang_id]);
        expect(o!.status).toBe('manuelle_pruefung');
      });

    it('eine Einreichung jenseits des Nacherfassungsfensters wird geprueft, nie verworfen',
      async () => {
        const a = await baueEinsatz();
        const planer = await konto(`planer-${zufall()}@cse.test`);
        await mitglied(planer, f.reinigung, 'leitung');
        // Zwanzig Tage alt — weit ueber der gesetzlichen Hoechstfrist von
        // sieben Kalendertagen (§ 17 Abs. 1 MiLoG).
        const [ok] = await reiche(await marke(a.zuordnung, 'checkin', planer),
          [ereignis('checkin', new Date(Date.now() - 20 * 86_400_000))]);

        const [o] = await sql.unsafe<{ status: string }[]>(
          `select status::text as status from offline_ereignis where id = $1`, [ok!.vorgang_id]);
        expect(o!.status).toBe('manuelle_pruefung');
      });

    it('eine Ablehnung loescht nichts — die Behauptung bleibt mit ihrem Grund stehen',
      async () => {
        const a = await baueEinsatz();
        const planer = await konto(`planer-${zufall()}@cse.test`);
        await mitglied(planer, f.reinigung, 'leitung');
        const [ok] = await reiche(await marke(a.zuordnung, 'checkin', planer),
          [ereignis('checkin', new Date(Date.now() - 3_600_000))]);

        await alsApp(
          { scope: 'mandant', mandantId: f.reinigung, benutzerId: planer,
            portal: 'intern', readonly: false },
          async (tx) => tx.unsafe(
            `select app.offline_ablehnen($1::uuid, 'unplausibel'::ablehnung_grund, $2)`,
            [ok!.vorgang_id, 'Objekt war an dem Tag geschlossen.'] as never[]));

        const [o] = await sql.unsafe<{
          status: string; ablehnungsgrund: string; behauptete_zeit: Date;
        }[]>(
          `select status::text as status, ablehnungsgrund::text as ablehnungsgrund,
                  behauptete_zeit
             from offline_ereignis where id = $1`, [ok!.vorgang_id]);
        expect(o!.status).toBe('abgelehnt');
        expect(o!.ablehnungsgrund).toBe('unplausibel');
        expect(o!.behauptete_zeit).not.toBeNull();

        // Und ein zweiter Anlauf prallt ab: entschieden ist entschieden.
        await expect(alsApp(
          { scope: 'mandant', mandantId: f.reinigung, benutzerId: planer,
            portal: 'intern', readonly: false },
          async (tx) => tx.unsafe(
            `select app.offline_uebernehmen($1::uuid, now(), null, $2)`,
            [ok!.vorgang_id, 'Doch noch uebernehmen'] as never[]),
        )).rejects.toThrow(/bereits entschieden/u);
      });

    it('und die Behauptung selbst laesst sich nicht nachtraeglich verschieben', async () => {
      const a = await baueEinsatz();
      const planer = await konto(`planer-${zufall()}@cse.test`);
      await mitglied(planer, f.reinigung, 'leitung');
      const [ok] = await reiche(await marke(a.zuordnung, 'checkin', planer),
        [ereignis('checkin', new Date(Date.now() - 3_600_000))]);

      /**
       * Als EIGENTUEMER, also ohne jede Policy — und trotzdem abgewiesen. Waere
       * die Behauptung verschiebbar, waere die ganze Tabelle wertlos, und zwar
       * unauffaellig: der neue Wert saehe genauso plausibel aus wie der alte.
       */
      await expect(sql.unsafe(
        `update offline_ereignis set behauptete_zeit = now() where id = $1`, [ok!.vorgang_id]),
      ).rejects.toThrow(/unveraenderlich/u);
    });
  });

describe('(4) Medien: privater Bucket, Elternteil im selben Mandanten, kein hartes Loeschen',
  () => {
    it('ein Foto aus der Warteschlange landet an der Schicht und traegt einen Menschen',
      async () => {
        const a = await baueEinsatz();
        const planer = await konto(`planer-${zufall()}@cse.test`);
        await mitglied(planer, f.reinigung, 'leitung');
        const medienId = randomUUID();
        const [ok] = await reiche(await marke(a.zuordnung, 'checkin', planer), [
          ereignis('foto', new Date(), {
            medium: {
              art: 'foto', bucket: 'einsatz-medien',
              pfad: `${f.reinigung}/${medienId}`,
              mime_typ: 'image/jpeg', groesse_bytes: 4096,
              sha256: 'a'.repeat(64), exif_entfernt: true,
            },
          }),
        ]);

        const [m] = await sql.unsafe<{
          id: string; bezug_tabelle: string; bezug_id: string; mandant_id: string;
          kunde_id: string | null; bucket: string; exif_entfernt: boolean;
          erstellt_von_art: string; erstellt_von_person_id: string;
        }[]>(
          `select m.id, m.bezug_tabelle, m.bezug_id, m.mandant_id, m.kunde_id, m.bucket,
                  m.exif_entfernt, m.erstellt_von_art::text as erstellt_von_art,
                  m.erstellt_von_person_id
             from einsatz_medien m
             join offline_ereignis o on o.medien_id = m.id
            where o.id = $1`, [ok!.vorgang_id]);

        // Ohne laufenden Zeiteintrag haengt die Aufnahme an der SCHICHT.
        expect(m!.bezug_tabelle).toBe('einsatz');
        expect(m!.bezug_id).toBe(a.einsatz);
        expect(m!.mandant_id).toBe(f.reinigung);
        // Die Kundenkennung ist ABGELEITET, nicht eingereicht — sie ist der
        // Schluessel, auf dem die Kundendecke aufsetzt.
        expect(m!.kunde_id).not.toBeNull();
        expect(m!.bucket).toBe('einsatz-medien');
        expect(m!.exif_entfernt).toBe(true);
        // Ein Medium traegt IMMER einen Menschen (me_definer_insert).
        expect(m!.erstellt_von_art).toBe('mensch');
        expect(m!.erstellt_von_person_id).toBe(a.person);
      });

    it('ein Elternteil aus einer ANDEREN Gesellschaft wird abgewiesen', async () => {
      const a = await baueEinsatz();
      /**
       * Der Fall, den ein Fremdschluessel gegeben haette und den hier ein
       * Ausloeser holen muss. Ohne ihn haengt eine Reinigungsaufnahme
       * widerspruchsfrei an einer Security-Schicht: die Zeile traegt ja ihren
       * eigenen `mandant_id`, und der stimmt mit der Sitzung ueberein.
       */
      await expect(sql.unsafe(
        `insert into einsatz_medien (mandant_id, bezug_tabelle, bezug_id, art, pfad,
                                     mime_typ, groesse_bytes, sha256,
                                     erstellt_von_art, erstellt_von_person_id, erstellt_von)
         values ($1,'einsatz',$2,'foto',$3,'image/jpeg',10,$4,'mensch',$5,$6)`,
        [f.security, a.einsatz, `${f.security}/${randomUUID()}`, 'b'.repeat(64),
          a.person, a.benutzer] as never[]),
      ).rejects.toThrow(/keinen Elternteil in dieser Gesellschaft/u);
    });

    it('ein oeffentlicher Bucket ist auf Schemaebene unmoeglich', async () => {
      const a = await baueEinsatz();
      await expect(sql.unsafe(
        `insert into einsatz_medien (mandant_id, bezug_tabelle, bezug_id, art, bucket, pfad,
                                     mime_typ, groesse_bytes, sha256,
                                     erstellt_von_art, erstellt_von_person_id, erstellt_von)
         values ($1,'einsatz',$2,'foto','oeffentlich',$3,'image/jpeg',10,$4,
                 'mensch',$5,$6)`,
        [f.reinigung, a.einsatz, `${f.reinigung}/${randomUUID()}`, 'c'.repeat(64),
          a.person, a.benutzer] as never[]),
      ).rejects.toThrow(/me_bucket/u);
    });

    it('ein zu grosses Video weist auch die Datenbank ab — die zweite Linie', async () => {
      const a = await baueEinsatz();
      await expect(sql.unsafe(
        `insert into einsatz_medien (mandant_id, bezug_tabelle, bezug_id, art, pfad,
                                     mime_typ, groesse_bytes, sha256,
                                     erstellt_von_art, erstellt_von_person_id, erstellt_von)
         values ($1,'einsatz',$2,'video',$3,'video/mp4',104857601,$4,
                 'mensch',$5,$6)`,
        [f.reinigung, a.einsatz, `${f.reinigung}/${randomUUID()}`, 'd'.repeat(64),
          a.person, a.benutzer] as never[]),
      ).rejects.toThrow(/me_groesse/u);
    });

    it('eine Aufnahme ohne Bereinigung kann gar nicht erst entstehen', async () => {
      const a = await baueEinsatz();
      await expect(sql.unsafe(
        `insert into einsatz_medien (mandant_id, bezug_tabelle, bezug_id, art, pfad,
                                     mime_typ, groesse_bytes, sha256, exif_entfernt,
                                     erstellt_von_art, erstellt_von_person_id, erstellt_von)
         values ($1,'einsatz',$2,'foto',$3,'image/jpeg',10,$4,false,
                 'mensch',$5,$6)`,
        [f.reinigung, a.einsatz, `${f.reinigung}/${randomUUID()}`, 'e'.repeat(64),
          a.person, a.benutzer] as never[]),
      ).rejects.toThrow(/me_exif/u);
    });
  });

describe('der Vorbereich ist von aussen unerreichbar (§5.13, §16 Nr. 7)', () => {
  it('cse_app sieht null Zeilen und hat kein Recht darauf', async () => {
    const e = ereignis('checkin', new Date());
    await reiche('unbekannt-' + zufall(), [e]);
    const leser = await konto(`leitung-${zufall()}@cse.test`);
    await mitglied(leser, f.reinigung, 'leitung');

    /**
     * Nicht „darf nicht lesen", sondern KANN NICHT: `zeit_intern` ist fuer
     * `cse_app` nicht einmal betretbar, und PostgREST liefert das Schema nicht
     * aus. Ein `permission denied` ist hier die richtige Antwort — es gibt
     * keine Policy, die auch nur null Zeilen zurueckgaebe.
     */
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: leser,
        portal: 'intern', readonly: false },
      async (tx) => tx.unsafe(`select count(*) from zeit_intern.offline_eingang`),
    )).rejects.toThrow(/permission denied|schema/u);
  });

  it('und die Rolle des Check-in-Pfades haelt auf beiden Tabellen KEIN Recht (K-01, K-08)',
    async () => {
      for (const tabelle of ['offline_ereignis', 'einsatz_medien']) {
        const rechte = await sql.unsafe<{ privilege_type: string }[]>(
          `select privilege_type from information_schema.table_privileges
            where grantee = 'cse_checkin' and table_name = $1`, [tabelle]);
        // `cse_checkin` darf GENAU zwei Funktionen ausfuehren und sonst nichts.
        expect(rechte, tabelle).toEqual([]);
      }
    });
});

describe('die K-06-Projektion: aus einem Zeiteintrag entsteht ein ist-Fenster', () => {
  it('und es entwertet sein plan-Fenster in derselben Anweisung (§6.2)', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');

    // Die Einteilung hat beim Anlegen ein `plan`-Fenster erzeugt.
    const [plan] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text n from zeit_intern.arbeitszeit_fenster
        where quelle = 'plan' and quelle_id = $1 and aktiv`, [a.zuordnung]);
    expect(plan!.n).toBe('1');

    const token = await marke(a.zuordnung, 'checkin', planer);
    const [ein] = await alsRolle('cse_checkin', async (tx) =>
      tx.unsafe<{ zeiteintrag_id: string }[]>(
        `select zeiteintrag_id from app.checkin_verbrauchen(
           encode(digest($1,'sha256'),'hex'), null::timestamptz, $2::inet, 'Testgeraet', null)`,
        [token, '203.0.113.7'] as never[]));

    /**
     * Ohne `z_fenster_projizieren` traegt die Fenstertabelle nur `plan`-Zeilen.
     * Der ArbZG-Detektor prueft dann die GEPLANTE Belastung und nie die
     * tatsaechliche — eine gesetzlich vorgeschriebene Pruefung, die immer still
     * besteht, ist schlimmer als keine (§15.1).
     */
    const [ist] = await sql.unsafe<{
      n: string; person_id: string; zuordnung_quelle_id: string;
    }[]>(
      `select count(*)::text n, min(person_id::text) as person_id,
              min(zuordnung_quelle_id::text) as zuordnung_quelle_id
         from zeit_intern.arbeitszeit_fenster
        where quelle = 'ist' and quelle_id = $1 and aktiv`, [ein!.zeiteintrag_id!]);
    expect(ist!.n).toBe('1');
    expect(ist!.person_id).toBe(a.person);
    // Die Supersede-Regel ist nur adressierbar, weil BEIDE Zeilen dieselbe
    // `zuordnung_quelle_id` tragen (K-06).
    expect(ist!.zuordnung_quelle_id).toBe(a.zuordnung);

    const [planDanach] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text n from zeit_intern.arbeitszeit_fenster
        where quelle = 'plan' and quelle_id = $1 and aktiv`, [a.zuordnung]);
    // Sonst summierte der Detektor Plan UND Ist und meldete zwoelf Stunden
    // fuer einen Sechs-Stunden-Tag.
    expect(planDanach!.n).toBe('0');
  });
});
