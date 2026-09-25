import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { legeAngebotVonHandAn, type HandPosition }
  from '../../src/server/services/angebot/von-hand.js';
import {
  EntwurfFehler, berichtigePosition, entfernePosition, ziehEntwurfZurueck,
} from '../../src/server/services/angebot/entwurf.js';
import {
  lebendeLeistungenZahl, positionenFuerDokument, steuerJeSatzVorVersand,
} from '../../src/server/services/angebot/lebend.js';
import {
  listeKundenangebote, positionenZumAngebot,
} from '../../src/server/services/kundenportal/angebot.js';

/**
 * **Ein Angebotsentwurf lässt sich berichtigen und zurückziehen** — gegen
 * echtes Postgres (V-130, D-626, OPS-08, Invariante 8).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `angebotsposition` trägt `revoke delete` (0024:529) und hatte keine
 * Archivspalte; das einzige `update` im ganzen Projekt setzte den Einzelpreis
 * nach einer bestätigten Kalkulation. Der Kopf stand genauso da:
 * `archiviert_am` schrieb niemand, und `zurueckgezogen` stand seit 0024 im
 * Aufzählungstyp, ohne dass ein Dienst ihn je setzte.
 *
 * **Ein Tippfehler in einem Entwurf stand dauerhaft in der Angebotsliste.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das gegen die DATENBANK geprüft wird und nicht in TypeScript.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Jede der sechs Zusicherungen hängt an einer Zeile SQL, und jede kann still
 * brechen:
 *
 *  §1 Die Summe folgt der Berichtigung — der Auslöser rechnet, nicht die
 *     Anwendung.
 *  §2 Eine entfernte Position bleibt in der Tabelle stehen und fällt aus der
 *     Summe. Beides, nicht eines von beiden.
 *  §3 Die letzte Leistungsposition bleibt — ein Angebot ohne Leistung ist
 *     keines.
 *  §4 Der Rückzug ist eine Entscheidung, kein Zwischenstand: danach geht
 *     nichts mehr hinaus, und wiederbelebt wird er nicht.
 *  §5 Ein VERSENDETES Angebot bleibt unveränderlich — die Trennlinie hält.
 *  §6 Die Steuerzeilen beim Versand zählen keine entfernte Position mit.
 *  §7 Und kein LESER zeigt sie noch (V-203): nicht das Dokument, nicht die
 *     Preisfreigabe, nicht das Kundenportal — auch nicht an ihm vorbei.
 *
 * §6 ist die teuerste: sie wiese dem Kunden Umsatzsteuer auf eine Leistung
 * aus, die im Angebot gar nicht steht — und sie friert diese Zahl in
 * `angebot_steuer` ein, wo sie niemand mehr nachrechnet.
 */

let f: Fixtur;
let leitung = '';
let kundeId = '';
let tagHeute = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function imKontext<T>(fn: (k: LeseKontext & SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant' as const, mandantId: f.security, benutzerId: leitung,
      portal: 'intern' as const, readonly: false },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: leitung,
        aktiverMandantId: f.security, mandantIds: [f.security],
        abfrage: fuehre, schreibe: fuehre,
      } satisfies LeseKontext & SchreibKontext);
    },
  ) as Promise<T>;
}

function zeile(teil: Partial<HandPosition> = {}): HandPosition {
  return {
    kurztext: 'Doppelstreife 22:00–06:00',
    menge: '20',
    einheit: 'h',
    einzelpreisEuro: '38,50',
    steuersatzSchluessel: 'ust_19',
    ...teil,
  };
}

/** Ein frischer Entwurf mit den übergebenen Zeilen. */
async function entwurf(...zeilen: readonly HandPosition[]): Promise<string> {
  const ergebnis = await imKontext((k) => legeAngebotVonHandAn(k, {
    kundeId, titel: `Entwurf ${zufall()}`, stichtag: tagHeute,
    positionen: zeilen.length === 0 ? [zeile()] : zeilen,
  }));
  return ergebnis.angebotId;
}

