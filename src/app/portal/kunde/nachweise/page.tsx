import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import {
  kundenUnterschriften, listeKundennachweise,
  type Kundennachweis, type Kundenunterschrift,
} from '@/server/services/kundenportal/nachweis';
import { AnmeldungNoetig } from '../../Anmeldung';
import { kundePortal, KundenRahmen } from '../rahmen';
import { Gesellschaft, KeinZugang, Kopfzeile, Leer, Offen } from '../bausteine';

/**
 * `/portal/kunde/nachweise` — Leistungsnachweise und Aufmasse in einer Liste
 * (CLN-04, BAU-02, BAU-03, 04-SEITENKARTE §8).
 *
 * **Zwei Quellen, eine Liste.** Ein Kunde, der von der Reinigung UND vom Bau
 * beliefert wird (O-52), hat fuer beides dieselbe Frage: „was habe ich
 * unterschrieben, und wann". Die Zusammenfuehrung und die Sortierung laufen in
 * der Datenbank (`union all` mit `order by` ueber das ISO-Datum) — in
 * TypeScript zusammengefuegt waere die Reihenfolge eine, die kein Test sieht.
 *
 * **Die Unterschriften kommen aus einer EIGENEN, schmalen Projektion und
 * nicht aus `ladeSignaturen`.** Der vorhandene Dienst fuehrt Breiten- und
 * Laengengrad, Geraeteuhr, Zeitabweichung, IP und den vollstaendigen
 * Signatur-Snapshot mit; fuer die Rolle `auftragnehmer` sind das die
 * Standortdaten der eingesetzten Kraft. RLS wirkt zeilen-, nicht spaltenweise
 * — die Policy laesst die Zeile zu Recht durch, weil sie zum Nachweis DIESES
 * Kunden gehoert. Welche Spalten der Kunde sieht, entscheidet allein die
 * Projektion (`services/kundenportal/nachweis.ts`).
 *
 * **Es wird auf dieser Seite nichts gerechnet.** Die Nachweisliste fuehrt
 * bewusst keine Betraege: ein Leistungsnachweis ist der Nachweis der
 * LEISTUNG, die Geldseite steht auf der Rechnung. Wer beides auf einem
 * Bildschirm addiert, addiert an einer Stelle, an der niemand es prueft
 * (Invariante 1, „keine Berechnung in einer Komponente").
 *
 * **Kein Signaturfeld, kein Ablehnen-Knopf.** Die Gegenzeichnung findet heute
 * vor Ort statt; ob der Kunde im Portal gegenzeichnen darf, ist O-89.
 */
export const dynamic = 'force-dynamic';

/**
 * Die Zustaende beider Quellen auf das FESTE Pillenvokabular von DESIGN §5
 * abgebildet.
 *
 * „Vorgelegt" und „Signiert" stehen nicht in DESIGN §5, und `StatusPill`
 * laesst eine unbekannte Beschriftung gar nicht zu (der Typ macht sie
 * unrepraesentierbar). Abgebildet und nicht erfunden — dieselbe Regel, mit
 * der die interne Rechnungsliste `festgeschrieben` auf `Abgeschlossen`
 * abbildet.
 *
 * Die Decken lassen dem Kunden ohnehin nur die freigegebenen Zustaende:
 * Leistungsnachweis `vorgelegt`/`signiert` und nicht storniert, Aufmass
 * `status <> 'entwurf'` und nicht storniert. Ein unbekannter Wert faellt
 * deshalb auf `In Prüfung` und nicht auf einen erfundenen Zustand.
 */
