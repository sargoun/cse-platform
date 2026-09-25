import type { ReactNode } from 'react';
import { Geraetezeit } from './Geraetezeit';
import Link, { type LinkProps } from 'next/link';
import { AreaBadge } from '@/components/ui/AreaBadge';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Icon } from '@/components/ui/Icon';
import { stundenMinutenText } from '@/lib/datum/stunden';
import type { BereichSchluessel } from '@/lib/design/theme';
import type { MeinTexte, PortalSprache } from '@/lib/i18n/texte';
import type { EigeneSchicht } from '@/server/services/mitarbeiter/schichten';
import type { OffenerEintrag } from '@/server/services/mitarbeiter/stempeluhr';
import { Button } from '@/components/ui/Button';
import { Laufzeit } from './Laufzeit';

/**
 * Die wiederkehrenden Bausteine der Arbeiterseiten.
 *
 * **Hier wird kein Bauteil ERFUNDEN.** DESIGN §12: „No component invented ad
 * hoc — extend this file first." Was hier steht, ist Zusammensetzung aus dem,
 * was `src/components/**` schon hat — `AreaBadge`, `StatusPill`, `Icon` — plus
 * Abstands- und Farbklassen aus dem Thema. Kein Hex, keine eigene Groesse,
 * kein neuer Zustand: `StatusPill` nimmt nur sein festes Vokabular, und was
 * sich darauf nicht abbilden laesst, steht als Text daneben statt als
 * erfundene Pille.
 *
 * Die Datei liegt bei den Seiten und nicht in `components/`, weil sie genau
 * diesen Seiten gehoert: ein `SchichtKarte` ausserhalb des Mitarbeiterportals
 * gibt es nicht.
 */

const BEREICHE = new Set<string>(['reinigung', 'security', 'bau', 'operations']);

/**
 * Die Gesellschaft einer Zeile — als NAME, nicht als Farbe (DESIGN §9).
 *
 * Ein unbekannter Slug faellt auf den Klartextnamen zurueck, statt gar nichts
 * zu zeigen: eine Zeile ohne Gesellschaft waere in einem Portal, das zwei
 * Arbeitsverhaeltnisse nebeneinander fuehrt, unbrauchbar (EMP-14).
 */
export function Gesellschaft({
  slug, name,
}: { readonly slug: string; readonly name: string }) {
  if (BEREICHE.has(slug)) {
    return (
      <span data-cse="gesellschaft" data-mandant={slug}>
        <AreaBadge bereich={slug as BereichSchluessel} />
      </span>
    );
  }
  return (
    <span data-cse="gesellschaft" data-mandant={slug} className="text-sm text-text">
      {name}
    </span>
  );
}

/** Eine Beschriftung mit ihrem Wert — die Grundform jeder Detailzeile. */
export function Feld({
  label, children,
}: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-base text-text">{children}</dd>
    </div>
  );
}

/** Ein Block aus `Feld`-Zeilen. 16px Fliesstext, auch auf dem Telefon (§8). */
export function Felder({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s4 gap-y-s2">{children}</dl>
  );
}

/**
 * Eine Schicht als Karte.
 *
 * Die Uhrzeiten kommen fertig aus der Datenbank, in Berliner Ortszeit
 * (Invariante 2). Das `+1` hinter dem Ende ist kein Schmuck: ohne es laese
 * sich `22:00 – 06:00` wie sechs Stunden rueckwaerts.
 */