interface Pos {
  id: string; kurztext: string; menge: string | null;
  einzelpreis_cent: string | null; gesamtpreis_cent: string;
  entfernt_am: string | null; typ: string;
}

async function posten(angebotId: string): Promise<readonly Pos[]> {
  return sql.unsafe<Pos[]>(
    `select id, kurztext, menge::text as menge,
            einzelpreis_cent::text as einzelpreis_cent,
            gesamtpreis_cent::text as gesamtpreis_cent,
            entfernt_am::text as entfernt_am, typ::text as typ
       from angebotsposition where angebot_id = $1 order by position_nr`, [angebotId]);
}

async function netto(angebotId: string): Promise<bigint> {
  const [a] = await sql.unsafe<{ netto_cent: string }[]>(
    `select netto_cent::text from angebot where id = $1`, [angebotId]);
  return BigInt(a!.netto_cent);
}

/**
 * Versendet ein Angebot auf dem kurzen Weg — aber IN der gebundenen Sitzung.
 *
 * Als Eigentümer ginge es nicht: `kern.angebot_freigabe_pruefen` liest
 * `app.hat_recht('angebot.preis_freigeben', …)`, und ohne gebundene Sitzung
 * antwortet das `false`. Der Dienstweg (`versendeAngebot`) hat sein eigenes
 * Prüfstück; hier interessiert nur der ZUSTAND danach.
 */
async function versende(angebotId: string): Promise<void> {
  await imKontext((k) => k.schreibe(
    `update angebot set freigegeben_am = now(), freigegeben_von = $2,
                        versendet_von = $2, angebotsnummer = $3, versendet_am = now(),
                        status = 'versendet'
      where id = $1::uuid`, [angebotId, leitung, `AN-${zufall()}`]));
}

