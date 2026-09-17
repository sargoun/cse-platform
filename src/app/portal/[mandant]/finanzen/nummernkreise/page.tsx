import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { kreise, type Kreis } from '@/server/services/finanz/kreisuebersicht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/finanzen/nummernkreise` — die Nummernkreise einer
 * Gesellschaft, **Zähler lesend** (04-SEITENKARTE.md §5.14, TEN-02, FIN-03,
 * FIN-16).
 *
 * **Der Zähler ist ANSICHT und nirgends Eingabefeld.** `naechste_nummer` wird
 * ausschliesslich unter `SELECT … FOR UPDATE` in der
 * Festschreibungstransaktion fortgezählt (§5.6). Ein Formular darauf wäre der
 * kürzeste Weg zu zwei Rechnungen mit derselben Nummer — und §14 UStG duldet
 * weder Lücke noch Doppelung.
 *
 * **Es gibt hier keinen Knopf „Neuer Kreis" und keinen „Jahreswechsel".** Der
 * Jahreswechsel ist ein beschriebener Vorgang: Vorgänger schliessen,
 * `letzter_hash` als `genesis_hash` des Nachfolgers eintragen, Vorgänger
 * verweisen. Wer ihn ausführt, ist offen (O-352) — und ein Knopf erfände die
 * Rolle, die ihn auslöst. Der Vorgang steht deshalb als Text da, nicht als
 * Schalter.
 *
 * **Ein Kreis mit unbestätigter Maske trägt das sichtbar** (O-134): ein Kreis
 * je Gesellschaft oder je Gesellschaft und Belegart, Nummer fortlaufend oder
 * am 1. Januar zurückgesetzt, und wie die Maske genau lautet — alles offen.
 * Solange `ist_platzhalter` steht, wird in diesem Kreis nicht festgeschrieben,
 * und die Seite sagt das an der Zeile.
 *
 * **Der Widerspruch, der an dieser Seite auffällt und den sie NICHT auflöst:**
 * die Demokreise heissen „Ausgangsrechnungen (DEMO — Maske unbestätigt,
 * O-134)" und tragen `ist_platzhalter = false`. Der Name behauptet den Schutz,
 * die Spalte hebt ihn auf — und der Schutz sitzt für Rechnungskreise
 * ausschliesslich in `fin.rechnung_nummer_ziehen`, weil `vergebeNummer()` für
 * sie gar nicht zuständig ist (`DEFINER_KREISE`). Die Seite stellt beides
 * nebeneinander und benennt es als Datenentscheidung mit Wirkung auf bereits
 * festgeschriebene Belege (O-606). Sie ändert nichts.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Nummernkreise — Finanzen' };

const ZURUECKSETZUNG_TEXT: Readonly<Record<string, string>> = {
  nie: 'nie — fortlaufend über Jahre',
  jaehrlich: 'jährlich — am 1. Januar zurück auf 1',
};

function kurz(hash: string | null): string {
  return hash === null ? '—' : `${hash.slice(0, 12)}…${hash.slice(-6)}`;
}

/**
 * Trägt die Bezeichnung einen Hinweis auf eine unbestätigte Maske, während die
 * Spalte `ist_platzhalter` das Gegenteil sagt?
 *
 * Das ist kein Schönheitsfehler: der Name behauptet einen Schutz, den die
 * Spalte nicht gibt. Erkannt wird er am Text und nicht geraten — und die Zeile
 * sagt es, statt dass es jemand beim Lesen der Seeddaten findet.
 */
function widerspruechlich(k: Kreis): boolean {
  return !k.istPlatzhalter && /unbest(ä|ae)tigt|DEMO|O-134/iu.test(k.bezeichnung);
}

