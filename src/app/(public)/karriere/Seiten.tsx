import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata, Route } from 'next';
import { Hinweis } from '@/components/ui/Hinweis';
import { alternativen, mitSprache, type Sprache } from '@/lib/sprache';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { aufbewahrungTage } from '@/server/services/recruiting/dienst';
import {
  aufbewahrungsfristTage, bereiche, offeneStelle, offeneStellen, type OffeneStelle,
} from './daten';
import { Bewerbungsformular } from './Formular';
import { KARRIERE_TEXTE } from './texte';

/**
 * Die Seiten des Karrierebereichs — einmal gebaut, deutsch und englisch
 * gerufen (V-393, D-82).
 *
 * Die Routen unter `karriere/` und `en/karriere/` sind dünn: sie lesen die
 * Adresse und rufen eine dieser Funktionen mit ihrer Sprache. Funktionen, die
 * fertiges JSX liefern, und keine verschachtelten asynchronen Bauteile: so
 * zeichnet `renderToStaticMarkup` eine Route in einem Test vollständig
 * (`tests/kern/website-hinweise.test.ts`).
 *
 * **Die Stellentexte bleiben, wie sie erfasst sind.** Die englische Seite
 * übersetzt den Rahmen, nicht die Anzeige; der Satz `stellenSprache` sagt das,
 * und `lang="de"` am Anzeigentext lässt einen Bildschirmleser ihn deutsch
 * vorlesen (WCAG 3.1.2).
 *
 * TODO(client, O-512): Voreinstellung — der Karrierebereich ist englisch wie
 * die übrige Website; die Stellentexte stehen in der Sprache, in der das
 * Recruiting sie schreibt (deutsch), mit einem Satz dazu. D-802, D-807.
 */

/**
 * Ein Verweis in `sprache` — als `Route`, wie `typedRoutes` es für `Link`
 * verlangt. Die Adresse entsteht zur Laufzeit aus Pfad und Sprache; welche
 * es gibt, hält `tests/kern/sprachpfade.test.ts` gegen den Dateibaum.
 */
function ziel(pfad: string, sprache: Sprache): Route {
  return mitSprache(pfad, sprache) as Route;
}

/** `lang` für Text, der deutsch erfasst ist, auf einer Seite in `sprache`. */
function erfasst(sprache: Sprache): 'de' | undefined {
  return sprache === 'de' ? undefined : 'de';
}

/** Ort, Beschäftigungsart, Wochenstunden und Frist einer Stelle als eine Zeile. */
function eckdaten(s: OffeneStelle, sprache: Sprache, mitFrist: boolean): string {
  const t = KARRIERE_TEXTE[sprache];
  return [
    s.einsatzort,
    s.beschaeftigungsart === null ? null : t.beschaeftigungsart[s.beschaeftigungsart],
    s.wochenstunden === null ? null : t.stundenProWoche(s.wochenstunden),
    !mitFrist || s.bewerbungsfrist === null ? null : t.bewerbungBis(s.bewerbungsfrist),
  ].filter((x) => x !== null).join(' · ') || t.nachAbsprache;
}

/** Titel, Beschreibung und die Adressen der Seite in beiden Sprachen. */
export async function karriereMetadaten(
  sprache: Sprache, pfad: string, titel: string, beschreibung?: string,
): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  return {
    title: titel,
    ...(beschreibung === undefined ? {} : { description: beschreibung }),
    alternates: {
      canonical: `${basis}${mitSprache(pfad, sprache)}`,
      languages: alternativen(pfad, basis),
    },
  };
}

