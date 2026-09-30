import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type postgres from 'postgres';
import { AnfrageFormular } from '@/components/oeffentlich/AnfrageFormular';
import { angebotPfad, formularSchluessel } from '@/lib/formular/bereiche';
import { Felder, type FormularFeld } from '@/lib/formular/schema';
import { db } from '@/server/db/pool';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { basisAusAnfrage, herkunftDerAnfrage } from '@/server/inhalt/seiten-daten';
import { uebersetzeFelder, uebersetzeTitel } from '@/lib/i18n/formular-en';
import { ANGEBOT_FEHLER_TEXTE } from '@/lib/i18n/texte';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { alternativen, mitSprache, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/**
 * `/angebot/[bereich]` — das Angebotsanfrage-Formular (REQ-01).
 *
 * Die Felder kommen aus der VEROEFFENTLICHTEN Formularversion, gelesen als
 * Renderer. Was die Seite zeigt, ist damit dasselbe, wogegen die Annahme
 * validiert — es gibt keine zweite Feldliste, die auseinanderlaufen koennte.
 *
 * Ein Bereich ohne veroeffentlichtes Formular ist 404 und kein leeres
 * Formular: CSE Operations hat noch keines (O-61), und ein Formular ohne
 * Felder saehe aus wie ein Fehler beim Laden.
 */

interface Zeile { titel: string; felder: unknown }

async function ladeFormular(bereich: string): Promise<Zeile | null> {
  const schluessel = formularSchluessel(bereich);
  if (schluessel === undefined) return null;
  const zeilen = await (db().begin((tx: postgres.TransactionSql) =>
    withOeffentlich(tx, async (kontext) =>
      kontext.abfrage<Zeile>(
        `select titel, felder from formular_definition
          where schluessel = $1
            and veroeffentlicht_am is not null and zurueckgezogen_am is null`,
        [schluessel],
      ))) as Promise<readonly Zeile[]>);
  return zeilen[0] ?? null;
}

export async function angebotMetadaten(
  bereich: string, sprache: Sprache = VORGABE_SPRACHE,
): Promise<Metadata> {
  const formular = await ladeFormular(bereich);
  if (formular === null) return { title: sprache === 'en' ? 'Not found' : 'Nicht gefunden' };
  const basis = await basisAusAnfrage();
  const pfad = angebotPfad(bereich);
  const schluessel = formularSchluessel(bereich) ?? '';
  return {
    title: sprache === 'en' ? uebersetzeTitel(schluessel, formular.titel) : formular.titel,
    alternates: {
      canonical: `${basis}${mitSprache(pfad, sprache)}`,
      languages: alternativen(pfad, basis),
    },
  };
}

/** Was eine Abweisung auf dem Formular zeigt: den Sammelsatz und die Meldung je Feld. */
export interface Abweisung {
  readonly satz: string;
  /** Feldschlüssel → `fehlermeldung` aus der Definition, in der Sprache der Seite. */
  readonly felder: Readonly<Record<string, string>>;
}

/**
 * Die Abweisung aus der Adresse — ein GRUND und die SCHLÜSSEL der Felder
 * (`?fehler=<grund>&felder=<k1,k2,…>`, D-769, V-272).
 *
 * **Kein Text aus der Adresse.** Hier stand ein JSON-Parser für die
 * Feldmeldungen, und der Parameter `meldung` trug den Sammelsatz: was jemand in
 * einen Link schrieb, stand als Warnung über dem Formular und unter jedem
 * Feld. Jetzt kommt jeder Satz von der Seite selbst — der Sammelsatz aus
 * `API_TEXTE` (nur als eigener Eintrag, D-728; ein fremder Grund bekommt den
 * allgemeinen Satz), die Meldung am Feld aus derselben veröffentlichten
 * Definition, aus der die Seite ihre Felder rendert (`felder` sind die
 * angezeigten — englisch über `uebersetzeFelder`). Ein Schlüssel, den die
 * Definition nicht kennt, fällt weg; es gibt keine zweite Liste (D-599).
 *
 * **Er steht HIER und nicht in `page.tsx`.** Aus einer `page.tsx` erlaubt
 * Next.js nur die bekannten Exporte; ein zusaetzlicher schlaegt beim BAU fehl
 * und nicht bei `npx tsc --noEmit` — die Routentypen entstehen erst dort.
 * Derselbe Grund, aus dem `AngebotSeiteFuer` in dieser Datei steht.
 */
export function abweisungAus(
  suche: Readonly<Record<string, string | string[] | undefined>>,
  felder: readonly FormularFeld[], sprache: Sprache,
): Abweisung | null {
  const grund = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  if (grund === null) return null;
  const t = ANGEBOT_FEHLER_TEXTE[sprache];
  const roh = suche['felder'];
  const genannt = new Set(typeof roh === 'string' ? roh.split(',') : []);
  const markiert: Record<string, string> = {};
  for (const f of felder) {
    if (genannt.has(f.schluessel)) markiert[f.schluessel] = f.fehlermeldung;
  }
  return { satz: eigenerEintrag(t.fehler, grund) ?? t.sonst, felder: markiert };
}

/**
 * Das Formular in einer Sprache.
 *
 * Die FELDER kommen unveraendert aus der veroeffentlichten Definition — sie
 * bestimmen, was validiert und was gespeichert wird. `uebersetzeFelder()` legt
 * nur die Beschriftungen darueber. Damit gibt es weiterhin genau eine
 * Feldliste, und die englische Seite kann nicht gegen eine andere pruefen als
 * die, die sie gezeigt hat.
 */
export async function AngebotSeiteFuer(
  bereich: string, sprache: Sprache = VORGABE_SPRACHE,
  suche: Readonly<Record<string, string | string[] | undefined>> = {},
) {
  const formular = await ladeFormular(bereich);
  if (formular === null) notFound();

  const felder = Felder.safeParse(formular.felder);
  // Eine kaputte Definition ist ein Betreiberfehler. 404 wäre eine Lüge, ein
  // halbes Formular wäre schlimmer.
  if (!felder.success) throw new Error(`Formular ${bereich}: Felddefinition ungültig.`);

  const schluessel = formularSchluessel(bereich) ?? '';
  const felderAnzeige = sprache === 'en'
    ? uebersetzeFelder(schluessel, felder.data) : felder.data;
  const titel = sprache === 'en'
    ? uebersetzeTitel(schluessel, formular.titel) : formular.titel;
  const abweisung = abweisungAus(suche, felderAnzeige, sprache);

  // Die Herkunft DIESES Aufrufs (REQ-07, D-631) — der `Referer` des spaeteren
  // POST ist immer diese Seite und sagt nichts.
  const herkunft = await herkunftDerAnfrage(suche, mitSprache(angebotPfad(bereich), sprache));

  return (
    <AnfrageFormular
      bereich={bereich} titel={titel} felder={felderAnzeige} sprache={sprache}
      herkunft={herkunft}
      {...(abweisung === null ? {} : { meldung: abweisung.satz, fehler: abweisung.felder })}
    />
  );
}