beforeAll(async () => {
  f = await seed();
  const email = `entwurf-${zufall()}@test.invalid`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  leitung = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [leitung]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [leitung, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,(select id from rolle where schluessel = 'leitung' and mandant_id is null),
             true)`, [leitung, f.security]);
  for (const r of ['angebot.lesen', 'angebot.schreiben', 'angebot.versenden',
                   'angebot.preis_freigeben', 'system.benutzer_verwalten']) {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = $1), $2, true)
       on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
      [r, f.security]);
  }
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Bezirksamt Mitte','Karl-Marx-Allee','31','10178','Berlin')
     returning id`, [f.security, `K-${zufall()}`]);
  kundeId = k!.id;
  const [z] = await imKontext((c) => c.abfrage<{ tag: string }>(
    `select app.berlin_heute()::text as tag`));
  tagHeute = z!.tag;
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('§1 eine Position eines Entwurfs lässt sich berichtigen', () => {
  it('Text, Menge und Preis ändern sich — und die Summe folgt', async () => {
    const id = await entwurf();
    const [p] = await posten(id);
    expect(await netto(id)).toBe(77_000n); // 20 × 38,50 €

    await imKontext((k) => berichtigePosition(k, {
      positionId: p!.id,
      kurztext: 'Doppelstreife 22:00–06:00 (korrigiert)',
      langtext: 'Zwei Kräfte, Rundgang stündlich.',
      menge: '24',
      einheit: 'h',
      einzelpreisEuro: '40,00',
    }));

    const [nachher] = await posten(id);
    expect(nachher!.kurztext).toBe('Doppelstreife 22:00–06:00 (korrigiert)');
    expect(nachher!.menge).toBe('24.000');
    expect(nachher!.einzelpreis_cent).toBe('4000');
    /*
     * Die Zeilensumme rechnet die DATENBANK (`generated always as`), die
     * Angebotssumme der Auslöser. Zwei Rechenwege für dieselbe Zahl gibt es
     * nicht — und genau deshalb steht hier die Zahl und nicht „hat sich
     * geändert".
     */
    expect(nachher!.gesamtpreis_cent).toBe('96000');
    expect(await netto(id)).toBe(96_000n);
  });

  it('leere Felder heissen „unverändert", nicht „auf null"', async () => {
    /*
     * Auf null zu setzen bräche `ap_leistung_vollstaendig` — eine
     * Leistungsposition ohne Menge, Einheit und Preis ist keine. Ein leeres
     * Formularfeld darf das nicht auslösen.
     */
    const id = await entwurf();
    const [p] = await posten(id);
    await imKontext((k) => berichtigePosition(k, {
      positionId: p!.id, kurztext: 'Nur der Text ändert sich',
      menge: '', einheit: '', einzelpreisEuro: '',
    }));
    const [nachher] = await posten(id);
    expect(nachher!.kurztext).toBe('Nur der Text ändert sich');
    expect(nachher!.menge).toBe('20.000');
    expect(nachher!.einzelpreis_cent).toBe('3850');
  });

  it('ohne Kurztext wird abgewiesen — eine Zeile ohne Leistung ist keine', async () => {
    const id = await entwurf();
    const [p] = await posten(id);
    await expect(imKontext((k) => berichtigePosition(k, {
      positionId: p!.id, kurztext: '   ',
    }))).rejects.toThrow(EntwurfFehler);
  });

  it('eine unbekannte Position ist nicht unterscheidbar von einer fremden', async () => {
    /* AUT-06: „gibt es nicht" und „darfst du nicht" antworten gleich. */
    await expect(imKontext((k) => berichtigePosition(k, {
      positionId: '00000000-0000-0000-0000-000000000001', kurztext: 'X',
    }))).rejects.toThrow(/gibt es nicht/u);
  });
});

describe('§2 eine Position lässt sich entfernen, ohne gelöscht zu werden', () => {
  it('die Zeile bleibt stehen, trägt Zeitpunkt und Urheber — und fällt aus der Summe',
    async () => {
      const id = await entwurf(zeile(), zeile({ kurztext: 'Tagdienst', menge: '10' }));
      expect(await netto(id)).toBe(77_000n + 38_500n);

      const alle = await posten(id);
      const weg = alle.find((p) => p.kurztext === 'Tagdienst')!;
      await imKontext((k) => entfernePosition(k, weg.id, leitung));

      const nachher = await posten(id);
      /* Invariante 8: nichts wird gelöscht. Die Zeile ist noch da. */
      expect(nachher).toHaveLength(2);
      const jetzt = nachher.find((p) => p.id === weg.id)!;
      expect(jetzt.entfernt_am).not.toBeNull();
      const [urheber] = await sql.unsafe<{ entfernt_von: string | null }[]>(
        `select entfernt_von from angebotsposition where id = $1`, [weg.id]);
      expect(urheber!.entfernt_von).toBe(leitung);
      /* Und die Summe zählt sie nicht mehr. */
      expect(await netto(id)).toBe(77_000n);
    });

  it('eine bereits entfernte Position lässt sich nicht noch einmal berichtigen', async () => {
    const id = await entwurf(zeile(), zeile({ kurztext: 'Zweite' }));
    const weg = (await posten(id)).find((p) => p.kurztext === 'Zweite')!;
    await imKontext((k) => entfernePosition(k, weg.id, leitung));
    await expect(imKontext((k) => berichtigePosition(k, {
      positionId: weg.id, kurztext: 'Doch wieder da',
    }))).rejects.toThrow(EntwurfFehler);
  });
});

describe('§3 die letzte Leistungsposition bleibt', () => {
  it('sie lässt sich nicht entfernen — ein Angebot ohne Leistung ist keines', async () => {
    const id = await entwurf();
    const [p] = await posten(id);
    const fehler = await imKontext((k) => entfernePosition(k, p!.id, leitung))
      .then(() => null, (x: unknown) => x);
    expect(fehler).toBeInstanceOf(EntwurfFehler);
    expect((fehler as EntwurfFehler).grund).toBe('letzte_position');
    expect((await posten(id))[0]!.entfernt_am).toBeNull();
  });
});

describe('§4 der Rückzug ist eine Entscheidung, kein Zwischenstand', () => {
  it('der Entwurf verlässt die Arbeitsliste und bleibt in der Datenbank', async () => {
    const id = await entwurf();
    await imKontext((k) => ziehEntwurfZurueck(k, id, leitung));
    const [a] = await sql.unsafe<{
      status: string; archiviert_am: string | null; geaendert_von: string | null;
    }[]>(
      `select status::text as status, archiviert_am::text as archiviert_am, geaendert_von
         from angebot where id = $1`, [id]);
    expect(a!.status).toBe('zurueckgezogen');
    expect(a!.archiviert_am).not.toBeNull();
    expect(a!.geaendert_von).toBe(leitung);
  });

  it('zweimal zurückziehen ist ein Fehler, keine stille Wiederholung', async () => {
    const id = await entwurf();
    await imKontext((k) => ziehEntwurfZurueck(k, id, leitung));
    const fehler = await imKontext((k) => ziehEntwurfZurueck(k, id, leitung))
      .then(() => null, (x: unknown) => x);
    expect((fehler as EntwurfFehler).grund).toBe('schon_zurueckgezogen');
  });

  it('er wird nicht wiederbelebt — auch nicht am Dienst vorbei', async () => {
    /*
     * Die Datenbank hält das, nicht der Dienst: `angebot_05_rueckzug`. Ein
     * Rückzug, den man wegklicken kann, ist ein Vermerk und keine
     * Entscheidung.
     */
    const id = await entwurf();
    await imKontext((k) => ziehEntwurfZurueck(k, id, leitung));
    await expect(sql.unsafe(
      `update angebot set status = 'entwurf' where id = $1`, [id]))
      .rejects.toThrow(/nicht wiederbelebt/u);
  });

  it('und er geht nicht mehr hinaus', async () => {
    /*
     * **Die Freigabe steht hier, und das ist kein Beiwerk.** Ohne sie fängt
     * `kern.angebot_versand_pruefen` schon eine Zeile früher ab — mit
     * „Ohne Preisfreigabe kein Versand" (Invariante 7, 0295). Dann prüfte
     * diese Zeile den falschen Riegel und wäre auch dann grün, wenn der
     * Rückzug gar nicht hielte.
     */
    const id = await entwurf();
    await imKontext((k) => ziehEntwurfZurueck(k, id, leitung));
    /* IN der Sitzung: `angebot_05_preisfreigabe` liest `app.hat_recht`. */
    await imKontext((k) => k.schreibe(
      `update angebot set freigegeben_am = now(), freigegeben_von = $2
        where id = $1::uuid`, [id, leitung]));
    await expect(imKontext((k) => k.schreibe(
      `update angebot set versendet_am = now(), angebotsnummer = $2
        where id = $1::uuid`, [id, `AN-${zufall()}`])))
      .rejects.toThrow(/zurueckgezogenes Angebot geht nicht hinaus/u);
  });
});

describe('§5 ein versendetes Angebot bleibt unveränderlich', () => {
  async function versendet(): Promise<{ id: string; position: string }> {
    const id = await entwurf(zeile(), zeile({ kurztext: 'Tagdienst', menge: '10' }));
    const [p] = await posten(id);
    await versende(id);
    return { id, position: p!.id };
  }

  it('die Berichtigung wird abgewiesen, und zwar mit einem Satz', async () => {
    const { position } = await versendet();
    const fehler = await imKontext((k) => berichtigePosition(k, {
      positionId: position, kurztext: 'Nachträglich',
    })).then(() => null, (x: unknown) => x);
    expect((fehler as EntwurfFehler).grund).toBe('schon_versendet');
  });

  it('das Entfernen ebenso', async () => {
    const { position } = await versendet();
    const fehler = await imKontext((k) => entfernePosition(k, position, leitung))
      .then(() => null, (x: unknown) => x);
    expect((fehler as EntwurfFehler).grund).toBe('schon_versendet');
  });

  it('und der stille Rückzug auch — das wäre eine Erklärung gegenüber dem Kunden',
    async () => {
      const { id } = await versendet();
      const fehler = await imKontext((k) => ziehEntwurfZurueck(k, id, leitung))
        .then(() => null, (x: unknown) => x);
      expect((fehler as EntwurfFehler).grund).toBe('schon_versendet');
    });

  it('auch am Dienst vorbei hält die Datenbank es fest', async () => {
    const { position } = await versendet();
    await expect(sql.unsafe(
      `update angebotsposition set kurztext = 'X' where id = $1`, [position]))
      .rejects.toThrow(/versendeten Angebots sind unveraenderlich/u);
  });
});

describe('§6 die Steuerzeilen beim Versand zählen keine entfernte Position', () => {
  it('eine entfernte Zeile steht weder in `angebot_steuer` noch in `netto_cent`',
    async () => {
      const id = await entwurf(
        zeile(),
        zeile({ kurztext: 'Irrtum — gehört nicht hierher', menge: '100' }));
      const weg = (await posten(id)).find((p) => p.kurztext.startsWith('Irrtum'))!;
      await imKontext((k) => entfernePosition(k, weg.id, leitung));

      await versende(id);

      const steuer = await sql.unsafe<{ netto_cent: string; steuer_cent: string }[]>(
        `select netto_cent::text, steuer_cent::text from angebot_steuer
          where angebot_id = $1`, [id]);
      expect(steuer).toHaveLength(1);
      /*
       * 20 × 38,50 € = 770,00 € — NICHT 770,00 + 3.850,00. Wäre die entfernte
       * Zeile mitgezählt, wiese das Angebot dem Kunden Umsatzsteuer auf eine
       * Leistung aus, die darin gar nicht steht — eingefroren, wo sie niemand
       * mehr nachrechnet.
       */
      expect(BigInt(steuer[0]!.netto_cent)).toBe(77_000n);
      expect(BigInt(steuer[0]!.steuer_cent)).toBe(14_630n);
      expect(await netto(id)).toBe(77_000n);
    });

  it('ein Angebot, dessen Leistungspositionen alle entfernt sind, geht nicht hinaus',
    async () => {
      /*
       * Erreichbar nur an `entfernePosition` vorbei — der Dienst lässt die
       * letzte stehen. Die Datenbank hält es trotzdem, weil ein Blatt mit
       * Briefkopf, Nummer und Bindefrist ohne Leistung ein Vertragsangebot
       * über nichts wäre.
       */
      const id = await entwurf();
      const [p] = await posten(id);
      await sql.unsafe(
        `update angebotsposition set entfernt_am = now(), entfernt_von = $2 where id = $1`,
        [p!.id, leitung]);
      /* Freigabe zuerst — sonst antwortet Invariante 7 (siehe §4). */
      await imKontext((k) => k.schreibe(
        `update angebot set freigegeben_am = now(), freigegeben_von = $2
          where id = $1::uuid`, [id, leitung]));
      await expect(imKontext((k) => k.schreibe(
        `update angebot set versendet_am = now(), angebotsnummer = $2
          where id = $1::uuid`, [id, `AN-${zufall()}`])))
        .rejects.toThrow(/ohne Leistungsposition geht nicht hinaus/u);
    });
});

describe('§7 kein Leser zeigt eine entfernte Position (V-203)', () => {
  /**
   * Der Befund: das Dokument druckte die entfernte Zeile mit Preis, das
   * Kundenportal zeigte sie dem Kunden und zählte sie mit, und die
   * Preisfreigabe summierte sie ins Netto je Steuersatz — direkt neben einem
   * Kopfbetrag ohne sie. Hier steht jede Zahl gegen `netto_cent` und
   * `angebot_steuer`, die beiden Summen der Datenbank.
   */
  async function dreiZeilenEineWeg(): Promise<{ id: string; weg: string }> {
    const id = await entwurf(
      zeile({ kurztext: 'Objektschutz Tag', menge: '10' }),
      zeile({ kurztext: 'Irrtum — gehört nicht hierher', menge: '100' }),
      zeile({ kurztext: 'Revierfahrt', menge: '4', steuersatzSchluessel: 'ust_07' }));
    const weg = (await posten(id)).find((p) => p.kurztext.startsWith('Irrtum'))!;
    await imKontext((k) => entfernePosition(k, weg.id, leitung));
    return { id, weg: weg.id };
  }

  const summe = (werte: readonly string[]): bigint =>
    werte.reduce((a, w) => a + BigInt(w), 0n);

  it('die Preisfreigabe zeigt das Netto, das beim Versand eingefroren wird', async () => {
    const { id } = await dreiZeilenEineWeg();
    const vorschau = await imKontext((k) => steuerJeSatzVorVersand(k, id));
    expect(summe(vorschau.map((z) => z.netto_cent))).toBe(await netto(id));
    expect(vorschau.map((z) => Number(z.zeilen))).toEqual([1, 1]);

    const [kopf] = await imKontext((k) => k.abfrage<{ positionen: string }>(
      `select ${lebendeLeistungenZahl('a')}::text as positionen
         from angebot a where a.id = $1::uuid`, [id]));
    expect(kopf!.positionen).toBe('2');

    await versende(id);
    const eingefroren = await sql.unsafe<{ steuersatz_bp: number; netto_cent: string }[]>(
      `select steuersatz_bp, netto_cent::text from angebot_steuer
        where angebot_id = $1 order by steuersatz_bp`, [id]);
    expect(eingefroren.map((z) => [z.steuersatz_bp, z.netto_cent]))
      .toEqual(vorschau.map((z) => [z.steuersatz_bp, z.netto_cent]));
  });

  it('das Dokument druckt zwei Zeilen, und sie ergeben das Netto', async () => {
    const { id, weg } = await dreiZeilenEineWeg();
    await versende(id);
    const zeilen = await imKontext((k) => positionenFuerDokument(k, id));
    expect(zeilen.map((z) => z.id)).not.toContain(weg);
    expect(zeilen).toHaveLength(2);
    expect(summe(zeilen.map((z) => z.gesamtpreis_cent))).toBe(await netto(id));
  });

  it('das Kundenportal zeigt und zählt sie nicht — und die Policy gibt sie nicht her',
    async () => {
      const { id, weg } = await dreiZeilenEineWeg();
      await versende(id);
      const [z] = await alsApp(
        { scope: 'mandant' as const, mandantId: f.security, benutzerId: leitung,
          portal: 'intern' as const, readonly: false },
        async (tx) => tx.unsafe<{ ok: boolean; konto_id: string | null }[]>(
          `select ok, konto_id from app.kundenzugang_ausstellen($1::uuid, $2, $3, $4)`,
          [kundeId, `portal-${zufall()}@hv.test`, 'Bernd Beispiel',
            'a'.repeat(64)]));
      expect(z!.ok).toBe(true);
      const kundensitzung = {
        scope: 'kunde' as const, mandantIds: [f.security], benutzerId: z!.konto_id!,
        portal: 'kunde' as const, readonly: true,
      };
      const ergebnis = await alsApp(kundensitzung, async (tx) => {
        const k = {
          abfrage: async <T,>(s: string, w: readonly unknown[] = []) =>
            (await tx.unsafe(s, w as never[])) as readonly T[],
        };
        const roh = await tx.unsafe<{ id: string }[]>(
          `select id from angebotsposition where angebot_id = $1`, [id]);
        return {
          liste: await listeKundenangebote(k),
          positionen: await positionenZumAngebot(k, id),
          roh,
        };
      });
      expect(ergebnis.positionen.map((p) => p.id)).not.toContain(weg);
      expect(ergebnis.positionen).toHaveLength(2);
      expect(ergebnis.liste.find((a) => a.id === id)?.positionen).toBe(2);
      /* Die zweite Linie (0440): auch ohne den Dienst keine entfernte Zeile. */
      expect(ergebnis.roh.map((r) => r.id)).not.toContain(weg);
      expect(ergebnis.roh).toHaveLength(2);
    });
});
