/**
 * Der strukturierte Kandidatendatensatz (REC-04, V-223, D-717).
 *
 * **Der Befund.** `kandidat` (0166: Qualifikationen, Sprachen,
 * Erfahrungsjahre, `quelle_art`, Bestätigung durch einen Menschen) hatte im
 * ganzen Baum keinen Schreiber, auch nicht im Seed, und keine Seite zeigte
 * seine Felder. ROADMAP meldete „the parsed candidate record" als erledigt.
 *
 * **Drei Wege, eine Regel: der Datensatz gilt erst, wenn ein Mensch ihn
 * bestätigt hat.**
 *
 *  1. `erfasseKandidat` — ein Mensch trägt ein oder berichtigt. Jede Änderung
 *     nimmt eine frühere Bestätigung zurück: bestätigt war der ALTE Stand.
 *  2. `schlageKandidatVor` — der Back-office-Agent liest die Angaben der
 *     Bewerbung aus (Fähigkeit `extraktion_dokument`, über die vorhandene
 *     Laufzeit: Register, Budget, Schrittprotokoll, Zahlenherkunft). Das
 *     Ergebnis steht mit `quelle_art = 'agent'` und UNBESTÄTIGT da.
 *  3. `bestaetigeKandidat` — ein Mensch bestätigt; `bestaetigt_am` setzt die
 *     Uhr der Datenbank, `bestaetigt_von` die Sitzung (beide gemeinsam, CHECK
 *     `kandidat_bestaetigung_vollstaendig`).
 *
 * **Was das Modell NICHT tut** (Invariante 6): rechnen. Die Erfahrungsjahre
 * übernimmt `leseExtraktion` nur, wenn die Zahl WÖRTLICH in den Angaben der
 * Bewerbung steht; sonst bleiben sie leer — „nicht erkannt", nie geschätzt.
 * Und es bewertet nicht: kein Rang, keine Punkte (REC-05, LEG-12).
 *
 * **Die Quelle ist die Nachricht der Bewerbung, nicht der Lebenslauf** — ein
 * Lebenslauf kommt als Datei nicht an, solange O-375 offen ist. Die Seite
 * sagt das.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { fuehreLaufAus } from '../../agent/orchestrator.js';
import { AgentInaktiv } from '../../agent/laufzeit.js';
import { RecruitingFehler } from './dienst.js';

export interface KandidatDatensatz {
  readonly id: string;
  readonly quelleArt: 'mensch' | 'agent' | 'system';
  readonly qualifikationen: readonly string[];
  readonly sprachen: readonly string[];
  readonly erfahrungJahre: number | null;
  readonly notiz: string | null;
  readonly bestaetigtAm: Date | null;
  readonly bestaetigtVon: string | null;
  readonly geaendertAm: Date | null;
  readonly erstelltAm: Date;
}

export async function ladeKandidat(
  kontext: LeseKontext, bewerbungId: string,
): Promise<KandidatDatensatz | null> {
  const [z] = await kontext.abfrage<KandidatDatensatz>(
    `select k.id, k.quelle_art::text as "quelleArt", k.qualifikationen, k.sprachen,
            k.erfahrung_jahre as "erfahrungJahre", k.notiz,
            k.bestaetigt_am as "bestaetigtAm",
            (select b.name from benutzer b where b.id = k.bestaetigt_von) as "bestaetigtVon",
            k.geaendert_am as "geaendertAm", k.erstellt_am as "erstelltAm"
       from kandidat k
      where k.bewerbung_id = $1::uuid and k.mandant_id = app.aktiver_mandant()`,
    [bewerbungId]);
  return z ?? null;
}

/** Anzeigegrenzen, keine Fachregeln. */
export const KANDIDAT_EINTRAEGE_HOECHSTENS = 30;
export const KANDIDAT_EINTRAG_LAENGE = 120;

/** Eine Zeile je Eintrag — leer, doppelt und überlang fallen weg bzw. werden gekürzt. */
export function eintraege(roh: readonly string[]): readonly string[] {
  const gesehen = new Set<string>();
  const raus: string[] = [];
  for (const r of roh) {
    const t = r.trim().slice(0, KANDIDAT_EINTRAG_LAENGE);
    if (t === '' || gesehen.has(t.toLowerCase())) continue;
    gesehen.add(t.toLowerCase());
    raus.push(t);
    if (raus.length >= KANDIDAT_EINTRAEGE_HOECHSTENS) break;
  }
  return raus;
}

