/**
 * Die Abnahme (§ 12 VOB/B) gegen die echte Datenbank — 0210, 0211, 0213.
 *
 * Fünf Dinge lassen sich nur hier prüfen und nicht im Einheitstest:
 *
 *  1. **Die Unveränderlichkeit.** `kern.abnahme_einfrieren` ist ein Auslöser;
 *     ob er greift, entscheidet Postgres. Ein Protokoll, das man hätte
 *     überschreiben können, ist als Beweis wertlos — und das fällt nie auf,
 *     weil nichts dabei kaputtgeht.
 *  2. **Der nachgetragene Mangel.** Der Kopf trägt seinen `snapshot` mit der
 *     Mängelliste; eine Zeile, die danach dazukommt, stünde in der Tabelle
 *     und nicht im Siegel. Der Auslöser weist sie ab, und das ist die Zusage.
 *  3. **Der Projektstatus.** Nur die erste WIRKSAME Abnahme der
 *     Gesamtleistung schlägt ihn um — nicht eine Teilabnahme und nicht eine
 *     Verweigerung.
 *  4. **`kunde_id` kommt vom Projekt.** Wäre sie Eingabe, könnte ein
 *     Protokoll behaupten, zu einem anderen Kunden zu gehören als sein
 *     Projekt — und darauf ruht die Kundendecke.
 *  5. **`app.projekt_summe_lesen`** (0213): der Spaltenentzug aus 0089 lässt
 *     sich nur gegen eine echte Rolle prüfen, als Eigentümer ist jede Spalte
 *     lesbar.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  baueAbnahmeSchnappschuss, abnahmeSchnappschussHash, AbnahmeFehler,
  ladeMaengel, listeAbnahmen, protokolliereAbnahme, storniereAbnahme,
  verknuepfeErsatzprotokoll,
} from '../../src/server/services/bau/abnahme.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);
const HASH = 'a'.repeat(64);

interface Aufbau {
  readonly mandant: string;
  readonly kunde: string;
  readonly projekt: string;
  readonly lv: string;
  readonly benutzer: string;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  return u!.id;
}

/** Kunde → Auftrag → Projekt → Leistungsverzeichnis, wie §7.1 es verlangt. */
async function baueProjekt(
  mandant: string, rolle = 'leitung',
  opts: { readonly summe?: number | null; readonly einbehalt?: number | null } = {},
): Promise<Aufbau> {
  const benutzer = await konto(`abnahme-${zufall()}@cse.test`);
  await sql.unsafe(
    /*
     * **`gueltig_ab` ausdruecklich auf GESTERN — und das ist ein Befund, keine
     * Vorsichtsmassnahme.** Der Spaltenvorgabewert ist `app.berlin_heute()`
     * (0169), `app.ist_mitglied` hat aber `p_stichtag date default
     * CURRENT_DATE`, und die Zwei-Argument-Aufrufer (0025
     * `kern.auftrag_verantwortlich_im_mandant`, 0146) nehmen genau diesen
     * Vorgabewert. Zwischen 22:00 UTC und Mitternacht ist `berlin_heute()`
     * schon morgen und `CURRENT_DATE` noch heute: eine soeben angelegte
     * Mitgliedschaft gilt dann NICHT, und das Anlegen des Auftrags scheitert
     * mit „Der Verantwortliche gehoert nicht zu dieser Gesellschaft". Diese
     * Fixtur setzt den Tag deshalb selbst; die Ursache gehoert nach 0169 und
     * steht im Ergebnisbericht.
     */
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
     values ($1,$2,$3, current_date - 1)`,
    [benutzer, mandant, await rolleId(rolle)]);

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Bauherr Nord') returning id`, [mandant, `K-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,'projekt','aktiv','Rohbau Nord',$4,'2026-01-01') returning id`,
    [mandant, `AU-${zufall()}`, k!.id, benutzer] as never[]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage, status, auftragssumme_netto_cent,
                          sicherheitseinbehalt_bp)
     values ($1,$2,$3,'Rohbau Nord',$4,'hochbau','vob_b','in_arbeit',$5::bigint,$6::int)
     returning id`,
    [mandant, a!.id, `P-${zufall()}`, k!.id,
     opts.summe ?? 12345678, opts.einbehalt ?? 500] as never[]);
  const [lv] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung)
     values ($1,$2,'hauptauftrag','LV Rohbau') returning id`,
    [mandant, p!.id] as never[]);

  return { mandant, kunde: k!.id, projekt: p!.id, lv: lv!.id, benutzer };
}

/**
 * Ein Protokoll, als Eigentümer geschrieben.
 *
 * Für die Auslöser ist das dieselbe Bahn (Trigger sind nicht RLS); die
 * RLS-Fragen stehen in ihrem eigenen Abschnitt und laufen dort durch
 * `alsApp`.
 */
