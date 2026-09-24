/**
 * **Die Kette Lead → Angebot → Auftrag, gegen eine echte Datenbank**
 * (V-138, V-139, V-140; CRM-05, CRM-06, CRM-07, REQ-07, REP-03;
 * D-632 … D-634).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `angebot.lead_id` wurde von keinem Weg geschrieben, `auftrag.lead_id` erbte
 * davon NULL, `lead.kunde_id` liess sich nach der Anlage nicht setzen — und
 * der Herkunftsbericht, der Aufträge über `auftrag.lead_id` zählt, zeigte für
 * jeden Kanal „0 Aufträge, 0,00 €". Zwei der vier Leadquellen (Vergaberadar,
 * Empfehlung) hatten keinen Erzeuger. Und `kunde.firma_id` blieb für jeden im
 * Portal angelegten Kunden leer, also erkannte die Gruppe keinen Kunden in
 * zwei Gesellschaften.
 *
 * Geprüft wird hier, dass die Kette TRÄGT — vom Lead bis in den Bericht —
 * und dass sie an den Stellen HÄLT, an denen sie falsch würde: fremde
 * Gesellschaft, fremder Kunde, zweite Übernahme, Kundentausch nach dem
 * Angebot, eine Rolle ohne CRM-Schreibrecht.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  AngebotFehler, gibPreisFrei, legeAngebotAn, versendeAngebot, wandleInAuftrag,
} from '../../src/server/services/angebot/index.js';
import {
  HandAngebotFehler, legeAngebotVonHandAn,
} from '../../src/server/services/angebot/von-hand.js';
import { ziehEntwurfZurueck } from '../../src/server/services/angebot/entwurf.js';
import { CrmFehler, legeKundeAn, legeLeadAn } from '../../src/server/services/crm/anlegen.js';
import { aendereKunde } from '../../src/server/services/crm/aendern.js';
import {
  leseKundeVorgaenge, leseLeadKette, ordneLeadKundeZu, pruefeLeadBindung,
  uebernehmeLeadAlsKunde,
} from '../../src/server/services/crm/lead-kette.js';
import { uebernimmAusschreibungAlsLead } from '../../src/server/services/crm/lead-radar.js';
import {
  halteLeadAktivitaetFest, legeLeadKontaktAn, leseLeadKontaktWahl, waehleLeadKontakt,
} from '../../src/server/services/crm/lead-kontakt.js';
import { attribution } from '../../src/server/services/bericht/kennzahlen.js';
import { attributionJeBereich } from '../../src/server/services/bericht/gruppe.js';
import { ganzesJahr } from '../../src/server/services/bericht/zeitraum.js';

let f: Fixtur;
let chefR = '';      // leitung, Reinigung — alle Rechte der Kette
let chefS = '';      // admin, Security
let versender = '';  // leitung, Security — OHNE crm.schreiben
let gruppe = '';     // super_admin — die Gruppenansicht
let jahr = 0;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

type Kontext = SchreibKontext & {
  unsafe(s: string, w?: readonly unknown[]): Promise<readonly unknown[]>;
};

async function konto(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [benutzer, mandant, rolle]);
}

async function nummernkreis(mandant: string, typ: string, maske: string): Promise<void> {
  await sql.unsafe(
    `insert into nummernkreis (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos,
                               format_maske, zuruecksetzung, geoeffnet_am, ist_platzhalter,
                               erstellt_von_art, erstellt_von_dienst)
     values ($1, $2::nummernkreis_typ, extract(year from app.berlin_heute())::int, $3, false,
             $4, 'jaehrlich', current_date, false, 'system', 'job:test')`,
    [mandant, typ, typ, maske]);
}

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

const inR = <T>(fn: (k: Kontext) => Promise<T>): Promise<T> => imKontext(f.reinigung, chefR, fn);
const inS = <T>(fn: (k: Kontext) => Promise<T>): Promise<T> => imKontext(f.security, chefS, fn);

async function kunde(k: Kontext, name: string): Promise<string> {
  return (await legeKundeAn(k, { name, typ: 'firma', rechtsgrundlage: 'keine' })).id;
}

/** Ein Angebot von Hand mit einer Position — der Weg der Maske „Neues Angebot". */
async function handAngebot(
  k: Kontext, kundeId: string, leadId: string | null, titel = 'Unterhaltsreinigung',
): Promise<string> {
  const [heute] = await k.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
  const r = await legeAngebotVonHandAn(k, {
    kundeId, titel, leadId, stichtag: heute!.tag,
    positionen: [{
      kurztext: 'Unterhaltsreinigung Büro', menge: '10', einheit: 'h',
      einzelpreisEuro: '32,00', steuersatzSchluessel: 'ust_19',
    }],
  });
  return r.angebotId;
}

async function lead(leadId: string): Promise<{
  status: string; kunde_id: string | null; konvertiert_am: Date | null;
  ansprechpartner_id: string | null; quelle: string;
}> {
  const [z] = await sql.unsafe<{
    status: string; kunde_id: string | null; konvertiert_am: Date | null;
    ansprechpartner_id: string | null; quelle: string;
  }[]>(
    `select status::text as status, kunde_id::text as kunde_id, konvertiert_am,
            ansprechpartner_id::text as ansprechpartner_id, quelle::text as quelle
       from lead where id = $1`, [leadId]);
  return z!;
}

async function systemzeilen(leadId: string): Promise<readonly string[]> {
  const zeilen = await sql.unsafe<{ betreff: string }[]>(
    `select betreff from lead_aktivitaet
      where lead_id = $1 and typ = 'system' order by geschehen_am, erstellt_am`, [leadId]);
  return zeilen.map((z) => z.betreff);
}

