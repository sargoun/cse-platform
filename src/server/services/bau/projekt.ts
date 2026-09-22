import type { SchreibKontext } from '../../kontext/index.js';

/**
 * Ein Bauprojekt anlegen, ändern und archivieren (V-003, OPS-05, BAU-01).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Ein Projekt ist kein eigener Vorgang — es ist ein Auftrag mit Bauakte.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `projekt_auftrag_uk` sagt es als Zwangsbedingung: **genau ein Projekt je
 * Auftrag.** Daraus folgt alles Weitere:
 *
 *  - **Der Auftrag wird GEWÄHLT, nie erfunden.** Es gibt keinen Weg, der
 *    beides in einem Schritt anlegt: ein Bauvorhaben ohne kaufmännischen
 *    Auftrag wäre eine Baustelle ohne Vertrag.
 *  - **Kunde und Objekt kommen aus dem Auftrag**, nicht aus dem Formular.
 *    `projekt.kunde_id` ist `not null` und zeigt auf dieselbe Gesellschaft;
 *    ein zweites Feld daneben liesse zu, dass beide auseinanderlaufen — und
 *    das fiele erst auf der Rechnung auf.
 *  - **Die Nummer IST die Auftragsnummer.** Sie kommt damit aus dem
 *    bestätigten Nummernkreis `auftrag` (FIN-03) und nicht aus einem
 *    erfundenen Format.
 *
 * // TODO(client, O-351): Nach welchem Schlüssel werden Bauprojekte
 * nummeriert — ein eigener Kreis je Gesellschaft, die Auftragsnummer oder
 * eine Bauvorhabenskennung des Auftraggebers? Solange das offen ist, nimmt
 * diese Funktion die Auftragsnummer: sie erfindet am wenigsten. Ein
 * ausgedachtes „BV-2026-001" sähe aus wie ein bestätigter Nummernkreis und
 * wäre keiner. Dieselbe Entscheidung steht im Seed (`db/seed/bau.ts`).
 *
 * **Die Vertragsgrundlage ist eine Wahl mit Folgen und keine Voreinstellung.**
 * `vob_b` und `bgb` unterscheiden Fristen, Abnahme, Mängelrechte und den
 * Umgang mit Nachträgen (§ 2 VOB/B gegen § 631 BGB). Diese Funktion setzt
 * deshalb keinen Vorgabewert — wer das Feld nicht füllt, bekommt eine
 * Abweisung und keine stille Annahme.
 */

export class ProjektFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'ProjektFehler';
  }
}

export const PROJEKT_ARTEN = ['hochbau', 'ausbau', 'rueckbau'] as const;
export type ProjektArt = (typeof PROJEKT_ARTEN)[number];

export const VERTRAGSGRUNDLAGEN = ['vob_b', 'bgb'] as const;
export type Vertragsgrundlage = (typeof VERTRAGSGRUNDLAGEN)[number];

export const PROJEKT_ZUSTAENDE = [
  'geplant', 'in_arbeit', 'abgenommen', 'abgeschlossen', 'archiviert',
] as const;
export type ProjektZustand = (typeof PROJEKT_ZUSTAENDE)[number];

export interface NeuesProjekt {
  readonly auftragId: string;
  readonly bezeichnung: string;
  readonly art: string;
  readonly vertragsgrundlage: string;
  readonly sollBeginn?: string | undefined;
  readonly sollEnde?: string | undefined;
  readonly verantwortlichBenutzerId?: string | undefined;
  /** Basispunkte (0…10000) — 5 % sind `500`, nie `0.05`. */
  readonly sicherheitseinbehaltBp?: string | undefined;
  /** Ganze Cent als Text — nie eine Gleitkommazahl (Invariante 1). */
  readonly auftragssummeNettoCent?: string | undefined;
}

function leer(wert: string | undefined): string | null {
  const t = wert?.trim() ?? '';
  return t === '' ? null : t;
}

