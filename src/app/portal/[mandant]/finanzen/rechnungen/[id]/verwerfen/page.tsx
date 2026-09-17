import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { ladeQuellen, type QuelleZeile } from '@/server/services/finanz/positionsquelle';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]/verwerfen` — der Entwurf wird
 * **verworfen, nie gelöscht** (04-SEITENKARTE.md §5.14.1, FIN-02, FIN-03,
 * Invariante 8).
 *
 * **Die Seite sagt in einem Satz, was passiert**, weil der Unterschied
 * zwischen „verworfen" und „gelöscht" hier alles ist: der Zustand wechselt
 * von `entwurf` nach `verworfen`, die Zeile bleibt stehen, mit Grund und mit
 * Zeitpunkt. Der verworfene Entwurf IST der GoBD-Satz, der bezeugt, dass hier
 * keine Rechnung entstanden ist — ohne ihn bliebe eine Lücke in der Ablage,
 * die niemand erklären kann.
 *
 * **Und es entsteht keine Nummernlücke**, weil ein Entwurf nie eine Nummer
 * hält: der Zähler wird erst in der Festschreibungstransaktion berührt
 * (§5.5). Das ist die Zusage aus Phase 6 — „1000 verworfene Entwürfe
 * hinterlassen null Lücken" —, und sie gilt baulich, nicht aus Vorsicht.
 *
 * **Die Quellen werden frei.** `verwerfe()` ruft `gibQuellenFrei()`: die
 * abgerechneten Zeiteinträge und Aufmasse dieses Entwurfs sind danach wieder
 * abrechenbar. Diese Seite zeigt sie vorher, denn wer verwirft, soll wissen,
 * welche Leistung damit wieder unabgerechnet ist.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Entwurf verwerfen — Rechnung' };

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsart: string;
  readonly kunde: string;
  readonly rechnungsdatum: string | null;
  readonly leistung_von: string | null;
  readonly leistung_bis: string | null;
  readonly netto_gesamt_cent: string;
  readonly brutto_cent: string;
  readonly positionen: number;
  readonly verworfen_am: string | null;
  readonly verworfen_von: string | null;
  readonly verworfen_grund: string | null;
}

const TYP_TEXT: Readonly<Record<string, string>> = {
  zeiteintrag: 'Zeiteintrag',
  aufmass: 'Aufmass',
  vertrag: 'Vertragsleistung',
  material: 'Material (Ausgabe)',
  leistungsnachweis: 'Leistungsnachweis',
  nachtrag: 'Nachtrag',
  sonderleistung: 'Sonderleistung',
  manuell: 'von Hand',
};

export default async function Verwerfenblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/finanzen/rechnungen/${id}/verwerfen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* Diese Seite öffnet mit `finanzen.entwurf_verwerfen`; der Beleg daneben
     verlangt `finanzen.lesen` (AUT-06, D-581). */
  const darf = await haeltRechte(sitzung, 'finanzen.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status,
                r.rechnungsart::text as rechnungsart, k.name as kunde,
                to_char(r.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                to_char(r.leistung_von, 'DD.MM.YYYY') as leistung_von,
                to_char(r.leistung_bis, 'DD.MM.YYYY') as leistung_bis,
                r.netto_gesamt_cent::text, r.brutto_cent::text,
                (select count(*) from rechnungsposition p
                  where p.mandant_id = r.mandant_id and p.rechnung_id = r.id)::int
                  as positionen,
                to_char(r.verworfen_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as verworfen_am,
                bn.name as verworfen_von, r.verworfen_grund
           from rechnung r
           join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
           left join benutzer bn on bn.id = r.verworfen_von
          where r.id = $1`, [id]);
      if (kopf === undefined) return { kopf: null, quellen: [] };
      return { kopf, quellen: await ladeQuellen(kontext, id) };
    })) as Promise<{ kopf: Kopf | null; quellen: readonly QuelleZeile[] }>);

  const k = daten.kopf;
  if (k === null) notFound();

  const entwurf = k.status === 'entwurf';
  /*
   * Freigegeben werden nur die WIRKSAMEN Quellen mit einer eigenen Kennung:
   * eine Zeile „von Hand" hält nichts fest, was wieder frei werden könnte,
   * und eine unwirksame war schon freigegeben.
   */
  const freiwerdend = daten.quellen.filter(
    (q) => q.wirksam && q.typ !== 'manuell' && q.quelleId !== null);

  const feld = 'mt-s2 block min-h-11 w-full max-w-prose rounded-md border '
    + 'border-line bg-surface-3 p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel="Entwurf verwerfen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {darf['finanzen.lesen'] === true ? (
        <nav aria-label="Zurück" className="mb-s3">
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${id}`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            ← {k.nummer ?? 'Entwurf ohne Nummer'}
          </Link>
        </nav>
      ) : null}

      <h1 className="mb-s3 text-h1 text-text">Entwurf verwerfen</h1>

      <Hinweis art="hinweis" cse="verwerfen-erklaerung" className="mb-s5">
        <p className="m-0 max-w-prose">
          Der Entwurf wechselt von <strong>Entwurf</strong> nach{' '}
          <strong>verworfen</strong>. Die Zeile bleibt stehen —{' '}
          <strong className="text-text">es wird nichts gelöscht</strong>{' '}
          (Invariante 8). Und weil ein Entwurf nie eine Nummer hält, entsteht
          keine Lücke im Nummernkreis: der Zähler wird erst beim Festschreiben
          berührt.
        </p>
      </Hinweis>

      <h2 className="mb-s3 text-h2 text-text">Der Entwurf in Kurzform</h2>
      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">Kunde</dt>
          <dd className="text-sm text-text">{k.kunde}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Leistungszeitraum</dt>
          <dd className="text-sm text-text">
            {k.leistung_von === null && k.leistung_bis === null
              ? '—'
              : `${k.leistung_von ?? '—'} – ${k.leistung_bis ?? '—'}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Rechnungsdatum</dt>
          <dd className="text-sm text-text">{k.rechnungsdatum ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Netto</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.netto_gesamt_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Brutto</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.brutto_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Positionen</dt>
          <dd className="cse-zahl text-sm text-text">{k.positionen}</dd>
        </div>
      </dl>

      <h2 className="mb-s3 text-h2 text-text">Was durch das Verwerfen wieder frei wird</h2>
      {freiwerdend.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine Quelle ist an diesem Entwurf gebunden. Es wird also keine
          Leistung wieder abrechenbar — entweder stehen die Positionen „von
          Hand", oder der Entwurf hat noch keine.
        </p>
      ) : (
        <>
          <p className="mb-s3 max-w-prose text-sm text-text-muted">
            Diese Quellen sind heute als abgerechnet markiert. Nach dem
            Verwerfen sind sie wieder abrechenbar und erscheinen bei der
            nächsten Rechnung zu diesem Auftrag erneut.
          </p>
          <DataTable
            beschriftung="Quellen, die durch das Verwerfen wieder abrechenbar werden"
            zeilen={freiwerdend}
            schluessel={(q) => q.id}
            spalten={[
              {
                schluessel: 'position', kopf: 'Position', numerisch: true,
                zelle: (q) => q.positionNr,
              },
              {
                schluessel: 'typ', kopf: 'Herkunft',
                zelle: (q) => TYP_TEXT[q.typ] ?? q.typ,
              },
              {
                schluessel: 'bezeichnung', kopf: 'Beleg',
                zelle: (q) => q.bezeichnung,
              },
              {
                schluessel: 'anteil', kopf: 'Anteil', numerisch: true,
                zelle: (q) => formatiereGeld(q.anteilCent),
              },
            ]}
          />
        </>
      )}

      {entwurf ? (
        <form
          method="post"
          action={`/api/rechnungen/verwerfen?mandant=${mandant}`}
          className="mt-s5 max-w-prose rounded-lg border border-line-strong bg-surface p-s5"
          data-cse="verwerfen-formular"
        >
          <input type="hidden" name="rechnungId" value={k.id} />
          <label className="block text-sm text-text" htmlFor="grund">
            Grund (Pflicht)
          </label>
          <input id="grund" name="grund" type="text" required minLength={3} className={feld} />
          <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
            Der Grund wird mitgeschrieben. Er ist der Satz, den eine
            Betriebsprüfung liest, wenn sie nach dem Entwurf fragt, zu dem keine
            Rechnung entstanden ist. Nach dem Verwerfen ist der Entwurf nur noch
            lesbar und nicht wiederbelebbar.
          </p>
          <button
            type="submit"
            className="mt-s4 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
            data-cse="verwerfen-knopf"
          >
            Entwurf verwerfen
          </button>
        </form>
      ) : (
        <Hinweis art="hinweis" cse="verwerfen-nicht-moeglich" className="mt-s5">
          <p className="m-0 max-w-prose">
            {k.status === 'verworfen'
              ? `Dieser Entwurf ist am ${k.verworfen_am ?? 'unbekannten Datum'} `
                + `von ${k.verworfen_von ?? 'einem Konto ohne Namen'} verworfen `
                + `worden. Grund: „${k.verworfen_grund ?? '—'}". Die Zeile bleibt `
                + 'stehen; wiederbeleben lässt sie sich nicht.'
              : 'Dieser Beleg ist festgeschrieben. Ein festgeschriebener Beleg wird '
                + 'nicht verworfen, sondern durch eine Stornobuchung aufgehoben — '
                + 'das ist der einzige Weg zu einer Korrektur (Invariante 4).'}
          </p>
          {k.status === 'festgeschrieben' ? (
            <p className="m-0 mt-s2">
              <Link
                href={`/portal/${mandant}/finanzen/rechnungen/${id}/storno`}
                className="text-sm underline underline-offset-2"
              >
                Zur Stornoseite →
              </Link>
            </p>
          ) : null}
        </Hinweis>
      )}
    </PortalRahmen>
  );
}
