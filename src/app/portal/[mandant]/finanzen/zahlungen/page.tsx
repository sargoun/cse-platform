import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { bankkonten, offenePosten } from '@/server/services/finanz/zahlung/index';
import { formatiereIban } from '@/server/services/finanz/zahlung/iban';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/finanzen/zahlungen` — was offen ist, und was eingegangen
 * ist (FIN-14, ACC-04, ACC-07).
 *
 * **Die Seite zeigt zuerst die FORDERUNGEN, nicht die Zahlungen.** Wer sie
 * öffnet, will wissen, was fehlt — die Liste der eingegangenen Zahlungen ist
 * das Protokoll dazu und steht darunter. Ein Bildschirm, der mit dem
 * Eingegangenen anfängt, beantwortet die Frage, die niemand gestellt hat.
 *
 * **Kein Betrag wird hier gerechnet.** `offen_cent` ist eine erzeugte Spalte
 * der Datenbank, fortgeschrieben von den Auslösern aus 0121 und jede Nacht
 * gegen die Ableitung gehalten. Die Seite formatiert, mehr nicht (Invariante
 * 1, CLAUDE.md: keine Rechnung in einer Komponente).
 *
 * **Erfasst wird, nicht ausgelöst.** Es gibt keine Bankanbindung; der Knopf
 * heißt deshalb „Zahlung erfassen" und nicht „bezahlen". Ein Wort, das eine
 * Überweisung verspricht, wäre eine erfundene Integration.
 */
export const dynamic = 'force-dynamic';

interface ZahlungZeile {
  readonly id: string;
  readonly zahlungsdatum: string;
  readonly betrag_cent: string;
  readonly zahlungsmittel: string;
  readonly referenz: string | null;
  readonly storniert_am: string | null;
  readonly verteilt_cent: string;
}

const MITTEL: Readonly<Record<string, string>> = {
  ueberweisung: 'Überweisung',
  lastschrift: 'Lastschrift',
  bar: 'Barzahlung',
  karte: 'Kartenzahlung',
  verrechnung: 'Verrechnung',
};

export default async function Zahlungen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/zahlungen`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * `/finanzen/rechnungen/[id]` verlangt laut Manifest `finanzen.lesen`; diese
   * Seite oeffnet mit `zahlung.lesen`. Wer Zahlungen erfassen darf, darf nicht
   * zwangslaeufig den Beleg oeffnen — der Verweis fuehrte dann auf 404 und
   * verriete, was er nicht zeigen darf (AUT-06, Copilot-Runde auf PR 16 /
   * D-581). Ohne das Recht steht die Nummer als blosser Text.
   */
  const darf = await haeltRechte(sitzung, 'finanzen.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      posten: await offenePosten(kontext, { nurOffene: true }),
      konten: await bankkonten(kontext),
      zahlungen: await kontext.abfrage<ZahlungZeile>(
        /**
         * `verteilt_cent` steht daneben, damit eine Zahlung sichtbar wird,
         * die noch nicht (ganz) zugeordnet ist. Ohne diese Spalte liegt Geld
         * auf dem Konto und in keiner Forderung, und niemand sieht es.
         */
        `select z.id, to_char(z.zahlungsdatum, 'DD.MM.YYYY') as zahlungsdatum,
                z.betrag_cent::text, z.zahlungsmittel::text as zahlungsmittel,
                z.referenz, to_char(z.storniert_am, 'DD.MM.YYYY') as storniert_am,
                coalesce((select sum(zz.betrag_cent) from zahlung_zuordnung zz
                           where zz.zahlung_id = z.id
                             and zz.art in ('zahlung','mahngebuehr','zins','ueberzahlung')),
                         0)::text as verteilt_cent
           from zahlung z
          where z.richtung = 'eingang'
          order by z.zahlungsdatum desc, z.erstellt_am desc
          limit 100`),
    }))) as Promise<{
      posten: Awaited<ReturnType<typeof offenePosten>>;
      konten: Awaited<ReturnType<typeof bankkonten>>;
      zahlungen: readonly ZahlungZeile[];
    }>);

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const forderungen = daten.posten.filter((p) => p.art === 'debitor');
  const guthaben = daten.posten.filter((p) => p.art === 'debitor_guthaben');
  const summeOffen = forderungen.reduce((s, p) => s + p.offenCent, 0n);

  return (
    <PortalRahmen
      titel="Zahlungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zahlungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">Zahlungen</h1>

      <section aria-labelledby="forderungen-titel" className="mb-s7">
        <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 id="forderungen-titel" className="text-h2 text-text">Offene Forderungen</h2>
          <p className="text-sm text-text-muted">
            Summe offen: <strong className="text-text">{formatiereGeld(cent(summeOffen))}</strong>
          </p>
        </div>

        {forderungen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Keine offene Forderung. Ein Posten entsteht mit dem Festschreiben
            einer Rechnung — ein Entwurf fordert nichts.
          </p>
        ) : (
          <DataTable
            beschriftung="Offene Forderungen mit Rechnungsnummer, Kunde, Betrag und Fälligkeit"
            zeilen={forderungen}
            schluessel={(p) => p.id}
            spalten={[
              {
                schluessel: 'nummer',
                kopf: 'Rechnung',
                zelle: (p) => (p.rechnungId === null ? '—'
                  : darf['finanzen.lesen'] !== true ? (p.rechnungsnummer ?? '—') : (
                    <Link
                      href={`/portal/${mandant}/finanzen/rechnungen/${p.rechnungId}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline"
                    >
                      {p.rechnungsnummer ?? '—'}
                    </Link>
                  )),
              },
              { schluessel: 'kunde', kopf: 'Kunde', zelle: (p) => p.kundeName ?? '—' },
              {
                schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
                zelle: (p) => formatiereGeld(p.betragCent),
              },
              {
                schluessel: 'bezahlt', kopf: 'Bezahlt', numerisch: true,
                zelle: (p) => formatiereGeld(p.bezahltCent),
              },
              {
                schluessel: 'offen', kopf: 'Offen', numerisch: true,
                zelle: (p) => <strong>{formatiereGeld(p.offenCent)}</strong>,
              },
              {
                schluessel: 'faellig',
                kopf: 'Fällig',
                zelle: (p) => (
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    {p.faelligAm}
                    {p.ueberfaelligTage > 0 ? (
                      <StatusPill zustand="Überfällig" />
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>

      {guthaben.length === 0 ? null : (
        <section aria-labelledby="guthaben-titel" className="mb-s7">
          <h2 id="guthaben-titel" className="mb-s3 text-h2 text-text">Guthaben der Kunden</h2>
          <p className="mb-s3 max-w-prose text-sm text-text-muted">
            Ein Guthaben entsteht aus einer Überzahlung oder aus einem Storno.
            Es ist eine Verbindlichkeit: der Betrag steht dem Kunden zu, bis er
            mit einer Rechnung verrechnet oder erstattet wird.
          </p>
          <DataTable
            beschriftung="Guthaben der Kunden mit Betrag und Entstehungstag"
            zeilen={guthaben}
            schluessel={(p) => p.id}
            spalten={[
              { schluessel: 'kunde', kopf: 'Kunde', zelle: (p) => p.kundeName ?? '—' },
              {
                schluessel: 'offen', kopf: 'Offen', numerisch: true,
                zelle: (p) => formatiereGeld(p.offenCent),
              },
              { schluessel: 'seit', kopf: 'Seit', zelle: (p) => p.faelligAm },
            ]}
          />
        </section>
      )}

      <section aria-labelledby="erfassen-titel" className="mb-s7">
        <h2 id="erfassen-titel" className="mb-s3 text-h2 text-text">Zahlungseingang erfassen</h2>

        {forderungen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Es gibt keine offene Forderung, auf die sich eine Zahlung buchen
            ließe.
          </p>
        ) : (
          <form
            method="post"
            action={`/api/finanzen/zahlungen?mandant=${mandant}`}
            className="max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <label className="block text-sm text-text" htmlFor="rechnungId">Rechnung</label>
            <select id="rechnungId" name="rechnungId" required className={feld}>
              {forderungen.map((p) => (
                <option key={p.id} value={p.rechnungId ?? ''}>
                  {p.rechnungsnummer ?? '—'} · {p.kundeName ?? '—'} · offen{' '}
                  {formatiereGeld(p.offenCent)}
                </option>
              ))}
            </select>

            <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <label className="block text-sm text-text" htmlFor="betrag">
                  Betrag in Euro
                </label>
                <input
                  id="betrag" name="betrag" type="text" inputMode="decimal" required
                  placeholder="1190,00" className={feld}
                />
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="zahlungsdatum">
                  Buchungstag
                </label>
                <input
                  id="zahlungsdatum" name="zahlungsdatum" type="date" required className={feld}
                />
              </div>
            </div>

            <label className="mt-s4 block text-sm text-text" htmlFor="zahlungsmittel">
              Zahlungsmittel
            </label>
            <select id="zahlungsmittel" name="zahlungsmittel" required className={feld}>
              <option value="ueberweisung">Überweisung</option>
              <option value="lastschrift">Lastschrift</option>
              <option value="karte">Kartenzahlung</option>
              <option value="verrechnung">Verrechnung</option>
            </select>
            {/*
              * `bar` fehlt mit Absicht: eine Barzahlung verlangt eine Kasse
              * (§7.1), und ohne Kassenbuch (PR 54.3) gäbe es zu ihr keinen
              * Beleg. Ein Auswahlwert, der beim Speichern scheitert, ist
              * schlechter als keiner.
              */}

            <label className="mt-s4 block text-sm text-text" htmlFor="bankkontoId">
              Eingegangen auf
            </label>
            <select id="bankkontoId" name="bankkontoId" className={feld}>
              <option value="">— ohne Kontobezug —</option>
              {daten.konten.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.bezeichnung} · {formatiereIban(k.iban)}
                </option>
              ))}
            </select>

            <label className="mt-s4 block text-sm text-text" htmlFor="referenz">
              Verwendungszweck oder Referenz
            </label>
            <input id="referenz" name="referenz" type="text" className={feld} />

            <p className="mt-s4 max-w-prose text-xs text-text-muted">
              Kommt mehr an, als offen ist, wird der Überschuss NICHT auf die
              Rechnung gebucht: er wird als Guthaben des Kunden geführt und
              oben ausgewiesen.
            </p>

            <button
              type="submit"
              className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
            >
              Zahlung erfassen
            </button>
          </form>
        )}
      </section>

      <section aria-labelledby="eingang-titel">
        <h2 id="eingang-titel" className="mb-s3 text-h2 text-text">Erfasste Zahlungseingänge</h2>
        {daten.zahlungen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Noch keine Zahlung erfasst.
          </p>
        ) : (
          <DataTable
            beschriftung="Erfasste Zahlungseingänge mit Datum, Betrag, Zahlungsmittel und Zuordnung"
            zeilen={daten.zahlungen}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'datum',
                kopf: 'Datum',
                zelle: (z) => (
                  <Link
                    href={`/portal/${mandant}/finanzen/zahlungen/${z.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.zahlungsdatum}
                  </Link>
                ),
              },
              {
                schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
                zelle: (z) => formatiereGeld(cent(BigInt(z.betrag_cent))),
              },
              {
                schluessel: 'mittel', kopf: 'Mittel',
                zelle: (z) => MITTEL[z.zahlungsmittel] ?? z.zahlungsmittel,
              },
              {
                schluessel: 'referenz', kopf: 'Referenz',
                zelle: (z) => z.referenz ?? <span className="text-text-subtle">—</span>,
              },
              {
                schluessel: 'zustand',
                kopf: 'Zustand',
                zelle: (z) => {
                  if (z.storniert_am !== null) {
                    return <StatusPill zustand="Archiviert" />;
                  }
                  const rest = BigInt(z.betrag_cent) - BigInt(z.verteilt_cent);
                  return rest === 0n
                    ? <StatusPill zustand="Abgeschlossen" />
                    : (
                      <span className="text-sm text-warning">
                        {formatiereGeld(cent(rest))} nicht zugeordnet
                      </span>
                    );
                },
              },
            ]}
          />
        )}
      </section>
    </PortalRahmen>
  );
}
