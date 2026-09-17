import { notFound } from 'next/navigation';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { ladeSeite } from '@/server/services/inhalt/seite';
import { leistungenAus } from '@/server/services/inhalt/jsonld';
import { ReferenzAusTabelle } from '@/server/services/inhalt/referenz';
import { galerieDerGesellschaft } from '@/server/services/inhalt/galerie';
import {
  oeffentlicheBeitraege, oeffentlicheNeuigkeiten, oeffentlicherBeitragNachSlug,
} from '@/server/services/social/dienst';
import { Kontaktwege } from '@/components/oeffentlich/Kontaktwege';
import type { Sprache } from '@/lib/sprache';
import { ProfilRahmen } from './Rahmen';
import {
  BeitraegeListe, BeitragDetail, GalerieRaster, ProjekteListe, ProjektDetail,
  Unternehmensdaten,
} from './Inhalte';

/**
 * Die sieben Listen- und die drei Detailseiten eines Gesellschaftsprofils
 * (SEITENKARTE §2.2).
 *
 * **Eine Datei für beide Sprachen.** Jede dieser Seiten gibt es zweimal —
 * unter `/` und unter `/en/` (D-82). Zwanzig Dateien mit je zwei Zeilen
 * Unterschied liefen beim ersten Umbau auseinander; hier steht die Seite
 * einmal und bekommt die Sprache als Angabe.
 *
 * **Jede geht durch `ProfilRahmen`.** Der löst `[bereich]` gegen
 * `mandant.slug` auf und antwortet 404 für einen erfundenen Bereich — genau
 * einmal, statt zehnmal abgeschrieben.
 */

const TITEL: Readonly<Record<string, Readonly<Record<Sprache, string>>>> = {
  leistungen: { de: 'Leistungen', en: 'Services' },
  projekte: { de: 'Projekte', en: 'Projects' },
  galerie: { de: 'Galerie', en: 'Gallery' },
  news: { de: 'Aktuelles', en: 'News' },
  beitraege: { de: 'Beiträge', en: 'Posts' },
  kontakt: { de: 'Kontakt', en: 'Contact' },
  unternehmensdaten: { de: 'Unternehmensdaten', en: 'Company details' },
};

export function titelFuer(segment: string, sprache: Sprache): string {
  return TITEL[segment]?.[sprache] ?? segment;
}

/* ---------------------------------------------------------------- Leistungen */

/**
 * Die Leistungen kommen aus dem Abschnitt der Art `leistungen` auf der
 * PROFILSEITE — derselben Quelle, aus der `jsonld.ts` den `Service`-Block baut.
 *
 * **Keine eigene Tabelle.** Eine zweite Pflegestelle für dieselben Sätze
 * hiesse, dass die Seite und die strukturierten Daten für Suchmaschinen
 * auseinanderlaufen — und die eine Fassung, die niemand nachzieht, wäre die,
 * die Google liest.
 */
export async function LeistungenSeite(
  { bereich, sprache }: { readonly bereich: string; readonly sprache: Sprache },
) {
  return (
    <ProfilRahmen
      bereich={bereich} aktiv="leistungen" sprache={sprache}
      titel={titelFuer('leistungen', sprache)}
    >
      {(daten) => <LeistungenInhalt slug={daten.slug} sprache={sprache} />}
    </ProfilRahmen>
  );
}

