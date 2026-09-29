import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import {
  beendeAufgabe, beginneSchritt, protokolliereSchritt, starteAufgabe,
} from '../../agent/laufzeit.js';
import { KATALOG, sucheBestand } from '../../agent/tools/suche-bestand.js';
import { Wertregister } from '../../agent/tools/register.js';
import {
  verlangeWerkzeug, WerkzeugNichtFreigeschaltet, type WerkzeugStand,
} from '../../agent/tools/freischaltung.js';
import {
  darfVorlegen, halteErgebnisZurueck, liefereErgebnis, type Auslieferung,
} from '../../agent/tools/ergebnis-freigabe.js';

/**
 * Eine Frage an den CEO-Assistenten — beantwortet UND protokolliert (AGT-04,
 * AGT-07, V-229, D-723).
 *
 * **Der Befund** (Audit Befund 59): die Seite führte `suche_bestand` in einer
 * Lesetransaktion aus und legte weder `agent_aufgabe` noch `agent_schritt`
 * an. AGT-04 verlangt, dass jeder Schritt mit Werkzeug, Eingabe, Ausgabe,
 * Modell, Tokens, Kosten und Dauer protokolliert wird; die tägliche
 * Hauptfunktion dieses Agenten hinterliess keine Spur, und im Agentenzentrum
 * standen nur die Knopf-Läufe.
 *
 * **Jetzt ist jede Frage eine Aufgabe mit einem Schritt**, über dieselben
 * Funktionen wie der Orchestrator (`starteAufgabe`, `protokolliereSchritt`,
 * `beendeAufgabe`): Werkzeug `suche_bestand`, Eingabe die Abfragekennung,
 * Ausgabe Frage, Antwort und Stand, Modell keins, Tokens und Kosten null —
 * gerechnet hat die Datenbank —, Dauer gemessen. Die Seite zeigt danach die
 * Antwort DIESER Aufgabe, nicht eine neu gerechnete.
 *
 * **Geschrieben wird nur auf einen POST** (`/api/agenten/assistent`), nie
 * beim Anzeigen einer Seite: ein GET, der eine Zeile anlegt, legte sie auch
 * beim Vorladen eines Links an. Derselbe Schlüssel je Formular macht aus einem
 * Doppelklick keine zweite Aufgabe (`idempotenz_schluessel`).
 *
 * **Das Werkzeug muss freigeschaltet sein** (V-228, D-722): das Tor
 * `verlangeWerkzeug` fragt den Stand vor dem Aufruf. Ist es nicht
 * freigeschaltet, entsteht trotzdem eine Aufgabe — mit einem Schritt
 * `abgelehnt_richtlinie` und dem Satz, warum —, denn auch eine abgewiesene
 * Frage ist eine Handlung, die im Protokoll stehen soll.
 *
 * **Und „Ergebnis nur mit Freigabe" wirkt** (V-270, D-763). Trägt das Werkzeug
 * in dieser Gesellschaft `erfordert_freigabe`, geht die Antwort nicht an den
 * Menschen, der gefragt hat, sondern als Freigabe in den Posteingang
 * (`agent/tools/ergebnis-freigabe.ts`); die Aufgabe wartet, der Schritt nennt
 * die Freigabe statt der Antwort. Ausgeliefert wird sie erst, wenn ein Mensch
 * sie genehmigt hat — durch das Tor in `server/agent/policy.ts`. Wer selbst
 * keine Freigabe vorlegen darf, bekommt eine abgewiesene Frage statt einer
 * Zeile, die an der Datenbank scheitert.
 */

export class AssistentFehler extends Error {
  constructor(nachricht: string, readonly grund: 'unbekannt' | 'schluessel') {
    super(nachricht);
    this.name = 'AssistentFehler';
  }
}

export interface FrageEingabe {
  readonly abfrageId: string;
  /** Einmal je Anzeige des Formulars — gegen die zweite Aufgabe aus einem Doppelklick. */
  readonly schluessel: string;
  readonly angefordertVon: string | null;
}

export interface FrageErgebnis {
  readonly aufgabeId: string;
  /** Gab es die Aufgabe zu diesem Schlüssel schon? Dann wurde nichts neu gerechnet. */
  readonly bestand: boolean;
}

/** Was die Seite aus der Aufgabe wieder liest — `agent_aufgabe.ergebnis`. */
export interface AssistentAntwort {
  readonly frage: string;
  readonly anzeige: string;
  readonly stand: string;
  readonly abfrageId: string;
}

