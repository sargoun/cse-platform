/**
 * PR 54.3 — die Kreditorenseite gegen eine echte Datenbank (FIN-14, ACC-03).
 *
 * Die Abnahme von PR 54 nennt fünf Sätze; vier davon stehen hier (der fünfte,
 * die Teilzahlung, steht in `zahlung.test.ts`):
 *
 *  1. Eine Eingangsrechnung wird mit Lieferant, Nummer, Datum und Beträgen
 *     **je Steuersatz** erfasst — nie ein Brutto mit einem Mischsatz — und
 *     hängt an ihrem Dokument.
 *  2. Das harte Löschen scheitert in der Datenbank; die Zurückweisung lässt
 *     den Satz mit Grund stehen.
 *  3. Die Dublettenerkennung über (Lieferant, Nummer, Jahr) warnt VOR dem
 *     Speichern — und der Index weist danach ab.
 *  5. Jede Zeile trägt `mandant_id` und ist über die Mandantengrenze hinweg
 *     unsichtbar.
 *
 * Dazu die beiden Aussagen, die diese Migration eigen macht: die interne
 * Belegnummer entsteht beim BUCHEN (nicht bei der Freigabe, sonst reisst eine
 * abgelehnte Rechnung eine Lücke), und die Bankverbindung eines Lieferanten
 * ist spaltenweise entzogen.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import {
  EingangsrechnungFehler, buche, eingangsrechnungen, erfasseEingangsrechnung,
  freigebe, inPruefung, legeBelegAn, lehneAb, pruefeDublette, setzeSteuerzeile,
  type Abfrage,
} from '../../src/server/services/finanz/eingangsrechnung.js';
import { bucheEingangsrechnung } from '../../src/server/services/buchhaltung/buchungssatz.js';

let f: Fixtur;
let benutzer: string;
let lieferantId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const SHA = 'a'.repeat(64);

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function sitzung(mandantId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

/** Ein Kreis `eingangsrechnung_beleg`, wie der Seed ihn anlegt. */
async function macheBuchungsfaehig(mandantId: string): Promise<void> {
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'eingangsrechnung_beleg', null, 2026, 'Eingangsbelege', true,
             'EB-{jahr}-{nr:5}', 'jaehrlich', '2026-01-01', false, 'system', 'job:test')`,
    [mandantId]);
}

async function legeLieferantAn(mandantId: string): Promise<string> {
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into lieferant (mandant_id, lieferantennummer, name, iban, bic,
                            kreditorennummer, zahlungsziel_tage,
                            erstellt_von_art, erstellt_von_dienst)
     values ($1, $2, 'Malerbetrieb Nord GmbH', 'DE02120300000000202051', 'BYLADEM1001',
             '70001', 14, 'system', 'job:test')
     returning id`, [mandantId, `L-${zufall()}`]);
  return l!.id;
}

