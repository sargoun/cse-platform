/**
 * Die Vergabemappe gegen eine echte Datenbank (RAD-07, D-07, 0147).
 *
 *  1. **Der Zähler wird gerechnet, nicht getippt.** Dreissig Zeilen in EINER
 *     Anweisung zählen einmal nach; „liegt vor" zählt NICHT als erledigt
 *     (D-492), weil die häufigsten Ausschlüsse beigelegte, aber falsche
 *     Unterlagen sind.
 *  2. **D-07 steht in der Datenbank.** `cse_app` hat auf den Einreichungs-
 *     spalten kein Schreibrecht — der einzige Weg ist
 *     `app.mappe_einreichung_erfassen`, die den Menschen aus der Sitzung
 *     nimmt. Ein `update … set eingereicht_am` scheitert an der Berechtigung
 *     und nicht an einer Absprache.
 *  3. **Der Vorgang ist nie weiter als seine Mappe**: kein `in_bearbeitung`
 *     ohne Mappe, kein `eingereicht` ohne eingereichte Mappe, kein Ausgang
 *     ohne Einreichung.
 *  4. **Eine Unterschrift trägt den Namen dessen, der sie leistet.**
 *  5. **Die Wände**: eine fremde Gesellschaft sieht die Mappe nicht, das
 *     Kundenportal auch nicht, und der Nachtwächter liest, ohne zu schreiben.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  MappeFehler, ergaenzePosition, legeMappeAn, setzeMappenstand, setzePositionsstand,
} from '../../src/server/services/vergabe/mappe.js';
import {
  EinreichungFehler, erfasseAusgang, erfasseEinreichung,
} from '../../src/server/services/vergabe/einreichung.js';
import { setzeVorgangsstand } from '../../src/server/services/radar/vorgang.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';

let f: Fixtur;
let benutzer: string;
let fremder: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function legeAdministrationAn(mandantId: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [`vm-${zufall()}@cse.test`]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status)
     values ($1, $2, 'Vergabe-Administration', 'aktiv')`, [u!.id, `vm-${zufall()}@cse.test`]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [u!.id, mandantId]);
  return u!.id;
}

function sitzung(mandantId?: string, benutzerId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung,
    benutzerId: benutzerId ?? benutzer, portal: 'intern' as const, readonly: false,
  };
}

/**
 * Der Schreibkontext über der schon gebundenen Transaktion.
 *
 * `alsApp` hat `set local role cse_app` und die K-02-GUCs bereits gesetzt; die
 * Dienste brauchen nur noch `abfrage` und `schreibe`. Ein zweites `withTenant`
 * darüber bände dieselbe Sitzung ein zweites Mal.
 */
function kontext(
  tx: postgres.TransactionSql, mandantId?: string, benutzerId?: string,
): SchreibKontext {
  const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzerId ?? benutzer,
    aktiverMandantId: mandantId ?? f.reinigung, mandantIds: [mandantId ?? f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function alsDienst<T>(
  fn: (k: SchreibKontext) => Promise<T>, mandantId?: string, benutzerId?: string,
): Promise<T> {
  return alsApp(sitzung(mandantId, benutzerId), async (tx: postgres.TransactionSql) =>
    fn(kontext(tx, mandantId, benutzerId))) as Promise<T>;
}

/** Eine Bekanntmachung und ein Vorgang darauf — der Boden jeder Mappe. */
async function legeVorgangAn(mandantId: string, stand = 'geprueft'): Promise<{
  ausschreibung: string; vorgang: string;
}> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into ausschreibung (quelle, quell_id, titel, sprache, rohdaten_hash, frist_angebot)
     values ('oeffentlichevergabe', $1, 'Unterhaltsreinigung Rathaus', 'de', $2,
             now() + interval '20 days')
     returning id`, [`vm-${zufall()}`, `${zufall()}${zufall()}`]);
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into ausschreibung_vorgang (mandant_id, ausschreibung_id, status)
     values ($1, $2, $3::ausschreibung_status) returning id`, [mandantId, a!.id, stand]);
  return { ausschreibung: a!.id, vorgang: v!.id };
}

