import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';

/**
 * Die Betroffenenanfrage und der Barrierebericht (LEG-09, LEG-07).
 *
 * **Drei Zusagen, jede mit einem Preis:**
 *
 *  1. **Die Monatsfrist ist kalendarisch und in Berliner Zeit gerechnet.**
 *     Art. 12 Abs. 3 DSGVO nennt einen MONAT, nicht dreissig Tage — im Februar
 *     sind das drei Tage Unterschied, und drei Tage entscheiden über
 *     fristgerecht. Eine generierte Spalte ginge nicht: `timestamptz +
 *     interval` ist nicht immutable, weil der Kalendertag von der Zone abhängt.
 *  2. **Der Eingangsprinzipal legt an und liest NICHT.** Eine Übernahme der
 *     öffentlichen Fläche liefert damit keinen Lesezugriff auf die Liste
 *     derer, die eine Auskunft verlangt haben — und das ist die Liste, die am
 *     meisten verrät.
 *  3. **Ein Barrierebericht braucht keine E-Mail-Adresse.** Der Meldeweg muss
 *     ohne Identifikation offen sein; ein Pflichtfeld wäre eine Hürde vor dem
 *     Weg, der Hürden melden soll.
 */

let f: Fixtur;
let bearbeiter: string;

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('dsb@anfrage.test') returning id`);
  bearbeiter = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [bearbeiter]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'dsb@anfrage.test', 'Datenschutz', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [bearbeiter]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null), true)`,
    [bearbeiter, f.reinigung]);
});
afterAll(schliessen);

function sitzung(mandantId = f.reinigung) {
  return { scope: 'mandant' as const, mandantId, benutzerId: bearbeiter,
           readonly: false, portal: 'intern' as const };
}

/** Eine Anfrage anlegen — am Portal vorbei, als Eigentümer. */
async function anfrageAnlegen(eingang: string, art = 'auskunft'): Promise<string> {
  const [z] = await alsRolle('', (tx) => tx.unsafe(
    `insert into betroffenenanfrage (mandant_id, art, name, email, eingegangen_am)
     values ($1::uuid, $2::betroffenenanfrage_art, 'Amira Said', 'amira@example.test',
             $3::timestamptz)
     returning id`, [f.reinigung, art, eingang])) as unknown as { id: string }[];
  return z!.id;
}

describe('§1 die Monatsfrist — ein Monat, kein Dreissigtagezeitraum', () => {
  it('rechnet vom 31. Januar auf den 28. Februar, nicht auf den 2. März', async () => {
    const id = await anfrageAnlegen('2026-01-31 12:00:00+01');
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select to_char(frist_am at time zone 'Europe/Berlin', 'YYYY-MM-DD') as frist
         from betroffenenanfrage where id = $1::uuid`, [id])) as unknown as { frist: string }[];
    /*
     * `+ interval '30 days'` gaebe den 2. Maerz — zwei Tage NACH der
     * gesetzlichen Frist. Genau der Fehler, den eine Aufsichtsbehoerde als
     * Fristversaeumnis zaehlt.
     */
    expect(z!.frist).toBe('2026-02-28');
  });

  it('hält die Uhrzeit über den Sommerzeitwechsel', async () => {
    /*
     * 15. Maerz + ein Monat = 15. April, und dazwischen liegt die
     * Zeitumstellung (29. Maerz 2026). „Ein Monat spaeter, 12 Uhr" heisst fuer
     * einen Juristen 12 Uhr ORTSZEIT — nicht 11 oder 13.
     */
    const id = await anfrageAnlegen('2026-03-15 12:00:00+01');
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select to_char(frist_am at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') as frist
         from betroffenenanfrage where id = $1::uuid`, [id])) as unknown as { frist: string }[];
    expect(z!.frist).toBe('2026-04-15 12:00');
  });

  it('zählt die verbleibenden Tage gegen die VERLÄNGERTE Frist, wo es eine gibt', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await alsApp(sitzung(), (tx) => tx.unsafe(
      `update betroffenenanfrage
          set verlaengert_bis = eingegangen_am + interval '3 months',
              verlaengert_grund = 'Umfangreicher Antrag ueber drei Gesellschaften.'
        where id = $1::uuid`, [id]));
    const [z] = await alsApp(sitzung(), (tx) => tx.unsafe(
      `select to_char(coalesce(verlaengert_bis, frist_am) at time zone 'Europe/Berlin',
                      'YYYY-MM-DD') as wirksam
         from betroffenenanfrage where id = $1::uuid`, [id])) as unknown as { wirksam: string }[];
    expect(z!.wirksam).toBe('2026-04-01');
  });

  it('lässt keine Verlängerung um MEHR als zwei Monate zu (Art. 12 Abs. 3 Satz 3)', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update betroffenenanfrage
          set verlaengert_bis = eingegangen_am + interval '6 months',
              verlaengert_grund = 'zu lang'
        where id = $1::uuid`, [id]))).rejects.toThrow(/hoechstens_zwei_monate/u);
  });

  it('lässt keine Verlängerung OHNE Grund zu — sie wäre unwirksam', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update betroffenenanfrage set verlaengert_bis = eingegangen_am + interval '2 months'
        where id = $1::uuid`, [id]))).rejects.toThrow(/verlaengerung_begruendet/u);
  });
});

