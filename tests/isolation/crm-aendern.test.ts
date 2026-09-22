import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { CrmFehler, legeKontaktAn, legeKundeAn } from '../../src/server/services/crm/anlegen.js';
import {
  aendereKontakt, aendereKunde, archiviereKunde, scheideKontaktAus, setzeKundeStatus,
} from '../../src/server/services/crm/aendern.js';

/**
 * Kunden und Ansprechpartner ändern (V-017, V-018, V-019, V-087).
 *
 * **Der teuerste Fall steht in §2 und hat nichts mit „geht es" zu tun.**
 * `cse_app` darf `debitorennummer`, `zahlungsziel_tage`, `mahnsperre_bis` und
 * `mahnsperre_grund` schreiben, aber **nicht lesen** (K-05). Ein
 * Änderungsformular, das den ganzen Datensatz zurückschreibt, überschreibt
 * sie deshalb mit `null` — es hat sie ja nie gesehen.
 *
 * Und es fällt niemandem auf: der Kunde sieht danach richtig aus, die
 * Mahnsperre ist weg, und die nächste Mahnung geht an einen Kunden, mit dem
 * gerade verhandelt wird. Der Fall prüft deshalb nicht, was `aendereKunde`
 * TUT, sondern was es **unberührt lässt**.
 */

let f: Fixtur;
let benutzer: string;
const zufall = (): string => String(Math.random()).slice(2, 10);

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('crm-aendern@cse.test') returning id`);
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'crm-aendern@cse.test', 'CRM', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [benutzer]);
  for (const m of [f.reinigung, f.security]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1,$2,(select id from rolle where schluessel='admin' and mandant_id is null),$3)`,
      [benutzer, m, m === f.reinigung]);
  }
});
afterAll(schliessen);

type Abfrager = { unsafe(s: string, w?: readonly unknown[]): Promise<readonly unknown[]> };

function kontextAus(tx: Abfrager, mandantId: string) {
  return {
    aktiverMandantId: mandantId,
    benutzerId: benutzer,
    abfrage: async <T,>(s: string, w: readonly unknown[] = []) => (await tx.unsafe(s, w)) as readonly T[],
    schreibe: async <T,>(s: string, w: readonly unknown[] = []) => (await tx.unsafe(s, w)) as readonly T[],
  } as never;
}

function sitzung(mandantId = f.reinigung) {
  return { scope: 'mandant' as const, mandantId, benutzerId: benutzer,
           readonly: false, portal: 'intern' as const };
}

const neuerKunde = async (name = 'Muster GmbH'): Promise<string> => {
  const k = await alsApp(sitzung(), (tx) => legeKundeAn(kontextAus(tx, f.reinigung), {
    name, typ: 'firma', rechtsgrundlage: 'keine',
  }));
  return k.id;
};

describe('§1 die Stammdaten sind nicht mehr in Stein', () => {
  it('ändert Name, Art und Anschrift', async () => {
    const id = await neuerKunde('Vorher GmbH');
    await alsApp(sitzung(), (tx) => aendereKunde(kontextAus(tx, f.reinigung), {
      id, name: 'Nachher GmbH', typ: 'firma', strasse: 'Neue Strasse', ort: 'Berlin',
    }));
    const [z] = await sql.unsafe<{ name: string; strasse: string | null }[]>(
      `select name, strasse from kunde where id = $1`, [id]);
    expect(z!.name).toBe('Nachher GmbH');
    expect(z!.strasse).toBe('Neue Strasse');
  });

  it('„Behörde" setzt `ist_oeffentlicher_auftraggeber` MIT — ein Feld, nicht zwei', async () => {
    /*
     * Davon haengt ab, ob eine Rechnung als XRechnung gestellt werden muss.
     * Zwei Felder, die dasselbe sagen koennen und auseinanderlaufen duerfen,
     * sind ein Fehler mit Ansage.
     */
    const id = await neuerKunde('Wird Behörde');
    await alsApp(sitzung(), (tx) => aendereKunde(kontextAus(tx, f.reinigung), {
      id, name: 'Bezirksamt', typ: 'behoerde',
    }));
    const [z] = await sql.unsafe<{ oeff: boolean }[]>(
      `select ist_oeffentlicher_auftraggeber as oeff from kunde where id = $1`, [id]);
    expect(z!.oeff).toBe(true);
  });

  it('WEIST einen leeren Namen ab', async () => {
    const id = await neuerKunde();
    await expect(alsApp(sitzung(), (tx) => aendereKunde(kontextAus(tx, f.reinigung), {
      id, name: '   ', typ: 'firma',
    }))).rejects.toThrow(CrmFehler);
  });

  it('ein Kunde der Reinigung ist aus der Security nicht änderbar (Invariante 3)', async () => {
    const id = await neuerKunde('Nur Reinigung');
    await expect(alsApp(sitzung(f.security), (tx) =>
      aendereKunde(kontextAus(tx, f.security), { id, name: 'Übernommen', typ: 'firma' })))
      .rejects.toThrow(CrmFehler);
    const [z] = await sql.unsafe<{ name: string }[]>(
      `select name from kunde where id = $1`, [id]);
    expect(z!.name).toBe('Nur Reinigung');
  });
});