/** Ein Dokument samt Version — das, woran ein Beleg hängt (ACC-03). */
async function legeDokumentAn(mandantId: string): Promise<{ dokumentId: string; versionId: string }> {
  const id = crypto.randomUUID();
  await sql.unsafe(
    `insert into dokument (id, mandant_id, kategorie, titel, mime_typ, mime_verifiziert,
                           groesse_bytes, bucket, objekt_schluessel, exif_entfernt,
                           loeschsperre)
     values ($1, $2, 'buchhaltung', 'Lieferantenrechnung', 'application/pdf', true,
             1024, 'dokumente', $3, true, true)`,
    [id, mandantId, `${mandantId}/buchhaltung/${id}`]);
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                   sha256, groesse_bytes, mime_typ)
     values ($1, $2, 1, $3, $4, 1024, 'application/pdf') returning id`,
    [mandantId, id, `${mandantId}/buchhaltung/${id}`, SHA]);
  return { dokumentId: id, versionId: v!.id };
}

/** Eine erfasste Rechnung über 1.000,00 € netto + 190,00 € USt. */
async function erfasst(
  nummer = `RE-${zufall()}`, mandantId?: string, lieferant?: string,
): Promise<string> {
  const m = mandantId ?? f.reinigung;
  const dok = await legeDokumentAn(m);
  return alsApp(sitzung(m), async (tx) => {
    const d = alsDienst(tx);
    const belegId = await legeBelegAn(d, {
      typ: 'eingangsrechnung', quelle: 'upload',
      dokumentId: dok.dokumentId, dokumentVersionId: dok.versionId, dateiSha256: SHA,
      belegdatum: '2026-08-31',
    });
    return erfasseEingangsrechnung(d, {
      belegId,
      lieferantId: lieferant ?? lieferantId,
      rechnungsnummerLieferant: nummer,
      rechnungsdatum: '2026-08-31',
      leistungsdatum: '2026-08-20',
      nettoCent: cent(100_000n), steuerCent: cent(19_000n), bruttoCent: cent(119_000n),
      faelligAm: '2026-09-30',
    });
  });
}

/** Der ganze Weg bis `gebucht`, mit einer K-13-Freigabe. */
async function gebucht(nummer = `RE-${zufall()}`): Promise<string> {
  const id = await erfasst(nummer);
  await alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    await setzeSteuerzeile(d, {
      eingangsrechnungId: id, steuergruppe: 'ust_19',
      nettoCent: cent(100_000n), steuerCent: cent(19_000n),
    });
    await inPruefung(d, id);
  });
  const [fg] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am,
                           erstellt_von)
     values ($1, 'eingangsrechnung_buchen', 'genehmigt', $2, now(), $2) returning id`,
    [f.reinigung, benutzer]);
  await alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    await freigebe(d, id, fg!.id);
    await buche(d, id);
  });
  return id;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`buchhaltung-${zufall()}@cse.test`);
  await macheBuchungsfaehig(f.reinigung);
  lieferantId = await legeLieferantAn(f.reinigung);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) Erfassen mit Beträgen je Steuersatz, und nie ohne Beleg', () => {
  it('die Rechnung hängt an einer bestimmten Dokumentversion', async () => {
    const id = await erfasst();
    const [z] = await sql.unsafe<{ sha: string; typ: string }[]>(
      `select b.datei_sha256 as sha, b.typ::text as typ
         from eingangsrechnung er join beleg b on b.id = er.beleg_id
        where er.id = $1`, [id]);
    expect(z!.sha).toBe(SHA);
    expect(z!.typ).toBe('eingangsrechnung');
  });

  it('ohne Beleg entsteht gar keine Zeile — ACC-03 steht in der Spalte', async () => {
    await expect(alsApp(sitzung(), async (tx) => tx.unsafe(
      `insert into eingangsrechnung (mandant_id, beleg_id) values (app.aktiver_mandant(), null)`,
    ))).rejects.toThrow(/beleg_id|not-null|null value/u);
  });

  it('der Beleg zeigt danach nicht mehr auf eine andere Version', async () => {
    const id = await erfasst();
    const zweite = await legeDokumentAn(f.reinigung);
    await expect(alsApp(sitzung(), async (tx) => tx.unsafe(
      `update beleg set dokument_version_id = $2
        where id = (select beleg_id from eingangsrechnung where id = $1)`,
      [id, zweite.versionId] as never[]))).rejects.toThrow(/nicht ausgetauscht/u);
  });

  it('gebucht wird nur, wenn Kopf und Steuerzeilen zusammenpassen', async () => {
    const id = await erfasst();
    const [fg] = await sql.unsafe<{ id: string }[]>(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am,
                             erstellt_von)
       values ($1, 'eingangsrechnung_buchen', 'genehmigt', $2, now(), $2) returning id`,
      [f.reinigung, benutzer]);

    // Eine Steuerzeile, die dem Kopf widerspricht.
    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      await setzeSteuerzeile(d, {
        eingangsrechnungId: id, steuergruppe: 'ust_19',
        nettoCent: cent(50_000n), steuerCent: cent(9_500n),
      });
      await inPruefung(d, id);
      await freigebe(d, id, fg!.id);
    });
    await expect(alsApp(sitzung(), async (tx) => buche(alsDienst(tx), id)))
      .rejects.toThrow(/Kopf und Steuerzeilen weichen ab/u);

    // Richtiggestellt geht es.
    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      await setzeSteuerzeile(d, {
        eingangsrechnungId: id, steuergruppe: 'ust_19',
        nettoCent: cent(100_000n), steuerCent: cent(19_000n),
      });
      await buche(d, id);
    });
    const [z] = await sql.unsafe<{ nummer: string | null }[]>(
      `select interne_belegnummer as nummer from eingangsrechnung where id = $1`, [id]);
    expect(z!.nummer).toBe('EB-2026-00001');
  });

  it('und ganz ohne Steuerzeilen wird nicht gebucht', async () => {
    const id = await erfasst();
    const [fg] = await sql.unsafe<{ id: string }[]>(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am,
                             erstellt_von)
       values ($1, 'eingangsrechnung_buchen', 'genehmigt', $2, now(), $2) returning id`,
      [f.reinigung, benutzer]);
    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      await inPruefung(d, id);
      await freigebe(d, id, fg!.id);
    });
    await expect(alsApp(sitzung(), async (tx) => buche(alsDienst(tx), id)))
      .rejects.toThrow(/Ohne Steuerzeilen/u);
  });
});