function pruefeArt(wert: string): ProjektArt {
  const t = wert.trim();
  if ((PROJEKT_ARTEN as readonly string[]).includes(t)) return t as ProjektArt;
  throw new ProjektFehler(
    'Die Art eines Bauvorhabens ist Hochbau, Ausbau oder Rückbau.', 'art_unbekannt');
}

function pruefeGrundlage(wert: string): Vertragsgrundlage {
  const t = wert.trim();
  if ((VERTRAGSGRUNDLAGEN as readonly string[]).includes(t)) return t as Vertragsgrundlage;
  throw new ProjektFehler(
    'Die Vertragsgrundlage ist VOB/B oder BGB — sie entscheidet über Fristen, '
    + 'Abnahme und Nachträge und wird deshalb nicht vorbelegt.',
    'vertragsgrundlage_fehlt');
}

/**
 * Basispunkte: `500` sind fünf Prozent.
 *
 * Die Spalte heisst `_bp` und die Zwangsbedingung lässt 0…10000 zu. Wer „5"
 * eingibt, meint fast sicher fünf Prozent — die Zahl aber ist dann 0,05 %.
 * Diese Funktion deutet **nichts** um: sie nimmt, was dasteht, und weist
 * ausserhalb des Bereichs ab. Die Umrechnung gehört ins Formular, wo sie
 * sichtbar ist, nicht hierher, wo sie geraten wäre.
 */
function pruefeEinbehalt(wert: string | undefined): string | null {
  const t = leer(wert);
  if (t === null) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n > 10000) {
    throw new ProjektFehler(
      'Der Sicherheitseinbehalt steht in Basispunkten: 500 sind fünf Prozent. '
      + 'Erlaubt ist eine ganze Zahl von 0 bis 10000.',
      'einbehalt_ungueltig');
  }
  return String(n);
}

/** Geld ist ganzzahlig (Invariante 1) — kein `Number` mit Nachkommastelle. */
function pruefeCent(wert: string | undefined): string | null {
  const t = leer(wert);
  if (t === null) return null;
  if (!/^-?\d+$/u.test(t)) {
    throw new ProjektFehler(
      'Die Auftragssumme steht in ganzen Cent — 12.345,67 € sind 1234567.',
      'summe_ungueltig');
  }
  return t;
}

interface AuftragKopf {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly kunde_id: string;
  readonly objekt_id: string | null;
  readonly hat_projekt: boolean;
}

/**
 * Die Aufträge, aus denen ein Bauprojekt werden kann.
 *
 * **Nicht jeder Auftrag taugt dazu, und die Liste sagt warum.** Ein Auftrag,
 * an dem schon ein Projekt hängt, fällt heraus (`projekt_auftrag_uk`); ein
 * stornierter ebenso. `art = 'projekt'` steht NICHT in der Bedingung: die
 * Auftragsart ist eine kaufmännische Einordnung, und einen laufenden
 * Einzelauftrag um eine Bauakte zu ergänzen ist ein Vorgang, der vorkommt.
 */
export async function auftraegeOhneProjekt(
  kontext: { abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]> },
): Promise<readonly AuftragKopf[]> {
  return kontext.abfrage<AuftragKopf>(
    `select a.id, a.auftragsnummer, a.bezeichnung, a.kunde_id, a.objekt_id,
            exists (select 1 from projekt p where p.auftrag_id = a.id) as hat_projekt
       from auftrag a
      where a.status <> 'storniert'
        and not exists (select 1 from projekt p where p.auftrag_id = a.id)
      order by a.auftragsnummer desc
      limit 300`,
  );
}

