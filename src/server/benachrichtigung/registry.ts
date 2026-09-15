/**
 * Die Benachrichtigungsarten (NOT-01, NOT-03).
 *
 * Eine Art ist REGISTRIERT, und die Registrierung verlangt drei Dinge, die
 * jede fuer sich einen Ausfall verhindern:
 *
 *  - **Titel und Text auf Deutsch.** Eine Benachrichtigung ohne Text ist eine
 *    leere Zeile im Posteingang, die niemand deuten kann.
 *  - **Ein Zielaufloeser.** NOT-03: eine Benachrichtigung, die nirgendwohin
 *    fuehrt, ist eine Mitteilung ueber ein Problem, das man nicht ansehen
 *    kann. Deshalb scheitert sie bei der ERZEUGUNG, nicht beim Klick.
 *  - **Ob sie sammelbar ist.** Eine Freigabeanfrage darf nie in einer
 *    Tageszusammenfassung untergehen: Invariante 7 haengt daran, dass jemand
 *    sie sieht, solange sie noch etwas aendert.
 */

export type Kanal = 'app' | 'email';

export interface BenachrichtigungsKontext {
  readonly mandantId: string;
  /**
   * Der Slug der Gesellschaft — das Segment `[mandant]` eines Portalpfads.
   *
   * `mandantId` ist die Kennung, und `slugTor()` vergleicht das Pfadsegment
   * mit dem Slug: ein Ziel aus der Kennung fuehrte auf 404 (Copilot-Befund
   * PR 12). Wer ein Ziel im Bereich baut, braucht den Slug; wer ihn nicht
   * hat, liefert `null` — kein Ziel ist ehrlicher als ein totes.
   */
  readonly mandantSlug?: string | null;
  readonly objektTyp: string;
  readonly objektId: string;
  readonly daten: Record<string, unknown>;
}

export interface ArtDefinition {
  readonly schluessel: string;
  /** Deutsch. Der Posteingang ist intern; Arbeiterportale uebersetzen. */
  readonly titel: (k: BenachrichtigungsKontext) => string;
  readonly text: (k: BenachrichtigungsKontext) => string;
  /** Muss einen Pfad liefern, oder `null`, wenn das Ziel nicht existiert. */
  readonly ziel: (k: BenachrichtigungsKontext) => string | null;
  /** Vorgabekanaele. Der Benutzer darf sie je Art aendern (NOT-02). */
  readonly kanaeleVorgabe: readonly Kanal[];
  /**
   * Darf sie in eine Zusammenfassung? Freigaben nie — siehe oben.
   */
  readonly sammelbar: boolean;
}

export class ArtFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'ArtFehler'; }
}

const ARTEN = new Map<string, ArtDefinition>();

export function registriereArt(art: ArtDefinition): ArtDefinition {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u.test(art.schluessel)) {
    throw new ArtFehler(
      `Ungueltiger Artschluessel "${art.schluessel}" — erwartet <modul>.<ereignis>.`,
    );
  }
  if (ARTEN.has(art.schluessel)) {
    throw new ArtFehler(`Art ${art.schluessel} ist bereits registriert.`);
  }
  if (art.kanaeleVorgabe.length === 0) {
    throw new ArtFehler(
      `Art ${art.schluessel} hat keinen Vorgabekanal — sie erreichte niemanden.`,
    );
  }
  ARTEN.set(art.schluessel, art);
  return art;
}

/**
 * Registriert eine Gruppe von Arten — **je Schluessel, nicht ueber einen
 * Stellvertreter**.
 *
 * Die Module registrieren ihre Arten buendelweise und muessen das mehrfach
 * koennen: der Jobbootstrap laeuft im Test mehrfach, und seit NOT-02 meldet
 * `benachrichtigung/bootstrap.ts` alle Arten an, um sie auf der
 * Einstellungsseite aufzaehlen zu koennen. Die naheliegende Abkuerzung war,
 * EINE Art zu pruefen und aus ihr auf die uebrigen zu schliessen. Das haelt
 * nur, solange die Gruppe immer vollstaendig ankommt — und sie kommt nicht
 * vollstaendig an, sobald ein Aufruf mittendrin abbricht oder ein Modul eine
 * Art spaeter dazunimmt:
 *
 *  - Beim Stellvertreter-vorhanden-Zweig faellt die fehlende Art still unter
 *    den Tisch. Sie ist dann nie registriert, und `erzeuge` wirft erst, wenn
 *    sie jemand ausloest — nachts, im Waechter, ohne Zuschauer.
 *  - Beim Stellvertreter-fehlt-Zweig wird die Gruppe komplett neu angemeldet,
 *    und `registriereArt` wirft ueber der bereits vorhandenen Schwester. Aus
 *    einer halb registrierten Gruppe wird ein Fehler bei jedem Seitenaufruf.
 *
 * Je Schluessel zu pruefen kostet einen Map-Zugriff und kennt beide Faelle
 * nicht. `registriereArt` bleibt streng — zwei DEFINITIONEN derselben Art
 * sind weiterhin ein Fehler; hier wird dieselbe Definition nur nicht zweimal
 * angemeldet (D-493).
 */
