import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld, subtrahiere, type Cent } from '@/server/services/finanz/geld';
import {
  AbschlagFehler, abschlaegeZumAuftrag, berechneVerrechnung, jeSteuergruppe,
  offeneAbschlaege, offeneAbschlaegeSatz,
  type AbschlagStand, type Verrechnung,
} from '@/server/services/finanz/abschlag/index';
import { einbehaltCent } from '@/server/services/finanz/abschlag/bedingungen';
import { BEDINGUNGEN_PLATZHALTER }
  from '@/server/services/finanz/abschlag/bedingungen.platzhalter';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]/abschlaege` — die früheren
 * Abschläge und ihr Abzug von dieser Schlussrechnung (04-SEITENKARTE.md
 * §5.14, FIN-08, VOB/B §16).
 *
 * **Die Aufteilung je Steuersatzgruppe, nie ein Mischsatz.** Der Abzug trägt
 * die Steueraufteilung, die der abgezogene Beleg ausweist — `jeSteuergruppe()`
 * summiert sie, und summiert wird, nicht gerundet. Ein aus dem Brutto
 * zurückgerechneter Mischsatz wäre eine Zahl, die auf keinem der beiden Belege
 * steht (Invariante 1).
 *
 * **Der Sicherheitseinbehalt steht als offene Frage da — nicht als 0,00 €.**
 * `einbehaltCent()` gibt bei `einbehalt === null` bewusst `0n` zurück und
 * wirft NICHT: eine Schlussrechnung ohne entschiedenen Einbehalt ist keine
 * kaputte Rechnung, sondern eine ohne Einbehalt, und das ist die haftungsfreie
 * Richtung. Damit „kein Einbehalt" aber nicht wie eine Entscheidung aussieht,
 * zeigt diese Seite `BEDINGUNGEN_PLATZHALTER.herkunft` **wörtlich** an — genau
 * so, wie der Platzhalter es verlangt. Der Betrag bleibt 0,00 €; der Satz
 * daneben sagt, warum.
 *
 * **Ein noch nicht abgezogener Abschlag steht OBEN.** FIN-08 verhindert die
 * Festschreibung, solange einer offen ist; wer die Rechnung gerade abschicken
 * wollte, braucht die Nummern jetzt und nicht erst in der Fehlermeldung.
 *
 * **Die Seite schreibt nichts.** Der Abzug entsteht über
 * `POST /api/rechnungen/abschlaege` (`finanzen.schreiben`); diese Route öffnet
 * mit `finanzen.lesen` und zeigt, was er täte.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Abschläge — Rechnung' };

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsart: string;
  readonly kunde: string;
  readonly auftrag_id: string | null;
  readonly auftragsnummer: string | null;
  readonly auftrag_netto_cent: string | null;
  readonly auftrag_einbehalt_bp: number | null;
  readonly auftrag_einbehalt_cent: string | null;
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly brutto_cent: string;
  readonly abzug_brutto_cent: string;
  readonly zahlbetrag_cent: string;
}

interface GruppenZeile {
  readonly gruppeId: string;
  readonly gruppe: string;
  readonly satzBp: number;
  readonly netto: Cent;
  readonly steuer: Cent;
}

export default async function Abschlagsblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/finanzen/rechnungen/${id}/abschlaege`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* Der Schreibweg verlangt `finanzen.schreiben`; ohne es steht hier der
     Stand, aber kein Knopf (AUT-06, D-581). */
  const darf = await haeltRechte(sitzung, 'finanzen.schreiben');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status,
                r.rechnungsart::text as rechnungsart, k.name as kunde,
                r.auftrag_id::text as auftrag_id, a.auftragsnummer,
                a.auftragswert_netto_cent::text as auftrag_netto_cent,
                a.sicherheitseinbehalt_bp as auftrag_einbehalt_bp,
                a.sicherheitseinbehalt_cent::text as auftrag_einbehalt_cent,
                r.netto_gesamt_cent::text, r.steuer_gesamt_cent::text,
                r.brutto_cent::text, r.abzug_brutto_cent::text,
                r.zahlbetrag_cent::text
           from rechnung r
           join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
           left join auftrag a on a.mandant_id = r.mandant_id and a.id = r.auftrag_id
          where r.id = $1`, [id]);
      if (kopf === undefined) {
        return { kopf: null, stand: [], verrechnung: null, fehler: null, offen: null, gruppen: [] };
      }

      const stand: readonly AbschlagStand[] = kopf.auftrag_id === null
        ? []
        : await abschlaegeZumAuftrag(kontext, kopf.auftrag_id);

      /*
       * `berechneVerrechnung` HÄLT AN, wo die Antwort kaufmännisch ist und
       * nicht technisch — ein stornierter Abschlag, ein Abschlag, den eine
       * andere Schlussrechnung schon abzieht, eine Rechnung, die keine
       * Schlussrechnung ist. Der Fehler wird hier zu einem SATZ auf der Seite
       * und nicht zu einem 500: er ist die Auskunft, wegen der jemand die
       * Seite geöffnet hat.
       */
      let verrechnung: Verrechnung | null = null;
      let fehler: string | null = null;
      try {
        verrechnung = await berechneVerrechnung(kontext, id);
      } catch (e) {
        if (e instanceof AbschlagFehler) fehler = e.message;
        else throw e;
      }

      const gruppen: GruppenZeile[] = [];
      if (verrechnung !== null) {
        const karte = jeSteuergruppe(verrechnung.zeilen);
        const bezeichnungen = await kontext.abfrage<{
          id: string; bezeichnung: string; satz_bp: number;
        }>(
          `select id::text as id, bezeichnung, satz_bp from steuersatz_gruppe
            where id = any($1::uuid[])`, [[...karte.keys()]]);
        for (const [gruppeId, summe] of karte) {
          const g = bezeichnungen.find((b) => b.id === gruppeId);
          gruppen.push({
            gruppeId,
            gruppe: g?.bezeichnung ?? 'unbekannte Steuersatzgruppe',
            satzBp: g?.satz_bp ?? 0,
            netto: summe.netto,
            steuer: summe.steuer,
          });
        }
        gruppen.sort((a, b) => b.satzBp - a.satzBp);
      }

      return {
        kopf,
        stand,
        verrechnung,
        fehler,
        offen: offeneAbschlaegeSatz(await offeneAbschlaege(kontext, id)),
        gruppen,
      };
    })) as Promise<{
      kopf: Kopf | null;
      stand: readonly AbschlagStand[];
      verrechnung: Verrechnung | null;
      fehler: string | null;
      offen: string | null;
      gruppen: readonly GruppenZeile[];
    }>);

  const k = daten.kopf;
  if (k === null) notFound();

  /*
   * Der Einbehalt: der DIENST rechnet ihn, die Seite zeigt ihn. Er ist heute
   * immer 0n, weil `BEDINGUNGEN_PLATZHALTER.einbehalt` null ist — und genau
   * deshalb steht `herkunft` darunter.
   */
  const einbehalt = einbehaltCent(BEDINGUNGEN_PLATZHALTER, {
    auftragssummeNettoCent: k.auftrag_netto_cent === null
      ? null : cent(BigInt(k.auftrag_netto_cent)),
    schlussNettoCent: cent(BigInt(k.netto_gesamt_cent)),
  });

  const verbleibend = subtrahiere(cent(BigInt(k.zahlbetrag_cent)), einbehalt);
  const istSchluss = k.rechnungsart === 'schluss';
  const entwurf = k.status === 'entwurf';

  return (
    <PortalRahmen
      titel="Abschläge und ihr Abzug"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/rechnungen/${id}`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← {k.nummer ?? 'Entwurf ohne Nummer'}
        </Link>
      </nav>

      <h1 className="mb-s3 text-h1 text-text">Abschläge und ihr Abzug</h1>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">Kunde</dt>
          <dd className="text-sm text-text">{k.kunde}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Auftrag</dt>
          <dd className="text-sm text-text">
            {k.auftragsnummer ?? <span className="text-text-subtle">kein Auftrag</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Rechnungsart</dt>
          <dd className="text-sm text-text">
            {istSchluss ? 'Schlussrechnung' : k.rechnungsart}
          </dd>
        </div>
      </dl>

      {daten.offen === null ? null : (
        <Hinweis art="warnung" cse="abschlaege-offen" className="mb-s5">
          <p className="m-0 max-w-prose">{daten.offen}</p>
          <p className="m-0 mt-s2 max-w-prose text-text">
            Solange ein Abschlag offen ist, wird diese Schlussrechnung nicht
            festgeschrieben (FIN-08) — sonst verlangte sie den Auftragswert ein
            zweites Mal ein.
          </p>
        </Hinweis>
      )}

      {daten.fehler === null ? null : (
        <Hinweis art="warnung" cse="abschlaege-haelt-an" className="mb-s5">
          <p className="m-0 max-w-prose">{daten.fehler}</p>
        </Hinweis>
      )}

      <h2 className="mb-s3 text-h2 text-text">Die Abschläge dieses Auftrags</h2>
      {daten.stand.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {k.auftrag_id === null
            ? 'Diese Rechnung hängt an keinem Auftrag. Welche Abschläge zu ihr '
              + 'gehören, lässt sich damit nicht beantworten — und geraten wird hier '
              + 'nichts.'
            : 'Zu diesem Auftrag ist kein festgeschriebener Abschlag und keine '
              + 'Anzahlung ausgestellt. Es gibt nichts abzuziehen.'}
        </p>
      ) : (
        <DataTable
          beschriftung="Frühere Abschläge und Anzahlungen dieses Auftrags"
          zeilen={daten.stand}
          schluessel={(a) => a.rechnungId}
          spalten={[
            {
              schluessel: 'nummer', kopf: 'Nummer',
              /* Der Verweis ist immer sicher: diese Route oeffnet laut Register
                 mit `finanzen.lesen`, und genau das verlangt das Ziel. */
              zelle: (a) => (
                <Link
                  href={`/portal/${mandant}/finanzen/rechnungen/${a.rechnungId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {a.nummer}
                </Link>
              ),
            },
            { schluessel: 'datum', kopf: 'Datum', zelle: (a) => a.rechnungsdatum },
            {
              schluessel: 'brutto', kopf: 'Brutto', numerisch: true,
              zelle: (a) => formatiereGeld(a.bruttoCent),
            },
            {
              schluessel: 'zustand', kopf: 'Zustand',
              zelle: (a) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  {a.storniert ? <StatusPill zustand="Archiviert" /> : null}
                  <span className="text-xs text-text-muted">
                    {a.storniert
                      ? 'storniert — der Abzug hält an'
                      : a.verrechnetVon === null
                        ? 'noch nicht abgezogen'
                        : a.verrechnetVon === k.id
                          ? 'wird hier abgezogen'
                          : 'wird von einer anderen Schlussrechnung abgezogen'}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}

      <h2 className="mb-s3 mt-s7 text-h2 text-text">
        Der Abzug je Steuersatzgruppe
      </h2>
      {daten.gruppen.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Abzug. {daten.fehler === null
            ? 'Es gibt keinen abzuziehenden Abschlag.'
            : 'Der Abzug ist nicht berechenbar — der Grund steht oben.'}
        </p>
      ) : (
        <>
          <p className="mb-s3 max-w-prose text-sm text-text-muted">
            Die Aufteilung kommt aus den Steuerzeilen der abgezogenen Belege und
            wird summiert, nicht gerundet. Ein aus dem Brutto zurückgerechneter
            Mischsatz stünde auf keinem der beiden Belege (Invariante 1).
          </p>
          <DataTable
            beschriftung="Abzug je Steuersatzgruppe"
            zeilen={daten.gruppen}
            schluessel={(g) => g.gruppeId}
            spalten={[
              { schluessel: 'gruppe', kopf: 'Steuersatzgruppe', zelle: (g) => g.gruppe },
              {
                schluessel: 'satz', kopf: 'Satz', numerisch: true,
                zelle: (g) => `${(g.satzBp / 100).toLocaleString('de-DE')} %`,
              },
              {
                schluessel: 'netto', kopf: 'Netto', numerisch: true,
                zelle: (g) => formatiereGeld(g.netto),
              },
              {
                schluessel: 'steuer', kopf: 'USt', numerisch: true,
                zelle: (g) => formatiereGeld(g.steuer),
              },
            ]}
          />
        </>
      )}

      <dl
        data-cse="abschlaege-summen"
        className="mb-s5 mt-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2"
      >
        <div>
          <dt className="text-xs text-text-muted">Brutto dieser Rechnung</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.brutto_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">
            Verrechnungssumme (berechnet)
          </dt>
          <dd className="cse-zahl text-sm text-text">
            {daten.verrechnung === null
              ? '—'
              : formatiereGeld(daten.verrechnung.abzugBruttoCent)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">
            Abzug, wie er auf dem Beleg steht
          </dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.abzug_brutto_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Zahlbetrag des Kunden</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.zahlbetrag_cent)))}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-text-muted">
            Sicherheitseinbehalt (VOB/B §17)
          </dt>
          <dd className="cse-zahl text-sm text-text" data-cse="abschlaege-einbehalt">
            {formatiereGeld(einbehalt)}
            {BEDINGUNGEN_PLATZHALTER.istPlatzhalter
              ? <span className="text-warning"> — offen (O-20)</span>
              : null}
          </dd>
          <dd className="mt-s2 max-w-prose text-xs text-warning">
            {BEDINGUNGEN_PLATZHALTER.herkunft}
          </dd>
          {/*
            * Der Auftrag KANN einen Einbehalt hinterlegt haben
            * (`auftrag.sicherheitseinbehalt_bp` / `_cent`, 0025 — mit demselben
            * O-20 im Kommentar). Er wird hier GEZEIGT und nicht gerechnet: was
            * fehlt, ist nicht die Zahl, sondern die Regel — Grundlage
            * (Auftragssumme oder Schlussrechnungsnetto), Frist ab Abnahme, ob
            * eine Bürgschaft ablösen darf, und ob schon vom Abschlag oder erst
            * von der Schlussrechnung abgezogen wird. Ohne sie wäre jeder
            * Abzug eine Vertragsklausel, die niemand vereinbart hat.
            */}
          {k.auftrag_einbehalt_bp === null && k.auftrag_einbehalt_cent === null ? null : (
            <dd className="mt-s2 max-w-prose text-xs text-text-muted"
                data-cse="abschlaege-einbehalt-auftrag">
              Im Auftrag hinterlegt:{' '}
              {k.auftrag_einbehalt_bp === null
                ? formatiereGeld(cent(BigInt(k.auftrag_einbehalt_cent ?? '0')))
                : `${(k.auftrag_einbehalt_bp / 100).toLocaleString('de-DE')} %`}
              . Abgezogen wird davon nichts, solange die Regel dazu offen ist.
            </dd>
          )}
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-text-muted">Verbleibender Zahlbetrag</dt>
          <dd className="cse-zahl text-base text-text">
            {formatiereGeld(verbleibend)}
          </dd>
        </div>
      </dl>

      {daten.verrechnung !== null
        && daten.verrechnung.abzugBruttoCent !== cent(BigInt(k.abzug_brutto_cent)) ? (
          <Hinweis art="warnung" cse="abschlaege-abweichung" className="mb-s5">
            <p className="m-0 max-w-prose">
              Der berechnete Abzug und der Abzug auf dem Beleg weichen ab. Auf
              einem Entwurf heisst das: der Abzug ist noch nicht geschrieben. Auf
              einem festgeschriebenen Beleg heisst es, dass sich die Abschläge
              danach verändert haben — und dann gilt der Beleg, nicht die
              Rechnung von heute.
            </p>
          </Hinweis>
        ) : null}

      {istSchluss && entwurf && darf['finanzen.schreiben'] === true
       && daten.fehler === null && daten.verrechnung !== null
       && daten.verrechnung.zeilen.length > 0 ? (
         <form
           method="post"
           action={`/api/rechnungen/abschlaege?mandant=${mandant}`}
           className="max-w-prose rounded-lg border border-line-strong bg-surface p-s5"
           data-cse="abschlaege-formular"
         >
           <input type="hidden" name="rechnungId" value={k.id} />
           <h2 className="m-0 text-h3 text-text">Abzug an den Entwurf schreiben</h2>
           <p className="mt-s2 max-w-prose text-sm text-text-muted">
             Es entstehen die Bezugszeilen und der Kopfbetrag —{' '}
             {formatiereGeld(daten.verrechnung.abzugBruttoCent)} aus{' '}
             {daten.verrechnung.nummern.join(', ')}. Nur an einem Entwurf: nach
             dem Festschreiben ist der Beleg unveränderlich.
           </p>
           <button
             type="submit"
             className="mt-s4 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
             data-cse="abschlaege-knopf"
           >
             Abzug schreiben
           </button>
         </form>
       ) : null}

      {istSchluss ? null : (
        <p className="max-w-prose text-sm text-text-muted">
          Abschläge werden nur von einer <strong>Schlussrechnung</strong>{' '}
          abgezogen. Diese Rechnung ist eine der Art „{k.rechnungsart}"; die
          Liste oben zeigt den Stand des Auftrags, aber es gibt hier nichts zu
          verrechnen.
        </p>
      )}
    </PortalRahmen>
  );
}
