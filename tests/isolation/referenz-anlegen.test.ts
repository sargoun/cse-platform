/**
 * Eine Referenz ANLEGEN — gegen echte Policies, echte Rechte und echte
 * Auslöser (PRO-05, V-154, V-161, D-648, D-654, Invariante 3, Invariante 10).
 *
 * **Der Befund.** Es gab kein `insert into referenz` ausser im Seed. Die
 * Kundenfreigabe am Auftrag versprach „die öffentliche Referenz legt danach
 * ein Mensch unter `/website/referenzen` an" — dort gab es Bearbeiten,
 * Freigabe und Veröffentlichen einer BESTEHENDEN Zeile. V-154 baute das
 * Anlegen, aber frei; SPEC PRO-05 sagt „a reference is a completed `auftrag`
 * with customer release on file, not a marketing entry typed by hand" (V-161).
 *
 * **Die Sätze, die diese Datei beweist — jeder fällt ohne die Umsetzung:**
 *
 *  1. Anlegen erzeugt einen ENTWURF ohne Kundenfreigabe, in der Gesellschaft
 *     der Sitzung, mit dem Slug aus dem Titel (Umlaute zweistellig) — und
 *     hält fest, aus welchem Auftrag er stammt.
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
 *  9. Die Herkunft wird GEPRÜFT: ohne Auftrag, mit fremdem oder unlesbarem
 *     Auftrag, ohne geltende Freigabe und aus einem laufenden oder
 *     stornierten Auftrag entsteht nichts — je mit eigenem Grund.
 * 10. Derselbe Auftrag unter derselben Adresse ist dieselbe Referenz: ein
 *     zweiter POST (Doppelklick) legt nichts an und nennt die vorhandene.
 * 11. Die Datenbank hält die Herkunft: kein fremder Auftrag (Fremdschlüssel
 *     über die Gesellschaft), kein Umhängen nach dem Anlegen.
 * 12. Die Wahl unter `/neu` trennt bereit und laufend mit derselben Regel.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  RedaktionFehler, erfasseKundenfreigabe, ladeReferenzZurPflege, legeReferenzAn,
  listeReferenzen, referenzenAusAuftrag, setzeReferenzStatus, slugIstVergeben,
  type NeueReferenz,
} from '../../src/server/services/inhalt/redaktion.js';
import {
  freigabeGilt, ladeFreigabestand, listeAuftraegeMitFreigabe, referenzHindernis,
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

interface AuftragsZustand {
  readonly status?: 'angelegt' | 'aktiv' | 'pausiert' | 'abgeschlossen' | 'storniert';
  readonly freigegeben?: boolean;
  readonly widerrufen?: boolean;
  /** Der Zeitpunkt der Kundenfreigabe (UTC). */
  readonly freigabeAm?: string;
}

/**
 * Ein Auftrag im gewünschten ZUSTAND — als Eigentümer mit abgeschalteten
 * Auslösern: die Fixtur stellt einen Zustand her und prüft nicht den Weg
 * dorthin (Freigabe: `vertrieb-uebergaenge.test.ts`, Abschluss:
 * `auftrag-abschluss.test.ts`). Die CHECKs der Tabelle gelten trotzdem —
 * eine Freigabe braucht Datum, Ansprechpartner und Schreiben, ein Abschluss
 * sein Datum.
 */