async function abnahme(
  bau: Aufbau,
  opts: {
    art?: string; am?: string; abgenommen?: boolean; grund?: string | null;
    strafe?: boolean; maengel?: boolean; text?: string | null; umfang?: string | null;
  } = {},
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into abnahme (mandant_id, projekt_id, kunde_id, art, abnahme_am,
                          leistungsumfang, vorbehalt_vertragsstrafe, vorbehalt_maengel,
                          vorbehalt_text, abgenommen, verweigerung_grund, teilnehmer,
                          snapshot, snapshot_hash, erstellt_von)
     values ($1,$2,$1,$3::bau_abnahme_art,$4::date,$5,$6,$7,$8,$9,$10,
             '[{"name":"Frau Beyer"}]'::jsonb, '{"fassung":"probe"}'::jsonb, $11, $12)
     returning id`,
    [
      bau.mandant, bau.projekt, opts.art ?? 'foermlich', opts.am ?? '2026-09-10',
      opts.umfang ?? null,
      opts.strafe ?? true, opts.maengel ?? false,
      /*
       * `'text' in opts` und nicht `opts.text ?? …`: ein ausdrueckliches
       * `null` IST die Eingabe, um die es in der Pruefung geht — mit `??`
       * haette der Vorgabewert es ueberschrieben, und der Test haette
       * gemessen, dass ein Vorbehalt MIT Wortlaut durchgeht.
       */
      'text' in opts ? opts.text : 'Vertragsstrafe bleibt vorbehalten.',
      opts.abgenommen ?? true, opts.grund ?? null, HASH, bau.benutzer,
    ] as never[]);
  return z!.id;
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('§ 11 Abs. 4 VOB/B — der Vorbehalt wird in BEIDEN Richtungen aufgezeichnet', () => {
  it('„nicht vorbehalten" ist ein Wert und keine fehlende Angabe', async () => {
    const bau = await baueProjekt(f.bau);
    const id = await abnahme(bau, { strafe: false, text: null });
    const [z] = await sql.unsafe<{ strafe: boolean }[]>(
      `select vorbehalt_vertragsstrafe as strafe from abnahme where id = $1`, [id]);
    // Nicht NULL, sondern false: der Anspruch ist verfallen, und das steht da.
    expect(z!.strafe).toBe(false);
  });

  it('und der Bericht über die verfallenen Ansprüche findet sie', async () => {
    const bau = await baueProjekt(f.bau);
    await abnahme(bau, { strafe: false, text: null });
    const [z] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from abnahme
        where projekt_id = $1 and abgenommen and not vorbehalt_vertragsstrafe`,
      [bau.projekt]);
    expect(Number(z!.anzahl)).toBe(1);
  });

  it('ein Vorbehalt ohne Wortlaut wird abgewiesen — § 11 Abs. 4 verlangt die Erklärung',
    async () => {
      const bau = await baueProjekt(f.bau);
      await expect(abnahme(bau, { strafe: true, text: null }))
        .rejects.toThrow(/abnahme_vorbehalt_wortlaut/u);
    });
});

