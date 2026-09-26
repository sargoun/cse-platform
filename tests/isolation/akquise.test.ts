import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { nimmAuf, liste, lade, verwirf, markiereGeprueft, AkquiseFehler }
  from '../../src/server/services/akquise/ziel.js';
import { uebernehmen } from '../../src/server/services/akquise/uebernahme.js';
import { quellen } from '../../src/server/services/akquise/quelle.js';
import { laufeMandant } from '../../src/server/jobs/akquise.js';

/**
 * Die Akquise (§12) — gegen die echte Datenbank.
 *
 * **Drei Zusagen werden hier geprüft, und alle drei sind rechtlicher Natur:**
 *
 *  1. **Keine Personendaten.** `akquise_ziel` hat keine Spalte für einen Namen
 *     und lässt keine personalisierte E-Mail zu. Der Grund ist Art. 14 DSGVO:
 *     wer Daten nicht bei der betroffenen Person erhebt, muss sie binnen eines
 *     Monats informieren. Was gar nicht gespeichert wird, löst die Pflicht
 *     nicht aus.
 *  2. **Keine vorgetäuschte Recherche.** Ohne verbundene Quelle wird der Lauf
 *     als `uebersprungen` MIT Grund protokolliert. Ein Lauf, der still „0
 *     Treffer" meldet, sieht aus wie ein schlechter Markt statt wie eine
 *     fehlende Verbindung.
 *  3. **Mandantentrennung.** Eine recherchierte Firmenliste ist eine
 *     Vertriebsinformation. Die Reinigung darf die der Security nicht sehen —
 *     das sind verschiedene juristische Personen.
 *
 * Und eine fachliche: dieselbe Firma zweimal in der Liste heisst zwei Anrufe.
 */

let f: Fixtur;
let benutzer: string;

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('vertrieb@akquise.test') returning id`);
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'vertrieb@akquise.test', 'Vertrieb', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [benutzer]);
  for (const m of [f.reinigung, f.security]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
      [benutzer, m]);
  }
});
afterAll(async () => { await schliessen(); });

function sitzung(mandantId: string) {
  return { scope: 'mandant' as const, mandantId, benutzerId: benutzer,
           readonly: false, portal: 'intern' as const };
}

describe('§1 keine Personendaten — Art. 14 DSGVO als Spaltendefinition', () => {
  it('hat gar keine Spalte für einen Ansprechpartner', async () => {
    const spalten = await sql.unsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'akquise_ziel'`);
    const namen = spalten.map((s) => s.column_name);
    /*
     * Der Test liest die LEBENDE Tabelle und nicht die Migrationsdatei. Wer
     * die Spalte spaeter hinzufuegt, faellt hier auf — und genau das ist der
     * Zweck: die Entscheidung soll nicht still rueckgaengig gemacht werden
     * koennen.
     */
    for (const verboten of ['vorname', 'nachname', 'ansprechpartner', 'ansprechpartner_id',
                            'kontakt_name', 'position', 'geburtsdatum', 'mobil']) {
      expect(namen).not.toContain(verboten);
    }
  });

  it('weist eine personalisierte E-Mail-Adresse NICHT ab — denn sie prüft die Form, nicht den Inhalt',
    async () => {
      /*
       * Ehrlichkeit ueber die Grenze der Pruefung: `max.mustermann@firma.de`
       * hat dieselbe FORM wie `info@firma.de`. Eine Datenbank kann einen
       * Personennamen nicht erkennen. Der CHECK haelt kaputte Adressen drausen,
       * die Trennung „allgemein statt persoenlich" traegt der Typ `Fund` und
       * die Anweisung an den, der eine Quelle anschliesst — nicht diese Spalte.
       * Dieser Fall steht hier, damit niemand die Spalte fuer einen Schutz
       * haelt, den sie nicht leistet.
       */
      await expect(alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
        firmenname: 'Formprüfung GmbH', allgemeineEmail: 'max.mustermann@firma.de',
      }))).resolves.toBeTruthy();
    });

  it('weist eine kaputte E-Mail-Adresse ab', async () => {
    await expect(alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Kaputt GmbH', allgemeineEmail: 'kein-at-zeichen',
    }))).rejects.toThrow();
  });
});

