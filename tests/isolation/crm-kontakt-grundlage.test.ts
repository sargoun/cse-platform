/**
 * Der Rechtsgrundlagen-Block eines Kontakts — gegen echte Rechte, echte
 * Spaltenentzüge und echte Auslöser (CRM-08, LEG-08, K-05, 0246–0248).
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. **K-05 hält.** `cse_app` bekommt `ansprechpartner.rechtsgrundlage`
 *     weder in einem `select` noch in einem `where` noch in einem `order by`
 *     — dreimal `42501`, und das ist der Grund, warum 0247 existiert.
 *  2. `app.kontakt_rechtsgrundlage_liste()` schreibt **EINE** Protokollzeile
 *     je Abruf, nicht eine je Kontakt. Das ist die ganze Zusage von 0247.
 *  3. Beide neuen Leser verlangen das ENGERE Recht
 *     `crm.rechtsgrundlage_lesen`; `crm.lesen` allein genügt nicht (O-661).
 *  4. Sie sind im Kundenportal gesperrt (K-04).
 *  5. `aehnliche_leistung` ist ohne Begründung nicht speicherbar (0246), und
 *     sie ist `cse_app` nicht lesbar — nur über den Definer.
 *  6. `app.werbewiderspruch_manuell_setzen` (0248) prüft
 *     `crm.rechtsgrundlage_setzen`, setzt den FRÜHESTEN Eingang, legt die
 *     Nachweiszeile an und sperrt danach die Werbung im echten Tor.
 *  7. Der Widerspruch ist EINWEG: ihn zu leeren wirft `restrict_violation`.
 *  8. Ein Eingang in der Zukunft wird abgewiesen.
 *  9. Die Gruppenansicht erfasst nichts (Invariante 10).
 * 10. Ein fremder Bereich sieht den Kontakt nicht (Invariante 3).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
let chef = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(): Promise<string> {
  const email = `grund-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Entzieht einer Rolle ein Recht in genau einem Bereich. */
async function entziehe(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, false from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, recht]);
}

async function mitgliedschaft(
  benutzerId: string, mandantId: string, rolle = 'admin',
): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, $3, false)`, [benutzerId, mandantId, await rolleId(rolle)]);
}

async function kunde(mandantId: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am)
     values ($1, $2, 'Hausverwaltung Testfall', 'bestandskunde', 'Rahmenvertrag', now())
     returning id`, [mandantId, `K-${zufall()}`]);
  return z!.id;
}

async function kontakt(
  mandantId: string, kundeId: string, grundlage = 'bestandskunde',
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, nachname, email,
                                  rechtsgrundlage, rechtsgrundlage_quelle,
                                  rechtsgrundlage_erfasst_am)
     values ($1, $2, 'Beispiel', $3, $4::rechtsgrundlage,
             case when $4 = 'keine' then null else 'Rahmenvertrag' end,
             case when $4 = 'keine' then null else now() end)
     returning id`,
    [mandantId, kundeId, `k-${zufall()}@example.test`, grundlage]);
  return z!.id;
}

/** Eine Sitzung im Bereich, intern, mit zweitem Faktor und Schreibrecht. */
async function alsIntern<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  opts: { readonly aal?: string; readonly portal?: 'intern' | 'kunde';
    readonly readonly?: boolean } = {},
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId, benutzerId: chef,
      portal: opts.portal ?? 'intern', readonly: opts.readonly ?? false,
    },
    async (tx) => {
      await tx.unsafe(`select set_config('app.aal',$1,true)`, [opts.aal ?? 'aal2']);
      return fn(tx);
    },
  );
}

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await mitgliedschaft(chef, f.reinigung);
  await mitgliedschaft(chef, f.bau);
});

afterAll(async () => { await schliessen(); });

describe('K-05 · der Nachweisblock ist `cse_app` entzogen — dreifach', () => {
  it('ein `select rechtsgrundlage` scheitert mit 42501', async () => {
    const k = await kunde(f.reinigung);
    await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select rechtsgrundlage from ansprechpartner limit 1`)))
      .rejects.toThrow(/permission denied/iu);
  });

  it('ein `where rechtsgrundlage = …` scheitert ebenso', async () => {
    const k = await kunde(f.reinigung);
    await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select id from ansprechpartner where rechtsgrundlage = 'keine'`)))
      .rejects.toThrow(/permission denied/iu);
  });

  it('ein `order by rechtsgrundlage` scheitert ebenso', async () => {
    const k = await kunde(f.reinigung);
    await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select id from ansprechpartner order by rechtsgrundlage`)))
      .rejects.toThrow(/permission denied/iu);
  });

  it('`aehnliche_leistung` ist ebenso entzogen (0246)', async () => {
    const k = await kunde(f.reinigung);
    await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select aehnliche_leistung from ansprechpartner limit 1`)))
      .rejects.toThrow(/permission denied/iu);
  });

  it('die lesbaren Spalten gehen weiterhin', async () => {
    const k = await kunde(f.reinigung);
    await kontakt(f.reinigung, k);
    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select id, nachname, email from ansprechpartner`));
    expect(zeilen).toHaveLength(1);
  });
});

