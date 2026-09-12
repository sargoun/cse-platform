/**
 * Was passiert, wenn EIN Beleg zwei datierte Fassungen desselben Steuersatzes
 * trägt — der Pfad, den `0087` möglich gemacht und den niemand je gefahren hat.
 *
 * **Warum es diese Datei gibt.** `0087` hat `ssg_schluessel_uk` fallen lassen,
 * damit `ust_19` eine Geschichte haben kann. Damit können die Positionen EINES
 * Entwurfs auf zwei datierte Zeilen desselben Schlüssels zeigen — und
 * `schreibeSummen` hat dafür eine Abweisung (`mehrdeutige_steuergruppe`), die
 * in keinem einzigen Test vorkam. Eine Abweisung, die nie gelaufen ist, ist
 * eine Behauptung: sie könnte genauso gut unerreichbar sein, und der Beleg
 * wiese dann EINE datierte Gruppe für die Nettobeträge ZWEIER Sätze aus — nach
 * §14 Abs. 4 Nr. 8 UStG falsch, und nach dem Festschreiben unveränderlich.
 *
 * **Der Weg dorthin ist der normale Arbeitsablauf, keine Laborbedingung.**
 * Der Stichtag der Satzauflösung kommt aus dem KOPF (`rechnung.ts`:
 * `leistung_bis → leistung_von → vereinnahmung_geplant_am → heute`). Wer erst
 * Zeilen erfasst und den Leistungszeitraum danach einträgt — und so füllt man
 * ein Formular —, löst die erste Zeile gegen den einen und die zweite gegen
 * den anderen Satz auf.
 *
 * **Was der Lauf dann zeigte, war besser als erwartet.** Ändert sich der SATZ,
 * greift eine Ebene früher `berechneSteuer` (`steuer/satz.ts`) und weist schon
 * die zweite Zeile ab — nicht erst die Festschreibung, weil
 * `fuegePositionHinzu` die Summen jedes Mal neu schreibt. Der Mensch sieht den
 * Grund, während er das Formular ausfüllt.
 *
 * `mehrdeutige_steuergruppe` bleibt trotzdem nötig und ist hier zum ersten Mal
 * belegt: bei zwei datierten Zeilen mit DEMSELBEN Satz schweigt
 * `berechneSteuer`, und was auseinanderläuft, ist die Gruppen-Id, an der
 * `rechnung_steuer` hängt. Der Fall ist nicht konstruiert — eine 0-%-Gruppe
 * wird geteilt, wenn sich die Rechtsgrundlage ändert.
 *
 * **Falsifizierbar:** ohne zweite datierte Zeile geht derselbe Ablauf durch
 * und zieht eine Nummer. Sonst prüfte diese Datei nur, dass Festschreiben
 * schwierig ist.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  fuegePositionHinzu, legeEntwurfAn, finalisiere, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';

let f: Fixtur;
let benutzer: string;
let kunde: string;

/** Vor dem Schnitt und danach — beide innerhalb desselben Entwurfs. */
const VORHER = '2026-06-30';
const NACHHER = '2026-08-31';
const SCHNITT = '2026-07-01';

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function sitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

beforeEach(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('satz@cse.test') returning id`,
  );
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'satz@cse.test', 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [benutzer],
  );
  await sql.unsafe(
    `update mandant set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            ust_id = 'DE123456789'
      where id = $1`, [f.reinigung],
  );
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [f.reinigung],
  );
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1, 'K-3001', 'Bezirksamt Mitte', 'Karl-Marx-Allee', '31', '10178', 'Berlin')
     returning id`, [f.reinigung],
  );
  kunde = k!.id;
}, 120_000);

afterAll(schliessen);

