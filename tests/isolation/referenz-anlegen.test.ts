/**
 * Eine Referenz ANLEGEN — gegen echte Policies, echte Rechte und echte
 * Auslöser (PRO-05, V-154, D-648, Invariante 3, Invariante 10).
 *
 * **Der Befund.** Es gab kein `insert into referenz` ausser im Seed. Die
 * Kundenfreigabe am Auftrag versprach „die öffentliche Referenz legt danach
 * ein Mensch unter `/website/referenzen` an" — dort gab es Bearbeiten,
 * Freigabe und Veröffentlichen einer BESTEHENDEN Zeile. Eine echte
 * Gesellschaft brachte kein einziges Projekt auf ihr Profil.
 *
 * **Die Sätze, die diese Datei beweist — jeder fällt ohne die Umsetzung:**
 *
 *  1. Anlegen erzeugt einen ENTWURF ohne Kundenfreigabe, in der Gesellschaft
 *     der Sitzung, mit dem Slug aus dem Titel (Umlaute zweistellig).
 *  2. Veröffentlichen bleibt ohne Kundenfreigabe gesperrt — und eine fremde
 *     Gesellschaft (also auch die Öffentlichkeit) sieht den Entwurf nicht.
 *  3. Ein vergebener Slug — auch der einer gelöschten Referenz — wird mit
 *     Grund abgewiesen, nicht als 23505.
 *  4. Ohne `referenz.kundenfreigabe_erfassen` entsteht NICHTS, und der Grund
 *     ist ein Satz, kein 42501.
 *  5. Titel, Slug-Form und Jahr werden wie beim Ändern geprüft.
 *  6. In der Gruppenansicht (readonly) geht kein Anlegen durch.
 *  7. Nach der Anlage lässt sich die Kundenfreigabe eintragen — der Weg, auf
 *     den die Seite danach führt.
 *  8. Der Vorschlag aus dem Auftrag nennt den BERLINER Kalendertag der
 *     Freigabe, auch in der Nacht der Zeitumstellung (Invariante 2).
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  RedaktionFehler, erfasseKundenfreigabe, ladeReferenzZurPflege, legeReferenzAn,
  listeReferenzen, setzeReferenzStatus,
} from '../../src/server/services/inhalt/redaktion.js';
import {
  freigabeGilt, ladeFreigabestand,
} from '../../src/server/services/auftrag/kundenfreigabe.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

function alsKontext(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
): SchreibKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

async function alsPflege<T>(
  mandant: string, benutzer: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, mandantIds: [mandant], benutzerId: benutzer,
      readonly: false, portal: 'intern' },
    async (tx) => fn(alsKontext(tx, mandant, benutzer)));
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function entziehe(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, false from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, recht]);
}

async function konto(mandantId: string, rolle = 'admin'): Promise<string> {
  const email = `ref-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Redaktion', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

const NEU = {
  titel: 'Grundreinigung Ärztehaus Süd', slug: null, kundeName: 'Praxisgemeinschaft Süd',
  beschreibung: 'Grundreinigung vor der Wiedereröffnung.', jahr: 2025,
} as const;

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) Anlegen erzeugt einen Entwurf ohne Kundenfreigabe', () => {
  it('in der Gesellschaft der Sitzung, mit Slug aus dem Titel', async () => {
    const admin = await konto(f.reinigung);
    const neu = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, NEU));

    expect(neu.bereich).toBe('reinigung');
    // Dieselbe Funktion wie `trg_referenz_slug`: Umlaute ZWEISTELLIG (0170).
    expect(neu.slug).toBe('grundreinigung-aerztehaus-sued');

    const [z] = await sql.unsafe<{
      mandant_id: string; status: string; freigegeben: boolean; freigabe_am: Date | null;
      kunde_name: string; jahr: number; geaendert_am: Date | null;
    }[]>(
      `select mandant_id, status::text as status, freigegeben_vom_kunden as freigegeben,
              freigabe_am, kunde_name, jahr, geaendert_am
         from referenz where id = $1`, [neu.id]);
    expect(z!.mandant_id).toBe(f.reinigung);
    expect(z!.status).toBe('entwurf');
    expect(z!.freigegeben).toBe(false);
    expect(z!.freigabe_am).toBeNull();
    expect(z!.kunde_name).toBe('Praxisgemeinschaft Süd');
    expect(z!.jahr).toBe(2025);
    // Eine frisch angelegte Zeile wurde nicht GEÄNDERT.
    expect(z!.geaendert_am).toBeNull();

    const liste = await alsPflege(f.reinigung, admin, (k) => listeReferenzen(k));
    expect(liste.map((r) => r.id)).toContain(neu.id);
  });

  it('ein mitgegebener Slug bleibt, wie er ist — und leere Felder werden null', async () => {
    const admin = await konto(f.bau);
    const neu = await alsPflege(f.bau, admin, (k) => legeReferenzAn(k, {
      titel: 'Rohbau Lagerhalle', slug: 'Halle-Nord', kundeName: '  ', beschreibung: '',
      jahr: null,
    }));
    expect(neu.slug).toBe('halle-nord');
    const d = await alsPflege(f.bau, admin, (k) => ladeReferenzZurPflege(k, neu.id));
    expect(d!.kundeName).toBeNull();
    expect(d!.beschreibung).toBeNull();
    expect(d!.jahr).toBeNull();
  });
});

describe('(2) Veröffentlichen bleibt ohne Kundenfreigabe gesperrt', () => {
  it('der Dienst weist ab, und eine fremde Gesellschaft sieht den Entwurf nicht', async () => {
    const admin = await konto(f.reinigung);
    const neu = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, NEU));

    const fehler = await alsPflege(f.reinigung, admin,
      (k) => setzeReferenzStatus(k, neu.id, true)).catch((e: unknown) => e);
    expect((fehler as RedaktionFehler).grund).toBe('ohne_kundenfreigabe');

    /*
     * `t_referenz_oeffentlich` lässt eine Referenz nur mit Freigabe UND im
     * veröffentlichten Stand durch — für jede Sitzung, die sie nicht über
     * ihre eigene Gesellschaft pflegt. Eine Sitzung von BAU steht hier für
     * jeden Leser ausserhalb der Reinigung, die Öffentlichkeit eingeschlossen.
     */
    const adminB = await konto(f.bau);
    const fremd = await alsPflege(f.bau, adminB, (k) => k.abfrage<{ id: string }>(
      `select id from referenz where id = $1`, [neu.id]));
    expect(fremd).toEqual([]);
  });
});

