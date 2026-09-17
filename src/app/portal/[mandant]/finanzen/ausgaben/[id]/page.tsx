import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import {
  EIGENBELEG_PLATZHALTER, erstattung, leseAusgabe, steuerzeilen,
  weiterberechnungen, type AusgabeStatus, type AusgabeZeile, type Erstattung,
  type SteuerLage, type Weiterberechnung,
} from '@/server/services/finanz/ausgabe';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/finanzen/ausgaben/[id]` — eine Ausgabe im Detail
 * (04-SEITENKARTE.md §5.14, FIN-14, FIN-17, ACC-01, ACC-03, REP-05, D-09,
 * EMP-13).
 *
 * **Die Steuerzeilen je Steuersatzgruppe — nie ein Mischsatz.** Ein
 * Kassenbeleg mit Kraftstoff zu 19 % und Verpflegung zu 7 % ist der
 * gewöhnliche Fall. Diese Seite zeigt die Aufteilung, wie sie gespeichert ist,
 * und rechnet keinen Satz aus dem Brutto zurück: das wäre ein Mischsatz, und
 * Invariante 1 verbietet ihn. Stimmen die Zeilen nicht mit dem Kopf überein,
 * steht das oben — vor dem Buchen weist die Datenbank es ab.
 *
 * **Die Erstattung liegt hinter einem eigenen Recht.** „Welche Beschäftigte
 * hat welche Erstattung bekommen" ist Personendatum unter D-09 §6, die
 * Ausgabe selbst ist es nicht. Die Kennung wird über
 * `app.ausgabe_erstattung_lesen()` gelesen — mit
 * `personal.erstattung_lesen`, und der Zugriff steht anschliessend im
 * `audit_log` (SEC-A9). Ohne das Recht bleibt sie leer, und leer heisst
 * dasselbe wie „diese Ausgabe ist keine Erstattung": ein unterscheidbarer
 * Wert wäre genau die Auskunft, die das Recht verweigert (AUT-06).
 *
 * **Keine Löschung, nur Ablehnung mit Grund** (Invariante 8). Und ab `gebucht`
 * ist die Zeile unveränderlich — korrigiert wird durch eine Gegenbuchung.
 *
 * **Ist die Ausgabe weiterberechnet, steht die Rechnungszeile daneben.**
 * Genau eine: `quelle_ausgabe_uk` ist ein Teilindex auf `(ausgabe_id)` mit
 * `WHERE quelle_typ = 'material' AND wirksam` — eine weiterberechnete Ausgabe
 * wird EINMAL weiterberechnet (FIN-07). Unwirksame Zeilen aus einem Storno
 * stehen daneben, damit sichtbar bleibt, dass es einen Versuch gab.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ausgabe — Finanzen' };

const PILLE: Readonly<Record<AusgabeStatus, PillZustand>> = {
  erfasst: 'Entwurf',
  freigegeben: 'Bereit',
  gebucht: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
};

const ZUSTAND: Readonly<Record<AusgabeStatus, string>> = {
  erfasst: 'erfasst — noch nicht freigegeben',
  freigegeben: 'freigegeben — zur Buchung bereit',
  gebucht: 'gebucht — unveränderlich',
  abgelehnt: 'abgelehnt',
};

const ZAHLUNGSMITTEL_TEXT: Readonly<Record<string, string>> = {
  ueberweisung: 'Überweisung',
  lastschrift: 'Lastschrift',
  bar: 'bar (aus der Kasse)',
  karte: 'Karte',
  verrechnung: 'Verrechnung',
};

/** Die Zustandsfolge, ausgeschrieben — dieselbe wie `fin.ausgabe_uebergang`. */
const FOLGE: readonly { readonly von: AusgabeStatus; readonly nach: string }[] = [
  { von: 'erfasst', nach: 'freigegeben · abgelehnt' },
  { von: 'freigegeben', nach: 'gebucht · abgelehnt' },
  { von: 'gebucht', nach: 'nichts mehr — korrigiert wird durch eine Gegenbuchung' },
  { von: 'abgelehnt', nach: 'nichts mehr — eine abgelehnte Ausgabe wird neu erfasst' },
];

export default async function Ausgabenblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(`/portal/${mandant}/finanzen/ausgaben/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /*
   * Drei Nachbarrechte: die Erstattung (`personal.erstattung_lesen`), die
   * Rechnungszeile (`finanzen.lesen`) und der Auftrag (`auftrag.lesen`). Diese
   * Seite öffnet mit `eingang.lesen` und hält keines davon zwangsläufig —
   * ohne sie steht Text statt eines Verweises (AUT-06, D-581).
   */
  const darf = await haeltRechte(
    sitzung, 'personal.erstattung_lesen', 'finanzen.lesen', 'auftrag.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const a = await leseAusgabe(kontext, id);
      if (a === null) {
        return { a: null, steuer: null, erstattung: null, weiter: [] };
      }
      return {
        a,
        steuer: await steuerzeilen(kontext, id),
        /*
         * Gefragt wird nur, wenn die Liste überhaupt eine Erstattung
         * gemeldet hat: der Definer PROTOKOLLIERT jeden Aufruf, und ein
         * Protokolleintrag für jede Ausgabenseite machte das Protokoll
         * unlesbar — genau dort, wo es lesbar bleiben muss.
         */
        erstattung: a.istErstattung ? await erstattung(kontext, id) : null,
        weiter: await weiterberechnungen(kontext, id),
      };
    })) as Promise<{
      a: AusgabeZeile | null;
      steuer: SteuerLage | null;
      erstattung: Erstattung | null;
      weiter: readonly Weiterberechnung[];
    }>);

  const a = daten.a;
  if (a === null) notFound();
  const steuer = daten.steuer;

  return (
    <PortalRahmen
      titel="Ausgabe"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="eingangsrechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/ausgaben`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Ausgaben
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{a.bezeichnung}</h1>
        <span className="inline-flex flex-wrap items-center gap-s2">
          <StatusPill zustand={PILLE[a.status]} />
          <span className="text-xs text-text-muted">{ZUSTAND[a.status]}</span>
        </span>
      </div>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">Ausgabedatum</dt>
          <dd className="text-sm text-text">{a.ausgabedatum}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Kategorie</dt>
          <dd className="text-sm text-text">
            {a.kategorie}
            {a.kategorieIstPlatzhalter
              ? <span className="text-warning"> — unbestätigt (O-05)</span>
              : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Bezahlt mit</dt>
          <dd className="text-sm text-text">
            {ZAHLUNGSMITTEL_TEXT[a.zahlungsmittel] ?? a.zahlungsmittel}
            {a.kasse === null ? '' : ` · ${a.kasse}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Netto</dt>
          <dd className="cse-zahl text-sm text-text">{formatiereGeld(a.nettoCent)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Umsatzsteuer</dt>
          <dd className="cse-zahl text-sm text-text">{formatiereGeld(a.steuerCent)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Brutto</dt>
          <dd className="cse-zahl text-base text-text">{formatiereGeld(a.bruttoCent)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Weiterberechenbar</dt>
          <dd className="text-sm text-text">
            {a.weiterberechenbar ? 'ja (FIN-07)' : 'nein'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Auftrag</dt>
          <dd className="text-sm text-text">
            {a.auftragId === null || a.auftragsnummer === null
              ? <span className="text-text-subtle">—</span>
              : darf['auftrag.lesen'] === true
                ? (
                  <Link
                    href={`/portal/${mandant}/auftraege/${a.auftragId}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {a.auftragsnummer}
                  </Link>
                )
                : a.auftragsnummer}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Beleg</dt>
          <dd className="text-sm text-text">
            {a.belegId === null
              ? (
                <span className={a.belegPflichtVerletzt ? 'text-warning' : 'text-text-subtle'}>
                  {a.belegPflichtVerletzt
                    ? 'fehlt — das darf es in diesem Zustand nicht geben'
                    : 'noch keiner'}
                </span>
              )
              : (
                <Link
                  href={`/portal/${mandant}/finanzen/belege/${a.belegId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {a.belegnummer ?? 'Beleg ohne Nummer'}
                </Link>
              )}
          </dd>
        </div>
      </dl>

      {a.status === 'abgelehnt' ? (
        <Hinweis art="hinweis" cse="ausgabe-abgelehnt" className="mb-s5">
          <p className="m-0 max-w-prose">
            Zurückgewiesen. Grund: „{a.abgelehntGrund ?? '—'}". Die Zeile bleibt
            stehen (Invariante 8) — es gibt hier keine Löschung, auch keinen
            ausgegrauten Knopf dafür.
          </p>
        </Hinweis>
      ) : null}

      {a.belegId === null && a.status === 'erfasst' ? (
        <Hinweis art="warnung" cse="ausgabe-beleg-fehlt" className="mb-s5">
          <p className="m-0 max-w-prose">
            <strong>Ohne Beleg keine Freigabe.</strong> Die Datenbank verlangt
            ihn vor dem Übergang nach <em>freigegeben</em> — „keine Buchung ohne
            Beleg" ist erzwungen und nicht behauptet (ACC-03).
          </p>
          <p className="m-0 mt-s2 max-w-prose">
            {EIGENBELEG_PLATZHALTER.herkunft}
          </p>
        </Hinweis>
      ) : null}

      <h2 className="mb-s3 text-h2 text-text">
        Die Steuer je Steuersatzgruppe — nie ein Mischsatz
      </h2>
      {steuer === null || steuer.zeilen.length === 0 ? (
        <Hinweis
          art={a.status === 'gebucht' ? 'warnung' : 'hinweis'}
          cse="ausgabe-keine-steuerzeilen"
          className="mb-s5"
        >
          <p className="m-0 max-w-prose">
            {a.status === 'gebucht'
              ? 'Diese gebuchte Ausgabe hat keine Aufteilung je Steuersatzgruppe. Das '
                + 'kann als Daten nicht entstehen — die Datenbank verlangt sie vor dem '
                + 'Buchen. Steht es hier, ist die Zeile älter als die Regel.'
              : 'Noch keine Aufteilung erfasst. Sie darf während der Erfassung '
                + 'nachkommen; vor dem Buchen muss sie zum Kopf passen, und das prüft '
                + 'die Datenbank am Ende der Transaktion.'}
          </p>
          <p className="m-0 mt-s2 max-w-prose">
            Aus dem Bruttobetrag wird hier <strong>kein</strong> Satz
            zurückgerechnet: ein Mischsatz steht auf keinem Beleg (Invariante 1).
          </p>
        </Hinweis>
      ) : (
        <>
          <DataTable
            beschriftung="Aufteilung dieser Ausgabe je Steuersatzgruppe"
            zeilen={steuer.zeilen}
            schluessel={(z) => z.steuersatzGruppeId}
            spalten={[
              { schluessel: 'gruppe', kopf: 'Steuersatzgruppe', zelle: (z) => z.gruppe },
              {
                schluessel: 'satz', kopf: 'Satz', numerisch: true,
                zelle: (z) => `${(z.satzBp / 100).toLocaleString('de-DE')} %`,
              },
              {
                schluessel: 'kategorie', kopf: 'EN-16931-Kategorie',
                zelle: (z) => z.kategorie,
              },
              {
                schluessel: 'netto', kopf: 'Netto', numerisch: true,
                zelle: (z) => formatiereGeld(z.nettoCent),
              },
              {
                schluessel: 'steuer', kopf: 'USt', numerisch: true,
                zelle: (z) => formatiereGeld(z.steuerCent),
              },
            ]}
          />
          <div
            data-cse="ausgabe-steuerprobe"
            data-ok={String(steuer.stimmtMitKopf)}
            className={`mb-s5 mt-s3 rounded-lg border p-s5 text-sm ${
              steuer.stimmtMitKopf
                ? 'border-line bg-surface text-text'
                : 'border-warning bg-warning-soft text-warning'}`}
          >
            <p className="m-0 max-w-prose">
              Zeilensumme {formatiereGeld(steuer.nettoCent)} netto /{' '}
              {formatiereGeld(steuer.steuerCent)} Steuer · Kopf{' '}
              {formatiereGeld(a.nettoCent)} / {formatiereGeld(a.steuerCent)}
              {steuer.stimmtMitKopf
                ? ' — sie stimmen überein.'
                : ' — sie weichen ab. Vor dem Buchen weist die Datenbank das ab; '
                  + 'der Kopf oder die Zeilen sind zu korrigieren.'}
            </p>
          </div>
        </>
      )}

      <h2 className="mb-s3 text-h2 text-text">Erstattung an eine Beschäftigte</h2>
      <div
        data-cse="ausgabe-erstattung"
        data-ist-erstattung={String(a.istErstattung)}
        className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm"
      >
        {daten.erstattung === null ? (
          <p className="m-0 max-w-prose text-text-muted">
            {darf['personal.erstattung_lesen'] === true
              ? 'Diese Ausgabe ist keine Auslagenerstattung — sie hängt an keiner '
                + 'Anstellung.'
              : 'Keine Angabe. Das heisst zweierlei, und die Seite unterscheidet es '
                + 'nicht: die Ausgabe ist keine Erstattung, ODER diesem Konto fehlt '
                + 'personal.erstattung_lesen. Ein unterscheidbarer Hinweis wäre genau '
                + 'die Auskunft, die das Recht verweigert (AUT-06).'}
          </p>
        ) : (
          <>
            <p className="m-0 max-w-prose text-text">
              Erstattet an Anstellung{' '}
              <strong>{daten.erstattung.personalnummer ?? 'ohne Personalnummer'}</strong>.
            </p>
            <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
              Eine Erstattung ist ein Kostensatz und hängt deshalb an der
              ANSTELLUNG, nie an der Person (D-09, Invariante 9). Dieser
              Lesezugriff steht im Protokoll —{' '}
              <code>ausgabe.erstattung_gelesen</code>, mit Konto und Zeitpunkt.
            </p>
          </>
        )}
      </div>

      <h2 className="mb-s3 text-h2 text-text">Weiterberechnung (FIN-07)</h2>
      {daten.weiter.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {a.weiterberechenbar
            ? 'Noch nicht weiterberechnet. Diese Ausgabe darf als Materialzeile auf '
              + 'einer Rechnung erscheinen — genau einmal: der Teilindex '
              + 'quelle_ausgabe_uk lässt eine zweite wirksame Zeile nicht zu.'
            : 'Diese Ausgabe ist nicht als weiterberechenbar gekennzeichnet und '
              + 'erscheint auf keiner Rechnung.'}
        </p>
      ) : (
        <DataTable
          beschriftung="Rechnungszeilen, die diese Ausgabe weiterberechnen"
          zeilen={daten.weiter}
          schluessel={(w) => `${w.rechnungId}-${String(w.positionNr)}`}
          spalten={[
            {
              schluessel: 'rechnung',
              kopf: 'Rechnung',
              zelle: (w) => (darf['finanzen.lesen'] === true ? (
                <Link
                  href={`/portal/${mandant}/finanzen/rechnungen/${w.rechnungId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {w.rechnungNummer ?? 'Entwurf ohne Nummer'}
                </Link>
              ) : (w.rechnungNummer ?? 'Entwurf ohne Nummer')),
            },
            {
              schluessel: 'position', kopf: 'Position', numerisch: true,
              zelle: (w) => w.positionNr,
            },
            {
              schluessel: 'bezeichnung', kopf: 'Zeile',
              zelle: (w) => w.positionBezeichnung,
            },
            {
              schluessel: 'wirksam',
              kopf: 'Wirksam',
              zelle: (w) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={w.wirksam ? 'Aktiv' : 'Archiviert'} />
                  <span className="text-xs text-text-muted">
                    {w.wirksam
                      ? `berechnet · ${w.rechnungStatus}`
                      : 'unwirksam — aus einem Storno übernommen'}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}

      <h2 className="mb-s3 mt-s7 text-h2 text-text">Der Zustandsverlauf</h2>
      <div className="rounded-lg border border-line bg-surface-2 p-s5 text-sm">
        <ul className="m-0 list-none space-y-s2 p-0">
          {FOLGE.map((f) => (
            <li
              key={f.von}
              className={`flex flex-wrap items-baseline gap-s3 ${
                f.von === a.status ? 'text-text' : 'text-text-muted'}`}
            >
              <StatusPill zustand={PILLE[f.von]} />
              <span className="text-xs">→ {f.nach}</span>
              {f.von === a.status ? (
                <span className="text-xs font-semibold">hier</span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="m-0 mt-s3 max-w-prose text-xs text-text-muted">
          Der Übergang wird in der Datenbank erzwungen
          (<code>fin.ausgabe_uebergang</code>), nicht in der Oberfläche
          angeboten. <strong>Gelöscht wird nichts</strong> (Invariante 8);
          zurückgewiesen wird mit Grund, und ab <em>gebucht</em> ist die Zeile
          unveränderlich — korrigiert wird durch eine Gegenbuchung.
        </p>
      </div>
    </PortalRahmen>
  );
}
