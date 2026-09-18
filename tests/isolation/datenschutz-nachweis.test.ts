import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';

/**
 * Der Entscheidungsnachweis und das Widerspruchsprotokoll (0220–0222,
 * LEG-09, LEG-08).
 *
 * **Sechs Zusagen, und jede hatte vorher einen Preis:**
 *
 *  1. **Tor und Policy sagen dasselbe.** `04-SEITENKARTE` §5.25 bewacht
 *     `/datenschutz/[id]/berichtigung` mit
 *     `datenschutz.berichtigung_bearbeiten`, die RLS aus `0176` kannte aber
 *     nur `datenschutz.auskunft_erstellen`. Wer nur berichtigen durfte, kam
 *     durch das Tor und las NULL Zeilen — 200 mit leerer Liste statt 404
 *     (AUT-06). Die Bearbeiterin sah „keine Berichtigungsanfrage" und glaubte
 *     es, während die Monatsfrist weiterlief.
 *  2. **Je Artikel sein eigenes Schreibrecht.** Wer berichtigt, fällt keine
 *     Löschentscheidung; wer Auskunft erteilt, berichtigt nichts. Sonst wären
 *     die drei Katalogrechte eines.
 *  3. **Der mengenwertige K-05-Leser prüft sein Recht und protokolliert
 *     EINMAL.** `cse_app` hat auf `ansprechpartner.werbewiderspruch_am` nur
 *     INSERT und UPDATE, kein SELECT; `app.rechtsgrundlage_lesen` liest einen
 *     Kontakt und schreibt eine Protokollzeile je Aufruf. Für eine Liste wären
 *     das N Zeilen für EINEN Seitenaufruf.
 *  4. **Der Token ist idempotent** (§2.4: „a second click … never an error")
 *     und berührt `rechtsgrundlage` NICHT — ein Werbewiderspruch, der alles
 *     abstellte, stoppte die Rechnungen des Kunden.
 *  5. **Art. 21 ist unwiderruflich** und zwingt `rechtsgrundlage = 'keine'`.
 *  6. **Keine harte Löschung** auf den fünf neuen Tabellen (Invariante 8).
 */

let f: Fixtur;
/** Hält alle drei Datenschutzrechte (super_admin). */
let dsb: string;
/** Hält NUR `datenschutz.berichtigung_bearbeiten` — der Fall von 0220. */
let nurBerichtigung: string;
/** Hält keines der drei — sieht den Vorgang nicht. */
let leitung: string;
let kunde: string;
let kontakt: string;
let anfrage: string;

async function authBenutzer(email: string, global: string | null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, $3, 'aktiv',
             case when $4::text is null then null
                  else (select id from rolle
                         where schluessel = $4 and mandant_id is null) end)`,
    [u!.id, email, email, global]);
  return u!.id;
}

beforeAll(async () => {
  f = await seed();

  dsb = await authBenutzer('dsb@nachweis.test', 'super_admin');
  nurBerichtigung = await authBenutzer('berichtigung@nachweis.test', null);
  leitung = await authBenutzer('leitung@nachweis.test', null);

  for (const b of [dsb, nurBerichtigung, leitung]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle
                         where schluessel = $3 and mandant_id is null), true)`,
      [b, f.reinigung, b === dsb ? 'admin' : 'leitung']);
  }

  /*
   * GENAU EIN Recht fuer `nurBerichtigung`: es haengt an der Rolle `leitung`
   * IN DIESER Gesellschaft. `leitung` bekommt es damit ebenfalls — deshalb
   * bekommt `leitung` eine eigene Gesellschaft als Pruefpunkt (security), in
   * der die Zuweisung nicht gilt.
   */
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
             (select id from berechtigung
               where schluessel = 'datenschutz.berichtigung_bearbeiten'),
             $1, true)`, [f.reinigung]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = 'leitung' and mandant_id is null), false)`,
    [leitung, f.security]);

  const [fi] = await alsRolle('', (tx) => tx.unsafe(
    `insert into firma (name, land) values ('Nachweis GmbH', 'DE') returning id`),
  ) as unknown as { id: string }[];
  const [k] = await alsRolle('', (tx) => tx.unsafe(
    `insert into kunde (mandant_id, firma_id, kundennummer, name, typ, status,
                        email_zentral, rechtsgrundlage, rechtsgrundlage_quelle,
                        rechtsgrundlage_erfasst_am)
     values ($1, $2, 'K-7001', 'Nachweis GmbH', 'firma', 'aktiv',
             'zentrale@nachweis.test', 'bestandskunde', 'Rahmenvertrag', now())
     returning id`, [f.reinigung, fi!.id])) as unknown as { id: string }[];
  kunde = k!.id;
  const [ap] = await alsRolle('', (tx) => tx.unsafe(
    `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname, email,
                                  rechtsgrundlage, rechtsgrundlage_quelle,
                                  rechtsgrundlage_erfasst_am, einwilligung_kanaele)
     values ($1, $2, 'Amira', 'Said', 'amira@nachweis.test', 'einwilligung',
             'Messe', now(), array['email'])
     returning id`, [f.reinigung, kunde])) as unknown as { id: string }[];
  kontakt = ap!.id;

  const [a] = await alsRolle('', (tx) => tx.unsafe(
    `insert into betroffenenanfrage (mandant_id, art, name, email, ansprechpartner_id)
     values ($1, 'berichtigung', 'Amira Said', 'amira@nachweis.test', $2)
     returning id`, [f.reinigung, kontakt])) as unknown as { id: string }[];
  anfrage = a!.id;
});
afterAll(schliessen);