export function SchichtKarte({
  schicht, texte, sprache, alsLink = true,
}: {
  readonly schicht: EigeneSchicht;
  readonly texte: MeinTexte;
  /**
   * **Die Sprache steht NEBEN den Texten, nicht in ihnen.** `MeinTexte` ist
   * eine Tabelle fertiger Woerter und traegt nicht, aus welcher Sprache sie
   * stammt — die Pille braucht aber den Schluessel selbst, weil ihr `zustand`
   * deutsch bleiben muss (er waehlt die Farbe, DESIGN §5) und nur die
   * Beschriftung wechselt.
   */
  readonly sprache: PortalSprache;
  readonly alsLink?: boolean;
}) {
  const zeitanomalie = schicht.zeitanomalie === 'dst_luecke' || schicht.zeitanomalie === 'dst_doppelt'
    ? texte.zeitanomalie[schicht.zeitanomalie] : undefined;
  const inhalt = (
    <>
      <div className="mb-s3 flex flex-wrap items-center gap-s3">
        <Gesellschaft slug={schicht.mandantSlug} name={schicht.mandantName} />
        <StatusPill zustand={schichtPille(schicht)} sprache={sprache} />
        {/*
          Der Tag der Zeitumstellung in der Sprache der Person (V-195). Hier
          stand ein deutsches Wort in einem Ternär — die Übersetzungswache sah
          es nicht, und die Kraft las in jeder Sprache „23-Stunden-Tag".
        */}
        {zeitanomalie !== undefined && (
          <span data-cse="zeitanomalie" data-art={schicht.zeitanomalie}
                className="text-base text-warning">
            <Icon name="warnung" groesse="sm" className="inline-block align-[-2px]" />{' '}
            {zeitanomalie}
          </span>
        )}
      </div>
      <Felder>
        <Feld label={texte.objekt}>{schicht.objekt ?? '—'}</Feld>
        <Feld label={texte.beginn}>
          <span className="cse-zahl">{schicht.beginnLokal}</span>
        </Feld>
        <Feld label={texte.ende}>
          <span className="cse-zahl">{schicht.endeLokal}</span>
          {schicht.endetAmFolgetag && (
            <span data-cse="folgetag" className="ms-s2 text-sm text-text-muted">+1</span>
          )}
        </Feld>
        <Feld label={texte.dauer}>
          <span className="cse-zahl">{stundenMinutenText(schicht.dauerMinuten)}</span>
        </Feld>
      </Felder>
    </>
  );

  const klassen = 'block rounded-lg border border-line bg-surface p-s4 no-underline';
  return alsLink ? (
    <Link
      href={`/portal/mein/schichten/${schicht.zuordnungId}`}
      data-cse="schicht"
      data-mandant={schicht.mandantSlug}
      className={`${klassen} transition-colors duration-fast hover:bg-surface-2`}
    >
      {inhalt}
    </Link>
  ) : (
    <div data-cse="schicht" data-mandant={schicht.mandantSlug} className={klassen}>
      {inhalt}
    </div>
  );
}

/**
 * Der Zustand einer Schicht auf das feste Pillenvokabular abgebildet
 * (DESIGN §5).
 *
 * Abgebildet und nicht erfunden: `StatusPill` laesst eine unbekannte
 * Beschriftung gar nicht erst zu, und das ist der Sinn — eine Seite soll
 * keinen Zustand zeigen, den der Rest der Plattform nicht kennt.
 */
function schichtPille(s: EigeneSchicht): PillZustand {
  if (s.status === 'abgesagt') return 'Abgelehnt';
  if (s.status === 'nicht_erschienen') return 'Fehler';
  if (s.einsatzStatus === 'storniert') return 'Archiviert';
  if (s.einsatzStatus === 'abgeschlossen') return 'Abgeschlossen';
  if (s.laeuftJetzt) return 'In Arbeit';
  if (s.status === 'zugesagt') return 'Bereit';
  return 'Geplant';
}

/** „Nichts da" als Satz, nicht als leere Flaeche. */
export function Leer({ text }: { readonly text: string }) {
  return (
    <p data-cse="leer" className="m-0 text-base text-text-muted">{text}</p>
  );
}

/**
 * Der Satz, der sagt, WARUM hier nichts zu tun ist.
 *
 * Er ist ausdruecklich kein `Leer`: „keine Eintraege" und „diese Schicht ist
 * beendet" sind zwei verschiedene Aussagen, und die erste an der Stelle der
 * zweiten ist eine Falschauskunft — dieselbe, gegen die 0302 das
 * Uebergabefenster ausformuliert hat (O-151). Ueberall dort, wo ein Formular
 * WEGGELASSEN wird, steht dieser Satz an seiner Stelle.
 */
export function Hinweis(
  { text, marke = 'hinweis' }: { readonly text: string; readonly marke?: string },
) {
  return (
    <p data-cse={marke} className="m-0 mb-s4 max-w-prose text-base text-warning">
      {text}
    </p>
  );
}