describe('§2 K-05 — was die Änderung NICHT anfassen darf', () => {
  it('Mahnsperre und Zahlungsziel überleben eine Stammdatenänderung', async () => {
    /*
     * DER Fall dieser Datei. `cse_app` darf diese Spalten schreiben und nicht
     * lesen; ein Formular, das den ganzen Datensatz zurueckschreibt, setzt
     * sie auf null, ohne sie je gesehen zu haben. Gesetzt wird hier als
     * Eigentuemer (der Test umgeht `cse_app` bewusst), geaendert ueber den
     * Dienst, geprueft wieder als Eigentuemer.
     */
    const id = await neuerKunde('Mit Konditionen');
    await sql.unsafe(
      `update kunde set debitorennummer = $2, zahlungsziel_tage = 30,
              mahnsperre_bis = current_date + 14, mahnsperre_grund = 'Verhandlung laeuft'
        where id = $1`, [id, `D-${zufall()}`]);

    await alsApp(sitzung(), (tx) => aendereKunde(kontextAus(tx, f.reinigung), {
      id, name: 'Mit Konditionen AG', typ: 'firma', ort: 'Hamburg',
    }));

    const [z] = await sql.unsafe<{
      debitorennummer: string | null; zahlungsziel_tage: number | null;
      mahnsperre_bis: Date | null; mahnsperre_grund: string | null; name: string;
    }[]>(
      `select debitorennummer, zahlungsziel_tage, mahnsperre_bis, mahnsperre_grund, name
         from kunde where id = $1`, [id]);
    expect(z!.name).toBe('Mit Konditionen AG');      // die Aenderung wirkte
    expect(z!.debitorennummer).not.toBeNull();       // und diese vier blieben
    expect(z!.zahlungsziel_tage).toBe(30);
    expect(z!.mahnsperre_bis).not.toBeNull();
    expect(z!.mahnsperre_grund).toBe('Verhandlung laeuft');
  });

  it('die Rechtsgrundlage und ihr Datum bleiben ebenfalls stehen', async () => {
    /*
     * Ein Aenderungsformular, das sie beilaeufig mitschreibt, setzt das Datum
     * auf heute — und macht damit aus einer Einwilligung von 2024 eine von
     * heute (§ 7 UWG, LEG-08).
     */
    const k = await alsApp(sitzung(), (tx) => legeKundeAn(kontextAus(tx, f.reinigung), {
      name: 'Mit Einwilligung', typ: 'firma',
      rechtsgrundlage: 'einwilligung', grundlageQuelle: 'Häkchen vom 12.03.',
    }));
    const [vorher] = await sql.unsafe<{ g: string; q: string | null; d: Date | null }[]>(
      `select rechtsgrundlage::text as g, rechtsgrundlage_quelle as q,
              rechtsgrundlage_erfasst_am as d from kunde where id = $1`, [k.id]);

    await alsApp(sitzung(), (tx) => aendereKunde(kontextAus(tx, f.reinigung), {
      id: k.id, name: 'Mit Einwilligung GmbH', typ: 'firma',
    }));

    const [nachher] = await sql.unsafe<{ g: string; q: string | null; d: Date | null }[]>(
      `select rechtsgrundlage::text as g, rechtsgrundlage_quelle as q,
              rechtsgrundlage_erfasst_am as d from kunde where id = $1`, [k.id]);
    expect(nachher!.g).toBe(vorher!.g);
    expect(nachher!.q).toBe(vorher!.q);
    expect(nachher!.d).toEqual(vorher!.d);
  });
});