async function LeistungenInhalt(
  { slug, sprache }: { readonly slug: string; readonly sprache: Sprache },
) {
  const seite = await oeffentlichLesen((kontext) => ladeSeite(
    { unsafe: (sql, werte) => kontext.abfrage(sql, werte) },
    `/unternehmen/${slug}`, sprache,
  ));
  const eintraege = (seite?.abschnitte ?? [])
    .filter((a) => a.art === 'leistungen')
    .flatMap((a) => leistungenAus(a.daten));

  if (eintraege.length === 0) {
    return (
      <div data-cse="leer" className="rounded-lg border border-line bg-surface p-s5">
        <p className="m-0 text-base text-text">
          {sprache === 'en'
            ? 'No services recorded for this company yet.'
            : 'Für diese Gesellschaft sind noch keine Leistungen hinterlegt.'}
        </p>
      </div>
    );
  }
  return (
    <ul data-cse="leistungen" className="m-0 grid list-none grid-cols-1 gap-s4 p-0 md:grid-cols-2">
      {eintraege.map((l) => (
        <li key={l.name} data-cse="leistung"
            className="rounded-lg border border-line bg-surface p-s4">
          <h2 className="m-0 text-h3 text-text">{l.name}</h2>
          {l.beschreibung !== undefined && (
            <p className="mt-s2 max-w-[72ch] text-sm text-text-muted">{l.beschreibung}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ Projekte */

export async function ProjekteSeite(
  { bereich, sprache }: { readonly bereich: string; readonly sprache: Sprache },
) {
  return (
    <ProfilRahmen
      bereich={bereich} aktiv="projekte" sprache={sprache}
      titel={titelFuer('projekte', sprache)}
    >
      {(daten) => <ProjekteInhalt mandantId={daten.id} slug={daten.slug} sprache={sprache} />}
    </ProfilRahmen>
  );
}

async function ProjekteInhalt(
  { mandantId, slug, sprache }:
  { readonly mandantId: string; readonly slug: string; readonly sprache: Sprache },
) {
  const referenzen = await oeffentlichLesen((kontext) =>
    new ReferenzAusTabelle({
      unsafe: (sql, werte) => kontext.abfrage(sql, werte),
    }).fuerMandant(mandantId));
  return <ProjekteListe referenzen={referenzen} bereich={slug} sprache={sprache} />;
}

export async function ProjektDetailSeite(
  { bereich, slug, sprache }:
  { readonly bereich: string; readonly slug: string; readonly sprache: Sprache },
) {
  return (
    <ProfilRahmen
      bereich={bereich} aktiv="projekte" sprache={sprache}
      titel={titelFuer('projekte', sprache)}
    >
      {(daten) => <ProjektDetailInhalt mandantId={daten.id} bereich={daten.slug}
                                       slug={slug} sprache={sprache} />}
    </ProfilRahmen>
  );
}

async function ProjektDetailInhalt(
  { mandantId, bereich, slug, sprache }: {
    readonly mandantId: string; readonly bereich: string;
    readonly slug: string; readonly sprache: Sprache;
  },
) {
  const referenz = await oeffentlichLesen((kontext) =>
    new ReferenzAusTabelle({
      unsafe: (sql, werte) => kontext.abfrage(sql, werte),
    }).nachSlug(mandantId, slug));
  /*
   * `notFound()` und nicht „leer": eine Referenz ohne Kundenfreigabe und eine,
   * die es nicht gibt, sehen von aussen gleich aus — und genau so sollen sie
   * aussehen. Ein Unterschied verriete, dass es die Referenz gibt und der
   * Kunde ihrer Veröffentlichung nur nicht zugestimmt hat.
   */
  if (referenz === null) notFound();
  return <ProjektDetail referenz={referenz} bereich={bereich} sprache={sprache} />;
}

/* ------------------------------------------------------------------- Galerie */

export async function GalerieSeite(
  { bereich, sprache }: { readonly bereich: string; readonly sprache: Sprache },
) {
  return (
    <ProfilRahmen
      bereich={bereich} aktiv="galerie" sprache={sprache}
      titel={titelFuer('galerie', sprache)}
    >
      {(daten) => <GalerieInhalt mandantId={daten.id} sprache={sprache} />}
    </ProfilRahmen>
  );
}

async function GalerieInhalt(
  { mandantId, sprache }: { readonly mandantId: string; readonly sprache: Sprache },
) {
  const bilder = await oeffentlichLesen((kontext) =>
    galerieDerGesellschaft(kontext, mandantId));
  return <GalerieRaster bilder={bilder} sprache={sprache} />;
}

/* ------------------------------------------------------- Neuigkeiten/Beiträge */

export async function BeitraegeSeite(
  { bereich, sprache, segment }: {
    readonly bereich: string; readonly sprache: Sprache;
    readonly segment: 'news' | 'beitraege';
  },
) {
  return (
    <ProfilRahmen
      bereich={bereich} aktiv={segment} sprache={sprache}
      titel={titelFuer(segment, sprache)}
    >
      {(daten) => (
        <BeitraegeInhalt mandantId={daten.id} slug={daten.slug}
                         sprache={sprache} segment={segment} />
      )}
    </ProfilRahmen>
  );
}

async function BeitraegeInhalt(
  { mandantId, slug, sprache, segment }: {
    readonly mandantId: string; readonly slug: string;
    readonly sprache: Sprache; readonly segment: 'news' | 'beitraege';
  },
) {
  const beitraege = await oeffentlichLesen((kontext) => (segment === 'news'
    ? oeffentlicheNeuigkeiten(kontext, mandantId)
    : oeffentlicheBeitraege(kontext, mandantId, 24)));
  return (
    <BeitraegeListe beitraege={beitraege} bereich={slug}
                    sprache={sprache} segment={segment} />
  );
}

export async function BeitragDetailSeite(
  { bereich, slug, sprache, segment }: {
    readonly bereich: string; readonly slug: string;
    readonly sprache: Sprache; readonly segment: 'news' | 'beitraege';
  },
) {
  return (
    <ProfilRahmen
      bereich={bereich} aktiv={segment} sprache={sprache}
      titel={titelFuer(segment, sprache)}
    >
      {(daten) => (
        <BeitragDetailInhalt mandantId={daten.id} bereich={daten.slug}
                             slug={slug} sprache={sprache} segment={segment} />
      )}
    </ProfilRahmen>
  );
}

async function BeitragDetailInhalt(
  { mandantId, bereich, slug, sprache, segment }: {
    readonly mandantId: string; readonly bereich: string; readonly slug: string;
    readonly sprache: Sprache; readonly segment: 'news' | 'beitraege';
  },
) {
  const beitrag = await oeffentlichLesen((kontext) =>
    oeffentlicherBeitragNachSlug(kontext, mandantId, slug));
  if (beitrag === null) notFound();
  return (
    <BeitragDetail beitrag={beitrag} bereich={bereich}
                   sprache={sprache} segment={segment} />
  );
}

/* ------------------------------------------------ Kontakt, Unternehmensdaten */

export async function KontaktSeite(
  { bereich, sprache }: { readonly bereich: string; readonly sprache: Sprache },
) {
  return (
    <ProfilRahmen
      bereich={bereich} aktiv="kontakt" sprache={sprache}
      titel={titelFuer('kontakt', sprache)}
    >
      {/*
        * `Kontaktwege` nimmt eine Liste und bekommt hier genau eine
        * Gesellschaft: wer auf der Seite von SSE Security steht, will deren
        * Anschrift, nicht die der vier. Dasselbe Bauteil wie auf `/kontakt`,
        * damit die Schreibweise der Adresse an beiden Stellen dieselbe ist —
        * für eine Suchmaschine sind zwei Schreibweisen zwei Unternehmen.
        */}
      {(daten) => <Kontaktwege bereiche={[daten]} sprache={sprache} />}
    </ProfilRahmen>
  );
}

export async function UnternehmensdatenSeite(
  { bereich, sprache }: { readonly bereich: string; readonly sprache: Sprache },
) {
  return (
    <ProfilRahmen
      bereich={bereich} aktiv="unternehmensdaten" sprache={sprache}
      titel={titelFuer('unternehmensdaten', sprache)}
    >
      {(daten) => <Unternehmensdaten bereich={daten} sprache={sprache} />}
    </ProfilRahmen>
  );
}