async function auftrag(
  mandant: string, verantwortlich: string, zustand: AuftragsZustand = {},
): Promise<string> {
  const status = zustand.status ?? 'abgeschlossen';
  const freigegeben = zustand.freigegeben ?? true;
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    const [k] = await tx.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name) values ($1, $2, 'Ärztehaus Süd')
       returning id`, [mandant, `K-${zufall()}`]);
    const [ap] = await tx.unsafe<{ id: string }[]>(
      `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname)
       values ($1, $2, 'Kim', 'Weber') returning id`, [mandant, k!.id]);
    const [d] = await tx.unsafe<{ id: string }[]>(
      `insert into dokument
         (mandant_id, kategorie, titel, kunde_id, bucket, objekt_schluessel, mime_typ,
          mime_verifiziert, groesse_bytes, exif_entfernt, entstanden_am)
       values ($1, 'kunde', 'Zustimmung Referenz', $2, 'dokumente', $3,
               'application/pdf', true, 1024, true, current_date)
       returning id`, [mandant, k!.id, `t/${zufall()}.pdf`]);
    const [a] = await tx.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                            verantwortlich_benutzer_id, start_datum, status, status_grund,
                            abgeschlossen_am, freigegeben_vom_kunden, freigabe_am,
                            freigabe_text, freigabe_durch_ansprechpartner_id,
                            freigabe_dokument_id, freigabe_widerrufen_am)
       values ($1, $2, $3, 'rahmenvertrag', 'Grundreinigung Ärztehaus Süd', $4,
               '2025-01-06', $5::text::auftrag_status,
               case when $5::text in ('pausiert', 'storniert') then 'Fixtur' end,
               case when $5::text = 'abgeschlossen' then now() end,
               $6, case when $6 then $7::timestamptz end,
               case when $6 then 'Sie dürfen uns als Referenz nennen.' end,
               case when $6 then $8::uuid end, case when $6 then $9::uuid end,
               case when $10 then now() end)
       returning id`,
      [mandant, `AU-${zufall()}`, k!.id, verantwortlich, status, freigegeben,
       zustand.freigabeAm ?? '2026-03-28T23:30:00Z', ap!.id, d!.id,
       zustand.widerrufen ?? false] as never[]);
    return a!.id;
  }) as Promise<string>;
}

const NEU = {
  titel: 'Grundreinigung Ärztehaus Süd', slug: null, kundeName: 'Praxisgemeinschaft Süd',
  beschreibung: 'Grundreinigung vor der Wiedereröffnung.', jahr: 2025,
} as const;

/** Die Eingabe mit einem Auftrag — der Regelfall seit V-161. */
const aus = (auftragId: string, mehr: Partial<NeueReferenz> = {}): NeueReferenz =>
  ({ ...NEU, auftragId, ...mehr });

async function grundVon(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(RedaktionFehler);
  return (e as RedaktionFehler).grund;
}

async function anzahlReferenzen(mandant: string): Promise<number> {
  const [z] = await sql.unsafe<{ n: string }[]>(
    `select count(*) as n from referenz where mandant_id = $1`, [mandant]);
  return Number(z!.n);
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) Anlegen erzeugt einen Entwurf ohne Kundenfreigabe — mit Herkunft', () => {
  it('in der Gesellschaft der Sitzung, mit Slug aus dem Titel und dem Auftrag', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const neu = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, aus(a)));

    expect(neu.bereich).toBe('reinigung');
    expect(neu.vorhanden).toBe(false);
    // Dieselbe Funktion wie `trg_referenz_slug`: Umlaute ZWEISTELLIG (0170).
    expect(neu.slug).toBe('grundreinigung-aerztehaus-sued');

    const [z] = await sql.unsafe<{
      mandant_id: string; status: string; freigegeben: boolean; freigabe_am: Date | null;
      kunde_name: string; jahr: number; geaendert_am: Date | null; auftrag_id: string;
    }[]>(
      `select mandant_id, status::text as status, freigegeben_vom_kunden as freigegeben,
              freigabe_am, kunde_name, jahr, geaendert_am, auftrag_id
         from referenz where id = $1`, [neu.id]);
    expect(z!.mandant_id).toBe(f.reinigung);
    expect(z!.status).toBe('entwurf');
    expect(z!.freigegeben).toBe(false);
    expect(z!.freigabe_am).toBeNull();
    expect(z!.kunde_name).toBe('Praxisgemeinschaft Süd');
    expect(z!.jahr).toBe(2025);
    // Eine frisch angelegte Zeile wurde nicht GEÄNDERT.
    expect(z!.geaendert_am).toBeNull();
    // Die Herkunft steht in der Zeile (0410) — nicht in einer Adresse.
    expect(z!.auftrag_id).toBe(a);

    const liste = await alsPflege(f.reinigung, admin, (k) => listeReferenzen(k));
    expect(liste.map((r) => r.id)).toContain(neu.id);
    const detail = await alsPflege(f.reinigung, admin, (k) => ladeReferenzZurPflege(k, neu.id));
    expect(detail!.auftragId).toBe(a);
  });

  it('ein mitgegebener Slug bleibt, wie er ist — und leere Felder werden null', async () => {
    const admin = await konto(f.bau);
    const a = await auftrag(f.bau, admin);
    const neu = await alsPflege(f.bau, admin, (k) => legeReferenzAn(k, aus(a, {
      titel: 'Rohbau Lagerhalle', slug: 'Halle-Nord', kundeName: '  ', beschreibung: '',
      jahr: null,
    })));
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
    const a = await auftrag(f.reinigung, admin);
    const neu = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, aus(a)));

    expect(await grundVon(alsPflege(f.reinigung, admin,
      (k) => setzeReferenzStatus(k, neu.id, true)))).toBe('ohne_kundenfreigabe');

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
  it('derselbe Titel aus einem ANDEREN Auftrag wird mit Grund abgewiesen, nicht als 23505',
    async () => {
      const admin = await konto(f.reinigung);
      const erster = await auftrag(f.reinigung, admin);
      const zweiter = await auftrag(f.reinigung, admin);
      await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, aus(erster)));
      expect(await grundVon(alsPflege(f.reinigung, admin,
        (k) => legeReferenzAn(k, aus(zweiter))))).toBe('slug_vergeben');
    });

  it('auch der Slug einer GELÖSCHTEN Referenz ist belegt (Invariante 8)', async () => {
    const admin = await konto(f.reinigung);
    const erster = await auftrag(f.reinigung, admin);
    const alt = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, aus(erster)));
    await sql.unsafe(`update referenz set geloescht_am = now() where id = $1`, [alt.id]);
    // Auch aus DEMSELBEN Auftrag: eine gelöschte Referenz ist nicht „die vorhandene".
    expect(await grundVon(alsPflege(f.reinigung, admin,
      (k) => legeReferenzAn(k, aus(erster))))).toBe('slug_vergeben');
    expect(await alsPflege(f.reinigung, admin,
      (k) => slugIstVergeben(k, alt.slug))).toBe(true);
  });

  it('in einer ANDEREN Gesellschaft ist derselbe Slug frei', async () => {
    const adminR = await konto(f.reinigung);
    const adminS = await konto(f.security);
    await alsPflege(f.reinigung, adminR,
      async (k) => legeReferenzAn(k, aus(await auftrag(f.reinigung, adminR))));
    const aS = await auftrag(f.security, adminS);
    const s = await alsPflege(f.security, adminS, (k) => legeReferenzAn(k, aus(aS)));
    expect(s.bereich).toBe('security');
    expect(s.slug).toBe('grundreinigung-aerztehaus-sued');
  });
});