const PILLE: Readonly<Record<string, PillZustand>> = {
  // `leistungsnachweis_status`: entwurf, vorgelegt, signiert, abgelehnt, storniert.
  vorgelegt: 'In Prüfung',
  signiert: 'Abgeschlossen',
  // `aufmass_status`: entwurf, vorgelegt, gegengezeichnet,
  // einseitig_festgestellt, abgelehnt, storniert.
  gegengezeichnet: 'Abgeschlossen',
  /*
   * „Einseitig festgestellt" ist nach VOB/B § 14 Abs. 2 ein eigener Zustand:
   * der Auftragnehmer hat allein aufgemessen, weil der Auftraggeber zum
   * Termin nicht erschienen ist. `Bereit` und nicht `Abgeschlossen` — es ist
   * gueltig, aber es fehlt eine Unterschrift, und genau das soll der Kunde
   * sehen.
   */
  einseitig_festgestellt: 'Bereit',
  abgelehnt: 'Abgelehnt',
};

/** `aufmass_erhebungsart`: gemeinsam, einseitig — nachgesehen, nicht geraten. */
const ERHEBUNG: Readonly<Record<string, string>> = {
  gemeinsam: 'gemeinsam aufgemessen',
  einseitig: 'einseitig aufgemessen',
};

export default async function Kundennachweise() {
  const ergebnis = await kundePortal('/portal/kunde/nachweise', async (kontext) => {
    const nachweise = await listeKundennachweise(kontext);
    /*
     * Eine Abfrage fuer alle Unterschriften, nicht eine je Zeile: bei 200
     * Nachweisen waeren das 200 Rundreisen. Die Kennungen werden nach Art
     * getrennt uebergeben, weil sie in zwei verschiedenen Tabellen haengen.
     */
    const unterschriften = await kundenUnterschriften(
      kontext,
      nachweise.filter((n) => n.art === 'leistungsnachweis').map((n) => n.id),
      nachweise.filter((n) => n.art === 'aufmass').map((n) => n.id),
    );
    return { nachweise, unterschriften };
  },
  /*
   * AUT-06: die Objekt-/Projektspalte verweist auf `/portal/kunde/projekte/[id]`,
   * und die Route verlangt laut Manifest `bau.lesen`. Wer das Recht nicht
   * haelt, sah den Verweis und bekam dahinter ein 404 — ein Verweis auf 404
   * verraet die Existenz dessen, was er nicht zeigen darf.
   */
  ['bau.lesen']);

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Nachweise" aktiverTab="nachweise">
        <Kopfzeile titel="Nachweise" />
        <KeinZugang />
      </KundenRahmen>
    );
  }

  const { basis, daten } = ergebnis;
  const jeNachweis = new Map<string, Kundenunterschrift[]>();
  for (const u of daten.unterschriften) {
    const liste = jeNachweis.get(u.nachweisId) ?? [];
    liste.push(u);
    jeNachweis.set(u.nachweisId, liste);
  }
  const offen = daten.nachweise.filter((n) => !n.gegengezeichnet).length;

  return (
    <KundenRahmen basis={basis} titel="Nachweise" aktiverTab="nachweise">
      <Kopfzeile titel="Nachweise">
        {offen > 0 && (
          <p data-cse="nachweise-offen" className="m-0 text-base text-text-muted">
            <span className="cse-zahl">{offen}</span> ohne Ihre Unterschrift
          </p>
        )}
      </Kopfzeile>

      <p className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        Leistungsnachweise der Gebäudereinigung und Aufmaße des Baus, in einer
        Liste. Alle Zeitpunkte sind Serverzeit in Berliner Ortszeit — das gilt
        auch für die Unterschriften.
      </p>

      {daten.nachweise.length === 0 ? (
        <Leer text="Es liegt kein Nachweis vor. Leistungsnachweise erscheinen hier,
          sobald sie vorgelegt sind; Aufmaße, sobald sie den Entwurf verlassen
          haben." />
      ) : (
        <DataTable
          beschriftung="Nachweise mit Art, Nummer, Bezug, Zeitraum, Gesellschaft und Unterschriften"
          zeilen={daten.nachweise}
          schluessel={(n: Kundennachweis) => `${n.art}-${n.id}`}
          spalten={[
            {
              schluessel: 'art',
              kopf: 'Art',
              zelle: (n) => n.art === 'aufmass' ? 'Aufmaß' : 'Leistungsnachweis',
            },
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              /*
               * `leistungsnachweis.nummer` ist nullable und wird von keiner
               * Constraint erzwungen — eine leere Zelle saehe aus wie ein
               * Anzeigefehler.
               */
              zelle: (n) => n.nummer ?? <span className="text-text-subtle">ohne Nummer</span>,
            },
            {
              schluessel: 'bezug',
              kopf: 'Objekt / Projekt',
              zelle: (n) => n.projektId !== null && basis.rechte['bau.lesen'] === true ? (
                <Link
                  href={`/portal/kunde/projekte/${n.projektId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {n.bezug ?? 'Projekt öffnen'}
                </Link>
              ) : (n.bezug ?? <span className="text-text-subtle">—</span>),
            },
            {
              schluessel: 'zeitraum',
              kopf: 'Zeitraum / Messdatum',
              zelle: (n) => <span className="cse-zahl">{n.zeitraumLokal}</span>,
            },
            {
              schluessel: 'umfang',
              kopf: 'Umfang',
              zelle: (n) => n.zeilen === null
                ? <span className="text-text-subtle">—</span>
                : (
                  <span>
                    <span className="cse-zahl">{n.zeilen}</span>
                    {' Zeilen'}
                    {n.erhebungsart === null ? null : (
                      <span className="block text-sm text-text-muted">
                        {ERHEBUNG[n.erhebungsart] ?? n.erhebungsart}
                      </span>
                    )}
                  </span>
                ),
            },
            {
              schluessel: 'gesellschaft',
              kopf: 'Gesellschaft',
              zelle: (n) => <Gesellschaft slug={n.mandantSlug} name={n.mandantName} />,
            },
            {
              schluessel: 'unterschriften',
              kopf: 'Unterschriften',
              zelle: (n) => {
                const liste = jeNachweis.get(n.id) ?? [];
                if (liste.length === 0) {
                  return <span className="text-text-subtle">keine</span>;
                }
                return (
                  <ul className="m-0 flex list-none flex-col gap-s1 p-0">
                    {liste.map((u, i) => (
                      <li key={`${u.rolle}-${u.unterzeichnetAmLokal}-${i}`} className="text-sm">
                        <span className="text-text">
                          {u.rolle === 'auftraggeber'
                            ? (u.name ?? 'Ihre Unterschrift')
                            : 'Unterschrift der Gesellschaft'}
                        </span>
                        {u.funktion === null ? null : (
                          <span className="text-text-muted">, {u.funktion}</span>
                        )}
                        <span className="cse-zahl text-text-muted">
                          {' · '}{u.unterzeichnetAmLokal}
                        </span>
                        {u.nachgetragen && (
                          <span data-cse="nachgetragen" className="text-warning">
                            {' · nachgetragen'}
                          </span>
                        )}
                        {u.vorbehalt === null ? null : (
                          <span className="block text-text-muted">
                            Vorbehalt: {u.vorbehalt}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                );
              },
            },
            {
              schluessel: 'status',
              kopf: 'Zustand',
              zelle: (n) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={PILLE[n.status] ?? 'In Prüfung'} />
                  {n.gegengezeichnet && (
                    <span className="text-xs text-text-muted">gegengezeichnet</span>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}

      <div className="mt-s5 flex flex-col gap-s4">
        <Offen
          nummer="O-89"
          was="Gegenzeichnen geht vor Ort, nicht im Portal"
          weg="Ob ein Kundenzugang einen Nachweis im Portal gegenzeichnen oder
            ablehnen darf, ist noch nicht entschieden; heute unterschreibt Ihre
            Objektverantwortliche beim Termin."
        />
      </div>
    </KundenRahmen>
  );
}