describe('§2 dieselbe Firma nicht zweimal', () => {
  it('nimmt sie beim zweiten Mal als „bekannt", nicht als neu', async () => {
    const a = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Doppelt Hausverwaltung GmbH', ort: 'Berlin', plz: '10115',
    }));
    const b = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Doppelt Hausverwaltung GmbH', ort: 'Berlin', plz: '10115',
    }));
    expect(a.zustand).toBe('neu');
    expect(b.zustand).toBe('bekannt');
    expect(b.id).toBeNull();
  });

  it('erkennt sie auch bei anderer Gross-/Kleinschreibung', async () => {
    await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Schreibweise GmbH', ort: 'Berlin',
    }));
    const b = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'schreibweise gmbh', ort: 'berlin',
    }));
    expect(b.zustand).toBe('bekannt');
  });

  it('hält zwei Standorte derselben Kette AUSEINANDER', async () => {
    /*
     * Der eindeutige Index nimmt Name UND Ort. Eine Kette mit Filialen in
     * Berlin und Potsdam sind zwei Gespraeche mit zwei Objektleitungen — sie
     * zusammenzuziehen hiesse, den zweiten Standort nie anzurufen.
     */
    const a = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Kette GmbH', ort: 'Berlin',
    }));
    const b = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Kette GmbH', ort: 'Potsdam',
    }));
    expect(a.zustand).toBe('neu');
    expect(b.zustand).toBe('neu');
  });

  it('lässt dieselbe Firma bei EINER ANDEREN Gesellschaft zu', async () => {
    /*
     * Der Index traegt `mandant_id`. Eine Hausverwaltung kann Reinigung UND
     * Objektschutz brauchen; das sind zwei Gesellschaften, zwei Vertriebe und
     * zwei Vorgaenge.
     */
    await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Beidseitig GmbH', ort: 'Berlin',
    }));
    const b = await alsApp(sitzung(f.security), (tx) => nimmAuf(tx, f.security, {
      firmenname: 'Beidseitig GmbH', ort: 'Berlin',
    }));
    expect(b.zustand).toBe('neu');
  });
});

describe('§3 Mandantentrennung', () => {
  it('zeigt der Security die Liste der Reinigung nicht', async () => {
    await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Nur für die Reinigung GmbH', ort: 'Berlin',
    }));
    const beiSecurity = await alsApp(sitzung(f.security), (tx) => liste(tx, f.security));
    expect(beiSecurity.map((z) => z.firmenname)).not.toContain('Nur für die Reinigung GmbH');
  });

  it('gibt ein fremdes Ziel als „gibt es nicht" zurück, nicht als „verboten" (AUT-06)', async () => {
    const eigen = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Fremdzugriff GmbH', ort: 'Berlin',
    }));
    const fremd = await alsApp(sitzung(f.security), (tx) => lade(tx, f.security, eigen.id!));
    expect(fremd).toBeNull();
  });
});

describe('§4 der Lauf ohne verbundene Quelle', () => {
  it('protokolliert „übersprungen" MIT Grund — nicht „0 Treffer"', async () => {
    await sql.unsafe(
      `insert into akquise_quelle (mandant_id, art, bezeichnung, hinweis)
       values ($1, 'register', 'Handelsregister (Testfall)',
               'Kein Abrufvertrag hinterlegt.')`, [f.security]);

    const befund = await laufeMandant(sql, f.security);

    expect(befund.quellen).toBe(1);
    expect(befund.uebersprungen).toBe(1);
    expect(befund.gefunden).toBe(0);
    const [lauf] = befund.laeufe;
    expect(lauf!.ergebnis).toBe('uebersprungen');
    expect(lauf!.meldung).toContain('nicht verbunden');
    expect(lauf!.meldung).toContain('Kein Abrufvertrag');
    /*
     * Und die Zeile steht wirklich in der Tabelle — nicht nur im Rueckgabewert.
     * Genau daran haengt die Zusage: wer morgen frueh in die Laufliste sieht,
     * soll den Grund lesen koennen.
     */
    const [gespeichert] = await sql.unsafe<{ ergebnis: string; meldung: string }[]>(
      `select ergebnis, meldung from akquise_lauf where id = $1`, [lauf!.laufId]);
    expect(gespeichert!.ergebnis).toBe('uebersprungen');
    expect(gespeichert!.meldung).toContain('O-596');
  });

  it('LIEST die Quellen auch aus der Anwendung — nur schreiben darf sie nicht', async () => {
    const alle = await alsApp(sitzung(f.security), (tx) => quellen(tx, f.security));
    expect(alle.length).toBeGreaterThan(0);
    expect(alle.every((q) => !q.verbunden)).toBe(true);

    /*
     * `akquise_lauf` gibt `cse_app` kein INSERT (0172). Das ist die Zusage,
     * die diesen Lauf zu einem Nachtlauf macht statt zu einem Knopf: eine
     * Recherche ist nichts, was jemand mit einem Klick beliebig oft auslöst.
     */
    await expect(alsApp(sitzung(f.security), (tx) => tx.unsafe(
      `insert into akquise_lauf (mandant_id, ergebnis) values ($1, 'erfolg')`,
      [f.security],
    ))).rejects.toThrow(/permission denied/u);
  });

  it('eine Quelle gilt nur als verbunden, wenn sie eine Adresse hat', async () => {
    await expect(sql.unsafe(
      `insert into akquise_quelle (mandant_id, art, bezeichnung, verbunden)
       values ($1, 'dienstleister', 'Anbieter ohne Adresse', true)`, [f.reinigung],
    )).rejects.toThrow(/verbunden_hat_url/u);
  });
});