describe('0247 · ein Abruf, EINE Protokollzeile', () => {
  it('die Liste erzeugt genau eine Zeile — auch bei drei Kontakten', async () => {
    const k = await kunde(f.reinigung);
    await kontakt(f.reinigung, k);
    await kontakt(f.reinigung, k);
    await kontakt(f.reinigung, k);

    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select * from app.kontakt_rechtsgrundlage_liste()`));

    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'crm.kontakt_grundlagen_liste_gelesen'`);
    expect(z!.n).toBe('1');
  });

  it('die Liste gibt alle drei Kontakte zurück', async () => {
    const k = await kunde(f.reinigung);
    await kontakt(f.reinigung, k);
    await kontakt(f.reinigung, k);
    await kontakt(f.reinigung, k);
    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select * from app.kontakt_rechtsgrundlage_liste()`));
    expect(zeilen).toHaveLength(3);
  });

  it('das BLATT protokolliert je Kontakt — deshalb steht es nicht in der Liste', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);
    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select * from app.kontakt_rechtsgrundlage_blatt($1)`, [a]));
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'ansprechpartner.rechtsgrundlage_gelesen'`);
    expect(z!.n).toBe('1');
  });

  it('ein fremder Bereich steht nicht in der Liste (Invariante 3)', async () => {
    const kr = await kunde(f.reinigung);
    await kontakt(f.reinigung, kr);
    const kb = await kunde(f.bau);
    await kontakt(f.bau, kb);

    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ kunde_id: string }[]>(
        `select kunde_id from app.kontakt_rechtsgrundlage_liste()`));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.kunde_id).toBe(kr);
  });
});

describe('0247 · das ENGERE Recht trägt den Block (O-661)', () => {
  it('ohne `crm.rechtsgrundlage_lesen` wirft die Liste', async () => {
    await entziehe('admin', 'crm.rechtsgrundlage_lesen', f.reinigung);
    const k = await kunde(f.reinigung);
    await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select * from app.kontakt_rechtsgrundlage_liste()`)))
      .rejects.toThrow(/crm\.rechtsgrundlage_lesen fehlt/u);
  });

  it('ohne es wirft auch das Blatt — `crm.lesen` genügt nicht', async () => {
    await entziehe('admin', 'crm.rechtsgrundlage_lesen', f.reinigung);
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select * from app.kontakt_rechtsgrundlage_blatt($1)`, [a])))
      .rejects.toThrow(/crm\.rechtsgrundlage_lesen fehlt/u);
  });

  it('im Kundenportal ist der Block gesperrt (K-04)', async () => {
    const k = await kunde(f.reinigung);
    await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung,
      async (tx) => tx.unsafe(`select * from app.kontakt_rechtsgrundlage_liste()`),
      { portal: 'kunde' }))
      .rejects.toThrow(/internen Portal/u);
  });
});

describe('0246 · die Wertung braucht ihre Begründung', () => {
  it('`aehnliche_leistung` ohne Begründung wird abgewiesen', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `update ansprechpartner set aehnliche_leistung = true
          where id = $1 returning id`, [a])))
      .rejects.toThrow(/aehnliche_leistung_begruendet/u);
  });

  it('mit Begründung geht sie — und der Definer gibt beides zurück', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);
    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `update ansprechpartner
            set aehnliche_leistung = true,
                aehnliche_leistung_begruendung = 'Reinigung und Objektschutz am Objekt'
          where id = $1 returning id`, [a]));
    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ aehnliche_leistung: boolean; aehnliche_begruendung: string }[]>(
        `select aehnliche_leistung, aehnliche_begruendung
           from app.kontakt_rechtsgrundlage_blatt($1)`, [a]));
    expect(zeilen[0]!.aehnliche_leistung).toBe(true);
    expect(zeilen[0]!.aehnliche_begruendung).toContain('Objektschutz');
  });

  it('die Vorgabe ist `false` — fail closed', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);
    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ aehnliche_leistung: boolean }[]>(
        `select aehnliche_leistung from app.kontakt_rechtsgrundlage_blatt($1)`, [a]));
    expect(zeilen[0]!.aehnliche_leistung).toBe(false);
  });
});

describe('0248 · der Werbewiderspruch von Hand', () => {
  it('er setzt das Datum, legt die Nachweiszeile an und sperrt die Werbung', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);

    /* Vorher: das Tor lässt Werbung an einen Bestandskunden durch. */
    const vorher = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ ok: boolean }[]>(
        `select app.darf_kontaktiert_werden($1,'email','werbung') as ok`, [a]));
    expect(vorher[0]!.ok).toBe(true);

    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `select app.werbewiderspruch_manuell_setzen($1, null, 'telefon', now(),
                  'Anruf am Montag')`, [a]));

    const nachher = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ ok: boolean }[]>(
        `select app.darf_kontaktiert_werden($1,'email','werbung') as ok`, [a]));
    expect(nachher[0]!.ok).toBe(false);

    /* Die Rechnung geht weiter — das ist der Unterschied zum Vollwiderspruch. */
    const vertraglich = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ ok: boolean }[]>(
        `select app.darf_kontaktiert_werden($1,'email','vertraglich') as ok`, [a]));
    expect(vertraglich[0]!.ok).toBe(true);

    const [nachweis] = await sql.unsafe<{
      art: string; quelle: string; kanal: string; bemerkung: string;
      erfasst_von: string | null;
    }[]>(`select art::text, quelle::text, kanal, bemerkung, erfasst_von
            from werbewiderspruch`);
    expect(nachweis!.art).toBe('werbung');
    expect(nachweis!.quelle).toBe('manuell');
    expect(nachweis!.kanal).toBe('telefon');
    expect(nachweis!.bemerkung).toContain('Montag');
    expect(nachweis!.erfasst_von).toBe(chef);
  });

  it('ein zweiter, FRÜHERER Eingang zieht das Datum nach vorn — das erste „nein" gilt', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);

    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select app.werbewiderspruch_manuell_setzen($1, null, null, now(), 'heute')`,
        [a]));
    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `select app.werbewiderspruch_manuell_setzen($1, null, 'post',
                  now() - interval '10 days', 'Brief vom Zehnten')`, [a]));

    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ alt: boolean }[]>(
        `select werbewiderspruch_am < now() - interval '5 days' as alt
           from app.kontakt_rechtsgrundlage_blatt($1)`, [a]));
    expect(zeilen[0]!.alt).toBe(true);

    /* Zwei Eingänge, zwei Nachweiszeilen — kein Überschreiben. */
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from werbewiderspruch`);
    expect(n!.n).toBe('2');
  });

  it('ein Eingang in der ZUKUNFT wird abgewiesen', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `select app.werbewiderspruch_manuell_setzen($1, null, null,
                  now() + interval '1 day', 'morgen')`, [a])))
      .rejects.toThrow(/Zukunft/u);
  });

  it('ohne `crm.rechtsgrundlage_setzen` wird nichts erfasst', async () => {
    await entziehe('admin', 'crm.rechtsgrundlage_setzen', f.reinigung);
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `select app.werbewiderspruch_manuell_setzen($1, null, null, now(), 'x')`, [a])))
      .rejects.toThrow(/crm\.rechtsgrundlage_setzen fehlt/u);
  });

  it('ein unbekannter Kanal wird abgewiesen', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `select app.werbewiderspruch_manuell_setzen($1, null, 'brieftaube', now(), 'x')`,
        [a]))).rejects.toThrow(/Kanal/u);
  });

  it('ohne Betroffenen gibt es keinen Widerspruch', async () => {
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `select app.werbewiderspruch_manuell_setzen(null, null, null, now(), 'x')`)))
      .rejects.toThrow(/Betroffenen/u);
  });

  it('die Gruppenansicht erfasst nichts (Invariante 10)', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);
    await expect(alsIntern(f.reinigung,
      async (tx) => tx.unsafe(
        `select app.werbewiderspruch_manuell_setzen($1, null, null, now(), 'x')`, [a]),
      { readonly: true }))
      .rejects.toThrow(/Gruppenansicht/u);
  });

  it('er steht im Prüfprotokoll', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);
    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select app.werbewiderspruch_manuell_setzen($1, null, null, now(), 'x')`,
        [a]));
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'crm.werbewiderspruch_manuell'`);
    expect(z!.n).toBe('1');
  });
});

describe('der Widerspruch ist EINWEG (kern.erzwinge_widerspruch)', () => {
  it('`werbewiderspruch_am` lässt sich nicht wieder leeren', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k);
    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select app.werbewiderspruch_manuell_setzen($1, null, null, now(), 'x')`,
        [a]));
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `update ansprechpartner set werbewiderspruch_am = null
          where id = $1 returning id`, [a])))
      .rejects.toThrow(/nicht zurueckgenommen|nicht zurückgenommen/u);
  });
});

