import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  AnfrageFehler, entscheide, fordereIdentitaetsnachweis, identitaetGeklaert, lade, liste,
} from '../../src/server/services/datenschutz/anfrage.js';

/**
 * **Der Identitätszweifel bekommt einen Erzeuger** (V-088, Art. 12 Abs. 6).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `betroffenenanfrage_status` kennt `identitaet_offen` seit `0176`, der
 * Fristindex zählt ihn zu den offenen Zuständen, zwei Oberflächen beschriften
 * ihn — **und kein Weg setzte ihn**. Wer an der Identität eines Antragstellers
 * zweifelte, hatte die Wahl zwischen „in Bearbeitung" (was nicht stimmt) und
 * „abgelehnt" (was zu früh wäre).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das gegen eine echte Datenbank gehört.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die halbe Zusage steht in zwei CHECKs, die nur Postgres kennt: kein
 * Zeitpunkt ohne Grund, und kein `identitaet_offen` ohne Zeitpunkt. Ein Mock
 * sagte zu beidem ja. Und die dritte Zusage — **die Monatsfrist läuft weiter**
 * (O-903) — lässt sich überhaupt nur an der Zeile prüfen, die die
 * Fälligkeitsliste danach immer noch ausgibt.
 */

let f: Fixtur;
let dsb = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

const GRUND = 'Der Antrag kam von einer Adresse, die im Konto nicht hinterlegt '
  + 'ist, und nennt weder Kundennummer noch Objekt.';

