/**
 * Das Kundenportal gegen eine ECHTE Datenbank mit FORCE RLS — die Policies aus
 * `0255` und `0256` (NOT-03, FIN-11, FIN-12, K-04, K-18, K-20, AUT-06).
 *
 * **Warum keine dieser Aussagen mockbar ist.** Sie sind alle Aussagen über
 * Policies, und eine Policy hat nur eine Datenbank. Schlimmer: der
 * Fehlermodus, den diese Datei absichert, ist NICHT eine Fehlermeldung,
 * sondern die leere Menge — „keine Nachrichten" statt „nicht erlaubt"
 * (04-SEITENKARTE §8, K-18). Ein Mock, der null Zeilen zurückgibt, bestätigt
 * genau die Verwechslung, die hier ausgeschlossen werden soll.
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Eine Nachricht mit `kunde_id` und einer Empfängerzeile auf einen
 *     Ansprechpartner DIESES Kunden ist im Kundenportal lesbar. Vor `0255`
 *     war sie es nicht — und das ist die Aussage, die den PR nötig gemacht
 *     hat.
 *  2. Ohne `kunde_id` bleibt sie unsichtbar, AUCH mit Empfängerzeile. Das
 *     schliesst den Weg über `t_nachricht_eigene` (0011/0231), der das Portal
 *     nicht fragt.
 *  3. `richtung = 'intern'` ist unsichtbar — ein interner Vermerk zum
 *     Kundenvorgang trägt `kunde_id` und ist trotzdem keine Kundennachricht.
 *  4. `geloescht_am` ist unsichtbar (Invariante 8: die Zeile bleibt für die
 *     Nachweisführung stehen, nicht für den Kunden).
 *  5. Der Faden eines FREMDEN Kunden derselben Gesellschaft ist unsichtbar
 *     (K-04).
 *  6. Das Mitarbeiterportal bleibt unberührt — `nachricht` IST die Tabelle
 *     des Mitarbeiterposteingangs (EMP-11), und die Kundendecke durfte ihn
 *     nicht stilllegen.
 *  7. `nachricht_empfaenger` zeigt dem Kunden nur die Zeilen SEINER
 *     Ansprechpartner, nie einen internen Mitempfänger (§8: „no names").
 *  8. Der Snapshot der EIGENEN festgeschriebenen Rechnung ist lesbar (0256) —
 *     vorher gab `p_intern_ceiling` dort null Zeilen, und PDF, ZUGFeRD und
 *     XRechnung antworteten 404.
 *  9. Der Snapshot einer FREMDEN Rechnung bleibt unsichtbar.
 * 10. Das Mitarbeiterportal sieht den Snapshot weiterhin NICHT.
 * 11. Kein Schreibweg: der Kunde kann weder eine Nachricht anlegen noch eine
 *     Empfängerzeile stempeln (O-74).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  fuegePositionHinzu, legeEntwurfAn, finalisiere, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import {
  belegAusgabe, findeKundenrechnung, mandantZurRechnung,
} from '../../src/server/services/kundenportal/rechnung.js';
import { zugferdZurRechnung } from '../../src/server/services/finanz/xrechnung/dienst.js';

let f: Fixtur;
/** Das interne Konto, das die Fixtur baut — globale Rolle `super_admin`. */
let chef = '';
/** Der Kunde mit Portalzugang, und der Kunde ohne. */
let kunde = '';
let fremderKunde = '';
let ansprechpartner = '';
let fremderAnsprechpartner = '';
/** Das Kundenkonto. */
let kundenkonto = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const hash = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

/**
 * Die Kundensitzung — genau so gebunden, wie `withKundeScope` sie bindet:
 * Scope `kunde`, KEIN aktiver Mandant (K-20), Portal `kunde`, nur lesend.
 */
function kundensitzung(benutzerId = kundenkonto) {
  return {
    scope: 'kunde' as const, mandantIds: [f.reinigung], benutzerId,
    portal: 'kunde' as const, readonly: true,
  };
}

/** Dieselbe Anmeldung, aber im MITARBEITERPORTAL — die K-04-Gegenprobe. */
function mitarbeitersitzung(benutzerId = kundenkonto) {
  return {
    scope: 'person' as const, mandantIds: [f.reinigung], benutzerId,
    portal: 'mitarbeiter' as const, readonly: true,
  };
}

async function zaehle(
  sitzung: Parameters<typeof alsApp>[0], tabelle: string, wo = 'true',
  werte: readonly unknown[] = [],
): Promise<number> {
  const zeilen = await alsApp(sitzung, async (tx) =>
    tx.unsafe<{ n: string }[]>(
      `select count(*)::text as n from ${tabelle} where ${wo}`, werte as never[]));
  return Number(zeilen[0]!.n);
}