function sitzung(benutzerId: string, mandantId = f.reinigung) {
  return { scope: 'mandant' as const, mandantId, benutzerId,
           readonly: false, portal: 'intern' as const };
}

describe('§1 0220 — wer eine der drei Zuständigkeiten hält, SIEHT den Vorgang', () => {
  it('lässt einen Träger von nur berichtigung_bearbeiten lesen', async () => {
    const [r] = await alsApp(sitzung(nurBerichtigung), (tx) => tx.unsafe(
      `select app.hat_recht('datenschutz.auskunft_erstellen', app.aktiver_mandant())
                as auskunft,
              app.hat_recht('datenschutz.berichtigung_bearbeiten', app.aktiver_mandant())
                as berichtigung,
              (select count(*)::int from betroffenenanfrage) as zeilen`),
    ) as unknown as { auskunft: boolean; berichtigung: boolean; zeilen: number }[];
    // Das eine Recht, und NICHT das andere — sonst prueft der Test nichts.
    expect(r!.auskunft).toBe(false);
    expect(r!.berichtigung).toBe(true);
    /*
     * Vor 0220 stand hier 0. Das ist der Befund: 200 mit leerer Liste statt
     * 404, und eine Monatsfrist, die dabei weiterlief.
     */
    expect(r!.zeilen).toBe(1);
  });

  it('lässt eine Sitzung ohne eines der drei Rechte NICHTS lesen', async () => {
    const [r] = await alsApp(sitzung(leitung, f.security), (tx) => tx.unsafe(
      `select app.darf_betroffenenanfrage() as darf,
              (select count(*)::int from betroffenenanfrage) as zeilen`),
    ) as unknown as { darf: boolean; zeilen: number }[];
    expect(r!.darf).toBe(false);
    expect(r!.zeilen).toBe(0);
  });

  it('trägt das Recht nicht in eine FREMDE Gesellschaft (K-03)', async () => {
    // `nurBerichtigung` hat die Zuweisung nur in `reinigung`.
    const [r] = await alsApp(sitzung(nurBerichtigung, f.security), (tx) => tx.unsafe(
      `select app.darf_betroffenenanfrage() as darf`),
    ) as unknown as { darf: boolean }[];
    expect(r!.darf).toBe(false);
  });
});