export interface KandidatEingabe {
  readonly qualifikationen: readonly string[];
  readonly sprachen: readonly string[];
  /** `null` heisst „nicht erkannt", nie „null Jahre" (0166). */
  readonly erfahrungJahre: number | null;
  readonly notiz: string | null;
}

async function lebendeBewerbung(kontext: SchreibKontext, bewerbungId: string): Promise<{
  nachricht: string | null; stelle: string | null; anforderungen: readonly string[];
}> {
  const [b] = await kontext.abfrage<{
    nachricht: string | null; stelle: string | null; anforderungen: readonly string[] | null;
  }>(
    `select b.nachricht, s.titel as stelle, s.anforderungen
       from bewerbung b
       left join stelle s on s.id = b.stelle_id and s.mandant_id = b.mandant_id
      where b.id = $1::uuid and b.mandant_id = app.aktiver_mandant()
        and b.geloescht_am is null`, [bewerbungId]);
  if (b === undefined) {
    throw new RecruitingFehler('Diese Bewerbung gibt es nicht.', 'unbekannt', 404);
  }
  return { nachricht: b.nachricht, stelle: b.stelle, anforderungen: b.anforderungen ?? [] };
}

/** Schreibt den Datensatz — immer UNBESTÄTIGT, je Bewerbung genau einer. */
async function schreibeKandidat(
  kontext: SchreibKontext, bewerbungId: string, quelle: 'mensch' | 'agent',
  e: KandidatEingabe,
): Promise<string> {
  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into kandidat
       (mandant_id, bewerbung_id, quelle_art, qualifikationen, sprachen, erfahrung_jahre,
        notiz, geaendert_von)
     values (app.aktiver_mandant(), $1::uuid, $2::akteur_art, $3::text[], $4::text[],
             $5::int, $6, app.aktueller_benutzer())
     on conflict (bewerbung_id) do update
        set quelle_art = excluded.quelle_art,
            qualifikationen = excluded.qualifikationen,
            sprachen = excluded.sprachen,
            erfahrung_jahre = excluded.erfahrung_jahre,
            notiz = excluded.notiz,
            bestaetigt_am = null, bestaetigt_von = null,
            geaendert_von = app.aktueller_benutzer()
     returning id`,
    [bewerbungId, quelle, [...eintraege(e.qualifikationen)], [...eintraege(e.sprachen)],
      e.erfahrungJahre, e.notiz === null || e.notiz.trim() === '' ? null : e.notiz.trim()]);
  if (z === undefined) {
    throw new RecruitingFehler('Der Datensatz wurde nicht geschrieben.', 'kein_schreibrecht', 403);
  }
  return z.id;
}

/** Ein Mensch trägt ein oder berichtigt — eine frühere Bestätigung fällt weg. */
export async function erfasseKandidat(
  kontext: SchreibKontext, bewerbungId: string, e: KandidatEingabe,
): Promise<string> {
  if (e.erfahrungJahre !== null
      && (!Number.isInteger(e.erfahrungJahre) || e.erfahrungJahre < 0
        || e.erfahrungJahre > 60)) {
    throw new RecruitingFehler(
      'Erfahrungsjahre als ganze Zahl zwischen 0 und 60 — oder leer, wenn sie nicht bekannt '
      + 'sind.', 'unbrauchbare_jahre', 400);
  }
  await lebendeBewerbung(kontext, bewerbungId);
  const id = await schreibeKandidat(kontext, bewerbungId, 'mensch', e);
  await kontext.schreibe(
    `select app.protokolliere('recruiting.kandidat_erfasst', 'kandidat', $1, null,
                              $2::jsonb, app.aktiver_mandant())`,
    [id, { quelle_art: 'mensch', bewerbung_id: bewerbungId }]);
  return id;
}

/** Ein Mensch bestätigt — Zeitpunkt nach der Uhr der Datenbank (Invariante 5). */
export async function bestaetigeKandidat(
  kontext: SchreibKontext, bewerbungId: string,
): Promise<void> {
  await lebendeBewerbung(kontext, bewerbungId);
  const zeilen = await kontext.schreibe<{ id: string; quelle: string }>(
    `update kandidat
        set bestaetigt_am = now(), bestaetigt_von = app.aktueller_benutzer(),
            geaendert_von = app.aktueller_benutzer()
      where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()
        and bestaetigt_am is null
      returning id, quelle_art::text as quelle`, [bewerbungId]);
  const z = zeilen[0];
  if (z === undefined) {
    const [da] = await kontext.abfrage<{ id: string }>(
      `select id from kandidat where bewerbung_id = $1::uuid
          and mandant_id = app.aktiver_mandant()`, [bewerbungId]);
    throw da === undefined
      ? new RecruitingFehler('Es gibt noch keinen Datensatz, der bestätigt werden könnte.',
        'kein_datensatz', 409)
      : new RecruitingFehler('Der Datensatz ist bereits bestätigt.', 'schon_bestaetigt', 409);
  }
  await kontext.schreibe(
    `select app.protokolliere('recruiting.kandidat_bestaetigt', 'kandidat', $1, null,
                              $2::jsonb, app.aktiver_mandant())`,
    [z.id, { quelle_art: z.quelle }]);
}

/**
 * Die Antwort eines Modells als Datensatz — oder `null`, wenn sie keiner ist.
 *
 * Erwartet wird ein JSON-Objekt `{ qualifikationen: string[], sprachen:
 * string[], erfahrung_jahre: number | null }`, auch eingebettet in Text.
 * **Die Erfahrungsjahre gelten nur, wenn die Zahl wörtlich in der Quelle
 * steht** (Invariante 6) — sonst `null`. Rein, damit
 * `tests/kern/kandidat-extraktion.test.ts` jeden Fall ohne Modell prüft.
 */
export function leseExtraktion(text: string, quelle: string): KandidatEingabe | null {
  const anfang = text.indexOf('{');
  const ende = text.lastIndexOf('}');
  if (anfang < 0 || ende <= anfang) return null;
  let roh: unknown;
  try {
    roh = JSON.parse(text.slice(anfang, ende + 1)) as unknown;
  } catch {
    return null;
  }
  if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) return null;
  const o = roh as Record<string, unknown>;
  const liste = (w: unknown): readonly string[] | null =>
    Array.isArray(w) && w.every((x) => typeof x === 'string') ? w as string[] : null;
  const qualifikationen = liste(o['qualifikationen']);
  const sprachen = liste(o['sprachen']);
  if (qualifikationen === null || sprachen === null) return null;
  const jahre = o['erfahrung_jahre'];
  const zahlen = new Set(quelle.match(/\d+/gu) ?? []);
  const erfahrungJahre = typeof jahre === 'number' && Number.isInteger(jahre) && jahre >= 0
    && jahre <= 60 && zahlen.has(String(jahre)) ? jahre : null;
  return {
    qualifikationen: eintraege(qualifikationen), sprachen: eintraege(sprachen),
    erfahrungJahre, notiz: null,
  };
}

export type VorschlagErgebnis =
  | { readonly art: 'vorgeschlagen'; readonly kandidatId: string }
  | { readonly art: 'gestoert'; readonly code: string; readonly nachricht: string };

/**
 * Der Agent liest die Angaben der Bewerbung aus (REC-04, V-223).
 *
 * Über `fuehreLaufAus` mit `vorlegen: false` und der Fähigkeit
 * `extraktion_dokument`: das Register entscheidet, ob ein Modell dafür
 * freigegeben ist; ohne eines endet der Lauf mit „nicht verfügbar" (§8), und
 * nichts wird geschrieben. Eine Antwort, die kein Datensatz ist — der
 * Demobetrieb hat für diese Vorgangsart keine Vorlage und sagt das —, wird
 * NICHT gespeichert; die Aufgabe steht dann als fehlgeschlagen im
 * Agentenzentrum. Ein bestätigter Datensatz wird nicht überschrieben.
 */
export async function schlageKandidatVor(
  kontext: SchreibKontext, bewerbungId: string,
  lauf: { readonly schluessel: string; readonly codeVersion: string },
): Promise<VorschlagErgebnis> {
  const b = await lebendeBewerbung(kontext, bewerbungId);
  const vorhanden = await ladeKandidat(kontext, bewerbungId);
  if (vorhanden?.bestaetigtAm !== null && vorhanden?.bestaetigtAm !== undefined) {
    throw new RecruitingFehler(
      'Der Datensatz ist von einem Menschen bestätigt — ein Vorschlag überschreibt ihn nicht.',
      'schon_bestaetigt', 409);
  }
  const quelle = (b.nachricht ?? '').trim();
  if (quelle === '') {
    throw new RecruitingFehler(
      'Die Bewerbung trägt keinen Text, aus dem sich etwas auslesen liesse.', 'ohne_quelle', 409);
  }
  const tatsachen = {
    nachricht: quelle,
    stelle: b.stelle ?? 'Initiativbewerbung',
    anforderungen: b.anforderungen.join('; '),
  };
  let ergebnis;
  try {
    ergebnis = await fuehreLaufAus(kontext, {
      agent: 'backoffice',
      vorgangTyp: 'bewerbung_auswerten',
      aktion: 'kandidat_extraktion',
      titel: 'Angaben einer Bewerbung auslesen',
      vorlage: 'kandidat_extraktion',
      tatsachen,
      bezugTyp: 'bewerbung',
      bezugId: bewerbungId,
      idempotenzSchluessel: `kandidat:${lauf.schluessel}`,
      angefordertVon: kontext.benutzerId,
      codeVersion: lauf.codeVersion,
      vorlegen: false,
      faehigkeit: 'extraktion_dokument',
    });
  } catch (fehler: unknown) {
    if (fehler instanceof AgentInaktiv) {
      return { art: 'gestoert', code: 'AGENT_INAKTIV', nachricht: fehler.message };
    }
    throw fehler;
  }
  if (ergebnis.gestoert !== null) return { art: 'gestoert', ...ergebnis.gestoert };
  if (ergebnis.bestand) {
    const schon = await ladeKandidat(kontext, bewerbungId);
    if (schon !== null) return { art: 'vorgeschlagen', kandidatId: schon.id };
    return { art: 'gestoert', code: 'UNBRAUCHBAR', nachricht: 'Kein verwertbarer Datensatz.' };
  }
  const gelesen = leseExtraktion(ergebnis.entwurf, quelle);
  if (gelesen === null) {
    const satz = 'Die Antwort des Modells war kein Datensatz — nichts wurde übernommen.';
    await kontext.schreibe(
      `update agent_aufgabe set status = 'fehlgeschlagen', fehler_text = $2
        where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
      [ergebnis.aufgabeId, satz]);
    return { art: 'gestoert', code: 'UNBRAUCHBAR', nachricht: satz };
  }
  const id = await legeVorschlagAb(kontext, bewerbungId, gelesen, ergebnis.aufgabeId);
  return { art: 'vorgeschlagen', kandidatId: id };
}