beforeAll(async () => {
  f = await seed();
  const email = `identitaet-${zufall()}@anfrage.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  dsb = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [dsb]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Datenschutz', 'aktiv')`,
    [dsb, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = 'admin' and mandant_id is null), true)`,
    [dsb, f.reinigung]);
  /*
   * `datenschutz.auskunft_erstellen` ist eines der drei Rechte, die
   * `app.darf_betroffenenanfrage()` (0220) gelten lässt. Ohne es gäbe die
   * Policy null Zeilen zurück — und jede Zusicherung unten wäre aus dem
   * falschen Grund grün.
   */
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'admin' and mandant_id is null),
             (select id from berechtigung where schluessel = 'datenschutz.auskunft_erstellen'),
             $1, true)
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
    [f.reinigung]);
});
afterAll(schliessen);

function imKontext<T>(
  fn: (k: LeseKontext & SchreibKontext) => Promise<T>,
  o: { readonly readonly?: boolean; readonly mandantId?: string } = {},
): Promise<T> {
  const mandantId = o.mandantId ?? f.reinigung;
  return alsApp(
    {
      scope: 'mandant' as const, mandantId, benutzerId: dsb,
      portal: 'intern' as const, readonly: o.readonly ?? false,
    },
    async (tx: postgres.TransactionSql) => {
      const lauf = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: dsb,
        aktiverMandantId: mandantId, mandantIds: [mandantId],
        abfrage: lauf, schreibe: lauf,
      } satisfies LeseKontext & SchreibKontext);
    },
  ) as Promise<T>;
}

/** Eine Anfrage anlegen — am Portal vorbei, als Eigentümer. */
async function anfrage(
  status = 'neu', mandantId?: string, vorTagen = 3,
): Promise<string> {
  const [z] = await alsRolle('', (tx) => tx.unsafe(
    `insert into betroffenenanfrage
       (mandant_id, art, status, name, email, eingegangen_am)
     values ($1::uuid, 'auskunft', $2::betroffenenanfrage_status, 'Grete Lindqvist',
             $3, now() - ($4 || ' days')::interval)
     returning id`,
    [mandantId ?? f.reinigung, status, `g-${zufall()}@example.test`, String(vorTagen)],
  )) as unknown as { id: string }[];
  return z!.id;
}

interface Roh {
  readonly status: string;
  readonly angefordert: string | null;
  readonly grund: string | null;
  readonly frist: string;
}

/** Der Rohzustand, am EIGENTÜMER gelesen — nicht durch die Policy hindurch. */
async function roh(id: string): Promise<Roh> {
  const [z] = await alsRolle('', (tx) => tx.unsafe(
    `select status::text as status,
            to_char(identitaet_angefordert_am at time zone 'Europe/Berlin',
                    'YYYY-MM-DD HH24:MI') as angefordert,
            identitaet_grund as grund,
            to_char(frist_am at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') as frist
       from betroffenenanfrage where id = $1::uuid`, [id])) as unknown as Roh[];
  return z!;
}

describe('§1 die Nachfrage setzt den Zustand — und ihren Grund', () => {
  it('schreibt Zustand, Zeitpunkt und Grund in EINEM Zug', async () => {
    const id = await anfrage();
    await imKontext((k) => fordereIdentitaetsnachweis(k, id, GRUND));
    const z = await roh(id);
    expect(z.status).toBe('identitaet_offen');
    expect(z.angefordert, 'der Zeitpunkt steht').not.toBeNull();
    expect(z.grund).toBe(GRUND);
  });

  it('geht auch aus „in Bearbeitung" — der Zweifel kommt oft erst beim Lesen',
    async () => {
      const id = await anfrage('in_bearbeitung');
      await imKontext((k) => fordereIdentitaetsnachweis(k, id, GRUND));
      expect((await roh(id)).status).toBe('identitaet_offen');
    });

  it('schneidet den Grund zu — ein Feld mit zwei Leerzeichen ist kein Grund', async () => {
    const id = await anfrage();
    await imKontext((k) => fordereIdentitaetsnachweis(k, id, `  ${GRUND}  `));
    expect((await roh(id)).grund).toBe(GRUND);
  });

  it('weist eine Nachfrage OHNE Grund ab — und schreibt nichts', async () => {
    const id = await anfrage();
    /*
     * Art. 12 Abs. 6 erlaubt die Nachfrage nur bei BEGRÜNDETEN Zweifeln. Wer
     * nachfragt, verarbeitet dafür weitere Daten — eine Ausweiskopie ist mehr,
     * als das Auskunftsersuchen selbst enthält.
     */
    await expect(imKontext((k) => fordereIdentitaetsnachweis(k, id, '   ')))
      .rejects.toThrow(AnfrageFehler);
    const z = await roh(id);
    expect(z.status, 'der Zustand bleibt, wo er war').toBe('neu');
    expect(z.angefordert).toBeNull();
    expect(z.grund).toBeNull();
  });

  it('nennt den Grund beim Namen: `ohne_begruendung`', async () => {
    const id = await anfrage();
    await expect(imKontext((k) => fordereIdentitaetsnachweis(k, id, '')))
      .rejects.toMatchObject({ grund: 'ohne_begruendung' });
  });

  it('in der Nur-Lese-Bindung geschieht nichts', async () => {
    const id = await anfrage();
    await expect(imKontext((k) => fordereIdentitaetsnachweis(k, id, GRUND),
      { readonly: true })).rejects.toThrow();
    expect((await roh(id)).status).toBe('neu');
  });

  it('eine ENTSCHIEDENE Anfrage wird nicht mehr nach der Identität gefragt',
    async () => {
      const id = await anfrage();
      await imKontext((k) => entscheide(k, id, 'beantwortet',
        'Auskunft nach Art. 15 erteilt.'));
      /*
       * Nach der Antwort ist die Identität keine offene Frage mehr, sondern
       * eine, die man sich vorher hätte stellen müssen. Ein Rückschritt hier
       * machte aus einem abgeschlossenen Vorgang wieder einen offenen — und
       * die Fälligkeitsliste zählte ihn erneut.
       */
      await expect(imKontext((k) => fordereIdentitaetsnachweis(k, id, GRUND)))
        .rejects.toMatchObject({ grund: 'nicht_gefunden', status: 404 });
      expect((await roh(id)).status).toBe('beantwortet');
    });

  it('und eine Anfrage einer ANDEREN Gesellschaft ebenso wenig', async () => {
    const fremd = await anfrage('neu', f.security);
    await expect(imKontext((k) => fordereIdentitaetsnachweis(k, fremd, GRUND)))
      .rejects.toMatchObject({ grund: 'nicht_gefunden' });
    expect((await roh(fremd)).status).toBe('neu');
  });
});

describe('§2 die beiden CHECKs aus 0388 — was die Datenbank selbst nicht zulässt', () => {
  it('kein Zeitpunkt ohne Grund', async () => {
    const id = await anfrage();
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update betroffenenanfrage set identitaet_angefordert_am = now()
        where id = $1::uuid`, [id]))).rejects.toThrow(/identitaet_begruendet/u);
  });

  it('und kein Grund ohne Zeitpunkt', async () => {
    const id = await anfrage();
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update betroffenenanfrage set identitaet_grund = $2 where id = $1::uuid`,
      [id, GRUND]))).rejects.toThrow(/identitaet_begruendet/u);
  });

  it('ein Grund aus Leerzeichen zählt nicht als Grund', async () => {
    const id = await anfrage();
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update betroffenenanfrage
          set identitaet_angefordert_am = now(), identitaet_grund = '   '
        where id = $1::uuid`, [id]))).rejects.toThrow(/identitaet_begruendet/u);
  });

  it('`identitaet_offen` OHNE Vermerk geht nicht — auch nicht am Dienst vorbei',
    async () => {
      const id = await anfrage();
      /*
       * Das ist die Zusage, die den Befund erst schliesst: der Zustand kann
       * nicht mehr allein dastehen. Sonst stünde in der Akte „Identität
       * offen" ohne die Angabe, warum — und genau die verlangt Art. 12 Abs. 6.
       */
      await expect(alsRolle('', (tx) => tx.unsafe(
        `update betroffenenanfrage set status = 'identitaet_offen' where id = $1::uuid`,
        [id]))).rejects.toThrow(/identitaet_offen_begruendet/u);
    });
});