describe('§2 eine Entscheidung trägt einen Menschen und einen Grund', () => {
  it('weist „beantwortet" ohne beides ab', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update betroffenenanfrage set status = 'beantwortet' where id = $1::uuid`, [id],
    ))).rejects.toThrow(/beantwortung_belegt/u);
  });

  it('nimmt sie mit Zeitpunkt, Mensch und Entscheidung an', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `update betroffenenanfrage
          set status = 'beantwortet', beantwortet_am = now(),
              beantwortet_von = app.aktueller_benutzer(),
              entscheidung = 'Auskunft nach Art. 15 erteilt, Kopie per E-Mail versendet.'
        where id = $1::uuid`, [id]))).resolves.toBeTruthy();
  });
});

/**
 * Die Lage des Eingangsprinzipals (03-AUTH §14.3), nachgebaut.
 *
 * Der echte steht im Seed; die Isolationsharness legt die vier Bereiche in
 * ihrer kleinsten Form an und kennt ihn nicht. Nachgebaut wird deshalb genau
 * das, was ihn ausmacht: EIN Recht, `formular.schreiben`, an DIESER
 * Gesellschaft (K-03) — und kein Datenschutzrecht.
 */
async function eingangsprinzipal(): Promise<string> {
  const email = `eingang-${String(Math.random()).slice(2, 10)}@anfrage.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, ist_dienstkonto, status)
     values ($1, $2, 'Formular-Eingang', true, 'aktiv')`, [u!.id, email]);
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, 'Formular-Eingang', 'mandant', 'intern') returning id`,
    [f.reinigung, `eingang_${String(Math.random()).slice(2, 10)}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b
      where b.schluessel = 'formular.schreiben'`, [r!.id, f.reinigung]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, $3, true)`, [u!.id, f.reinigung, r!.id]);
  return u!.id;
}

/**
 * Die Bedingung einer Policy samt allem, was sie fragt.
 *
 * Eine Policy, die ihr Praedikat in eine `app.`-Funktion legt, ist dieselbe
 * Zusage und ein anderer Text. Ein `toContain` auf `qual` allein wird daran
 * blind — nicht falsch, blind: es meldet rot, wo nichts kaputt ist, und
 * saehe umgekehrt eine echte Lockerung hinter der ersten Funktion nicht mehr.
 * Deshalb werden die Quelltexte der genannten Funktionen angehaengt, und
 * deren genannte Funktionen wieder, bis nichts Neues mehr dazukommt.
 */
async function aufgeloesteRegel(policyname: string): Promise<string> {
  const [z] = await alsRolle('', (tx) => tx.unsafe(
    `select coalesce(qual::text, '') || ' ' || coalesce(with_check::text, '') as regel
       from pg_policies
      where tablename = 'betroffenenanfrage' and policyname = $1`, [policyname],
  )) as unknown as { regel: string }[];
  expect(z?.regel, `die Policy ${policyname} steht`).toBeTruthy();

  let text = z!.regel;
  const gesehen = new Set<string>();
  for (let tiefe = 0; tiefe < 5; tiefe += 1) {
    const namen = [...text.matchAll(/app\.(\w+)\s*\(/gu)]
      .map((t) => t[1]!)
      .filter((n) => !gesehen.has(n));
    if (namen.length === 0) break;
    for (const n of namen) gesehen.add(n);
    const quellen = await alsRolle('', (tx) => tx.unsafe(
      `select p.prosrc from pg_proc p
         join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'app' and p.proname = any($1::text[])`,
      [namen] as never[],
    )) as unknown as { prosrc: string }[];
    text += `\n${quellen.map((q) => q.prosrc).join('\n')}`;
  }
  return text;
}

describe('§3 der Eingangsprinzipal legt an und liest nicht', () => {
  /*
   * Nachgebildet wird die Lage des Prinzipals: `formular.schreiben` ja,
   * `datenschutz.auskunft_erstellen` nein. Geprueft wird die POLICY, nicht der
   * Binder — der steht in `kontext/eingang.ts` und hat seinen eigenen Fall.
   */
  it('die Leseregel verlangt `datenschutz.auskunft_erstellen` — und zwei Rechte mehr',
    async () => {
      /*
       * **Die Zusage ist dieselbe, der Ort ist ein anderer.** `0220` hat die
       * beiden Policies ersetzt und das Praedikat in
       * `app.darf_betroffenenanfrage()` gelegt: dieselbe Arbeitsliste, drei
       * Zustaendigkeiten (04-SEITENKARTE §5.25), und wer EINE davon haelt,
       * sieht den Vorgang. Ein fehlendes Recht gab vorher 200 mit leerer
       * Liste statt 404 — der schlimmste der drei moeglichen Fehler (AUT-06).
       *
       * Die Liste darf also WACHSEN; `datenschutz.auskunft_erstellen` darf
       * nicht daraus verschwinden. Deshalb wird die Regel AUFGELOEST statt
       * abgelesen: die Bedingung der Policy plus die Quelltexte aller
       * `app.`-Funktionen, die darin vorkommen, transitiv. Eine
       * Indirektionsebene mehr kann diese Pruefung damit nicht mehr blind
       * machen — genau das war sie eben gewesen.
       */
      const regel = await aufgeloesteRegel('t_betroffenenanfrage_lesen');
      expect(regel).toContain('datenschutz.auskunft_erstellen');
      expect(regel).toContain('datenschutz.berichtigung_bearbeiten');
      expect(regel).toContain('datenschutz.loeschung_pruefen');
      /* Und NICHT `formular.schreiben` — das haelt der Eingang. */
      expect(regel).not.toContain('formular.schreiben');
    });

  it('und der Eingangsprinzipal schreibt wirklich und liest wirklich nichts',
    async () => {
      /*
       * **Beide Haelften an EINER Sitzung**, und in dieser Reihenfolge: erst
       * legt sie an — das beweist, dass `formular.schreiben` gebunden ist —,
       * dann liest sie ihre eigene Zeile nicht. Ohne die erste Haelfte waere
       * die zweite der klassische Fehlalarm: null Zeilen, weil die Fixtur
       * daneben lag, und niemand merkt es.
       *
       * Was der Policytext oben sagt, sagt diese Pruefung an einer Zeile, die
       * es wirklich gibt — sie haelt auch dann, wenn das Praedikat eines
       * Tages hinter einer Funktion liegt, deren Quelltext niemand mehr liest.
       */
      const eingang = await eingangsprinzipal();
      const sitzungEingang = {
        scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: eingang,
        readonly: false, portal: 'intern' as const,
      };
      const email = `eingang-${String(Math.random()).slice(2, 10)}@example.test`;
      const anlegen = (nachsatz: string) => alsApp(sitzungEingang, (tx) => tx.unsafe(
        `insert into betroffenenanfrage (mandant_id, art, name, email, eingegangen_am)
         values (app.aktiver_mandant(), 'auskunft', 'Amira Said', $1, now()) ${nachsatz}`,
        [email]));

      /*
       * **`returning id` geht NICHT, und das ist kein Nebeneffekt.** Postgres
       * prueft bei `insert … returning` zusaetzlich die SELECT-Policy — und
       * die haelt hier. Genau deshalb schreibt die oeffentliche Annahme ohne
       * `RETURNING` und erzeugt ihre Kennungen selbst (`seed/index.ts`,
       * 03-AUTH §14.3). Faellt diese Zeile, weil das Zurueckgeben ploetzlich
       * geht, hat der zum Internet offene Prinzipal einen Lesepfad bekommen.
       */
      await expect(anlegen('returning id')).rejects.toThrow(/row-level security/u);

      await expect(anlegen(''), '`formular.schreiben` traegt den Eingang')
        .resolves.toBeTruthy();
      /* Die Zeile IST da — gezaehlt am Eigentuemer, nicht am Prinzipal. */
      const [alle] = await alsRolle('', (tx) => tx.unsafe(
        `select count(*)::text as n from betroffenenanfrage where email = $1`, [email],
      )) as unknown as { n: string }[];
      expect(alle!.n, 'die Einsendung ist angekommen').toBe('1');

      const zeilen = await alsApp(sitzungEingang,
        (tx) => tx.unsafe(`select id from betroffenenanfrage`)) as unknown[];
      expect(zeilen, 'und er holt nichts zurueck').toHaveLength(0);
    });

  it('die Anlegeregel verlangt `formular.schreiben` und gibt kein Lesen', async () => {
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select with_check::text as regel, cmd from pg_policies
        where tablename = 'betroffenenanfrage' and policyname = 't_betroffenenanfrage_eingang'`,
    )) as unknown as { regel: string; cmd: string }[];
    expect(z!.cmd).toBe('INSERT');
    expect(z!.regel).toContain('formular.schreiben');
  });

  it('gelöscht wird gar nichts — auch nicht vom Eigentümer', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await expect(alsRolle('', (tx) => tx.unsafe(
      `delete from betroffenenanfrage where id = $1::uuid`, [id]))).rejects.toThrow();
  });
});

