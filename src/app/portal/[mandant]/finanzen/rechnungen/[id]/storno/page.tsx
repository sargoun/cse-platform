import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { cent, formatiereGeld, negiere } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgres, milliMenge } from '@/server/services/finanz/menge';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { RECHNUNG_AKTE_TEXTE } from '@/lib/i18n/verwaltung/finanzen/rechnung-akte';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]/storno` — die **stornierende
 * Buchung** (04-SEITENKARTE.md §5.14.1, FIN-02, LEG-01, Invariante 4).
 *
 * **Nichts wird geändert.** Eine festgeschriebene Rechnung ist unveränderlich;
 * korrigiert wird durch einen ZWEITEN Beleg mit gespiegelten Beträgen, eigener
 * Nummer aus demselben Kreis und eigenem Kettenglied. Diese Seite zeigt die
 * Gegenrechnung Position für Position, damit vorher sichtbar ist, was gleich
 * in die Bücher geht — ein Storno, dessen Zahlen man erst hinterher sieht, ist
 * einer, den man hinterher erklären muss.
 *
 * **Der Grund ist Pflicht, mindestens zehn Zeichen**, und er landet in
 * `rechnung_beziehung.grund`. `storniere()` weist kürzere ab; die Seite
 * verlangt dieselbe Länge, damit die Abweisung nicht erst nach dem Absenden
 * kommt. „Fehler" ist keine Begründung, und die Seite sagt das.
 *
 * **Zwei Ausgänge, und die Wahl ist nicht kosmetisch.** „Nur Storno" hebt auf.
 * „Storno und Neuausstellung" legt zusätzlich einen neuen Entwurf an, der die
 * Quellen des Originals neu beansprucht — möglich, weil das Original sie im
 * selben Vorgang freigegeben hat. Wer nur aufheben will, soll nicht
 * versehentlich einen Entwurf erzeugen, den niemand erwartet.
 *
 * **FIN-18 hält einen Storno nie auf.** Er hebt einen Beleg auf, der schon
 * draussen ist; ihn wegen fehlender Zeiterfassung zu sperren wäre die Sperre
 * ausgerechnet auf dem Vorgang, mit dem man eine zu Unrecht gestellte
 * Rechnung loswird.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Storno — Rechnung' };

const STORNO_MINDESTLAENGE = 10;

/*
 * Kennungen, keine Woerter. Rechtename und Tabellenname lauten in beiden
 * Sprachen gleich; sie stehen deshalb hier und nicht in der Texttabelle, wo
 * eine zweite Spalte nur eine Erfindung waere.
 */
const RECHT_STORNIEREN = 'finanzen.stornieren';
const RECHT_ENTWURF_VERWERFEN = 'finanzen.entwurf_verwerfen';
const TABELLE_BEZIEHUNG = 'rechnung_beziehung';

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsart: string;
  readonly kunde: string;
  readonly rechnungsdatum: string | null;
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly brutto_cent: string;
  readonly hash: string | null;
  readonly kette_position: string | null;
  readonly storniert_durch: string | null;
  readonly storniert_durch_id: string | null;
  readonly storno_grund: string | null;
  readonly ersetzt_durch: string | null;
  readonly ersetzt_durch_id: string | null;
  readonly storniert_beleg: string | null;
  readonly storniert_beleg_id: string | null;
}

interface Pos {
  readonly id: string;
  readonly position_nr: number;
  /**
   * `leistung`, `textzeile` oder `zwischensumme`. **`storniere()` spiegelt
   * ausschliesslich `leistung`** — die beiden anderen Arten stehen hier
   * deshalb mit dem Vermerk „wird nicht übernommen" und ohne negierte Zahl.
   *
   * Vorher las diese Seite ALLE Zeilen und zeigte auch eine `zwischensumme`
   * mit negiertem Netto, obwohl der Stornobeleg sie nicht enthält. Eine
   * Vorschau, die etwas anderes zeigt als das, was gebucht wird, ist
   * schlimmer als keine: sie wird nachgerechnet und stimmt.
   */
  readonly positionsart: string;
  readonly bezeichnung: string;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly netto_cent: string | null;
}

export default async function Stornoblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/finanzen/rechnungen/${id}/storno`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* Diese Seite öffnet mit `finanzen.stornieren`; der Beleg daneben verlangt
     `finanzen.lesen` (AUT-06, D-581). */
  /*
   * `finanzen.entwurf_verwerfen` kommt dazu, weil der Hinweis unten auf die
   * Verwerfen-Seite zeigt und diese Route genau dieses Recht verlangt
   * (Routenregister, §5.14). Stornieren und Verwerfen sind zwei Vorgaenge mit
   * zwei Rechten: das eine hebt einen festgeschriebenen Beleg auf, das andere
   * raeumt einen Entwurf weg, der nie einer war. Wer nur stornieren darf,
   * bekam hinter dem Verweis ein 404 (D-567, AUT-06).
   */
  const darf = await haeltRechte(
    sitzung, 'finanzen.lesen', 'finanzen.entwurf_verwerfen');

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(RECHNUNG_AKTE_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status,
                r.rechnungsart::text as rechnungsart, k.name as kunde,
                to_char(r.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                r.netto_gesamt_cent::text, r.steuer_gesamt_cent::text,
                r.brutto_cent::text,
                h.hash, h.kette_position::text as kette_position,
                /* Wer DIESE Rechnung aufhebt (sie ist das Original). */
                (select sr.nummer from rechnung_beziehung bz
                   join rechnung sr
                     on sr.mandant_id = bz.mandant_id and sr.id = bz.von_rechnung_id
                  where bz.mandant_id = r.mandant_id and bz.zu_rechnung_id = r.id
                    and bz.art = 'storno' limit 1) as storniert_durch,
                (select bz.von_rechnung_id::text from rechnung_beziehung bz
                  where bz.mandant_id = r.mandant_id and bz.zu_rechnung_id = r.id
                    and bz.art = 'storno' limit 1) as storniert_durch_id,
                (select bz.grund from rechnung_beziehung bz
                  where bz.mandant_id = r.mandant_id and bz.zu_rechnung_id = r.id
                    and bz.art = 'storno' limit 1) as storno_grund,
                /* Welche Neuausstellung sie ersetzt. */
                (select er.nummer from rechnung_beziehung bz
                   join rechnung er
                     on er.mandant_id = bz.mandant_id and er.id = bz.von_rechnung_id
                  where bz.mandant_id = r.mandant_id and bz.zu_rechnung_id = r.id
                    and bz.art = 'ersetzt' limit 1) as ersetzt_durch,
                (select bz.von_rechnung_id::text from rechnung_beziehung bz
                  where bz.mandant_id = r.mandant_id and bz.zu_rechnung_id = r.id
                    and bz.art = 'ersetzt' limit 1) as ersetzt_durch_id,
                /* Und falls DIESE Rechnung selbst ein Storno ist: wen hebt sie auf. */
                (select orr.nummer from rechnung_beziehung bz
                   join rechnung orr
                     on orr.mandant_id = bz.mandant_id and orr.id = bz.zu_rechnung_id
                  where bz.mandant_id = r.mandant_id and bz.von_rechnung_id = r.id
                    and bz.art = 'storno' limit 1) as storniert_beleg,
                (select bz.zu_rechnung_id::text from rechnung_beziehung bz
                  where bz.mandant_id = r.mandant_id and bz.von_rechnung_id = r.id
                    and bz.art = 'storno' limit 1) as storniert_beleg_id
           from rechnung r
           join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
           left join rechnung_hash h
             on h.mandant_id = r.mandant_id and h.rechnung_id = r.id
          where r.id = $1`, [id]);
      if (kopf === undefined) return { kopf: null, positionen: [] };
      return {
        kopf,
        positionen: await kontext.abfrage<Pos>(
          `select p.id, p.position_nr, p.positionsart::text as positionsart,
                  p.bezeichnung, p.menge::text as menge,
                  e.bezeichnung as einheit, p.netto_cent::text
             from rechnungsposition p
             left join masseinheit e on e.id = p.masseinheit_id
            where p.rechnung_id = $1
            order by p.position_nr`, [id]),
      };
    })) as Promise<{ kopf: Kopf | null; positionen: readonly Pos[] }>);

  const k = daten.kopf;
  if (k === null) notFound();

  const festgeschrieben = k.status === 'festgeschrieben';
  const schonStorniert = k.storniert_durch_id !== null;
  const istSelbstStorno = k.rechnungsart === 'storno';
  const moeglich = festgeschrieben && !schonStorniert && !istSelbstStorno;

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
      titel={t.stornoTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >

      <h1 className="mb-s3 text-h1 text-text">{t.stornoH1}</h1>

      <Hinweis art="warnung" cse="storno-erklaerung" className="mb-s5">
        <p className="m-0 max-w-prose">
          {t.stornoErklaerungVor} <strong>{t.nichtsGeaendert}</strong>
          {t.stornoErklaerungNach}
        </p>
      </Hinweis>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">{g.kunde}</dt>
          <dd className="text-sm text-text">{k.kunde}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.rechnungsdatum}</dt>
          <dd className="text-sm text-text">{k.rechnungsdatum ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.kettenbindung}</dt>
          <dd className="font-mono text-xs text-text-muted" data-cse="storno-kette">
            {k.hash === null
              ? t.keinKettensatzKurz
              : `#${String(k.kette_position)} · ${k.hash.slice(0, 16)}`}
          </dd>
        </div>
      </dl>

      {schonStorniert ? (
        <Hinweis art="hinweis" cse="storno-schon-storniert" className="mb-s5">
          <p className="m-0 max-w-prose">
            {t.schonStorniertVor} <strong>{k.storniert_durch}</strong>
            {t.schonStorniertNach}
            {k.storno_grund === null
              ? ''
              : ` ${t.grundIst} ${t.zitatAuf}${k.storno_grund}${t.zitatZu}.`}
            {k.ersetzt_durch === null
              ? ''
              : ` ${t.ersetztWurdeSieDurch} ${k.ersetzt_durch}.`}
          </p>
          {darf['finanzen.lesen'] === true && k.storniert_durch_id !== null ? (
            <p className="m-0 mt-s2">
              <Link
                href={`/portal/${mandant}/finanzen/rechnungen/${k.storniert_durch_id}`}
                className="text-sm underline underline-offset-2"
              >
                {t.zumStornobeleg}
              </Link>
            </p>
          ) : null}
        </Hinweis>
      ) : null}

      {istSelbstStorno ? (
        <Hinweis art="hinweis" cse="storno-ist-storno" className="mb-s5">
          <p className="m-0 max-w-prose">
            {t.istStornoVor}
            {k.storniert_beleg === null
              ? ''
              : ` ${t.hebtAufVor} ${k.storniert_beleg}${t.hebtAufNach}`}
            {t.istStornoNach}
          </p>
          {darf['finanzen.lesen'] === true && k.storniert_beleg_id !== null ? (
            <p className="m-0 mt-s2">
              <Link
                href={`/portal/${mandant}/finanzen/rechnungen/${k.storniert_beleg_id}`}
                className="text-sm underline underline-offset-2"
              >
                {t.zumAufgehobenenBeleg}
              </Link>
            </p>
          ) : null}
        </Hinweis>
      ) : null}

      {!festgeschrieben ? (
        <Hinweis art="hinweis" cse="storno-nicht-festgeschrieben" className="mb-s5">
          <p className="m-0 max-w-prose">
            {k.status === 'entwurf' ? t.istEntwurf : t.istVerworfen}
          </p>
          {k.status === 'entwurf' ? (
            <p className="m-0 mt-s2 text-sm">
              {darf['finanzen.entwurf_verwerfen'] === true ? (
                <Link
                  href={`/portal/${mandant}/finanzen/rechnungen/${id}/verwerfen`}
                  className="underline underline-offset-2"
                >
                  {t.zurVerwerfenSeite}
                </Link>
              ) : (
                <span className="text-text-muted">
                  {t.verworfenVonJemandemMit}{' '}
                  <Recht schluessel={RECHT_ENTWURF_VERWERFEN} sprache={zugang.sprache} />.
                </span>
              )}
            </p>
          ) : null}
        </Hinweis>
      ) : null}

      <h2 className="mb-s3 text-h2 text-text">{t.gegenrechnungTitel}</h2>
      {daten.positionen.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.keinePositionen}
        </p>
      ) : (
        <DataTable
          beschriftung={t.tabelleStorno}
          zeilen={daten.positionen}
          schluessel={(p) => p.id}
          spalten={[
            {
              schluessel: 'nr', kopf: t.nr, numerisch: true,
              zelle: (p) => p.position_nr,
            },
            { schluessel: 'bezeichnung', kopf: g.bezeichnung, zelle: (p) => p.bezeichnung },
            {
              schluessel: 'art', kopf: g.art,
              zelle: (p) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-sm text-text">
                    {t.positionsartNamen[
                      p.positionsart as keyof typeof t.positionsartNamen]
                      ?? p.positionsart}
                  </span>
                  {p.positionsart === 'leistung' ? null : (
                    <span className="text-xs text-warning">
                      {t.wirdNichtUebernommen}
                    </span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'menge', kopf: t.mengeImStorno, numerisch: true,
              zelle: (p) => (p.positionsart !== 'leistung' || p.menge === null
                ? '—'
                : `${formatiereMenge(milliMenge(-mengeAusPostgres(p.menge)))}${
                  p.einheit === null ? '' : ` ${p.einheit}`}`),
            },
            {
              schluessel: 'netto', kopf: t.nettoImStorno, numerisch: true,
              zelle: (p) => (p.positionsart !== 'leistung' || p.netto_cent === null
                ? '—'
                : formatiereGeld(negiere(cent(BigInt(p.netto_cent))))),
            },
          ]}
        />
      )}
      {daten.positionen.some((p) => p.positionsart !== 'leistung') ? (
        <p className="mt-s3 max-w-prose text-xs text-text-muted"
           data-cse="storno-nicht-gespiegelt">
          {t.nurVor} <strong>{t.leistungszeilen}</strong> {t.nichtGespiegeltNach}
        </p>
      ) : null}

      <dl
        data-cse="storno-summen"
        className="mb-s5 mt-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3"
      >
        <div>
          <dt className="text-xs text-text-muted">{t.nettoImStorno}</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(negiere(cent(BigInt(k.netto_gesamt_cent))))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.ustImStorno}</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(negiere(cent(BigInt(k.steuer_gesamt_cent))))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.bruttoImStorno}</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(negiere(cent(BigInt(k.brutto_cent))))}
          </dd>
        </div>
      </dl>

      {moeglich ? (
        <form
          method="post"
          action={`/api/rechnungen/storno?mandant=${mandant}`}
          className="max-w-prose rounded-lg border border-line-strong bg-surface p-s5"
          data-cse="storno-formular"
        >
          <input type="hidden" name="rechnungId" value={k.id} />
          <label className="block text-sm text-text" htmlFor="stornogrund">
            {t.grundMindestensVor} {STORNO_MINDESTLAENGE} {t.zeichenAuditfaehig}
          </label>
          <input
            id="stornogrund" name="grund" type="text" required
            minLength={STORNO_MINDESTLAENGE} className={feld}
          />
          <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
            {t.grundWirdIn} <code>{TABELLE_BEZIEHUNG}</code> {t.grundFestgehalten}
          </p>

          <label className="mt-s4 block text-sm text-text" htmlFor="form">{t.form}</label>
          <select id="form" name="form" defaultValue="nur_storno" className={feld}>
            <option value="nur_storno">{t.formNurStornoLang}</option>
            <option value="korrektur">
              {t.formKorrekturLang}
            </option>
          </select>
          <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
            {t.neuausstellungVor} <strong>{t.entwurf}</strong>{' '}
            {t.neuausstellungNach}
          </p>

          <button
            type="submit"
            className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
            data-cse="storno-knopf"
          >
            {t.stornieren}
          </button>
        </form>
      ) : null}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        {t.stornoFussVor} <Recht schluessel={RECHT_STORNIEREN} sprache={zugang.sprache} />.
      </p>
    </PortalRahmen>
  );
}
