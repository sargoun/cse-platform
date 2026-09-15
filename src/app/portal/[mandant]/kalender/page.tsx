import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  kalenderZeilen, type KalenderZeile, type Quelle,
} from '@/server/services/kalender/eintraege';
import {
  ankerAus, ansichtAus, fensterFuer, monatsGitter, teile, type Ansicht,
} from '@/server/services/kalender/fenster';
import { nachTagen, type Tageszeile } from '@/server/services/kalender/tagesraster';
import { AnmeldungNoetig } from '../../Anmeldung';
import { MandantAntwort, mandantTor } from '../../unterseite';
import { QuellenPill, quellenWort } from './QuellenPill';

/**
 * `/portal/[mandant]/kalender` — der zentrale Kalender (CAL-01, CAL-02).
 *
 * **Er zeigt sechs Quellen und besitzt eine.** Termine stehen in
 * `kalender_eintrag`; Schichten, Projektenden, Vergabe-, Freigabe- und
 * Anfragefristen liest der Dienst dort, wo sie leben. Eine im Dienstplan
 * verschobene Schicht ist deshalb hier verschoben, ohne dass jemand den
 * Kalender angefasst hätte — und es gibt keine zweite Wahrheit darüber, wann
 * jemand arbeitet.
 *
 * **Was sichtbar ist, entscheidet RLS** (Invariante 3). Wer `zeit.lesen`
 * nicht hält, sieht keine Schichten; wer `vergabe.lesen` nicht hält, keine
 * Fristen. Dieselbe Seite ist damit für zwei Menschen verschieden, ohne eine
 * einzige Rechtefrage in dieser Datei.
 *
 * **Alles steht in der Adresse** — Ansicht, Anker, Filter. Ein Kalender ist
 * etwas, das man verschickt („sieh dir den 30. an"); ein Zustand im Kopf der
 * Seite wäre nicht teilbar, und der Zurück-Knopf täte das Falsche.
 */
export const dynamic = 'force-dynamic';

const QUELLEN: readonly Quelle[] = [
  'termin', 'einsatz', 'projekt', 'vergabe', 'freigabe', 'lead',
];

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

function quellenAus(roh: string | string[] | undefined): readonly Quelle[] | null {
  if (typeof roh !== 'string' || roh === '') return null;
  const gewaehlt = roh.split(',').filter((q): q is Quelle => (QUELLEN as string[]).includes(q));
  return gewaehlt.length === 0 ? null : gewaehlt;
}