export async function legeProjektAn(
  kontext: SchreibKontext, eingabe: NeuesProjekt,
): Promise<{ readonly id: string; readonly nummer: string }> {
  const bezeichnung = eingabe.bezeichnung.trim();
  if (bezeichnung === '') {
    throw new ProjektFehler('Ein Bauvorhaben braucht eine Bezeichnung.', 'bezeichnung_fehlt');
  }
  if (eingabe.auftragId.trim() === '') {
    throw new ProjektFehler(
      'Ein Bauprojekt ist die Bauakte eines Auftrags — bitte den Auftrag wählen.',
      'auftrag_fehlt');
  }
  const art = pruefeArt(eingabe.art);
  const grundlage = pruefeGrundlage(eingabe.vertragsgrundlage);
  const einbehalt = pruefeEinbehalt(eingabe.sicherheitseinbehaltBp);
  const summe = pruefeCent(eingabe.auftragssummeNettoCent);

  /*
   * Der Auftrag wird GELESEN, nicht geglaubt: Kunde, Objekt und Nummer kommen
   * aus seiner Zeile. Unter RLS sieht diese Abfrage nur Auftraege der aktiven
   * Gesellschaft — eine fremde Kennung liefert damit keine Zeile und keine
   * Auskunft darueber, dass es sie anderswo gibt (AUT-06).
   */
  const [auftrag] = await kontext.abfrage<AuftragKopf>(
    `select a.id, a.auftragsnummer, a.bezeichnung, a.kunde_id, a.objekt_id,
            exists (select 1 from projekt p where p.auftrag_id = a.id) as hat_projekt
       from auftrag a
      where a.id = $1::uuid`,
    [eingabe.auftragId],
  );
  if (auftrag === undefined) {
    throw new ProjektFehler(
      'Diesen Auftrag gibt es in dieser Gesellschaft nicht.', 'auftrag_unbekannt', 404);
  }
  if (auftrag.hat_projekt) {
    throw new ProjektFehler(
      `Zu ${auftrag.auftragsnummer} gibt es bereits ein Bauprojekt. Ein Auftrag `
      + 'trägt genau eine Bauakte; ein zweites Vorhaben braucht einen zweiten Auftrag.',
      'projekt_vorhanden', 409);
  }

  const zeilen = await kontext.schreibe<{ id: string; nummer: string }>(
    `insert into projekt
       (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, objekt_id,
        art, vertragsgrundlage, verantwortlich_benutzer_id,
        soll_beginn, soll_ende, sicherheitseinbehalt_bp, auftragssumme_netto_cent,
        erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2, $3, $4::uuid, $5::uuid,
             $6::projekt_art, $7::bau_vertragsgrundlage, $8::uuid,
             $9::date, $10::date, $11::int, $12::bigint,
             app.aktueller_benutzer())
     returning id, nummer`,
    [auftrag.id, auftrag.auftragsnummer, bezeichnung, auftrag.kunde_id, auftrag.objekt_id,
      art, grundlage, leer(eingabe.verantwortlichBenutzerId),
      leer(eingabe.sollBeginn), leer(eingabe.sollEnde), einbehalt, summe],
  );
  const z = zeilen[0];
  if (z === undefined) {
    throw new ProjektFehler(
      'Das Bauprojekt wurde nicht angelegt — halten Sie bau.schreiben in dieser '
      + 'Gesellschaft?', 'nicht_angelegt', 403);
  }
  return z;
}

/**
 * Ein Bauprojekt ändern.
 *
 * **Auftrag, Nummer und Kunde stehen nicht darin.** Der Auftrag ist die
 * Identität des Projekts (`projekt_auftrag_uk`), die Nummer steht auf jedem
 * Aufmassblatt und jeder Nachtragsanmeldung, und der Kunde folgt dem Auftrag.
 * Wer den Auftrag wechseln will, legt ein Projekt am richtigen Auftrag an —
 * ein Umhängen machte aus jedem bereits unterschriebenen Aufmass eine Zeile
 * unter einem fremden Vertrag.
 */
