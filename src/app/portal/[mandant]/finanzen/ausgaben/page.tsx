import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import {
  AUSGABE_STATUS, EIGENBELEG_PLATZHALTER, ausgaben, istAusgabeStatus,
  kategorien, summen, type AusgabeStatus, type AusgabeZeile, type Kategorie,
  type Summen,
} from '@/server/services/finanz/ausgabe';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';

/**
 * `/portal/[mandant]/finanzen/ausgaben` — die Ausgaben einer Gesellschaft
 * (04-SEITENKARTE.md §5.14, FIN-14, FIN-17, REP-05, ACC-03, EMP-13).
 *
 * **Wer keine Erstattungen sehen darf, bekommt die Zeilen gar nicht erst.**
 * Das entscheidet RLS und nicht diese Seite: `p_ma_ceiling` begrenzt das
 * Mitarbeiterportal auf die eigenen Erstattungen, `t_person` gibt ihm
 * überhaupt erst Zeilen, und `p_gruppe_kein_personenbezug` macht
 * personenbezogene Ausgaben in der Gruppenansicht unerreichbar. Die Seite
 * filtert nichts nach — ein Filter in der Anwendung wäre die zweite
 * Zugriffskontrolle, und die zweite ist die, die man vergisst.
 *
 * **`anstellung_id` steht in keiner Abfrage dieser Seite.** Die Spalte fehlt
 * im `GRANT` (K-05, §1.5); wer wissen darf, welche Beschäftigte welche
 * Erstattung bekommen hat, sieht es auf der Einzelseite über
 * `app.ausgabe_erstattung_lesen()` — und dieser Zugriff steht anschliessend im
 * `audit_log`. Die Liste zeigt nur, DASS eine Zeile eine Erstattung ist.
 *
 * **Die Summenzeile kommt aus der Datenbank, nicht aus der Liste.** Gezählt
 * wird unter derselben Policy: was eine Sitzung nicht sehen darf, zählt für
 * sie auch nicht mit — sonst stünde über einer gekürzten Liste eine Summe, die
 * niemand nachrechnen kann.
 *
 * **Zwei offene Fragen stehen sichtbar auf der Seite.** Ob belegfrei gebucht
 * werden darf und bis zu welchem Betrag (O-185), und ob eine TSE-Kasse nach
 * §146a AO im Einsatz ist (O-186). Bis dahin gilt die harte Regel aus 0180:
 * ohne Beleg keine Freigabe — „keine Buchung ohne Beleg" ist erzwungen und
 * nicht behauptet.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ausgaben — Finanzen' };

const PILLE: Readonly<Record<AusgabeStatus, PillZustand>> = {
  erfasst: 'Entwurf',
  freigegeben: 'Bereit',
  gebucht: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
};

const ZUSTAND: Readonly<Record<AusgabeStatus, string>> = {
  erfasst: 'erfasst — noch nicht freigegeben',
  freigegeben: 'freigegeben — zur Buchung bereit',
  gebucht: 'gebucht',
  abgelehnt: 'abgelehnt',
};

const ZAHLUNGSMITTEL_TEXT: Readonly<Record<string, string>> = {
  ueberweisung: 'Überweisung',
  lastschrift: 'Lastschrift',
  bar: 'bar (Kasse)',
  karte: 'Karte',
  verrechnung: 'Verrechnung',
};

export default async function Ausgabenliste(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;

  const jahrRoh = typeof suche['jahr'] === 'string' ? suche['jahr'] : null;
  const statusRoh = typeof suche['status'] === 'string' ? suche['status'] : null;
  const kategorieRoh = typeof suche['kategorie'] === 'string' ? suche['kategorie'] : null;
  const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  const filter = {
    jahr: jahrRoh !== null && /^\d{4}$/u.test(jahrRoh) ? Number(jahrRoh) : null,
    status: istAusgabeStatus(statusRoh) ? statusRoh : null,
    /*
     * Die Kategorie wird auf Form geprüft, bevor sie in ein `$1::uuid`
     * gelangt: ein Filter aus der Adresszeile mit „alle" darin ergäbe sonst
     * `invalid input syntax for type uuid` — also 500 statt „gibt es nicht".
     */
    kategorieId: kategorieRoh !== null && KENNUNG.test(kategorieRoh) ? kategorieRoh : null,
    nurWeiterberechenbar: suche['weiterberechenbar'] === 'ja',
  };

  const tor = await mandantTor(`/portal/${mandant}/finanzen/ausgaben`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      zeilen: await ausgaben(kontext, filter),
      summe: await summen(kontext, filter),
      kategorien: await kategorien(kontext),
    }))) as Promise<{
      zeilen: readonly AusgabeZeile[];
      summe: Summen;
      kategorien: readonly Kategorie[];
    }>);

  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 p-s3 text-sm text-text';
  const gefiltert = filter.jahr !== null || filter.status !== null
    || filter.kategorieId !== null || filter.nurWeiterberechenbar;
  const belegLuecken = daten.zeilen.filter((z) => z.belegPflichtVerletzt);
  const platzhalterKategorien = daten.zeilen.filter((z) => z.kategorieIstPlatzhalter);

  return (
    <PortalRahmen
      titel="Ausgaben"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="eingangsrechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Ausgaben</h1>
        <form method="get" className="flex flex-wrap items-end gap-s3">
          <div>
            <label className="block text-xs text-text-muted" htmlFor="jahr">Jahr</label>
            <input
              id="jahr" name="jahr" type="number" min="2000" max="2999" step="1"
              defaultValue={filter.jahr ?? ''} placeholder="alle" className={feld}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted" htmlFor="status">Zustand</label>
            <select id="status" name="status" defaultValue={filter.status ?? ''} className={feld}>
              <option value="">alle</option>
              {AUSGABE_STATUS.map((s) => (
                <option key={s} value={s}>{ZUSTAND[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted" htmlFor="kategorie">
              Kategorie
            </label>
            <select
              id="kategorie" name="kategorie"
              defaultValue={filter.kategorieId ?? ''} className={feld}
            >
              <option value="">alle</option>
              {daten.kategorien.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.bezeichnung}{k.istPlatzhalter ? ' (unbestätigt)' : ''}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-s2 text-sm text-text">
            <input
              type="checkbox" name="weiterberechenbar" value="ja"
              defaultChecked={filter.nurWeiterberechenbar}
            />
            nur weiterberechenbar
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
          >
            Anzeigen
          </button>
          {gefiltert ? (
            <Link
              href={`/portal/${mandant}/finanzen/ausgaben`}
              className="text-sm text-text-muted underline underline-offset-2 hover:text-text"
            >
              zurücksetzen
            </Link>
          ) : null}
        </form>
      </div>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <KpiStat label="Ausgaben" wert={String(daten.summe.anzahl)} icon="euro" />
        <KpiStat
          label="Netto"
          wert={formatiereGeld(daten.summe.nettoCent)}
          icon="euro"
        />
        <KpiStat
          label="Brutto"
          wert={formatiereGeld(daten.summe.bruttoCent)}
          icon="euro"
        />
      </div>

      {daten.summe.jeStatus.length === 0 ? null : (
        <div
          data-cse="ausgaben-summen-je-status"
          className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm"
        >
          <h2 className="mb-s3 text-h3 text-text">Summen je Zustand</h2>
          <ul className="m-0 flex flex-col gap-s2 p-0">
            {daten.summe.jeStatus.map((s) => (
              <li key={s.status} className="flex flex-wrap items-baseline gap-s3">
                <StatusPill zustand={PILLE[s.status]} />
                <span className="text-xs text-text-muted">{ZUSTAND[s.status]}</span>
                <span className="cse-zahl text-text">
                  {s.anzahl} · Netto {formatiereGeld(s.nettoCent)} · USt{' '}
                  {formatiereGeld(s.steuerCent)} · Brutto{' '}
                  {formatiereGeld(s.bruttoCent)}
                </span>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-s3 max-w-prose text-xs text-text-muted">
            Gezählt wird in der Datenbank, unter derselben Policy wie die Liste:
            was diese Sitzung nicht sehen darf, zählt für sie auch nicht mit.
            Eine Summe über eine gekürzte Liste wäre die Zahl, an der später
            jemand eine Abweichung sucht.
          </p>
        </div>
      )}

      {belegLuecken.length > 0 ? (
        <Hinweis art="warnung" cse="ausgaben-ohne-beleg" className="mb-s5">
          <p className="m-0 max-w-prose">
            {belegLuecken.length === 1
              ? 'Eine freigegebene oder gebuchte Ausgabe trägt keinen Beleg.'
              : `${String(belegLuecken.length)} freigegebene oder gebuchte Ausgaben `
                + 'tragen keinen Beleg.'}{' '}
            Das kann als Daten nicht entstehen — die Datenbank verlangt vor der
            Freigabe einen Beleg (ACC-03). Steht es hier, ist die Zeile älter
            als die Regel oder beschädigt; beides gehört gemeldet.
          </p>
        </Hinweis>
      ) : null}

      <Hinweis art="warnung" cse="ausgaben-eigenbeleg" className="mb-s5">
        <p className="m-0 max-w-prose">
          <strong>Belegfrei buchen ist nicht vorgesehen (O-185).</strong>{' '}
          {EIGENBELEG_PLATZHALTER.herkunft}
        </p>
        <p className="m-0 mt-s2 max-w-prose">
          Ob eine elektronische Registrierkasse mit TSE nach §146a AO im
          Einsatz ist oder ausschliesslich eine offene Ladenkasse mit
          Kassenbuch, ist ebenfalls offen (O-186). Eine Barausgabe verlangt hier
          deshalb eine Kasse und trägt keine TSE-Angaben — die Plattform
          behauptet keine Sicherungseinrichtung, die sie nicht hat.
        </p>
      </Hinweis>

      {platzhalterKategorien.length > 0 ? (
        <Hinweis art="hinweis" cse="ausgaben-kategorie-platzhalter" className="mb-s5">
          <p className="m-0 max-w-prose">
            Einige Zeilen hängen an einer <strong>unbestätigten Kategorie</strong>{' '}
            (O-05). Welche Aufwandskategorien der Steuerberater erwartet und wie
            sie auf SKR-Konten abbilden, ist nicht entschieden — bis dahin
            entsteht aus einer solchen Kategorie eine Buchung OHNE Konto und mit
            Prüfhinweis, nie eine auf ein geratenes Konto.
          </p>
        </Hinweis>
      ) : null}

      {daten.zeilen.length === 0 ? (
        <Hinweis art="hinweis" cse="ausgaben-leer">
          <p className="m-0 max-w-prose">
            {gefiltert
              ? 'Keine Ausgabe passt zu diesem Filter.'
              : 'Es ist keine Ausgabe erfasst. Eine Ausgabe ist der Aufwand dieser '
                + 'Gesellschaft, der keine Lieferantenrechnung ist — Barkasse, '
                + 'Tankbeleg, Material für einen Auftrag, eine Auslagenerstattung. '
                + 'Sie braucht vor der Freigabe ihren Beleg (ACC-03).'}
          </p>
        </Hinweis>
      ) : (
        <DataTable
          beschriftung="Ausgaben mit Datum, Kategorie, Betrag, Beleg und Zustand"
          zeilen={daten.zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'datum', kopf: 'Datum',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/finanzen/ausgaben/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.ausgabedatum}
                </Link>
              ),
            },
            {
              schluessel: 'kategorie',
              kopf: 'Kategorie',
              zelle: (z) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{z.kategorie}</span>
                  {z.kategorieIstPlatzhalter ? (
                    <span className="text-xs text-warning">unbestätigt (O-05)</span>
                  ) : null}
                </span>
              ),
            },
            {
              schluessel: 'bezeichnung',
              kopf: 'Bezeichnung',
              zelle: (z) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{z.bezeichnung}</span>
                  <span className="text-xs text-text-muted">
                    {ZAHLUNGSMITTEL_TEXT[z.zahlungsmittel] ?? z.zahlungsmittel}
                    {z.kasse === null ? '' : ` · ${z.kasse}`}
                    {z.auftragsnummer === null ? '' : ` · Auftrag ${z.auftragsnummer}`}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'netto', kopf: 'Netto', numerisch: true,
              zelle: (z) => formatiereGeld(z.nettoCent),
            },
            {
              schluessel: 'steuer', kopf: 'USt', numerisch: true,
              zelle: (z) => formatiereGeld(z.steuerCent),
            },
            {
              schluessel: 'brutto', kopf: 'Brutto', numerisch: true,
              zelle: (z) => formatiereGeld(z.bruttoCent),
            },
            {
              schluessel: 'beleg',
              kopf: 'Beleg',
              zelle: (z) => (z.belegId === null
                ? (
                  <span className={z.belegPflichtVerletzt ? 'text-warning' : 'text-text-subtle'}>
                    {z.belegPflichtVerletzt ? 'fehlt — darf nicht sein' : 'noch keiner'}
                  </span>
                )
                : (
                  <Link
                    href={`/portal/${mandant}/finanzen/belege/${z.belegId}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.belegnummer ?? 'ohne Nummer'}
                  </Link>
                )),
            },
            {
              schluessel: 'zustand',
              kopf: 'Zustand',
              zelle: (z) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    <StatusPill zustand={PILLE[z.status]} />
                    <span className="text-xs text-text-muted">
                      {z.abgelehntGrund ?? ZUSTAND[z.status]}
                    </span>
                  </span>
                  <span className="text-xs text-text-muted">
                    {z.weiterberechenbar ? 'weiterberechenbar' : 'nicht weiterberechenbar'}
                    {z.istErstattung ? ' · Erstattung' : ''}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        Gelöscht wird keine Ausgabe (Invariante 8). Zurückgewiesen wird mit
        Grund, und eine gebuchte Ausgabe ist unveränderlich — korrigiert wird
        durch eine Gegenbuchung. Wer welche Erstattung bekommen hat, steht nicht
        in dieser Liste: die Spalte liegt hinter einem eigenen Recht
        (<code>personal.erstattung_lesen</code>), und der Zugriff darauf wird
        protokolliert.
      </p>
    </PortalRahmen>
  );
}