export async function beantworteFrage(
  kontext: SchreibKontext, e: FrageEingabe,
): Promise<FrageErgebnis> {
  const eintrag = KATALOG.find((k) => k.id === e.abfrageId);
  if (eintrag === undefined) {
    throw new AssistentFehler(
      'Diese Frage steht nicht im Katalog — beantwortet wird nur, was jemand als '
      + 'Abfrage geschrieben und nachgerechnet hat (AGT-07).', 'unbekannt');
  }
  const schluessel = e.schluessel.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 64);
  if (schluessel === '') {
    throw new AssistentFehler('Dem Formular fehlt sein Schlüssel.', 'schluessel');
  }

  const mandantId = kontext.aktiverMandantId;
  const aufgabe = await starteAufgabe(kontext, mandantId, {
    agentKennung: 'ceo_assistent',
    vorgangTyp: 'interner_hinweis',
    titel: `Frage: ${eintrag.frage}`,
    eingabe: { abfrageId: eintrag.id },
    idempotenzSchluessel: `assistent:${schluessel}`,
    angefordertVon: e.angefordertVon,
    ausgeloestDurch: 'mensch',
  });
  if (aufgabe.bestand) return { aufgabeId: aufgabe.id, bestand: true };

  const begonnen = await beginneSchritt(kontext);
  const uhr = performance.now();
  const gemessen = (): number => Math.round(performance.now() - uhr);

  const abweisen = async (grund: string, satz: string): Promise<FrageErgebnis> => {
    await protokolliereSchritt(kontext, mandantId, aufgabe, {
      werkzeug: 'suche_bestand',
      modell: null,
      eingabe: { abfrageId: eintrag.id },
      ausgabe: { abgelehnt: grund },
      dauerMs: gemessen(),
      begonnenAm: begonnen,
      status: 'abgelehnt_richtlinie',
    });
    await beendeAufgabe(kontext, mandantId, aufgabe.id, {
      status: 'abgebrochen', fehlerText: satz,
    });
    return { aufgabeId: aufgabe.id, bestand: false };
  };

  let stand: WerkzeugStand;
  try {
    stand = await verlangeWerkzeug(kontext, 'ceo_assistent', 'suche_bestand');
  } catch (fehler: unknown) {
    if (!(fehler instanceof WerkzeugNichtFreigeschaltet)) throw fehler;
    return abweisen('werkzeug_nicht_freigeschaltet',
      'Das Werkzeug „Bestand abfragen" ist in dieser Gesellschaft für den '
      + 'CEO-Assistenten nicht freigeschaltet.');
  }
  if (stand.erfordertFreigabe && !(await darfVorlegen(kontext))) {
    return abweisen('freigabe_nicht_vorlegbar',
      'Die Antwort geht in dieser Gesellschaft nur mit Freigabe weiter, und eine '
      + 'Freigabe vorzulegen erlaubt dieser Zugang nicht. Die Frage wurde deshalb '
      + 'nicht beantwortet.');
  }

  const register = new Wertregister();
  const ergebnis = await sucheBestand(kontext, mandantId, eintrag.id, register);
  if (!ergebnis.ok) {
    await protokolliereSchritt(kontext, mandantId, aufgabe, {
      werkzeug: 'suche_bestand',
      modell: null,
      eingabe: { abfrageId: eintrag.id },
      ausgabe: { fehler: ergebnis.fehler.code, nachricht: ergebnis.fehler.nachricht },
      dauerMs: gemessen(),
      begonnenAm: begonnen,
      status: 'fehler',
    });
    await beendeAufgabe(kontext, mandantId, aufgabe.id, {
      status: 'fehlgeschlagen', fehlerText: ergebnis.fehler.nachricht,
    });
    return { aufgabeId: aufgabe.id, bestand: false };
  }

  const antwort: AssistentAntwort = {
    frage: ergebnis.daten.frage,
    anzeige: register.lies(ergebnis.daten.antwortToken).anzeige,
    stand: register.lies(ergebnis.daten.standToken).anzeige,
    abfrageId: ergebnis.daten.abfrageId,
  };

  /*
   * **Nur mit Freigabe:** die Antwort geht in den Posteingang, nicht an den
   * Menschen, der gefragt hat. Der Schritt nennt die Freigabe statt der
   * Antwort — sonst stünde das zurückgehaltene Ergebnis im Protokoll, bevor
   * jemand es freigegeben hat.
   */
  if (stand.erfordertFreigabe) {
    const freigabeId = await halteErgebnisZurueck(kontext, {
      aufgabeId: aufgabe.id,
      agentId: aufgabe.agentId,
      agent: 'ceo_assistent',
      werkzeug: 'suche_bestand',
      titel: `Antwort des CEO-Assistenten: ${antwort.frage}`,
      zusammenfassung: `„${antwort.frage}" — ${antwort.anzeige} (gelesen am ${antwort.stand}). `
        + 'Das Werkzeug „Bestand abfragen" gibt sein Ergebnis in dieser Gesellschaft nur mit '
        + 'Freigabe weiter: die fragende Person sieht die Antwort erst, wenn sie hier '
        + 'genehmigt ist.',
      ergebnis: { ...antwort },
    });
    await protokolliereSchritt(kontext, mandantId, aufgabe, {
      werkzeug: 'suche_bestand',
      modell: null,
      eingabe: { abfrageId: eintrag.id },
      ausgabe: { zurueckgehalten: 'erfordert_freigabe', freigabe_id: freigabeId },
      tokensEingabe: 0,
      tokensAusgabe: 0,
      kostenMikrocent: 0n,
      dauerMs: gemessen(),
      begonnenAm: begonnen,
      status: 'erfolg',
      quellen: register.alle().map((w) => w.quelle),
      freigabeId,
    });
    await beendeAufgabe(kontext, mandantId, aufgabe.id, {
      status: 'wartet_auf_freigabe', ergebnis: { freigabe_id: freigabeId },
    });
    return { aufgabeId: aufgabe.id, bestand: false };
  }

  await protokolliereSchritt(kontext, mandantId, aufgabe, {
    werkzeug: 'suche_bestand',
    modell: null,
    eingabe: { abfrageId: eintrag.id },
    ausgabe: antwort,
    tokensEingabe: 0,
    tokensAusgabe: 0,
    kostenMikrocent: 0n,
    dauerMs: gemessen(),
    begonnenAm: begonnen,
    status: 'erfolg',
    quellen: register.alle().map((w) => w.quelle),
  });
  await beendeAufgabe(kontext, mandantId, aufgabe.id, {
    status: 'abgeschlossen', ergebnis: antwort,
  });
  return { aufgabeId: aufgabe.id, bestand: false };
}

