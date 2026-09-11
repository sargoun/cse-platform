/**
 * PR 41, Abnahme 3 und 4 — an echtem Postgres.
 *
 *  (3) Ein Wachbucheintrag ist nur ANFUEGBAR: UPDATE und DELETE scheitern auf
 *      DATENBANKEBENE, nicht im Dienst. Eine Korrektur ist ein neuer,
 *      verknuepfter Eintrag — beide bleiben lesbar.
 *  (4) Eine manipulierte Geraeteuhr aendert keine aufgezeichnete Zeit: die
 *      Serverzeit gewinnt, die Behauptung des Geraets steht daneben.
 *
 * Dazu die zwei Eigenschaften, ohne die (3) nichts wert waere: die laufende
 * Nummer je (Mandant, Objekt, Jahr) und die Hashkette, die sich nicht gabeln
 * laesst.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  korrigiereEintrag, leseEintrag, pruefeKette, schreibeEintrag,
  KeinUrheber, SchonStorniert, WachbuchEingabeFehlt,
} from '../../src/server/services/security/wachbuch.js';

let f: Fixtur;
let wache = '';
let objektId = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/**
 * Ein Konto MIT Person — und das ist hier tragend: der Urheber eines
 * Wachbucheintrags wird aus der Sitzung aufgeloest, nie aus der Anfrage.
 */
