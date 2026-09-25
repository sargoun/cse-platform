/**
 * Der Entwurf einer Stellenanzeige durch den Back-office-Agenten — und das
 * Bearbeiten eines Entwurfs durch einen Menschen (REC-02, SPEC §17, V-222,
 * D-716).
 *
 * **Der Befund.** `/recruiting/stellen/neu` war ein reines Handformular; kein
 * Weg liess den Agenten eine Anzeige entwerfen, `entwurf_von_art = 'agent'`
 * setzte nur der Seed, und Titel, Beschreibung und Anforderungen einer
 * angelegten Stelle konnte niemand ändern. REC-02 verlangt „AI drafts, a
 * human edits and approves".
 *
 * **Die Kette.** Ein Mensch gibt Titel, Einsatzort, Beginn, Stichpunkte und
 * die Anforderungen an; der Agent formuliert die Beschreibung über die
 * vorhandene Laufzeit (`fuehreLaufAus`: Modell aus dem Register, Budget,
 * Schrittprotokoll, Zahlenherkunft); daraus entsteht ein ENTWURF der Stelle
 * mit `entwurf_von_art = 'agent'`. Bearbeiten, zur Freigabe vorlegen und
 * veröffentlichen tut ein Mensch (Invariante 7) — der Agent legt nichts vor.
 *
 * **Die Anforderungen schreibt der Mensch, nicht das Modell.** Gegen sie
 * läuft später die Bewertung (REC-05), und im AGG-Streit muss jede davon
 * begründet werden können; ein erfundenes Kriterium wäre eine Benachteiligung
 * mit Ansage. Das Modell formuliert nur den Fliesstext.
 *
 * **Ohne Modell ist das kein Absturz**, sondern das bestehende Verhalten der
 * Laufzeit (§8): die Aufgabe steht als fehlgeschlagen im Agentenzentrum, die
 * Seite sagt „nicht verfügbar", und die Anzeige entsteht von Hand.
 */
import type { SchreibKontext } from '../../kontext/index.js';
import { fuehreLaufAus } from '../../agent/orchestrator.js';
import { AgentInaktiv } from '../../agent/laufzeit.js';
import {
  STELLENANZEIGE_AUFTRAG, fuelleStellenTatsachen, type StellenAngaben,
} from '../../agent/auftraege.js';
import { bedarf, legeStelleAn, RecruitingFehler } from './dienst.js';

export interface StellenEntwurfEingabe extends StellenAngaben {
  readonly anforderungen: readonly string[];
  readonly wochenstunden: number | null;
  readonly bewerbungsfrist: string | null;
}

export type StellenEntwurfErgebnis =
  | { readonly stelleId: string; readonly aufgabeId: string }
  | { readonly gestoert: { readonly code: string; readonly nachricht: string } };

/**
 * Die Gründe eines Laufs, der nichts vorgelegt hat, als Schlüssel der Seite.
 * Ein unbekannter Code fällt auf `ki_gestoert` — nie der Code selbst.
 */
export function kiGrund(code: string): string {
  switch (code) {
    case 'RESIDENCY_BLOCKED': case 'NOT_CONNECTED': case 'AUTH_FAILED':
      return 'ki_nicht_verfuegbar';
    case 'BUDGET': case 'BUDGET_EXCEEDED': return 'ki_budget';
    case 'PREIS_FEHLT': return 'ki_preis_fehlt';
    case 'ZAHL_ERFUNDEN': return 'ki_zahl_erfunden';
    case 'AGENT_INAKTIV': return 'ki_agent_aus';
    default: return 'ki_gestoert';
  }
}

