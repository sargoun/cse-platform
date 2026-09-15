import 'server-only';
import type { SchreibKontext } from '../kontext/index.js';
import { kanonisiere } from '../services/finanz/kanonisch.js';
import { risikoPunkte, stufeRisikoEin, type VorgangTyp }
  from '../services/freigabe/posteingang.js';
import { fordereModell } from './modell/auswahl.js';
import { ModellFehler, type ModellPort } from './modell/port.js';
import { beginneSchritt, protokolliereSchritt, starteAufgabe } from './laufzeit.js';
import { BudgetErschoepft, bucheKosten, gibReservierungFrei, reserviere, vermerkeStopp }
  from './budget.js';
import { kostenMikrocent, type Preis } from './kosten.js';
import { NUTZLAST_FRIST_TAGE_PLATZHALTER } from './limits.platzhalter.js';
import { pruefeZahlenherkunft } from './zahlenherkunft.js';

/**
 * Der Orchestrator — **der Weg vom Auftrag zum Vorschlag** (AGT-01, §4).
 *
 * Er ist absichtlich kurz und absichtlich langweilig, denn er ist die Stelle,
 * an der ein Modell auf echte Daten trifft. Drei Regeln, und sie sind die
 * ganze Datei:
 *
 *  1. **Die Werkzeuge rechnen, das Modell formuliert** (Invariante 6). Jede
 *     Zahl, die im Entwurf steht, kommt aus einer geprüften Funktion in
 *     `server/services/` und wandert als fertige Zeichenkette in die
 *     Tatsachen. Der Port bekommt nichts zu rechnen, also kann er sich nicht
 *     verrechnen.
 *  2. **Am Ende steht ein ENTWURF, nie eine Handlung** (Invariante 7). Der
 *     Lauf endet in einer `freigabe` mit Status `offen`. Was danach geschieht,
 *     entscheidet ein Mensch im Posteingang — auch dann, wenn eine Richtlinie
 *     das Gegenteil erlaubte: `server/agent/policy.ts` ist das Tor, und der
 *     Orchestrator geht nicht daran vorbei.
 *  3. **Jeder Schritt steht im Protokoll**, mit Modell, Tokens, Kosten und
 *     Dauer (AGT-05) — auch der, der abgewiesen wurde. Und er steht dort mit
 *     seinem GEMESSENEN Preis: ein Lauf, der Null meldet, macht das
 *     Monatsbudget zur Zierde.
 *  4. **Reserviert wird VOR dem Aufruf** (AGT-05). Ein Hartstopp, der erst
 *     nach der Abrechnung greift, ist keiner; ein Anbieter kann eine
 *     Monatsgrenze sonst in einer Nacht überschreiten.
 *  5. **Das Risiko rechnet der Code, nicht diese Datei.**
 *     `stufeRisikoEin` (§14.4) urteilt aus Tatsachen. Hier stand vorher
 *     `'niedrig'`, fest — und damit wäre ein nach aussen gerichteter Entwurf
 *     an der deterministischen Untergrenze vorbeigelaufen.
 *
 * **Kein Modell ist kein Absturz.** Ist für `entwurf_text` nichts freigegeben,
 * endet der Lauf mit `RESIDENCY_BLOCKED`, die Aufgabe steht auf `fehlgeschlagen`,
 * und der Bildschirm sagt „KI-Funktion nicht verfügbar" (§8). Die Arbeit läuft
 * von Hand weiter.
 */

export type AgentKennung = 'ceo_assistent' | 'akquise' | 'backoffice' | 'finanzen';