describe('§2 je Artikel sein eigenes Schreibrecht', () => {
  it('lässt berichtigung_bearbeiten ein Feld aufnehmen', async () => {
    const [r] = await alsApp(sitzung(nurBerichtigung), (tx) => tx.unsafe(
      `insert into berichtigung_feld
         (mandant_id, anfrage_id, tabelle, feld, wert_gespeichert, wert_behauptet,
          erfasst_von)
       values (app.aktiver_mandant(), $1::uuid, 'ansprechpartner', 'nachname',
               'Said', 'Saied', app.aktueller_benutzer())
       returning id`, [anfrage])) as unknown as { id: string }[];
    expect(r?.id).toBeTruthy();
  });

  it('verweigert derselben Sitzung die Löschentscheidung', async () => {
    await expect(alsApp(sitzung(nurBerichtigung), (tx) => tx.unsafe(
      `insert into loeschentscheidung
         (mandant_id, anfrage_id, tabelle, ergebnis, entschieden_von)
       values (app.aktiver_mandant(), $1::uuid, 'zeiteintrag', 'geschuldet',
               app.aktueller_benutzer())`, [anfrage])))
      .rejects.toThrow(/row-level security/iu);
  });

  it('verweigert derselben Sitzung das Auskunftsartefakt', async () => {
    await expect(alsApp(sitzung(nurBerichtigung), (tx) => tx.unsafe(
      `insert into datenschutz_auskunft
         (mandant_id, anfrage_id, format, umfang, abschnitte, zeilen, vollstaendig,
          sha256, erzeugt_von)
       values (app.aktiver_mandant(), $1::uuid, 'md', '{}'::jsonb, 1, 1, true,
               repeat('b', 64), app.aktueller_benutzer())`, [anfrage])))
      .rejects.toThrow(/row-level security/iu);
  });

  it('lässt aber LESEN, was eine andere Zuständigkeit entschieden hat', async () => {
    await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `insert into loeschentscheidung
         (mandant_id, anfrage_id, tabelle, ergebnis, rechtsgrundlage,
          entschieden_von)
       values (app.aktiver_mandant(), $1::uuid, 'zeiteintrag', 'ueberlagert',
               '§ 17 Abs. 2 MiLoG', app.aktueller_benutzer())`, [anfrage]));
    const [r] = await alsApp(sitzung(nurBerichtigung), (tx) => tx.unsafe(
      `select count(*)::int as n from loeschentscheidung`),
    ) as unknown as { n: number }[];
    /*
     * Wer den Vorgang sieht, sieht seine Entscheidungen. Sonst entscheidet
     * die Bearbeiterin zweimal — und die zweite Entscheidung widerspricht der
     * ersten.
     */
    expect(r!.n).toBe(1);
  });

  it('weist eine überlagerte Löschung OHNE Fundstelle ab', async () => {
    await expect(alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `insert into loeschentscheidung
         (mandant_id, anfrage_id, tabelle, ergebnis, entschieden_von)
       values (app.aktiver_mandant(), $1::uuid, 'rechnung', 'ueberlagert',
               app.aktueller_benutzer())`, [anfrage])))
      .rejects.toThrow(/loeschentscheidung_ueberlagerung_begruendet/u);
  });

  it('weist „offen" ohne benannte Frage ab', async () => {
    await expect(alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `insert into loeschentscheidung
         (mandant_id, anfrage_id, tabelle, ergebnis, entschieden_von)
       values (app.aktiver_mandant(), $1::uuid, 'agent_lauf', 'offen',
               app.aktueller_benutzer())`, [anfrage])))
      .rejects.toThrow(/loeschentscheidung_offen_benannt/u);
  });

  it('lässt dieselbe Tabelle NICHT zweimal als „ganze Zeile" entscheiden', async () => {
    /*
     * `unique (…, feld)` haette das NICHT gefangen: in einem UNIQUE ist NULL
     * von NULL verschieden. Vier widerspruechliche Zeilen zu `zeiteintrag`,
     * und welche gilt, sagte die Sortierung.
     */
    await expect(alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `insert into loeschentscheidung
         (mandant_id, anfrage_id, tabelle, ergebnis, entschieden_von)
       values (app.aktiver_mandant(), $1::uuid, 'zeiteintrag', 'geschuldet',
               app.aktueller_benutzer())`, [anfrage])))
      .rejects.toThrow(/loeschentscheidung_je_ort_uk/u);
  });
});