export function sicherRegistriert(
  definitionen: readonly ArtDefinition[],
): readonly ArtDefinition[] {
  return definitionen.map((d) => {
    const da = findeArt(d.schluessel);
    if (da === undefined) return registriereArt(d);
    if (!gleicheDefinition(da, d)) {
      throw new ArtFehler(
        `Art ${d.schluessel} ist mit einer ANDEREN Definition registriert. `
        + 'Zwei Module, die sich denselben Schluessel teilen, haengen sonst von der '
        + 'Reihenfolge des Bootstraps ab: derselbe Posteingangseintrag traegt mal den '
        + 'einen, mal den anderen Text.',
      );
    }
    return da;
  });
}

/**
 * Sind das dieselbe Art oder zwei?
 *
 * **Eine Art ist nicht nur ihr Schluessel.** `sicherRegistriert` darf einen
 * zweiten Aufruf DESSELBEN Moduls durchwinken, aber nicht ein zweites Modul,
 * das denselben Schluessel mit anderem Text, anderem Ziel oder anderen
 * Kanaelen belegt — sonst haengt am Ende von der Reihenfolge des Bootstraps
 * ab, was jemand im Posteingang liest.
 *
 * Verglichen wird auch der QUELLTEXT der drei Funktionen. Zwei Closures sind
 * nie `===`, weil jeder Aufruf neue erzeugt; ihr Text ist aber bei demselben
 * Modul derselbe und bei zwei Modulen praktisch nie. Das ist keine
 * Gleichheit im mathematischen Sinn und soll es nicht sein: es ist die
 * Pruefung, die den Fall faengt, um den es geht.
 */
function gleicheDefinition(a: ArtDefinition, b: ArtDefinition): boolean {
  return a.sammelbar === b.sammelbar
    && a.kanaeleVorgabe.length === b.kanaeleVorgabe.length
    && a.kanaeleVorgabe.every((k, i) => k === b.kanaeleVorgabe[i])
    && String(a.titel) === String(b.titel)
    && String(a.text) === String(b.text)
    && String(a.ziel) === String(b.ziel);
}

export function arten(): readonly ArtDefinition[] { return [...ARTEN.values()]; }
export function findeArt(schluessel: string): ArtDefinition | undefined {
  return ARTEN.get(schluessel);
}
export function leereArten(): void { ARTEN.clear(); }

export class ZielFehler extends Error {
  constructor(schluessel: string) {
    super(
      `Die Benachrichtigung ${schluessel} hat kein aufloesbares Ziel (NOT-03). `
      + 'Eine Mitteilung, die nirgendwohin fuehrt, ist eine ueber ein Problem, '
      + 'das man nicht ansehen kann.',
    );
    this.name = 'ZielFehler';
  }
}

export interface ErzeugteBenachrichtigung {
  readonly art: string;
  readonly mandantId: string;
  readonly titel: string;
  readonly text: string;
  readonly ziel: string;
  readonly kanaele: readonly Kanal[];
  readonly sammelbar: boolean;
}

/** Was ein Benutzer je Art eingestellt hat (NOT-02). */
export interface KanalPraeferenz {
  readonly [art: string]: readonly Kanal[] | undefined;
}

/**
 * Baut eine Benachrichtigung — und scheitert, wenn sie nirgendwohin fuehrt.
 *
 * Die Praeferenz wird HIER angewandt, in derselben Anfrage: NOT-02 verlangt,
 * dass ein Abschalten sofort wirkt und nicht erst beim naechsten Neustart
 * eines Versandprozesses.
 */
export function erzeuge(
  schluessel: string,
  kontext: BenachrichtigungsKontext,
  praeferenz: KanalPraeferenz = {},
): ErzeugteBenachrichtigung {
  const art = findeArt(schluessel);
  if (art === undefined) {
    throw new ArtFehler(`Unbekannte Benachrichtigungsart ${schluessel}.`);
  }
  const ziel = art.ziel(kontext);
  if (ziel === null || ziel === '') throw new ZielFehler(schluessel);

  const gewuenscht = praeferenz[schluessel] ?? art.kanaeleVorgabe;
  return {
    art: schluessel,
    mandantId: kontext.mandantId,
    titel: art.titel(kontext),
    text: art.text(kontext),
    ziel,
    // Der In-App-Posteingang laesst sich nicht abschalten: er ist das
    // Protokoll dessen, was jemandem mitgeteilt wurde. Abgeschaltet wird der
    // PUSH nach draussen, nicht der Eintrag.
    kanaele: [...new Set<Kanal>(['app', ...gewuenscht.filter((k) => k !== 'app')])],
    sammelbar: art.sammelbar,
  };
}

/**
 * Teilt in "sofort" und "sammelbar".
 *
 * Eine Freigabeanfrage geht nie in die Sammlung — sie ist der Fall, in dem
 * Warten dieselbe Wirkung hat wie Nichtstun.
 */
export function teileFuerZusammenfassung(
  benachrichtigungen: readonly ErzeugteBenachrichtigung[],
): { sofort: readonly ErzeugteBenachrichtigung[]; sammlung: readonly ErzeugteBenachrichtigung[] } {
  return {
    sofort: benachrichtigungen.filter((b) => !b.sammelbar),
    sammlung: benachrichtigungen.filter((b) => b.sammelbar),
  };
}