/**
 * Setzt `ust_19` auf EINE offene Zeile zurück.
 *
 * `steuersatz_gruppe` ist Referenzdatum und wird von `harness.seed()` NICHT
 * geleert — der Truncate dort greift den Mandantenbaum, nicht die Sätze.
 * Ohne diesen Rücksetzer häufte `satzAendern` über die drei Prüfungen hinweg
 * Zeilen an, und der zweite Aufruf setzte `gueltig_bis` auf einer Zeile, die
 * später BEGINNT: `ssg_gueltig` schlug zu, und die Meldung sah aus wie ein
 * Schemafehler statt wie eine Fixtur, die sich selbst im Weg steht.
 *
 * `replica`, weil `steuersatz_gruppe` unter Löschsperre steht (Invariante 8)
 * — die gilt dem Betrieb, nicht dem Aufräumen einer Testfixtur.
 */
async function satzZuruecksetzen(): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    await tx.unsafe(
      `delete from steuersatz_gruppe where schluessel = 'ust_19' and gueltig_von = $1::date`,
      [SCHNITT] as never[],
    );
    await tx.unsafe(
      `update steuersatz_gruppe set gueltig_bis = null where schluessel = 'ust_19'`,
    );
  });
}

/** Schneidet `ust_19` in zwei datierte Fassungen — alt bis, `satzBp` ab. */
async function satzAendern(satzBp: number): Promise<void> {
  await satzZuruecksetzen();
  await sql.unsafe(
    `update steuersatz_gruppe set gueltig_bis = $1::date
      where schluessel = 'ust_19' and gueltig_bis is null`, [VORHER],
  );
  await sql.unsafe(
    `insert into steuersatz_gruppe
       (schluessel, bezeichnung, satz_bp, kategorie, steuer_kennzeichen, gueltig_von)
     select schluessel, bezeichnung, $3::int, kategorie, steuer_kennzeichen, $1::date
       from steuersatz_gruppe where schluessel = 'ust_19' and gueltig_bis = $2::date`,
    [SCHNITT, VORHER, satzBp],
  );
}

/**
 * Entwurf mit EINER Zeile vor dem Schnitt — in einer eigenen Transaktion,
 * damit er die Abweisung der zweiten Zeile ueberlebt.
 *
 * `alsApp` haelt eine Transaktion: wuerde die zweite Zeile im selben Vorgang
 * scheitern, waere auch der Entwurf wieder weg, und die Zusicherung „der
 * Beleg bleibt Entwurf" pruefte eine Zeile, die es nie gab.
 */
async function entwurfVorDemSchnitt(): Promise<string> {
  return alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const id = await legeEntwurfAn(d, {
      kundeId: kunde, leistungVon: '2026-06-01', leistungBis: VORHER,
      zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung Juni',
      menge: milliMenge(1000n), einheit: 'stk', einzelpreisCent: cent(10_000n),
      steuergruppe: 'ust_19', quellen: vonHand('Testfixtur — von Hand erfasst'),
    });
    return id;
  });
}

/**
 * Der Leistungszeitraum wandert ueber den Schnitt, dann kommt die zweite
 * Zeile. Genau die Reihenfolge, in der ein Mensch das Formular ausfuellt:
 * erst Zeilen, dann der Zeitraum.
 */
async function zweiteZeileNachDemSchnitt(id: string): Promise<void> {
  await alsApp(sitzung(), async (tx) => {
    await tx.unsafe(
      `update rechnung set leistung_von = '2026-08-01', leistung_bis = $2::date
        where id = $1`, [id, NACHHER] as never[],
    );
    await fuegePositionHinzu(alsDienst(tx), {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung August',
      menge: milliMenge(1000n), einheit: 'stk', einzelpreisCent: cent(10_000n),
      steuergruppe: 'ust_19', quellen: vonHand('Testfixtur — von Hand erfasst'),
    });
  });
}