/**
 * Die Stempeluhr auf „Heute" — ein Knopf, und er sagt, was er tut
 * (D-618, O-93, TIM-07, Invariante 5, DESIGN §5).
 *
 * **Drei Zustaende, und nur einer davon zeigt einen Knopf, der nichts tut.**
 *
 *   laeuft         -> „Arbeit beenden" + Zaehler
 *   Schicht offen  -> „Arbeit beginnen"
 *   sonst          -> ein Satz, warum gerade kein Knopf dasteht
 *
 * Der dritte Fall ist der wichtige. Ein ausgegrauter Knopf sagt „nicht
 * jetzt" und laesst offen, ob es an der Anmeldung, am Recht oder am Zustand
 * liegt; der Mensch drueckt und lernt nichts. Der Satz sagt stattdessen, was
 * der Fall IST und wann sich das aendert — dieselbe Entscheidung wie beim
 * `Offen`-Baustein weiter oben.
 *
 * **Ein gewoehnliches Formular, kein Skript.** Der Knopf funktioniert ohne
 * JavaScript: im Treppenhaus, auf einem alten Telefon, bei schlechtem Netz.
 * Genau dafuer ist die Stempeluhr gebaut. Der Zaehler daneben ist ein
 * Client-Baustein und darf ausfallen — dann steht dort die Startzeit.
 *
 * **Die Geraetezeit wandert in ein verstecktes Feld**, das ein winziges
 * Skript fuellt. Sie dokumentiert die Abweichung (Invariante 5) und
 * entscheidet nichts; fehlt sie, gilt der Stempel trotzdem.
 */
export function StempelUhr({
  offen, schicht, texte, meldung,
}: {
  readonly offen: OffenerEintrag | null;
  readonly schicht: EigeneSchicht | null;
  readonly texte: MeinTexte;
  readonly meldung: string | null;
}) {
  const u = texte.stempeluhr;
  /*
   * Gestempelt werden kann nur in eine Schicht, die JETZT laeuft und nicht
   * aus dem Plan genommen wurde. `ct_fenster_ableiten` (0035) laesst eine
   * Toleranz von ±1 h zu; der Knopf richtet sich nach `laeuftJetzt`, und die
   * Datenbank bleibt die Instanz, die das Fenster wirklich durchsetzt.
   */
  const stempelbar = schicht !== null && schicht.laeuftJetzt
    && !schicht.beendet && !schicht.entfernt;

  const SAETZE: Readonly<Record<string, string>> = {
    eingecheckt: u.eingecheckt, ausgecheckt: u.ausgecheckt,
    abgelehnt: u.abgelehnt, schon_offen: u.schonOffen,
  };
  const satz = meldung === null ? null : SAETZE[meldung] ?? null;

  return (
    <section data-cse="stempeluhr"
             className="mb-s5 flex flex-col gap-s3 rounded-lg border border-line
                        bg-surface p-s4">
      <h2 className="m-0 text-h3 text-text">{u.titel}</h2>

      {satz !== null && (
        <p data-cse="stempel-meldung" className="m-0 text-base text-text-muted">{satz}</p>
      )}

      {offen !== null ? (
        <>
          <Laufzeit beginnIso={offen.beginnIso} serverIso={offen.serverIso}
                    label={u.laeuftSeit} />
          <p className="m-0 text-base text-text-muted">
            {u.seit} <span className="cse-zahl">{offen.beginnLokal}</span>
            {offen.objekt === null ? '' : ` · ${offen.objekt}`}
          </p>
          {offen.zuordnungId !== null && (
            <StempelKnopf zuordnungId={offen.zuordnungId} zweck="checkout"
                          text={u.beenden} />
          )}
        </>
      ) : stempelbar ? (
        <StempelKnopf zuordnungId={schicht.zuordnungId} zweck="checkin"
                      text={u.beginnen} />
      ) : (
        <p data-cse="stempel-keine-schicht" className="m-0 text-base text-text-muted">
          {u.keineSchichtJetzt}
        </p>
      )}

      <p className="m-0 text-base text-text-subtle">{u.serverUhrHinweis}</p>
    </section>
  );
}