export interface LaufAuftrag {
  readonly agent: AgentKennung;
  readonly vorgangTyp: VorgangTyp;
  /**
   * **Die Handlung, über die entschieden wird** — je Auftrag, nicht fest.
   *
   * Vorher stand hier für jeden Lauf `interner_hinweis`, auch für einen
   * Antwortentwurf an eine anfragende Stelle. `aktion` und `vorgang_typ` sind
   * zwei Felder, weil der Posteingang und die Ausführung sie getrennt lesen:
   * die Aktion sagt, WAS geschähe, wenn jemand genehmigt. Sie dem Vorgang
   * still gleichzusetzen heisst, die Frage zu verlieren, die ein Mensch
   * beantworten soll.
   */
  readonly aktion: string;
  readonly titel: string;
  /** Die Vorlage, nach der formuliert wird — nie vom Modell gewählt. */
  readonly vorlage: string;
  /**
   * Die gerechneten Tatsachen. Sie sind schon Zeichenketten: formatiert von
   * dem Dienst, der sie gerechnet hat, damit der Orchestrator nichts
   * umrechnet und das Modell erst recht nicht.
   */
  readonly tatsachen: Readonly<Record<string, string>>;
  /** Woran der Vorschlag hängt — Objekt, Projekt, Ausschreibung, Beleg. */
  readonly bezugTyp?: string;
  readonly bezugId?: string;
  /** Verhindert den zweiten Lauf zur selben Lage (ein Ereignis kommt zweimal). */
  readonly idempotenzSchluessel?: string;
  readonly angefordertVon?: string;
  readonly codeVersion: string;
}

export interface LaufErgebnis {
  readonly aufgabeId: string;
  readonly freigabeId: string | null;
  readonly entwurf: string;
  readonly modell: string;
  readonly schritte: number;
  /** `true`, wenn die Aufgabe schon lief und nichts Neues entstand. */
  readonly bestand: boolean;
  /**
   * **Warum der Lauf nichts vorgelegt hat — als ERGEBNIS, nicht als Ausnahme.**
   *
   * §8 nennt „kein Modell freigegeben" einen Betriebszustand, keinen Fehler,
   * und das hat eine Folge, die man leicht übersieht: eine Ausnahme risse die
   * Transaktion des Aufrufers mit, und mit ihr die gerade angelegte
   * Aufgabenzeile. Der Lauf wäre gescheitert UND unsichtbar — im
   * Agentenzentrum stünde nichts, und niemand wüsste, dass er es versucht hat.
   *
   * Also: die Aufgabe bleibt stehen, sie trägt `fehlgeschlagen` und den Satz,
   * und der Aufrufer entscheidet, was er damit anzeigt.
   */
  readonly gestoert: { readonly code: string; readonly nachricht: string } | null;
}

/**
 * Ein Lauf.
 *
 * **Warum der Entwurf und die Freigabe in EINER Transaktion entstehen:** ein
 * Entwurf ohne Freigabezeile wäre Text, den niemand sieht, und eine
 * Freigabezeile ohne Entwurf ein leerer Posteingangseintrag. Beides ist
 * schlimmer als ein Lauf, der ganz scheitert.
 */