describe('(3) Der Slug ist je Gesellschaft eindeutig — auch beim Anlegen', () => {
  it('derselbe Titel ein zweites Mal wird mit Grund abgewiesen, nicht als 23505', async () => {
    const admin = await konto(f.reinigung);
    await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, NEU));
    const fehler = await alsPflege(f.reinigung, admin,
      (k) => legeReferenzAn(k, NEU)).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(RedaktionFehler);
    expect((fehler as RedaktionFehler).grund).toBe('slug_vergeben');
  });

  it('auch der Slug einer GELÖSCHTEN Referenz ist belegt (Invariante 8)', async () => {
    const admin = await konto(f.reinigung);
    const alt = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, NEU));
    await sql.unsafe(`update referenz set geloescht_am = now() where id = $1`, [alt.id]);
    const fehler = await alsPflege(f.reinigung, admin,
      (k) => legeReferenzAn(k, NEU)).catch((e: unknown) => e);
    expect((fehler as RedaktionFehler).grund).toBe('slug_vergeben');
  });

  it('in einer ANDEREN Gesellschaft ist derselbe Slug frei', async () => {
    const adminR = await konto(f.reinigung);
    const adminS = await konto(f.security);
    await alsPflege(f.reinigung, adminR, (k) => legeReferenzAn(k, NEU));
    const s = await alsPflege(f.security, adminS, (k) => legeReferenzAn(k, NEU));
    expect(s.bereich).toBe('security');
    expect(s.slug).toBe('grundreinigung-aerztehaus-sued');
  });
});