async function legeMappeDirektAn(mandantId: string, vorgangId: string): Promise<string> {
  const [m] = await sql.unsafe<{ id: string }[]>(
    `insert into vergabemappe (mandant_id, ausschreibung_vorgang_id) values ($1,$2) returning id`,
    [mandantId, vorgangId]);
  return m!.id;
}

/** Ein Dokument dieser Gesellschaft — `vorhanden` und `geprueft` verlangen eines. */
async function legeDokumentAn(mandantId: string): Promise<string> {
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel, mime_typ,
                           mime_verifiziert, groesse_bytes, exif_entfernt, entstanden_am)
     values ($1, 'vertrag', 'Formblatt', $2, 'application/pdf', true, 2048, true, now())
     returning id`, [mandantId, `test/${zufall()}.pdf`]);
  return d!.id;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeAdministrationAn(f.reinigung);
  fremder = await legeAdministrationAn(f.security);
  await sql.unsafe(`delete from vergabemappe_position`);
  await sql.unsafe(`delete from vergabemappe`);
  await sql.unsafe(`delete from ausschreibung_vorgang`);
  await sql.unsafe(`delete from bewertung`);
  await sql.unsafe(`delete from ausschreibung_dokument`);
  await sql.unsafe(`delete from ausschreibung_rohdaten`);
  await sql.unsafe(`delete from ausschreibung_nuts`);
  await sql.unsafe(`delete from ausschreibung`);
});

afterAll(schliessen);

describe('(1) Der Zaehler wird gerechnet (D-492)', () => {
  it('dreissig Zeilen in EINER Anweisung zaehlen einmal nach', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);
    await sql.unsafe(
      `insert into vergabemappe_position (mandant_id, vergabemappe_id, position, bezeichnung, pflicht)
       select $1, $2, g, 'Formblatt ' || g, g <= 25 from generate_series(1,30) g`,
      [f.reinigung, mappe]);

    const [z] = await sql.unsafe<{ g: number; e: number }[]>(
      `select pflichtpositionen_gesamt g, pflichtpositionen_erledigt e
         from vergabemappe where id = $1`, [mappe]);
    expect(z!.g, 'nur Pflichtzeilen zaehlen').toBe(25);
    expect(z!.e).toBe(0);
  });

  it('„liegt vor" zaehlt NICHT als erledigt — „geprueft" schon', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const dokument = await legeDokumentAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);
    await sql.unsafe(
      `insert into vergabemappe_position (mandant_id, vergabemappe_id, position, bezeichnung)
       values ($1,$2,1,'Eigenerklaerung'), ($1,$2,2,'Preisblatt')`, [f.reinigung, mappe]);

    await sql.unsafe(
      `update vergabemappe_position set status='vorhanden', dokument_id=$2
        where vergabemappe_id=$1 and position=1`, [mappe, dokument]);
    const [vorher] = await sql.unsafe<{ e: number }[]>(
      `select pflichtpositionen_erledigt e from vergabemappe where id=$1`, [mappe]);
    expect(vorher!.e, 'eine beigelegte, ungepruefte Datei ist nicht erledigt').toBe(0);

    await alsDienst(async (k) => {
      const [p] = await k.abfrage<{ id: string }>(
        `select id from vergabemappe_position where vergabemappe_id=$1 and position=1`, [mappe]);
      await setzePositionsstand(k, { positionId: p!.id, stand: 'geprueft' });
    });
    const [nachher] = await sql.unsafe<{ e: number; von: string }[]>(
      `select m.pflichtpositionen_erledigt e, p.geprueft_von as von
         from vergabemappe m
         join vergabemappe_position p on p.vergabemappe_id = m.id and p.position = 1
        where m.id=$1`, [mappe]);
    expect(nachher!.e).toBe(1);
    expect(nachher!.von, 'geprueft hat, wer angemeldet ist').toBe(benutzer);
  });

  it('„gilt nicht" ohne Begruendung ist eine Luecke mit einem Haken davor', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);
    await sql.unsafe(
      `insert into vergabemappe_position (mandant_id, vergabemappe_id, position, bezeichnung)
       values ($1,$2,1,'Nachunternehmerverzeichnis')`, [f.reinigung, mappe]);

    await expect(alsDienst(async (k) => {
      const [p] = await k.abfrage<{ id: string }>(
        `select id from vergabemappe_position where vergabemappe_id=$1`, [mappe]);
      await setzePositionsstand(k, { positionId: p!.id, stand: 'nicht_zutreffend' });
    })).rejects.toThrow(MappeFehler);
  });
});

describe('(2) D-07 steht in der Datenbank', () => {
  it('cse_app darf `eingereicht_am` gar nicht erst schreiben', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);

    await expect(alsApp(sitzung(), async (tx: postgres.TransactionSql) => tx.unsafe(
      `update vergabemappe set eingereicht_am = now() where id = $1`, [mappe])))
      .rejects.toThrow(/permission denied|Berechtigung/iu);
  });

  it('ein Einreichungszeitpunkt ohne Menschen ist per CHECK unmoeglich', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    await expect(sql.unsafe(
      `insert into vergabemappe (mandant_id, ausschreibung_vorgang_id, eingereicht_am,
                                 eingereicht_ueber_text)
       values ($1,$2, now(), 'Irgendeine Plattform')`, [f.reinigung, vorgang]))
      .rejects.toThrow(/vm_einreichung_hat_menschen/u);
  });

  it('die Erfassung nimmt den Menschen aus der SITZUNG, den Zeitpunkt aus der Datenbank', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);

    const wann = await alsDienst(async (k) => erfasseEinreichung(k, {
      mappeId: mappe, plattformText: 'Vergabemarktplatz Berlin', kennzeichen: 'AZ-2026-4711',
    }));
    expect(wann).toBeInstanceOf(Date);

    const [z] = await sql.unsafe<{
      von: string; status: string; ueber: string; az: string; vstatus: string;
    }[]>(
      `select m.eingereicht_von as von, m.status::text as status,
              m.eingereicht_ueber_text as ueber, m.einreichung_kennzeichen as az,
              v.status::text as vstatus
         from vergabemappe m join ausschreibung_vorgang v on v.id = m.ausschreibung_vorgang_id
        where m.id = $1`, [mappe]);
    expect(z!.von, 'der Mensch kommt aus der Sitzung, nicht aus dem Formular').toBe(benutzer);
    expect(z!.status).toBe('eingereicht');
    expect(z!.ueber).toBe('Vergabemarktplatz Berlin');
    expect(z!.az).toBe('AZ-2026-4711');
    expect(z!.vstatus, 'der Vorgang zieht nach').toBe('eingereicht');
  });

  it('ohne Plattform gibt es keine Einreichung', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);
    await expect(alsDienst(async (k) => erfasseEinreichung(k, { mappeId: mappe })))
      .rejects.toThrow(EinreichungFehler);
  });

  it('eine zweite Erfassung ueberschreibt die erste nicht', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);
    await alsDienst(async (k) => erfasseEinreichung(k, {
      mappeId: mappe, plattformText: 'Erste Plattform',
    }));
    await expect(alsDienst(async (k) => erfasseEinreichung(k, {
      mappeId: mappe, plattformText: 'Zweite Plattform',
    }))).rejects.toThrow(EinreichungFehler);

    const [z] = await sql.unsafe<{ ueber: string }[]>(
      `select eingereicht_ueber_text as ueber from vergabemappe where id=$1`, [mappe]);
    expect(z!.ueber).toBe('Erste Plattform');
  });

  it('eine unvollstaendige Mappe wird trotzdem erfasst — was abgegeben wurde, wurde abgegeben', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);
    await sql.unsafe(
      `insert into vergabemappe_position (mandant_id, vergabemappe_id, position, bezeichnung)
       values ($1,$2,1,'Eigenerklaerung')`, [f.reinigung, mappe]);

    await alsDienst(async (k) => erfasseEinreichung(k, {
      mappeId: mappe, plattformText: 'Vergabemarktplatz Berlin',
    }));
    const [z] = await sql.unsafe<{ status: string; g: number; e: number }[]>(
      `select status::text as status, pflichtpositionen_gesamt g, pflichtpositionen_erledigt e
         from vergabemappe where id=$1`, [mappe]);
    expect(z!.status).toBe('eingereicht');
    expect(z!.g - z!.e, 'die Luecke bleibt sichtbar, statt die Tatsache zu verweigern').toBe(1);
  });
});

describe('(3) Der Vorgang ist nie weiter als seine Mappe', () => {
  it('kein `in_bearbeitung` ohne Mappe — und der Dienst legt sie an', async () => {
    const { ausschreibung } = await legeVorgangAn(f.reinigung, 'neu');
    await expect(sql.unsafe(
      `update ausschreibung_vorgang set status = 'in_bearbeitung'
        where ausschreibung_id = $1`, [ausschreibung]))
      .rejects.toThrow(/Vergabemappe/u);

    await alsDienst(async (k) => setzeVorgangsstand(k, {
      ausschreibungId: ausschreibung, status: 'in_bearbeitung', grund: null,
    }));

    const [z] = await sql.unsafe<{ status: string; mappen: number }[]>(
      `select v.status::text as status,
              (select count(*) from vergabemappe m
                where m.ausschreibung_vorgang_id = v.id)::int as mappen
         from ausschreibung_vorgang v where v.ausschreibung_id = $1`, [ausschreibung]);
    expect(z!.status).toBe('in_bearbeitung');
    expect(z!.mappen, '„In Bearbeitung" oeffnet die Vergabemappe').toBe(1);
  });

  it('kein `eingereicht` ohne eingereichte Mappe', async () => {
    const { ausschreibung, vorgang } = await legeVorgangAn(f.reinigung);
    await legeMappeDirektAn(f.reinigung, vorgang);
    await expect(sql.unsafe(
      `update ausschreibung_vorgang set status = 'eingereicht' where ausschreibung_id = $1`,
      [ausschreibung])).rejects.toThrow(/Mappe/u);
  });

  it('ein Ausgang setzt eine Einreichung voraus (REP-06)', async () => {
    const { ausschreibung, vorgang } = await legeVorgangAn(f.reinigung);
    await legeMappeDirektAn(f.reinigung, vorgang);

    await expect(alsDienst(async (k) => erfasseAusgang(k, {
      ausschreibungId: ausschreibung, ausgang: 'zuschlag', entschiedenAm: '2026-11-02',
      zuschlagswertCent: 486_000_00n,
    }))).rejects.toThrow(EinreichungFehler);
  });

  it('nach der Einreichung traegt der Zuschlag Datum und Wert in ganzen Cent', async () => {
    const { ausschreibung, vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);
    await alsDienst(async (k) => erfasseEinreichung(k, {
      mappeId: mappe, plattformText: 'Vergabemarktplatz Berlin',
    }));
    await alsDienst(async (k) => erfasseAusgang(k, {
      ausschreibungId: ausschreibung, ausgang: 'zuschlag', entschiedenAm: '2026-11-02',
      zuschlagswertCent: 486_000_00n,
    }));

    const [z] = await sql.unsafe<{ status: string; tag: string; wert: string }[]>(
      `select status::text as status, entschieden_am::text as tag,
              zuschlagswert_cent::text as wert
         from ausschreibung_vorgang where ausschreibung_id = $1`, [ausschreibung]);
    expect(z!.status).toBe('zuschlag');
    expect(z!.tag).toBe('2026-11-02');
    expect(z!.wert, 'ganze Cent, kein Gleitkomma (Invariante 1)').toBe('48600000');
  });

  it('einen Auftragswert gibt es nur beim Zuschlag', async () => {
    const { ausschreibung, vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);
    await alsDienst(async (k) => erfasseEinreichung(k, {
      mappeId: mappe, plattformText: 'Vergabemarktplatz Berlin',
    }));
    await expect(alsDienst(async (k) => erfasseAusgang(k, {
      ausschreibungId: ausschreibung, ausgang: 'nicht_beruecksichtigt',
      entschiedenAm: '2026-11-02', zuschlagswertCent: 1n,
    }))).rejects.toThrow(EinreichungFehler);
  });
});

describe('(4) Eine Unterschrift traegt den Namen dessen, der sie leistet', () => {
  it('eine Freigabe im Namen eines Kollegen wird abgewiesen', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);
    /* Ein Konto DIESER Gesellschaft — die Mitgliedschaft ist also nicht das Problem. */
    const kollege = await legeAdministrationAn(f.reinigung);

    await expect(alsApp(sitzung(), async (tx: postgres.TransactionSql) => tx.unsafe(
      `update vergabemappe set freigegeben_von = $2, freigegeben_am = now(), status = 'freigegeben'
        where id = $1`, [mappe, kollege])))
      .rejects.toThrow(/Unterschrift/u);
  });

  it('freigeben geht erst, wenn jede Pflichtposition geprueft ist', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const dokument = await legeDokumentAn(f.reinigung);
    const mappe = await alsDienst(async (k) => {
      const { mappeId } = await legeMappeAn(k, vorgang);
      await ergaenzePosition(k, {
        mappeId, bezeichnung: 'Eigenerklaerung zur Eignung', kategorie: 'Eignung', pflicht: true,
      });
      return mappeId;
    });

    await expect(alsDienst(async (k) =>
      setzeMappenstand(k, { mappeId: mappe, stand: 'freigegeben' })))
      .rejects.toThrow(MappeFehler);

    await alsDienst(async (k) => {
      const [p] = await k.abfrage<{ id: string }>(
        `select id from vergabemappe_position where vergabemappe_id = $1`, [mappe]);
      await k.schreibe(
        `update vergabemappe_position set dokument_id = $2 where id = $1`, [p!.id, dokument]);
      await setzePositionsstand(k, { positionId: p!.id, stand: 'geprueft' });
      await setzeMappenstand(k, { mappeId: mappe, stand: 'freigegeben' });
    });

    const [z] = await sql.unsafe<{ status: string; von: string }[]>(
      `select status::text as status, freigegeben_von as von from vergabemappe where id=$1`,
      [mappe]);
    expect(z!.status).toBe('freigegeben');
    expect(z!.von).toBe(benutzer);
  });

  it('eine leere Mappe ist nicht vollstaendig, sondern leer', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await alsDienst(async (k) => (await legeMappeAn(k, vorgang)).mappeId);
    await expect(alsDienst(async (k) =>
      setzeMappenstand(k, { mappeId: mappe, stand: 'vollstaendig' })))
      .rejects.toThrow(/leer/u);
  });

  it('eine eingereichte Mappe wird nicht mehr umsortiert', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);
    await alsDienst(async (k) => erfasseEinreichung(k, {
      mappeId: mappe, plattformText: 'Vergabemarktplatz Berlin',
    }));
    await expect(alsDienst(async (k) =>
      setzeMappenstand(k, { mappeId: mappe, stand: 'in_arbeit' })))
      .rejects.toThrow(/eingereicht/u);
  });
});

describe('(5) Die Waende', () => {
  it('eine fremde Gesellschaft sieht die Mappe nicht', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    await legeMappeDirektAn(f.reinigung, vorgang);

    const zeilen = await alsDienst(
      async (k) => k.abfrage<{ id: string }>(`select id from vergabemappe`),
      f.security, fremder);
    expect(zeilen).toHaveLength(0);
  });

  it('das Kundenportal sieht die Vergabemappe nicht', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    await legeMappeDirektAn(f.reinigung, vorgang);

    const zeilen = await alsRolle('cse_app', async (tx: postgres.TransactionSql) => {
      await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
      await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [f.reinigung]);
      await tx.unsafe(`select set_config('app.benutzer_id', $1, true)`, [benutzer]);
      await tx.unsafe(`select set_config('app.portal', 'kunde', true)`);
      await tx.unsafe(`select set_config('app.readonly', 'off', true)`);
      return tx.unsafe(`select id from vergabemappe`);
    });
    expect(zeilen).toHaveLength(0);
  });

  it('der Nachtwaechter liest die Mappe, schreibt sie aber nicht', async () => {
    const { vorgang } = await legeVorgangAn(f.reinigung);
    const mappe = await legeMappeDirektAn(f.reinigung, vorgang);

    const gelesen = await alsRolle('cse_job', async (tx: postgres.TransactionSql) =>
      tx.unsafe(`select id from vergabemappe where id = $1`, [mappe]));
    expect(gelesen).toHaveLength(1);

    await expect(alsRolle('cse_job', async (tx: postgres.TransactionSql) => tx.unsafe(
      `update vergabemappe set status = 'verworfen' where id = $1`, [mappe])))
      .rejects.toThrow(/permission denied|Berechtigung/iu);
  });
});