describe('ein Schlüssel mit zwei datierten Fassungen auf EINEM Beleg', () => {
  /**
   * **Der Satz ändert sich — und die Abweisung kommt früher als gedacht.**
   *
   * Erwartet hatte ich `mehrdeutige_steuergruppe` aus `schreibeSummen`. Es
   * greift eine Ebene davor: `berechneSteuer` (`steuer/satz.ts`) sieht
   * denselben Schlüssel mit zwei SÄTZEN und weist ab, und zwar schon beim
   * Einfügen der zweiten Zeile, weil `fuegePositionHinzu` die Summen jedes
   * Mal neu schreibt. Das ist die bessere Stelle: der Beleg wird gar nicht
   * erst aufgebaut, und der Mensch sieht den Grund, während er das Formular
   * ausfüllt — nicht erst beim Festschreiben.
   */
  it('bei ZWEI Sätzen weist schon die zweite Zeile ab — mit beiden Sätzen im Text', async () => {
    await satzAendern(2000);
    const id = await entwurfVorDemSchnitt();

    /*
     * Beide Sätze stehen im Text, und die REIHENFOLGE ist nicht die Aussage:
     * welcher zuerst genannt wird, hängt daran, welche Zeile `berechneSteuer`
     * zuerst sieht. Wer sie festschreibt, prüft die Einfügereihenfolge der
     * Fixtur statt der Meldung.
     */
    const fehler = await zweiteZeileNachDemSchnitt(id).then(
      () => null, (f: unknown) => f as Error,
    );
    expect(fehler, 'die zweite Zeile wurde angenommen — sie darf es nicht').not.toBeNull();
    expect(fehler?.message).toMatch(/ust_19 tritt mit zwei Sätzen auf/u);
    expect(fehler?.message).toContain('1900');
    expect(fehler?.message).toContain('2000');
  });

  /**
   * **Und der Fall, für den `mehrdeutige_steuergruppe` überhaupt geschrieben
   * wurde:** zwei datierte Zeilen mit DEMSELBEN Satz. `berechneSteuer`
   * vergleicht die Sätze und schweigt; was auseinanderläuft, ist die
   * Gruppen-Id, an der `rechnung_steuer` hängt. Ohne diese Prüfung schriebe
   * die Aufschlüsselung nach §14 Abs. 4 Nr. 8 UStG beide Nettobeträge unter
   * EINE datierte Gruppe.
   *
   * Der Fall ist nicht konstruiert: eine 0-%-Gruppe wird geteilt, wenn sich
   * die Rechtsgrundlage ändert — derselbe Satz, neuer Befreiungsgrund.
   */
  it('bei zwei Zeilen mit DEMSELBEN Satz greift `mehrdeutige_steuergruppe`', async () => {
    await satzAendern(1900);
    const id = await entwurfVorDemSchnitt();

    await expect(zweiteZeileNachDemSchnitt(id)).rejects.toMatchObject({
      name: 'RechnungFehler', grund: 'mehrdeutige_steuergruppe',
    });
  });

  it('und der Beleg bleibt danach Entwurf — mit einer Zeile und ohne Nummer', async () => {
    await satzAendern(2000);
    const id = await entwurfVorDemSchnitt();
    await zweiteZeileNachDemSchnitt(id).catch(() => undefined);

    const [z] = await sql.unsafe<{ status: string; nummer: string | null; zeilen: string }[]>(
      `select r.status::text, r.nummer,
              (select count(*)::text from rechnungsposition p
                where p.rechnung_id = r.id and p.positionsart = 'leistung') as zeilen
         from rechnung r where r.id = $1::uuid`, [id],
    );
    expect(z?.status).toBe('entwurf');
    // Invariante 4: ein Entwurf hat keine Nummer, und ein gescheiterter
    // Versuch darf den Zähler nicht weitergerückt haben.
    expect(z?.nummer).toBeNull();
    // Die abgewiesene Zeile ist zurückgerollt, die erste steht noch: der
    // Entwurf ist weiter bearbeitbar und nicht halb zerstört.
    expect(z?.zeilen).toBe('1');
  });

  it('Gegenprobe: OHNE zweite datierte Fassung geht derselbe Ablauf durch', async () => {
    // Ausdrücklich, nicht aus der Reihenfolge geerbt.
    await satzZuruecksetzen();
    const id = await entwurfVorDemSchnitt();
    await zweiteZeileNachDemSchnitt(id);

    const ergebnis = await alsApp(sitzung(), (tx) => finalisiere(alsDienst(tx), id));
    expect(ergebnis.nummer).toMatch(/^RE-\d{5}$/u);
  });
});
