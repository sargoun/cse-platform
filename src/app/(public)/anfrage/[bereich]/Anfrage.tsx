import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type postgres from 'postgres';
import { AnfrageFormular } from '@/components/oeffentlich/AnfrageFormular';
import { formularSchluessel } from '@/lib/formular/bereiche';
import { Felder } from '@/lib/formular/schema';
import { db } from '@/server/db/pool';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { uebersetzeFelder, uebersetzeTitel } from '@/lib/i18n/formular-en';
import { alternativen, mitSprache, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/**
 * `/anfrage/[bereich]` — das Angebotsanfrage-Formular (REQ-01).
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

export async function anfrageMetadaten(
  bereich: string, sprache: Sprache = VORGABE_SPRACHE,
): Promise<Metadata> {
  const formular = await ladeFormular(bereich);
  if (formular === null) return { title: sprache === 'en' ? 'Not found' : 'Nicht gefunden' };
  const basis = await basisAusAnfrage();
  const pfad = `/anfrage/${bereich}`;
  const schluessel = formularSchluessel(bereich) ?? '';
  return {
    title: sprache === 'en' ? uebersetzeTitel(schluessel, formular.titel) : formular.titel,
    alternates: {
      canonical: `${basis}${mitSprache(pfad, sprache)}`,
      languages: alternativen(pfad, basis),
    },
  };
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
export async function AnfrageSeiteFuer(
  bereich: string, sprache: Sprache = VORGABE_SPRACHE,
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

  return (
    <AnfrageFormular
      bereich={bereich} titel={titel} felder={felderAnzeige} sprache={sprache}
    />
  );
}