describe('§ 12 VOB/B — Verweigerung, Teilabnahme, Einmaligkeit', () => {
  it('eine Verweigerung ohne Grund ist keine', async () => {
    const bau = await baueProjekt(f.bau);
    await expect(abnahme(bau, { abgenommen: false, grund: null }))
      .rejects.toThrow(/abnahme_verweigerung_begruendet/u);
  });

  it('eine Verweigerung MIT Grund ist ein vollwertiger Datensatz', async () => {
    const bau = await baueProjekt(f.bau);
    const id = await abnahme(bau, {
      abgenommen: false, grund: 'Wesentliche Mängel im Bereich Achse C.',
    });
    const [z] = await sql.unsafe<{ abgenommen: boolean; grund: string }[]>(
      `select abgenommen, verweigerung_grund as grund from abnahme where id = $1`, [id]);
    expect(z!.abgenommen).toBe(false);
    expect(z!.grund).toContain('Achse C');
  });

  it('eine Teilabnahme ohne Leistungsumfang wird abgewiesen (§ 12 Abs. 2)', async () => {
    const bau = await baueProjekt(f.bau);
    await expect(abnahme(bau, { art: 'teilabnahme', umfang: null }))
      .rejects.toThrow(/abnahme_teil_benannt/u);
  });

  it('zwei wirksame Gesamtabnahmen gibt es nicht', async () => {
    const bau = await baueProjekt(f.bau);
    await abnahme(bau);
    await expect(abnahme(bau, { am: '2026-09-20' }))
      .rejects.toThrow(/abnahme_gesamt_uk/u);
  });

  it('aber eine VERWEIGERTE sperrt die späte wirksame nicht', async () => {
    const bau = await baueProjekt(f.bau);
    await abnahme(bau, { abgenommen: false, grund: 'Mängel', am: '2026-09-01' });
    const zweite = await abnahme(bau, { am: '2026-09-20' });
    expect(zweite).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('und mehrere Teilabnahmen sind zulässig (§ 12 Abs. 2)', async () => {
    const bau = await baueProjekt(f.bau);
    await abnahme(bau, { art: 'teilabnahme', umfang: 'Bauteil A', am: '2026-08-01' });
    await abnahme(bau, { art: 'teilabnahme', umfang: 'Bauteil B', am: '2026-09-01' });
    const [z] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from abnahme where projekt_id = $1`, [bau.projekt]);
    expect(Number(z!.anzahl)).toBe(2);
  });

  it('nach einem Storno ist der Platz wieder frei — die Korrektur ist ein Ersatz',
    async () => {
      const bau = await baueProjekt(f.bau);
      const erste = await abnahme(bau);
      await sql.unsafe(
        `update abnahme set storniert_am = now(), storniert_von = $2,
                            storno_grund = 'Datum falsch protokolliert'
          where id = $1`, [erste, bau.benutzer] as never[]);
      const ersatz = await abnahme(bau, { am: '2026-09-11' });
      await sql.unsafe(
        `update abnahme set ersetzt_durch_id = $2 where id = $1`,
        [erste, ersatz] as never[]);
      const [z] = await sql.unsafe<{ ersatz: string }[]>(
        `select ersetzt_durch_id as ersatz from abnahme where id = $1`, [erste]);
      expect(z!.ersatz).toBe(ersatz);
    });
});

describe('die Auslöser aus 0211', () => {
  it('`kunde_id` kommt vom Projekt — auch wenn der Aufrufer etwas anderes schickt',
    async () => {
      const bau = await baueProjekt(f.bau);
      const [z] = await sql.unsafe<{ id: string; kunde: string }[]>(
        `insert into abnahme (mandant_id, projekt_id, kunde_id, art, abnahme_am,
                              vorbehalt_vertragsstrafe, vorbehalt_maengel, vorbehalt_text,
                              abgenommen, teilnehmer, snapshot, snapshot_hash, erstellt_von)
         values ($1,$2,$1,'foermlich','2026-09-10',false,false,null,true,'[]'::jsonb,
                 '{}'::jsonb,$3,$4)
         returning id, kunde_id as kunde`,
        [bau.mandant, bau.projekt, HASH, bau.benutzer] as never[]);
      // Mitgeschickt war `mandant_id` als Kunde — abgeleitet wird der echte.
      expect(z!.kunde).toBe(bau.kunde);
    });

  it('`protokolliert_am` ist SERVERZEIT, kein mitgeschickter Zeitpunkt', async () => {
    const bau = await baueProjekt(f.bau);
    const [z] = await sql.unsafe<{ alt: boolean }[]>(
      `insert into abnahme (mandant_id, projekt_id, kunde_id, art, abnahme_am,
                            protokolliert_am, vorbehalt_vertragsstrafe, vorbehalt_maengel,
                            abgenommen, teilnehmer, snapshot, snapshot_hash, erstellt_von)
       values ($1,$2,$1,'foermlich','2026-09-10','2001-01-01T00:00:00Z',
               false,false,true,'[]'::jsonb,'{}'::jsonb,$3,$4)
       returning (protokolliert_am < '2010-01-01'::timestamptz) as alt`,
      [bau.mandant, bau.projekt, HASH, bau.benutzer] as never[]);
    expect(z!.alt).toBe(false);
  });

  it('das Protokoll ist unveränderlich — jede Protokollspalte wird abgewiesen', async () => {
    const bau = await baueProjekt(f.bau);
    const id = await abnahme(bau);
    for (const anweisung of [
      `update abnahme set vorbehalt_vertragsstrafe = false where id = $1`,
      `update abnahme set abnahme_am = '2026-09-11' where id = $1`,
      `update abnahme set abgenommen = false, verweigerung_grund = 'x' where id = $1`,
      `update abnahme set teilnehmer = '[]'::jsonb where id = $1`,
      `update abnahme set snapshot_hash = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0`
      + `b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0' where id = $1`,
    ]) {
      /*
       * Jede Anweisung bekommt GENAU ihre Parameter. Ein ueberzaehliges $2
       * liess Postgres mit „could not determine data type of parameter $2"
       * scheitern — die Zusicherung war dann gruen, weil IRGENDEIN Fehler kam,
       * und nicht, weil der Ausloeser gegriffen hat.
       */
      await expect(sql.unsafe(anweisung, [id]), anweisung)
        .rejects.toThrow(/unveraenderlich/u);
    }
  });

  it('beweglich bleiben Storno und Aufbewahrung — und nur die', async () => {
    const bau = await baueProjekt(f.bau);
    const id = await abnahme(bau);
    await sql.unsafe(
      `update abnahme set storniert_am = now(), storniert_von = $2, storno_grund = 'Ersatz'
        where id = $1`, [id, bau.benutzer] as never[]);
    await sql.unsafe(
      `update abnahme set aufbewahrung_bis = '2036-12-31', loeschsperre = true
        where id = $1`, [id]);
    const [z] = await sql.unsafe<{ grund: string; bis: string }[]>(
      `select storno_grund as grund, aufbewahrung_bis::text as bis from abnahme
        where id = $1`, [id]);
    expect(z!.grund).toBe('Ersatz');
    expect(z!.bis).toBe('2036-12-31');
  });

  it('die erste wirksame Gesamtabnahme setzt den Projektstatus', async () => {
    const bau = await baueProjekt(f.bau);
    await abnahme(bau);
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from projekt where id = $1`, [bau.projekt]);
    expect(z!.status).toBe('abgenommen');
  });

  it('eine Teilabnahme und eine Verweigerung lassen ihn stehen', async () => {
    const teil = await baueProjekt(f.bau);
    await abnahme(teil, { art: 'teilabnahme', umfang: 'Bauteil A' });
    const [a] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from projekt where id = $1`, [teil.projekt]);
    expect(a!.status).toBe('in_arbeit');

    const weigerung = await baueProjekt(f.bau);
    await abnahme(weigerung, { abgenommen: false, grund: 'Mängel' });
    const [b] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from projekt where id = $1`, [weigerung.projekt]);
    expect(b!.status).toBe('in_arbeit');
  });

  it('ein abgeschlossenes Projekt wird NICHT zurückgesetzt', async () => {
    const bau = await baueProjekt(f.bau);
    await sql.unsafe(`update projekt set status = 'abgeschlossen' where id = $1`,
      [bau.projekt]);
    await abnahme(bau);
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from projekt where id = $1`, [bau.projekt]);
    expect(z!.status).toBe('abgeschlossen');
  });
});

