import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  CrmFehler, legeKontaktAn, legeKundeAn, legeLeadAn, setzeLeadStatus,
} from '../../src/server/services/crm/anlegen.js';

/**
 * Kunde, Kontakt und Lead von Hand anlegen (CRM-01, CRM-03, CRM-07).
 *
 * **Der Schwerpunkt liegt auf der RECHTSGRUNDLAGE**, und das ist kein
 * Formalismus: aus diesem einen Feld zieht `app.darf_kontaktiert_werden` seine
 * Antwort, und die entscheidet, ob eine Werbenachricht hinausgeht oder in der
 * Datenbank abgewiesen wird (§7 UWG, LEG-08). Geprüft wird deshalb nicht nur,
 * DASS sie gespeichert wird, sondern dass die Kette bis zum Tor durchschlägt:
 * ein frisch angelegter Kontakt ohne Grundlage ist nachweislich nicht
 * anschreibbar, einer mit Einwilligung genau auf den Kanälen, für die sie gilt.
 */

let f: Fixtur;
let benutzer: string;

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('vertrieb@crm.test') returning id`);
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'vertrieb@crm.test', 'Vertrieb', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [benutzer]);
  for (const m of [f.reinigung, f.security]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null),
               $3)`,
      [benutzer, m, m === f.reinigung]);
  }
});
afterAll(schliessen);

type Abfrager = { unsafe(s: string, w?: readonly unknown[]): Promise<readonly unknown[]> };

function kontextAus(tx: Abfrager, mandantId: string) {
  return {
    aktiverMandantId: mandantId,
    benutzerId: benutzer,
    abfrage: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
    schreibe: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
  } as never;
}

function sitzung(mandantId = f.reinigung) {
  return { scope: 'mandant' as const, mandantId, benutzerId: benutzer,
           readonly: false, portal: 'intern' as const };
}

