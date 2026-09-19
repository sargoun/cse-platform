import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgres } from '@/server/services/finanz/menge';
import {
  belegAusgabe, findeKundenrechnung, prozentText, type Rechnungsposition,
} from '@/server/services/kundenportal/rechnung';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { kennungOder404 } from '../../../kennung';
import { kundePortal, KundenRahmen } from '../../rahmen';
import {
  Feld, Felder, Gesellschaft, KeinZugang, Kopfzeile, Offen, Zurueck,
} from '../../bausteine';

/**
 * `/portal/kunde/rechnungen/[id]` — der Beleg, wie der Kunde ihn bekommt
 * (FIN-11, FIN-12, DOC-03, K-12, AUT-06).
 *
 * ===========================================================================
 * Es wird auf dieser Seite NICHTS gerechnet
 * ===========================================================================
 *
 * Jede Zahl kommt als Ganzzahl-Cent aus der Datenbank und laeuft durch
 * `formatiereGeld` (Invariante 1, K-16). Die Umsatzsteuer steht je
 * Steuersatzgruppe in `rechnung_steuer` — sie wird nie aus einem Bruttobetrag
 * zurueckgerechnet, und die Netto-, Steuer- und Bruttosumme stehen am Beleg.
 * Eine Summe, die hier gebildet wuerde, waere eine zweite Wahrheit neben der
 * festgeschriebenen (CLAUDE.md: „No calculation in a component, ever").
 *
 * **Kein Entwurfsformular.** Die interne Seite zeigt je nach Zustand einen
 * Editor ODER die festgeschriebene Ansicht; hier gibt es nur die zweite, weil
 * es nur festgeschriebene Belege gibt (`p_rechnung_decke`).
 *
 * **Keine Herkunftszeilen, kein Nummernkreis, kein Hash, kein
 * Ausgangsbucheintrag** — die Begruendung je Auslassung steht im Dienst
 * (`services/kundenportal/rechnung.ts`).
 *
 * **PDF und XRechnung kommen aus dem SNAPSHOT** (K-12) und deshalb aus
 * eigenen Kundenrouten unter `/api/kunde/rechnungen/[id]/…`: die internen
 * Routen brechen mit 401 ab, wenn `sitzung.aktiverMandantId` null ist, und im
 * Kunden-Scope ist sie das immer (K-20). Die bestehenden Routen werden dafuer
 * nicht aufgeweicht.
 */
export const dynamic = 'force-dynamic';

const ART: Readonly<Record<string, string>> = {
  standard: 'Rechnung',
  abschlag: 'Abschlagsrechnung',
  anzahlung: 'Anzahlungsrechnung',
  schluss: 'Schlussrechnung',
  storno: 'Storno',
};