export async function fuehreLaufAus(
  kontext: SchreibKontext, auftrag: LaufAuftrag,
): Promise<LaufErgebnis> {
  const db = { abfrage: kontext.abfrage.bind(kontext) };

  const aufgabe = await starteAufgabe(db, kontext.aktiverMandantId, {
    agentKennung: auftrag.agent,
    vorgangTyp: auftrag.vorgangTyp,
    titel: auftrag.titel,
    eingabe: { vorlage: auftrag.vorlage, tatsachen: auftrag.tatsachen },
    ...(auftrag.bezugTyp === undefined ? {} : { bezugTyp: auftrag.bezugTyp }),
    ...(auftrag.bezugId === undefined ? {} : { bezugId: auftrag.bezugId }),
    ...(auftrag.idempotenzSchluessel === undefined
      ? {} : { idempotenzSchluessel: auftrag.idempotenzSchluessel }),
    ...(auftrag.angefordertVon === undefined
      ? {} : { angefordertVon: auftrag.angefordertVon }),
    ausgeloestDurch: auftrag.angefordertVon === undefined ? 'zeitplan' : 'mensch',
    codeVersion: auftrag.codeVersion,
  });

  /* Eine Aufgabe, die es schon gab, läuft nicht ein zweites Mal. */
  if (aufgabe.bestand) {
    return {
      aufgabeId: aufgabe.id, freigabeId: null, entwurf: '', modell: '',
      schritte: 0, bestand: true, gestoert: null,
    };
  }

  let port: ModellPort;
  try {
    port = await fordereModell(kontext, 'entwurf_text');
  } catch (fehler) {
    if (!(fehler instanceof ModellFehler)) throw fehler;
    return await scheitern(kontext, aufgabe.id, fehler.code, fehler.message);
  }

  /*
   * — Der Preis, bevor der Aufruf stattfindet. —
   *
   * **Ohne Preisliste läuft nichts.** Ein Modell ohne Zeile in
   * `agent_preisliste` liesse sich aufrufen und mit Null verbuchen, und das
   * Monatsbudget wäre eine Zierde: die Rechnung des Anbieters wüchse, und
   * `agent_kosten` bliebe bei 0,00 €. Ein fehlender Preis ist deshalb ein
   * Betriebszustand wie ein fehlendes Modell — abgelehnt, sichtbar, mit dem
   * Satz, der auf den Bildschirm gehört.
   */
  const preis = await preisFuer(db, entwurfModell(port));
  if (preis === null) {
    return await scheitern(kontext, aufgabe.id, 'PREIS_FEHLT',
      `Für „${entwurfModell(port)}" steht kein Preis in agent_preisliste. Ein Lauf, `
      + 'dessen Kosten niemand kennt, wird nicht gestartet (AGT-05).');
  }

  /*
   * — Reservieren, bevor es teuer wird (AGT-05). —
   *
   * Der geschätzte Betrag ist bewusst grosszügig: reserviert wird die
   * Obergrenze, verbucht wird das Gemessene, und die Differenz gibt die
   * Buchung frei. Andersherum — knapp schätzen und nachreservieren — hiesse,
   * dass zwei gleichzeitige Läufe die Grenze gemeinsam überschreiten.
   */
  const schaetzung = kostenMikrocent(
    { eingabe: BigInt(SCHAETZUNG_TOKEN), ausgabe: BigInt(SCHAETZUNG_TOKEN), gedanken: 0n },
    preis);

  let reservierungId: string;
  let budgetId: string;
  try {
    const r = await reserviere(
      db, kontext.aktiverMandantId, aufgabe.agentId, aufgabe.id, schaetzung);
    reservierungId = r.reservierungId;
    budgetId = r.budgetId;
  } catch (fehler) {
    if (!(fehler instanceof BudgetErschoepft)) throw fehler;
    /*
     * **Der Stoppvermerk wird HIER geschrieben und nicht in einer zweiten
     * Transaktion.** `reserviereMitHartstopp` braucht eine eigene, weil es
     * WIRFT und der Wurf alles mitrisse. Diese Stelle wirft nicht: sie fängt,
     * schreibt und gibt ein Ergebnis zurück — die Transaktion committet,
     * und mit ihr Aufgabe, Status und Vermerk (D-428, sinngemäss).
     */
    if (fehler.verdikt === 'gestoppt' && fehler.budgetId !== null) {
      await vermerkeStopp(db, kontext.aktiverMandantId, fehler.budgetId);
    }
    return await scheitern(kontext, aufgabe.id, 'BUDGET', fehler.message);
  }

  /* — Schritt 1: formulieren. Die Tatsachen sind schon gerechnet. — */
  const begonnen = await beginneSchritt(db);
  let entwurf;
  try {
    entwurf = await port.entwerfe({ vorlage: auftrag.vorlage, tatsachen: auftrag.tatsachen });
  } catch (fehler) {
    /*
     * **Ein Anbieterfehler ist ein sichtbarer Lauf, kein verschwundener.**
     *
     * Vorher fing nur die Modellwahl. Eine Zeitüberschreitung oder ein
     * gedrosselter Anbieter kam als Ausnahme heraus, riss die Transaktion des
     * Aufrufers mit und nahm die gerade angelegte Aufgabenzeile mit — im
     * Agentenzentrum stand nichts, und niemand konnte sehen, dass es einen
     * Versuch gab. Jetzt wird der Schritt als `fehler` protokolliert, die
     * Reservierung freigegeben und die Aufgabe als fehlgeschlagen abgelegt.
     */
    if (!(fehler instanceof ModellFehler)) throw fehler;
    await protokolliereSchritt(db, kontext.aktiverMandantId, aufgabe, {
      werkzeug: null,
      modell: entwurfModell(port),
      eingabe: { vorlage: auftrag.vorlage, tatsachen: auftrag.tatsachen },
      ausgabe: { fehler: fehler.code, nachricht: fehler.message },
      dauerMs: 0,
      begonnenAm: begonnen,
      status: 'fehler',
    });
    await gibReservierungFrei(db, kontext.aktiverMandantId, reservierungId, 'abgebrochen');
    return await scheitern(kontext, aufgabe.id, fehler.code, fehler.message);
  }

  const kosten = kostenMikrocent({
    eingabe: BigInt(entwurf.verbrauch.tokensEingabe),
    ausgabe: BigInt(entwurf.verbrauch.tokensAusgabe),
    gedanken: 0n,
  }, preis);

  const { schrittId } = await protokolliereSchritt(db, kontext.aktiverMandantId, aufgabe, {
    werkzeug: null,
    modell: entwurf.verbrauch.modell,
    eingabe: { vorlage: auftrag.vorlage, tatsachen: auftrag.tatsachen },
    ausgabe: { text: entwurf.text },
    tokensEingabe: entwurf.verbrauch.tokensEingabe,
    tokensAusgabe: entwurf.verbrauch.tokensAusgabe,
    kostenMikrocent: kosten,
    dauerMs: entwurf.verbrauch.dauerMs,
    begonnenAm: begonnen,
    status: 'erfolg',
  });

  /* Die Reservierung wird durch die Buchung abgelöst — gemessen, nicht geschätzt. */
  await bucheKosten(db, kontext.aktiverMandantId, {
    agentId: aufgabe.agentId,
    aufgabeId: aufgabe.id,
    budgetId,
    reservierungId,
    kostenMikrocent: kosten,
    tokensEingabe: BigInt(entwurf.verbrauch.tokensEingabe),
    tokensAusgabe: BigInt(entwurf.verbrauch.tokensAusgabe),
    tokensGedanken: 0n,
    modell: entwurf.verbrauch.modell,
    preislisteId: preis.id,
    betragOriginal: kosten,
    waehrungOriginal: preis.waehrung,
    wechselkurs: null,
  });

  /*
   * — Invariante 6, zur Laufzeit. —
   *
   * Der Test gegen den Demobetrieb beweist über einen echten Anbieter nichts.
   * Steht im Entwurf eine Ziffernfolge, die in keiner Tatsache vorkommt, ist
   * sie erfunden — und ein erfundener Betrag, eine erfundene Frist oder eine
   * erfundene Menge wird nicht freigabefähig. Der Lauf scheitert sichtbar,
   * mit den Zahlen im Fehlertext.
   */
  const herkunft = pruefeZahlenherkunft(entwurf.text, auftrag.tatsachen, auftrag.vorlage);
  if (!herkunft.sauber) {
    return await scheitern(kontext, aufgabe.id, 'ZAHL_ERFUNDEN',
      `Der Entwurf enthält Zahlen, die in keiner Tatsache stehen: ${herkunft.erfunden.join(', ')}. `
      + 'Das Modell rechnet nicht und erfindet nichts (Invariante 6) — der Vorschlag wird '
      + 'nicht vorgelegt.',
      { entwurf: entwurf.text, modell: entwurf.verbrauch.modell, schritte: 1 });
  }

  /*
   * — Schritt 2: vorlegen. NIE senden. —
   *
   * Der Vorschlag geht als `freigabe` mit Status `offen` in den Posteingang.
   * Das Tor (`policy.ts`) entscheidet erst NACH einer menschlichen
   * Entscheidung, ob etwas hinausgeht; hier entsteht nur das, worüber
   * entschieden wird.
   */
  const nutzlast = { entwurf: entwurf.text, ...auftrag.tatsachen };
  const [hash] = await kontext.schreibe<{ hash: string }>(
    `select encode(digest($1::bytea, 'sha256'), 'hex') as hash`,
    [Buffer.from(kanonisiere(nutzlast as never))]);
  const nutzlastHash = hash?.hash ?? '';

  /*
   * **Der Entwurf wird ein ARTEFAKT** (AGT-01, LEG-09). Er stand bisher nur im
   * Schritt und in der Freigabe; beide tragen ihre Löschfrist, die Aufbewahrung
   * war also nie offen — die ZEILE fehlte, an der eine zweite Fassung hängt
   * und gegen die ein Diff läuft. `cse_app` darf `agent_artefakt` nicht
   * schreiben (Artefakte schreiben Systemläufe), deshalb der enge Definer aus
   * 0159.
   */
  const [artefakt] = await kontext.schreibe<{ id: string }>(
    `select app.agent_artefakt_anlegen(
              $1::uuid, $2::uuid, 'textentwurf'::artefakt_art, $3, $4::jsonb, $5, $6::integer
            ) as id`,
    [aufgabe.id, schrittId, auftrag.vorlage, nutzlast, nutzlastHash,
      NUTZLAST_FRIST_TAGE_PLATZHALTER]);

  /*
   * **Das Risiko urteilt der Code** (§14.4). Die Lage besteht aus Tatsachen,
   * nicht aus Einschätzungen: kein Betrag im Spiel, keine Gegenpartei geprüft,
   * kein Vergleich vorhanden — und „kein Vergleich vorhanden" heisst nach
   * §14.5 volle Prüfung. Ein Entwurf, den ein Agent zum ersten Mal vorlegt,
   * ist damit `hoch`, und das ist die richtige Antwort: er war noch nie
   * jemandem vorgelegt worden.
   */
  const urteil = stufeRisikoEin({
    vorgangTyp: auftrag.vorgangTyp,
    betragCent: null,
    wirksameGrenzeCent: null,
    oeffentlicherAuftraggeber: false,
    neueGegenpartei: false,
    unsichereFelder: 0,
    injektionsverdacht: false,
    personenbezogeneEntscheidung: false,
    arbzgVerdikt: 'keine',
    hatVergleich: false,
    diffLeer: false,
  });

  const [freigabe] = await kontext.schreibe<{ id: string }>(
    /*
     * Die Gruende stehen in der Nutzlast und nicht in einer eigenen Spalte:
     * `freigabe` hat keine. Sie gehoeren trotzdem mit, weil „auch noch" eine
     * andere Auskunft ist als „deshalb" -- und weil ein Mensch im Posteingang
     * sonst eine Stufe sieht, die niemand begruendet.
     */
    `insert into freigabe
       (mandant_id, aktion, status, vorgang_typ, titel, zusammenfassung, risiko,
        risiko_punkte, diff, vorschau_payload, payload_hash, agent_id, agent_aufgabe_id,
        externe_ref)
     values ($1::uuid, $2, 'offen', $3::agent_vorgang_typ, $4, $5,
             $6::risiko_stufe, $7::integer, '[]'::jsonb, $8::jsonb, $9, $10::uuid, $11::uuid, $12)
     returning id`,
    [kontext.aktiverMandantId, auftrag.aktion, auftrag.vorgangTyp, auftrag.titel,
      entwurf.text, urteil.risiko, risikoPunkte(urteil.risiko),
      { ...nutzlast, risiko_gruende: urteil.gruende }, nutzlastHash,
      aufgabe.agentId, aufgabe.id, `agent:${aufgabe.id}`]);

  await kontext.schreibe(
    `update agent_aufgabe
        set status = 'wartet_auf_freigabe', beendet_am = now(),
            ergebnis = jsonb_build_object(
              'freigabe_id', $2::text, 'artefakt_id', $3::text)
      where id = $1::uuid`,
    [aufgabe.id, freigabe?.id ?? '', artefakt?.id ?? '']);

  return {
    aufgabeId: aufgabe.id,
    freigabeId: freigabe?.id ?? null,
    entwurf: entwurf.text,
    modell: entwurf.verbrauch.modell,
    schritte: 1,
    bestand: false,
    gestoert: null,
  };
}

