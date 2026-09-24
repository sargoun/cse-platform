import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { listeKataloge, type KatalogZeile } from '@/server/services/katalog/index';
import { berlinKalendertag } from '@/server/services/zeit/dauer';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { FELD, FEHLERTEXT, PILLE } from './daten';
import { Recht } from '@/components/ui/Recht';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/leistungskatalog` — die Katalogfassungen dieser
 * Gesellschaft (OPS-06, CLN-05).
 *
 * **Der Platzhalteranteil steht IN der Zeile, nicht im Kleingedruckten.** Ein
 * Katalog, dessen Preise aussehen wie entschiedene, ist hier der teuerste
 * Fehler: aus einer Katalogposition wird eine Angebotszeile, aus der eine
 * Auftragszeile, aus der eine Rechnungsposition. Wo `ist_platzhalter` steht,
 * steht es sichtbar.
 *
 * **Und „archivieren friert ein" ist hier eine WAHRE Aussage** — seit 0298.
 * Vorher hing der Statuswaechter nur an den POSITIONEN
 * (`kern.pruefe_katalog_offen`), und `archiviert → aktiv` liess sich
 * zurueckdrehen; damit taute das Einfrieren wieder auf. Eine Oberflaeche, die
 * das trotzdem behauptet, behauptet die eine Aussage, auf die sich ein
 * Preisgespraech spaeter beruft.
 *
 * **Versionen werden GEZOGEN, nicht eingegeben.**
 * `leistungskatalog_version_uk` ist unique auf (mandant_id, schluessel,
 * version), und `leistungskatalog_aktiv_uk` laesst je Schluessel genau eine
 * aktive Fassung zu. Der Ablauf folgt daraus und wird nicht erfunden: neue
 * Fassung anlegen (Entwurf, naechste Nummer), alte archivieren, neue
 * aktivieren.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Leistungskatalog' };

export default async function Leistungskatalog(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const pfad = `/portal/${mandant}/leistungskatalog`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  /**
   * `katalog.schreiben` halten laut Katalog nur `admin` und `super_admin` —
   * NICHT `leitung`, die `katalog.lesen` hat. Eine Leitung sieht hier also
   * alles und keinen Knopf. Das ist der Schnitt des Rechtekatalogs, und die
   * Pruefung steht hier, damit kein Knopf auf ein 404 fuehrt (AUT-06, D-581).
   */
  const darf = await haeltRechte(zugang.sitzung, 'katalog.schreiben');
  const schreiben = darf['katalog.schreiben'] === true
    && zugang.sitzung.ansicht !== 'gruppe';

  const kataloge = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, (kontext) => listeKataloge(kontext)),
  ) as Promise<readonly KatalogZeile[]>);

  const offeneGesamt = kataloge.reduce((s, k) => s + Number(k.platzhalter), 0);

  return (
    <PortalRahmen
      titel="Leistungskatalog"
      bereich={mandant as BereichSchluessel}
      nurLesen={zugang.sitzung.ansicht === 'gruppe'}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="leistungskatalog"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Leistungskatalog</h1>
      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">
        Die Leistungen, aus denen Angebote, Aufträge und Rechnungen ihre Zeilen
        nehmen — je Fassung, mit Gültigkeitszeitraum. Je Schlüssel gilt{' '}
        <strong>genau eine</strong> Fassung; eine neue entsteht als Entwurf mit
        der nächsten Versionsnummer.
      </p>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="katalog-fehler" className="mb-s5">
          <strong>Nichts wurde gespeichert.</strong>{' '}
          {eigenerEintrag(FEHLERTEXT, fehler) ?? 'Der Vorgang wurde abgewiesen.'}
        </Hinweis>
      )}

      {offeneGesamt > 0 ? (
        <Hinweis art="warnung" cse="platzhalter-gesamt" className="mb-s5">
          <strong>
            {offeneGesamt} Position(en) tragen unbestätigte Werte — offen (O-17,
            O-731).
          </strong>{' '}
          Welche Zeitwerte, Leistungswerte und Standardpreise gelten und wer sie
          freigibt, ist nicht entschieden. Die Zahlen stehen als{' '}
          <em>gekennzeichnete Platzhalter</em> da — nicht als Preise, und nicht
          als Nullwerte: der CHECK <code>lkp_kalkulierbar</code> verlangt
          mindestens einen Wert je Position, „keinen erfinden" kann hier also
          nicht „leer lassen" heißen.
        </Hinweis>
      ) : null}

      {kataloge.length === 0 ? (
        <p
          data-cse="katalog-leer"
          className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
        >
          Noch keine Katalogfassung. Ohne Katalog trägt jede Angebotszeile ihren
          Text selbst — das funktioniert, wiederholt sich aber bei jedem Angebot
          neu und lässt sich nicht gemeinsam pflegen.
        </p>
      ) : (
        <DataTable
          beschriftung="Katalogfassungen dieser Gesellschaft mit Gültigkeit und Platzhalteranteil"
          zeilen={kataloge}
          schluessel={(k) => k.id}
          spalten={[
            {
              schluessel: 'schluessel', kopf: 'Schlüssel',
              zelle: (k) => (
                <Link
                  href={`/portal/${mandant}/leistungskatalog/${k.id}`}
                  className="text-text underline underline-offset-2 hover:text-brand"
                >
                  {k.schluessel}
                </Link>
              ),
            },
            { schluessel: 'bezeichnung', kopf: 'Bezeichnung', zelle: (k) => k.bezeichnung },
            {
              schluessel: 'version', kopf: 'Version', numerisch: true,
              zelle: (k) => String(k.version),
            },
            {
              schluessel: 'status', kopf: 'Status',
              zelle: (k) => <StatusPill zustand={PILLE[k.status] ?? 'Entwurf'} />,
            },
            {
              schluessel: 'gueltig', kopf: 'Gültig',
              zelle: (k) => `${k.gueltig_ab} – ${k.gueltig_bis ?? 'offen'}`,
            },
            {
              schluessel: 'positionen', kopf: 'Positionen', numerisch: true,
              zelle: (k) => k.positionen,
            },
            {
              schluessel: 'platzhalter', kopf: 'davon unbestätigt', numerisch: true,
              zelle: (k) => (Number(k.platzhalter) === 0 ? (
                <span className="text-text-subtle">—</span>
              ) : (
                <span className="text-warning">
                  {k.platzhalter} · offen (O-17, O-731)
                </span>
              )),
            },
          ]}
        />
      )}

      {schreiben ? (
        <section aria-labelledby="neu" className="mt-s7">
          <h2 id="neu" className="text-h2 text-text">Neue Fassung anlegen</h2>
          <form
            method="post"
            action="/api/katalog"
            data-cse="katalog-anlegen-form"
            className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="aktion" value="katalog_anlegen" />
            <input type="hidden" name="zurueck" value={pfad} />

            <label className="block text-sm text-text" htmlFor="schluessel">
              Schlüssel
            </label>
            <input
              id="schluessel"
              name="schluessel"
              type="text"
              required
              placeholder="z. B. unterhalt"
              className={FELD}
            />
            <p className="mt-s1 text-xs text-text-muted">
              Der stabile Name über alle Fassungen hinweg. Ein bestehender
              Schlüssel erzeugt die <strong>nächste Version</strong> — die Nummer
              zieht die Datenbank, sie wird nicht eingegeben.
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="bezeichnung">
              Bezeichnung
            </label>
            <input id="bezeichnung" name="bezeichnung" type="text" required className={FELD} />

            <label className="mt-s4 block text-sm text-text" htmlFor="gueltigAb">
              Gültig ab
            </label>
            <input
              id="gueltigAb"
              name="gueltigAb"
              type="date"
              required
              /** Der BERLINER Kalendertag, nicht der von UTC (Invariante 2). */
              defaultValue={berlinKalendertag(new Date())}
              className={FELD}
            />

            <label className="mt-s4 block text-sm text-text" htmlFor="beschreibung">
              Beschreibung
            </label>
            <textarea
              id="beschreibung"
              name="beschreibung"
              rows={2}
              className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
            />

            <p className="mt-s4 text-xs text-text-muted">
              Sie entsteht als <strong>Entwurf</strong>. Aktiv wird sie durch
              einen eigenen Schritt auf ihrer Seite — und nur, wenn keine andere
              Fassung dieses Schlüssels gilt.
            </p>

            <button
              type="submit"
              data-cse="katalog-anlegen"
              className="mt-s4 inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
            >
              Fassung anlegen
            </button>
          </form>
        </section>
      ) : (
        <p data-cse="nur-lesen" className="mt-s6 text-sm text-text-muted">
          Sie sehen den Katalog, ändern ihn aber nicht: dafür verlangt die
          Plattform <Recht schluessel="katalog.schreiben" />. Ein
          Knopf, dessen Route abweist, wäre ein Fehlerbericht mit Verzögerung.
        </p>
      )}

      <Hinweis art="hinweis" cse="loeschen-nicht" className="mt-s6">
        <strong>Gelöscht wird nichts.</strong> An einer Katalogposition hängen
        Angebotszeilen, Kalkulationszeilen, Turnusse und Kontenzuordnungen; sie
        zu entfernen löschte die Herkunft eines Preises, den ein Kunde bezahlt
        hat (Invariante 8). Eine Fassung wird <em>archiviert</em> — und
        archiviert ist Endstation: ihre Positionen sind danach unveränderlich,
        und der Weg zurück ist gesperrt, weil er das Einfrieren stillschweigend
        auftauen würde.
      </Hinweis>
    </PortalRahmen>
  );
}