export default async function Kundenrechnung(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: roh } = await params;
  const id = kennungOder404(roh);

  const ergebnis = await kundePortal(`/portal/kunde/rechnungen/${id}`,
    async (kontext) => {
      const rechnung = await findeKundenrechnung(kontext, id);
      if (rechnung === null) return null;
      /*
       * Ob aus dem Beleg eine Datei entsteht, wird VORHER geprueft — mit
       * derselben Funktion, die das Dokument prueft. Ein Knopf, der eine
       * JSON-Fehlermeldung mit BT-Nummern herunterlaedt, ist schlechter als
       * ein Satz, der sagt, was fehlt (die Begruendung steht im Dienst).
       */
      return { rechnung, ausgabe: await belegAusgabe(kontext, id) };
    },
    ['finanzen.herunterladen']);

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Rechnung" aktiverTab="rechnungen">
        <Kopfzeile titel="Rechnung" />
        <KeinZugang />
      </KundenRahmen>
    );
  }
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const { rechnung: r, ausgabe } = ergebnis.daten;
  const darfHerunterladen = basis.rechte['finanzen.herunterladen'] === true;

  return (
    <KundenRahmen basis={basis} titel={r.nummer} aktiverTab="rechnungen">
      <Zurueck ziel="/portal/kunde/rechnungen" text="Alle Rechnungen" />

      <Kopfzeile titel={r.nummer}>
        <span className="inline-flex flex-wrap items-center gap-s2">
          <StatusPill zustand="Abgeschlossen" />
          {r.storniertDurch === null ? null : (
            <span data-cse="storniert" className="text-sm text-text-muted">
              aufgehoben durch {r.storniertDurch}
            </span>
          )}
        </span>
      </Kopfzeile>

      <Card className="mb-s5">
        <Felder>
          <Feld label="Gesellschaft">
            <Gesellschaft slug={r.mandantSlug} name={r.mandantName} />
          </Feld>
          <Feld label="Art">{ART[r.rechnungsart] ?? r.rechnungsart}</Feld>
          <Feld label="Rechnungsdatum">
            <span className="cse-zahl">{r.rechnungsdatumLokal ?? '—'}</span>
          </Feld>
          <Feld label="Leistungszeitraum">
            <span className="cse-zahl">
              {r.leistungVonLokal === null && r.leistungBisLokal === null
                ? '—'
                : `${r.leistungVonLokal ?? '?'} – ${r.leistungBisLokal ?? '?'}`}
            </span>
          </Feld>
          <Feld label="Fällig am">
            <span className="cse-zahl">{r.faelligAmLokal ?? '—'}</span>
          </Feld>
          {r.zahlungszielTage !== null && (
            <Feld label="Zahlungsziel">
              <span className="cse-zahl">{r.zahlungszielTage}</span> Tage
            </Feld>
          )}
          {r.skontoBp !== null && r.skontoTage !== null && (
            <Feld label="Skonto">
              {prozentText(r.skontoBp)} bei Zahlung innerhalb von{' '}
              <span className="cse-zahl">{r.skontoTage}</span> Tagen
            </Feld>
          )}
          {r.bestellnummerKunde !== null && (
            <Feld label="Ihre Bestellnummer">{r.bestellnummerKunde}</Feld>
          )}
          {r.leitwegId !== null && <Feld label="Leitweg-ID">{r.leitwegId}</Feld>}
          <Feld label="Festgeschrieben (Berlin)">
            <span className="cse-zahl">{r.festgeschriebenLokal ?? '—'}</span>
          </Feld>
        </Felder>

        {r.kopftext === null ? null : (
          <p className="mt-s5 mb-0 max-w-prose whitespace-pre-line text-base text-text">
            {r.kopftext}
          </p>
        )}
      </Card>

      <h2 className="mb-s3 text-h3 text-text">Positionen</h2>
      {r.positionen.length === 0 ? (
        <p className="m-0 mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Dieser Beleg führt keine Einzelpositionen.
        </p>
      ) : (
        <div className="mb-s5">
          <DataTable
            beschriftung="Positionen der Rechnung mit Menge, Einheit, Einzelpreis, Netto und Steuersatz"
            zeilen={r.positionen}
            schluessel={(p: Rechnungsposition) => String(p.nr)}
            spalten={[
              { schluessel: 'nr', kopf: 'Pos.', numerisch: true, zelle: (p) => String(p.nr) },
              {
                schluessel: 'bezeichnung',
                kopf: 'Bezeichnung',
                zelle: (p) => (
                  <span>
                    <span className="text-text">{p.bezeichnung}</span>
                    {p.beschreibung === null ? null : (
                      <span className="block text-sm text-text-muted">{p.beschreibung}</span>
                    )}
                    {p.leistungVonLokal === null && p.leistungBisLokal === null ? null : (
                      <span className="block cse-zahl text-sm text-text-subtle">
                        {p.leistungVonLokal ?? '?'} – {p.leistungBisLokal ?? '?'}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'menge',
                kopf: 'Menge',
                numerisch: true,
                /*
                 * `formatiereMenge(mengeAusPostgres(...))` — eine Menge ist
                 * ein `numeric` und kommt als Text; sie durch `Number`
                 * laufen zu lassen waere der Gleitkommafehler, den R-15
                 * ausschliesst.
                 */
                zelle: (p) => p.menge === null
                  ? '—'
                  : `${formatiereMenge(mengeAusPostgres(p.menge))} ${p.einheit ?? ''}`,
              },
              {
                schluessel: 'einzelpreis',
                kopf: 'Einzelpreis',
                numerisch: true,
                zelle: (p) => p.einzelpreisCent === null
                  ? '—'
                  : formatiereGeld(cent(BigInt(p.einzelpreisCent))),
              },
              {
                schluessel: 'rabatt',
                kopf: 'Rabatt',
                numerisch: true,
                zelle: (p) => p.rabattBp === null || p.rabattBp === 0
                  ? <span className="text-text-subtle">—</span>
                  : prozentText(p.rabattBp),
              },
              {
                schluessel: 'netto',
                kopf: 'Netto',
                numerisch: true,
                /*
                 * Wie `menge` und `einzelpreis`: eine `textzeile` oder
                 * `zwischensumme` traegt laut CHECK
                 * `rp_ohne_leistung_ohne_betrag` KEINEN Betrag. `BigInt(null)`
                 * wuerfe, und der Kunde saehe seinen eigenen Beleg nicht mehr.
                 */
                zelle: (p) => p.nettoCent === null
                  ? <span className="text-text-subtle">—</span>
                  : formatiereGeld(cent(BigInt(p.nettoCent))),
              },
              { schluessel: 'satz', kopf: 'USt.', numerisch: true, zelle: (p) => prozentText(p.satzBp) },
            ]}
          />
        </div>
      )}

      {r.zuschlaege.length > 0 && (
        <>
          <h2 className="mb-s3 text-h3 text-text">Zuschläge und Abzüge</h2>
          <ul className="m-0 mb-s5 flex list-none flex-col gap-s2 p-0">
            {r.zuschlaege.map((z, i) => (
              <li
                key={`${z.art}-${z.bezeichnung}-${i}`}
                className="flex flex-wrap justify-between gap-s3 rounded-lg border border-line bg-surface p-s4 text-base text-text"
              >
                <span>
                  {z.bezeichnung}
                  {z.satzBp === null ? null : (
                    <span className="text-text-muted"> ({prozentText(z.satzBp)})</span>
                  )}
                </span>
                <span className="cse-zahl">
                  {formatiereGeld(cent(BigInt(z.betragCent)))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mb-s3 text-h3 text-text">Summen</h2>
      <Card className="mb-s5">
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-s5 gap-y-s2">
          <dt className="text-base text-text-muted">Netto</dt>
          <dd className="m-0 cse-zahl text-base text-text">
            {formatiereGeld(cent(BigInt(r.nettoGesamtCent)))}
          </dd>

          {/*
            * Die Steuer je STEUERSATZGRUPPE, nicht als eine Zahl: Invariante 1
            * verlangt sie je Gruppe gerechnet, und ein Beleg mit 19 % und 7 %
            * hat zwei Zeilen. Ein Befreiungsgrund steht dort, wo der Satz 0
            * ist — sonst stuende „0,00 EUR" ohne Erklaerung.
            */}
          {r.steuern.map((s, i) => (
            <div key={`${s.kategorie}-${s.satzBp}-${i}`} className="contents">
              <dt className="text-base text-text-muted">
                Umsatzsteuer {prozentText(s.satzBp)}
                <span className="block text-sm text-text-subtle">
                  auf {formatiereGeld(cent(BigInt(s.nettoCent)))}
                  {s.befreiungsgrundText === null ? null : ` · ${s.befreiungsgrundText}`}
                </span>
              </dt>
              <dd className="m-0 cse-zahl text-base text-text">
                {formatiereGeld(cent(BigInt(s.steuerCent)))}
              </dd>
            </div>
          ))}

          <dt className="border-t border-line pt-s3 text-base text-text">Brutto</dt>
          <dd className="m-0 border-t border-line pt-s3 cse-zahl text-base text-text">
            {formatiereGeld(cent(BigInt(r.bruttoCent)))}
          </dd>

          {r.abzugBruttoCent !== '0' && (
            <div className="contents">
              <dt className="text-base text-text-muted">Bereits berechnete Abschläge</dt>
              <dd className="m-0 cse-zahl text-base text-text">
                −{formatiereGeld(cent(BigInt(r.abzugBruttoCent)))}
              </dd>
            </div>
          )}

          <dt className="border-t border-line pt-s3 text-h3 text-text">Zahlbetrag</dt>
          <dd
            data-cse="zahlbetrag"
            className="m-0 border-t border-line pt-s3 cse-zahl text-h3 text-text"
          >
            {formatiereGeld(cent(BigInt(r.zahlbetragCent)))}
          </dd>
        </dl>

        {r.zahlungsbedingungText === null ? null : (
          <p className="mt-s4 mb-0 max-w-prose text-sm text-text-muted">
            {r.zahlungsbedingungText}
          </p>
        )}
        {r.reverseCharge && (
          <p data-cse="reverse-charge" className="mt-s4 mb-0 max-w-prose text-sm text-text">
            Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG).
          </p>
        )}
        {r.steuerhinweis === null ? null : (
          <p className="mt-s4 mb-0 max-w-prose text-sm text-text">{r.steuerhinweis}</p>
        )}
      </Card>

      {r.fusstext === null ? null : (
        <p className="mb-s5 max-w-prose whitespace-pre-line text-sm text-text-muted">
          {r.fusstext}
        </p>
      )}

      <h2 className="mb-s3 text-h3 text-text">Beleg herunterladen</h2>
      {!darfHerunterladen ? (
        <p className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für diese Anmeldung ist das Herunterladen nicht freigegeben.
        </p>
      ) : ausgabe.art === 'kein_snapshot' ? (
        /*
         * Ohne Snapshot entsteht KEIN Dokument (K-12) — die Route antwortet
         * 409, und ein Knopf, der einen Fehler laedt, ist schlechter als
         * keiner. Der Satz sagt, was los ist, statt es zu verschweigen.
         */
        <p data-cse="kein-snapshot" className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Zu diesem Beleg liegt keine archivierte Fassung vor. PDF und
          XRechnung entstehen ausschließlich daraus — aus den heutigen
          Stammdaten wäre es ein zweites Dokument zu derselben Nummer. Ihre
          Ansprechpartnerin kann den Beleg auf dem bisherigen Weg schicken.
        </p>
      ) : ausgabe.art !== 'moeglich' ? (
        /*
         * Die ZAHL, nicht die Feldliste: welche Pflichtangabe der EN 16931
         * fehlt (BT-49, BT-10 …), ist eine Auskunft fuer das Haus — dort
         * sitzt jemand, der sie pflegen kann. Der Kunde braucht zu wissen,
         * dass die Datei nicht kommt und auf welchem Weg der Beleg kommt.
         */
        <p
          data-cse="beleg-unvollstaendig"
          data-grund={ausgabe.art}
          className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
        >
          Dieser Beleg lässt sich noch nicht als E-Rechnung ausgeben: es fehlt
          {ausgabe.art === 'unvollstaendig'
            ? ` ${String(ausgabe.anzahl)} Pflichtangabe${ausgabe.anzahl === 1 ? '' : 'n'} der europäischen Norm EN 16931`
            : ' die neue Fassung der archivierten Angaben'}
          . Ein halbes Dokument entsteht nicht — es würde beim Einlesen
          abgewiesen, und zwar erst Wochen später. Ihre Ansprechpartnerin
          schickt Ihnen den Beleg auf dem bisherigen Weg.
        </p>
      ) : (
        <div className="flex flex-wrap gap-s3">
          <a
            href={`/api/kunde/rechnungen/${r.id}/zugferd.pdf`}
            data-cse="beleg-pdf"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text no-underline hover:bg-surface-2"
          >
            PDF mit ZUGFeRD
          </a>
          <a
            href={`/api/kunde/rechnungen/${r.id}/xrechnung.xml`}
            data-cse="beleg-xml"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text no-underline hover:bg-surface-2"
          >
            XRechnung (XML)
          </a>
        </div>
      )}

      <div className="mt-s5 flex flex-col gap-s4">
        <Offen
          nummer="O-74"
          was="Rückfragen zu diesem Beleg laufen über Ihre Ansprechpartnerin"
          weg="Das Portal ist lesend; ob ein Kundenzugang eine Rechnung im
            Portal beanstanden kann, ist noch nicht entschieden."
        />
      </div>
    </KundenRahmen>
  );
}