export default async function Nummernkreisblatt(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/finanzen/nummernkreise`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * Diese Seite öffnet mit `nummernkreis.lesen`. Das Ausgangsbuch und die
   * Hashkette liegen hinter anderen Schlüsseln — ohne sie steht hier Text
   * statt eines Verweises, der auf 404 führt (AUT-06, D-581).
   */
  const darf = await haeltRechte(
    zugang.sitzung, 'finanzen.lesen', 'nummernkreis.verwalten');

  const alle = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) =>
      kreise(kontext))) as Promise<readonly Kreis[]>);

  const platzhalter = alle.filter((k) => k.istPlatzhalter);
  const widersprueche = alle.filter(widerspruechlich);

  return (
    <PortalRahmen
      titel="Nummernkreise"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Nummernkreise</h1>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Jede Gesellschaft nummeriert für sich (TEN-02). Die Nummer wird beim
        Festschreiben gezogen — unter Zeilensperre auf dem Zähler, in derselben
        Transaktion, die den Kettensatz schreibt. Deshalb gibt es keine Lücke:
        wer abbricht, zieht keine Nummer, und wer eine zieht, schreibt fest.
      </p>

      {platzhalter.length > 0 ? (
        <Hinweis art="warnung" cse="nummernkreise-platzhalter" className="mb-s5">
          <p className="m-0 max-w-prose">
            {platzhalter.length === 1
              ? 'Ein Kreis ist ein Platzhalter.'
              : `${String(platzhalter.length)} Kreise sind Platzhalter.`}{' '}
            Maske und Rücksetzungsregel sind unbestätigt (O-134) — offen ist, ob
            es einen Kreis je Gesellschaft oder je Gesellschaft und Belegart
            gibt, ob die Nummer über Jahre weiterläuft oder am 1. Januar
            zurückspringt, und wie die Maske genau lautet.{' '}
            <strong>In einem Platzhalterkreis wird nicht festgeschrieben</strong>{' '}
            — eine Nummer daraus wäre eine erfundene.
          </p>
        </Hinweis>
      ) : null}

      {widersprueche.length > 0 ? (
        <Hinweis art="warnung" cse="nummernkreise-widerspruch" className="mb-s5">
          <p className="m-0 max-w-prose">
            <strong>
              {widersprueche.length === 1
                ? 'Ein Kreis behauptet in seiner Bezeichnung eine unbestätigte Maske, '
                  + 'trägt aber ist_platzhalter = false.'
                : `${String(widersprueche.length)} Kreise behaupten in ihrer `
                  + 'Bezeichnung eine unbestätigte Maske, tragen aber '
                  + 'ist_platzhalter = false.'}
            </strong>{' '}
            Damit greift der Platzhalterschutz nicht: für Rechnungs- und
            Gutschriftenkreise sitzt er ausschliesslich in{' '}
            <code>fin.rechnung_nummer_ziehen</code>, und die prüft genau diese
            Spalte. Ob die Spalte auf <code>true</code> gehört, ist eine
            Datenentscheidung mit Wirkung auf bereits festgeschriebene Belege —
            sie wird hier benannt und nicht getroffen (O-606).
          </p>
        </Hinweis>
      ) : null}

      {alle.length === 0 ? (
        <Hinweis art="hinweis" cse="nummernkreise-leer">
          <p className="m-0 max-w-prose">
            Für diese Gesellschaft ist kein Nummernkreis eingerichtet. Ohne
            Kreis entsteht keine Nummer und damit keine Rechnung, kein Angebot
            und kein Leistungsnachweis. Wer einen Kreis eröffnet, ist offen
            (O-352) — es gibt hier deshalb keinen Knopf dafür.
          </p>
        </Hinweis>
      ) : (
        <DataTable
          beschriftung="Nummernkreise mit Maske, Zähler, Kettenlage und Zustand"
          zeilen={alle}
          schluessel={(k) => k.id}
          spalten={[
            {
              schluessel: 'bezeichnung',
              kopf: 'Kreis',
              zelle: (k) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{k.bezeichnung}</span>
                  <span className="text-xs text-text-muted">{k.typText}</span>
                </span>
              ),
            },
            {
              schluessel: 'jahr', kopf: 'Jahr', numerisch: true,
              zelle: (k) => (k.jahr === 0 ? 'fortlaufend' : k.jahr),
            },
            {
              schluessel: 'maske',
              kopf: 'Maske und Rücksetzung',
              zelle: (k) => (
                <span className="inline-flex flex-col gap-s1">
                  <code className="text-xs text-text">{k.formatMaske}</code>
                  <span className="text-xs text-text-muted">
                    {k.zuruecksetzung === null
                      ? 'Rücksetzung nicht festgelegt'
                      : ZURUECKSETZUNG_TEXT[k.zuruecksetzung] ?? k.zuruecksetzung}
                    {k.lueckenlos ? ' · lückenlos' : ' · nicht lückenlos'}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'zaehler',
              kopf: 'Nächste Nummer (Ansicht)',
              numerisch: true,
              zelle: (k) => (
                <span className="inline-flex flex-col gap-s1 text-right">
                  <span className="cse-zahl text-text">{k.naechsteNummerFormatiert}</span>
                  <span className="cse-zahl text-xs text-text-muted">
                    Zähler {k.naechsteNummer}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'kette',
              kopf: 'Kettenlage',
              zelle: (k) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="font-mono text-xs text-text-muted">
                    Genesis {kurz(k.genesisHash)}
                  </span>
                  <span className="font-mono text-xs text-text-muted">
                    Letzter {kurz(k.letzterHash)}
                  </span>
                  <span className="text-xs text-text-muted">
                    {k.kettenlaenge} Glied(er)
                    {k.vorgaengerBezeichnung === null
                      ? ''
                      : ` · Vorgänger: ${k.vorgaengerBezeichnung}`}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'offen',
              kopf: 'Geöffnet / geschlossen',
              zelle: (k) => (
                <span className="text-xs text-text-muted">
                  {k.geoeffnetAm}
                  {k.geschlossenAm === null
                    ? ' · offen'
                    : ` · geschlossen ${k.geschlossenAm}`}
                </span>
              ),
            },
            {
              schluessel: 'zustand',
              kopf: 'Vergabe',
              zelle: (k) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    {k.istPlatzhalter
                      ? <StatusPill zustand="Entwurf" />
                      : k.geschlossenAm !== null
                        ? <StatusPill zustand="Archiviert" />
                        : <StatusPill zustand="Aktiv" />}
                    <span className="text-xs text-text-muted">
                      {k.zugDurchDefiner
                        ? 'Zug in der Datenbank (Definer)'
                        : 'Zug in der Anwendung'}
                    </span>
                  </span>
                  {k.vergabeGrund === null ? null : (
                    <span className="max-w-prose text-xs text-warning">
                      {k.vergabeGrund}
                    </span>
                  )}
                  {widerspruechlich(k) ? (
                    <span className="max-w-prose text-xs text-warning">
                      Bezeichnung und <code>ist_platzhalter</code> widersprechen
                      sich (O-606).
                    </span>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      )}

      <section aria-labelledby="jahreswechsel-titel" className="mt-s7">
        <h2 id="jahreswechsel-titel" className="mb-s3 text-h2 text-text">
          Der Jahreswechsel — beschrieben, nicht auslösbar
        </h2>
        <div
          className="rounded-lg border border-line bg-surface-2 p-s5 text-sm text-text"
          data-cse="nummernkreise-jahreswechsel"
        >
          <p className="m-0 max-w-prose">
            Ein Kreis mit jährlicher Rücksetzung wird nicht einfach
            weitergezählt. Der Vorgang hat drei Schritte, und sie gehören in
            eine Transaktion:
          </p>
          <ol className="mt-s3 max-w-prose list-decimal space-y-s2 pl-s5">
            <li>
              Den Vorgängerkreis <strong>schliessen</strong> (
              <code>geschlossen_am</code>). Danach vergibt er keine Nummer mehr.
            </li>
            <li>
              Den Nachfolger eröffnen und seinen <code>genesis_hash</code> auf
              den <code>letzter_hash</code> des Vorgängers setzen — damit reisst
              die Kette am Jahreswechsel nicht.
            </li>
            <li>
              Den Vorgänger eintragen (
              <code>vorgaenger_nummernkreis_id</code>), damit die Prüfung den
              Übergang nachrechnen kann (§5.7 Schritt 3b).
            </li>
          </ol>
          <p className="m-0 mt-s3 max-w-prose text-warning">
            <strong>Es gibt hier keinen Knopf dafür (O-352).</strong> Wer{' '}
            <code>nummernkreis.verwalten</code> in den drei Gesellschaften hält
            und wer den Jahreswechsel ausführt, ist nicht entschieden — und ein
            Knopf würde die Rolle erfinden, die ihn auslöst. Dieses Konto hält
            das Recht {darf['nummernkreis.verwalten'] === true ? '' : 'nicht'};
            auch mit dem Recht gibt es den Vorgang noch nicht.
          </p>
        </div>
      </section>

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        Der Zähler ist hier Ansicht. Er wird ausschliesslich beim Festschreiben
        fortgezählt, unter Zeilensperre — jede andere Stelle wäre eine zweite,
        und zwei Stellen vergeben irgendwann dieselbe Nummer.
        {darf['finanzen.lesen'] === true ? (
          <>
            {' '}
            <Link
              href={`/portal/${mandant}/finanzen/ausgangsbuch`}
              className="underline underline-offset-2"
            >
              Zum Rechnungsausgangsbuch →
            </Link>
          </>
        ) : null}
      </p>
    </PortalRahmen>
  );
}