describe('(2) Die Belegnummer entsteht beim BUCHEN — sonst reisst eine Ablehnung eine Lücke',
  () => {
    it('eine freigegebene Rechnung hat noch keine Nummer', async () => {
      const id = await erfasst();
      const [fg] = await sql.unsafe<{ id: string }[]>(
        `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am,
                               erstellt_von)
         values ($1, 'eingangsrechnung_buchen', 'genehmigt', $2, now(), $2) returning id`,
        [f.reinigung, benutzer]);
      await alsApp(sitzung(), async (tx) => {
        const d = alsDienst(tx);
        await inPruefung(d, id);
        await freigebe(d, id, fg!.id);
      });
      const [z] = await sql.unsafe<{ nummer: string | null; status: string }[]>(
        `select interne_belegnummer as nummer, status::text as status
           from eingangsrechnung where id = $1`, [id]);
      expect(z!.status).toBe('freigegeben');
      expect(z!.nummer).toBeNull();
    });

    it('zwei gebuchte Rechnungen tragen zwei aufeinanderfolgende Nummern', async () => {
      await gebucht();
      await gebucht();
      const nummern = await sql.unsafe<{ nummer: string }[]>(
        `select interne_belegnummer as nummer from eingangsrechnung
          where interne_belegnummer is not null order by interne_belegnummer`);
      expect(nummern.map((n) => n.nummer)).toEqual(['EB-2026-00001', 'EB-2026-00002']);
    });

    it('eine Freigabe ohne Freigabesatz wird abgewiesen (Invariante 7)', async () => {
      const id = await erfasst();
      await alsApp(sitzung(), async (tx) => inPruefung(alsDienst(tx), id));
      await expect(alsApp(sitzung(), async (tx) => tx.unsafe(
        `update eingangsrechnung set status = 'freigegeben' where id = $1`,
        [id] as never[]))).rejects.toThrow(/ohne Freigabesatz/u);
    });

    it('und eine gebuchte Rechnung wandert nirgendwo mehr hin', async () => {
      const id = await gebucht();
      await expect(alsApp(sitzung(), async (tx) => lehneAb(alsDienst(tx), id, 'doch nicht')))
        .rejects.toThrow(/nicht mehr umgestellt/u);
    });
  });

describe('(3) Die Zurückweisung lässt den Satz mit Grund stehen — gelöscht wird nichts', () => {
  it('abgelehnt mit Grund, und der Grund ist Pflicht', async () => {
    const id = await erfasst();
    await expect(alsApp(sitzung(), async (tx) => lehneAb(alsDienst(tx), id, 'nö')))
      .rejects.toThrow(EingangsrechnungFehler);

    await alsApp(sitzung(), async (tx) =>
      lehneAb(alsDienst(tx), id, 'Leistung wurde nie erbracht — Rücksprache mit Bauleitung.'));
    const liste = await alsApp(sitzung(), async (tx) =>
      eingangsrechnungen(alsDienst(tx), { status: 'abgelehnt' }));
    expect(liste).toHaveLength(1);
    expect(liste[0]!.abgelehntGrund).toContain('nie erbracht');
  });

  it('und das harte Löschen scheitert in der Datenbank — für jede Rolle', async () => {
    const id = await erfasst();
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`delete from eingangsrechnung where id = $1`, [id] as never[])))
      .rejects.toThrow();
    await expect(alsRolle('cse_definer', async (tx) =>
      tx.unsafe(`delete from eingangsrechnung where id = $1`, [id] as never[])))
      .rejects.toThrow();
    await expect(sql.unsafe(`delete from beleg`)).rejects.toThrow();
  });
});