/** `08:00` in Berliner Zeit — der Zeitpunkt kommt als ISO-Text aus der Abfrage. */
function uhrzeit(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

function Eintrag({ eintrag, kurz }: {
  readonly eintrag: Tageszeile; readonly kurz?: boolean;
}) {
  const { zeile, beginnt } = eintrag;
  const inhalt = (
    <>
      <QuellenPill quelle={zeile.quelle} />
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
  const klassen = `flex items-center gap-s2 rounded-md px-s2 py-[3px]
                   transition-colors duration-fast ease-brand hover:bg-surface-2
                   ${kurz === true ? '' : 'min-h-11'}`;
  return zeile.weg === null
    ? <div className={klassen} data-cse="kalender-eintrag">{inhalt}</div>
    : (
      <Link href={alsRoute(zeile.weg)} className={klassen} data-cse="kalender-eintrag"
            data-quelle={zeile.quelle}>
        {inhalt}
      </Link>
    );
}

export default async function Kalender({ params, searchParams }: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const suche = await searchParams;
  const tor = await mandantTor(`/portal/${mandant}/kalender`, mandant);
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const ansicht: Ansicht = ansichtAus(suche['ansicht']);
  const nurQuellen = quellenAus(suche['quellen']);
  const nurEigene = suche['eigene'] === '1';

  const { zeilen, fenster, heute } = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, zugang.sitzung, async (kontext) => {
      const [uhr] = await kontext.abfrage<{ tag: string }>(
        `select app.berlin_heute()::text as tag`);
      const f = fensterFuer(ansicht, ankerAus(suche['tag'], uhr!.tag));
      return {
        heute: uhr!.tag,
        fenster: f,
        /*
         * Geholt wird, was das GITTER zeigt (`abfrageVon`/`abfrageBis`), nicht
         * nur der Monat: die Zellen der Nachbarmonate sind sonst immer leer.
         * Die Agenda filtert danach wieder auf `von`/`bis` — sie beschriftet
         * einen Zeitraum, und der ist der Monat.
         */
        zeilen: await kalenderZeilen(kontext, {
          zeitraum: { von: f.abfrageVon, bis: f.abfrageBis, bezeichnung: f.bezeichnung },
          nurBenutzerId: nurEigene ? zugang.sitzung.benutzerId : null,
          nurQuellen,
        }),
      };
    }))) as {
    zeilen: readonly KalenderZeile[];
    fenster: ReturnType<typeof fensterFuer>;
    heute: string;
  };

  /*
   * Das Raster bekommt das Fenster, das geholt wurde -- damit ein sehr langer
   * Eintrag an seinem Rand beginnt und nicht an seinem eigenen Anfang.
   */
  const proTag = nachTagen(zeilen, { von: fenster.abfrageVon, bis: fenster.abfrageBis });
  const wurzel = `/portal/${mandant}/kalender`;
  const adresse = (aenderung: {
    tag?: string; ansicht?: Ansicht; quellen?: string | null; eigene?: boolean;
  }): string => {
    const q = new URLSearchParams();
    q.set('ansicht', aenderung.ansicht ?? ansicht);
    q.set('tag', aenderung.tag ?? fenster.anker);
    const quellen = aenderung.quellen === undefined
      ? (nurQuellen === null ? null : nurQuellen.join(','))
      : aenderung.quellen;
    if (quellen !== null && quellen !== '') q.set('quellen', quellen);
    if (aenderung.eigene ?? nurEigene) q.set('eigene', '1');
    return `${wurzel}?${q.toString()}`;
  };

  return (
    <PortalRahmen
      titel="Kalender"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="kalender"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div className="min-w-0">
          <h1 className="text-h1 text-text">{fenster.bezeichnung}</h1>
          <p className="mt-s1 max-w-prose text-sm text-text-muted">
            Termine, Schichten und Fristen dieser Gesellschaft — gelesen aus ihrer Quelle,
            nicht aus einer Kopie.
          </p>
        </div>
        <Link href={alsRoute('/portal/konto/kalender-feed')} data-cse="zum-feed"
              className="text-sm text-text underline underline-offset-2">
          Als Kalender abonnieren
        </Link>
      </div>

      <div className="mb-s5 flex flex-wrap items-center gap-s4" data-cse="kalender-steuerung">
        <nav aria-label="Zeitraum" className="flex items-center gap-s2">
          <Link href={alsRoute(adresse({ tag: fenster.vorher }))} data-cse="kalender-zurueck"
                aria-label="Vorheriger Zeitraum"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md
                           border border-line text-text-muted hover:border-line-strong">
            ‹
          </Link>
          <Link href={alsRoute(adresse({ tag: heute }))} data-cse="kalender-heute"
                className="inline-flex min-h-11 items-center rounded-md border border-line
                           px-s4 text-sm text-text hover:border-line-strong">
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

      {/*
        * **Die Filter sind Links, keine Kästchen** (CAL-02). Ein Kalender mit
        * gesetzten Filtern ist etwas, das man verschickt; ein Formularzustand
        * wäre nicht teilbar.
        */}
      <nav aria-label="Herkunft" className="mb-s5 flex flex-wrap items-center gap-s2"
           data-cse="kalender-filter">
        <Link href={alsRoute(adresse({ quellen: null }))} data-cse="filter-alle"
              aria-current={nurQuellen === null ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-s4 text-sm
                          ${nurQuellen === null
                            ? 'bg-text text-ink' : 'bg-surface-3 text-text-muted'}`}>
          Alles
        </Link>
        {QUELLEN.map((q) => {
          const aktiv = nurQuellen !== null && nurQuellen.includes(q);
          /*
           * **Die Pille SCHALTET UM.** `quellenAus` liest eine Komma-Liste —
           * die Adresse konnte also immer mehrere Herkuenfte tragen, nur die
           * Oberflaeche konnte keine bauen: jeder Klick ersetzte die ganze
           * Auswahl, und eine aktive Pille war ein Knopf ohne Wirkung. Wer
           * die letzte abwaehlt, landet wieder bei „Alles".
           */
          const danach = aktiv
            ? (nurQuellen ?? []).filter((x) => x !== q)
            : [...(nurQuellen ?? []), q];
          return (
            <Link key={q} href={alsRoute(adresse({
              quellen: danach.length === 0 ? null : danach.join(','),
            }))} data-cse={`filter-${q}`}
                  aria-current={aktiv ? 'page' : undefined}
                  aria-label={`${quellenWort(q)}${aktiv ? ' — abwählen' : ''}`}
                  className={`inline-flex min-h-11 items-center rounded-full px-s4 text-sm
                              ${aktiv ? 'bg-text text-ink' : 'bg-surface-3 text-text-muted'}`}>
              {quellenWort(q)}
            </Link>
          );
        })}
        <Link href={alsRoute(adresse({ eigene: !nurEigene }))} data-cse="filter-eigene"
              aria-current={nurEigene ? 'page' : undefined}
              className={`ms-auto inline-flex min-h-11 items-center rounded-full px-s4 text-sm
                          ${nurEigene ? 'bg-text text-ink' : 'bg-surface-3 text-text-muted'}`}>
          Nur meine
        </Link>
      </nav>

      {/*
        * **Ab `md` das Gitter, darunter die Agenda** (DESIGN §5, §8). Sieben
        * Spalten auf einem Telefon sind 50 Pixel breit und zeigen nichts; die
        * Agenda ist keine umgestellte Fassung desselben Bildschirms, sondern
        * eine andere Antwort auf dieselbe Frage.
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
                <div
                  key={tag}
                  data-cse="kalender-zelle"
                  data-heute={istHeute ? 'ja' : 'nein'}
                  className={`min-h-[120px] border-b border-e p-s2
                              ${ausserhalb ? 'bg-surface-2' : 'bg-surface'}
                              ${istHeute ? 'border-brand' : 'border-line'}`}
                >
                  <div className="mb-s1 flex items-center justify-between">
                    <span className={`inline-flex h-6 min-w-6 items-center justify-center
                                      rounded-full px-s1 text-xs tabular-nums
                                      ${istHeute ? 'bg-brand font-semibold text-text'
                                        : ausserhalb ? 'text-text-subtle' : 'text-text-muted'}`}>
                      {teile(tag).tagImMonat}
                    </span>
                    {/*
                      * Der heutige Tag stand nur in der Farbe — ein Rahmen und
                      * ein gefülltes Plättchen (WCAG 1.4.1: Farbe ist nie das
                      * einzige Mittel). Die Agenda sagt es daneben ausdrücklich;
                      * im Gitter steht dasselbe Wort, nur für das Vorlesen.
                      */}
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
        {[...proTag.keys()].sort().filter((t) => t >= fenster.von && t <= fenster.bis)
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
          ))}
      </div>

      {proTag.size === 0 && (
        /*
         * **Zwei Sätze, weil es zwei Zustände sind.** „Hier liegt nichts" ist
         * eine Aussage über den Zeitraum; sie ist falsch, sobald ein Filter
         * gesetzt ist. Wer sie trotzdem liest, sucht den Fehler in der
         * Quelle statt in der eigenen Auswahl — und findet ihn nie.
         */
        <Hinweis art="hinweis" cse="kalender-leer" className="max-w-prose">
          {nurQuellen === null && !nurEigene ? (
            <>
              In diesem Zeitraum liegt nichts — weder ein Termin noch eine Schicht noch
              eine Frist. Was hier fehlt, fehlt in seiner Quelle: Schichten stehen im
              Dienstplan, Fristen an ihrem Vorgang.
            </>
          ) : (
            <>
              Mit dieser Auswahl liegt hier nichts. Gefiltert ist
              {nurQuellen === null ? '' : ` nach ${nurQuellen.map(quellenWort).join(', ')}`}
              {nurQuellen !== null && nurEigene ? ' und' : ''}
              {nurEigene ? ' auf die eigenen Einträge' : ''}
              {' — '}
              <Link href={alsRoute(adresse({ quellen: null, eigene: false }))}
                    data-cse="kalender-leer-alles"
                    className="underline underline-offset-2">
                ohne Filter ansehen
              </Link>.
            </>
          )}
        </Hinweis>
      )}
    </PortalRahmen>
  );
}