/**
 * Eine Nachricht mit ihrer Empfängerzeile — der Normalfall, den `0255`
 * lesbar macht.
 *
 * `kanal = 'portal'`: `kern.nachricht_sendetor()` kehrt für diesen Kanal
 * sofort zurück (ein Faden im Portal geht nicht „hinaus", § 7 UWG spricht von
 * elektronischer Post). Für `richtung = 'ausgehend'` verlangt der CHECK
 * `nachricht_ausgehend_grundlage` trotzdem eine Rechtsgrundlage — sie ist der
 * Nachweis, nicht die Erlaubnis.
 */
async function nachricht(opts: {
  readonly kundeId?: string | null;
  readonly richtung?: 'intern' | 'eingehend' | 'ausgehend';
  readonly geloescht?: boolean;
  readonly empfaenger?: string | null;
  readonly betreff?: string;
}): Promise<string> {
  const richtung = opts.richtung ?? 'ausgehend';
  const [n] = await sql.unsafe<{ id: string }[]>(
    `insert into nachricht
       (mandant_id, kunde_id, absender_benutzer_id, betreff, koerper,
        richtung, kanal, rechtsgrundlage, zweck, gesendet_am, geloescht_am)
     values ($1, $2, $3, $4, 'Textkörper der Fixtur',
             $5::nachricht_richtung, 'portal',
             case when $5 = 'ausgehend' then 'bestandskunde'::rechtsgrundlage end,
             case when $5 = 'ausgehend' then 'vertraglich'::kommunikationszweck end,
             now(), case when $6 then now() end)
     returning id`,
    [f.reinigung, opts.kundeId ?? null, chef, opts.betreff ?? `Fixtur ${zufall()}`,
      richtung, opts.geloescht === true],
  );
  const empfaenger = opts.empfaenger === undefined ? ansprechpartner : opts.empfaenger;
  if (empfaenger !== null) {
    await sql.unsafe(
      `insert into nachricht_empfaenger
         (mandant_id, nachricht_id, empfaenger_typ, empfaenger_id, art)
       values ($1, $2, 'ansprechpartner', $3, 'an')`,
      [f.reinigung, n!.id, empfaenger]);
  }
  return n!.id;
}

/** Eine festgeschriebene Rechnung samt Snapshot — über den echten Dienst. */
async function festeRechnung(kundeId: string): Promise<string> {
  return alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef,
      portal: 'intern', readonly: false },
    async (tx) => {
      const d = alsDienst(tx);
      const id = await legeEntwurfAn(d, {
        kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31',
        zahlungszielTage: 30,
        /*
         * BT-81 (BR-DE-1). `zahlungsmittel_code` hat keinen Vorgabewert, und
         * ohne ihn meldet `fehlendePflichtfelder` ihn auf JEDEM Beleg — dann
         * sagte (21) zwar weiterhin `unvollstaendig`, aber aus dem falschen
         * Grund, und (22) käme nie auf `moeglich`. `58` ist die
         * SEPA-Überweisung; BR-DE-13 verlangt dazu die IBAN, und die legt
         * `mitAusgabefaehigenStammdaten` an.
         */
        zahlungsmittelCode: '58',
      });
      await fuegePositionHinzu(d, {
        rechnungId: id, bezeichnung: 'Unterhaltsreinigung August',
        menge: milliMenge(1000n), einheit: 'm2', einzelpreisCent: cent(100_00n),
        steuergruppe: 'ust_19',
        quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
      });
      await finalisiere(d, id);
      return id;
    });
}