describe('(4) Die Dublettenerkennung warnt vor dem Speichern — und der Index danach', () => {
  it('sie meldet die vorhandene Rechnung namentlich', async () => {
    await gebucht('R-2026-4711');
    const befund = await alsApp(sitzung(), async (tx) => pruefeDublette(alsDienst(tx), {
      lieferantId, rechnungsnummerLieferant: 'R-2026-4711', rechnungsdatum: '2026-08-31',
    }));
    expect(befund.istDublette).toBe(true);
    expect(befund.warnung).toContain('EB-2026-00001');
  });

  it('und speichern lässt sich die zweite auch dann nicht', async () => {
    await erfasst('R-2026-4712');
    await expect(erfasst('R-2026-4712')).rejects.toThrow(/er_dublette_uk|duplicate key/u);
  });

  it('dasselbe Nummernschema im FOLGEJAHR ist keine Dublette', async () => {
    await erfasst('001');
    const dok = await legeDokumentAn(f.reinigung);
    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const belegId = await legeBelegAn(d, {
        typ: 'eingangsrechnung', quelle: 'upload', dokumentId: dok.dokumentId,
        dokumentVersionId: dok.versionId, dateiSha256: SHA,
      });
      return erfasseEingangsrechnung(d, {
        belegId, lieferantId, rechnungsnummerLieferant: '001',
        rechnungsdatum: '2027-01-15', bruttoCent: cent(1000n),
      });
    });
    const befund = await alsApp(sitzung(), async (tx) => pruefeDublette(alsDienst(tx), {
      lieferantId, rechnungsnummerLieferant: '001', rechnungsdatum: '2027-01-15',
    }));
    expect(befund.treffer).toHaveLength(1);   // nur die eine aus 2027
  });

  it('eine ABGELEHNTE Rechnung blockiert die Neuerfassung nicht', async () => {
    const id = await erfasst('R-2026-9000');
    await alsApp(sitzung(), async (tx) =>
      lehneAb(alsDienst(tx), id, 'Falscher Empfänger, Lieferant stellt neu aus.'));

    await expect(erfasst('R-2026-9000')).resolves.toBeTruthy();
    const befund = await alsApp(sitzung(), async (tx) => pruefeDublette(alsDienst(tx), {
      lieferantId, rechnungsnummerLieferant: 'R-2026-9000', rechnungsdatum: '2026-08-31',
    }));
    expect(befund.treffer).toHaveLength(1);
  });
});