describe('(4) Ohne referenz.kundenfreigabe_erfassen entsteht nichts', () => {
  it('der Grund ist ein Satz — und die Tabelle bleibt leer', async () => {
    await entziehe('admin', 'referenz.kundenfreigabe_erfassen', f.security);
    const admin = await konto(f.security);
    const fehler = await alsPflege(f.security, admin,
      (k) => legeReferenzAn(k, NEU)).catch((e: unknown) => e);
    expect((fehler as RedaktionFehler).grund).toBe('kein_freigaberecht');
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*) as n from referenz where mandant_id = $1`, [f.security]);
    expect(Number(z!.n)).toBe(0);
  });
});

describe('(5) Dieselben Feldprüfungen wie beim Ändern', () => {
  it('ohne Titel, mit krummem Slug, mit Jahr ausserhalb — je ein Grund', async () => {
    const admin = await konto(f.reinigung);
    const grund = async (felder: Parameters<typeof legeReferenzAn>[1]): Promise<string> =>
      ((await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, felder))
        .catch((e: unknown) => e)) as RedaktionFehler).grund;
    expect(await grund({ ...NEU, titel: '   ' })).toBe('titel_fehlt');
    expect(await grund({ ...NEU, slug: 'zwei--striche' })).toBe('slug_form');
    expect(await grund({ ...NEU, slug: 'mit leerzeichen' })).toBe('slug_form');
    expect(await grund({ ...NEU, jahr: 1989 })).toBe('jahr_ungueltig');
    expect(await grund({ ...NEU, jahr: 2101 })).toBe('jahr_ungueltig');
  });
});

describe('(6) Die Gruppenansicht legt nichts an (Invariante 10)', () => {
  it('eine lesende Sitzung scheitert an der Policy', async () => {
    const admin = await konto(f.reinigung);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
        benutzerId: admin, readonly: true, portal: 'intern' },
      async (tx) => legeReferenzAn(alsKontext(tx, f.reinigung, admin), NEU),
    )).rejects.toThrow(/row-level security/u);
    const [z] = await sql.unsafe<{ n: string }[]>(`select count(*) as n from referenz`);
    expect(Number(z!.n)).toBe(0);
  });
});

describe('(7) Der nächste Schritt: die Kundenfreigabe an der neuen Zeile', () => {
  it('lässt sich eintragen — und erst DANACH wäre Veröffentlichen erlaubt', async () => {
    const admin = await konto(f.reinigung);
    const neu = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, NEU));
    await alsPflege(f.reinigung, admin, (k) => erfasseKundenfreigabe(k, neu.id, {
      freigegeben: true, am: '2026-03-29', beleg: 'Kundenfreigabe am Auftrag AU-1.',
    }));
    const d = await alsPflege(f.reinigung, admin, (k) => ladeReferenzZurPflege(k, neu.id));
    expect(d!.freigegeben).toBe(true);
    expect(d!.status).toBe('entwurf');
  });
});

describe('(8) Der Vorschlag aus dem Auftrag nennt den Berliner Tag (Invariante 2)', () => {
  /**
   * Eine Auftragsfreigabe um 00:30 Berliner Zeit am 29. März 2026 — der Nacht
   * der Zeitumstellung — liegt in UTC am 28. März, 23:30. Die Referenz, die
   * aus diesem Auftrag angelegt wird, soll als Datum ihrer eigenen Freigabe
   * den 29. vorschlagen. Aus dem UTC-Tag geschnitten stünde dort der 28.
   *
   * Die Fixtur baut den Auftrag als Eigentümer mit abgeschalteten Auslösern:
   * sie stellt einen ZUSTAND her und prüft nicht den Weg dorthin (der steht
   * in `vertrieb-uebergaenge.test.ts`).
   */
  it('freigabe_tag ist der Kalendertag in Europe/Berlin — und freigabeGilt ehrt den Widerruf',
    async () => {
      const admin = await konto(f.reinigung);
      const { auftragId } = await sql.begin(async (tx) => {
        await tx.unsafe(`set local session_replication_role = replica`);
        const [k] = await tx.unsafe<{ id: string }[]>(
          `insert into kunde (mandant_id, kundennummer, name) values ($1, $2, 'Ärztehaus Süd')
           returning id`, [f.reinigung, `K-${zufall()}`]);
        const [ap] = await tx.unsafe<{ id: string }[]>(
          `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname)
           values ($1, $2, 'Kim', 'Weber') returning id`, [f.reinigung, k!.id]);
        const [d] = await tx.unsafe<{ id: string }[]>(
          `insert into dokument
             (mandant_id, kategorie, titel, kunde_id, bucket, objekt_schluessel, mime_typ,
              mime_verifiziert, groesse_bytes, exif_entfernt, entstanden_am)
           values ($1, 'kunde', 'Zustimmung Referenz', $2, 'dokumente', $3,
                   'application/pdf', true, 1024, true, current_date)
           returning id`, [f.reinigung, k!.id, `t/${zufall()}.pdf`]);
        const [a] = await tx.unsafe<{ id: string }[]>(
          `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                                verantwortlich_benutzer_id, start_datum, status,
                                freigegeben_vom_kunden, freigabe_am, freigabe_text,
                                freigabe_durch_ansprechpartner_id, freigabe_dokument_id)
           values ($1, $2, $3, 'rahmenvertrag', 'Grundreinigung Ärztehaus', $4,
                   current_date, 'aktiv', true, '2026-03-28T23:30:00Z',
                   'Sie dürfen uns als Referenz nennen.', $5, $6)
           returning id`,
          [f.reinigung, `AU-${zufall()}`, k!.id, admin, ap!.id, d!.id]);
        return { auftragId: a!.id };
      }) as { auftragId: string };

      const stand = await alsPflege(f.reinigung, admin,
        (k) => ladeFreigabestand(k, auftragId));
      expect(stand).not.toBeNull();
      expect(stand!.freigabe_tag).toBe('2026-03-29');
      expect(stand!.freigabe_am).toBe('29.03.2026 00:30');
      expect(freigabeGilt(stand!)).toBe(true);

      await sql.begin(async (tx) => {
        await tx.unsafe(`set local session_replication_role = replica`);
        await tx.unsafe(
          `update auftrag set freigabe_widerrufen_am = now() where id = $1`, [auftragId]);
      });
      const widerrufen = await alsPflege(f.reinigung, admin,
        (k) => ladeFreigabestand(k, auftragId));
      // Nach dem Widerruf bleibt `freigegeben_vom_kunden` stehen — und gilt nicht.
      expect(widerrufen!.freigegeben).toBe(true);
      expect(freigabeGilt(widerrufen!)).toBe(false);
    });
});