beforeEach(async () => {
  f = await seed();

  const email = `chef-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Verwaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  chef = u!.id;

  /*
   * Die Gesellschaft muss fakturieren DÜRFEN, sonst weist
   * `mandant_ustg14_vollstaendig` die Festschreibung ab — und der Test fiele
   * an einer Bedingung, über die er nichts sagt.
   */
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            handelsregister_gericht = 'Amtsgericht Charlottenburg',
            handelsregister_nummer = 'HRB 12345 B'
      where id = $1`, [f.reinigung]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen KP', true, 'KP-{nr:5}',
             'nie', '2026-01-01', false, 'system', 'job:test')`, [f.reinigung]);

  const [k1] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1, $2, 'Berliner Hausverwaltung', 'Karl-Marx-Allee', '31', '10178', 'Berlin')
     returning id`, [f.reinigung, `K-${zufall()}`]);
  kunde = k1!.id;
  const [k2] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1, $2, 'Charlottenburg Immobilien', 'Bismarckstr', '1', '10625', 'Berlin')
     returning id`, [f.reinigung, `K-${zufall()}`]);
  fremderKunde = k2!.id;

  const [a1] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname, position)
     values ($1, $2, 'Aylin', 'Özdemir', 'Objektverantwortliche') returning id`,
    [f.reinigung, kunde]);
  ansprechpartner = a1!.id;
  const [a2] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname)
     values ($1, $2, 'Paul', 'Fremd') returning id`, [f.reinigung, fremderKunde]);
  fremderAnsprechpartner = a2!.id;

  /*
   * Der Kundenzugang über den echten Vorgang (`0249`) und nicht von Hand:
   * er legt Konto, Mitgliedschaft mit der Rolle `kunde`, die Bindung und das
   * Einladungstoken an — vier Zeilen, die nur zusammen `app.aktuelle_kunden()`
   * füllen. Von Hand gebaut wäre das eine Fixtur, die der Betrieb nie hat.
   */
  const [z] = await alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef,
      portal: 'intern', readonly: false },
    async (tx) => {
      await tx.unsafe(`select set_config('app.aal','aal2',true)`);
      return tx.unsafe<{ ok: boolean; konto_id: string | null }[]>(
        `select ok, konto_id from app.kundenzugang_ausstellen($1::uuid, $2, $3, $4)`,
        [kunde, `portal-${zufall()}@hv.test`, 'Bernd Beispiel',
          hash(randomBytes(32).toString('hex'))]);
    });
  expect(z!.ok).toBe(true);
  kundenkonto = z!.konto_id!;
});

afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('0255 · der Kundenfaden auf `nachricht`', () => {
  it('(1) mit `kunde_id` und Empfängerzeile ist die Nachricht lesbar', async () => {
    const id = await nachricht({ kundeId: kunde, betreff: 'Reinigungsplan Januar' });
    expect(await zaehle(kundensitzung(), 'nachricht', 'id = $1', [id])).toBe(1);

    /*
     * Und der TEXT kommt mit — die Policy gibt eine Zeile heraus, nicht eine
     * Kennung. Ohne diese Zeile wäre „lesbar" die halbe Aussage.
     */
    const [n] = await alsApp(kundensitzung(), async (tx) =>
      tx.unsafe<{ betreff: string; koerper: string }[]>(
        `select betreff, koerper from nachricht where id = $1`, [id]));
    expect(n!.betreff).toBe('Reinigungsplan Januar');
    expect(n!.koerper).toBe('Textkörper der Fixtur');
  });

  it('(2) OHNE `kunde_id` bleibt sie unsichtbar — auch mit Empfängerzeile', async () => {
    /*
     * **Das ist die Prüfung, die `p_kunde_decke` rechtfertigt.**
     * `t_nachricht_eigene` (0231) erlaubt `mandant_id = any
     * (sichtbare_mandanten()) and exists (Empfängerzeile)` und fragt das
     * Portal NICHT. Ohne die Decke käme eine Kundensitzung über diese Policy
     * herein — und zwar ohne jede Einschränkung auf Richtung, Löschung oder
     * Kundenbezug. Fällt diese Prüfung, ist die Decke weg.
     */
    const id = await nachricht({ kundeId: null });
    expect(await zaehle(kundensitzung(), 'nachricht', 'id = $1', [id])).toBe(0);
  });

  it('(3) ein interner Vermerk zum Kundenvorgang ist unsichtbar', async () => {
    const id = await nachricht({ kundeId: kunde, richtung: 'intern',
      betreff: 'INTERN: Bonität prüfen' });
    expect(await zaehle(kundensitzung(), 'nachricht', 'id = $1', [id])).toBe(0);
  });

  it('(4) eine weich gelöschte Nachricht ist unsichtbar', async () => {
    const id = await nachricht({ kundeId: kunde, geloescht: true });
    expect(await zaehle(kundensitzung(), 'nachricht', 'id = $1', [id])).toBe(0);
    // Sie IST noch da — Invariante 8, nur nicht für den Kunden.
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from nachricht where id = $1`, [id]);
    expect(z!.n).toBe('1');
  });

  it('(5) der Faden eines fremden Kunden ist unsichtbar (K-04)', async () => {
    const id = await nachricht({ kundeId: fremderKunde,
      empfaenger: fremderAnsprechpartner });
    expect(await zaehle(kundensitzung(), 'nachricht', 'id = $1', [id])).toBe(0);
  });

  it('(6) die eingehende Nachricht des Kunden ist ebenfalls lesbar', async () => {
    const id = await nachricht({ kundeId: kunde, richtung: 'eingehend' });
    expect(await zaehle(kundensitzung(), 'nachricht', 'id = $1', [id])).toBe(1);
  });

  it('(7) dieselbe Anmeldung im MITARBEITERPORTAL sieht die Zeile nicht', async () => {
    /*
     * Die Gegenprobe zur K-04-Decke: `app.portal()` entscheidet, nicht die
     * Anmeldung. Ein Kundenkonto, das sich als Mitarbeiterportal ausgibt,
     * bekommt weder `t_kunde` (die verlangt `app.scope() = 'kunde'`) noch die
     * Kundenzweige der Decke.
     */
    const id = await nachricht({ kundeId: kunde });
    expect(await zaehle(mitarbeitersitzung(), 'nachricht', 'id = $1', [id])).toBe(0);
  });

  it('(8) das interne Portal sieht weiterhin ALLES — die Decke sperrt es nicht', async () => {
    /*
     * `nachricht` IST die Tabelle des Mitarbeiter- und des internen
     * Posteingangs (EMP-11). Wäre `p_kunde_decke` als
     * `app.portal() = 'intern' or (…)` formuliert — die Form von
     * `reklamation.p_portal_decke` —, hätte 0255 das Mitarbeiterportal
     * stillgelegt. Diese Prüfung hält die gewählte Form fest.
     */
    const intern = await nachricht({ kundeId: null, richtung: 'intern' });
    const geloescht = await nachricht({ kundeId: kunde, geloescht: true });
    const fremd = await nachricht({ kundeId: fremderKunde,
      empfaenger: fremderAnsprechpartner });
    const sitzung = { scope: 'mandant' as const, mandantId: f.reinigung,
      benutzerId: chef, portal: 'intern' as const, readonly: true };
    for (const id of [intern, geloescht, fremd]) {
      expect(await zaehle(sitzung, 'nachricht', 'id = $1', [id])).toBe(1);
    }
  });
});