describe('(5) Die Bankverbindung des Lieferanten ist spaltenweise entzogen (K-05)', () => {
  it('`cse_app` liest IBAN und Kreditorennummer nicht direkt', async () => {
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`select iban from lieferant`)))
      .rejects.toThrow(/permission denied|Berechtigung/u);
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`select kreditorennummer from lieferant`)))
      .rejects.toThrow(/permission denied|Berechtigung/u);
    // Der Name dagegen schon — sonst wäre der Lieferant unbenutzbar.
    const namen = await alsApp(sitzung(), async (tx) =>
      tx.unsafe<{ name: string }[]>(`select name from lieferant`));
    expect(namen).toHaveLength(1);
  });

  it('über den schmalen Leser geht es — und der Zugriff steht im audit_log', async () => {
    const gelesen = await alsApp(sitzung(), async (tx) =>
      tx.unsafe<{ iban: string | null }[]>(
        `select iban from app.lieferant_konditionen($1::uuid)`, [lieferantId] as never[]));
    expect(gelesen[0]!.iban).toBe('DE02120300000000202051');

    const [spur] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from audit_log
        where aktion = 'lieferant.konditionen_gelesen' and objekt_id = $1`, [lieferantId]);
    expect(spur!.anzahl).toBe('1');
  });

  it('und eine geänderte Bankverbindung wird protokolliert — mit vorher und nachher',
    async () => {
      await alsApp(sitzung(), async (tx) => tx.unsafe(
        `update lieferant set iban = 'DE89370400440532013000' where id = $1`,
        [lieferantId] as never[]));

      const [spur] = await sql.unsafe<{ vorher: string; nachher: string }[]>(
        `select vorher ->> 'iban' as vorher, nachher ->> 'iban' as nachher
           from audit_log where aktion = 'lieferant.bankdaten_geaendert'
            and objekt_id = $1`, [lieferantId]);
      expect(spur!.vorher).toBe('DE02120300000000202051');
      expect(spur!.nachher).toBe('DE89370400440532013000');
    });
});

describe('(5b) Die GoBD-Frist wird gesetzt — nicht nur behauptet', () => {
  /**
   * **Warum diese Prüfung überhaupt hier steht.**
   *
   * Der Auslöser `fin.aufbewahrung_aus_klasse` läuft als `cse_definer` und
   * ruft `app.aufbewahrung_regel` — deren `grant execute` ging bis zu diesem
   * PR nur an `cse_app`. Der Auslöser lief damit in „permission denied", und
   * zwar so, dass NICHTS rot geworden wäre: die Frist wäre auf jedem Beleg
   * NULL geblieben, die Löschsperre stünde, und niemand hätte einen Grund
   * gehabt hinzusehen. Gefunden hat es der erste Testlauf dieser Datei.
   *
   * Ohne Regel bleibt die Frist NULL und die Sperre steht — fail-closed, so
   * gewollt (K-17, O-25). Geprüft wird deshalb MIT Regel: nur dann sagt ein
   * Datum etwas.
   */
  it('mit hinterlegter Regel trägt der Beleg seine Frist', async () => {
    await sql.unsafe(
      `insert into dokument_aufbewahrung (mandant_id, kategorie, jahre, loeschsperre,
                                          ist_platzhalter, grundlage)
       values ($1, 'buchungsbeleg', 10, true, false, $2),
              ($1, 'rechnung_eingang', 10, true, false, $2)`,
      [f.reinigung, '§147 Abs. 3 AO, §14b Abs. 1 UStG — Testfixtur']);

    const id = await erfasst();
    const [z] = await sql.unsafe<{ beleg: string | null; er: string | null }[]>(
      `select b.aufbewahrung_bis::text as beleg, er.aufbewahrung_bis::text as er
         from eingangsrechnung er join beleg b on b.id = er.beleg_id
        where er.id = $1`, [id]);
    // Belegdatum und Rechnungsdatum sind beide 2026-08-31.
    expect(z!.beleg).toBe('2036-12-31');
    expect(z!.er).toBe('2036-12-31');
  });

  it('und ohne Regel bleibt sie NULL — mit stehender Löschsperre', async () => {
    const id = await erfasst();
    const [z] = await sql.unsafe<{ bis: string | null; sperre: boolean }[]>(
      `select aufbewahrung_bis::text as bis, loeschsperre as sperre
         from eingangsrechnung where id = $1`, [id]);
    expect(z!.bis).toBeNull();
    expect(z!.sperre).toBe(true);
  });
});

describe('(6) Der Kreditorposten und die Mandantengrenze', () => {
  it('das Buchen öffnet einen Kreditorposten über das Brutto', async () => {
    const id = await gebucht();
    const [op] = await sql.unsafe<{
      art: string; betrag: string; offen: string; faellig: string;
    }[]>(
      `select art::text as art, betrag_cent::text as betrag, offen_cent::text as offen,
              faellig_am::text as faellig
         from offener_posten where eingangsrechnung_id = $1`, [id]);
    expect(op!.art).toBe('kreditor');
    expect(op!.betrag).toBe('119000');
    expect(op!.offen).toBe('119000');
    expect(op!.faellig).toBe('2026-09-30');
  });

  it('ein §48-Einbehalt mindert, was wir dem Lieferanten schulden', async () => {
    const id = await erfasst();
    await sql.unsafe(
      `update eingangsrechnung
          set bauabzugsteuer_pflichtig = true, bauabzugsteuer_satz_bp = 1500,
              bauabzugsteuer_cent = 17850
        where id = $1`, [id]);
    const [fg] = await sql.unsafe<{ id: string }[]>(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am,
                             erstellt_von)
       values ($1, 'eingangsrechnung_buchen', 'genehmigt', $2, now(), $2) returning id`,
      [f.reinigung, benutzer]);
    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      await setzeSteuerzeile(d, {
        eingangsrechnungId: id, steuergruppe: 'ust_19',
        nettoCent: cent(100_000n), steuerCent: cent(19_000n),
      });
      await inPruefung(d, id);
      await freigebe(d, id, fg!.id);
      await buche(d, id);
    });

    const [op] = await sql.unsafe<{ betrag: string }[]>(
      `select betrag_cent::text as betrag from offener_posten where eingangsrechnung_id = $1`,
      [id]);
    /*
     * 119.000 − 17.850. Der Einbehalt ist keine Minderung der Rechnung: wir
     * schulden ihn dem Finanzamt (§48a EStG), nicht dem Lieferanten — eine
     * andere Verbindlichkeit mit einem anderen Fälligkeitstag.
     */
    expect(op!.betrag).toBe('101150');
  });

  /**
   * **Bis 0131 erreichte die Kreditorenseite das Hauptbuch überhaupt nicht.**
   *
   * `buche()` setzte den Status, die Datenbank eröffnete den Kreditorposten —
   * und ein Buchungssatz entstand nie. Ein DATEV-Export hätte damit nur
   * Ausgangsrechnungen enthalten; die Summe hätte mit keiner Bilanz
   * übereingestimmt, und aufgefallen wäre es beim Steuerberater, einen Monat
   * später, an einer Zahl, die niemand erklären kann.
   */
  it('das Buchen schreibt den Buchungssatz — Aufwand und Vorsteuer im Soll', async () => {
    const id = await gebucht();

    const zeilen = await sql.unsafe<{
      soll_haben: string; umsatz_cent: string; beleg_id: string | null;
      herkunft: string; buchung_id: string;
    }[]>(
      `select soll_haben::text, umsatz_cent::text, beleg_id, herkunft::text,
              buchung_id::text
         from buchungssatz where herkunft = 'eingangsrechnung'
        order by soll_haben, umsatz_cent desc`);

    expect(zeilen.length, 'Aufwand, Vorsteuer, Kreditor').toBe(3);

    const soll = zeilen.filter((z) => z.soll_haben === 'soll')
      .reduce((n, z) => n + BigInt(z.umsatz_cent), 0n);
    const haben = zeilen.filter((z) => z.soll_haben === 'haben')
      .reduce((n, z) => n + BigInt(z.umsatz_cent), 0n);
    expect(soll, '100.000 Netto + 19.000 Vorsteuer').toBe(119_000n);
    expect(haben, 'der Kreditor trägt das Brutto').toBe(119_000n);

    // Eine Buchung, nicht drei.
    expect(new Set(zeilen.map((z) => z.buchung_id)).size).toBe(1);

    const [er] = await sql.unsafe<{ beleg_id: string }[]>(
      `select beleg_id::text from eingangsrechnung where id = $1`, [id]);
    for (const z of zeilen) {
      expect(z.beleg_id, 'der Beleg reist mit jeder Zeile (ACC-03)').toBe(er!.beleg_id);
    }
  });

  it('zweimal buchen ergibt keine zweite Buchung', async () => {
    const id = await gebucht();
    const ergebnis = await alsApp(sitzung(), async (tx) =>
      bucheEingangsrechnung(alsDienst(tx), id));

    expect(ergebnis.gebucht).toBe(false);
    expect(ergebnis.grund).toBe('schon_gebucht');

    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(distinct buchung_id)::text as n from buchungssatz
        where herkunft = 'eingangsrechnung'`);
    expect(n?.n).toBe('1');
  });

  it('ein fremder Mandant sieht weder Lieferant noch Eingangsrechnung', async () => {
    await erfasst();
    const gesehen = await alsApp(
      { ...sitzung(f.security), mandantId: f.security },
      async (tx) => ({
        lieferanten: await tx.unsafe(`select id from lieferant`),
        rechnungen: await tx.unsafe(`select id from eingangsrechnung`),
        belege: await tx.unsafe(`select id from beleg`),
      }));
    expect(gesehen.lieferanten).toHaveLength(0);
    expect(gesehen.rechnungen).toHaveLength(0);
    expect(gesehen.belege).toHaveLength(0);
  });
});