/**
 * Der Knopf selbst — ein Formular mit einem Ziel und einem Feld.
 *
 * `min-h-16` statt der ueblichen 44px: DESIGN §9 nennt 44 als MINDESTmass,
 * und dies ist der eine Knopf, den jemand mit Handschuhen im Halbdunkel
 * trifft. Dieselbe Ueberlegung steht hinter dem einen Hauptknopf der
 * Token-Stempeluhr.
 */
function StempelKnopf({
  zuordnungId, zweck, text,
}: {
  readonly zuordnungId: string;
  readonly zweck: 'checkin' | 'checkout';
  readonly text: string;
}) {
  return (
    <form action="/api/mein/stempeluhr" method="post"
          data-cse={`stempeln-${zweck}`} className="m-0">
      <input type="hidden" name="zuordnung" value={zuordnungId} />
      <input type="hidden" name="zweck" value={zweck} />
      {/*
        * Die Geraetezeit — dokumentiert die Abweichung (Invariante 5) und
        * entscheidet nichts. Ohne JavaScript bleibt das Feld leer, und der
        * Stempel gilt genauso: die Erfassung darf nicht daran haengen, dass
        * ein Skript geladen hat.
        */}
      <Geraetezeit />
      <Button type="submit" variante={zweck === 'checkin' ? 'primary' : 'secondary'}
              className="min-h-16 w-full text-h3">
        {text}
      </Button>
    </form>
  );
}

/**
 * Zusagen und Absagen — die Antwort der Kraft auf ihre Einteilung
 * (V-049, V-050, D-622, EMP-02).
 *
 * **Der Befund, der diesen Baustein gebracht hat.** `zuordnung_status` kennt
 * `zugesagt` seit 0028, siebzehn Stellen LESEN den Wert — und es gab keinen
 * Knopf, der ihn setzt. Der Pillenzweig „Bereit" in `schichtPille` oben war
 * damit unerreichbarer Code, und die Besetzungswarnung, die ausdrücklich
 * ZUSAGEN zählt, meldete für jede Schicht null.
 *
 * **Zwei Formulare, nicht eines mit einem Umschalter.** Die Absage braucht
 * einen Grund, die Zusage nicht. Ein gemeinsames Formular müsste den
 * Grund-Zwang mit JavaScript ein- und ausschalten — und dieser Bildschirm
 * muss im Treppenhaus funktionieren, auf einem alten Telefon, ohne Skript.
 *
 * **`min-h-16` wie bei der Stempeluhr.** DESIGN §9 nennt 44px als
 * MINDESTmass; das hier sind Knöpfe, die jemand mit Handschuhen im
 * Halbdunkel trifft.
 *
 * **Die Absage steht optisch UNTER der Zusage und ist nie die auffälligste
 * Fläche.** Sie ist der seltenere Fall und die einzige Handlung hier, die
 * sich nicht zurücknehmen lässt (D-622) — der Satz darüber sagt das, bevor
 * jemand drückt, nicht danach.
 */