describe('§ 12 Abs. 3 — die Mängelliste gehört ZUM Protokoll', () => {
  async function mangel(
    bau: Aufbau, abnahmeId: string,
    opts: { beschreibung?: string; frist?: string | null; nr?: number } = {},
  ): Promise<string> {
    const [z] = await sql.unsafe<{ id: string }[]>(
      `insert into abnahme_mangel (mandant_id, abnahme_id, projekt_id, kunde_id,
                                   reihenfolge, beschreibung, frist_am, erstellt_von)
       values ($1,$2,$1,$1,$3,$4,$5::date,$6) returning id`,
      [
        bau.mandant, abnahmeId, opts.nr ?? 1,
        opts.beschreibung ?? 'Fuge Achse C unvollständig',
        opts.frist ?? '2026-10-01', bau.benutzer,
      ] as never[]);
    return z!.id;
  }

  it('in derselben Transaktion geht er durch — und erbt Projekt und Kunde', async () => {
    const bau = await baueProjekt(f.bau);
    const [z] = await sql.begin(async (tx) => {
      const [kopf] = await tx.unsafe<{ id: string }[]>(
        `insert into abnahme (mandant_id, projekt_id, kunde_id, art, abnahme_am,
                              vorbehalt_vertragsstrafe, vorbehalt_maengel, vorbehalt_text,
                              abgenommen, teilnehmer, snapshot, snapshot_hash, erstellt_von)
         values ($1,$2,$1,'foermlich','2026-09-10',false,true,'Restleistungen',true,
                 '[]'::jsonb,'{}'::jsonb,$3,$4)
         returning id`,
        [bau.mandant, bau.projekt, HASH, bau.benutzer] as never[]);
      return tx.unsafe<{ projekt: string; kunde: string }[]>(
        `insert into abnahme_mangel (mandant_id, abnahme_id, projekt_id, kunde_id,
                                     reihenfolge, beschreibung, erstellt_von)
         values ($1,$2,$1,$1,1,'Fuge Achse C',$3)
         returning projekt_id as projekt, kunde_id as kunde`,
        [bau.mandant, kopf!.id, bau.benutzer] as never[]);
    }) as { projekt: string; kunde: string }[];
    expect(z!.projekt).toBe(bau.projekt);
    expect(z!.kunde).toBe(bau.kunde);
  });

  it('nachgetragen wird er abgewiesen — das Siegel enthält ihn nicht', async () => {
    const bau = await baueProjekt(f.bau);
    const id = await abnahme(bau);
    await expect(mangel(bau, id)).rejects.toThrow(/MIT dem Abnahmeprotokoll/u);
  });

  it('behoben melden ist erlaubt, umschreiben nicht', async () => {
    const bau = await baueProjekt(f.bau);
    const [mangelId] = await sql.begin(async (tx) => {
      const [kopf] = await tx.unsafe<{ id: string }[]>(
        `insert into abnahme (mandant_id, projekt_id, kunde_id, art, abnahme_am,
                              vorbehalt_vertragsstrafe, vorbehalt_maengel, vorbehalt_text,
                              abgenommen, teilnehmer, snapshot, snapshot_hash, erstellt_von)
         values ($1,$2,$1,'foermlich','2026-09-10',false,true,'Restleistungen',true,
                 '[]'::jsonb,'{}'::jsonb,$3,$4)
         returning id`,
        [bau.mandant, bau.projekt, HASH, bau.benutzer] as never[]);
      return tx.unsafe<{ id: string }[]>(
        `insert into abnahme_mangel (mandant_id, abnahme_id, projekt_id, kunde_id,
                                     reihenfolge, beschreibung, frist_am, erstellt_von)
         values ($1,$2,$1,$1,1,'Fuge Achse C','2026-10-01',$3) returning id`,
        [bau.mandant, kopf!.id, bau.benutzer] as never[]);
    }) as { id: string }[];

    await sql.unsafe(`update abnahme_mangel set behoben_am = '2026-09-20' where id = $1`,
      [mangelId!.id]);
    await expect(
      sql.unsafe(`update abnahme_mangel set beschreibung = 'anders' where id = $1`,
        [mangelId!.id]),
    ).rejects.toThrow(/unveraenderlich/u);
  });
});