describe('§1 die Kundennummer', () => {
  it('zählt hoch und bleibt eindeutig', async () => {
    const a = await alsApp(sitzung(), (tx) => legeKundeAn(kontextAus(tx, f.reinigung), {
      name: 'Erster Kunde GmbH', typ: 'firma', rechtsgrundlage: 'keine',
    }));
    const b = await alsApp(sitzung(), (tx) => legeKundeAn(kontextAus(tx, f.reinigung), {
      name: 'Zweiter Kunde GmbH', typ: 'firma', rechtsgrundlage: 'keine',
    }));
    expect(a.kundennummer).toMatch(/^K-\d{5}$/u);
    expect(b.kundennummer).not.toBe(a.kundennummer);
  });

  it('zählt JE GESELLSCHAFT — nicht plattformweit', async () => {
    /*
     * Die Nummer steht auf Papier, das ein Kunde bekommt. Dass die Reinigung
     * bei K-00001 anfaengt und die Security auch, ist richtig: es sind zwei
     * Unternehmen. Ein plattformweiter Zaehler verriete ausserdem, wie viele
     * Kunden die Schwestergesellschaft hat.
     */
    const [{ kundennummer: sec }] = await Promise.all([
      alsApp(sitzung(f.security), (tx) => legeKundeAn(kontextAus(tx, f.security), {
        name: 'Security-Kunde GmbH', typ: 'firma', rechtsgrundlage: 'keine',
      })),
    ]);
    const [z] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from kunde
        where mandant_id = $1 and kundennummer = $2`, [f.reinigung, sec]);
    expect(z!.n).toBeLessThanOrEqual(1);
  });
});

describe('§2 die Rechtsgrundlage — das Feld, das das UWG-Tor speist', () => {
  it('nimmt „keine" ohne Quelle an — das ist der sichere Zweig', async () => {
    await expect(alsApp(sitzung(), (tx) => legeKundeAn(kontextAus(tx, f.reinigung), {
      name: 'Ohne Grundlage GmbH', typ: 'firma', rechtsgrundlage: 'keine',
    }))).resolves.toBeTruthy();
  });

  it('WEIST eine Grundlage OHNE Quelle ab', async () => {
    await expect(alsApp(sitzung(), (tx) => legeKundeAn(kontextAus(tx, f.reinigung), {
      name: 'Behauptete Einwilligung GmbH', typ: 'firma',
      rechtsgrundlage: 'einwilligung',
    }))).rejects.toThrow(CrmFehler);
  });

  it('ein Kontakt OHNE Grundlage ist nachweislich nicht anschreibbar', async () => {
    const kunde = await alsApp(sitzung(), (tx) => legeKundeAn(kontextAus(tx, f.reinigung), {
      name: 'Tor-Test GmbH', typ: 'firma', rechtsgrundlage: 'keine',
    }));
    const kontaktId = await alsApp(sitzung(), (tx) =>
      legeKontaktAn(kontextAus(tx, f.reinigung), {
        kundeId: kunde.id, nachname: 'Ohnegrund', rechtsgrundlage: 'keine',
      }));

    /*
     * **Die eigentliche Pruefung dieser Datei.** Nicht „wurde gespeichert",
     * sondern „schlaegt bis zum Tor durch".
     */
    const [z] = await alsApp(sitzung(), (tx) => tx.unsafe(
      `select app.darf_kontaktiert_werden($1::uuid, 'email', 'werbung') as darf`,
      [kontaktId])) as unknown as { darf: boolean }[];
    expect(z!.darf).toBe(false);
  });

  it('eine Einwilligung gilt NUR auf den genannten Kanälen', async () => {
    const kunde = await alsApp(sitzung(), (tx) => legeKundeAn(kontextAus(tx, f.reinigung), {
      name: 'Einwilligung GmbH', typ: 'firma',
      rechtsgrundlage: 'einwilligung', grundlageQuelle: 'Häkchen im Formular vom 12.03.',
    }));
    const kontaktId = await alsApp(sitzung(), (tx) =>
      legeKontaktAn(kontextAus(tx, f.reinigung), {
        kundeId: kunde.id, nachname: 'Mitgrund',
        rechtsgrundlage: 'einwilligung',
        grundlageQuelle: 'Häkchen im Formular vom 12.03.',
        einwilligungKanaele: ['email'],
      }));

    const [z] = await alsApp(sitzung(), (tx) => tx.unsafe(
      `select app.darf_kontaktiert_werden($1::uuid, 'email', 'werbung') as per_mail,
              app.darf_kontaktiert_werden($1::uuid, 'telefon', 'werbung') as per_telefon`,
      [kontaktId])) as unknown as { per_mail: boolean; per_telefon: boolean }[];
    expect(z!.per_mail).toBe(true);
    /* Wofuer nicht eingewilligt wurde, ist gesperrt — auch wenn eine Grundlage steht. */
    expect(z!.per_telefon).toBe(false);
  });

  it('weist eine Einwilligung OHNE Kanal ab — sie wäre eine Einwilligung in nichts', async () => {
    const kunde = await alsApp(sitzung(), (tx) => legeKundeAn(kontextAus(tx, f.reinigung), {
      name: 'Kanallos GmbH', typ: 'firma', rechtsgrundlage: 'keine',
    }));
    await expect(alsApp(sitzung(), (tx) => legeKontaktAn(kontextAus(tx, f.reinigung), {
      kundeId: kunde.id, nachname: 'Kanallos',
      rechtsgrundlage: 'einwilligung', grundlageQuelle: 'irgendwo',
      einwilligungKanaele: [],
    }))).rejects.toThrow(/Einwilligung in nichts/u);
  });
});

describe('§3 „Behörde" setzt den öffentlichen Auftraggeber', () => {
  it('weil davon die XRechnungspflicht abhängt', async () => {
    const k = await alsApp(sitzung(), (tx) => legeKundeAn(kontextAus(tx, f.reinigung), {
      name: 'Bezirksamt Mitte', typ: 'behoerde', rechtsgrundlage: 'keine',
    }));
    const [z] = await sql.unsafe<{ oeff: boolean }[]>(
      `select ist_oeffentlicher_auftraggeber as oeff from kunde where id = $1`, [k.id]);
    expect(z!.oeff).toBe(true);
  });
});

describe('§4 der Lead von Hand', () => {
  it('trägt quelle = manuell und KEINE Frist', async () => {
    const l = await alsApp(sitzung(), (tx) => legeLeadAn(kontextAus(tx, f.reinigung), {
      betreff: 'Anruf: Unterhaltsreinigung Bürohaus',
      firmaName: 'Anrufer GmbH', besitzerBenutzerId: benutzer,
    }));
    const [z] = await sql.unsafe<{
      quelle: string; sla: Date | null; erste: Date | null;
    }[]>(
      `select quelle::text as quelle, sla_frist_am as sla, erste_reaktion_am as erste
         from lead where id = $1`, [l.id]);
    expect(z!.quelle).toBe('manuell');
    /*
     * Keine Frist: `sla_stunden` haengt an einem Formular. Eine zu erfinden
     * hiesse, eine Geschaeftsregel per Vorgabewert zu waehlen (O-14).
     */
    expect(z!.sla).toBeNull();
    /* Und die Eingangsnotiz ist `intern` — sonst gilt er sofort als beantwortet. */
    expect(z!.erste).toBeNull();
  });

  it('verlangt einen Namen — Kunde ODER Firma', async () => {
    await expect(alsApp(sitzung(), (tx) => legeLeadAn(kontextAus(tx, f.reinigung), {
      betreff: 'Namenlos', besitzerBenutzerId: benutzer,
    }))).rejects.toThrow(/Namen/u);
  });
});

describe('§5 der Stand eines Leads', () => {
  it('verlangt bei BEIDEN Verlustzuständen einen Grund', async () => {
    for (const status of ['verloren', 'kein_bedarf']) {
      const l = await alsApp(sitzung(), (tx) => legeLeadAn(kontextAus(tx, f.reinigung), {
        betreff: `Verlust ${status}`, firmaName: 'Verlust GmbH',
        besitzerBenutzerId: benutzer,
      }));
      await expect(alsApp(sitzung(), (tx) =>
        setzeLeadStatus(kontextAus(tx, f.reinigung), l.id, status)),
      ).rejects.toThrow(CrmFehler);
    }
  });

  it('stempelt bei „gewonnen" den Zeitpunkt', async () => {
    const l = await alsApp(sitzung(), (tx) => legeLeadAn(kontextAus(tx, f.reinigung), {
      betreff: 'Gewonnen', firmaName: 'Gewinner GmbH', besitzerBenutzerId: benutzer,
    }));
    await alsApp(sitzung(), (tx) =>
      setzeLeadStatus(kontextAus(tx, f.reinigung), l.id, 'gewonnen'));
    const [z] = await sql.unsafe<{ k: Date | null }[]>(
      `select konvertiert_am as k from lead where id = $1`, [l.id]);
    expect(z!.k).not.toBeNull();
  });
});

describe('§6 Mandantentrennung', () => {
  it('ein Kunde der Reinigung ist für die Security unsichtbar', async () => {
    const k = await alsApp(sitzung(), (tx) => legeKundeAn(kontextAus(tx, f.reinigung), {
      name: 'Nur Reinigung GmbH', typ: 'firma', rechtsgrundlage: 'keine',
    }));
    const zeilen = await alsApp(sitzung(f.security), (tx) => tx.unsafe(
      `select id from kunde where id = $1::uuid`, [k.id])) as unknown as { id: string }[];
    expect(zeilen.length).toBe(0);
  });
});