describe('(4) Ohne referenz.kundenfreigabe_erfassen entsteht nichts', () => {
  it('der Grund ist ein Satz — und die Tabelle bleibt leer', async () => {
    await entziehe('admin', 'referenz.kundenfreigabe_erfassen', f.security);
    const admin = await konto(f.security);
    const a = await auftrag(f.security, admin);
    expect(await grundVon(alsPflege(f.security, admin,
      (k) => legeReferenzAn(k, aus(a))))).toBe('kein_freigaberecht');
    expect(await anzahlReferenzen(f.security)).toBe(0);
  });
});

describe('(5) Dieselben Feldprüfungen wie beim Ändern', () => {
  it('ohne Titel, mit krummem Slug, mit Jahr ausserhalb — je ein Grund', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const grund = async (mehr: Partial<NeueReferenz>): Promise<string> =>
      grundVon(alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, aus(a, mehr))));
    expect(await grund({ titel: '   ' })).toBe('titel_fehlt');
    expect(await grund({ slug: 'zwei--striche' })).toBe('slug_form');
    expect(await grund({ slug: 'mit leerzeichen' })).toBe('slug_form');
    expect(await grund({ jahr: 1989 })).toBe('jahr_ungueltig');
    expect(await grund({ jahr: 2101 })).toBe('jahr_ungueltig');
  });
});

describe('(6) Die Gruppenansicht legt nichts an (Invariante 10)', () => {
  it('eine lesende Sitzung scheitert an der Policy', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
        benutzerId: admin, readonly: true, portal: 'intern' },
      async (tx) => legeReferenzAn(alsKontext(tx, f.reinigung, admin), aus(a)),
    )).rejects.toThrow(/row-level security/u);
    const [z] = await sql.unsafe<{ n: string }[]>(`select count(*) as n from referenz`);
    expect(Number(z!.n)).toBe(0);
  });
});

