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
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { RECHNUNG_AKTE_TEXTE } from '@/lib/i18n/verwaltung/finanzen/rechnung-akte';
import { Recht } from '@/components/ui/Recht';

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
 * Zeiteinträge, Aufmasse, Abrufe und Ausgaben, die dieser Entwurf
 * beansprucht, sind danach wieder abrechenbar — ebenso der Monat einer
 * Pauschale oder das Los, das eine Zeile aus einer Abrechnungsvereinbarung
 * hält (V-395). Diese Seite zeigt sie vorher, denn wer verwirft, soll
 * wissen, welche Leistung damit wieder unabgerechnet ist.
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

/*
 * Eine Kennung, kein Wort: der Name eines Rechts lautet in beiden Sprachen
 * gleich und wird deshalb nicht uebersetzt; auf dem Schirm steht er als Satz
 * (`<Recht>`).
 */
const RECHT_STORNIEREN = 'finanzen.stornieren';

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
     verlangt `finanzen.lesen`, und die Stornoseite `finanzen.stornieren`
     (nach Katalog nur an super_admin gebunden). Beide werden gefragt, BEVOR
     ein Verweis gezeigt wird — ohne das Recht führte er auf 404 und verriete,
     was er verbergen soll (AUT-06, D-581). */
  const darf = await haeltRechte(sitzung, 'finanzen.lesen', 'finanzen.stornieren');

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(RECHNUNG_AKTE_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

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
                  where p.mandant_id = r.mandant_id and p.rechnung_id = r.id
                    and p.entfernt_am is null)::int
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
   * Frei werden die WIRKSAMEN Quellen — eine unwirksame war schon
   * freigegeben. Darunter jede mit eigener Kennung (Stunde, Abruf, Ausgabe …)
   * und jede Zeile aus einer Abrechnungsvereinbarung: sie steht „von Hand",
   * beansprucht aber den Monat ihrer Pauschale oder ihr Los (V-207), und
   * nach dem Verwerfen lässt sich dieser Zeitraum wieder berechnen (V-395).
   * Eine Zeile „von Hand" ohne Vereinbarung hält nichts fest.
   */
  const freiwerdend = daten.quellen.filter(
    (q) => q.wirksam && (q.quelleId !== null || q.ausVereinbarung));

  const feld = 'mt-s2 block min-h-11 w-full max-w-prose rounded-md border '
    + 'border-line bg-surface-3 p-s3 text-sm text-text';

  return (
    <PortalRahmen
      /* Auch der RUECKWEG steht unter dem Recht seines Ziels (AUT-06):
         ein Pfeil auf eine Seite, die der Benutzer nicht oeffnen darf,
         fuehrt auf ein 404 — und verraet damit, dass es sie gibt. */
      {...(darf['finanzen.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/finanzen/rechnungen/${id}`, text: k.nummer ?? t.entwurfOhneNummer } }
        : {})}
      titel={t.entwurfVerwerfen}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >

      <h1 className="mb-s3 text-h1 text-text">{t.entwurfVerwerfen}</h1>

      <Hinweis art="hinweis" cse="verwerfen-erklaerung" className="mb-s5">
        <p className="m-0 max-w-prose">
          {t.wechseltVon} <strong>{t.entwurf}</strong> {t.nachWort}{' '}
          <strong>{t.verworfen}</strong>{t.zeileBleibt}{' '}
          <strong className="text-text">{t.nichtsGeloescht}</strong>{' '}
          {t.keineLuecke}
        </p>
      </Hinweis>

      <h2 className="mb-s3 text-h2 text-text">{t.entwurfKurzform}</h2>
      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">{g.kunde}</dt>
          <dd className="text-sm text-text">{k.kunde}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.leistungszeitraum}</dt>
          <dd className="text-sm text-text">
            {k.leistung_von === null && k.leistung_bis === null
              ? '—'
              : `${k.leistung_von ?? '—'} – ${k.leistung_bis ?? '—'}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.rechnungsdatum}</dt>
          <dd className="text-sm text-text">{k.rechnungsdatum ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.netto}</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.netto_gesamt_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.brutto}</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.brutto_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.positionen}</dt>
          <dd className="cse-zahl text-sm text-text">{k.positionen}</dd>
        </div>
      </dl>

      <h2 className="mb-s3 text-h2 text-text">{t.wasWiederFrei}</h2>
      {freiwerdend.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.keineQuelle}
        </p>
      ) : (
        <>
          <p className="mb-s3 max-w-prose text-sm text-text-muted">
            {t.quellenErklaerung}
          </p>
          <DataTable
            beschriftung={t.tabelleQuellen}
            zeilen={freiwerdend}
            schluessel={(q) => q.id}
            spalten={[
              {
                schluessel: 'position', kopf: t.position, numerisch: true,
                zelle: (q) => q.positionNr,
              },
              {
                schluessel: 'typ', kopf: t.herkunft,
                zelle: (q) => (q.typ === 'manuell' && q.ausVereinbarung
                  ? t.herkunftVereinbarung
                  : t.herkunftNamen[q.typ as keyof typeof t.herkunftNamen] ?? q.typ),
              },
              {
                schluessel: 'bezeichnung', kopf: t.beleg,
                zelle: (q) => q.bezeichnung,
              },
              {
                schluessel: 'anteil', kopf: t.anteil, numerisch: true,
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
            {t.grundPflicht}
          </label>
          <input id="grund" name="grund" type="text" required minLength={3} className={feld} />
          <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
            {t.grundErklaerung}
          </p>
          <button
            type="submit"
            className="mt-s4 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
            data-cse="verwerfen-knopf"
          >
            {t.entwurfVerwerfen}
          </button>
        </form>
      ) : (
        <Hinweis art="hinweis" cse="verwerfen-nicht-moeglich" className="mt-s5">
          <p className="m-0 max-w-prose">
            {k.status === 'verworfen'
              ? `${t.verworfenAm} ${k.verworfen_am ?? t.unbekanntesDatum} `
                + `${t.verworfenVon} ${k.verworfen_von ?? t.kontoOhneNamen}`
                + `${t.verworfenWorden} ${t.grundIst} `
                + `${t.zitatAuf}${k.verworfen_grund ?? '—'}${t.zitatZu}. `
                + t.zeileBleibtStehen
              : t.istFestgeschrieben}
          </p>
          {k.status === 'festgeschrieben' && darf['finanzen.stornieren'] === true ? (
            <p className="m-0 mt-s2">
              <Link
                href={`/portal/${mandant}/finanzen/rechnungen/${id}/storno`}
                className="text-sm underline underline-offset-2"
              >
                {t.zurStornoseite}
              </Link>
            </p>
          ) : k.status === 'festgeschrieben' ? (
            <p className="m-0 mt-s2 text-sm text-text-muted">
              {t.stornoLaeuftUeber}{' '}
              <Recht schluessel={RECHT_STORNIEREN} sprache={zugang.sprache} />{t.rechtFehltErklaerung}
            </p>
          ) : null}
        </Hinweis>
      )}
    </PortalRahmen>
  );
}