/**
 * Wie viele Token ein Entwurf höchstens kostet — die Schätzung für die
 * Reservierung, nicht die Abrechnung.
 *
 * TODO(client, O-196): Wie lang darf ein Agentenentwurf höchstens werden?
 * Bis zur Antwort steht hier eine Obergrenze, die grosszügig genug ist, dass
 * keine Buchung die Reservierung übersteigt.
 */
const SCHAETZUNG_TOKEN = 8_000;

const entwurfModell = (port: ModellPort): string =>
  (port as { modell?: string }).modell ?? port.anbieter;

interface PreisZeile extends Preis {
  readonly id: string;
  readonly waehrung: string;
}

/** Der gültige Preis eines Modells — oder `null`, wenn keiner hinterlegt ist. */
async function preisFuer(
  db: { abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]> },
  modell: string,
): Promise<PreisZeile | null> {
  const [z] = await db.abfrage<{
    id: string; eingabe: string; ausgabe: string; gedanken: string | null; waehrung: string;
  }>(
    `select id,
            preis_eingabe_je_mio_token_mikrocent::text  as eingabe,
            preis_ausgabe_je_mio_token_mikrocent::text  as ausgabe,
            preis_gedanken_je_mio_token_mikrocent::text as gedanken,
            waehrung_original as waehrung
       from agent_preisliste
      where modell = $1
        and gueltig_ab <= app.berlin_heute()
        and (gueltig_bis is null or gueltig_bis >= app.berlin_heute())
      order by gueltig_ab desc
      limit 1`,
    [modell]);
  if (z === undefined) return null;
  return {
    id: z.id,
    waehrung: z.waehrung,
    eingabeJeMioToken: BigInt(z.eingabe),
    ausgabeJeMioToken: BigInt(z.ausgabe),
    gedankenJeMioToken: z.gedanken === null ? null : BigInt(z.gedanken),
  };
}

/**
 * Ein Lauf, der nichts vorlegt — sichtbar abgelegt statt still verschwunden.
 *
 * Sie schreibt und WIRFT NICHT: die Transaktion des Aufrufers committet, und
 * mit ihr die Aufgabenzeile samt Grund. Ein Wurf nähme sie mit, und im
 * Agentenzentrum stünde, dass es den Versuch nie gab.
 */
async function scheitern(
  kontext: SchreibKontext, aufgabeId: string, code: string, nachricht: string,
  dazu: { entwurf?: string; modell?: string; schritte?: number } = {},
): Promise<LaufErgebnis> {
  await kontext.schreibe(
    `update agent_aufgabe set status = 'fehlgeschlagen', fehler_text = $2, beendet_am = now()
      where id = $1::uuid`,
    [aufgabeId, nachricht]);
  return {
    aufgabeId,
    freigabeId: null,
    entwurf: dazu.entwurf ?? '',
    modell: dazu.modell ?? '',
    schritte: dazu.schritte ?? 0,
    bestand: false,
    gestoert: { code, nachricht },
  };
}