describe('(7) Der nächste Schritt: die Kundenfreigabe an der neuen Zeile', () => {
  it('lässt sich eintragen — und erst DANACH wäre Veröffentlichen erlaubt', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const neu = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, aus(a)));
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
   */
  it('freigabe_tag ist der Kalendertag in Europe/Berlin — und freigabeGilt ehrt den Widerruf',
    async () => {
      const admin = await konto(f.reinigung);
      const auftragId = await auftrag(f.reinigung, admin, { status: 'aktiv' });

      const stand = await alsPflege(f.reinigung, admin,
        (k) => ladeFreigabestand(k, auftragId));
      expect(stand).not.toBeNull();
      expect(stand!.freigabe_tag).toBe('2026-03-29');
      expect(stand!.freigabe_am).toBe('29.03.2026 00:30');
      expect(stand!.status).toBe('aktiv');
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

describe('(9) Die Herkunft wird geprüft — PRO-05: ein abgeschlossener Auftrag mit Freigabe', () => {
  it('ohne Auftrag, mit Unsinn und mit unbekanntem Auftrag: auftrag_fehlt', async () => {
    const admin = await konto(f.reinigung);
    for (const auftragId of ['', 'kein-auftrag', '3f2a8c1e-0b7d-4e59-9a61-2d4c8e7f1a0b']) {
      expect(await grundVon(alsPflege(f.reinigung, admin,
        (k) => legeReferenzAn(k, aus(auftragId)))), auftragId).toBe('auftrag_fehlt');
    }
    expect(await anzahlReferenzen(f.reinigung)).toBe(0);
  });

  it('ein Auftrag einer ANDEREN Gesellschaft ist hier keiner', async () => {
    const admin = await konto(f.reinigung);
    const imBau = await konto(f.bau);
    const fremd = await auftrag(f.bau, imBau);
    expect(await grundVon(alsPflege(f.reinigung, admin,
      (k) => legeReferenzAn(k, aus(fremd))))).toBe('auftrag_fehlt');
    expect(await anzahlReferenzen(f.reinigung)).toBe(0);
  });

  it('ohne auftrag.lesen ist der Auftrag nicht lesbar — und es entsteht nichts', async () => {
    await entziehe('admin', 'auftrag.lesen', f.reinigung);
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    expect(await grundVon(alsPflege(f.reinigung, admin,
      (k) => legeReferenzAn(k, aus(a))))).toBe('auftrag_fehlt');
    expect(await anzahlReferenzen(f.reinigung)).toBe(0);
  });

  it('ohne Freigabe und nach einem Widerruf: auftrag_ohne_freigabe', async () => {
    const admin = await konto(f.reinigung);
    const ohne = await auftrag(f.reinigung, admin, { freigegeben: false });
    const widerrufen = await auftrag(f.reinigung, admin, { widerrufen: true });
    for (const a of [ohne, widerrufen]) {
      expect(await grundVon(alsPflege(f.reinigung, admin,
        (k) => legeReferenzAn(k, aus(a))))).toBe('auftrag_ohne_freigabe');
    }
    expect(await anzahlReferenzen(f.reinigung)).toBe(0);
  });

  it('ein laufender, ruhender oder nicht begonnener Auftrag: auftrag_offen (O-914)', async () => {
    const admin = await konto(f.reinigung);
    for (const status of ['angelegt', 'aktiv', 'pausiert'] as const) {
      const a = await auftrag(f.reinigung, admin, { status });
      expect(await grundVon(alsPflege(f.reinigung, admin,
        (k) => legeReferenzAn(k, aus(a)))), status).toBe('auftrag_offen');
    }
    expect(await anzahlReferenzen(f.reinigung)).toBe(0);
  });

  it('ein stornierter Auftrag ist kein „noch nicht", sondern ein „nie"', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin, { status: 'storniert' });
    expect(await grundVon(alsPflege(f.reinigung, admin,
      (k) => legeReferenzAn(k, aus(a))))).toBe('auftrag_storniert');
    expect(await anzahlReferenzen(f.reinigung)).toBe(0);
  });
});

describe('(10) Derselbe Auftrag unter derselben Adresse ist dieselbe Referenz', () => {
  it('ein zweiter POST (Doppelklick) legt nichts an und nennt die vorhandene', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const erst = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, aus(a)));
    const noch = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, aus(a)));
    expect(noch.vorhanden).toBe(true);
    expect(noch.id).toBe(erst.id);
    expect(noch.bereich).toBe('reinigung');
    expect(await anzahlReferenzen(f.reinigung)).toBe(1);
  });

  it('eine ZWEITE Referenz aus demselben Auftrag entsteht unter eigener Adresse', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const erst = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, aus(a)));
    const zweite = await alsPflege(f.reinigung, admin,
      (k) => legeReferenzAn(k, aus(a, { titel: 'Glasreinigung Ärztehaus Süd' })));
    expect(zweite.vorhanden).toBe(false);
    expect(zweite.id).not.toBe(erst.id);
    const aufgezaehlt = await alsPflege(f.reinigung, admin, (k) => referenzenAusAuftrag(k, a));
    expect(aufgezaehlt.map((r) => r.id)).toEqual([erst.id, zweite.id]);
    const stand = await alsPflege(f.reinigung, admin, (k) => ladeFreigabestand(k, a));
    expect(stand!.referenzen_aus_auftrag).toBe('2');
  });
});