/** `/karriere` und `/en/karriere` — die Liste mit Bereichsfilter (REC-03, V-364). */
export async function karriereListe(
  sprache: Sprache, bereichWahl: unknown, meldung: string | undefined,
) {
  const t = KARRIERE_TEXTE[sprache];
  const gesellschaften = await bereiche();
  const gewaehlt = typeof bereichWahl === 'string'
    ? gesellschaften.find((g) => g.slug === bereichWahl) ?? null : null;
  const stellen = await offeneStellen(gewaehlt?.slug ?? null);
  const liste = ziel('/karriere', sprache);
  const filterKlasse = 'inline-flex min-h-11 items-center rounded-md border border-line px-s4 '
    + 'text-sm text-text hover:bg-surface-3';

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s6 px-s5 py-s7">
      <header className="flex flex-col gap-s3">
        <h1 className="m-0 text-display text-text">{t.titel}</h1>
        <p className="m-0 max-w-prose text-base text-text-muted">{t.einleitung}</p>
        {t.stellenSprache !== null && (
          <p className="m-0 max-w-prose text-sm text-text-muted" data-cse="stellen-sprache">
            {t.stellenSprache}
          </p>
        )}
      </header>

      {meldung !== undefined && (
        <Hinweis art="warnung" rolle="alert" cse="bewerbung-meldung" className="max-w-[72ch]">
          {meldung}
        </Hinweis>
      )}

      <nav aria-label={t.filterLabel} data-cse="bereichsfilter">
        <ul className="m-0 flex list-none flex-wrap gap-s2 p-0">
          <li>
            <Link href={liste} data-cse="bereich-filter" data-bereich=""
                  aria-current={gewaehlt === null ? 'page' : undefined}
                  className={`${filterKlasse}${gewaehlt === null ? ' bg-surface-3 font-semibold' : ''}`}>
              {t.alleGesellschaften}
            </Link>
          </li>
          {gesellschaften.map((g) => (
            <li key={g.slug}>
              <Link href={`${liste}?bereich=${g.slug}` as Route} data-cse="bereich-filter" data-bereich={g.slug}
                    aria-current={gewaehlt?.slug === g.slug ? 'page' : undefined}
                    className={`${filterKlasse}${gewaehlt?.slug === g.slug ? ' bg-surface-3 font-semibold' : ''}`}>
                {g.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section className="flex flex-col gap-s4">
        <h2 className="m-0 text-h2 text-text">{t.stellenZahl(stellen.length)}</h2>

        {stellen.length === 0 ? (
          <p
            data-cse="keine-stellen"
            className="m-0 max-w-prose rounded-lg border border-line bg-surface p-s5 text-base text-text-muted"
          >
            {gewaehlt === null ? t.keineStellen : t.keineStellenBei(gewaehlt.name)}
          </p>
        ) : (
          <ul data-cse="stellenliste" className="m-0 grid list-none grid-cols-1 gap-s4 p-0 md:grid-cols-2">
            {stellen.map((s) => (
              <li
                key={s.id}
                data-cse="stelle"
                data-bereich={s.mandantSlug}
                className="flex flex-col gap-s2 rounded-lg border border-line bg-surface p-s5"
              >
                <span className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                  {s.mandantName}
                </span>
                <h3 className="m-0 text-h3 text-text" lang={erfasst(sprache)}>
                  <Link href={ziel(`/karriere/${s.id}`, sprache)}
                        className="underline-offset-2 hover:underline">
                    {s.titel}
                  </Link>
                </h3>
                <p className="m-0 text-sm text-text-muted">{eckdaten(s, sprache, false)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
        <h2 className="m-0 text-h3 text-text">{t.nichtsPassend}</h2>
        <p className="m-0 max-w-prose text-base text-text-muted">{t.initiativText}</p>
        <Link
          href={ziel('/karriere/initiativbewerbung', sprache)}
          data-cse="zu-initiativ"
          className="inline-flex min-h-11 w-fit items-center rounded-md bg-brand px-s5 text-base text-white hover:bg-brand-hover"
        >
          {t.initiativKnopf}
        </Link>
      </section>
    </main>
  );
}

/** Die Metadaten einer Anzeige — Titel und Anfang der Beschreibung, wie erfasst. */
export async function stellenMetadaten(sprache: Sprache, stelle: string): Promise<Metadata> {
  const s = await offeneStelle(stelle);
  if (s === null) return { title: KARRIERE_TEXTE[sprache].stelleMetaTitel };
  return karriereMetadaten(sprache, `/karriere/${s.id}`,
    `${s.titel} — ${s.mandantName}`, s.beschreibung.slice(0, 160));
}

/** `/karriere/[stelle]` — eine Anzeige (REC-03, PUB-11). */
export async function stellenBlatt(sprache: Sprache, stelle: string) {
  const t = KARRIERE_TEXTE[sprache];
  const s = await offeneStelle(stelle);
  // Eine geschlossene oder nicht veroeffentlichte Stelle ist hier dasselbe wie
  // keine — der Unterschied waere die Auskunft, dass es sie gibt (AUT-06).
  if (s === null) notFound();

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s6 px-s5 py-s7">
      <nav aria-label={t.zurueckLabel}>
        <Link href={ziel('/karriere', sprache)}
              className="text-sm text-text-muted underline underline-offset-2">
          {t.zurueckAlle}
        </Link>
      </nav>

      <header className="flex flex-col gap-s2" data-bereich={s.mandantSlug}>
        <span className="text-micro uppercase tracking-[0.08em] text-text-subtle">
          {s.mandantName}
        </span>
        <h1 className="m-0 text-display text-text" lang={erfasst(sprache)}>{s.titel}</h1>
        <p className="m-0 text-base text-text-muted">{eckdaten(s, sprache, true)}</p>
        {t.stellenSprache !== null && (
          <p className="m-0 max-w-prose text-sm text-text-muted" data-cse="stellen-sprache">
            {t.stellenSprache}
          </p>
        )}
      </header>

      <section className="max-w-prose whitespace-pre-line text-base text-text"
               lang={erfasst(sprache)}>
        {s.beschreibung}
      </section>

      {s.anforderungen.length > 0 && (
        <section className="flex flex-col gap-s3">
          <h2 className="m-0 text-h2 text-text">{t.erwartungen}</h2>
          <ul data-cse="anforderungen" className="m-0 flex list-disc flex-col gap-s2 pl-s5"
              lang={erfasst(sprache)}>
            {s.anforderungen.map((a) => (
              <li key={a} className="max-w-prose text-base text-text">{a}</li>
            ))}
          </ul>
          <p className="m-0 max-w-prose text-sm text-text-muted">{t.erwartungenHinweis}</p>
        </section>
      )}

      <Link
        href={ziel(`/karriere/${s.id}/bewerbung`, sprache)}
        data-cse="zur-bewerbung"
        className="inline-flex min-h-11 w-fit items-center rounded-md bg-brand px-s5 text-base font-semibold text-white hover:bg-brand-hover"
      >
        {t.aufStelleBewerben}
      </Link>
    </main>
  );
}

/** `/karriere/[stelle]/bewerbung` — das Formular zu einer Stelle (REC-03, REC-07, LEG-11). */
export async function bewerbungsBlatt(
  sprache: Sprache, stelle: string, meldung: string | undefined,
) {
  const t = KARRIERE_TEXTE[sprache];
  const s = await offeneStelle(stelle);
  if (s === null) notFound();
  const tage = await oeffentlichLesen((kontext) => aufbewahrungTage(kontext));

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s6 px-s5 py-s7">
      <nav aria-label={t.zurueckLabel}>
        <Link href={ziel(`/karriere/${s.id}`, sprache)}
              className="text-sm text-text-muted underline underline-offset-2">
          ‹ <span lang={erfasst(sprache)}>{s.titel}</span>
        </Link>
      </nav>
      <header className="flex flex-col gap-s2">
        <h1 className="m-0 text-h1 text-text">
          {t.bewerbungVor}{' '}<span lang={erfasst(sprache)}>{s.titel}</span>
        </h1>
        <p className="m-0 text-base text-text-muted">{s.mandantName}</p>
      </header>
      <Bewerbungsformular stelleId={s.id} aufbewahrungTage={tage} meldung={meldung}
                          sprache={sprache} />
    </main>
  );
}

/** `/karriere/initiativbewerbung` — ohne Stelle (REC-03, REC-07). */
export async function initiativBlatt(sprache: Sprache, meldung: string | undefined) {
  const t = KARRIERE_TEXTE[sprache];
  const [tage, liste] = await Promise.all([
    oeffentlichLesen((kontext) => aufbewahrungTage(kontext)),
    bereiche(),
  ]);

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s6 px-s5 py-s7">
      <nav aria-label={t.zurueckLabel}>
        <Link href={ziel('/karriere', sprache)}
              className="text-sm text-text-muted underline underline-offset-2">
          {t.zurueckAlle}
        </Link>
      </nav>
      <header className="flex flex-col gap-s2">
        <h1 className="m-0 text-h1 text-text">{t.initiativTitel}</h1>
        <p className="m-0 max-w-prose text-base text-text-muted">{t.initiativEinleitung}</p>
      </header>
      <Bewerbungsformular stelleId={null} aufbewahrungTage={tage} bereiche={liste}
                          meldung={meldung} sprache={sprache} />
    </main>
  );
}

/** `/karriere/danke` — was jetzt passiert und wann gelöscht wird (REC-03, Art. 13 DSGVO). */
export async function dankeBlatt(sprache: Sprache) {
  const t = KARRIERE_TEXTE[sprache];
  const tage = await aufbewahrungsfristTage();

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s7">
      <h1 className="m-0 text-display text-text">{t.dankeTitel}</h1>
      <p className="m-0 max-w-prose text-base text-text-muted">{t.dankeText}</p>
      {/*
        * **Die Frist steht als Zahl da, nicht als „danach".** Art. 13 Abs. 2
        * lit. a DSGVO verlangt die Dauer der Speicherung. Die Zahl kommt aus
        * `recruiting.aufbewahrung_tage` — derselben Einstellung, nach der die
        * Annahme `aufbewahrung_bis` setzt und der Nachtlauf löscht.
        */}
      <p className="m-0 max-w-prose text-base text-text-muted" data-cse="aufbewahrung">
        {tage === null ? t.aufbewahrungOhneZahl : (
          <>
            {t.aufbewahrungVor}{' '}
            <strong className="font-medium text-text">{t.aufbewahrungTage(tage)}</strong>{' '}
            {t.aufbewahrungNach(tage)}
          </>
        )}{' '}
        {t.frueherLoeschen}{' '}
        <Link href={ziel('/datenschutz', sprache)} className="underline underline-offset-2">
          {t.datenschutzLink}
        </Link>.
      </p>
      <Link
        href={ziel('/karriere', sprache)}
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-line-strong px-s5 text-base text-text hover:bg-surface-2"
      >
        {t.zurueckZuStellen}
      </Link>
    </main>
  );
}
