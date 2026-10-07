/**
 * **Die Bindefrist entsteht beim Versand** (V-359, O-350, D-796, D-806).
 *
 * Bis hierher füllte `gueltig_bis` nur, wer es von Hand eintrug. Ohne Datum
 * lief ein Angebot nie ab — der Nachtlauf `angebot_ablauf` greift nur bei
 * gesetztem Datum —, und der Kunde las „ohne Frist vereinbart". Jetzt setzt
 * `versendeAngebot` die Frist im SELBEN UPDATE wie `versendet_am`, also bevor
 * 0024 das Angebot einfriert.
 *
 * Gemessen wird: die Voreinstellung (28 Tage ab dem Berliner Versandtag), die
 * Einstellung einer Gesellschaft, ein verstellter Wert, an dem kein Versand
 * scheitert, ein von Hand eingetragenes Datum, das stehen bleibt — und dass
 * die Frist danach so eingefroren ist wie jede andere Angabe des Angebots.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  BINDEFRIST_VOREINSTELLUNG_TAGE, gibPreisFrei, versendeAngebot,
} from '../../src/server/services/angebot/index.js';
import { legeAngebotVonHandAn } from '../../src/server/services/angebot/von-hand.js';
import { legeKundeAn } from '../../src/server/services/crm/anlegen.js';

let f: Fixtur;
let chefR = '';
let chefS = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(email: string, mandant: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = 'leitung' and mandant_id is null),
             true)`,
    [u!.id, mandant]);
  return u!.id;
}

/** Der Kontext der Dienste — mit `unsafe`, das der Nummernkreis braucht (`vergebeNummer`). */
type Kontext = SchreibKontext & {
  unsafe(s: string, w?: readonly unknown[]): Promise<readonly unknown[]>;
};

function imKontext<T>(
  mandantId: string, benutzer: string, fn: (k: Kontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId: benutzer, portal: 'intern', readonly: false },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: benutzer,
        aktiverMandantId: mandantId, mandantIds: [mandantId],
        abfrage: fuehre, schreibe: fuehre,
        unsafe: async (s, w) => (await tx.unsafe(s, (w ?? []) as never[])) as readonly unknown[],
      });
    },
  ) as Promise<T>;
}

/** Ein Angebot von Hand, freigegeben und bereit zum Versand. */
async function freigegeben(
  mandant: string, benutzer: string, gueltigBis: string | null = null,
): Promise<string> {
  return imKontext(mandant, benutzer, async (k) => {
    const kunde = await legeKundeAn(k, {
      name: `Bindefrist ${zufall()} GmbH`, typ: 'firma', rechtsgrundlage: 'keine' });
    const [heute] = await k.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
    const { angebotId } = await legeAngebotVonHandAn(k, {
      kundeId: kunde.id, titel: 'Unterhaltsreinigung', stichtag: heute!.tag, gueltigBis,
      positionen: [{
        kurztext: 'Unterhaltsreinigung Büro', menge: '10', einheit: 'h',
        einzelpreisEuro: '32,00', steuersatzSchluessel: 'ust_19',
      }],
    });
    await gibPreisFrei(k, angebotId, benutzer);
    return angebotId;
  });
}

/** Der Berliner Heute-Tag plus `tage`, als `YYYY-MM-DD`. */
async function inTagen(tage: number): Promise<string> {
  const [z] = await sql.unsafe<{ tag: string }[]>(
    `select (app.berlin_heute() + $1::integer)::text as tag`, [tage]);
  return z!.tag;
}

async function gespeichert(angebotId: string): Promise<string | null> {
  const [z] = await sql.unsafe<{ bis: string | null }[]>(
    `select gueltig_bis::text as bis from angebot where id = $1`, [angebotId]);
  return z!.bis;
}

/**
 * `wert` ist JSON-TEXT (`'14'` eine Zahl, `'"21"'` eine Zeichenkette) — deshalb
 * `$2::text::jsonb`: ein blosses `$2::jsonb` serialisierte den Text ein
 * zweites Mal, und aus `"21"` wuerde eine Zeichenkette MIT Anfuehrungszeichen.
 */