export interface ProtokollierteFrage {
  readonly aufgabeId: string;
  readonly status: string;
  readonly antwort: AssistentAntwort | null;
  readonly fehlerText: string | null;
  readonly schritte: number;
  /**
   * Nur bei einem zurückgehaltenen Ergebnis (V-270): was das Tor sagt. `null`
   * heisst, das Werkzeug gab sein Ergebnis ohne eigene Freigabe weiter.
   */
  readonly freigabe: Auslieferung['art'] | null;
  readonly freigabeId: string | null;
}

/**
 * Die protokollierte Antwort wieder lesen — nur Aufgaben des CEO-Assistenten
 * der aktiven Gesellschaft (RLS: `t_mandant`, `agent.lesen`). Eine fremde oder
 * unbekannte Kennung ist `null`, und die Seite zeigt dann keine Antwort.
 *
 * **Ein zurückgehaltenes Ergebnis steht nicht in der Aufgabe** (V-270): dort
 * steht nur die Kennung seiner Freigabe, und die Antwort kommt aus der
 * Freigabe — ausschliesslich durch `gateWerkzeugErgebnis`. Offen heisst
 * „wartet", abgelehnt oder ohne passenden Abdruck heisst keine Antwort.
 */
export async function leseFrage(
  kontext: { abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]> },
  aufgabeId: string,
): Promise<ProtokollierteFrage | null> {
  const [z] = await kontext.abfrage<{
    id: string; mandant_id: string; status: string; ergebnis: unknown;
    fehler_text: string | null; schritte_anzahl: number;
  }>(
    `select a.id, a.mandant_id, a.status::text as status, a.ergebnis, a.fehler_text,
            a.schritte_anzahl
       from agent_aufgabe a
       join agent ag on ag.id = a.agent_id
      where a.id = $1::uuid
        and ag.kennung = 'ceo_assistent'
        and a.mandant_id = app.aktiver_mandant()`,
    [aufgabeId]);
  if (z === undefined) return null;
  const basis = {
    aufgabeId: z.id, status: z.status, fehlerText: z.fehler_text, schritte: z.schritte_anzahl,
  };

  const freigabeId = zurueckgehalten(z.ergebnis);
  if (freigabeId === null) {
    return {
      ...basis,
      antwort: istAntwort(z.ergebnis) ? z.ergebnis : null,
      freigabe: null,
      freigabeId: null,
    };
  }
  const lieferung = await liefereErgebnis(kontext, {
    mandantId: z.mandant_id, aufgabeId: z.id, freigabeId,
  });
  const antwort = lieferung.art === 'geliefert' && istAntwort(lieferung.inhalt)
    ? {
      frage: lieferung.inhalt.frage, anzeige: lieferung.inhalt.anzeige,
      stand: lieferung.inhalt.stand, abfrageId: lieferung.inhalt.abfrageId,
    }
    : null;
  return { ...basis, antwort, freigabe: lieferung.art, freigabeId };
}

/** Die Kennung der Freigabe, wenn das Ergebnis zurückgehalten wurde — sonst `null`. */
function zurueckgehalten(ergebnis: unknown): string | null {
  if (ergebnis === null || typeof ergebnis !== 'object') return null;
  const id = (ergebnis as Record<string, unknown>)['freigabe_id'];
  return typeof id === 'string' && id !== '' ? id : null;
}

function istAntwort(wert: unknown): wert is AssistentAntwort {
  if (wert === null || typeof wert !== 'object') return false;
  const w = wert as Record<string, unknown>;
  return typeof w['frage'] === 'string' && typeof w['anzeige'] === 'string'
    && typeof w['stand'] === 'string' && typeof w['abfrageId'] === 'string';
}