describe('§3 der Stand — und `gesperrt` ist die UWG-Werbesperre (V-087)', () => {
  it('setzt den Stand auf gesperrt', async () => {
    const id = await neuerKunde('Wird gesperrt');
    await alsApp(sitzung(), (tx) => setzeKundeStatus(kontextAus(tx, f.reinigung), id, 'gesperrt'));
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from kunde where id = $1`, [id]);
    expect(z!.status).toBe('gesperrt');
  });

  it('und `inaktiv`, das bis hierher ebenfalls kein Erzeuger hatte', async () => {
    const id = await neuerKunde('Wird inaktiv');
    await alsApp(sitzung(), (tx) => setzeKundeStatus(kontextAus(tx, f.reinigung), id, 'inaktiv'));
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from kunde where id = $1`, [id]);
    expect(z!.status).toBe('inaktiv');
  });

  it('WEIST einen erfundenen Stand ab', async () => {
    const id = await neuerKunde();
    await expect(alsApp(sitzung(), (tx) =>
      setzeKundeStatus(kontextAus(tx, f.reinigung), id, 'geloescht' as never)))
      .rejects.toThrow(CrmFehler);
  });
});

describe('§4 archivieren (V-018)', () => {
  it('archiviert, statt zu löschen', async () => {
    const id = await neuerKunde('Zum Archivieren');
    await alsApp(sitzung(), (tx) => archiviereKunde(kontextAus(tx, f.reinigung), id));
    const [z] = await sql.unsafe<{ archiviert_am: Date | null }[]>(
      `select archiviert_am from kunde where id = $1`, [id]);
    expect(z!.archiviert_am).not.toBeNull();
  });

  it('WEIST das Archivieren ab, solange Aufträge laufen', async () => {
    const id = await neuerKunde('Mit Auftrag');
    await sql.unsafe(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                            verantwortlich_benutzer_id, start_datum, status)
       values ($1,$2,$3,'einzelauftrag','Laufender Auftrag',$4, current_date, 'aktiv')`,
      [f.reinigung, `A-${zufall()}`, id, benutzer] as never[]);

    await expect(alsApp(sitzung(), (tx) => archiviereKunde(kontextAus(tx, f.reinigung), id)))
      .rejects.toThrow(/Aufträge/u);
    const [z] = await sql.unsafe<{ archiviert_am: Date | null }[]>(
      `select archiviert_am from kunde where id = $1`, [id]);
    expect(z!.archiviert_am).toBeNull();
  });

  it('ein archivierter Kunde ist nicht mehr änderbar', async () => {
    const id = await neuerKunde('Archiviert und fertig');
    await alsApp(sitzung(), (tx) => archiviereKunde(kontextAus(tx, f.reinigung), id));
    await expect(alsApp(sitzung(), (tx) => aendereKunde(kontextAus(tx, f.reinigung), {
      id, name: 'Doch noch', typ: 'firma',
    }))).rejects.toThrow(CrmFehler);
  });
});

describe('§5 der Ansprechpartner (V-019)', () => {
  const neuerKontakt = async (kundeId: string): Promise<string> =>
    alsApp(sitzung(), (tx) => legeKontaktAn(kontextAus(tx, f.reinigung), {
      kundeId, nachname: 'Vorher', rechtsgrundlage: 'keine',
    }));

  it('ändert Name, Position und Erreichbarkeit', async () => {
    const kundeId = await neuerKunde('Kunde mit Kontakt');
    const id = await neuerKontakt(kundeId);
    await alsApp(sitzung(), (tx) => aendereKontakt(kontextAus(tx, f.reinigung), {
      id, nachname: 'Nachher', vorname: 'Maria', position: 'Objektleitung',
      email: 'maria@example.test',
    }));
    const [z] = await sql.unsafe<{ nachname: string; vorname: string | null; position: string | null }[]>(
      `select nachname, vorname, position from ansprechpartner where id = $1`, [id]);
    expect(z!.nachname).toBe('Nachher');
    expect(z!.vorname).toBe('Maria');
    expect(z!.position).toBe('Objektleitung');
  });

  it('die Rechtsgrundlage des Kontakts bleibt unberührt', async () => {
    const kundeId = await neuerKunde('Kunde mit Grundlage');
    const id = await alsApp(sitzung(), (tx) => legeKontaktAn(kontextAus(tx, f.reinigung), {
      kundeId, nachname: 'Mitgrund', rechtsgrundlage: 'einwilligung',
      grundlageQuelle: 'Formular vom 12.03.', einwilligungKanaele: ['email'],
    }));
    await alsApp(sitzung(), (tx) => aendereKontakt(kontextAus(tx, f.reinigung), {
      id, nachname: 'Mitgrund', position: 'Einkauf',
    }));
    const [z] = await sql.unsafe<{ g: string; k: string[] | null }[]>(
      `select rechtsgrundlage::text as g, einwilligung_kanaele as k
         from ansprechpartner where id = $1`, [id]);
    expect(z!.g).toBe('einwilligung');
    expect(z!.k).not.toBeNull();
  });

  it('als ausgeschieden vermerken statt löschen — und danach geht nichts mehr hinaus', async () => {
    /*
     * Der KUNDE traegt die Grundlage mit: `app.darf_kontaktiert_werden`
     * fragt beide Seiten (§ 7 UWG, LEG-08). Ein Kunde mit `keine` sperrt
     * jeden seiner Kontakte, gleich was an ihnen steht — richtig so, und
     * hier waere der Fall sonst schon vor der Abmeldung falsch.
     */
    const kundeMitGrundlage = await alsApp(sitzung(), (tx) =>
      legeKundeAn(kontextAus(tx, f.reinigung), {
        name: 'Kunde mit Abgang', typ: 'firma',
        rechtsgrundlage: 'einwilligung', grundlageQuelle: 'Rahmenvertrag 2026',
      }));
    const kundeId = kundeMitGrundlage.id;
    const id = await alsApp(sitzung(), (tx) => legeKontaktAn(kontextAus(tx, f.reinigung), {
      kundeId, nachname: 'Geht', rechtsgrundlage: 'einwilligung',
      grundlageQuelle: 'Formular vom 12.03.', einwilligungKanaele: ['email'],
    }));
    /* Vorher: mit Einwilligung ist der Kontakt anschreibbar. */
    const [vor] = await alsApp(sitzung(), (tx) => tx.unsafe(
      `select app.darf_kontaktiert_werden($1::uuid, 'email', 'werbung') as darf`,
      [id])) as unknown as { darf: boolean }[];
    expect(vor!.darf).toBe(true);

    await alsApp(sitzung(), (tx) => scheideKontaktAus(kontextAus(tx, f.reinigung), id));

    const [z] = await sql.unsafe<{ ausgeschieden_am: Date | null }[]>(
      `select ausgeschieden_am from ansprechpartner where id = $1`, [id]);
    expect(z!.ausgeschieden_am).not.toBeNull();

    /* Nachher: die Sperre wirkt am TOR, nicht nur in der Anzeige. */
    const [nach] = await alsApp(sitzung(), (tx) => tx.unsafe(
      `select app.darf_kontaktiert_werden($1::uuid, 'email', 'werbung') as darf`,
      [id])) as unknown as { darf: boolean }[];
    expect(nach!.darf).toBe(false);
  });
});