export async function entwirfStellenanzeige(
  kontext: SchreibKontext, eingabe: StellenEntwurfEingabe,
  lauf: { readonly schluessel: string; readonly codeVersion: string },
): Promise<StellenEntwurfErgebnis> {
  if (eingabe.titel.trim() === '' || eingabe.einsatzort.trim() === ''
      || eingabe.beginn.trim() === '') {
    throw new RecruitingFehler(
      'Titel, Einsatzort und Beginn gibt ein Mensch an — der Agent setzt keine.',
      'angaben_fehlen', 400);
  }

  /* Der Bedarf eines gewählten Objekts — gezählt vom Dienst, nicht vom Modell. */
  let bedarfZeile: Awaited<ReturnType<typeof bedarf>>[number] | null = null;
  if (eingabe.objektId !== null) {
    const zeilen = await bedarf(kontext, 4);
    bedarfZeile = zeilen.find((z) => z.objektId === eingabe.objektId) ?? null;
    if (bedarfZeile === null) {
      throw new RecruitingFehler(
        'Für dieses Objekt zeigt der Dienstplan keinen offenen Bedarf.', 'kein_bedarf', 400);
    }
  }
  const tatsachen = await fuelleStellenTatsachen(
    { abfrage: kontext.abfrage.bind(kontext) }, eingabe, bedarfZeile);

  let ergebnis;
  try {
    ergebnis = await fuehreLaufAus(kontext, {
      ...STELLENANZEIGE_AUFTRAG,
      agent: 'backoffice',
      titel: `Stellenanzeige: ${eingabe.titel.trim()}`,
      tatsachen,
      idempotenzSchluessel: `stellenanzeige:${lauf.schluessel}`,
      angefordertVon: kontext.benutzerId,
      codeVersion: lauf.codeVersion,
      vorlegen: false,
    });
  } catch (fehler: unknown) {
    if (fehler instanceof AgentInaktiv) {
      return { gestoert: { code: 'AGENT_INAKTIV', nachricht: fehler.message } };
    }
    throw fehler;
  }
  if (ergebnis.gestoert !== null) return { gestoert: ergebnis.gestoert };

  /*
   * **Ein zweiter Klick legt keine zweite Stelle an.** Die Aufgabe trägt die
   * Kennung ihrer Stelle; findet `starteAufgabe` sie wieder (`bestand`), gilt
   * die schon angelegte.
   */
  if (ergebnis.bestand) {
    const [schon] = await kontext.abfrage<{ stelle: string | null }>(
      `select ergebnis ->> 'stelle_id' as stelle from agent_aufgabe
        where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [ergebnis.aufgabeId]);
    if (schon?.stelle !== null && schon?.stelle !== undefined) {
      return { stelleId: schon.stelle, aufgabeId: ergebnis.aufgabeId };
    }
    throw new RecruitingFehler(
      'Dieser Entwurf läuft schon — bitte die Seite neu laden.', 'gleichzeitig', 409);
  }

  const stelleId = await legeStelleAn(kontext, {
    titel: eingabe.titel.trim(),
    beschreibung: ergebnis.entwurf,
    anforderungen: eingabe.anforderungen,
    einsatzort: eingabe.einsatzort.trim(),
    wochenstunden: eingabe.wochenstunden,
    bewerbungsfrist: eingabe.bewerbungsfrist,
    entwurfVonArt: 'agent',
  });
  await kontext.schreibe(
    `update agent_aufgabe
        set ergebnis = coalesce(ergebnis, '{}'::jsonb) || jsonb_build_object('stelle_id', $2::text),
            bezug_typ = 'stelle', bezug_id = $2::uuid
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
    [ergebnis.aufgabeId, stelleId]);
  return { stelleId, aufgabeId: ergebnis.aufgabeId };
}

export interface StellenAenderung {
  readonly titel: string;
  readonly beschreibung: string;
  readonly anforderungen: readonly string[];
  readonly einsatzort: string | null;
  readonly wochenstunden: number | null;
  readonly bewerbungsfrist: string | null;
}

/**
 * Einen Entwurf bearbeiten — nur, solange er Entwurf ist und keine Freigabe
 * an ihm hängt (V-222).
 *
 * Die Freigabe bindet ihren Abdruck an genau den vorgelegten Text
 * (`legeStelleVor`, `payload_hash`); wer danach ändert, hätte keine Freigabe
 * mehr für das, was hinausgeht. Die Bedingung steht IM `update`.
 * `entwurf_von_art` bleibt, wie es ist: es sagt, wer entworfen hat, und
 * `geaendert_von` sagt, wer zuletzt bearbeitet hat.
 */
export async function aendereStelle(
  kontext: SchreibKontext, id: string, a: StellenAenderung,
): Promise<void> {
  if (a.titel.trim() === '' || a.beschreibung.trim() === '') {
    throw new RecruitingFehler('Titel und Beschreibung sind Pflicht.', 'unvollstaendig', 400);
  }
  const [vorher] = await kontext.abfrage<{
    titel: string; status: string; freigabe_id: string | null;
  }>(
    `select titel, status::text as status, freigabe_id from stelle
      where id = $1::uuid and mandant_id = app.aktiver_mandant() for update`, [id]);
  if (vorher === undefined) {
    throw new RecruitingFehler('Diese Stelle gibt es nicht.', 'unbekannt', 404);
  }
  if (vorher.status !== 'entwurf') {
    throw new RecruitingFehler(
      'Bearbeitet wird ein Entwurf. Was freigegeben oder veröffentlicht ist, trägt eine '
      + 'Freigabe für genau diesen Text.', 'falscher_status', 409);
  }
  if (vorher.freigabe_id !== null) {
    throw new RecruitingFehler(
      'Diese Anzeige liegt im Freigabe-Posteingang — bearbeitet wird sie erst wieder, wenn '
      + 'die Freigabe abgelehnt oder zurückgezogen ist.', 'schon_vorgelegt', 409);
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update stelle
        set titel = $2, beschreibung = $3, anforderungen = $4::text[], einsatzort = $5,
            wochenstunden = $6::numeric, bewerbungsfrist = $7::date,
            geaendert_von = $8::uuid, geaendert_am = now()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and status = 'entwurf' and freigabe_id is null
      returning id`,
    [id, a.titel.trim(), a.beschreibung.trim(),
      a.anforderungen.map((x) => x.trim()).filter((x) => x !== ''),
      a.einsatzort, a.wochenstunden, a.bewerbungsfrist, kontext.benutzerId]);
  if (zeilen.length === 0) {
    throw new RecruitingFehler(
      'Die Stelle hat sich inzwischen geändert — oder diese Sitzung darf sie nicht '
      + 'bearbeiten.', 'gleichzeitig', 409);
  }
  await kontext.schreibe(
    `select app.protokolliere('recruiting.stelle_bearbeitet', 'stelle', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`,
    [id, { titel: vorher.titel }, { titel: a.titel.trim() }]);
}
