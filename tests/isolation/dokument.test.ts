/**
 * PR 9 Akzeptanz (4) und (5) — was die Datenbank sagt.
 *
 * (4) ist die Mandantentrennung auf Dokumenten, (5) die Loeschsperre auf
 * beiden Ebenen. Beides sind Aussagen ueber Policies und Trigger.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { erzeugeSignatur, pruefeSignatur, SignaturFehler } from '../../src/server/storage/signatur.js';

let f: Fixtur;

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel],
  );
  return r!.id;
}

async function konto(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email],
  );
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email],
  );
  return u!.id;
}

async function mitglied(b: string, m: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [b, m, await rolleId(rolle)],
  );
}

async function dokument(
  mandant: string, kategorie: string,
  opts: { sichtbarKunde?: boolean; sichtbarMitarbeiter?: boolean } = {},
): Promise<string> {
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument
       (mandant_id, kategorie, titel, objekt_schluessel, mime_typ, mime_verifiziert,
        groesse_bytes, exif_entfernt, sichtbar_fuer_kunde, sichtbar_fuer_mitarbeiter)
     values ($1,$2::dokument_kategorie,'Test',$3,'application/pdf',true,1024,true,$4,$5)
     returning id`,
    [mandant, kategorie, `${mandant}/${kategorie}/x`,
     opts.sichtbarKunde ?? false, opts.sichtbarMitarbeiter ?? false],
  );
  return d!.id;
}

/** Liest Dokumente als dieser Benutzer in diesem Bereich. */
async function sichtbar(benutzer: string, mandant: string, portal = 'intern'): Promise<number> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, benutzerId: benutzer, portal: portal as never, readonly: false },
    async (tx) => {
      const [z] = await tx.unsafe<{ n: string }[]>(`select count(*) n from dokument`);
      return Number(z!.n);
    },
  );
}

beforeEach(async () => {
  // Kein eigenes `truncate`: `seed()` leert `mandant` mit `cascade`, und das
  // erreicht `dokument` ueber den Fremdschluessel. Ein Truncate hier liefe
  // ausserhalb des Trigger-Escapes und liefe in die Loeschsperre.
  f = await seed();
});
afterAll(schliessen);

describe('(4) ein bau-Benutzer bekommt nichts von einem reinigung-Dokument', () => {
  it('die Zeile ist unsichtbar — nicht "verboten", sondern nicht da', async () => {
    const b = await konto('bau-nutzer@cse.test');
    await mitglied(b, f.bau, 'leitung');
    await dokument(f.reinigung, 'rechnung');
    await dokument(f.bau, 'projekt');

    // Im eigenen Bereich eines, im fremden keines — und "keines" ist von
    // "gibt es nicht" nicht zu unterscheiden (AUT-06).
    expect(await sichtbar(b, f.bau)).toBe(1);
    expect(await sichtbar(b, f.reinigung)).toBe(0);
  });

  it('auch eine noch gueltige signierte URL aus dem fremden Bereich hilft nicht', async () => {
    const GEHEIM = 'test';
    const JETZT = 1_800_000_000;
    const s = erzeugeSignatur(
      { dokumentId: 'd1', mandantId: f.reinigung, objektSchluessel: 'x',
        zweck: 'anzeigen', benutzerId: 'b1' },
      GEHEIM, JETZT,
    );
    // Echt und frisch — und trotzdem wertlos, weil die Sitzung in `bau` laeuft.
    expect(() => pruefeSignatur(s, GEHEIM, JETZT + 60, f.bau)).toThrow(SignaturFehler);
    // Im richtigen Bereich dagegen traegt sie.
    expect(pruefeSignatur(s, GEHEIM, JETZT + 60, f.reinigung).zweck).toBe('anzeigen');
  });

  it('das Mitarbeiterportal sieht nur ausdruecklich Freigegebenes (K-04)', async () => {
    const ma = await konto('ma-dok@cse.test');
    await mitglied(ma, f.reinigung, 'mitarbeiter');
    await dokument(f.reinigung, 'rechnung');                                  // nicht freigegeben
    await dokument(f.reinigung, 'mitarbeiter', { sichtbarMitarbeiter: true }); // freigegeben

    // Die Decke ist RESTRICTIVE: sie schneidet weg, sie gewaehrt nie.
    expect(await sichtbar(ma, f.reinigung, 'mitarbeiter')).toBe(1);
  });

  it('kein Bucket ist oeffentlich — das Schema kennt den Zustand nicht', async () => {
    await expect(
      sql.unsafe(
        `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel, bucket,
                               mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt)
         values ($1,'rechnung','X','k','public','application/pdf',true,1,true)`,
        [f.reinigung],
      ),
    ).rejects.toThrow(/bucket/iu);
  });

  it('ein unverifizierter MIME-Typ ist gar nicht speicherbar', async () => {
    // Der CHECK ohne DEFAULT: eine vergessene Spalte wird ein Fehler, kein
    // stilles `false`.
    await expect(
      sql.unsafe(
        `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel,
                               mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt)
         values ($1,'rechnung','X','k','application/pdf',false,1,true)`,
        [f.reinigung],
      ),
    ).rejects.toThrow(/mime_verifiziert/u);
  });

  it('ein Bild ohne EXIF-Bereinigung ebenso wenig (TIM-10)', async () => {
    await expect(
      sql.unsafe(
        `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel,
                               mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt)
         values ($1,'projekt','Foto','k','image/jpeg',true,1,false)`,
        [f.reinigung],
      ),
    ).rejects.toThrow(/dokument_exif_entfernt/u);
  });
});