/**
 * Was ein Lauf ausgelesen hat, als Datensatz ablegen — `quelle_art = 'agent'`,
 * UNBESTÄTIGT, mit der Aufgabe im Prüfprotokoll.
 *
 * Eigens exportiert, damit `tests/isolation/recruiting-kandidat.test.ts` den
 * Schreibweg gegen die Datenbank prüft, ohne ein Sprachmodell zu brauchen:
 * der Demobetrieb liest nichts aus (er hat keine Vorlage dafür und sagt das),
 * und ein erfundener Anbieter im Test wäre genau die Attrappe, die es nicht
 * geben soll. Ein bestätigter Datensatz wird nicht überschrieben.
 */
export async function legeVorschlagAb(
  kontext: SchreibKontext, bewerbungId: string, gelesen: KandidatEingabe, aufgabeId: string,
): Promise<string> {
  await lebendeBewerbung(kontext, bewerbungId);
  const [bestaetigt] = await kontext.abfrage<{ id: string }>(
    `select id from kandidat
      where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()
        and bestaetigt_am is not null
      for update`, [bewerbungId]);
  if (bestaetigt !== undefined) {
    throw new RecruitingFehler(
      'Der Datensatz ist von einem Menschen bestätigt — ein Vorschlag überschreibt ihn nicht.',
      'schon_bestaetigt', 409);
  }
  const id = await schreibeKandidat(kontext, bewerbungId, 'agent', gelesen);
  await kontext.schreibe(
    `select app.protokolliere('recruiting.kandidat_vorgeschlagen', 'kandidat', $1, null,
                              $2::jsonb, app.aktiver_mandant())`,
    [id, { quelle_art: 'agent', bewerbung_id: bewerbungId, aufgabe_id: aufgabeId }]);
  return id;
}