describe('Invariante 8 — nichts wird hart gelöscht', () => {
  it('weder das Protokoll noch ein Mangel', async () => {
    const bau = await baueProjekt(f.bau);
    const id = await abnahme(bau);
    await expect(sql.unsafe(`delete from abnahme where id = $1`, [id]))
      .rejects.toThrow(/Hard delete/u);
    await expect(sql.unsafe(`truncate abnahme_mangel`))
      .rejects.toThrow(/Hard delete/u);
  });

  it('und `cse_app` hält gar kein DELETE darauf', async () => {
    const zeilen = await sql.unsafe<{ tabelle: string }[]>(
      `select table_name as tabelle from information_schema.role_table_grants
        where grantee = 'cse_app' and privilege_type = 'DELETE'
          and table_name in ('abnahme','abnahme_mangel')`);
    expect(zeilen.map((z) => z.tabelle)).toEqual([]);
  });
});

describe('Invariante 3 — der Mandant trennt', () => {
  it('ein Protokoll der Reinigung ist für den Bau nicht vorhanden', async () => {
    const bau = await baueProjekt(f.bau);
    await abnahme(bau);

    const gesehen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(`select id from abnahme`),
    ) as { id: string }[];
    expect(gesehen).toHaveLength(0);
  });

  it('im eigenen Mandanten sieht dieselbe Sitzung es', async () => {
    const bau = await baueProjekt(f.bau);
    await abnahme(bau);
    const gesehen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(`select id from abnahme`),
    ) as { id: string }[];
    expect(gesehen).toHaveLength(1);
  });

  it('und das Mitarbeiterportal sieht es NICHT — es ist keine Baustellenunterlage',
    async () => {
      const bau = await baueProjekt(f.bau, 'mitarbeiter');
      await abnahme(bau);
      const gesehen = await alsApp(
        {
          scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer,
          portal: 'mitarbeiter',
        },
        async (tx) => tx.unsafe(`select id from abnahme`),
      ) as { id: string }[];
      expect(gesehen).toHaveLength(0);
    });
});