describe('§4 der Barrierebericht braucht keine Adresse', () => {
  it('nimmt eine Meldung ohne E-Mail an', async () => {
    await expect(alsRolle('', (tx) => tx.unsafe(
      `insert into barrierebericht (mandant_id, beschreibung)
       values ($1::uuid, 'Die Tabelle auf der Preisseite ist mit NVDA nicht lesbar.')`,
      [f.reinigung]))).resolves.toBeTruthy();
  });

  it('weist eine Meldung OHNE Beschreibung ab — das ist das einzige Pflichtfeld', async () => {
    await expect(alsRolle('', (tx) => tx.unsafe(
      `insert into barrierebericht (mandant_id, beschreibung, email)
       values ($1::uuid, '   ', 'jemand@example.test')`,
      [f.reinigung]))).rejects.toThrow();
  });

  it('verlangt für „behoben" einen Menschen und einen Satz', async () => {
    const [b] = await alsRolle('', (tx) => tx.unsafe(
      `insert into barrierebericht (mandant_id, beschreibung)
       values ($1::uuid, 'Kontrast auf den Hinweiskästen zu gering.') returning id`,
      [f.reinigung])) as unknown as { id: string }[];
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update barrierebericht set status = 'behoben' where id = $1::uuid`, [b!.id],
    ))).rejects.toThrow(/erledigung_belegt/u);
  });
});

describe('§5 Mandantentrennung', () => {
  it('die Security sieht die Anfragen der Reinigung nicht', async () => {
    await anfrageAnlegen('2026-01-01 12:00:00+01');
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: bearbeiter,
        readonly: true, portal: 'intern' },
      (tx) => tx.unsafe(`select id from betroffenenanfrage`),
    ) as unknown as { id: string }[];
    expect(zeilen.length).toBe(0);
  });
});