export function Zusagefeld({
  schicht, texte,
}: {
  readonly schicht: EigeneSchicht;
  readonly texte: MeinTexte;
}) {
  /*
   * Aus dem Plan genommen oder vorbei: keine Handlung mehr. Ein Formular
   * anzubieten, das die Datenbank danach abweist, ist schlechter als keines —
   * `t_selbst_m1` verlangt `entfernt_am is null`, und beide Funktionen aus
   * 0374 weisen eine beendete Schicht ab.
   */
  if (schicht.entfernt || schicht.beendet) return null;

  const feld = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 '
    + 'text-base text-text';

  if (schicht.status === 'abgesagt') {
    return (
      <section data-cse="zusage-abgesagt"
               className="mt-s4 rounded-lg border border-line bg-surface-2 p-s4">
        <p className="m-0 text-base text-text">{texte.abgesagtHinweis}</p>
        <p className="m-0 mt-s2 text-base text-text-muted">{texte.absageEndgueltig}</p>
      </section>
    );
  }

  if (schicht.status !== 'geplant' && schicht.status !== 'zugesagt') return null;

  const zugesagt = schicht.status === 'zugesagt';
  return (
    <section data-cse="zusagefeld" data-status={schicht.status}
             className="mt-s4 rounded-lg border border-line bg-surface p-s4">
      {zugesagt ? (
        <p className="m-0 mb-s4 text-base text-text" data-cse="zusage-bestaetigt">
          {texte.zugesagtHinweis}
        </p>
      ) : (
        <>
          <h2 className="mb-s4 mt-0 text-h3 text-text">{texte.zusageFrage}</h2>
          <form action="/api/mein/schicht" method="post"
                data-cse="schicht-zusagen" className="m-0 mb-s5">
            <input type="hidden" name="zuordnung" value={schicht.zuordnungId} />
            <input type="hidden" name="aktion" value="zusagen" />
            <Button type="submit" variante="primary"
                    className="min-h-16 w-full text-h3">
              {texte.zusagen}
            </Button>
          </form>
        </>
      )}

      <form action="/api/mein/schicht" method="post"
            data-cse="schicht-absagen" className="m-0 flex flex-col gap-s3">
        <input type="hidden" name="zuordnung" value={schicht.zuordnungId} />
        <input type="hidden" name="aktion" value="absagen" />
        <label className="flex flex-col gap-s2 text-base text-text">
          {texte.absageGrund}
          <textarea name="grund" rows={2} required className={feld}
                    data-cse="absage-grund" />
          <span className="text-base text-text-muted">{texte.absageGrundHinweis}</span>
        </label>
        <p className="m-0 text-base text-text-muted">{texte.absageEndgueltig}</p>
        <Button type="submit" variante="secondary" className="min-h-16 w-full">
          {texte.absagen}
        </Button>
      </form>
    </section>
  );
}

/**
 * Der Monatswechsler (V-053, EMP-03).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: drei Seiten lasen `?monat=`, eine erzeugte ihn.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `/portal/mein/zeiten` und `/portal/mein/monatsnachweis` werteten den
 * Parameter aus und boten kein Bedienelement, das ihn setzt — wer den
 * vorigen Monat sehen wollte, musste die Adresszeile tippen. Auf einem
 * Telefon ist das kein Umweg, sondern eine verschlossene Tür. Und genau
 * dieser Blick ist der, um den es geht: **die Abrechnung des LETZTEN Monats
 * prüft man, wenn der Lohn da ist** — also im nächsten.
 *
 * `/portal/mein/stundenkonto` hatte zwei nackte Pfeile mit einer Zahl
 * daneben. Sie stehen jetzt hier, einmal, mit drei Verbesserungen:
 *
 *  1. **Beschriftet und übersetzt.** „← 2026-08" sagt nicht, was passiert,
 *     und auf Arabisch läuft die Schrift von rechts nach links — derselbe
 *     Pfeil zeigt dort in die andere Richtung. Die Wörter kommen deshalb aus
 *     `MEIN_TEXTE` (vier Sprachen), die Pfeile sind `aria-hidden`, und die
 *     Leserichtung übernimmt das Schriftsystem.
 *  2. **44 px hoch** (DESIGN §8) — ein Textlink misst 20 und wird mit dem
 *     Daumen nicht getroffen.
 *  3. **Nicht in die leere Zukunft.** Vorwärts geht es höchstens bis zum
 *     laufenden Monat. Diese drei Seiten zeigen ERFASSTE Zeit; ein Monat, der
 *     noch nicht begonnen hat, ist immer leer, und ein Pfeil, der endlos in
 *     leere Bildschirme führt, ist kein Weg, sondern eine Falle. Wer die
 *     kommenden Schichten sehen will, steht auf `/portal/mein/schichten` —
 *     dafür ist jene Seite da.
 *
 * **Der laufende Monat hat einen eigenen Weg zurück.** Wer sechs Monate
 * zurückgeblättert hat, kommt sonst nur durch sechsmal Tippen wieder an; der
 * Knopf erscheint genau dann, wenn man nicht schon dort steht.
 */