describe('0213 — `app.projekt_summe_lesen`, der eine Weg zur Vertragssumme', () => {
  it('ein direkter Zugriff auf die Spalte scheitert (K-05, 0089)', async () => {
    const bau = await baueProjekt(f.bau);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(`select auftragssumme_netto_cent from projekt`),
    )).rejects.toThrow(/permission denied|auftragssumme_netto_cent/u);
  });

  it('mit `bau.preis_lesen` gibt die Funktion beide Spalten heraus', async () => {
    const bau = await baueProjekt(f.bau, 'admin', { summe: 98765432, einbehalt: 250 });
    const [z] = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(
        `select auftragssumme_netto_cent::text as summe, sicherheitseinbehalt_bp as bp
           from app.projekt_summe_lesen($1)`, [bau.projekt]),
    ) as { summe: string; bp: number }[];
    expect(z!.summe).toBe('98765432');
    expect(z!.bp).toBe(250);
  });

  it('ohne das Recht kommt KEINE Zeile — nie eine 0 €', async () => {
    const bau = await baueProjekt(f.bau, 'leitung');
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(
        `select auftragssumme_netto_cent from app.projekt_summe_lesen($1)`, [bau.projekt]),
    ) as { auftragssumme_netto_cent: string }[];
    // `toHaveLength` und nicht `toEqual([])`: das Ergebnis des Treibers ist ein
    // Array MIT Zusatzfeldern (`count`, `command`), und ein Tiefenvergleich
    // gegen `[]` schlaegt daran fehl, ohne dass es an der Zusage liegt.
    expect(zeilen).toHaveLength(0);
  });

  it('und ein Projekt eines anderen Mandanten ist nicht vorhanden (AUT-06)', async () => {
    const bau = await baueProjekt(f.bau, 'admin');
    const fremd = await baueProjekt(f.reinigung, 'admin');
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(
        `select auftragssumme_netto_cent from app.projekt_summe_lesen($1)`, [fremd.projekt]),
    ) as { auftragssumme_netto_cent: string }[];
    expect(zeilen).toHaveLength(0);
  });

  it('jeder Zugriff steht im Protokoll', async () => {
    const bau = await baueProjekt(f.bau, 'admin');
    await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(`select * from app.projekt_summe_lesen($1)`, [bau.projekt]),
    );
    const [z] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from audit_log
        where aktion = 'bau.auftragssumme_gelesen'`);
    expect(Number(z!.anzahl)).toBeGreaterThan(0);
  });
});

describe('§10.4 — der Schnappschuss ist nachrechenbar', () => {
  it('derselbe Inhalt ergibt denselben Digest, eine andere Reihenfolge auch', () => {
    const kopf = {
      projekt: 'Rohbau Nord', projektNummer: 'P-1', kunde: 'Bauherr Nord',
      art: 'foermlich' as const, abnahmeAm: '10.09.2026',
      leistungsumfang: null, abgenommen: true, verweigerungGrund: null,
      vorbehaltVertragsstrafe: true, vorbehaltMaengel: false,
      vorbehaltText: 'Vertragsstrafe bleibt vorbehalten.',
      teilnehmer: ['Frau Beyer', 'Herr Schulz'],
    };
    const maengel = [
      { reihenfolge: '1', beschreibung: 'Fuge Achse C', oz: '1.1', fristAm: '2026-10-01' },
    ];
    const a = abnahmeSchnappschussHash(baueAbnahmeSchnappschuss(kopf, maengel));
    const b = abnahmeSchnappschussHash(baueAbnahmeSchnappschuss({ ...kopf }, [...maengel]));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('und ein fehlender Vorbehalt ändert ihn — er steht als Wort darin', () => {
    const kopf = {
      projekt: 'Rohbau Nord', projektNummer: 'P-1', kunde: 'Bauherr Nord',
      art: 'foermlich' as const, abnahmeAm: '10.09.2026',
      leistungsumfang: null, abgenommen: true, verweigerungGrund: null,
      vorbehaltMaengel: false, vorbehaltText: null, teilnehmer: [],
    };
    const mit = abnahmeSchnappschussHash(
      baueAbnahmeSchnappschuss({ ...kopf, vorbehaltVertragsstrafe: true }, []));
    const ohne = abnahmeSchnappschussHash(
      baueAbnahmeSchnappschuss({ ...kopf, vorbehaltVertragsstrafe: false }, []));
    expect(mit).not.toBe(ohne);
  });
});

/* ===========================================================================
 * Der DIENST, nicht die Tabelle
 * ======================================================================== */
/**
 * **Alles darueber schreibt von Hand — hier schreibt `protokolliereAbnahme`.**
 *
 * Die Abschnitte oben pruefen die Ausloeser, und dafuer ist die Handschrift
 * richtig: ein Ausloeser interessiert sich nicht fuer den Aufrufer. Aber die
 * Reihenfolge, auf der das ganze Siegel ruht — Schnappschuss aus der EINGABE
 * bauen, Kopf einfuegen, Maengel in DERSELBEN Transaktion nachziehen —, ist
 * eine Eigenschaft des Dienstes. Sie laesst sich nur pruefen, indem er
 * wirklich laeuft, gegen die echten Policies und mit dem Recht an der Sitzung.
 *
 * Die Eingabe ist WORTGLEICH die des Saatlaufs (`src/server/db/seed/bau.ts`,
 * Schritt 6). Damit ist dieser Test zugleich die Probe auf die Demodaten: ein
 * Saatlauf, der an einer Bedingung von 0211 scheitert, scheitert hier zuerst.
 */
describe('der Dienst laeuft durch die Policies — dieselbe Eingabe wie der Saatlauf', () => {
  /**
   * `readonly: false` ist Pflicht: die Harness setzt `app.readonly` auf `on`,
   * sobald das Feld fehlt (fail-closed), und jede `with check`-Bedingung
   * verlangt `not app.ist_readonly()`. Ohne diese Zeile scheitert der Schreib-
   * vorgang mit „new row violates row-level security policy" — was wie ein
   * Policyfehler aussieht und keiner ist.
   */
  const SCHREIBEND = (bau: Aufbau) => ({
    scope: 'mandant' as const, mandantId: bau.mandant, benutzerId: bau.benutzer,
    portal: 'intern' as const, readonly: false,
  });

  /** Ein Kontext auf DERSELBEN Transaktion wie `alsApp` (wie in bau-lv-import). */
  function kontextAus(tx: postgres.TransactionSql, bau: Aufbau): SchreibKontext {
    const fuehre = async <T>(s: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly T[];
    return {
      scope: 'mandant', portal: 'intern', benutzerId: bau.benutzer,
      aktiverMandantId: bau.mandant, mandantIds: [bau.mandant],
      abfrage: fuehre, schreibe: fuehre,
    } satisfies LeseKontext & SchreibKontext;
  }

  /** Zwei Positionen, auf die die Maengel zeigen — die OZ steht IM Siegel. */
  async function positionen(bau: Aufbau): Promise<Map<string, string>> {
    const je = new Map<string, string>();
    for (const [oz, kurztext, einheit, menge] of [
      ['1.2.6', 'Revisionsklappe 400 × 400 mm, F30', 'St', '6.000'],
      ['1.2.7', 'Anschlussfugen dauerelastisch schließen', 'm', '164.000'],
    ] as const) {
      const [z] = await sql.unsafe<{ id: string }[]>(
        `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, oz, pfad,
                                  sortier_pfad, ebene, art, positionsart, kurztext, einheit,
                                  menge_vertrag)
         values ($1,$2,$3,$4,'','',1,'position','normalposition',$5,$6,$7::numeric)
         returning id`,
        [bau.mandant, bau.lv, bau.projekt, oz, kurztext, einheit, menge] as never[]);
      je.set(oz, z!.id);
    }
    return je;
  }

  it('protokolliert die Teilabnahme, siegelt sie und laesst den Projektstatus stehen',
    async () => {
      const bau = await baueProjekt(f.bau);
      const pos = await positionen(bau);

      const ergebnis = await alsApp(SCHREIBEND(bau), async (tx) => {
        const kontext = kontextAus(tx, bau);
        const teil = await protokolliereAbnahme(kontext, {
          projektId: bau.projekt,
          art: 'teilabnahme',
          abnahmeAm: '2026-09-18',
          leistungsumfang:
            'Titel 1.2 Trockenbau, Bauabschnitt Nordseite (OZ 1.2.1 bis 1.2.8) — '
            + 'Ständerwände, Vorsatzschalen und Dachschrägenbekleidung, '
            + 'abgenommen zur Weiterarbeit der Folgegewerke.',
          abgenommen: true,
          verweigerungGrund: null,
          vorbehaltVertragsstrafe: true,
          vorbehaltMaengel: true,
          vorbehaltText:
            'Der Auftraggeber behält sich die Vertragsstrafe wegen Überschreitung der '
            + 'Zwischenfrist für den Trockenbau ausdrücklich vor (§ 11 Abs. 4 VOB/B). '
            + 'Die im Protokoll aufgeführten Mängel bleiben nach § 12 Abs. 3 VOB/B '
            + 'vorbehalten; die Abnahme des Bauabschnitts wird dadurch nicht berührt.',
          teilnehmer: [
            'REALTIME Service GmbH, Bauleitung (Auftragnehmer)',
            'Hausverwaltung Berliner Straße 42 GmbH, technische Leitung (Auftraggeber)',
            'Architekturbüro Kranz, Bauleitung Örtlichkeit (Planer)',
          ],
          maengel: [
            { beschreibung:
                'Anschlussfuge Dachschräge zu Giebelwand auf 6 m nicht dauerelastisch '
                + 'geschlossen; Rissbildung sichtbar.',
              fristAm: '2026-10-02', lvPositionId: pos.get('1.2.7') ?? null },
            { beschreibung:
                'Zwei Revisionsklappen im Flur sitzen nicht fluchtend; Laibung '
                + 'nachzuarbeiten.',
              fristAm: '2026-10-09', lvPositionId: pos.get('1.2.6') ?? null },
          ],
        });

        const [gespeichert] = await tx.unsafe<{ hash: string; strafe: boolean }[]>(
          `select snapshot_hash as hash, vorbehalt_vertragsstrafe as strafe
             from abnahme where id = $1`, [teil.id] as never[]);
        return {
          teil,
          hashInDb: gespeichert!.hash,
          strafe: gespeichert!.strafe,
          maengel: await ladeMaengel(kontext, teil.id),
          liste: await listeAbnahmen(kontext, { projektId: bau.projekt }),
        };
      });

      // Das Siegel steht in der Zeile, und es ist DASSELBE, das der Dienst
      // zurueckgegeben hat — waeren es zwei, gaebe es zwei Protokolle.
      expect(ergebnis.hashInDb).toBe(ergebnis.teil.hash);
      expect(ergebnis.teil.hash).toMatch(/^[0-9a-f]{64}$/u);
      // O-154: die Gewaehrleistungsfrist wird NICHT abgeleitet, solange das
      // Regime offen ist — die Schnittstelle gibt null, und das bleibt so.
      expect(ergebnis.teil.fristEnde).toBeNull();
      expect(ergebnis.strafe).toBe(true);
      // Die Maengel in der Reihenfolge der Eingabe, mit ihrer OZ am Bezug.
      expect(ergebnis.maengel.map((m) => m.oz)).toEqual(['1.2.7', '1.2.6']);
      expect(ergebnis.liste).toHaveLength(1);
      expect(ergebnis.liste[0]!.art).toBe('teilabnahme');
      expect(ergebnis.liste[0]!.maengel_offen).toBe(2);

      // § 12 Abs. 2: eine Teilabnahme schlaegt den Projektstatus nicht um.
      const [stand] = await sql.unsafe<{ status: string }[]>(
        `select status::text as status from projekt where id = $1`, [bau.projekt]);
      expect(stand!.status).toBe('in_arbeit');
    });
});

/* ===========================================================================
 * Die zweite Gesamtabnahme und die Korrekturspur
 * ======================================================================== */
/**
 * Zwei Befunde, die beide erst gegen echtes Postgres sichtbar wurden.
 *
 *  1. **Die Einmaligkeit stand nur im Index.** `abnahme_gesamt_uk` (0211)
 *     weist die zweite wirksame Gesamtabnahme ab — der Dienst prüfte sie
 *     nicht und fing sie nicht, und die Route übersetzt nur `AbnahmeFehler`.
 *     Zwei offene Reiter, ein Doppelklick oder der Weg über den Endpunkt
 *     endeten damit in einer 500, obwohl die richtige Antwort ein Satz ist.
 *  2. **`ersetzt_durch_id` schrieb niemand.** „Korrigiert wird durch Storno
 *     mit Ersatzprotokoll" ist der erklärte Weg — aber die Spalte wurde von
 *     keinem erreichbaren Pfad gesetzt: das stornierte Protokoll und sein
 *     Ersatz standen unverbunden nebeneinander.
 */
describe('zweite Gesamtabnahme und Ersatzprotokoll', () => {
  const SCHREIBEND2 = (bau: Aufbau) => ({
    scope: 'mandant' as const, mandantId: bau.mandant, benutzerId: bau.benutzer,
    portal: 'intern' as const, readonly: false,
  });

  function kontext2(tx: postgres.TransactionSql, bau: Aufbau): SchreibKontext {
    const fuehre = async <T>(s: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly T[];
    return {
      scope: 'mandant', portal: 'intern', benutzerId: bau.benutzer,
      aktiverMandantId: bau.mandant, mandantIds: [bau.mandant],
      abfrage: fuehre, schreibe: fuehre,
    } satisfies LeseKontext & SchreibKontext;
  }

  const EINGABE = (am: string, art: 'foermlich' | 'teilabnahme', umfang: string | null) => ({
    art, abnahmeAm: am, leistungsumfang: umfang,
    abgenommen: true, verweigerungGrund: null,
    vorbehaltVertragsstrafe: false, vorbehaltMaengel: false, vorbehaltText: null,
    teilnehmer: ['Bauleitung AN', 'Bauleitung AG'], maengel: [],
  });

  it('die zweite wirksame Gesamtabnahme ist ein AbnahmeFehler, keine 500', async () => {
    const bau = await baueProjekt(f.bau);
    await alsApp(SCHREIBEND2(bau), async (tx) => protokolliereAbnahme(
      kontext2(tx, bau), { projektId: bau.projekt, ...EINGABE('2026-09-10', 'foermlich', null) },
    ));

    const fehler = await alsApp(SCHREIBEND2(bau), async (tx) => {
      try {
        await protokolliereAbnahme(kontext2(tx, bau), {
          projektId: bau.projekt, ...EINGABE('2026-09-20', 'foermlich', null),
        });
        return null;
      } catch (e: unknown) {
        return e;
      }
    });

    expect(fehler).toBeInstanceOf(AbnahmeFehler);
    expect((fehler as AbnahmeFehler).grund).toBe('schon_abgenommen');
    expect((fehler as AbnahmeFehler).status).toBe(409);
    // Der Satz nennt den Tag, an dem abgenommen wurde — sonst sucht ihn jemand.
    expect((fehler as AbnahmeFehler).message).toMatch(/10\.09\.2026/u);
  });

  it('aber die Teilabnahme eines anderen Teils bleibt möglich (§ 12 Abs. 2)', async () => {
    const bau = await baueProjekt(f.bau);
    const ergebnis = await alsApp(SCHREIBEND2(bau), async (tx) => {
      const kontext = kontext2(tx, bau);
      await protokolliereAbnahme(kontext, {
        projektId: bau.projekt, ...EINGABE('2026-09-10', 'foermlich', null),
      });
      const teil = await protokolliereAbnahme(kontext, {
        projektId: bau.projekt, ...EINGABE('2026-09-20', 'teilabnahme', 'Bauteil C'),
      });
      return teil;
    });
    expect(ergebnis.hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('nach Storno verbindet `verknuepfeErsatzprotokoll` beide Protokolle', async () => {
    const bau = await baueProjekt(f.bau);
    const stand = await alsApp(SCHREIBEND2(bau), async (tx) => {
      const kontext = kontext2(tx, bau);
      const erste = await protokolliereAbnahme(kontext, {
        projektId: bau.projekt, ...EINGABE('2026-09-10', 'foermlich', null),
      });
      await storniereAbnahme(kontext, {
        id: erste.id, grund: 'Datum falsch protokolliert; Ersatzprotokoll folgt',
      });
      const ersatz = await protokolliereAbnahme(kontext, {
        projektId: bau.projekt, ...EINGABE('2026-09-11', 'foermlich', null),
      });
      const verbunden = await verknuepfeErsatzprotokoll(kontext, {
        storniertesId: erste.id, ersatzId: ersatz.id,
      });
      return {
        verbunden, ersatz: ersatz.id,
        liste: await listeAbnahmen(kontext, { projektId: bau.projekt }),
      };
    });

    expect(stand.verbunden).toBe(true);
    const storniert = stand.liste.find((a) => a.storniert_lokal !== null);
    expect(storniert?.ersetzt_durch_id).toBe(stand.ersatz);
    // Das Siegel des stornierten Protokolls bleibt unberührt — der Verweis
    // steht ausserhalb der eingefrorenen Spalten (kern.abnahme_einfrieren).
    expect(storniert?.snapshot_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('und verbindet NICHT, was nicht storniert ist oder zu einem anderen Projekt gehört',
    async () => {
      const bau = await baueProjekt(f.bau);
      const fremd = await baueProjekt(f.bau);
      const ergebnis = await alsApp(SCHREIBEND2(bau), async (tx) => {
        const kontext = kontext2(tx, bau);
        const lebend = await protokolliereAbnahme(kontext, {
          projektId: bau.projekt, ...EINGABE('2026-09-10', 'foermlich', null),
        });
        const andere = await protokolliereAbnahme(kontext, {
          projektId: fremd.projekt, ...EINGABE('2026-09-10', 'foermlich', null),
        });
        return {
          // Das Ziel lebt — ein Ersatz für ein gültiges Protokoll gibt es nicht.
          aufLebendes: await verknuepfeErsatzprotokoll(kontext, {
            storniertesId: lebend.id, ersatzId: andere.id,
          }),
          // Und auf sich selbst schon gar nicht.
          aufSichSelbst: await verknuepfeErsatzprotokoll(kontext, {
            storniertesId: lebend.id, ersatzId: lebend.id,
          }),
        };
      });
      expect(ergebnis.aufLebendes).toBe(false);
      expect(ergebnis.aufSichSelbst).toBe(false);
    });
});
