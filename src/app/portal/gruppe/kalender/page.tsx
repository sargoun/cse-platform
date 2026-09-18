import Link from 'next/link';
import { AreaBadge } from '@/components/ui/AreaBadge';
import { Hinweis } from '@/components/ui/Hinweis';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import {
  ankerAus, ansichtAus, fensterFuer, monatsGitter, teile, type Ansicht,
} from '@/server/services/kalender/fenster';
import { nachTagen, type Tageszeile } from '@/server/services/kalender/tagesraster';
import {
  gruppenKalenderZeilen, gruppenPersonen, gruppenTeams, quellenRechte,
  GRUPPEN_QUELLEN, QUELLEN_MIT_PERSONENBEZUG, QUELLEN_RECHT,
  type GruppenKalenderZeile, type GruppenQuelle, type PersonWahl, type TeamWahl,
} from '@/server/services/gruppe/kalender';
import { quellenWort } from '../../[mandant]/kalender/QuellenPill';
import {
  bereichAus, bereichSchluessel, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer,
  type Bereich, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/kalender` — der zusammengeführte Kalender (CAL-01, CAL-02),
 * **lesend** (Invariante 10).
 *
 * **Was hier NICHT steht, ist die halbe Seite.** Kein Anlegen, kein
 * Verschieben, kein Absagen: `gruppenLesen` gibt einen `LeseKontext`, und ein
 * Schreibversuch wäre ein Compilerfehler. Jeder Eintrag verweist in die
 * Gesellschaft, der er gehört — ein GET wechselt den Mandanten nie (§4.5),
 * der Verweis läuft über das Wechselblatt.
 *
 * **Und kein Personenbezug, wo die Mandantengrenze ihn schützt.** Ein
 * gemeinsamer Kalender über drei Gesellschaften ist genau die Stelle, an der
 * jemand versehentlich liest, wer bei der Schwestergesellschaft wann
 * arbeitet oder wer sich dort beworben hat. Deshalb:
 * Bewerbungsgespräche kommen hier gar nicht vor (`gruppe/kalender.ts`, und
 * seit 0370 auch als Policy), eine Schicht steht ohne Namen da, und der
 * Personenfilter verlangt `gruppe.personal.lesen` zusätzlich (O-872).
 *
 * **Alles steht in der Adresse** — Ansicht, Anker, Bereich, Quellen, Team,
 * Person. Ein Kalender ist etwas, das man verschickt („sieh dir den 30. an");
 * ein Zustand im Kopf der Seite wäre nicht teilbar, und der Zurück-Knopf täte
 * das Falsche.
 */
export const dynamic = 'force-dynamic';

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

const QUELLEN_TEXT: Readonly<Record<GruppenQuelle, string>> = {
  termin: 'Termine, die der Kalender selbst führt',
  einsatz: 'Schichten aus dem Dienstplan',
  projekt: 'Projektenden',
  vergabe: 'Angebotsfristen aus dem Vergaberadar',
  freigabe: 'Fristen im Freigabe-Posteingang',
  lead: 'Reaktionsfristen auf Anfragen',
};

function quellenAus(roh: string | string[] | undefined): readonly GruppenQuelle[] | null {
  if (typeof roh !== 'string' || roh === '') return null;
  const gewaehlt = roh.split(',')
    .filter((q): q is GruppenQuelle => (GRUPPEN_QUELLEN as string[]).includes(q));
  return gewaehlt.length === 0 ? null : gewaehlt;
}

function idAus(roh: string | string[] | undefined): string | null {
  const wert = typeof roh === 'string' ? roh : null;
  return wert !== null
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(wert)
    ? wert : null;
}

/** `08:00` in Berliner Zeit — der Zeitpunkt kommt als ISO-Text aus der Abfrage. */
function uhrzeit(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

/**
 * Ein Eintrag — mit seiner Gesellschaft, und ohne einen Menschen.
 *
 * **Die Gesellschaft steht VOR dem Titel.** In einem Kalender über vier
 * Gesellschaften ist „Objekt Hauptbahnhof" ohne den Absender keine Auskunft:
 * dieselbe Adresse wird von der Reinigung und von der Security betreut, und
 * wer die Schicht verschieben will, muss wissen, wen er anruft. Die
 * Bereichsmarke trägt dafür Farbe UND Text (DESIGN §3, §9).
 */
function Eintrag({ eintrag, kurz }: {
  readonly eintrag: Tageszeile<GruppenKalenderZeile>; readonly kurz?: boolean;
}) {
  const { zeile, beginnt } = eintrag;
  const b = bereichSchluessel(zeile.bereichSlug);
  const inhalt = (
    <>
      {b === null
        ? <span className="shrink-0 text-xs text-text-subtle">{zeile.bereichName}</span>
        : <AreaBadge bereich={b} />}
      {/*
        * Im Monatsgitter faellt die Herkunft weg, die Gesellschaft nicht.
        * Eine Zelle ist rund 150 Pixel breit; stuenden beide darin, bliebe
        * vom Titel nichts, und der Titel ist die Sache. Welche Gesellschaft
        * eine Schicht faehrt, ist auf einer Gruppenseite die erste Frage —
        * die Herkunft steht in der Agenda und im Filter darueber.
        */}
      {kurz === true ? null : (
        <span className="shrink-0 text-xs text-text-subtle">{quellenWort(zeile.quelle)}</span>
      )}
      {!zeile.ganztaegig && (
        /*
         * Die Uhrzeit steht nur an dem Tag, an dem sie gilt. Eine Schicht von
         * 22:00 bis 06:00 stand im Folgetag mit „22:00" da — und zwar ganz
         * oben, vor allem, was an diesem Morgen wirklich um sieben beginnt.
         */
        <span className="shrink-0 text-xs tabular-nums text-text-muted">
          {beginnt ? uhrzeit(zeile.beginn) : `seit ${uhrzeit(zeile.beginn)}`}
        </span>
      )}
      <span className={`min-w-0 truncate text-sm
                        ${zeile.abgesagt ? 'text-text-subtle line-through' : 'text-text'}`}>
        {zeile.titel}
      </span>
    </>
  );
  /*
   * **`flex-wrap` — und ohne es stand im Monatsgitter der Titel auf 0px.**
   *
   * Gemessen am Schreibtisch (1440px, `abmessungen.spec.ts`): diese Seite lief
   * 14px über den Rand. Der schuldige Kasten war `span.shrink-0 … tabular-nums`
   * bei x=1388…1454 in einer Zelle, die bei 1407 endet, und direkt daneben
   * `span.min-w-0 truncate` bei x=1462…1462 — der Titel, auf null gekürzt.
   *
   * Eine Zelle des Monatsgitters ist rund 147px breit. Die Bereichsmarke misst
   * für sich schon 112px („Dienstleistung" ist ein Wort ohne Trennstelle), die
   * Uhrzeit 66px, und die Uhrzeit trägt `shrink-0`, weil eine halb
   * abgeschnittene Uhrzeit eine falsche Uhrzeit ist. 112 + 8 + 66 sind 186 in
   * 147 — die Zeile KANN nicht einzeilig passen, und `min-w-0 truncate` am
   * Titel hat genau das getan, was es verspricht: es hat den Titel geopfert.
   *
   * `flex-wrap` gibt jedem Teil eine Zeile, wo eine nicht reicht. Damit sinkt
   * die Mindestbreite der Zeile auf die ihres breitesten KINDES (112px), und
   * der Titel steht wieder da — die Sache, um die es in einem Kalender geht.
   * Kein neuer Gestaltungswert: der Kasten trägt `min-h-[120px]`, er darf
   * wachsen, und die Zelle bleibt bei höchstens drei Einträgen (DESIGN §5).
   */
  const klassen = `flex flex-wrap items-center gap-s2 rounded-md px-s2 py-[3px]
                   transition-colors duration-fast ease-brand hover:bg-surface-2
                   ${kurz === true ? '' : 'min-h-11'}`;
  return zeile.weg === null
    ? <div className={klassen} data-cse="kalender-eintrag">{inhalt}</div>
    : (
      <Link href={alsRoute(zeile.weg)} className={klassen} data-cse="kalender-eintrag"
            data-quelle={zeile.quelle} data-bereich={zeile.bereichSlug}>
        {inhalt}
      </Link>
    );
}

export default async function GruppenKalender({ searchParams }: {
  readonly searchParams: Suchparameter;
}) {
  const tor = await gruppenTor('/portal/gruppe/kalender');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const suche = await searchParams;
  const ansicht: Ansicht = ansichtAus(suche['ansicht']);
  const nurQuellen = quellenAus(suche['quellen']);
  const teamId = idAus(suche['team']);
  const personId = idAus(suche['person']);

  const daten = await gruppenLesen(tor.zugang, async (kontext) => {
    const [uhr] = await kontext.abfrage<{ tag: string }>(
      `select app.berlin_heute()::text as tag`);
    const heute = uhr?.tag ?? new Date().toISOString().slice(0, 10);
    const fenster = fensterFuer(ansicht, ankerAus(suche['tag'], heute));

    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const mandantIds = mandantIdsFuer(kontext, aktiv);

    const rechte = await quellenRechte(kontext);
    const teams = await gruppenTeams(kontext, mandantIds);
    const personen = await gruppenPersonen(kontext, mandantIds);

    /*
     * Ein Team oder eine Person, die in dieser Auswahl nicht steht, wird
     * FALLEN GELASSEN statt still angewendet: sonst zeigte eine Adresse mit
     * `?team=<fremd>` eine leere Woche, die wie „nichts geplant" aussieht.
     */
    const team = teams.find((t) => t.id === teamId) ?? null;
    const person = personen.find((p) => p.id === personId) ?? null;

    const zeilen = await gruppenKalenderZeilen(kontext, {
      von: fenster.abfrageVon,
      bis: fenster.abfrageBis,
      mandantIds,
      nurQuellen,
      nurTeamId: team?.id ?? null,
      nurPersonId: person?.id ?? null,
    });

    return { heute, fenster, bereiche, aktiv, mandantIds, rechte, teams, personen, team, person, zeilen };
  });

  const { heute, fenster, bereiche, aktiv, rechte, teams, personen, team, person, zeilen } = daten;
  const proTag = nachTagen(zeilen, { von: fenster.abfrageVon, bis: fenster.abfrageBis });

  const wurzel = '/portal/gruppe/kalender';
  const adresse = (aenderung: {
    tag?: string; ansicht?: Ansicht; quellen?: string | null;
    team?: string | null; person?: string | null; bereich?: string | null;
  }): string => {
    const q = new URLSearchParams();
    q.set('ansicht', aenderung.ansicht ?? ansicht);
    q.set('tag', aenderung.tag ?? fenster.anker);
    const bereich = aenderung.bereich === undefined ? (aktiv?.slug ?? null) : aenderung.bereich;
    if (bereich !== null) q.set('bereich', bereich);
    const quellen = aenderung.quellen === undefined
      ? (nurQuellen === null ? null : nurQuellen.join(','))
      : aenderung.quellen;
    if (quellen !== null && quellen !== '') q.set('quellen', quellen);
    const t = aenderung.team === undefined ? (team?.id ?? null) : aenderung.team;
    if (t !== null) q.set('team', t);
    const p = aenderung.person === undefined ? (person?.id ?? null) : aenderung.person;
    if (p !== null) q.set('person', p);
    return `${wurzel}?${q.toString()}`;
  };

  const gefiltertAufPersonen = team !== null || person !== null;
  /*
   * **Der Personenfilter erscheint, wo er greifen kann — und sonst gar
   * nicht.** `gruppenPersonen` gibt nur die Menschen der Gesellschaften
   * zurueck, in denen diese Sitzung `gruppe.personal.lesen` haelt; eine leere
   * Liste heisst damit „kein Recht", und ein Auswahlfeld ohne Auswahl waere
   * ein Knopf, der nichts tut.
   */
  const darfPersonenfilter = personen.length > 0;

  /*
   * Die Legende: welche Quelle ist in welcher Gesellschaft ueberhaupt lesbar?
   * Eine leere Woche in der Security kann „nichts geplant" heissen oder „kein
   * Dienstplanrecht", und im Kalender sehen die beiden gleich aus.
   */
  const gezeigteBereiche: readonly Bereich[] = aktiv === null
    ? bereiche : bereiche.filter((b) => b.slug === aktiv.slug);
  /*
   * Gezaehlt wird ueber die Quellen, die DIESE Sicht ueberhaupt fragt: mit
   * gesetztem Personen- oder Teamfilter laeuft nur die Schichtabfrage, und
   * eine Warnung „Projektenden fehlen" waere dort keine Luecke, sondern die
   * Auswahl selbst.
   */
  const gefragteQuellen = GRUPPEN_QUELLEN
    .filter((q) => nurQuellen === null || nurQuellen.includes(q))
    .filter((q) => !gefiltertAufPersonen || QUELLEN_MIT_PERSONENBEZUG.includes(q));
  const luecken = gezeigteBereiche.flatMap((b) => {
    const gehalten = rechte.get(b.id) ?? new Set<string>();
    const fehlend = gefragteQuellen.filter((q) => !gehalten.has(QUELLEN_RECHT[q]));
    return fehlend.length === 0 ? [] : [{ bereich: b, fehlend }];
  });

  /* Dieselben Klassen wie `BereichFilter` in `../tor` — eine Form fuer eine Sache. */
  const bereichsPille = (istAktiv: boolean): string => [
    'inline-flex min-h-11 shrink-0 items-center rounded-full px-s4 text-sm',
    'transition-colors duration-fast ease-brand',
    istAktiv ? 'bg-white text-ink' : 'bg-surface-3 text-text-muted hover:text-text',
  ].join(' ');
  const pille = (istAktiv: boolean): string => [
    'inline-flex min-h-11 shrink-0 items-center rounded-full px-s4 text-sm',
    'transition-colors duration-fast ease-brand',
    istAktiv ? 'bg-text text-ink' : 'bg-surface-3 text-text-muted hover:text-text',
  ].join(' ');
  const schaltflaeche = `inline-flex min-h-11 items-center rounded-md border px-s4 text-sm
                         border-line text-text-muted hover:border-line-strong`;

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Kalender" aktiverTab="uebersicht">
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div className="min-w-0">
          <h1 className="m-0 text-h1 text-text">{fenster.bezeichnung}</h1>
          <p className="mt-s1 max-w-prose text-sm text-text-muted">
            Termine, Schichten und Fristen aller Gesellschaften — gelesen aus ihrer Quelle,
            nicht aus einer Kopie. Geändert wird im Bereich.
          </p>
        </div>
      </div>

      {/*
        * **Der Bereichsfilter dieser Seite baut seine Adressen selbst** — und
        * das ist keine Abweichung um der Abweichung willen. `BereichFilter`
        * (`../tor`) setzt `?bereich=…` als GANZE Abfrage; auf jeder anderen
        * Gruppenseite ist das richtig, weil es dort keinen zweiten Zustand
        * gibt. Hier gaebe es einen: wer den Oktober ansieht und auf
        * „SSE Security" klickt, landete im heutigen Monat. Die Form ist
        * dieselbe (dieselben Klassen, dieselbe `aria-current`-Markierung),
        * nur die Adresse traegt Ansicht, Anker und Filter mit.
        */}
      <nav aria-label="Bereich" data-cse="bereichs-filter" className="mb-s5 flex flex-wrap gap-s2">
        <Link href={alsRoute(adresse({ bereich: null }))} data-cse="bereich-alle"
              aria-current={aktiv === null ? 'page' : undefined}
              className={bereichsPille(aktiv === null)}>
          Alle Bereiche
        </Link>
        {bereiche.map((b) => (
          <Link key={b.slug} href={alsRoute(adresse({ bereich: b.slug }))}
                aria-current={aktiv?.slug === b.slug ? 'page' : undefined}
                data-bereich={b.slug}
                className={bereichsPille(aktiv?.slug === b.slug)}>
            {b.name}
          </Link>
        ))}
      </nav>

      <div className="mb-s5 flex flex-wrap items-center gap-s4" data-cse="kalender-steuerung">
        <nav aria-label="Zeitraum" className="flex items-center gap-s2">
          <Link href={alsRoute(adresse({ tag: fenster.vorher }))} data-cse="kalender-zurueck"
                aria-label="Vorheriger Zeitraum"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md
                           border border-line text-text-muted hover:border-line-strong">
            ‹
          </Link>
          <Link href={alsRoute(adresse({ tag: heute }))} data-cse="kalender-heute"
                className={schaltflaeche}>
            Heute
          </Link>
          <Link href={alsRoute(adresse({ tag: fenster.nachher }))} data-cse="kalender-vor"
                aria-label="Nächster Zeitraum"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md
                           border border-line text-text-muted hover:border-line-strong">
            ›
          </Link>
        </nav>

        <nav aria-label="Ansicht" className="flex flex-wrap items-center gap-s2">
          {([['monat', 'Monat'], ['woche', 'Woche'], ['tag', 'Tag']] as const).map(([w, l]) => (
            <Link key={w} href={alsRoute(adresse({ ansicht: w }))} data-cse={`ansicht-${w}`}
                  aria-current={w === ansicht ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-md border px-s4 text-sm
                              ${w === ansicht
                                ? 'border-line-strong bg-surface-3 text-text'
                                : 'border-line text-text-muted hover:border-line-strong'}`}>
              {l}
            </Link>
          ))}
        </nav>
      </div>

      <nav aria-label="Herkunft" className="mb-s4 flex flex-wrap items-center gap-s2"
           data-cse="kalender-filter">
        <Link href={alsRoute(adresse({ quellen: null }))} data-cse="filter-alle"
              aria-current={nurQuellen === null ? 'page' : undefined}
              className={pille(nurQuellen === null)}>
          Alles
        </Link>
        {GRUPPEN_QUELLEN.map((q) => {
          const istAktiv = nurQuellen !== null && nurQuellen.includes(q);
          const danach = istAktiv
            ? (nurQuellen ?? []).filter((x) => x !== q)
            : [...(nurQuellen ?? []), q];
          return (
            <Link key={q} href={alsRoute(adresse({
              quellen: danach.length === 0 ? null : danach.join(','),
            }))} data-cse={`filter-${q}`}
                  aria-current={istAktiv ? 'page' : undefined}
                  aria-label={`${quellenWort(q)} — ${QUELLEN_TEXT[q]}${istAktiv ? ', abwählen' : ''}`}
                  className={pille(istAktiv)}>
              {quellenWort(q)}
            </Link>
          );
        })}
      </nav>

      {/*
        * **Team und Person sind Auswahlfelder, keine Pillenreihen.** Vier
        * Gesellschaften haben zusammen mehr Teams und sehr viel mehr Menschen,
        * als in eine Leiste passen; dreissig Pillen sind kein Filter, sondern
        * eine zweite Liste. Es bleiben Verweise (die Adresse traegt den
        * Zustand) — das Feld ist nur die Auswahl davor.
        */}
      <div className="mb-s5 flex flex-wrap items-start gap-s5" data-cse="kalender-zuschnitt">
        {/*
          * TODO(client, O-871): Soll ein TERMIN einem Team gehören können? Heute greift der Teamfilter nur auf Schichten — `kalender_eintrag` trägt keine `team_id` (das Datenmodell sieht eine vor, gebaut ist sie nicht), und eine Spalte anzulegen, die niemand füllt, wäre ein Filter, der immer leer antwortet.
          */}
        {teams.length > 0 ? (
          <section aria-labelledby="teamfilter" className="min-w-0">
            <h2 id="teamfilter" className="mb-s2 text-micro uppercase tracking-[0.08em] text-text-subtle">
              Team <span className="normal-case tracking-normal text-text-subtle">
                · nur Schichten (O-871)
              </span>
            </h2>
            <div className="flex flex-wrap gap-s2">
              <Link href={alsRoute(adresse({ team: null }))} className={pille(team === null)}
                    aria-current={team === null ? 'page' : undefined} data-cse="team-alle">
                Alle Teams
              </Link>
              {teams.slice(0, 12).map((t: TeamWahl) => (
                <Link key={t.id} href={alsRoute(adresse({ team: t.id, person: null }))}
                      data-cse="team-wahl" data-team={t.id}
                      aria-current={team?.id === t.id ? 'page' : undefined}
                      className={pille(team?.id === t.id)}>
                  {t.name} <span className="ms-s1 text-xs opacity-70">{t.bereichName}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/*
          * TODO(client, O-872): Reicht `gruppe.personal.lesen` zusammen mit `gruppe.dienstplan.lesen`, damit die Gruppenleitung die Schichten EINES Menschen über die Gesellschaften hinweg sieht — oder braucht dieser Blick ein eigenes Recht? Heute ist es die Kombination, weil genau sie schon `/portal/gruppe/personen` und die ArbZG-Befunde auf `/portal/gruppe/dienstplan` trägt (D-09).
          */}
        {darfPersonenfilter ? (
          <section aria-labelledby="personenfilter" className="min-w-0">
            <h2 id="personenfilter"
                className="mb-s2 text-micro uppercase tracking-[0.08em] text-text-subtle">
              Person <span className="normal-case tracking-normal text-text-subtle">
                · Regel offen (O-872)
              </span>
            </h2>
            <div className="flex flex-wrap gap-s2">
              <Link href={alsRoute(adresse({ person: null }))} className={pille(person === null)}
                    aria-current={person === null ? 'page' : undefined} data-cse="person-alle">
                Alle Personen
              </Link>
              {personen.slice(0, 12).map((p: PersonWahl) => (
                <Link key={p.id} href={alsRoute(adresse({ person: p.id, team: null }))}
                      data-cse="person-wahl" data-person={p.id}
                      aria-current={person?.id === p.id ? 'page' : undefined}
                      className={pille(person?.id === p.id)}>
                  {p.name}
                  {p.bereiche.length > 1 ? (
                    <span className="ms-s1 text-xs opacity-70">{p.bereiche.join(' + ')}</span>
                  ) : null}
                </Link>
              ))}
            </div>
            {personen.length > 12 ? (
              <p className="mt-s2 text-xs text-text-subtle">
                {String(personen.length - 12)} weitere Personen — über{' '}
                <Link href="/portal/gruppe/personen" className="underline underline-offset-2">
                  Personen
                </Link>{' '}
                zu finden.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      {gefiltertAufPersonen ? (
        <Hinweis art="hinweis" cse="kalender-filterhinweis" className="mb-s5 max-w-prose">
          <strong>
            {person !== null
              ? `Nur Schichten von ${person.name}`
              : `Nur Schichten des Teams ${team?.name ?? ''}`}
            .
          </strong>{' '}
          Der Filter greift auf{' '}
          {QUELLEN_MIT_PERSONENBEZUG.map((q) => quellenWort(q)).join(', ')} — die übrigen
          Quellen gehören der Gesellschaft und keinem Menschen: eine Vergabefrist oder ein
          Projektende einer Person zuzuordnen wäre falsch, sie stillschweigend mitzuzeigen
          ebenso. Sie sind deshalb ausgeblendet.
          {person !== null && person.bereiche.length > 1 ? (
            <> Diese Person ist in {person.bereiche.join(' und ')} beschäftigt; das
            Arbeitszeitgesetz zählt beides zusammen (D-09) — die Auswertung dazu steht
            unter <Link href="/portal/gruppe/auslastung"
                        className="underline underline-offset-2">Auslastung</Link>.</>
          ) : null}
        </Hinweis>
      ) : null}

      {luecken.length > 0 ? (
        <Hinweis art="warnung" cse="kalender-luecken" className="mb-s5 max-w-prose">
          <strong>Nicht alles ist hier sichtbar.</strong> In diesen Gesellschaften fehlt das
          Leserecht für einzelne Quellen — der Kalender ist dort nicht leer, sondern
          verschlossen:
          <ul className="mt-s2 list-disc ps-s5">
            {luecken.map((l) => (
              <li key={l.bereich.slug} data-cse="kalender-luecke" data-bereich={l.bereich.slug}>
                {l.bereich.name}: {l.fehlend.map((q) => quellenWort(q)).join(', ')}
              </li>
            ))}
          </ul>
        </Hinweis>
      ) : null}

      {/*
        * **Ab `md` das Gitter, darunter die Agenda** (DESIGN §5, §8). Sieben
        * Spalten auf einem Telefon sind 50 Pixel breit und zeigen nichts.
        */}
      {ansicht === 'monat' && (
        <div className="mb-s6 hidden md:block" data-cse="kalender-gitter">
          <div className="grid grid-cols-7 border-s border-t border-line">
            {WOCHENTAGE.map((w) => (
              <div key={w} className="border-b border-e border-line bg-surface-2 px-s2 py-s1
                                      text-xs font-semibold uppercase tracking-widest
                                      text-text-subtle">
                {w}
              </div>
            ))}
            {monatsGitter(fenster.anker).map(({ tag, ausserhalb }) => {
              const eintraege = proTag.get(tag) ?? [];
              const istHeute = tag === heute;
              return (
                <div key={tag} data-cse="kalender-zelle" data-heute={istHeute ? 'ja' : 'nein'}
                     className={`min-h-[120px] border-b border-e p-s2
                                 ${ausserhalb ? 'bg-surface-2' : 'bg-surface'}
                                 ${istHeute ? 'border-brand' : 'border-line'}`}>
                  <div className="mb-s1 flex items-center justify-between">
                    <span className={`inline-flex h-6 min-w-6 items-center justify-center
                                      rounded-full px-s1 text-xs tabular-nums
                                      ${istHeute ? 'bg-brand font-semibold text-text'
                                        : ausserhalb ? 'text-text-subtle' : 'text-text-muted'}`}>
                      {teile(tag).tagImMonat}
                    </span>
                    {istHeute && <span className="sr-only">heute</span>}
                  </div>
                  <div className="flex flex-col gap-[2px]">
                    {eintraege.slice(0, 3).map((e) => (
                      <Eintrag key={`${e.zeile.quelle}-${e.zeile.id}`} eintrag={e} kurz />
                    ))}
                    {eintraege.length > 3 && (
                      <Link href={alsRoute(adresse({ ansicht: 'tag', tag }))}
                            data-cse="kalender-mehr"
                            className="px-s2 text-xs text-text-muted underline underline-offset-2">
                        +{eintraege.length - 3} weitere
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Die Agenda: unter `md` immer, ab `md` für Woche und Tag. */}
      <div className={ansicht === 'monat' ? 'md:hidden' : ''} data-cse="kalender-agenda">
        {[...proTag.keys()].sort().filter((t) => t >= fenster.von && t <= fenster.bis).length === 0
          ? (
            <LeereListe text="Kein Eintrag in diesem Zeitraum und dieser Auswahl." />
          ) : (
            [...proTag.keys()].sort().filter((t) => t >= fenster.von && t <= fenster.bis)
              .map((tag) => (
                <section key={tag} className="mb-s5">
                  <h2 className="sticky top-0 z-10 bg-surface py-s1 text-sm font-semibold text-text"
                      data-cse="agenda-tag" data-tag={tag}>
                    {new Intl.DateTimeFormat('de-DE', {
                      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Berlin',
                    }).format(new Date(`${tag}T12:00:00Z`))}
                    {tag === heute && <span className="ms-s2 text-brand">— heute</span>}
                  </h2>
                  <div className="flex flex-col gap-s1 border-s border-line ps-s3">
                    {(proTag.get(tag) ?? []).map((e) => (
                      <Eintrag key={`${e.zeile.quelle}-${e.zeile.id}`} eintrag={e} />
                    ))}
                  </div>
                </section>
              ))
          )}
      </div>

      <GruppenHinweis text="Bewerbungsgespräche stehen in diesem Kalender nicht: ihr Titel trägt den Namen einer Bewerberin, und die vier Gesellschaften sind datenschutzrechtlich eigene Verantwortliche. Eine Schicht steht hier ohne die Menschen, die sie besetzen — wer eingeteilt ist, sagt der Dienstplan der Gesellschaft, in der auch umgeteilt wird." />
    </GruppenRahmen>
  );
}