beforeAll(async () => {
  f = await seed();
  chefR = await konto(`kette-r-${zufall()}@cse.test`);
  await mitglied(chefR, f.reinigung, 'leitung');
  chefS = await konto(`kette-s-${zufall()}@cse.test`);
  await mitglied(chefS, f.security, 'admin');
  versender = await konto(`kette-v-${zufall()}@cse.test`);
  await mitglied(versender, f.security, 'leitung');
  /*
   * Die Rolle, gegen die die Definer-Auslöser gebaut sind: sie versendet und
   * nimmt an, hält aber `crm.schreiben` NICHT. Als `cse_app` geschrieben
   * wäre die Nachführung des Leads an der WITH-CHECK-Klausel gescheitert und
   * hätte den Versand mitgerissen.
   */
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
             (select id from berechtigung where schluessel = 'crm.schreiben'), $1, false)
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = false`,
    [f.security]);
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [`kette-g-${zufall()}@cse.test`]);
  gruppe = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [gruppe]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Gruppe', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [gruppe, `kette-g-${zufall()}@cse.test`]);
  for (const m of [f.reinigung, f.security]) {
    await nummernkreis(m, 'angebot', 'AN-{jahr}-{nr:5}');
    await nummernkreis(m, 'auftrag', 'AU-{jahr}-{nr:5}');
  }
  const [j] = await sql.unsafe<{ j: number }[]>(
    `select extract(year from app.berlin_heute())::int as j`);
  jahr = j!.j;
});
afterAll(schliessen);

/* ═════════════════════════════════════════════════════════════════════════
 * §1 — ein Vorgang hängt nur an einer passenden Anfrage
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§1 die Bindung Lead ↔ Angebot', () => {
  it('ein Lead einer anderen Gesellschaft ist nicht erreichbar', async () => {
    const fremd = await inS(async (k) => {
      const kd = await kunde(k, 'Fremd GmbH');
      return (await legeLeadAn(k, { betreff: 'Fremd', kundeId: kd, besitzerBenutzerId: chefS })).id;
    });
    const kd = await inR((k) => kunde(k, 'Eigen GmbH'));
    await expect(inR((k) => pruefeLeadBindung(k, fremd, kd)))
      .resolves.toEqual({ ok: false, grund: 'lead_unbekannt' });
    await expect(inR((k) => legeAngebotAn(k, { kundeId: kd, titel: 'x', leadId: fremd })))
      .rejects.toThrow(AngebotFehler);
  });

  it('ein Lead ohne Kunden wird nicht nebenbei zugeordnet', async () => {
    const l = await inR((k) => legeLeadAn(k, {
      betreff: 'Ohne Kunde', firmaName: 'Neu GmbH', besitzerBenutzerId: chefR }));
    const kd = await inR((k) => kunde(k, 'Irgendwer GmbH'));
    await expect(inR((k) => handAngebot(k, kd, l.id))).rejects.toMatchObject({
      grund: 'lead_ohne_kunde' });
    await expect(inR((k) => handAngebot(k, kd, l.id))).rejects.toThrow(HandAngebotFehler);
    // Und nichts ist entstanden — kein halbes Angebot.
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from angebot where lead_id = $1`, [l.id]);
    expect(n!.n).toBe(0);
  });

  it('ein Angebot für Kunde B an der Anfrage von Kunde A wird abgewiesen — auch am Dienst vorbei', async () => {
    const { a, b, leadId } = await inR(async (k) => {
      const a = await kunde(k, 'A GmbH');
      const b = await kunde(k, 'B GmbH');
      const l = await legeLeadAn(k, { betreff: 'A fragt', kundeId: a, besitzerBenutzerId: chefR });
      return { a, b, leadId: l.id };
    });
    await expect(inR((k) => legeAngebotAn(k, { kundeId: b, titel: 'x', leadId })))
      .rejects.toMatchObject({ grund: 'lead_kunde_abweichend' });
    /*
     * Die zweite Linie: ein INSERT, der den Dienst umgeht. Der Auslöser
     * `kern.lead_bezug_stimmt` (0400) hält dieselbe Regel.
     */
    await expect(inR((k) => k.schreibe(
      `insert into angebot (mandant_id, kunde_id, titel, lead_id)
       values (app.aktiver_mandant(), $1::uuid, 'vorbei', $2::uuid)`, [b, leadId])))
      .rejects.toMatchObject({ code: '23514' });
    await expect(inR((k) => legeAngebotAn(k, { kundeId: a, titel: 'passt', leadId })))
      .resolves.toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('ein Lead zeigt nicht auf den Kunden einer anderen Gesellschaft (Fremdschlüssel, 0400)', async () => {
    const fremderKunde = await inS((k) => kunde(k, 'Security-Kunde GmbH'));
    await expect(inR((k) => legeLeadAn(k, {
      betreff: 'Falsch', kundeId: fremderKunde, besitzerBenutzerId: chefR,
    }))).rejects.toMatchObject({ grund: 'kunde_unbekannt' });
    // Auch als Eigentümer, am Dienst vorbei: der Schlüssel hält.
    await expect(sql.unsafe(
      `insert into lead (mandant_id, leadnummer, quelle, betreff, kunde_id, besitzer_benutzer_id)
       values ($1, $2, 'manuell', 'vorbei', $3, $4)`,
      [f.reinigung, `L-${zufall()}`, fremderKunde, chefR])).rejects.toMatchObject({
      code: '23503' });
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §2 — die ganze Kette, bis in den Herkunftsbericht
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§2 Lead → Angebot → Versand → Auftrag → Bericht', () => {
  it('trägt die Herkunft bis zum Auftrag, und der Lead folgt der Kette', async () => {
    const { kundeId, leadId, empfehler } = await inR(async (k) => {
      const empfehler = await kunde(k, 'Empfehlende Hausverwaltung');
      const kundeId = await kunde(k, 'Bürohaus Kette GmbH');
      const l = await legeLeadAn(k, {
        betreff: 'Unterhaltsreinigung Kette', kundeId, besitzerBenutzerId: chefR,
        quelle: 'empfehlung', empfehlungVonKundeId: empfehler,
      });
      return { kundeId, leadId: l.id, empfehler };
    });
    expect((await lead(leadId)).quelle).toBe('empfehlung');

    const angebotId = await inR((k) => handAngebot(k, kundeId, leadId));
    const [a] = await sql.unsafe<{ lead_id: string; netto: string }[]>(
      `select lead_id::text as lead_id, netto_cent::text as netto from angebot where id = $1`,
      [angebotId]);
    expect(a!.lead_id).toBe(leadId);
    expect(a!.netto).toBe('32000');
    expect((await lead(leadId)).status).toBe('neu');

    // Versand: der offene Lead steht danach auf „Angebot abgegeben".
    const versand = await inR(async (k) => {
      await gibPreisFrei(k, angebotId, chefR);
      return versendeAngebot(k, angebotId, chefR);
    });
    expect((await lead(leadId)).status).toBe('angebot');
    expect(await systemzeilen(leadId)).toContain(`Angebot ${versand.angebotsnummer} versendet`);

    // Annahme: der Auftrag trägt den Lead, der Lead ist gewonnen.
    const auftrag = await inR((k) => wandleInAuftrag(k, angebotId, {
      art: 'rahmenvertrag', verantwortlichBenutzerId: chefR, startDatum: `${String(jahr)}-10-01`,
    }));
    const [t] = await sql.unsafe<{ lead_id: string }[]>(
      `select lead_id::text as lead_id from auftrag where id = $1`, [auftrag.auftragId]);
    expect(t!.lead_id).toBe(leadId);
    const nachher = await lead(leadId);
    expect(nachher.status).toBe('gewonnen');
    expect(nachher.konvertiert_am).not.toBeNull();
    expect(await systemzeilen(leadId)).toContain(`Auftrag ${auftrag.auftragsnummer} angelegt`);

    /*
     * **Der Bericht, um den es ging (REP-03).** Vorher: 0 Aufträge und
     * 0,00 € für jeden Kanal, weil `auftrag.lead_id` immer leer war.
     */
    const zeilen = await imKontext(f.reinigung, chefR, (k) => attribution(k, ganzesJahr(jahr)));
    expect(zeilen.find((z) => z.kanal === 'Empfehlung')).toMatchObject({
      leads: 1, auftraege: 1, auftragswertCent: 32000n, quoteBp: 10000,
    });

    const gruppenZeilen = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.security, f.bau, f.operations],
        benutzerId: gruppe, portal: 'intern', readonly: true },
      async (tx: postgres.TransactionSql) => attributionJeBereich({
        abfrage: async <R,>(s: string, w?: readonly unknown[]) =>
          (await tx.unsafe(s, (w ?? []) as never[])) as unknown as readonly R[],
      }, ganzesJahr(jahr)));
    expect(gruppenZeilen.find((z) => z.mandantId === f.reinigung && z.kanal === 'Empfehlung'))
      .toMatchObject({ leads: 1, auftraege: 1 });

    // Leadblatt und Kundenblatt sehen dieselbe Kette.
    const kette = await inR((k) => leseLeadKette(k, leadId));
    expect(kette?.kunde?.id).toBe(kundeId);
    expect(kette?.empfehlung?.id).toBe(empfehler);
    expect(kette?.angebote.map((z) => z.id)).toEqual([angebotId]);
    expect(kette?.auftraege.map((z) => z.id)).toEqual([auftrag.auftragId]);
    const vorgaenge = await inR((k) => leseKundeVorgaenge(k, kundeId));
    expect(vorgaenge.anfragen.map((z) => z.id)).toEqual([leadId]);
    expect(vorgaenge.angebote.map((z) => z.id)).toEqual([angebotId]);
    expect(vorgaenge.verlauf.map((z) => z.betreff))
      .toContain(`Auftrag ${auftrag.auftragsnummer} angelegt`);
  });

  it('eine Rolle OHNE crm.schreiben versendet und nimmt an — und der Lead folgt trotzdem', async () => {
    const { kundeId, leadId } = await inS(async (k) => {
      const kundeId = await kunde(k, 'Objektschutz Kette GmbH');
      const l = await legeLeadAn(k, {
        betreff: 'Objektschutz', kundeId, besitzerBenutzerId: chefS });
      return { kundeId, leadId: l.id };
    });
    const angebotId = await inS((k) => handAngebot(k, kundeId, leadId, 'Objektschutz'));
    await imKontext(f.security, versender, async (k) => {
      await gibPreisFrei(k, angebotId, versender);
      await versendeAngebot(k, angebotId, versender);
    });
    expect((await lead(leadId)).status).toBe('angebot');
    await imKontext(f.security, versender, (k) => wandleInAuftrag(k, angebotId, {
      art: 'einzelauftrag', verantwortlichBenutzerId: versender,
      startDatum: `${String(jahr)}-11-01`,
    }));
    expect((await lead(leadId)).status).toBe('gewonnen');
  });

  it('ein Auftrag direkt aus der Anfrage — der Weg von /api/auftrag', async () => {
    const { kundeId, andererKunde, leadId } = await inR(async (k) => {
      const kundeId = await kunde(k, 'Direkt GmbH');
      const andererKunde = await kunde(k, 'Anders GmbH');
      const l = await legeLeadAn(k, { betreff: 'Direkt', kundeId, besitzerBenutzerId: chefR });
      return { kundeId, andererKunde, leadId: l.id };
    });
    const einfuegen = (kd: string) => inR((k) => k.schreibe(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                            verantwortlich_benutzer_id, start_datum, lead_id)
       values (app.aktiver_mandant(), $1, $2::uuid, 'einzelauftrag', 'Direkt', $3::uuid,
               app.berlin_heute(), $4::uuid)`,
      [`AU-${zufall()}`, kd, chefR, leadId]));
    await expect(einfuegen(andererKunde)).rejects.toMatchObject({ code: '23514' });
    await einfuegen(kundeId);
    expect((await lead(leadId)).status).toBe('gewonnen');
  });

  it('ein verloren gegebener Lead, aus dem doch ein Auftrag wird, ist gewonnen', async () => {
    const { kundeId, leadId } = await inR(async (k) => {
      const kundeId = await kunde(k, 'Spät GmbH');
      const l = await legeLeadAn(k, { betreff: 'Spät', kundeId, besitzerBenutzerId: chefR });
      await k.schreibe(
        `update lead set status = 'verloren', verloren_grund = 'Zu teuer' where id = $1::uuid`,
        [l.id]);
      return { kundeId, leadId: l.id };
    });
    const angebotId = await inR((k) => handAngebot(k, kundeId, leadId));
    await inR(async (k) => {
      await gibPreisFrei(k, angebotId, chefR);
      await versendeAngebot(k, angebotId, chefR);
    });
    // Das Angebot stellt einen VERLORENEN Lead nicht zurück auf „Angebot".
    expect((await lead(leadId)).status).toBe('verloren');
    await inR((k) => wandleInAuftrag(k, angebotId, {
      art: 'einzelauftrag', verantwortlichBenutzerId: chefR, startDatum: `${String(jahr)}-12-01`,
    }));
    expect((await lead(leadId)).status).toBe('gewonnen');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §3 — der Lead bekommt seinen Kunden
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§3 Als Kunde übernehmen, einem Kunden zuordnen', () => {
  async function webLead(email: string | null): Promise<{ leadId: string; kontaktId: string }> {
    return inR(async (k) => {
      const l = await legeLeadAn(k, {
        betreff: 'Anfrage aus dem Netz', firmaName: 'Netzfirma GmbH', besitzerBenutzerId: chefR });
      const [a] = await k.schreibe<{ id: string }>(
        `insert into ansprechpartner (mandant_id, kunde_id, nachname, email)
         values (app.aktiver_mandant(), null, 'Anfragende', $1) returning id::text as id`,
        [email]);
      await k.schreibe(`update lead set ansprechpartner_id = $2::uuid where id = $1::uuid`,
        [l.id, a!.id]);
      return { leadId: l.id, kontaktId: a!.id };
    });
  }

  it('legt den Kunden an, bindet den Lead, nimmt den Anfragenden mit — Grundlage „keine"', async () => {
    const { leadId, kontaktId } = await webLead(`netz-${zufall()}@beispiel.test`);
    const neu = await inR((k) => uebernehmeLeadAlsKunde(k, leadId, {
      typ: 'firma', ustId: `DE ${String(100000000 + Math.floor(Math.random() * 899999999))}` }));
    expect(neu.kundennummer).toMatch(/^K-\d{5}$/u);
    const l = await lead(leadId);
    expect(l.kunde_id).toBe(neu.kundeId);
    expect(l.status).toBe('in_bearbeitung');
    const [kd] = await sql.unsafe<{ name: string; rechtsgrundlage: string; firma_id: string | null }[]>(
      `select name, rechtsgrundlage::text as rechtsgrundlage, firma_id::text as firma_id
         from kunde where id = $1`, [neu.kundeId]);
    expect(kd).toMatchObject({ name: 'Netzfirma GmbH', rechtsgrundlage: 'keine' });
    expect(kd!.firma_id).not.toBeNull();
    const [ap] = await sql.unsafe<{ kunde_id: string }[]>(
      `select kunde_id::text as kunde_id from ansprechpartner where id = $1`, [kontaktId]);
    expect(ap!.kunde_id).toBe(neu.kundeId);
    expect(await systemzeilen(leadId)).toContain(`Als Kunde ${neu.kundennummer} übernommen`);

    await expect(inR((k) => uebernehmeLeadAlsKunde(k, leadId, { typ: 'firma' })))
      .rejects.toMatchObject({ grund: 'lead_hat_kunde' });
  });

  it('führt der Kunde den Menschen schon, zeigt der Lead auf DEN — ein Mensch, ein Kontakt', async () => {
    const email = `zwilling-${zufall()}@beispiel.test`;
    const { leadId, kontaktId } = await webLead(email);
    const { kundeId, vorhandener } = await inR(async (k) => {
      const kundeId = await kunde(k, 'Bestand GmbH');
      const [a] = await k.schreibe<{ id: string }>(
        `insert into ansprechpartner (mandant_id, kunde_id, nachname, email)
         values (app.aktiver_mandant(), $1::uuid, 'Bekannt', upper($2)) returning id::text as id`,
        [kundeId, email]);
      return { kundeId, vorhandener: a!.id };
    });
    await inR((k) => ordneLeadKundeZu(k, leadId, kundeId));
    const l = await lead(leadId);
    expect(l.kunde_id).toBe(kundeId);
    expect(l.ansprechpartner_id).toBe(vorhandener);
    const [ap] = await sql.unsafe<{ kunde_id: string | null }[]>(
      `select kunde_id::text as kunde_id from ansprechpartner where id = $1`, [kontaktId]);
    expect(ap!.kunde_id).toBeNull();
  });

  it('ein fremder Kunde wird nicht zugeordnet', async () => {
    const { leadId } = await webLead(null);
    const fremd = await inS((k) => kunde(k, 'Fremdkunde GmbH'));
    await expect(inR((k) => ordneLeadKundeZu(k, leadId, fremd)))
      .rejects.toMatchObject({ grund: 'kunde_unbekannt' });
  });

  it('sobald ein Angebot an der Anfrage hängt, bleibt ihr Kunde — im Dienst und in der Datenbank', async () => {
    const { leadId } = await webLead(null);
    const { erster, zweiter } = await inR(async (k) => ({
      erster: await kunde(k, 'Erster GmbH'), zweiter: await kunde(k, 'Zweiter GmbH') }));
    await inR((k) => ordneLeadKundeZu(k, leadId, erster));
    await inR((k) => handAngebot(k, erster, leadId));
    await expect(inR((k) => ordneLeadKundeZu(k, leadId, zweiter)))
      .rejects.toMatchObject({ grund: 'lead_hat_vorgaenge' });
    await expect(inR((k) => k.schreibe(
      `update lead set kunde_id = $2::uuid where id = $1::uuid`, [leadId, zweiter])))
      .rejects.toMatchObject({ code: '23514' });
    expect((await lead(leadId)).kunde_id).toBe(erster);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §4 — die zwei Leadquellen ohne Erzeuger (CRM-07)
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§4 Empfehlung und Vergaberadar', () => {
  it('eine Empfehlung nennt einen Kunden dieser Gesellschaft — nicht sich selbst', async () => {
    const eigen = await inR((k) => kunde(k, 'Empfehlerin GmbH'));
    const fremd = await inS((k) => kunde(k, 'Fremde Empfehlerin GmbH'));
    await expect(inR((k) => legeLeadAn(k, {
      betreff: 'E', firmaName: 'X', besitzerBenutzerId: chefR, quelle: 'empfehlung',
    }))).rejects.toMatchObject({ grund: 'empfehlung_ohne_kunde' });
    await expect(inR((k) => legeLeadAn(k, {
      betreff: 'E', firmaName: 'X', besitzerBenutzerId: chefR, quelle: 'empfehlung',
      empfehlungVonKundeId: fremd,
    }))).rejects.toMatchObject({ grund: 'kunde_unbekannt' });
    await expect(inR((k) => legeLeadAn(k, {
      betreff: 'E', kundeId: eigen, besitzerBenutzerId: chefR, quelle: 'empfehlung',
      empfehlungVonKundeId: eigen,
    }))).rejects.toMatchObject({ grund: 'empfehlung_selbst' });
    const l = await inR((k) => legeLeadAn(k, {
      betreff: 'E', firmaName: 'Neukunde GmbH', besitzerBenutzerId: chefR,
      quelle: 'empfehlung', empfehlungVonKundeId: eigen,
    }));
    const [z] = await sql.unsafe<{ quelle: string; von: string }[]>(
      `select quelle::text as quelle, empfehlung_von_kunde_id::text as von from lead where id = $1`,
      [l.id]);
    expect(z).toEqual({ quelle: 'empfehlung', von: eigen });
  });

  it('ein Radartreffer wird zum Lead — einmal je Gesellschaft, mit Wert nur in Euro', async () => {
    const quellId = `test-${zufall()}`;
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into ausschreibung (quelle, quell_id, titel, beschreibung, vergabestelle_name,
                                  vergabestelle_ort, wert_geschaetzt_cent, waehrung, rohdaten_hash)
       values ('oeffentlichevergabe', $1, 'Unterhaltsreinigung Rathaus', 'Drei Etagen.',
               'Bezirksamt Test', 'Berlin', 12345600, 'EUR', $1) returning id`, [quellId]);
    const l = await inR((k) => uebernimmAusschreibungAlsLead(k, a!.id, {
      besitzerBenutzerId: chefR }));
    const [z] = await sql.unsafe<{
      quelle: string; firma_name: string; betreff: string; wert: string; ausschreibung_id: string;
    }[]>(
      `select quelle::text as quelle, firma_name, betreff, geschaetzter_wert_cent::text as wert,
              ausschreibung_id::text as ausschreibung_id
         from lead where id = $1`, [l.id]);
    expect(z).toEqual({
      quelle: 'vergabe_radar', firma_name: 'Bezirksamt Test',
      betreff: 'Unterhaltsreinigung Rathaus', wert: '12345600', ausschreibung_id: a!.id,
    });
    await expect(inR((k) => uebernimmAusschreibungAlsLead(k, a!.id, {
      besitzerBenutzerId: chefR }))).rejects.toMatchObject({ grund: 'schon_uebernommen' });
    // Die Security darf dieselbe Bekanntmachung übernehmen — sie bietet selbst.
    await expect(inS((k) => uebernimmAusschreibungAlsLead(k, a!.id, {
      besitzerBenutzerId: chefS }))).resolves.toMatchObject({ leadnummer: expect.any(String) });
    // Am Dienst vorbei hält der eindeutige Index (0400).
    await expect(sql.unsafe(
      `insert into lead (mandant_id, leadnummer, quelle, ausschreibung_id, firma_name, betreff,
                         besitzer_benutzer_id)
       values ($1, $2, 'vergabe_radar', $3, 'X', 'X', $4)`,
      [f.reinigung, `L-${zufall()}`, a!.id, chefR])).rejects.toMatchObject({ code: '23505' });

    const zeilen = await imKontext(f.reinigung, chefR, (k) => attribution(k, ganzesJahr(jahr)));
    expect(zeilen.find((r) => r.kanal === 'Vergaberadar')?.leads).toBe(1);
  });

  it('ein übernommenes Akquiseziel zählt als „Akquise", nicht als „Manuell erfasst"', async () => {
    await sql.unsafe(
      `insert into lead (mandant_id, leadnummer, quelle, betreff, firma_name,
                         besitzer_benutzer_id)
       values ($1, $2, 'akquise', 'Recherche', 'Recherchierte GmbH', $3)`,
      [f.reinigung, `L-${zufall()}`, chefR]);
    const zeilen = await imKontext(f.reinigung, chefR, (k) => attribution(k, ganzesJahr(jahr)));
    expect(zeilen.find((r) => r.kanal === 'Akquise')?.leads).toBe(1);
  });

  it('eine Bekanntmachung in Fremdwährung gibt ihren Wert nicht weiter', async () => {
    const quellId = `test-${zufall()}`;
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into ausschreibung (quelle, quell_id, titel, vergabestelle_name,
                                  wert_geschaetzt_cent, waehrung, rohdaten_hash)
       values ('ted', $1, 'Nettoyage', 'Administration', 500000, 'CHF', $1) returning id`,
      [quellId]);
    const l = await inR((k) => uebernimmAusschreibungAlsLead(k, a!.id, {
      auftraggeber: 'Administration des bâtiments publics', besitzerBenutzerId: chefR }));
    const [z] = await sql.unsafe<{ wert: string | null; firma_name: string }[]>(
      `select geschaetzter_wert_cent::text as wert, firma_name from lead where id = $1`, [l.id]);
    expect(z).toEqual({ wert: null, firma_name: 'Administration des bâtiments publics' });
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §5 — dieselbe Firma in zwei Gesellschaften (CRM-06)
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§5 die Firma hinter dem Kunden', () => {
  /** Die Abfrage der Gruppenliste, wörtlich aus `portal/gruppe/kunden/page.tsx`. */
  async function auchIn(kundeId: string): Promise<readonly string[] | null> {
    const [z] = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.security, f.bau, f.operations],
        benutzerId: gruppe, portal: 'intern', readonly: true },
      (tx: postgres.TransactionSql) => tx.unsafe(
        `select (select array_agg(m2.slug order by m2.sortierung)
                   from kunde k2 join mandant m2 on m2.id = k2.mandant_id
                  where k.firma_id is not null and k2.firma_id = k.firma_id
                    and k2.id <> k.id and k2.archiviert_am is null) as weitere_bereiche
           from kunde k where k.id = $1`, [kundeId])) as unknown as {
      weitere_bereiche: readonly string[] | null }[];
    return z?.weitere_bereiche ?? null;
  }

  it('gleiche USt-IdNr. in Reinigung und Security → eine Firma, „auch in" nennt die andere', async () => {
    const nummer = String(100000000 + Math.floor(Math.random() * 899999999));
    const r = await inR((k) => legeKundeAn(k, {
      name: 'Gemeinsam GmbH', typ: 'firma', rechtsgrundlage: 'keine', ustId: `DE${nummer}` }));
    const s = await inS((k) => legeKundeAn(k, {
      name: 'Gemeinsam Gebäudemanagement GmbH', typ: 'firma', rechtsgrundlage: 'keine',
      ustId: ` de ${nummer} ` }));
    const zeilen = await sql.unsafe<{ firma_id: string | null }[]>(
      `select firma_id::text as firma_id from kunde where id = any($1::uuid[])`,
      [[r.id, s.id]]);
    expect(zeilen[0]!.firma_id).not.toBeNull();
    expect(zeilen[0]!.firma_id).toBe(zeilen[1]!.firma_id);
    const [slug] = await sql.unsafe<{ slug: string }[]>(
      `select slug from mandant where id = $1`, [f.security]);
    expect(await auchIn(r.id)).toEqual([slug!.slug]);
  });

  it('ohne USt-IdNr. und für Privatpersonen entsteht keine Firma — ein Name ist keine Identität', async () => {
    const ohne = await inR((k) => legeKundeAn(k, {
      name: 'Namensgleich GmbH', typ: 'firma', rechtsgrundlage: 'keine' }));
    const privat = await inR((k) => legeKundeAn(k, {
      name: 'Erika Muster', typ: 'privat', rechtsgrundlage: 'keine', ustId: 'DE999999999' }));
    const zeilen = await sql.unsafe<{ firma_id: string | null }[]>(
      `select firma_id::text as firma_id from kunde where id = any($1::uuid[])`,
      [[ohne.id, privat.id]]);
    expect(zeilen.map((z) => z.firma_id)).toEqual([null, null]);
  });

  it('eine nachgereichte USt-IdNr. verbindet den Kunden — eine vorhandene Firma bleibt', async () => {
    const nummer = String(100000000 + Math.floor(Math.random() * 899999999));
    const k1 = await inR((k) => legeKundeAn(k, {
      name: 'Nachtrag GmbH', typ: 'firma', rechtsgrundlage: 'keine' }));
    await inR((k) => aendereKunde(k, {
      id: k1.id, name: 'Nachtrag GmbH', typ: 'firma', ustId: `DE${nummer}` }));
    const [z1] = await sql.unsafe<{ firma_id: string | null }[]>(
      `select firma_id::text as firma_id from kunde where id = $1`, [k1.id]);
    expect(z1!.firma_id).not.toBeNull();
    await inR((k) => aendereKunde(k, {
      id: k1.id, name: 'Nachtrag GmbH', typ: 'firma', ustId: 'DE123123123' }));
    const [z2] = await sql.unsafe<{ firma_id: string | null }[]>(
      `select firma_id::text as firma_id from kunde where id = $1`, [k1.id]);
    expect(z2!.firma_id).toBe(z1!.firma_id);
  });

  it('0401 holt den Bestand nach — mit derselben Regel, ohne Privatkunden und Anonymisierte', async () => {
    const nummer = String(100000000 + Math.floor(Math.random() * 899999999));
    const alt = async (mandant: string, typ: string, ust: string, anonym = false): Promise<string> => {
      const [z] = await sql.unsafe<{ id: string }[]>(
        `insert into kunde (mandant_id, kundennummer, typ, name, ust_id, anonymisiert_am,
                            ist_oeffentlicher_auftraggeber)
         values ($1, $2, $3::kunde_typ, 'Bestand GmbH', $4, $5, $3 = 'behoerde')
         returning id`,
        [mandant, `K-${zufall()}`, typ, ust, anonym ? new Date() : null]);
      return z!.id;
    };
    const a = await alt(f.reinigung, 'firma', `DE${nummer}`);
    const b = await alt(f.security, 'behoerde', ` de${nummer}`);
    const p = await alt(f.reinigung, 'privat', `DE${nummer}`);
    const x = await alt(f.bau, 'firma', `DE${nummer}`, true);
    await sql.unsafe(readFileSync(fileURLToPath(
      new URL('../../drizzle/0401_kunde_findet_seine_firma.sql', import.meta.url)), 'utf8'));
    const zeilen = await sql.unsafe<{ id: string; firma_id: string | null }[]>(
      `select id::text as id, firma_id::text as firma_id from kunde where id = any($1::uuid[])`,
      [[a, b, p, x]]);
    const firma = (id: string): string | null => zeilen.find((z) => z.id === id)?.firma_id ?? null;
    expect(firma(a)).not.toBeNull();
    expect(firma(b)).toBe(firma(a));
    expect(firma(p)).toBeNull();
    expect(firma(x)).toBeNull();
    const [fz] = await sql.unsafe<{ ust_id: string }[]>(
      `select ust_id from firma where id = $1`, [firma(a)]);
    expect(fz!.ust_id).toBe(`DE${nummer}`);
  });
});

/* Ein CrmFehler bleibt ein CrmFehler — die Route übersetzt seinen Schlüssel. */
describe('§6 die Fehler tragen Schlüssel, keine Stapelspur', () => {
  it('eine unbekannte Anfrage ist „nicht gefunden"', async () => {
    await expect(inR((k) => uebernehmeLeadAlsKunde(k, 'keine-kennung', { typ: 'firma' })))
      .rejects.toThrow(CrmFehler);
    await expect(inR((k) => uebernimmAusschreibungAlsLead(
      k, '00000000-0000-4000-8000-000000000000', { besitzerBenutzerId: chefR })))
      .rejects.toMatchObject({ grund: 'ausschreibung_unbekannt' });
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §7 — der Mensch hinter der Anfrage (V-141, D-635, O-907)
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§7 der Ansprechpartner der Anfrage — gewählt, angelegt, angesprochen', () => {
  /** Die Zeilen, die das UWG-Tor an einem Lead durchgelassen hat. */
  async function ausgehend(leadId: string): Promise<readonly {
    zweck: string; kanal: string | null; ansprechpartner_id: string | null;
  }[]> {
    return sql.unsafe<{ zweck: string; kanal: string | null; ansprechpartner_id: string | null }[]>(
      `select zweck::text as zweck, kanal, ansprechpartner_id::text as ansprechpartner_id
         from lead_aktivitaet where lead_id = $1 and richtung = 'ausgehend'`, [leadId]);
  }

  const anruf = { typ: 'anruf', richtung: 'ausgehend', inhalt: 'Rückruf wegen des Angebots' };

  /**
   * Ein Web-Lead wie aus der Annahme — mit Eingang (`lead_herkunft_stimmig`)
   * und einem Kontakt OHNE Werbegrundlage: die Antwort auf die Anfrage darf
   * trotzdem hinaus, denn sie ist vertraglich (D-631).
   */
  async function webLead(): Promise<{ leadId: string; kontaktId: string }> {
    const schluessel = `kette_${zufall()}`;
    const [d] = await sql.unsafe<{ id: string }[]>(
      `insert into formular_definition (mandant_id, schluessel, titel, felder,
                                        datenschutz_hinweis_version)
       values ($1, $2, 'Anfrage', '[]'::jsonb, 'v1') returning id`, [f.reinigung, schluessel]);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into formular_eingang (mandant_id, formular_definition_id, daten,
                                     datenschutz_hinweis_bestaetigt, datenschutz_hinweis_version)
       values ($1, $2, '{}'::jsonb, true, 'v1') returning id`, [f.reinigung, d!.id]);
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into ansprechpartner (mandant_id, kunde_id, nachname, email)
       values ($1, null, 'Webanfragende', $2) returning id`,
      [f.reinigung, `web-${zufall()}@beispiel.test`]);
    const [l] = await sql.unsafe<{ id: string }[]>(
      `insert into lead (mandant_id, leadnummer, quelle, formular_eingang_id, firma_name, betreff,
                         besitzer_benutzer_id, ansprechpartner_id)
       values ($1, $2, 'webformular', $3, 'Netzfirma GmbH', 'Anfrage aus dem Netz', $4, $5)
       returning id`, [f.reinigung, `L-${zufall()}`, e!.id, chefR, a!.id]);
    return { leadId: l!.id, kontaktId: a!.id };
  }

  it('ein Lead von Hand bekommt einen Kontakt, und ausgehend geht er als Werbung durchs Tor', async () => {
    const l = await inR((k) => legeLeadAn(k, {
      betreff: 'Anruf von Frau Ohnekunde', firmaName: 'Ohnekunde GmbH', besitzerBenutzerId: chefR }));
    // Vorher: kein Kontakt, also kein ausgehender Anruf.
    await expect(inR((k) => halteLeadAktivitaetFest(k, l.id, { ...anruf, benutzerId: chefR })))
      .rejects.toMatchObject({ grund: 'kein_kontakt' });

    const neu = await inR((k) => legeLeadKontaktAn(k, l.id, {
      vorname: 'Olga', nachname: 'Ohnekunde', email: `olga-${zufall()}@ohnekunde.test`,
      telefon: '+49 30 1234' }));
    expect(neu.vorhanden).toBe(false);
    expect((await lead(l.id)).ansprechpartner_id).toBe(neu.id);
    const [ap] = await sql.unsafe<{ kunde_id: string | null; rechtsgrundlage: string }[]>(
      `select kunde_id::text as kunde_id, rechtsgrundlage::text as rechtsgrundlage
         from ansprechpartner where id = $1`, [neu.id]);
    // Ohne Kunden, ohne Werbegrundlage — die setzt ein Mensch mit Quelle und Datum.
    expect(ap).toEqual({ kunde_id: null, rechtsgrundlage: 'keine' });
    expect(await systemzeilen(l.id)).toContain('Ansprechpartner angelegt: Olga Ohnekunde');

    /*
     * **Der Kern von O-907.** Eine Erfassung von Hand ist (noch) keine
     * Anfrage des Kontakts: der Anruf geht als `werbung` durch das Tor, und
     * ohne Grundlage weist es ihn ab. Nichts wird festgehalten, die
     * Reaktionsuhr läuft weiter.
     */
    await expect(inR((k) => halteLeadAktivitaetFest(k, l.id, { ...anruf, benutzerId: chefR })))
      .rejects.toMatchObject({ grund: 'uwg_werbung' });
    expect(await ausgehend(l.id)).toEqual([]);

    // Mit festgestellter Grundlage (Quelle, Datum) geht er durch — als Werbung belegt.
    await sql.unsafe(
      `update ansprechpartner set rechtsgrundlage = 'anfrage',
              rechtsgrundlage_quelle = 'Telefonat am Empfang', rechtsgrundlage_erfasst_am = now()
        where id = $1`, [neu.id]);
    await inR((k) => halteLeadAktivitaetFest(k, l.id, { ...anruf, benutzerId: chefR }));
    expect(await ausgehend(l.id)).toEqual([
      { zweck: 'werbung', kanal: 'telefon', ansprechpartner_id: neu.id }]);
    const [uhr] = await sql.unsafe<{ erste_reaktion_am: Date | null }[]>(
      `select erste_reaktion_am from lead where id = $1`, [l.id]);
    expect(uhr!.erste_reaktion_am).not.toBeNull();

    // Und er wandert mit, sobald die Anfrage ihren Kunden bekommt.
    const kd = await inR((k) => uebernehmeLeadAlsKunde(k, l.id, { typ: 'firma' }));
    const [danach] = await sql.unsafe<{ kunde_id: string }[]>(
      `select kunde_id::text as kunde_id from ansprechpartner where id = $1`, [neu.id]);
    expect(danach!.kunde_id).toBe(kd.kundeId);
  });

  it('ein Web-Lead antwortet vertraglich — derselbe Kontakt ohne Werbegrundlage kommt durch', async () => {
    const { leadId, kontaktId } = await webLead();
    await inR((k) => halteLeadAktivitaetFest(k, leadId, { ...anruf, benutzerId: chefR }));
    expect(await ausgehend(leadId)).toEqual([
      { zweck: 'vertraglich', kanal: 'telefon', ansprechpartner_id: kontaktId }]);
    // Eine Notiz bleibt intern, gleich was das Formular als Richtung schickt.
    await inR((k) => halteLeadAktivitaetFest(k, leadId, {
      typ: 'notiz', richtung: 'ausgehend', inhalt: 'Nur fürs Haus', benutzerId: chefR }));
    expect(await ausgehend(leadId)).toHaveLength(1);
    // Nach einem Widerspruch hält auch die vertragliche Antwort nichts fest.
    await sql.unsafe(`update ansprechpartner set widerspruch_am = now() where id = $1`,
      [kontaktId]);
    await expect(inR((k) => halteLeadAktivitaetFest(k, leadId, { ...anruf, benutzerId: chefR })))
      .rejects.toMatchObject({ grund: 'uwg' });
  });

  it('gewählt wird nur ein erreichbarer Kontakt des eigenen Kunden', async () => {
    const { kundeId, andererKunde, leadId } = await inR(async (k) => {
      const kundeId = await kunde(k, 'Wahl GmbH');
      const andererKunde = await kunde(k, 'Nachbar GmbH');
      const l = await legeLeadAn(k, { betreff: 'Wahl', kundeId, besitzerBenutzerId: chefR });
      return { kundeId, andererKunde, leadId: l.id };
    });
    const kontakt = async (kd: string, ausgeschieden = false): Promise<string> => {
      const [a] = await sql.unsafe<{ id: string }[]>(
        `insert into ansprechpartner (mandant_id, kunde_id, nachname, ausgeschieden_am)
         values ($1, $2, $3, $4) returning id`,
        [f.reinigung, kd, `Kontakt ${zufall()}`, ausgeschieden ? new Date() : null]);
      return a!.id;
    };
    const eigener = await kontakt(kundeId);
    const gegangen = await kontakt(kundeId, true);
    const fremder = await kontakt(andererKunde);
    const securityKontakt = await inS(async (k) => {
      const kd = await kunde(k, 'Security-Wahl GmbH');
      const [a] = await k.schreibe<{ id: string }>(
        `insert into ansprechpartner (mandant_id, kunde_id, nachname)
         values (app.aktiver_mandant(), $1::uuid, 'Fremd') returning id::text as id`, [kd]);
      return a!.id;
    });

    // Die Wahl nennt nur den erreichbaren Kontakt des eigenen Kunden.
    expect((await inR((k) => leseLeadKontaktWahl(k, leadId))).map((z) => z.id)).toEqual([eigener]);
    await expect(inR((k) => waehleLeadKontakt(k, leadId, fremder)))
      .rejects.toMatchObject({ grund: 'kontakt_fremd' });
    await expect(inR((k) => waehleLeadKontakt(k, leadId, gegangen)))
      .rejects.toMatchObject({ grund: 'kontakt_ausgeschieden' });
    await expect(inR((k) => waehleLeadKontakt(k, leadId, securityKontakt)))
      .rejects.toMatchObject({ grund: 'kontakt_unbekannt' });
    await inR((k) => waehleLeadKontakt(k, leadId, eigener));
    expect((await lead(leadId)).ansprechpartner_id).toBe(eigener);
    // Dieselbe Wahl noch einmal ist keine Änderung und keine zweite Systemzeile.
    await inR((k) => waehleLeadKontakt(k, leadId, eigener));
    expect((await systemzeilen(leadId)).filter((z) => z.startsWith('Ansprechpartner:')))
      .toHaveLength(1);
  });

  it('eine bekannte E-Mail-Adresse ist ein bekannter Mensch — kein zweiter Kontakt', async () => {
    const email = `bekannt-${zufall()}@beispiel.test`;
    const { kundeId, leadId, vorhandener } = await inR(async (k) => {
      const kundeId = await kunde(k, 'Bekannt GmbH');
      const [a] = await k.schreibe<{ id: string }>(
        `insert into ansprechpartner (mandant_id, kunde_id, nachname, email)
         values (app.aktiver_mandant(), $1::uuid, 'Bekannt', $2) returning id::text as id`,
        [kundeId, email]);
      const l = await legeLeadAn(k, { betreff: 'Bekannt', kundeId, besitzerBenutzerId: chefR });
      return { kundeId, leadId: l.id, vorhandener: a!.id };
    });
    const r = await inR((k) => legeLeadKontaktAn(k, leadId, {
      nachname: 'Anders geschrieben', email: email.toUpperCase() }));
    expect(r).toEqual({ id: vorhandener, vorhanden: true });
    expect((await lead(leadId)).ansprechpartner_id).toBe(vorhandener);
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from ansprechpartner
        where kunde_id = $1 and lower(email) = lower($2)`, [kundeId, email]);
    expect(n!.n).toBe(1);
    await expect(inR((k) => legeLeadKontaktAn(k, leadId, { nachname: ' ' })))
      .rejects.toMatchObject({ grund: 'nachname_fehlt' });
    await expect(inR((k) => legeLeadKontaktAn(k, leadId, { nachname: 'X', email: 'kein-at' })))
      .rejects.toMatchObject({ grund: 'email_ungueltig' });
  });

  it('wurde dem Anfragenden widersprochen, bleibt die Anfrage bei ihm — auch neben einem Zwilling', async () => {
    const email = `widerspruch-${zufall()}@beispiel.test`;
    const { leadId, kontaktId } = await inR(async (k) => {
      const l = await legeLeadAn(k, {
        betreff: 'Widerspruch', firmaName: 'Widerspruch GmbH', besitzerBenutzerId: chefR });
      const [a] = await k.schreibe<{ id: string }>(
        `insert into ansprechpartner (mandant_id, kunde_id, nachname, email)
         values (app.aktiver_mandant(), null, 'Anfragende', $1) returning id::text as id`,
        [email]);
      await k.schreibe(`update lead set ansprechpartner_id = $2::uuid where id = $1::uuid`,
        [l.id, a!.id]);
      return { leadId: l.id, kontaktId: a!.id };
    });
    await sql.unsafe(`update ansprechpartner set widerspruch_am = now() where id = $1`,
      [kontaktId]);
    const kundeId = await inR(async (k) => {
      const kd = await kunde(k, 'Zwilling GmbH');
      await k.schreibe(
        `insert into ansprechpartner (mandant_id, kunde_id, nachname, email)
         values (app.aktiver_mandant(), $1::uuid, 'Zwilling', $2)`, [kd, email]);
      return kd;
    });
    await inR((k) => ordneLeadKundeZu(k, leadId, kundeId));
    const l = await lead(leadId);
    expect(l.kunde_id).toBe(kundeId);
    // Nicht auf den Zwilling ohne Vermerk umgestellt — der Widerspruch gilt weiter.
    expect(l.ansprechpartner_id).toBe(kontaktId);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §8 — die Kette hält auch im Rennen, nach dem Archiv und beim Berichtigen
 *      (V-142, D-636)
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§8 Rennen, Archiv, Berichtigung, Land', () => {
  /** Hält eine Transaktion offen, bis der Test sie freigibt. */
  function schleuse(): { tor: Promise<void>; oeffne: () => void } {
    let oeffne!: () => void;
    const tor = new Promise<void>((r) => { oeffne = r; });
    return { tor, oeffne };
  }
  const warte = (ms: number): Promise<'wartet'> =>
    new Promise((r) => { setTimeout(() => r('wartet'), ms); });
  const stand = <T,>(p: Promise<T>): Promise<'fertig' | 'abgewiesen'> =>
    p.then(() => 'fertig' as const, () => 'abgewiesen' as const);

  it('ein Angebot wartet auf ein gleichzeitiges Umhängen und liest danach den neuen Kunden', async () => {
    const { a, b, leadId } = await inR(async (k) => {
      const a = await kunde(k, 'Rennen A GmbH');
      const b = await kunde(k, 'Rennen B GmbH');
      const l = await legeLeadAn(k, { betreff: 'Rennen', kundeId: a, besitzerBenutzerId: chefR });
      return { a, b, leadId: l.id };
    });
    const umgehaengt = schleuse();
    const halten = schleuse();
    const umhaengen = inR(async (k) => {
      await ordneLeadKundeZu(k, leadId, b);
      umgehaengt.oeffne();
      await halten.tor;
    });
    await umgehaengt.tor;
    /*
     * Die Vorprüfung des Dienstes sieht noch Kunde A (das Umhängen ist nicht
     * festgeschrieben). Ohne Sperre im Auslöser (0400) hätte er A ebenfalls
     * gelesen, und danach stünde ein Angebot für A an einer Anfrage von B.
     */
    const angebot = inR((k) => legeAngebotAn(k, { kundeId: a, titel: 'Zu spät', leadId }));
    expect(await Promise.race([stand(angebot), warte(400)])).toBe('wartet');
    halten.oeffne();
    await umhaengen;
    await expect(angebot).rejects.toMatchObject({ code: '23514' });
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from angebot where lead_id = $1`, [leadId]);
    expect(n!.n).toBe(0);
    expect((await lead(leadId)).kunde_id).toBe(b);
  });

  it('dieselbe neue USt-IdNr. im selben Augenblick in zwei Gesellschaften — eine Firma, kein Fehler', async () => {
    const nummer = String(100000000 + Math.floor(Math.random() * 899999999));
    const angelegt = schleuse();
    const halten = schleuse();
    const reinigung = inR(async (k) => {
      const neu = await legeKundeAn(k, {
        name: 'Gleichzeitig GmbH', typ: 'firma', rechtsgrundlage: 'keine', ustId: `DE${nummer}` });
      angelegt.oeffne();
      await halten.tor;
      return neu;
    });
    await angelegt.tor;
    const security = inS((k) => legeKundeAn(k, {
      name: 'Gleichzeitig Sicherheit GmbH', typ: 'firma', rechtsgrundlage: 'keine',
      ustId: `DE${nummer}` }));
    // Die Security wartet am Eindeutigkeitsschlüssel der Firma …
    expect(await Promise.race([stand(security), warte(400)])).toBe('wartet');
    halten.oeffne();
    // … und findet sie danach, statt mit 23505 abzubrechen.
    const [r, s] = await Promise.all([reinigung, security]);
    const zeilen = await sql.unsafe<{ id: string; firma_id: string | null }[]>(
      `select id::text as id, firma_id::text as firma_id from kunde where id = any($1::uuid[])`,
      [[r.id, s.id]]);
    const firma = zeilen.map((z) => z.firma_id);
    expect(firma[0]).not.toBeNull();
    expect(firma[0]).toBe(firma[1]);
    const [anzahl] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from firma where ust_id = $1`, [`DE${nummer}`]);
    expect(anzahl!.n).toBe(1);
  });

  it('das Land des Kunden geht an seine Firma — dieselbe Regel wie 0401', async () => {
    const nummer = String(10000000 + Math.floor(Math.random() * 89999999));
    const k1 = await inR((k) => legeKundeAn(k, {
      name: 'Wiener Gebäude GmbH', typ: 'firma', rechtsgrundlage: 'keine' }));
    await inR((k) => aendereKunde(k, {
      id: k1.id, name: 'Wiener Gebäude GmbH', typ: 'firma', ustId: `ATU${nummer}`, land: 'AT' }));
    const [z] = await sql.unsafe<{ land: string }[]>(
      `select f.land from kunde k join firma f on f.id = k.firma_id where k.id = $1`, [k1.id]);
    expect(z!.land).toBe('AT');
  });

  it('ein archivierter Lead gibt die Bekanntmachung frei — ein laufender nicht', async () => {
    const quellId = `test-${zufall()}`;
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into ausschreibung (quelle, quell_id, titel, vergabestelle_name, rohdaten_hash)
       values ('oeffentlichevergabe', $1, 'Glasreinigung Schule', 'Schulamt Test', $1)
       returning id`, [quellId]);
    const erster = await inR((k) => uebernimmAusschreibungAlsLead(k, a!.id, {
      besitzerBenutzerId: chefR }));
    await sql.unsafe(`update lead set archiviert_am = now() where id = $1`, [erster.id]);
    const zweiter = await inR((k) => uebernimmAusschreibungAlsLead(k, a!.id, {
      besitzerBenutzerId: chefR }));
    expect(zweiter.id).not.toBe(erster.id);
    await expect(inR((k) => uebernimmAusschreibungAlsLead(k, a!.id, {
      besitzerBenutzerId: chefR }))).rejects.toMatchObject({ grund: 'schon_uebernommen' });
    // Am Dienst vorbei hält der Schlüssel den zweiten LAUFENDEN Lead (0402).
    await expect(sql.unsafe(
      `insert into lead (mandant_id, leadnummer, quelle, ausschreibung_id, firma_name, betreff,
                         besitzer_benutzer_id)
       values ($1, $2, 'vergabe_radar', $3, 'X', 'X', $4)`,
      [f.reinigung, `L-${zufall()}`, a!.id, chefR])).rejects.toMatchObject({ code: '23505' });
  });

  it('ein falsch zugeordneter Kunde wird berichtigt — bis ein Vorgang daran hängt, auch ein zurückgezogener', async () => {
    const { a, b, leadId, nummern } = await inR(async (k) => {
      const a = await legeKundeAn(k, { name: 'Falsch GmbH', typ: 'firma', rechtsgrundlage: 'keine' });
      const b = await legeKundeAn(k, { name: 'Richtig GmbH', typ: 'firma', rechtsgrundlage: 'keine' });
      const l = await legeLeadAn(k, { betreff: 'Berichtigung', kundeId: a.id, besitzerBenutzerId: chefR });
      return { a: a.id, b: b.id, leadId: l.id, nummern: [a.kundennummer, b.kundennummer] };
    });
    await inR((k) => ordneLeadKundeZu(k, leadId, b));
    expect((await lead(leadId)).kunde_id).toBe(b);
    expect(await systemzeilen(leadId))
      .toContain(`Kunde berichtigt: ${nummern[1]!} statt ${nummern[0]!}`);

    // Ein Entwurf — auch zurückgezogen — trägt Kunde und Anfrage: danach bleibt der Kunde.
    const angebotId = await inR((k) => handAngebot(k, b, leadId));
    await inR((k) => ziehEntwurfZurueck(k, angebotId, chefR));
    await expect(inR((k) => ordneLeadKundeZu(k, leadId, a)))
      .rejects.toMatchObject({ grund: 'lead_hat_vorgaenge' });
    expect((await lead(leadId)).kunde_id).toBe(b);
  });

  it('eine Rolle, die das Angebot nicht sehen darf, bekommt am Auslöser trotzdem einen Satz', async () => {
    const bauAdmin = await konto(`kette-ba-${zufall()}@cse.test`);
    await mitglied(bauAdmin, f.bau, 'admin');
    const bauLeitung = await konto(`kette-bl-${zufall()}@cse.test`);
    await mitglied(bauLeitung, f.bau, 'leitung');
    // Im Bau hält die Leitung CRM, aber weder Angebote noch Aufträge.
    for (const recht of ['angebot.lesen', 'auftrag.lesen']) {
      await sql.unsafe(
        `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
         values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
                 (select id from berechtigung where schluessel = $1), $2, false)
         on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = false`,
        [recht, f.bau]);
    }
    const { leadId, andererKunde } = await imKontext(f.bau, bauAdmin, async (k) => {
      const a = await kunde(k, 'Bau A GmbH');
      const andererKunde = await kunde(k, 'Bau B GmbH');
      const l = await legeLeadAn(k, { betreff: 'Rohbau', kundeId: a, besitzerBenutzerId: bauAdmin });
      await handAngebot(k, a, l.id, 'Rohbau');
      return { leadId: l.id, andererKunde };
    });
    // Die Leitung sieht das Angebot nicht — die Vorprüfung des Dienstes also auch nicht …
    const [sichtbar] = await imKontext(f.bau, bauLeitung, (k) => k.abfrage<{ n: number }>(
      `select count(*)::int as n from angebot where lead_id = $1::uuid`, [leadId]));
    expect(sichtbar!.n).toBe(0);
    // … der Auslöser schon, und aus seinem 23514 wird der Satz des Dienstes.
    await expect(imKontext(f.bau, bauLeitung, (k) => ordneLeadKundeZu(k, leadId, andererKunde)))
      .rejects.toMatchObject({ grund: 'lead_hat_vorgaenge' });
    await expect(imKontext(f.bau, bauLeitung, (k) => ordneLeadKundeZu(k, leadId, andererKunde)))
      .rejects.toThrow(CrmFehler);
  });
});