describe('0255 · `nachricht_empfaenger` im Kundenzugang', () => {
  it('(9) die Zeile des eigenen Ansprechpartners ist lesbar', async () => {
    await nachricht({ kundeId: kunde });
    expect(await zaehle(kundensitzung(), 'nachricht_empfaenger',
      'empfaenger_id = $1', [ansprechpartner])).toBe(1);
  });

  it('(10) die Zeile eines internen Mitempfängers ist unsichtbar (§8: keine Namen)',
    async () => {
      const id = await nachricht({ kundeId: kunde });
      /*
       * Ein Verteiler im Haus: derselbe Vorgang, eine zweite Empfängerzeile
       * auf ein BENUTZERkonto. Der Kunde darf die Nachricht lesen — wer sie
       * intern in Kopie bekommt, ist keine Auskunft für ihn.
       */
      await sql.unsafe(
        `insert into nachricht_empfaenger
           (mandant_id, nachricht_id, empfaenger_typ, empfaenger_id, art)
         values ($1, $2, 'benutzer', $3, 'kopie')`, [f.reinigung, id, chef]);

      expect(await zaehle(kundensitzung(), 'nachricht_empfaenger',
        'nachricht_id = $1', [id])).toBe(1);
      expect(await zaehle(kundensitzung(), 'nachricht_empfaenger',
        `nachricht_id = $1 and empfaenger_typ = 'benutzer'`, [id])).toBe(0);
    });

  it('(11) die Zeile eines fremden Ansprechpartners ist unsichtbar', async () => {
    await nachricht({ kundeId: fremderKunde, empfaenger: fremderAnsprechpartner });
    expect(await zaehle(kundensitzung(), 'nachricht_empfaenger',
      'empfaenger_id = $1', [fremderAnsprechpartner])).toBe(0);
  });

  /*
   * =========================================================================
   * Die KOPFFAKTEN auf der Kindtabelle — die drei Fälle, die (10) nicht deckt
   * =========================================================================
   *
   * (10) prüft die EMPFÄNGERdimension: ein interner MITempfänger bleibt
   * verborgen. Die drei hier prüfen die NACHRICHTENdimension — und genau die
   * fehlte: `t_kunde` verengte nur auf den Empfänger, und auf
   * `nachricht_empfaenger` gibt es ausser `p_beteiligt` keine Kundendecke,
   * deren Kundenzweig mit `t_kunde` WORTGLEICH ist. Gemessen sah der Kunde
   * fünf Empfängerzeilen zu zwei sichtbaren Nachrichten; herausgegeben waren
   * damit Existenz, `erstellt_am`, `zugestellt_am` und `gelesen_am` interner
   * und zurückgezogener Vorgänge.
   *
   * Heute zeigt keine Seite diese Tabelle unmittelbar — der `exists` für
   * „gelesen" ist über `n.id` gebunden. RLS ist hier die zweite
   * Verteidigungslinie (Invariante 3), und die hielt nicht, was die Migration
   * behauptete.
   */
  it('(11a) die Empfängerzeile eines INTERNEN Vermerks ist unsichtbar', async () => {
    const id = await nachricht({ kundeId: kunde, richtung: 'intern' });
    expect(await zaehle(kundensitzung(), 'nachricht_empfaenger',
      'nachricht_id = $1', [id])).toBe(0);
    // Sie existiert — nur nicht für den Kunden.
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from nachricht_empfaenger where nachricht_id = $1`, [id]);
    expect(z!.n).toBe('1');
  });

  it('(11b) die Empfängerzeile einer weich gelöschten Nachricht ist unsichtbar',
    async () => {
      const id = await nachricht({ kundeId: kunde, geloescht: true });
      expect(await zaehle(kundensitzung(), 'nachricht_empfaenger',
        'nachricht_id = $1', [id])).toBe(0);
    });

  it('(11c) die Empfängerzeile einer Nachricht OHNE Kundenbezug ist unsichtbar',
    async () => {
      /*
       * Die Empfängerzeile zeigt auf einen Ansprechpartner DIESES Kunden —
       * genau der Fall, den die alte, wortgleiche Bedingung durchliess.
       */
      const id = await nachricht({ kundeId: null });
      expect(await zaehle(kundensitzung(), 'nachricht_empfaenger',
        'nachricht_id = $1', [id])).toBe(0);
    });

  it('(11d) ein Statuswechsel am Kopf schreibt sich auf die Kindzeile fort',
    async () => {
      /*
       * Die Denormalisierung ist nur so viel wert wie ihr Auslöser. Ohne die
       * Gegenrichtung trüge die Empfängerzeile einer nachträglich gelöschten
       * Nachricht den alten Stand — und die Decke entschiede nach einer
       * veralteten Angabe, also zu WEIT.
       */
      const id = await nachricht({ kundeId: kunde });
      expect(await zaehle(kundensitzung(), 'nachricht_empfaenger',
        'nachricht_id = $1', [id])).toBe(1);

      await sql.unsafe(`update nachricht set geloescht_am = now() where id = $1`, [id]);
      expect(await zaehle(kundensitzung(), 'nachricht_empfaenger',
        'nachricht_id = $1', [id])).toBe(0);
    });

  it('(11e) das interne Portal sieht die drei Zeilen weiterhin', async () => {
    /*
     * Dieselbe Gegenprobe wie (8): `nachricht_empfaenger` ist die
     * Zustellliste des MITARBEITERposteingangs (EMP-11). Eine Decke in der
     * Form `app.portal() = 'intern' or (…)` hätte ihn stillgelegt.
     */
    const intern = await nachricht({ kundeId: kunde, richtung: 'intern' });
    const geloescht = await nachricht({ kundeId: kunde, geloescht: true });
    const ohneKunde = await nachricht({ kundeId: null });
    const sitzung = { scope: 'mandant' as const, mandantId: f.reinigung,
      benutzerId: chef, portal: 'intern' as const, readonly: true };
    for (const id of [intern, geloescht, ohneKunde]) {
      expect(await zaehle(sitzung, 'nachricht_empfaenger', 'nachricht_id = $1', [id]))
        .toBe(1);
    }
  });
});

describe('0255 · kein Schreibweg im Kundenportal (O-74)', () => {
  it('(12) der Kunde kann keine Nachricht anlegen', async () => {
    await expect(alsApp(kundensitzung(), async (tx) =>
      tx.unsafe(
        `insert into nachricht
           (mandant_id, kunde_id, betreff, koerper, richtung, kanal)
         values ($1, $2, 'Antwort', 'Text', 'eingehend', 'portal')`,
        [f.reinigung, kunde]))).rejects.toThrow();
  });

  it('(13) der Kunde kann keine Empfängerzeile stempeln', async () => {
    const id = await nachricht({ kundeId: kunde });
    /*
     * Kein `rejects`: ein UPDATE, das keine Zeile TRIFFT, ist kein Fehler —
     * es ändert nichts. Genau das ist die Aussage, und sie ist stärker als
     * eine Fehlermeldung: es gibt keinen Weg, `gelesen_am` zu setzen.
     * `t_empfaenger_eigene_stempeln` greift nur für `person`/`benutzer`, und
     * der Kunde ist als `ansprechpartner` adressiert.
     */
    await alsApp(kundensitzung(), async (tx) =>
      tx.unsafe(`update nachricht_empfaenger set gelesen_am = now()
                  where nachricht_id = $1`, [id]));
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from nachricht_empfaenger
        where nachricht_id = $1 and gelesen_am is not null`, [id]);
    expect(z!.n).toBe('0');
  });
});