export async function aendereProjekt(
  kontext: SchreibKontext,
  eingabe: {
    readonly id: string;
    readonly bezeichnung: string;
    readonly art: string;
    readonly vertragsgrundlage: string;
    readonly status?: string | undefined;
    readonly sollBeginn?: string | undefined;
    readonly sollEnde?: string | undefined;
    readonly istBeginn?: string | undefined;
    readonly istEnde?: string | undefined;
    readonly verantwortlichBenutzerId?: string | undefined;
    readonly sicherheitseinbehaltBp?: string | undefined;
    readonly auftragssummeNettoCent?: string | undefined;
    readonly gewaehrleistungBis?: string | undefined;
  },
): Promise<void> {
  const bezeichnung = eingabe.bezeichnung.trim();
  if (bezeichnung === '') {
    throw new ProjektFehler('Ein Bauvorhaben braucht eine Bezeichnung.', 'bezeichnung_fehlt');
  }
  const art = pruefeArt(eingabe.art);
  const grundlage = pruefeGrundlage(eingabe.vertragsgrundlage);
  const zustandRoh = leer(eingabe.status);
  if (zustandRoh !== null && !(PROJEKT_ZUSTAENDE as readonly string[]).includes(zustandRoh)) {
    throw new ProjektFehler('Diesen Projektzustand gibt es nicht.', 'status_unbekannt');
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update projekt
        set bezeichnung = $2,
            art = $3::projekt_art,
            vertragsgrundlage = $4::bau_vertragsgrundlage,
            status = coalesce($5::projekt_status, status),
            verantwortlich_benutzer_id = $6::uuid,
            soll_beginn = $7::date, soll_ende = $8::date,
            ist_beginn = $9::date, ist_ende = $10::date,
            sicherheitseinbehalt_bp = $11::int,
            auftragssumme_netto_cent = $12::bigint,
            gewaehrleistung_bis = $13::date,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and archiviert_am is null
     returning id`,
    [eingabe.id, bezeichnung, art, grundlage, zustandRoh,
      leer(eingabe.verantwortlichBenutzerId),
      leer(eingabe.sollBeginn), leer(eingabe.sollEnde),
      leer(eingabe.istBeginn), leer(eingabe.istEnde),
      pruefeEinbehalt(eingabe.sicherheitseinbehaltBp),
      pruefeCent(eingabe.auftragssummeNettoCent),
      leer(eingabe.gewaehrleistungBis)],
  );
  if (zeilen[0] === undefined) {
    throw new ProjektFehler(
      'Dieses Bauprojekt gibt es in dieser Gesellschaft nicht, oder es ist archiviert.',
      'projekt_unbekannt', 404);
  }
}

/**
 * Ein Bauprojekt archivieren.
 *
 * **Gelöscht wird nichts** (Invariante 8): am Projekt hängen
 * Leistungsverzeichnis, Aufmassblätter, Nachträge, Bautagebuch und Abnahme —
 * und die Gewährleistung läuft nach dem letzten Arbeitstag noch jahrelang
 * weiter. `projekt_archiv_paarweise` verlangt beide Stempel zusammen.
 *
 * **Ein Projekt mit offenen Nachträgen wird zurückgewiesen.** Offen sind die
 * drei Zustände vor der Entscheidung — `angemeldet`, `kalkuliert`,
 * `eingereicht`. Ein Nachtrag darin ist eine Forderung, über die noch nicht
 * entschieden ist; das Vorhaben aus der Liste zu nehmen, hiesse, sie aus dem
 * Blick zu nehmen. `beauftragt`, `abgelehnt` und `zurueckgezogen` sind
 * entschieden und halten nichts auf.
 */
export async function archiviereProjekt(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const [offen] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl
       from nachtrag
      where projekt_id = $1::uuid
        and status in ('angemeldet', 'kalkuliert', 'eingereicht')`,
    [id],
  );
  if (offen !== undefined && offen.anzahl !== '0') {
    throw new ProjektFehler(
      `Dieses Bauvorhaben hat ${offen.anzahl} offene(n) Nachtrag/Nachträge. `
      + 'Über eine angemeldete Forderung ist zu entscheiden, bevor das Vorhaben '
      + 'aus der Liste verschwindet.',
      'nachtraege_offen', 409);
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update projekt
        set archiviert_am = now(), archiviert_von = app.aktueller_benutzer(),
            status = 'archiviert',
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and archiviert_am is null
     returning id`,
    [id],
  );
  if (zeilen[0] === undefined) {
    throw new ProjektFehler(
      'Dieses Bauprojekt gibt es nicht mehr, oder es ist bereits archiviert.',
      'projekt_unbekannt', 404);
  }
}