async function einstellung(mandant: string, wert: string): Promise<void> {
  await sql.unsafe(
    `insert into mandant_einstellung (mandant_id, schluessel, wert, beschreibung)
     values ($1, 'angebot.bindefrist_tage_standard', $2::text::jsonb, 'Bindefrist (Test)')
     on conflict (mandant_id, schluessel) do update set wert = excluded.wert`,
    [mandant, wert]);
}

beforeAll(async () => {
  f = await seed();
  chefR = await konto(`frist-r-${zufall()}@cse.test`, f.reinigung);
  chefS = await konto(`frist-s-${zufall()}@cse.test`, f.security);
  for (const m of [f.reinigung, f.security]) {
    await sql.unsafe(
      `insert into nummernkreis (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos,
                                 format_maske, zuruecksetzung, geoeffnet_am, ist_platzhalter,
                                 erstellt_von_art, erstellt_von_dienst)
       values ($1, 'angebot', extract(year from app.berlin_heute())::int, 'angebot', false,
               'AN-{jahr}-{nr:5}', 'jaehrlich', current_date, false, 'system', 'job:test')`,
      [m]);
  }
});
afterAll(schliessen);

describe('die Frist, die der Versand setzt', () => {
  it('ohne Einstellung: vier Wochen ab dem Berliner Versandtag', async () => {
    expect(BINDEFRIST_VOREINSTELLUNG_TAGE).toBe(28);
    const angebotId = await freigegeben(f.reinigung, chefR);
    expect(await gespeichert(angebotId)).toBeNull();

    const versand = await imKontext(f.reinigung, chefR, (k) =>
      versendeAngebot(k, angebotId, chefR));
    const erwartet = await inTagen(28);
    expect(versand.gueltigBis).toBe(erwartet);
    expect(await gespeichert(angebotId)).toBe(erwartet);
  });

  it('die Einstellung der Gesellschaft gilt — nur für sie', async () => {
    await einstellung(f.security, '14');
    const s = await freigegeben(f.security, chefS);
    const r = await freigegeben(f.reinigung, chefR);
    await imKontext(f.security, chefS, (k) => versendeAngebot(k, s, chefS));
    await imKontext(f.reinigung, chefR, (k) => versendeAngebot(k, r, chefR));
    expect(await gespeichert(s)).toBe(await inTagen(14));
    expect(await gespeichert(r), 'die Reinigung trägt keine Einstellung')
      .toBe(await inTagen(28));
  });

  it('auch als Zeichenkette geschrieben', async () => {
    await einstellung(f.security, '"21"');
    const s = await freigegeben(f.security, chefS);
    await imKontext(f.security, chefS, (k) => versendeAngebot(k, s, chefS));
    expect(await gespeichert(s)).toBe(await inTagen(21));
  });

  it.each([
    ['ein Wort', '"vier Wochen"'],
    ['null Tage', '0'],
    ['ein Bruch', '28.5'],
    ['JSON-null', 'null'],
  ])('ein verstellter Wert (%s) lässt den Versand nicht scheitern — es gilt die Voreinstellung',
    async (_name, wert) => {
      await einstellung(f.security, wert);
      const s = await freigegeben(f.security, chefS);
      await imKontext(f.security, chefS, (k) => versendeAngebot(k, s, chefS));
      expect(await gespeichert(s)).toBe(await inTagen(28));
    });

  it('ein eingetragenes Datum bleibt stehen', async () => {
    const eingetragen = await inTagen(60);
    const angebotId = await freigegeben(f.reinigung, chefR, eingetragen);
    const versand = await imKontext(f.reinigung, chefR, (k) =>
      versendeAngebot(k, angebotId, chefR));
    expect(versand.gueltigBis).toBe(eingetragen);
    expect(await gespeichert(angebotId)).toBe(eingetragen);
  });
});

describe('danach ist die Frist eingefroren (0024)', () => {
  it('ein versendetes Angebot lässt sich nicht verlängern — das ist eine neue Version', async () => {
    const angebotId = await freigegeben(f.reinigung, chefR);
    await imKontext(f.reinigung, chefR, (k) => versendeAngebot(k, angebotId, chefR));
    await expect(imKontext(f.reinigung, chefR, (k) => k.schreibe(
      `update angebot set gueltig_bis = gueltig_bis + 14 where id = $1::uuid`, [angebotId])))
      .rejects.toThrow(/unveraenderlich/u);
    expect(await gespeichert(angebotId)).toBe(await inTagen(28));
  });
});