describe('0256 · der Snapshot der eigenen Rechnung', () => {
  it('(14) der Kunde liest den Snapshot seiner festgeschriebenen Rechnung', async () => {
    const id = await festeRechnung(kunde);
    /*
     * **Das ist der Satz, den `zugferd.pdf/route.ts` im Kommentar
     * vorgemerkt hat.** Vor 0256 gab `p_intern_ceiling` hier null Zeilen,
     * `left join rechnung_snapshot` lieferte `nutzlast_bytes IS NULL`, der
     * Dienst warf `KeinSnapshotFehler` — und die Route antwortete 404 für
     * einen Beleg, der dem Anrufer gehört.
     */
    expect(await zaehle(kundensitzung(), 'rechnung_snapshot',
      'rechnung_id = $1', [id])).toBe(1);

    // Und die NUTZLAST kommt mit: ohne sie entsteht kein Dokument (K-12).
    const [s] = await alsApp(kundensitzung(), async (tx) =>
      tx.unsafe<{ hat_bytes: boolean }[]>(
        `select nutzlast_bytes is not null as hat_bytes
           from rechnung_snapshot where rechnung_id = $1`, [id]));
    expect(s!.hat_bytes).toBe(true);
  });

  it('(15) der Snapshot einer FREMDEN Rechnung bleibt unsichtbar (K-04)', async () => {
    const fremd = await festeRechnung(fremderKunde);
    expect(await zaehle(kundensitzung(), 'rechnung_snapshot',
      'rechnung_id = $1', [fremd])).toBe(0);
  });

  it('(16) das Mitarbeiterportal sieht den Snapshot weiterhin NICHT', async () => {
    const id = await festeRechnung(kunde);
    expect(await zaehle(mitarbeitersitzung(), 'rechnung_snapshot',
      'rechnung_id = $1', [id])).toBe(0);
  });

  it('(17) das interne Portal liest ihn wie bisher — die Decke sperrt es nicht',
    async () => {
      const id = await festeRechnung(kunde);
      const sitzung = { scope: 'mandant' as const, mandantId: f.reinigung,
        benutzerId: chef, portal: 'intern' as const, readonly: true };
      expect(await zaehle(sitzung, 'rechnung_snapshot', 'rechnung_id = $1', [id])).toBe(1);
    });

  it('(18) `rechnung_hash` bleibt dem Kunden verschlossen', async () => {
    /*
     * Die Kette ist die INTERNE Beweisführung (Invariante 4): wer sie liest,
     * prüft die Lückenlosigkeit. Der Kunde bekommt seinen Beleg, nicht das
     * Prüfwerkzeug. `0256` hat `rechnung_hash` deshalb nicht angefasst, und
     * diese Prüfung fällt, wenn jemand es „der Symmetrie wegen" nachzieht.
     */
    const id = await festeRechnung(kunde);
    expect(await zaehle(kundensitzung(), 'rechnung_hash',
      'rechnung_id = $1', [id])).toBe(0);
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from rechnung_hash where rechnung_id = $1`, [id]);
    expect(z!.n).toBe('1');
  });

  it('(19) der Kunde kann keinen Snapshot schreiben', async () => {
    const id = await festeRechnung(kunde);
    await expect(alsApp(kundensitzung(), async (tx) =>
      tx.unsafe(
        `insert into rechnung_snapshot
           (rechnung_id, mandant_id, schema_version, nutzlast_bytes, nutzlast)
         values ($1, $2, 'v2', '\\x00'::bytea, '{}'::jsonb)`,
        [id, f.reinigung]))).rejects.toThrow();
  });
});

/**
 * =========================================================================
 * Der AUSGABEWEG — bis zu den Bytes, nicht nur bis zur Policy
 * =========================================================================
 *
 * Dass der Snapshot lesbar IST, sagt (14). Dass daraus ein Dokument WIRD,
 * sagte bis hierher nichts — und genau da klaffte die Lücke: `belegAusgabe`
 * antwortete für jede Rechnung des Portalkunden `unvollstaendig`, weil BT-10
 * (Käuferreferenz, BR-DE-15) unabhängig von `leitwegPflicht` Pflicht ist und
 * im Demobestand bei keinem Beleg stand. Die Seite rendert dann immer den
 * Erklärsatz und NIE einen der beiden Knöpfe; Migration 0256, die zwei
 * Ausgaberouten und der Snapshot-Lesepfad liefen in keinem Durchlauf mit.
 *
 * Diese drei Prüfungen gehen denselben Weg wie die Route, nur ohne ihren
 * HTTP-Mantel: derselbe Kunden-Scope, dieselben Dienste, dieselbe
 * Reihenfolge (`mandantZurRechnung` → `belegAusgabe` → `zugferdZurRechnung`).
 * Dass der Mantel darum herum stimmt — `withKundeScope`, `authorize` mit dem
 * Bereich der Rechnung, 404 statt 403 —, hält die Quelltextwache in
 * `tests/kern/kundenportal.test.ts`.
 */
describe('0256 · aus dem eigenen Snapshot wird wirklich ein Dokument', () => {
  /**
   * Was ein Beleg BRAUCHT, damit aus ihm ein Dokument wird — und was der Seed
   * dem Portalkunden deshalb mitgibt.
   *
   * Drei Angaben, drei EN-16931-Felder: BT-10 (Käuferreferenz, BR-DE-15, hier
   * `kaeufer_referenz`), BT-49/BT-49-1 (elektronische Adresse des Empfängers
   * samt EAS-Schema) und — an der Gesellschaft — die IBAN zu BT-84
   * (BR-DE-13), weil `festeRechnung` mit `58` die SEPA-Überweisung angibt.
   */
  async function mitAusgabefaehigenStammdaten(kundeId: string): Promise<void> {
    await sql.unsafe(
      `update kunde
          set kaeufer_referenz = 'BHV-OBJ-10115',
              elektronische_adresse = 'rechnungseingang@bhv-berlin.example',
              elektronische_adresse_schema = 'EM'
        where id = $1`, [kundeId]);
    await sql.unsafe(
      `insert into bankkonto
         (mandant_id, bezeichnung, iban, bic, kontoinhaber, ist_standard,
          erstellt_von_art, erstellt_von_dienst)
       values ($1, 'Geschäftskonto', 'DE02120300000000202051', 'BYLADEM1001',
               'CSE Dienstleistungen GmbH', true, 'system', 'job:test')
       on conflict do nothing`, [f.reinigung]);
  }

  it('(21) ohne Käuferreferenz meldet `belegAusgabe` `unvollstaendig` — BT-10',
    async () => {
      /*
       * Der Zustand VOR der Seedergänzung, als Prüfung festgehalten: er ist
       * nicht falsch, sondern der ehrliche Befund eines unvollständigen
       * Stammsatzes. Fällt diese Prüfung, weil BT-10 plötzlich optional ist,
       * gehört die Kundenseite neu bewertet — nicht die Prüfung gelöscht.
       */
      const id = await festeRechnung(kunde);
      const zustand = await alsApp(kundensitzung(), async (tx) =>
        belegAusgabe(alsDienst(tx), id));
      expect(zustand.art).toBe('unvollstaendig');
    });

  it('(22) MIT den beiden Angaben entsteht ein PDF im Kunden-Scope', async () => {
    await mitAusgabefaehigenStammdaten(kunde);
    const id = await festeRechnung(kunde);

    const ergebnis = await alsApp(kundensitzung(), async (tx) => {
      const d = alsDienst(tx);
      return {
        mandantId: await mandantZurRechnung(d, id),
        zustand: await belegAusgabe(d, id),
        datei: await zugferdZurRechnung(d, id),
      };
    });

    // Der Bereich, den die Route an `authorize` gibt — ohne ihn wäre es 404.
    expect(ergebnis.mandantId).toBe(f.reinigung);
    expect(ergebnis.zustand.art).toBe('moeglich');
    expect(ergebnis.datei).not.toBeNull();
    // Ein PDF, und zwar an seiner Signatur erkannt — nicht an seiner Länge.
    const kopf = Buffer.from(ergebnis.datei!.pdf.slice(0, 5)).toString('latin1');
    expect(kopf).toBe('%PDF-');
  });

  it('(23a) eine Gliederungszeile trägt KEINEN Betrag — und die Projektion sagt das',
    async () => {
      /*
       * **Der CHECK `rp_ohne_leistung_ohne_betrag` ERZWINGT NULL** für jede
       * Position mit `positionsart <> 'leistung'`, also für `textzeile` und
       * `zwischensumme`. Die Kundenprojektion hatte `nettoCent: string`
       * typisiert und die Belegseite rechnete `BigInt(p.nettoCent)` ohne
       * Wache — eine Schlussrechnung mit einer Gliederungszeile (der Normalfall
       * aus einem Leistungsverzeichnis) hätte `/portal/kunde/rechnungen/[id]`
       * mit `TypeError: Cannot convert null to a BigInt` auf 500 laufen
       * lassen: der Kunde sähe seinen eigenen Beleg gar nicht mehr.
       *
       * Der Demobestand führt nur `positionsart='leistung'` — genau der spät
       * entdeckte Ausfall, den CLAUDE.md meint. Deshalb steht die Zeile HIER
       * in der Fixtur und nicht im Seed.
       */
      const id = await alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef,
          portal: 'intern', readonly: false },
        async (tx) => {
          const d = alsDienst(tx);
          const rechnung = await legeEntwurfAn(d, {
            kundeId: kunde, leistungVon: '2026-08-01', leistungBis: '2026-08-31',
            zahlungszielTage: 30,
          });
          await fuegePositionHinzu(d, {
            rechnungId: rechnung, bezeichnung: 'Unterhaltsreinigung August',
            menge: milliMenge(1000n), einheit: 'm2', einzelpreisCent: cent(100_00n),
            steuergruppe: 'ust_19',
            quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
          });
          /*
           * Die Gliederungszeile von Hand: `fuegePositionHinzu` legt
           * ausschliesslich Leistungszeilen an (es berechnet einen Betrag),
           * und eine Textzeile ist genau die Zeile OHNE Betrag.
           * `rp_hat_quelle` lässt sie durch — der Auslöser kehrt für
           * `positionsart <> 'leistung'` sofort zurück.
           */
          await tx.unsafe(
            `insert into rechnungsposition
               (mandant_id, rechnung_id, position_nr, positionsart, bezeichnung,
                steuersatz_gruppe_id, satz_bp, kategorie,
                erstellt_von_art, erstellt_von)
             select $1, $2, 2, 'textzeile', 'Zwischenüberschrift: Treppenhaus',
                    g.id, g.satz_bp, g.kategorie, 'mensch', $3
               from steuersatz_gruppe g
              where g.schluessel = 'ust_19' and g.gueltig_bis is null
              order by g.gueltig_von desc limit 1`,
            [f.reinigung, rechnung, chef]);
          await finalisiere(d, rechnung);
          return rechnung;
        });

      const beleg = await alsApp(kundensitzung(), async (tx) =>
        findeKundenrechnung(alsDienst(tx), id));
      const text = beleg!.positionen.find((p) => p.nr === 2);
      expect(text).toBeDefined();
      expect(text!.nettoCent).toBeNull();
      // Dieselbe Constraint, dieselbe Nullbarkeit — die zwei waren schon richtig.
      expect(text!.menge).toBeNull();
      expect(text!.einzelpreisCent).toBeNull();
      // Und die Leistungszeile daneben trägt ihren Betrag weiterhin.
      const leistung = beleg!.positionen.find((p) => p.nr === 1);
      expect(leistung!.nettoCent).not.toBeNull();
    });

  it('(23) eine FREMDE Rechnung liefert keinen Bereich — daraus wird 404 (AUT-06)',
    async () => {
      await mitAusgabefaehigenStammdaten(fremderKunde);
      const fremd = await festeRechnung(fremderKunde);
      const mandantId = await alsApp(kundensitzung(), async (tx) =>
        mandantZurRechnung(alsDienst(tx), fremd));
      /*
       * `null` und nicht „kein Recht": die Route antwortet damit byte-gleich
       * mit „gibt es nicht", noch bevor ein Recht gefragt wird.
       */
      expect(mandantId).toBeNull();
    });
});

describe('K-18 · was im Kundenzugang STILL leer bleibt, bleibt es absichtlich', () => {
  it('(20) `zahlung`, `mahnung` und `bautagebuch` liefern null Zeilen', async () => {
    /*
     * Diese Prüfung ist keine Zusage über die drei Tabellen, sondern über die
     * DIENSTE: `kundenportal/zahlung.ts` liest `bezahlt_cent` aus
     * `offener_posten` und joint bewusst NICHT über `zahlung`, weil eine
     * Zuordnung zu einer stornierten Zahlung für den Kunden sichtbar bleibt
     * und der Storno nicht. Fällt diese Prüfung, weil eine der drei Tabellen
     * einen Kundenlesepfad bekommt, ist der Dienst neu zu bewerten — nicht
     * die Prüfung zu löschen.
     */
    for (const tabelle of ['zahlung', 'op_ausgleich', 'mahnung', 'bautagebuch',
      'nachtrag', 'behinderung', 'rechnungsausgangsbuch', 'leistungsverzeichnis']) {
      expect(await zaehle(kundensitzung(), tabelle), `${tabelle} ist im Kundenzugang offen`)
        .toBe(0);
    }
  });

  it('(21) ohne `kunde_zugang` ist die sichtbare Menge LEER — fail closed', async () => {
    /*
     * Die Grundlage der ganzen Huelle: `withKundeScope` wirft
     * `KeinKundenzugangFehler`, wenn `app.sichtbare_mandanten()` leer ist,
     * und die Seite sagt dann „kein Zugang hinterlegt" statt „keine
     * Rechnungen". Hier wird bewiesen, dass die Menge wirklich leer ist.
     */
    const zeilen = await alsApp(kundensitzung(chef), async (tx) =>
      tx.unsafe<{ ids: string[] | null; kunden: string[] | null }[]>(
        `select app.sichtbare_mandanten() as ids, app.aktuelle_kunden() as kunden`));
    expect(zeilen[0]!.ids ?? []).toEqual([]);
    expect(zeilen[0]!.kunden ?? []).toEqual([]);
  });
});