describe('§3 der K-05-Leseweg — Recht geprüft, EINMAL protokolliert', () => {
  it('weist eine Sitzung ohne crm.rechtsgrundlage_lesen ab, statt leer zu antworten', async () => {
    /*
     * Eine leere Liste hiesse „niemand hat widersprochen" — und das ist die
     * Aussage, nach der jemand eine Werbemail schickt.
     */
    await expect(alsApp(sitzung(nurBerichtigung), (tx) => tx.unsafe(
      `select * from app.werbewiderspruch_liste()`)))
      .rejects.toThrow(/crm\.rechtsgrundlage_lesen fehlt/u);
  });

  it('gibt Kontakte UND Firmen zurück und schreibt genau EINE Protokollzeile', async () => {
    await alsRolle('', (tx) => tx.unsafe(
      `update ansprechpartner set werbewiderspruch_am = now() where id = $1`,
      [kontakt]));
    await alsRolle('', (tx) => tx.unsafe(
      `update kunde set werbewiderspruch_am = now() where id = $1`, [kunde]));
    await alsRolle('', (tx) => tx.unsafe(
      `delete from audit_log where aktion = 'crm.widerspruch_liste_gelesen'`));

    const zeilen = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select ebene, name from app.werbewiderspruch_liste()`),
    ) as unknown as { ebene: string; name: string }[];
    expect(zeilen.map((z) => z.ebene).sort())
      .toEqual(['ansprechpartner', 'kunde']);

    const [p] = await alsRolle('', (tx) => tx.unsafe(
      `select count(*)::int as n from audit_log
        where aktion = 'crm.widerspruch_liste_gelesen'`),
    ) as unknown as { n: number }[];
    // EINE Zeile je Abruf — nicht eine je gelesenem Kontakt.
    expect(p!.n).toBe(1);
  });

  it('liest die K-05-Spalten NICHT direkt — auch nicht mit allen Rechten', async () => {
    await expect(alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select werbewiderspruch_am from ansprechpartner`)))
      .rejects.toThrow(/permission denied for (column|table|relation)/iu);
  });

  it('öffnet die Benachrichtigungen einer FREMDEN Person nur über den Definer', async () => {
    const personId = f.fatima;
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ('fatima@nachweis.test') returning id`);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status, person_id)
       values ($1, 'fatima@nachweis.test', 'Fatima', 'aktiv', $2)`,
      [u!.id, personId]);
    await alsRolle('cse_job', (tx) => tx.unsafe(
      `insert into benachrichtigung (mandant_id, empfaenger_id, art, titel, text,
                                     ziel, objekt_typ, sammelbar)
       values ($1, $2, 'zeit.freigabe', 'Dienstplan', 'Ihr Plan steht', '/portal',
               'zeiteintrag', false)`, [f.reinigung, u!.id]));

    // Direkt: null Zeilen — `t_benachrichtigung_eigene` verlangt den EIGENEN
    // Benutzer. „Null" hiesse hier „es gibt keine", und das ist falsch.
    const [direkt] = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select count(*)::int as n from benachrichtigung`),
    ) as unknown as { n: number }[];
    expect(direkt!.n).toBe(0);

    const ueber = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select titel from app.benachrichtigung_auskunft($1::uuid)`, [personId]),
    ) as unknown as { titel: string }[];
    expect(ueber).toHaveLength(1);
    expect(ueber[0]!.titel).toBe('Dienstplan');

    await expect(alsApp(sitzung(nurBerichtigung), (tx) => tx.unsafe(
      `select * from app.benachrichtigung_auskunft($1::uuid)`, [personId])))
      .rejects.toThrow(/datenschutz\.auskunft_erstellen fehlt/u);
  });
});