describe('§5 die Übernahme in einen Lead', () => {
  it('legt einen Lead mit quelle = akquise an und verknüpft beide Seiten', async () => {
    const ziel = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Übernahme Hausverwaltung GmbH', branche: 'Hausverwaltung',
      ort: 'Berlin', plz: '10115',
    }));

    const ergebnis = await alsApp(sitzung(f.reinigung), (tx) =>
      uebernehmen(tx, f.reinigung, { zielId: ziel.id!, besitzerBenutzerId: benutzer }));

    const [lead] = await sql.unsafe<{
      quelle: string; firma_name: string; ansprechpartner_id: string | null;
      punktzahl: number | null; punktzahl_begruendung: string | null;
    }[]>(`select quelle, firma_name, ansprechpartner_id, punktzahl, punktzahl_begruendung
            from lead where id = $1`, [ergebnis.leadId]);

    expect(lead!.quelle).toBe('akquise');
    expect(lead!.firma_name).toBe('Übernahme Hausverwaltung GmbH');
    /*
     * **Der wichtigste Wert dieser Datei.** Ohne Ansprechpartner laesst
     * `app.darf_kontaktiert_werden` keine elektronische Werbung durch. Die
     * Uebernahme erfindet keinen — sie KANN keinen erfinden, weil `akquise_ziel`
     * keinen speichert. Der Lead steht damit im Vertrieb, ist aber nicht
     * anschreibbar, bis ein Mensch einen Kontakt anlegt und dessen
     * Rechtsgrundlage benennt.
     */
    expect(lead!.ansprechpartner_id).toBeNull();
    expect(lead!.punktzahl_begruendung).toContain('PLATZHALTER');

    const [nachher] = await sql.unsafe<{ status: string; lead_id: string }[]>(
      `select status, lead_id from akquise_ziel where id = $1`, [ziel.id]);
    expect(nachher!.status).toBe('uebernommen');
    expect(nachher!.lead_id).toBe(ergebnis.leadId);
  });

  it('schreibt die erste Aktivität als INTERN — sonst gilt der Lead als beantwortet', async () => {
    const ziel = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Erstreaktion GmbH', ort: 'Berlin',
    }));
    const e = await alsApp(sitzung(f.reinigung), (tx) =>
      uebernehmen(tx, f.reinigung, { zielId: ziel.id!, besitzerBenutzerId: benutzer }));

    const [akt] = await sql.unsafe<{ richtung: string; zweck: string }[]>(
      `select richtung, zweck from lead_aktivitaet where lead_id = $1`, [e.leadId]);
    expect(akt!.richtung).toBe('intern');
    expect(akt!.zweck).toBe('intern');

    const [lead] = await sql.unsafe<{ erste_reaktion_am: Date | null }[]>(
      `select erste_reaktion_am from lead where id = $1`, [e.leadId]);
    expect(lead!.erste_reaktion_am).toBeNull();
  });

  it('übernimmt dieselbe Firma nicht zweimal', async () => {
    const ziel = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Nur einmal GmbH', ort: 'Berlin',
    }));
    await alsApp(sitzung(f.reinigung), (tx) =>
      uebernehmen(tx, f.reinigung, { zielId: ziel.id!, besitzerBenutzerId: benutzer }));

    await expect(alsApp(sitzung(f.reinigung), (tx) =>
      uebernehmen(tx, f.reinigung, { zielId: ziel.id!, besitzerBenutzerId: benutzer })))
      .rejects.toThrow(AkquiseFehler);
  });

  it('lässt ein übernommenes Ziel nicht mehr verwerfen', async () => {
    const ziel = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Schon im Vertrieb GmbH', ort: 'Berlin',
    }));
    await alsApp(sitzung(f.reinigung), (tx) =>
      uebernehmen(tx, f.reinigung, { zielId: ziel.id!, besitzerBenutzerId: benutzer }));
    await expect(alsApp(sitzung(f.reinigung), (tx) =>
      verwirf(tx, f.reinigung, ziel.id!, 'doch kein Bedarf'))).rejects.toThrow(AkquiseFehler);
  });
});

