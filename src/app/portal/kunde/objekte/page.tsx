import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { formatiereMenge, mengeAusPostgres } from '@/server/services/finanz/menge';
import {
  listeKundenobjekte, objektGesellschaften, type Kundenobjekt,
} from '@/server/services/kundenportal/objekt';
import { AnmeldungNoetig } from '../../Anmeldung';
import { kundePortal, KundenRahmen } from '../rahmen';
import {
  Gesellschaft, GesellschaftsFilter, KeinZugang, Kopfzeile, Leer, slugAus,
} from '../bausteine';

/**
 * `/portal/kunde/objekte` — die eigenen Liegenschaften (OPS-01, OPS-02,
 * 04-SEITENKARTE §8: „their objects, Raumbuch read-only").
 *
 * **Ein Objekt OHNE Kundenzuordnung erscheint hier nie**, und das ist
 * Absicht: `t_kunde` auf `objekt` verlangt
 * `kunde_id = any (app.aktuelle_kunden())`, und `kunde_id` ist nullbar. 0021
 * sagt es woertlich — „ein Veranstaltungsort ohne Kundenstamm gehoert
 * niemandem, also sieht ihn im Kundenportal auch niemand".
 *
 * **Keine Spalte „Belag" und keine „Reinigungsklasse".** Beide Kataloge
 * tragen eine restriktive Decke gegen das Kundenportal und kein `t_kunde`
 * (0021); ein `left join` darauf ergaebe fuer JEDEN Raum „—" und liese sich
 * wie „nicht erfasst", obwohl das Raumbuch gepflegt ist (K-18). Die
 * ausfuehrliche Begruendung steht im Dienst.
 *
 * **Keine Koordinaten.** `geo_lat`/`geo_lon` dienen der Einsatzsteuerung; die
 * ANSCHRIFT ist das, was der Kunde wiedererkennt.
 *
 * **Die Flaechensumme kommt aus Postgres.** `flaeche_qm` ist
 * `numeric(12,3)`; sie in der Seite zu addieren hiesse, sie durch `Number` zu
 * drehen (R-15, K-16). Hier wird sie nur formatiert.
 */
export const dynamic = 'force-dynamic';

export default async function Kundenobjekte(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const slug = slugAus(await searchParams);

  const ergebnis = await kundePortal('/portal/kunde/objekte', async (kontext) => ({
    objekte: await listeKundenobjekte(kontext, { mandantSlug: slug }),
    gesellschaften: await objektGesellschaften(kontext),
  }));

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Objekte" aktiverTab="objekte">
        <Kopfzeile titel="Objekte" />
        <KeinZugang />
      </KundenRahmen>
    );
  }

  const { basis, daten } = ergebnis;

  return (
    <KundenRahmen basis={basis} titel="Objekte" aktiverTab="objekte">
      <Kopfzeile titel="Objekte" />

      <GesellschaftsFilter
        wurzel="/portal/kunde/objekte"
        gesellschaften={daten.gesellschaften}
        aktiv={slug}
      />

      {daten.objekte.length === 0 ? (
        <Leer text={slug === null
          ? 'Für diesen Zugang ist keine Liegenschaft hinterlegt. Ein Objekt erscheint hier, sobald es Ihnen als Kunde zugeordnet ist — ein Veranstaltungsort ohne Kundenzuordnung erscheint nicht.'
          : 'Diese Gesellschaft betreut für Sie keine Liegenschaft. Über „Alle" sehen Sie die übrigen.'} />
      ) : (
        <DataTable
          beschriftung="Objekte mit Nummer, Bezeichnung, Anschrift, Räumen, Fläche und Gesellschaft"
          zeilen={daten.objekte}
          schluessel={(o: Kundenobjekt) => o.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (o) => (
                <Link
                  href={`/portal/kunde/objekte/${o.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {o.objektnummer}
                </Link>
              ),
            },
            {
              schluessel: 'bezeichnung',
              kopf: 'Bezeichnung',
              zelle: (o) => (
                <span>
                  <span className="text-text">{o.bezeichnung}</span>
                  {o.gebaeudetyp === null ? null : (
                    <span className="block text-sm text-text-muted">{o.gebaeudetyp}</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'anschrift',
              kopf: 'Anschrift',
              zelle: (o) => (
                <span>
                  <span className="block text-text">
                    {o.strasse}{o.hausnummer === null ? '' : ` ${o.hausnummer}`}
                  </span>
                  <span className="block text-sm text-text-muted">
                    <span className="cse-zahl">{o.plz}</span> {o.ort}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'raeume',
              kopf: 'Räume',
              numerisch: true,
              /*
               * „—" und nicht „0": ein Objekt ohne Raumbuch ist eines, das
               * noch nicht aufgenommen wurde — nicht eines ohne Raeume. Die
               * Null waere hier eine Tatsachenbehauptung.
               */
              zelle: (o) => o.raeume === 0
                ? <span className="text-text-subtle">—</span>
                : String(o.raeume),
            },
            {
              schluessel: 'flaeche',
              kopf: 'Fläche',
              numerisch: true,
              zelle: (o) => o.raeume === 0
                ? <span className="text-text-subtle">—</span>
                : `${formatiereMenge(mengeAusPostgres(o.flaecheQm))} m²`,
            },
            {
              schluessel: 'auftraege',
              kopf: 'Aufträge',
              numerisch: true,
              zelle: (o) => o.auftraegeAktiv === 0
                ? <span className="text-text-subtle">—</span>
                : String(o.auftraegeAktiv),
            },
            {
              schluessel: 'gesellschaft',
              kopf: 'Gesellschaft',
              zelle: (o) => <Gesellschaft slug={o.mandantSlug} name={o.mandantName} />,
            },
          ]}
        />
      )}
    </KundenRahmen>
  );
}
