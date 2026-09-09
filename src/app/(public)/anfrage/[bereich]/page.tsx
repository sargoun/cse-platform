import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type postgres from 'postgres';
import { AnfrageFormular } from '@/components/oeffentlich/AnfrageFormular';
import { formularSchluessel } from '@/lib/formular/bereiche';
import { Felder } from '@/lib/formular/schema';
import { db } from '@/server/db/pool';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';

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
export const dynamic = 'force-dynamic';


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

export async function generateMetadata(
  { params }: { params: Promise<{ bereich: string }> },
): Promise<Metadata> {
  const { bereich } = await params;
  const formular = await ladeFormular(bereich);
  if (formular === null) return { title: 'Nicht gefunden' };
  const basis = await basisAusAnfrage();
  return {
    title: formular.titel,
    alternates: { canonical: `${basis}/anfrage/${bereich}` },
  };
}

export default async function AnfrageSeite(
  { params }: { params: Promise<{ bereich: string }> },
) {
  const { bereich } = await params;
  const formular = await ladeFormular(bereich);
  if (formular === null) notFound();

  const felder = Felder.safeParse(formular.felder);
  // Eine kaputte Definition ist ein Betreiberfehler. 404 wäre eine Lüge, ein
  // halbes Formular wäre schlimmer.
  if (!felder.success) throw new Error(`Formular ${bereich}: Felddefinition ungültig.`);

  return (
    <AnfrageFormular bereich={bereich} titel={formular.titel} felder={felder.data} />
  );
}