describe('(5) eine nicht loeschbare Kategorie verweigert auf BEIDEN Ebenen', () => {
  it('die Aufbewahrung wird beim Einfuegen aufgeloest, nicht getippt', async () => {
    const d = await dokument(f.reinigung, 'rechnung');
    const [z] = await sql.unsafe<{ loeschsperre: boolean; aufbewahrung_bis: Date | null }[]>(
      `select loeschsperre, aufbewahrung_bis from dokument where id = $1`, [d],
    );
    expect(z!.loeschsperre).toBe(true);
    expect(z!.aufbewahrung_bis).not.toBeNull();
  });

  it('eine offene Frist wird als Pflicht behandelt, nicht als ihre Abwesenheit (O-25)', async () => {
    const d = await dokument(f.reinigung, 'mitarbeiter');
    const [z] = await sql.unsafe<{ loeschsperre: boolean; aufbewahrung_bis: Date | null }[]>(
      `select loeschsperre, aufbewahrung_bis from dokument where id = $1`, [d],
    );
    expect(z!.aufbewahrung_bis).toBeNull();
    expect(z!.loeschsperre).toBe(true);
  });

  it('Ebene 1 — das Soft-Loeschen wird vom Trigger abgewiesen', async () => {
    const d = await dokument(f.reinigung, 'rechnung');
    await expect(
      sql.unsafe(`update dokument set geloescht_am = now() where id = $1`, [d]),
    ).rejects.toThrow(/Aufbewahrungspflicht/u);
  });

  it('Ebene 2 — das Hard-Loeschen ebenfalls, und zwar unabhaengig davon', async () => {
    const d = await dokument(f.reinigung, 'angebot');   // keine Loeschsperre
    // Selbst ohne Aufbewahrungspflicht: `dokument` steht im Loeschsperr-Register.
    await expect(sql.unsafe(`delete from dokument where id = $1`, [d]))
      .rejects.toThrow(/Hard delete auf public\.dokument ist gesperrt/u);
    await expect(alsRolle('cse_app', (tx) => tx.unsafe(`delete from dokument`)))
      .rejects.toThrow(/permission denied|berechtigung/iu);
  });

  it('eine Kategorie OHNE Sperre laesst sich soft-loeschen', async () => {
    // Sonst prueft der Test nur, dass alles verboten ist.
    const d = await dokument(f.reinigung, 'angebot');
    await sql.unsafe(`update dokument set geloescht_am = now(), loeschgrund = 'Test' where id = $1`, [d]);
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*) n from dokument where id = $1 and geloescht_am is not null`, [d],
    );
    expect(Number(z!.n)).toBe(1);
  });

  it('eine gesetzte Loeschsperre kann nicht wieder geloest werden', async () => {
    const d = await dokument(f.reinigung, 'rechnung');
    await expect(
      sql.unsafe(`update dokument set loeschsperre = false where id = $1`, [d]),
    ).rejects.toThrow(/kann nicht aufgehoben/u);
  });

  it('die Versionskette ist append-only', async () => {
    const d = await dokument(f.reinigung, 'rechnung');
    await sql.unsafe(
      `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                     sha256, groesse_bytes, mime_typ)
       values ($1,$2,1,'k',$3,1024,'application/pdf')`,
      [f.reinigung, d, 'a'.repeat(64)],
    );
    await expect(sql.unsafe(`delete from dokument_version where dokument_id = $1`, [d]))
      .rejects.toThrow(/Hard delete/u);
  });
});