describe('§6 verwerfen und prüfen', () => {
  it('verlangt einen Grund', async () => {
    const ziel = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Ohne Grund GmbH', ort: 'Berlin',
    }));
    await expect(alsApp(sitzung(f.reinigung), (tx) =>
      verwirf(tx, f.reinigung, ziel.id!, '   '))).rejects.toThrow(AkquiseFehler);
  });

  it('merkt sich, wer geprüft hat — und gibt es auch HERAUS (V-080)', async () => {
    /*
     * **Der Befund hinter dieser Prüfung.** `markiereGeprueft` stempelte
     * `angesehen_am` und `angesehen_von` seit je, die Route nahm die Handlung
     * entgegen — und kein Formular schickte sie; der Zustand `geprueft` wurde
     * auf dem Blatt als „In Arbeit" beschriftet und entstand nie. Und selbst
     * wenn: der Blick gab die beiden Felder nicht heraus, die Seite konnte
     * also gar nicht zeigen, WER hingesehen hat.
     */
    const ziel = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: `Angesehen ${String(Math.random()).slice(2, 10)} GmbH`, ort: 'Berlin',
    }));
    expect(ziel.zustand).toBe('neu');
    const vorher = await alsApp(sitzung(f.reinigung),
      (tx) => lade(tx, f.reinigung, ziel.id!));
    expect(vorher!.status).toBe('neu');
    expect(vorher!.angesehenAm).toBeNull();

    await alsApp(sitzung(f.reinigung), (tx) =>
      markiereGeprueft(tx, f.reinigung, ziel.id!, benutzer));
    const nach = await alsApp(sitzung(f.reinigung), (tx) => lade(tx, f.reinigung, ziel.id!));
    expect(nach!.status).toBe('geprueft');
    expect(nach!.angesehenAm).toBeInstanceOf(Date);
    expect(nach!.angesehenVon).toBe('Vertrieb');
  });

  it('holt ein übernommenes Ziel NICHT auf `geprueft` zurück', async () => {
    /*
     * `case when status = 'neu' then 'geprueft'` — der Zustand geht nur aus
     * `neu` heraus. Ein übernommenes Ziel, das noch einmal jemand ansieht,
     * fiele sonst hinter den Vertrieb zurück, und die Liste zeigte es wieder
     * als unentschieden.
     */
    /*
     * Der Name traegt eine Zufallsendung: `nimmAuf` legt mit `on conflict do
     * nothing` an und gibt dann `{ id: null, zustand: 'bekannt' }` zurueck —
     * ein zweiter Lauf gegen dieselbe Datenbank fiele sonst mit „Dieses
     * Akquiseziel gibt es nicht" um, und zwar an einer Stelle, die nichts
     * damit zu tun hat.
     */
    const ziel = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: `Schon im Vertrieb ${String(Math.random()).slice(2, 10)} GmbH`,
      ort: 'Berlin',
    }));
    expect(ziel.zustand, 'die Fixtur legt wirklich an').toBe('neu');
    await alsApp(sitzung(f.reinigung), (tx) => uebernehmen(tx, f.reinigung, {
      zielId: ziel.id!, besitzerBenutzerId: benutzer,
    }));
    await alsApp(sitzung(f.reinigung), (tx) =>
      markiereGeprueft(tx, f.reinigung, ziel.id!, benutzer));
    const nach = await alsApp(sitzung(f.reinigung), (tx) => lade(tx, f.reinigung, ziel.id!));
    expect(nach!.status).toBe('uebernommen');
    /* Der Zeitstempel wird trotzdem erneuert — wann zuletzt jemand hinsah. */
    expect(nach!.angesehenAm).toBeInstanceOf(Date);
  });

  it('löscht nicht — es gibt keinen harten Löschweg (Invariante 8)', async () => {
    const ziel = await alsApp(sitzung(f.reinigung), (tx) => nimmAuf(tx, f.reinigung, {
      firmenname: 'Unlöschbar GmbH', ort: 'Berlin',
    }));
    await expect(sql.unsafe(`delete from akquise_ziel where id = $1`, [ziel.id]))
      .rejects.toThrow();
  });
});

describe('§7 die Liste sortiert nach Punktzahl', () => {
  it('stellt die besser passende Firma nach vorn', async () => {
    const m = f.bau;
    await alsApp({ ...sitzung(m) }, (tx) => nimmAuf(tx, m, {
      firmenname: 'Namenlos ohne Merkmale AG',
    }));
    await alsApp({ ...sitzung(m) }, (tx) => nimmAuf(tx, m, {
      firmenname: 'Bauträger Mitte GmbH', branche: 'Bauträger',
      plz: '10115', telefon: '030 1',
    }));
    const l = await alsApp({ ...sitzung(m) }, (tx) => liste(tx, m));
    expect(l[0]!.firmenname).toBe('Bauträger Mitte GmbH');
    expect(l[0]!.passenderBereich).toBe('bau');
  });
});