describe('(11) Die Datenbank hält die Herkunft', () => {
  it('kein Auftrag einer fremden Gesellschaft — auch nicht an der Dienstprüfung vorbei',
    async () => {
      const admin = await konto(f.reinigung);
      const imBau = await konto(f.bau);
      const fremd = await auftrag(f.bau, imBau);
      await expect(alsPflege(f.reinigung, admin, (k) => k.schreibe(
        `insert into referenz (mandant_id, auftrag_id, titel, slug, freigegeben_vom_kunden)
         values (app.aktiver_mandant(), $1::uuid, 'Fremd', 'fremd', false)`, [fremd])))
        .rejects.toThrow(/referenz_auftrag_fk/u);
    });

  it('die Herkunft lässt sich nach dem Anlegen nicht umhängen', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const b = await auftrag(f.reinigung, admin);
    const neu = await alsPflege(f.reinigung, admin, (k) => legeReferenzAn(k, aus(a)));
    await expect(alsPflege(f.reinigung, admin, (k) => k.schreibe(
      `update referenz set auftrag_id = $2::uuid where id = $1::uuid`, [neu.id, b])))
      .rejects.toThrow(/Herkunft einer Referenz/u);
    await expect(sql.unsafe(
      `update referenz set auftrag_id = null where id = $1`, [neu.id]))
      .rejects.toThrow(/Herkunft einer Referenz/u);
    // Jede andere Änderung läuft durch — der Auslöser hängt nur an der Herkunft.
    await sql.unsafe(`update referenz set titel = 'Umbenannt' where id = $1`, [neu.id]);
    const [z] = await sql.unsafe<{ auftrag_id: string; titel: string }[]>(
      `select auftrag_id, titel from referenz where id = $1`, [neu.id]);
    expect(z!.auftrag_id).toBe(a);
    expect(z!.titel).toBe('Umbenannt');
  });
});

describe('(12) Die Wahl unter /neu: bereit und laufend mit derselben Regel', () => {
  it('nur geltende Freigaben dieser Gesellschaft — getrennt nach Abschluss', async () => {
    const admin = await konto(f.reinigung);
    const bereit = await auftrag(f.reinigung, admin);
    const laufend = await auftrag(f.reinigung, admin, { status: 'aktiv' });
    const storniert = await auftrag(f.reinigung, admin, { status: 'storniert' });
    await auftrag(f.reinigung, admin, { freigegeben: false });
    await auftrag(f.reinigung, admin, { widerrufen: true });
    const imBau = await konto(f.bau);
    await auftrag(f.bau, imBau);

    const liste = await alsPflege(f.reinigung, admin, (k) => listeAuftraegeMitFreigabe(k));
    expect(liste.map((a) => a.auftrag_id).sort()).toEqual([bereit, laufend, storniert].sort());
    const nachHindernis = Object.fromEntries(
      liste.map((a) => [a.auftrag_id, referenzHindernis(a)]));
    expect(nachHindernis[bereit]).toBeNull();
    expect(nachHindernis[laufend]).toBe('nicht_abgeschlossen');
    expect(nachHindernis[storniert]).toBe('storniert');
    const zeile = liste.find((a) => a.auftrag_id === bereit);
    expect(zeile!.abgeschlossen_am).toMatch(/^\d{2}\.\d{2}\.\d{4}$/u);
    expect(zeile!.referenzen).toBe(0);
  });
});