describe('der Rechtsgrundlagen-Schreibweg der Oberfläche', () => {
  it('ein `update … returning id` geht — mit KEINER entzogenen Spalte', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k, 'keine');
    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ id: string }[]>(
        `update ansprechpartner
            set rechtsgrundlage = 'einwilligung'::rechtsgrundlage,
                rechtsgrundlage_quelle = 'Häkchen im Formular',
                rechtsgrundlage_erfasst_am = now(),
                einwilligung_kanaele = array['email']::text[]
          where mandant_id = app.aktiver_mandant() and id = $1::uuid
            and archiviert_am is null
          returning id`, [a]));
    expect(zeilen).toHaveLength(1);
  });

  it('dasselbe `update` mit `returning rechtsgrundlage` scheitert — deshalb steht dort `id`', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k, 'keine');
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `update ansprechpartner set rechtsgrundlage = 'anfrage'::rechtsgrundlage,
                rechtsgrundlage_quelle = 'q', rechtsgrundlage_erfasst_am = now()
          where id = $1 returning rechtsgrundlage`, [a])))
      .rejects.toThrow(/permission denied/iu);
  });

  it('Kanäle ohne Einwilligung weist der CHECK ab', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k, 'keine');
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `update ansprechpartner
            set rechtsgrundlage = 'bestandskunde'::rechtsgrundlage,
                rechtsgrundlage_quelle = 'q', rechtsgrundlage_erfasst_am = now(),
                einwilligung_kanaele = array['email']::text[]
          where id = $1 returning id`, [a])))
      .rejects.toThrow(/kanaele_nur_bei_einwilligung/u);
  });
});