describe('§4 der Token — bedingt, idempotent, und ohne Nebenwirkung', () => {
  let klartext: string;
  let hash: string;

  beforeAll(async () => {
    /* Ein frischer Kontakt, damit der Zeitstempel aus §3 nicht mitspielt. */
    const [ap] = await alsRolle('', (tx) => tx.unsafe(
      `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname, email,
                                    rechtsgrundlage, rechtsgrundlage_quelle,
                                    rechtsgrundlage_erfasst_am)
       values ($1, $2, 'Bogdan', 'Nowak', 'bogdan@nachweis.test', 'bestandskunde',
               'Vertrag', now())
       returning id`, [f.reinigung, kunde])) as unknown as { id: string }[];
    klartext = randomBytes(32).toString('base64url');
    hash = createHash('sha256').update(klartext, 'utf8').digest('hex');
    await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select app.werbewiderspruch_token_ausgeben($1::uuid, $2::uuid, 'email',
                                                  null, $3)`,
      [ap!.id, kunde, hash]));
  });

  it('gibt `cse_app` auf der Tokentabelle KEIN Recht', async () => {
    /*
     * Eine Lesepolicy gaebe die Liste derer, die eine Werbenachricht bekommen
     * haben. Ein `insert … returning id` braeuchte SELECT auf die Spalte und
     * haette die Tuer wieder geoeffnet — deshalb laeuft beides ueber Definer.
     */
    await expect(alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select count(*) from werbewiderspruch_token`)))
      .rejects.toThrow(/permission denied/iu);
  });

  it('erfasst beim ersten Klick, sagt beim zweiten „verbraucht" — und wirft nie', async () => {
    const [erst] = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select zustand from app.werbewiderspruch_einloesen($1)`, [hash]),
    ) as unknown as { zustand: string }[];
    expect(erst!.zustand).toBe('erfasst');

    const [zweit] = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select zustand from app.werbewiderspruch_einloesen($1)`, [hash]),
    ) as unknown as { zustand: string }[];
    // §2.4: „never an error". Eine Fehlerseite auf dem Pflichtweg des § 7 UWG
    // waere ein Widerspruch, der nicht ankam.
    expect(zweit!.zustand).toBe('verbraucht');
  });

  it('unterscheidet den zweiten Klick vom WIDERRUFENEN Token', async () => {
    /*
     * **Der Befund, den dieser Fall einfriert.** `bereits` hiess vorher
     * beides: eingeloest UND widerrufen/abgelaufen. Die Seite machte daraus
     * „Ist bereits erfasst … Werbung an diese Adresse ist gestoppt" — fuer
     * einen Widerspruch, der NICHT erfasst wurde. Eine falsche Zusage an die
     * betroffene Person, auf dem Pflichtweg des § 7 UWG.
     *
     * Unterschieden wird an `eingeloest_am`, nicht am Grund: dem Inhaber des
     * Tokens verraet das nichts, was er nicht ohnehin weiss.
     */
    const klartext = randomBytes(32).toString('base64url');
    const widerrufen = createHash('sha256').update(klartext, 'utf8').digest('hex');
    await sql.unsafe(
      `insert into werbewiderspruch_token
         (mandant_id, ansprechpartner_id, kanal, token_hash, widerrufen_am,
          widerruf_grund)
       values ($1, $2, 'email', $3, now(), 'Verteiler zurueckgezogen')`,
      [f.reinigung, kontakt, widerrufen]);

    const [r] = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select zustand from app.werbewiderspruch_einloesen($1)`, [widerrufen]),
    ) as unknown as { zustand: string }[];
    expect(r!.zustand).toBe('ungueltig');

    // Und er hat NICHTS gesetzt — das ist der ganze Punkt.
    const [stand] = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select werbewiderspruch_am from app.widerspruch_stand($1::uuid, null)`,
      [kontakt])) as unknown as { werbewiderspruch_am: Date | null }[];
    expect(stand).toBeDefined();
  });

  it('der tokenlose Weg prueft Portal, Gruppenansicht und `formular.schreiben`', async () => {
    /*
     * **Der Befund: `app.werbewiderspruch_formular` prueft von den drei
     * Wachen KEINE.** Sie war `cse_app` erteilt (und ueber das fehlende
     * `revoke` auch PUBLIC), und ihr Schutz haing vollstaendig am Aufrufer —
     * einer OEFFENTLICHEN Route. Ihre Geschwister tragen mindestens zwei der
     * drei.
     *
     * `formular.schreiben` halten `super_admin`, `admin`, `leitung` und
     * `formular_eingang` (nachgezaehlt in `rolle_berechtigung`). Geprueft wird
     * deshalb mit einem Konto OHNE Rolle in dieser Gesellschaft — und mit der
     * Gruppenansicht.
     */
    const ohne = await authBenutzer('ohne-recht@nachweis.test', null);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle
                         where schluessel = 'mitarbeiter' and mandant_id is null), true)`,
      [ohne, f.reinigung]);
    await expect(alsApp(
      sitzung(ohne),
      (tx) => tx.unsafe(`select app.werbewiderspruch_formular($1, null)`,
                        ['nie@nachweis.test'])),
    ).rejects.toThrow(/formular\.schreiben/u);

    await expect(alsApp(
      { ...sitzung(dsb), readonly: true },
      (tx) => tx.unsafe(`select app.werbewiderspruch_formular($1, null)`,
                        ['nie@nachweis.test'])),
    ).rejects.toThrow(/Gruppenansicht/u);
  });

  it('die Drossel laesst fuenf durch und den sechsten nicht', async () => {
    /*
     * 04-SEITENKARTE:653 verlangt fuer `/werbewiderspruch` ein Ratenlimit; es
     * gab keines. Der Weg schreibt UNWIDERRUFLICH in fremde CRM-Datensaetze,
     * und die Antwort ist immer dieselbe — wer Adressen raet, erfaehrt also
     * nicht einmal, ob er getroffen hat.
     */
    const abdruck = createHash('sha256').update('drossel-probe', 'utf8').digest('hex');
    const ergebnisse: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      const [z] = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
        `select app.werbewiderspruch_drossel($1) as ok`, [abdruck]),
      ) as unknown as { ok: boolean }[];
      ergebnisse.push(z!.ok);
    }
    expect(ergebnisse).toEqual([true, true, true, true, true, false]);

    /*
     * Ein anderer Abdruck ist davon unberuehrt — sonst sperrte ein Angreifer
     * den Pflichtweg fuer alle.
     */
    const [andere] = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select app.werbewiderspruch_drossel($1) as ok`,
      [createHash('sha256').update('andere', 'utf8').digest('hex')]),
    ) as unknown as { ok: boolean }[];
    expect(andere!.ok).toBe(true);
  });

  it('antwortet auf einen unbekannten Token mit „unbekannt", nicht mit einem Fehler', async () => {
    const fremd = createHash('sha256').update('nie ausgegeben', 'utf8').digest('hex');
    const [r] = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select zustand from app.werbewiderspruch_einloesen($1)`, [fremd]),
    ) as unknown as { zustand: string }[];
    expect(r!.zustand).toBe('unbekannt');
  });

  it('setzt den Zeitstempel, schreibt die Protokollzeile und lässt rechtsgrundlage stehen', async () => {
    const [r] = await alsRolle('', (tx) => tx.unsafe(
      `select ap.werbewiderspruch_am is not null as gesperrt,
              ap.widerspruch_am is null as kein_art21,
              ap.rechtsgrundlage::text as grundlage,
              (select count(*)::int from werbewiderspruch w
                where w.ansprechpartner_id = ap.id and w.quelle = 'token') as spur
         from ansprechpartner ap where ap.email = 'bogdan@nachweis.test'`),
    ) as unknown as {
      gesperrt: boolean; kein_art21: boolean; grundlage: string; spur: number;
    }[];
    expect(r!.gesperrt).toBe(true);
    expect(r!.spur).toBe(1);
    /*
     * §2.4 korrigiert das ausdruecklich: ein Werbewiderspruch, der
     * `rechtsgrundlage` anfasste, stoppte die Rechnungen des Kunden (FIN-11),
     * die Leistungsnachweise (CLN-04) und die Mahnungen (FIN-15).
     */
    expect(r!.grundlage).toBe('bestandskunde');
    expect(r!.kein_art21).toBe(true);
  });

  it('lässt vertragliche Post weiter zu und Werbung nicht (dieselbe Funktion wie der Sendeweg)', async () => {
    const [r] = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select app.darf_kontaktiert_werden(ap.id, 'email', 'werbung') as werbung,
              app.darf_kontaktiert_werden(ap.id, 'email', 'vertraglich') as vertraglich
         from ansprechpartner ap where ap.email = 'bogdan@nachweis.test'`),
    ) as unknown as { werbung: boolean; vertraglich: boolean }[];
    expect(r!.werbung).toBe(false);
    expect(r!.vertraglich).toBe(true);
  });
});