describe('§3 die Monatsfrist läuft weiter (O-903)', () => {
  it('rührt `frist_am` nicht an — und die Anfrage bleibt in der Fälligkeitsliste',
    async () => {
      const id = await anfrage('neu', f.reinigung, 20);
      const vorher = await roh(id);
      await imKontext((k) => fordereIdentitaetsnachweis(k, id, GRUND));
      const nachher = await roh(id);
      /*
       * Art. 12 Abs. 3 lässt den Monat mit dem EINGANG laufen; ob eine
       * Rückfrage nach Absatz 6 ihn hemmt, sagt die Verordnung NICHT. Die
       * Frist hier still anzuhalten wäre eine Rechtsauffassung, die sich als
       * Spaltenwert tarnt — und im Zweifel eine, die der Aufsicht nicht
       * gefällt. Fällt diese Zusicherung, ist das eine ENTSCHEIDUNG und
       * gehört nach `docs/DECISIONS.md`, nicht in einen Commit nebenbei.
       */
      expect(nachher.frist).toBe(vorher.frist);

      const zeilen = await imKontext((k) => liste(k), { readonly: true });
      const meine = zeilen.find((z) => z.id === id);
      expect(meine, 'sie steht weiter im Posteingang').toBeDefined();
      expect(meine!.status).toBe('identitaet_offen');
      /* Zehn Tage von dreissig sind vorbei — nicht null, und nicht angehalten. */
      expect(meine!.tageBisFrist).toBeLessThan(12);
      expect(meine!.tageBisFrist).toBeGreaterThan(5);
    });

  it('und der Vermerk kommt bei `lade` mit — die Akte zeigt ihn', async () => {
    const id = await anfrage();
    await imKontext((k) => fordereIdentitaetsnachweis(k, id, GRUND));
    const z = await imKontext((k) => lade(k, id), { readonly: true });
    expect(z!.identitaetGrund).toBe(GRUND);
    expect(z!.identitaetAngefordertAm).toBeInstanceOf(Date);
  });
});

describe('§4 geklärt — der Zustand geht zurück, der Vermerk bleibt', () => {
  it('setzt „in Bearbeitung" und LÄSST den Vermerk stehen', async () => {
    const id = await anfrage();
    await imKontext((k) => fordereIdentitaetsnachweis(k, id, GRUND));
    await imKontext((k) => identitaetGeklaert(k, id));
    const z = await roh(id);
    expect(z.status).toBe('in_bearbeitung');
    /*
     * Der Vermerk ist der BELEG dafür, dass nachgefragt wurde, und worauf
     * sich die Zweifel stützten. Er verschwindet nicht mit der Antwort —
     * sonst stünde später eine verlangte Ausweiskopie ohne ihren Anlass da.
     */
    expect(z.grund).toBe(GRUND);
    expect(z.angefordert).not.toBeNull();
  });

  it('eine Anfrage, deren Identität gar nicht offen ist, wird abgewiesen', async () => {
    const id = await anfrage('in_bearbeitung');
    await expect(imKontext((k) => identitaetGeklaert(k, id)))
      .rejects.toMatchObject({ grund: 'nicht_gefunden', status: 404 });
  });

  it('nach dem Klären lässt sich erneut nachfragen — der Grund wird überschrieben',
    async () => {
      const id = await anfrage();
      await imKontext((k) => fordereIdentitaetsnachweis(k, id, GRUND));
      await imKontext((k) => identitaetGeklaert(k, id));
      const zweiter = 'Die nachgereichte Ausweiskopie ist unleserlich.';
      await imKontext((k) => fordereIdentitaetsnachweis(k, id, zweiter));
      const z = await roh(id);
      expect(z.status).toBe('identitaet_offen');
      expect(z.grund).toBe(zweiter);
    });

  it('in der Nur-Lese-Bindung geschieht nichts', async () => {
    const id = await anfrage();
    await imKontext((k) => fordereIdentitaetsnachweis(k, id, GRUND));
    await expect(imKontext((k) => identitaetGeklaert(k, id), { readonly: true }))
      .rejects.toThrow();
    expect((await roh(id)).status).toBe('identitaet_offen');
  });
});