async function konto(personId: string | null): Promise<string> {
  const email = `wachbuch-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId]);
  return u!.id;
}

async function objekt(mandant: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Wachkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Werkstor','Teststr. 1','10115','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  return o!.id;
}

/** Als die Wache selbst — `app.person_id` gesetzt, Rolle `mitarbeiter`. */
function alsWache<T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId: f.security, benutzerId: wache,
      personId: f.fatima, portal: 'intern', readonly: false,
    },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: wache,
        aktiverMandantId: f.security, mandantIds: [f.security],
        abfrage, schreibe: abfrage,
      });
    },
  );
}

beforeEach(async () => {
  f = await seed();
  wache = await konto(f.fatima);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [wache, f.security, await rolleId('leitung')]);
  objektId = await objekt(f.security);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(3) nur anfuegbar — UPDATE und DELETE scheitern an der DATENBANK', () => {
  it('ein Eintrag entsteht mit Nummer, Kette und Urheber aus der Sitzung', async () => {
    const id = await alsWache((k) => schreibeEintrag(k, {
      objektId, art: 'rundgang', betreff: 'Rundgang 02:00',
      eintragstext: 'Alles ruhig, Nebeneingang verschlossen.',
    }));

    const [zeile] = await sql.unsafe<{
      jahr: number; laufnummer: string; anstellung_id: string; person_id: string;
      hash: string; vorheriger_hash: string | null;
    }[]>(
      `select jahr, laufnummer, anstellung_id, person_id, hash, vorheriger_hash
         from wachbuch_eintrag where id = $1`, [id]);

    expect(Number(zeile!.laufnummer)).toBe(1);
    // Der Urheber kommt aus der SITZUNG — kein Formularfeld traegt ihn.
    expect(zeile!.anstellung_id).toBe(f.fatimaSecurity);
    expect(zeile!.person_id).toBe(f.fatima);
    expect(zeile!.hash).toMatch(/^[0-9a-f]{64}$/u);
    // Der erste Eintrag einer Kette hat keinen Vorgaenger — und nur er.
    expect(zeile!.vorheriger_hash).toBeNull();
  });

  it('ein UPDATE am Text scheitert — auch als Eigentuemer der Tabelle', async () => {
    const id = await alsWache((k) => schreibeEintrag(k, {
      objektId, art: 'vorkommnis', betreff: 'Tür offen',
      eintragstext: 'Nebentür offen vorgefunden.',
    }));

    /**
     * `sql` ist die Verbindung OHNE `set role cse_app`, also der Eigentuemer.
     * Genau das ist der Punkt: eine Regel, die nur fuer die Anwendungsrolle
     * gilt, ist keine Regel — sie gilt fuer den Weg, den ein Skript nimmt.
     */
    await expect(sql.unsafe(
      `update wachbuch_eintrag set eintragstext = 'umgeschrieben' where id = $1`, [id],
    )).rejects.toThrow(/wird nicht geaendert/u);

    await expect(sql.unsafe(
      `update wachbuch_eintrag set betreff = 'anders' where id = $1`, [id],
    )).rejects.toThrow(/wird nicht geaendert/u);

    // Auch die Zeit selbst: der Beweiswert haengt an ihr.
    await expect(sql.unsafe(
      `update wachbuch_eintrag set erfasst_am = now() - interval '3 hours' where id = $1`, [id],
    )).rejects.toThrow(/wird nicht geaendert/u);
  });

  it('ein DELETE scheitert ebenfalls, und ein TRUNCATE auch', async () => {
    await alsWache((k) => schreibeEintrag(k, {
      objektId, art: 'alarm', betreff: 'Alarmauslösung',
      eintragstext: 'Bewegungsmelder Halle 2.',
    }));

    await expect(sql.unsafe(`delete from wachbuch_eintrag`))
      .rejects.toThrow(/Hard delete/u);
    await expect(sql.unsafe(`truncate wachbuch_eintrag`))
      .rejects.toThrow(/Hard delete/u);
  });

  it('die Korrektur ist ein NEUER, verknuepfter Eintrag — beide bleiben lesbar',
    async () => {
      const alt = await alsWache((k) => schreibeEintrag(k, {
        objektId, art: 'vorkommnis', betreff: 'Tür offen',
        eintragstext: 'Nebentür offen vorgefunden.',
      }));

      const neu = await alsWache((k) => korrigiereEintrag(k, {
        eintragId: alt, grund: 'Falsche Tür genannt',
        betreff: 'Tor offen', eintragstext: 'Lieferantentor offen vorgefunden.',
      }));

      const beide = await alsWache(async (k) => ({
        alt: await leseEintrag(k, alt),
        neu: await leseEintrag(k, neu),
      }));

      // Der falsche Eintrag STEHT noch — mit Grund und Verweis.
      expect(beide.alt).not.toBeNull();
      expect(beide.alt!.eintragstext).toBe('Nebentür offen vorgefunden.');
      expect(beide.alt!.storniert).toBe(true);
      expect(beide.alt!.stornoGrund).toBe('Falsche Tür genannt');
      expect(beide.alt!.ersetztDurchId).toBe(neu);

      // Und die Richtigstellung traegt ihre eigene Nummer und den Rueckverweis.
      expect(beide.neu!.storniert).toBe(false);
      expect(beide.neu!.laufnummer).toBe(beide.alt!.laufnummer + 1);
      expect(beide.neu!.ersetztId).toBe(alt);
      // Der Bezug wird GEERBT, nicht neu behauptet.
      expect(beide.neu!.objektId).toBe(beide.alt!.objektId);
      expect(beide.neu!.art).toBe(beide.alt!.art);
    });

  it('ein bereits stornierter Eintrag wird nicht zweimal korrigiert', async () => {
    const alt = await alsWache((k) => schreibeEintrag(k, {
      objektId, art: 'uebergabe', betreff: 'Übergabe 06:00',
      eintragstext: 'Schlüssel und Funk übergeben.',
    }));
    await alsWache((k) => korrigiereEintrag(k, {
      eintragId: alt, grund: 'Uhrzeit falsch',
      betreff: 'Übergabe 05:45', eintragstext: 'Schlüssel und Funk übergeben.',
    }));

    const fehler = await alsWache((k) => korrigiereEintrag(k, {
      eintragId: alt, grund: 'Noch einmal falsch',
      betreff: 'Übergabe 05:30', eintragstext: 'Nochmals.',
    }).then(() => null, (x: unknown) => x));
    expect(fehler).toBeInstanceOf(SchonStorniert);
  });

  it('ein Storno laesst sich nicht zuruecknehmen', async () => {
    const id = await alsWache((k) => schreibeEintrag(k, {
      objektId, art: 'rundgang', betreff: 'Rundgang 04:00',
      eintragstext: 'Ohne Befund.',
    }));
    await sql.unsafe(
      `update wachbuch_eintrag set storniert_am = now(), storno_grund = 'Irrtum'
        where id = $1`, [id]);

    await expect(sql.unsafe(
      `update wachbuch_eintrag set storniert_am = null, storno_grund = null where id = $1`,
      [id],
    )).rejects.toThrow(/nicht zurueckgenommen/u);
  });

  it('die Kette laeuft ueber die Eintraege und laesst sich nicht gabeln', async () => {
    const erste = await alsWache((k) => schreibeEintrag(k, {
      objektId, art: 'rundgang', betreff: 'Rundgang 1', eintragstext: 'Ohne Befund.',
    }));
    await alsWache((k) => schreibeEintrag(k, {
      objektId, art: 'rundgang', betreff: 'Rundgang 2', eintragstext: 'Ohne Befund.',
    }));

    const befund = await alsWache((k) => pruefeKette(k, objektId));
    expect(befund.geprueft).toBe(2);
    expect(befund.intakt).toBe(true);
    expect(befund.brueche).toEqual([]);

    const [anker] = await sql.unsafe<{ vorheriger_hash: string | null }[]>(
      `select vorheriger_hash from wachbuch_eintrag where id = $1`, [erste]);
    // Der Anker der Kette, und nur er, hat keinen Vorgaenger.
    expect(anker!.vorheriger_hash).toBeNull();

    /**
     * **Das Kettenglied gehoert dem Ausloeser.** Eine Zeile, die von Hand
     * behauptet, sie sei der Anker (`vorheriger_hash = null`), bekommt
     * trotzdem den tatsaechlichen Kopf eingesetzt — eine Gabelung laesst sich
     * also nicht einmal EINTRAGEN, nicht erst abweisen.
     */
    await sql.unsafe(
      `insert into wachbuch_eintrag
         (mandant_id, objekt_id, anstellung_id, person_id, art,
          betreff, eintragstext, vorheriger_hash, hash, erstellt_von_art)
       values ($1,$2,$3,$4,'rundgang','Eingeschoben','Seite dazwischen',
               null, repeat('a', 64), 'system')`,
      [f.security, objektId, f.fatimaSecurity, f.fatima]);

    const [eingeschoben] = await sql.unsafe<{
      vorheriger_hash: string | null; hash: string; laufnummer: string;
    }[]>(
      `select vorheriger_hash, hash, laufnummer from wachbuch_eintrag
        where betreff = 'Eingeschoben'`);
    expect(eingeschoben!.vorheriger_hash).not.toBeNull();
    expect(eingeschoben!.hash).not.toBe('a'.repeat(64));
    expect(Number(eingeschoben!.laufnummer)).toBe(3);

    const danach = await alsWache((k) => pruefeKette(k, objektId));
    expect(danach.intakt).toBe(true);
  });

  it('und wenn der Ausloeser umgangen wird, faengt der eindeutige Index die Gabelung',
    async () => {
      /**
       * Die ZWEITE Linie. `session_replication_role = replica` schaltet
       * Ausloeser ab — das kann nur ein Superuser, aber genau dieser Weg ist
       * der, ueber den eine Wiederherstellung oder ein Wartungsskript laeuft.
       * Dann haelt nur noch `wachbuch_kette_uk`, und es muss halten: ohne ihn
       * koennten zwei Zeilen denselben Vorgaenger nennen, und genau so
       * versteckt sich eine eingeschobene Seite (§6.12 Nr. 3).
       */
      await alsWache((k) => schreibeEintrag(k, {
        objektId, art: 'rundgang', betreff: 'Rundgang 1', eintragstext: 'Ohne Befund.',
      }));
      const [kopf] = await sql.unsafe<{ hash: string }[]>(
        `select hash from wachbuch_eintrag order by laufnummer desc limit 1`);

      const gabeln = async (): Promise<void> => {
        await sql.begin(async (tx) => {
          await tx.unsafe(`set local session_replication_role = replica`);
          for (const nr of [2, 3]) {
            await tx.unsafe(
              `insert into wachbuch_eintrag
                 (mandant_id, objekt_id, anstellung_id, person_id, jahr, laufnummer, art,
                  betreff, eintragstext, vorheriger_hash, hash, erstellt_von_art)
               values ($1,$2,$3,$4,2029,$5,'rundgang','Gabelung','Zweig',
                       $6, repeat($7, 64), 'system')`,
              [f.security, objektId, f.fatimaSecurity, f.fatima, nr,
               kopf!.hash, String(nr)] as never[]);
          }
        });
      };
      await expect(gabeln()).rejects.toThrow(/wachbuch_kette_uk/u);
    });
});

// ---------------------------------------------------------------------------

describe('(4) eine manipulierte Geraeteuhr aendert keine aufgezeichnete Zeit', () => {
  it('die Geraetezeit liegt zwei Stunden vorn — aufgezeichnet wird die Serverzeit',
    async () => {
      const id = await alsWache((k) => schreibeEintrag(k, {
        objektId, art: 'rundgang', betreff: 'Rundgang 03:00',
        eintragstext: 'Ohne Befund.',
        // Die Behauptung des Geraets: zwei Stunden voraus.
        geraeteZeit: new Date(Date.now() + 2 * 3_600_000).toISOString(),
      }));

      const [zeile] = await sql.unsafe<{
        frisch: boolean; abweichung: number; geraete_zeit: Date;
      }[]>(
        `select (erfasst_am between now() - interval '2 minutes' and now()) as frisch,
                zeitabweichung_sek as abweichung, geraete_zeit
           from wachbuch_eintrag where id = $1`, [id]);

      // Serverzeit, nicht Geraetezeit.
      expect(zeile!.frisch).toBe(true);
      // Die Abweichung ist Geraet MINUS Server, vorzeichenbehaftet.
      expect(Number(zeile!.abweichung)).toBeGreaterThan(7_100);
      expect(Number(zeile!.abweichung)).toBeLessThan(7_300);
      // Die Behauptung selbst bleibt erhalten — sie ist die Tatsache, nicht die Zeit.
      expect(zeile!.geraete_zeit).not.toBeNull();
    });

  it('ein mitgeschickter `erfasst_am` wird verworfen — auch am Dienst vorbei', async () => {
    /**
     * Der Weg, den ein Skript nimmt: `erfasst_am` direkt mitschicken. Der
     * Vorgabewert `now()` griffe hier NICHT (er gilt nur bei weggelassener
     * Spalte) — der Ausloeser ueberschreibt.
     */
    await sql.unsafe(
      `insert into wachbuch_eintrag
         (mandant_id, objekt_id, anstellung_id, person_id, art, betreff, eintragstext,
          erfasst_am, erstellt_von_art)
       values ($1,$2,$3,$4,'vorkommnis','Nachträglich','Von Hand eingetragen.',
               '2001-01-01 00:00:00+00','system')`,
      [f.security, objektId, f.fatimaSecurity, f.fatima]);

    const [zeile] = await sql.unsafe<{ jahr: number; frisch: boolean }[]>(
      `select jahr, (erfasst_am between now() - interval '2 minutes' and now()) as frisch
         from wachbuch_eintrag order by laufnummer desc limit 1`);
    expect(zeile!.frisch).toBe(true);
    // Und das Jahr der laufenden Nummer folgt der SERVERZEIT, nicht der
    // Behauptung — sonst stuende die Seite im Buch von 2001.
    expect(Number(zeile!.jahr)).toBeGreaterThan(2024);
  });

  it('ohne Geraetezeit gibt es keine Abweichung — auch keine mitgeschickte', async () => {
    await sql.unsafe(
      `insert into wachbuch_eintrag
         (mandant_id, objekt_id, anstellung_id, person_id, art, betreff, eintragstext,
          zeitabweichung_sek, erstellt_von_art)
       values ($1,$2,$3,$4,'rundgang','Ohne Geraet','Papiererfassung.',
               -9999,'system')`,
      [f.security, objektId, f.fatimaSecurity, f.fatima]);

    const [zeile] = await sql.unsafe<{ abweichung: number | null }[]>(
      `select zeitabweichung_sek as abweichung
         from wachbuch_eintrag order by laufnummer desc limit 1`);
    // Eine Abweichung ohne Messung waere eine Behauptung ueber nichts.
    expect(zeile!.abweichung).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('der Urheber kommt aus der Sitzung, nicht aus der Anfrage', () => {
  it('ein Konto ohne Beschaeftigung in dieser Gesellschaft schreibt nicht', async () => {
    const fremd = await konto(f.jonas);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [fremd, f.security, await rolleId('leitung')]);

    const fehler = await alsApp(
      {
        scope: 'mandant', mandantId: f.security, benutzerId: fremd,
        personId: f.jonas, portal: 'intern', readonly: false,
      },
      async (tx) => {
        const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
          (await tx.unsafe(s, w as never[])) as readonly R[];
        return schreibeEintrag({
          scope: 'mandant', portal: 'intern', benutzerId: fremd,
          aktiverMandantId: f.security, mandantIds: [f.security],
          abfrage, schreibe: abfrage,
        }, {
          objektId, art: 'rundgang', betreff: 'Fremd', eintragstext: 'Text.',
        }).then(() => null, (x: unknown) => x);
      },
    );
    // Jonas ist in der Reinigung beschaeftigt, nicht in der Security — die
    // Pflicht, dieses Buch zu fuehren, ist die DIESER Gesellschaft (§10.5).
    expect(fehler).toBeInstanceOf(KeinUrheber);
  });

  it('die WACHE selbst schreibt — mit `wachbuch.schreiben` und OHNE `wachbuch.lesen`',
    async () => {
      /**
       * **Der Weg, fuer den SEC-05 gebaut ist.** Die Rolle `mitarbeiter` haelt
       * `wachbuch.schreiben` und NICHT `wachbuch.lesen` (03-AUTH §12.7); ihre
       * eigenen Seiten liest sie im eigenen Portal ueber `t_person`, ganz ohne
       * Modulrecht (K-18).
       *
       * Dieser Test ist der Grund, aus dem der Dienst die `id` selbst erzeugt:
       * `insert … returning id` zoege die SELECT-Policy mit herein, und genau
       * hier schluege sie fehl — bei der Wache, die das Buch fuehrt.
       */
      /**
       * Ein EIGENER Mensch, nicht Fatima: `benutzer.person_id` ist eindeutig
       * (ein Zugang je Mensch, EMP-14), und die Fixtur hat Fatima bereits ein
       * Konto gegeben. Ein zweites waere kein Testaufbau, sondern ein Verstoss
       * gegen genau die Regel, die das Portal traegt.
       */
      const [mensch] = await sql.unsafe<{ id: string }[]>(
        `insert into person (vorname, nachname) values ('Nadia','Kowalski') returning id`);
      const [beschaeftigung] = await sql.unsafe<{ id: string }[]>(
        `insert into anstellung (mandant_id, person_id, personalnummer, eintritt,
                                 stundensatz_intern)
         values ($1,$2,$3,'2024-01-01',1780) returning id`,
        [f.security, mensch!.id, `S-${zufall()}`]);
      const guard = await konto(mensch!.id);
      await sql.unsafe(
        `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
        [guard, f.security, await rolleId('mitarbeiter')]);

      const id = await alsApp(
        {
          scope: 'mandant', mandantId: f.security, benutzerId: guard,
          personId: mensch!.id, portal: 'mitarbeiter', readonly: false,
        },
        async (tx) => {
          const abfrage = async <R,>(x: string, w: readonly unknown[] = []) =>
            (await tx.unsafe(x, w as never[])) as readonly R[];
          return schreibeEintrag({
            scope: 'mandant', portal: 'mitarbeiter', benutzerId: guard,
            aktiverMandantId: f.security, mandantIds: [f.security],
            abfrage, schreibe: abfrage,
          }, {
            objektId, art: 'rundgang', betreff: 'Rundgang 01:00',
            eintragstext: 'Türen kontrolliert, ohne Befund.',
          });
        },
      );

      const [zeile] = await sql.unsafe<{ anstellung_id: string; laufnummer: string }[]>(
        `select anstellung_id, laufnummer from wachbuch_eintrag where id = $1`, [id]);
      expect(zeile!.anstellung_id).toBe(beschaeftigung!.id);
      expect(Number(zeile!.laufnummer)).toBe(1);
    });

  it('die Art `schluessel` wird benannt abgewiesen, solange es keine Schluessel gibt',
    async () => {
      const fehler = await alsWache((k) => schreibeEintrag(k, {
        objektId, art: 'schluessel', betreff: 'Schlüssel 12',
        eintragstext: 'Ausgegeben.',
      }).then(() => null, (x: unknown) => x));
      expect(fehler).toBeInstanceOf(WachbuchEingabeFehlt);
      expect((fehler as Error).message).toContain('SEC-07');
    });
});