export function Monatswechsler({
  pfad, monat, heute, texte, zusatz, sprache,
}: {
  /** Die Adresse OHNE Abfrage, z. B. `/portal/mein/zeiten`. */
  readonly pfad: string;
  /** Der angezeigte Monat als `JJJJ-MM-TT` — nur Jahr und Monat zählen. */
  readonly monat: string;
  /** Der heutige Berliner Tag — die Grenze nach vorn. */
  readonly heute: string;
  readonly texte: MeinTexte;
  /**
   * Weitere Abfrageparameter, die MITWANDERN muessen.
   *
   * Der Monatsnachweis traegt `?anstellung=` — wer zwei Beschaeftigungen hat
   * (D-09) und einen Monat zurueckblaettert, landete sonst wieder bei der
   * ERSTEN. Ein Wechsler, der eine andere Auswahl still zuruecksetzt, ist
   * schlimmer als keiner.
   */
  readonly zusatz?: Readonly<Record<string, string>> | undefined;
  /** `dir`/`lang` fuer ein Blatt, das nicht in der Huelle steckt. */
  readonly sprache?: string | undefined;
}) {
  const jetzt = heute.slice(0, 7);
  const gezeigt = monat.slice(0, 7);
  const verschiebe = (um: number): string => {
    const jahr = Number(gezeigt.slice(0, 4));
    const m = Number(gezeigt.slice(5, 7));
    const gesamt = jahr * 12 + (m - 1) + um;
    return `${String(Math.floor(gesamt / 12)).padStart(4, '0')}-${
      String((gesamt % 12) + 1).padStart(2, '0')}`;
  };
  const anzeige = (jjjjMm: string): string => `${jjjjMm.slice(5, 7)}/${jjjjMm.slice(0, 4)}`;

  const vorher = verschiebe(-1);
  const spaeter = verschiebe(1);
  /* Vorwaerts nur, solange das Ziel nicht IN der Zukunft liegt. */
  const darfVor = spaeter <= jetzt;

  const knopf = 'inline-flex min-h-11 items-center gap-s2 rounded-md border border-line '
    + 'px-s4 text-base text-text hover:bg-surface-2';

  /* `?monat=` zuerst, damit die Adresse lesbar bleibt; der Rest haengt an. */
  const ziel = (jjjjMm: string | null): LinkProps<string>['href'] => {
    const teile = [
      ...(jjjjMm === null ? [] : [`monat=${jjjjMm}-01`]),
      ...Object.entries(zusatz ?? {}).map(
        ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`),
    ];
    const roh = teile.length === 0 ? pfad : `${pfad}?${teile.join('&')}`;
    /*
     * Die eine Umtypisierung — dieselbe wie in `components/portal/Zurueck.tsx`.
     * `typedRoutes` kennt keine zur Laufzeit gebaute Adresse; geprueft ist
     * sie trotzdem, nur eine Ebene hoeher: `pfad` kommt aus dem Rumpf der
     * Seite, die ihn selbst traegt.
     */
    return roh as LinkProps<string>['href'];
  };

  return (
    <nav aria-label={texte.monat} data-cse="monatswechsler"
         {...(sprache === undefined
           ? {} : { lang: sprache, dir: sprache === 'ar' ? 'rtl' as const : 'ltr' as const })}
         className="mb-s5 flex flex-wrap items-center gap-s3">
      <Link href={ziel(vorher)} data-cse="monat-zurueck" className={knopf}>
        <span aria-hidden="true">←</span>
        {texte.monatVorher}
        <span className="cse-zahl text-text-muted">{anzeige(vorher)}</span>
      </Link>

      {darfVor ? (
        <Link href={ziel(spaeter)} data-cse="monat-vor" className={knopf}>
          <span className="cse-zahl text-text-muted">{anzeige(spaeter)}</span>
          {texte.monatSpaeter}
          <span aria-hidden="true">→</span>
        </Link>
      ) : (
        /*
         * Kein Verweis, aber auch kein Loch: eine Schaltflaeche, die
         * verschwindet, laesst den Daumen ins Leere tippen. `aria-disabled`
         * statt `disabled`, weil das hier kein Formularelement ist.
         */
        <span data-cse="monat-vor-gesperrt" aria-disabled="true"
              className="inline-flex min-h-11 items-center gap-s2 rounded-md border
                         border-line px-s4 text-base text-text-subtle opacity-50">
          <span className="cse-zahl">{anzeige(spaeter)}</span>
          {texte.monatSpaeter}
          <span aria-hidden="true">→</span>
        </span>
      )}

      {gezeigt !== jetzt && (
        <Link href={ziel(null)} data-cse="monat-heute" className={knopf}>
          {texte.monatHeute}
          <span className="cse-zahl text-text-muted">{anzeige(jetzt)}</span>
        </Link>
      )}
    </nav>
  );
}


/**
 * Der Jahreswechsler auf dem Urlaubskonto (V-054, EMP-05, EMP-15).
 *
 * **Derselbe Befund wie beim Monatswechsler, ein Jahr grösser.**
 * `/portal/mein/urlaub` liest `?jahr=` und bot kein Bedienelement, das ihn
 * setzt: wer den Resturlaub des Vorjahres sehen wollte — die häufigste Frage
 * überhaupt, weil ein Übertrag im Frühjahr verfällt —, musste die Adresszeile
 * tippen. Auf einem Telefon ist das keine Mühe, sondern eine verschlossene
 * Tür.
 *
 * **Nicht in die leere Zukunft, aber EIN Jahr weit.** Anders als beim Monat:
 * ein Urlaubsanspruch für das kommende Jahr wird im Herbst geplant, und die
 * Zeile dafür steht, sobald jemand sie angelegt hat. Zwei Jahre voraus wären
 * zwei leere Bildschirme.
 *
 * **Beschriftet und übersetzt**, 44 px hoch, Pfeile `aria-hidden` — dieselben
 * drei Gründe wie beim Monatswechsler, und derselbe Grund, warum beide hier
 * stehen und nicht je einmal in jeder Seite.
 */
export function Jahreswechsler({
  pfad, jahr, heute, texte, sprache,
}: {
  /** Die Adresse OHNE Abfrage, z. B. `/portal/mein/urlaub`. */
  readonly pfad: string;
  /** Das gezeigte Jahr. */
  readonly jahr: number;
  /** Der heutige Berliner Tag als `JJJJ-MM-TT` — die Grenze nach vorn. */
  readonly heute: string;
  readonly texte: MeinTexte;
  readonly sprache?: string | undefined;
}) {
  const jetzt = Number(heute.slice(0, 4));
  const vorher = jahr - 1;
  const spaeter = jahr + 1;
  /* Ein Jahr voraus, nicht mehr: der Anspruch des übernächsten Jahres steht
   * nirgends, und ein Pfeil in leere Bildschirme ist kein Weg. */
  const darfVor = spaeter <= jetzt + 1;

  const knopf = 'inline-flex min-h-11 items-center gap-s2 rounded-md border border-line '
    + 'px-s4 text-base text-text hover:bg-surface-2';
  const ziel = (j: number | null): LinkProps<string>['href'] => {
    const roh = j === null ? pfad : `${pfad}?jahr=${String(j)}`;
    /* Dieselbe Umtypisierung und dieselbe Begründung wie im Monatswechsler. */
    return roh as LinkProps<string>['href'];
  };

  return (
    <nav aria-label={texte.jahr} data-cse="jahreswechsler"
         {...(sprache === undefined
           ? {} : { lang: sprache, dir: sprache === 'ar' ? 'rtl' as const : 'ltr' as const })}
         className="mb-s5 flex flex-wrap items-center gap-s3">
      <Link href={ziel(vorher)} data-cse="jahr-zurueck" className={knopf}>
        <span aria-hidden="true">←</span>
        {texte.jahrVorher}
        <span className="cse-zahl text-text-muted">{String(vorher)}</span>
      </Link>

      {darfVor ? (
        <Link href={ziel(spaeter)} data-cse="jahr-vor" className={knopf}>
          <span className="cse-zahl text-text-muted">{String(spaeter)}</span>
          {texte.jahrSpaeter}
          <span aria-hidden="true">→</span>
        </Link>
      ) : (
        <span data-cse="jahr-vor-gesperrt" aria-disabled="true"
              className="inline-flex min-h-11 items-center gap-s2 rounded-md border
                         border-line px-s4 text-base text-text-subtle opacity-50">
          <span className="cse-zahl">{String(spaeter)}</span>
          {texte.jahrSpaeter}
          <span aria-hidden="true">→</span>
        </span>
      )}

      {jahr !== jetzt && (
        <Link href={ziel(null)} data-cse="jahr-heute" className={knopf}>
          {texte.jahrHeute}
          <span className="cse-zahl text-text-muted">{String(jetzt)}</span>
        </Link>
      )}
    </nav>
  );
}