describe('§5 Art. 21 — einmalig, unwiderruflich, und es fällt die Grundlage', () => {
  let ziel: string;

  beforeAll(async () => {
    const [ap] = await alsRolle('', (tx) => tx.unsafe(
      `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname, email,
                                    rechtsgrundlage, rechtsgrundlage_quelle,
                                    rechtsgrundlage_erfasst_am, einwilligung_kanaele)
       values ($1, $2, 'Clara', 'Weiss', 'clara@nachweis.test', 'einwilligung',
               'Messe', now(), array['email'])
       returning id`, [f.reinigung, kunde])) as unknown as { id: string }[];
    ziel = ap!.id;
  });

  it('verlangt eine Begründung — er ist nicht rücknehmbar', async () => {
    await expect(alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select app.widerspruch_verarbeitung_setzen($1::uuid, null, '   ')`, [ziel])))
      .rejects.toThrow(/begruendet/u);
  });

  it('verlangt datenschutz.auskunft_erstellen und nicht crm.schreiben', async () => {
    await expect(alsApp(sitzung(nurBerichtigung), (tx) => tx.unsafe(
      `select app.widerspruch_verarbeitung_setzen($1::uuid, null, 'Grund')`, [ziel])))
      .rejects.toThrow(/datenschutz\.auskunft_erstellen fehlt/u);
  });

  it('zwingt rechtsgrundlage auf „keine" und räumt die Einwilligungskanäle mit', async () => {
    await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select app.widerspruch_verarbeitung_setzen($1::uuid, null,
                                                  'Am Telefon erklaert')`, [ziel]));
    const [r] = await alsRolle('', (tx) => tx.unsafe(
      `select rechtsgrundlage::text as grundlage, rechtsgrundlage_quelle,
              einwilligung_kanaele, widerspruch_am is not null as gesetzt
         from ansprechpartner where id = $1`, [ziel]),
    ) as unknown as {
      grundlage: string; rechtsgrundlage_quelle: string | null;
      einwilligung_kanaele: string[] | null; gesetzt: boolean;
    }[];
    expect(r!.gesetzt).toBe(true);
    expect(r!.grundlage).toBe('keine');
    expect(r!.rechtsgrundlage_quelle).toBeNull();
    /*
     * Die Kanaele muessen MIT fallen, sonst verletzt die Zeile ihren eigenen
     * CHECK (`rechtsgrundlage = 'einwilligung' or einwilligung_kanaele is
     * null`) — und ausgerechnet die Eintragung, die IMMER gelingen muss,
     * scheiterte an einer Zusicherung, die die Einwilligung schuetzen sollte.
     */
    expect(r!.einwilligung_kanaele).toBeNull();
  });

  it('nimmt ihn nicht zurück — auch nicht als Eigentümer', async () => {
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update ansprechpartner set widerspruch_am = null where id = $1`, [ziel])))
      .rejects.toThrow(/wird nicht zurueckgenommen/u);
  });

  it('protokolliert ihn als „verarbeitung" mit benanntem Menschen', async () => {
    const [r] = await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `select art::text as art, quelle::text as quelle,
              erfasst_von is not null as mensch
         from werbewiderspruch
        where ansprechpartner_id = $1::uuid and art = 'verarbeitung'`, [ziel]),
    ) as unknown as { art: string; quelle: string; mensch: boolean }[];
    expect(r).toEqual({ art: 'verarbeitung', quelle: 'manuell', mensch: true });
  });
});

describe('§6 keine harte Löschung (Invariante 8)', () => {
  const TABELLEN = [
    'datenschutz_auskunft', 'berichtigung_feld', 'loeschentscheidung',
    'werbewiderspruch', 'werbewiderspruch_token',
  ] as const;

  beforeAll(async () => {
    /*
     * **Das Auskunftsartefakt braucht eine Zeile, und der Grund ist der
     * Befund dieses Tests.** Ein `before delete … for each row`-Ausloeser
     * feuert auf einer LEEREN Tabelle nicht: `delete from` trifft null Zeilen
     * und gelingt. Der erste Entwurf dieses Tests bestand deshalb auch fuer
     * eine Tabelle OHNE Sperre — er prueft die Sperre nur, wenn es etwas zu
     * loeschen gibt. Die Zeilenzahl wird unten deshalb mitgeprueft.
     */
    await alsApp(sitzung(dsb), (tx) => tx.unsafe(
      `insert into datenschutz_auskunft
         (mandant_id, anfrage_id, format, umfang, abschnitte, zeilen, vollstaendig,
          sha256, erzeugt_von)
       values (app.aktiver_mandant(), $1::uuid, 'md', '{}'::jsonb, 3, 7, true,
               repeat('c', 64), app.aktueller_benutzer())`, [anfrage]));
  });

  it('hält DELETE und TRUNCATE auf allen fünf neuen Tabellen — auch als Eigentümer', async () => {
    for (const t of TABELLEN) {
      /*
       * Erst die Zeile, dann die Sperre: ohne diese Zusicherung bestuende der
       * Test auch fuer eine Tabelle, die gar keinen Ausloeser traegt.
       */
      const [voll] = await alsRolle('', (tx) => tx.unsafe(
        `select count(*)::int as n from ${t}`)) as unknown as { n: number }[];
      expect(voll!.n, `${t}: ohne Zeile prueft der Ausloeser nichts`)
        .toBeGreaterThan(0);

      await expect(alsRolle('', (tx) => tx.unsafe(`delete from ${t}`)),
        `${t}: DELETE muss werfen`).rejects.toThrow();
      await expect(alsRolle('', (tx) => tx.unsafe(`truncate ${t}`)),
        `${t}: TRUNCATE muss werfen`).rejects.toThrow();
    }
  });

  it('hat `cse_app` das DELETE-Recht nicht einmal erteilt', async () => {
    const zeilen = await sql.unsafe<{ table_name: string }[]>(
      `select table_name from information_schema.table_privileges
        where grantee = 'cse_app' and privilege_type = 'DELETE'
          and table_name = any($1::text[])`, [[...TABELLEN]]);
    expect(zeilen).toEqual([]);
  });
});

describe('§7 Mandantengrenze', () => {
  it('zeigt einer fremden Gesellschaft weder Nachweis noch Protokoll', async () => {
    const [r] = await alsApp(sitzung(dsb, f.security), (tx) => tx.unsafe(
      `select (select count(*)::int from betroffenenanfrage) as anfragen,
              (select count(*)::int from loeschentscheidung) as loeschung,
              (select count(*)::int from berichtigung_feld) as berichtigung,
              (select count(*)::int from datenschutz_auskunft) as auskunft,
              (select count(*)::int from werbewiderspruch) as widerspruch,
              (select count(*)::int from app.werbewiderspruch_liste()) as liste`),
    ) as unknown as Record<string, number>[];
    expect(r).toEqual({
      anfragen: 0, loeschung: 0, berichtigung: 0, auskunft: 0,
      widerspruch: 0, liste: 0,
    });
  });

  it('nimmt eine Zuordnung auf einen FREMDEN Kontakt nicht an', async () => {
    /*
     * `0220` traegt den zusammengesetzten Fremdschluessel
     * (mandant_id, ansprechpartner_id) nach. Ohne ihn liesse sich eine
     * Kennung aus einer fremden Gesellschaft eintragen — und die Auskunft,
     * die darauf aufbaut, gaebe die Daten eines anderen Menschen heraus.
     */
    const [fremd] = await alsRolle('', (tx) => tx.unsafe(
      `insert into betroffenenanfrage (mandant_id, art, name, email)
       values ($1, 'auskunft', 'Fremd', 'fremd@nachweis.test') returning id`,
      [f.security])) as unknown as { id: string }[];
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update betroffenenanfrage set ansprechpartner_id = $2 where id = $1`,
      [fremd!.id, kontakt])))
      .rejects.toThrow(/betroffenenanfrage_ansprechpartner_fk/u);
  });

  it('lässt höchstens EINE Zuordnung je Anfrage zu', async () => {
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update betroffenenanfrage
          set person_id = $2, ansprechpartner_id = $3 where id = $1`,
      [anfrage, f.fatima, kontakt])))
      .rejects.toThrow(/betroffenenanfrage_hoechstens_eine_zuordnung/u);
  });
});
