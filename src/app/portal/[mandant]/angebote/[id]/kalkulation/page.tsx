import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { Button } from '@/components/ui/Button';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { Hinweis } from '@/components/ui/Hinweis';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KALKULATION_TEXTE } from '@/lib/i18n/verwaltung/kalkulation';

/**
 * `/portal/[mandant]/angebote/[id]/kalkulation` — der Rechenweg, und der
 * Ort, an dem aus geschaetzten Werten verantwortete werden (OPS-07).
 *
 * Diese Seite ist die Gegenseite der Sperre: `kern.angebot_versand_pruefen`
 * laesst kein Angebot hinaus, dessen Preis auf O-16 und O-17 ruht, und ohne
 * einen Weg, die Werte zu bestaetigen, waere das eine Sackgasse.
 *
 * Sie zeigt zuerst, WORAUF der Preis beruht — Flaeche, Leistungswert,
 * Stunden, Stundensatz, je Zeile — und erst dann das Formular. Wer Zahlen
 * bestaetigt, ohne den Rechenweg gesehen zu haben, bestaetigt eine
 * Ueberschrift.
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly id: string;
  readonly titel: string;
  readonly status: string;
  readonly kalkulation_id: string | null;
  readonly kalkulation_status: string | null;
  readonly ist_platzhalter: boolean | null;
  readonly satz_cent: string | null;
  readonly gemeinkosten_basis: string | null;
  readonly gemeinkosten_bp: number | null;
  readonly wagnis_gewinn_bp: number | null;
  readonly bemerkung: string | null;
  readonly versendet: boolean;
  /** V-174: nach der Preisfreigabe ändert keine Kostenzeile mehr den Preis (O-732). */
  readonly freigegeben: boolean;
  readonly leistungswert_offen: boolean;
  readonly frequenz_offen: boolean;
  /* Die fünf Blöcke — materialisiert von `kern.aktualisiere_kalkulation_summen`. */
  readonly summe_lohn: string;
  readonly summe_material: string;
  readonly summe_geraet: string;
  readonly summe_gemeinkosten: string;
  readonly summe_wagnis_gewinn: string;
  readonly summe_netto: string;
}

/** Eine Material- oder Gerätezeile (V-174). */
interface Kostenzeile {
  readonly id: string;
  readonly kostenart: string;
  readonly bezeichnung: string;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelbetrag_cent: string | null;
  readonly betrag_cent: string;
}

interface Zeile {
  readonly id: string;
  readonly position_nr: number;
  readonly bezeichnung: string;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelbetrag_cent: string | null;
  readonly betrag_cent: string;
  readonly leistungswert: string | null;
  readonly berechnungsweg: string;
}

/** Basispunkte als deutsche Prozentanzeige: `1550` → `15,5`. */
function alsProzent(bp: number | null): string {
  if (bp === null) return '';
  const ganz = Math.trunc(bp / 100);
  const rest = bp % 100;
  return rest === 0 ? String(ganz) : `${String(ganz)},${String(rest).padStart(2, '0')}`;
}

export default async function KalkulationSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  /*
   * Die Abweisung der Bestätigung kommt als Schlüssel und Feld zurück (V-172,
   * D-599) — nicht mehr als weisse JSON-Seite.
   */
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const fehlerFeld = typeof suche['feld'] === 'string' ? suche['feld'] : null;
  const kostenpositionGespeichert = suche['kostenposition'] === '1';
  const pfad = `/portal/${mandant}/angebote/${id}/kalkulation`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'angebot.lesen');
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select a.id, a.titel, a.status::text as status,
                k.id as kalkulation_id, k.status::text as kalkulation_status,
                k.ist_platzhalter, k.stundenverrechnungssatz_cent::text as satz_cent,
                k.gemeinkosten_basis::text as gemeinkosten_basis,
                k.gemeinkosten_bp, k.wagnis_gewinn_bp, k.bemerkung,
                (a.versendet_am is not null) as versendet,
                (a.freigegeben_am is not null) as freigegeben,
                coalesce(k.summe_lohn_cent, 0)::text as summe_lohn,
                coalesce(k.summe_material_cent, 0)::text as summe_material,
                coalesce(k.summe_geraet_cent, 0)::text as summe_geraet,
                coalesce(k.summe_gemeinkosten_cent, 0)::text as summe_gemeinkosten,
                coalesce(k.summe_wagnis_gewinn_cent, 0)::text as summe_wagnis_gewinn,
                coalesce(k.angebotssumme_netto_cent, 0)::text as summe_netto,
                exists (select 1 from kalkulation_position p
                         where p.kalkulation_id = k.id
                           and p.leistungswert_ist_platzhalter)
                  as leistungswert_offen,
                coalesce(k.frequenz_ist_platzhalter, false) as frequenz_offen
           from angebot a
           join kunde ku on ku.id = a.kunde_id
           left join kalkulation k on k.angebot_id = a.id
          where a.id = $1`, [id]);
      if (kopf === undefined) return null;
      /*
       * Der Rechenweg zeigt die LOHNZEILEN — Fläche, Leistungswert, Stunden.
       * Zuschläge, Material und Gerät stehen in eigenen Blöcken darunter
       * (V-174): in einer Spalte „Belagsart" war eine Gemeinkostenzeile ein
       * Belag, und eine Materialzeile hätte es auch sein müssen.
       */
      const zeilen = kopf.kalkulation_id === null ? [] : await kontext.abfrage<Zeile>(
        `select id, position_nr, bezeichnung, menge::text, einheit,
                einzelbetrag_cent::text, betrag_cent::text,
                leistungswert_qm_pro_stunde::text as leistungswert, berechnungsweg
           from kalkulation_position
          where kalkulation_id = $1 and kostenart = 'lohn'
          order by position_nr`, [kopf.kalkulation_id]);
      const kostenzeilen = kopf.kalkulation_id === null ? [] : await kontext.abfrage<Kostenzeile>(
        `select id, kostenart::text as kostenart, bezeichnung, menge::text as menge, einheit,
                einzelbetrag_cent::text as einzelbetrag_cent, betrag_cent::text as betrag_cent
           from kalkulation_position
          where kalkulation_id = $1 and kostenart in ('material', 'geraet')
          order by position_nr`, [kopf.kalkulation_id]);
      return { kopf, zeilen, kostenzeilen };
    })) as Promise<{
      kopf: Kopf; zeilen: readonly Zeile[]; kostenzeilen: readonly Kostenzeile[];
    } | null>);

  if (daten === null) notFound();
  const { kopf, zeilen, kostenzeilen } = daten;
  const offen = kopf.ist_platzhalter === true || kopf.leistungswert_offen
    || kopf.frequenz_offen;
  const eingefroren = kopf.kalkulation_status === 'festgeschrieben' || kopf.versendet;
  const tk = nachSprache(KALKULATION_TEXTE, zugang.sprache);
  const feldName = fehlerFeld === null ? undefined : tk.feld[fehlerFeld];
  /* Material und Gerät sind änderbar, solange weder festgeschrieben noch freigegeben. */
  const kostenOffen = !eingefroren && !kopf.freigegeben;
  const basisVorgabe = kopf.gemeinkosten_basis === 'selbstkosten' ? 'selbstkosten' : 'lohn';
  const geld = (text: string | null): string =>
    (text === null ? '—' : formatiereGeld(cent(BigInt(text))));
  const mengeText = (text: string | null): string =>
    (text === null ? '' : formatiereMenge(mengeAusPostgresOderNull(text)));
  const eurText = (text: string | null): string =>
    (text === null ? '' : formatiereGeld(cent(BigInt(text))).replace(/\s*€$/u, ''));
  const kostenFeld = 'mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface px-s3 '
    + 'text-text';

  return (
    <PortalRahmen
      titel={`Kalkulation — ${kopf.titel}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={eingefroren}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="angebote"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['angebot.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/angebote/${id}`, text: 'Zum Angebot' } }
        : {})}
    >
      {/*
        * Das Angebot dahinter öffnet mit `angebot.lesen` (Manifest); diese
        * Seite mit `kalkulation.lesen`. Zwei Rechte, je Mandant getrennt
        * entziehbar — ohne das erste führte „Zum Angebot" auf 404 und verriet
        * damit, was es nicht zeigen darf (AUT-06, D-581).
        */}
      <h1 className="mb-s4 text-h1 text-text">Kalkulation</h1>

      {kostenpositionGespeichert && fehler === null ? (
        <Hinweis art="erfolg" cse="kostenposition-gespeichert" className="mb-s5 max-w-prose">
          {tk.gespeichert}
        </Hinweis>
      ) : null}

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="kalkulation-fehler" className="mb-s5 max-w-prose">
          <strong className="block">{tk.nichtBestaetigt}</strong>
          {tk.fehler[fehler] ?? tk.fehler['unvollstaendig']}
          {feldName === undefined ? null : <> {tk.imFeld(feldName)}</>}
        </Hinweis>
      )}

      {kopf.kalkulation_id === null ? (
        <p data-cse="keine-kalkulation" className="max-w-[72ch] text-base text-text-muted">
          Zu diesem Angebot gibt es keine Kalkulation. Angebote, die aus einem
          Raumbuch entstehen, bringen eine mit; ein von Hand angelegtes Angebot
          trägt seinen Preis dagegen selbst.
        </p>
      ) : (
        <>
          <section aria-labelledby="rechenweg" className="mb-s7">
            <h2 id="rechenweg" className="text-h2 text-text">Der Rechenweg</h2>
            <DataTable
              beschriftung="Positionen dieser Kalkulation"
              zeilen={zeilen}
              schluessel={(z) => z.id}
              spalten={[
                {
                  schluessel: 'nr', kopf: 'Pos.', numerisch: true,
                  zelle: (z) => String(z.position_nr),
                },
                { schluessel: 'was', kopf: 'Belagsart', zelle: (z) => z.bezeichnung },
                {
                  schluessel: 'lw', kopf: 'Leistungswert', numerisch: true,
                  zelle: (z) => (z.leistungswert === null ? '—' : `${z.leistungswert} m²/h`),
                },
                {
                  schluessel: 'menge', kopf: 'Stunden', numerisch: true,
                  zelle: (z) => `${z.menge ?? '—'} ${z.einheit ?? ''}`,
                },
                {
                  schluessel: 'satz', kopf: 'Stundensatz', numerisch: true,
                  zelle: (z) => (z.einzelbetrag_cent === null
                    ? '—' : formatiereGeld(cent(BigInt(z.einzelbetrag_cent)))),
                },
                {
                  schluessel: 'betrag', kopf: 'Lohnkosten', numerisch: true,
                  zelle: (z) => formatiereGeld(cent(BigInt(z.betrag_cent))),
                },
              ]}
            />
          </section>

          {/*
            * V-174 (OPS-07): die fünf Blöcke — Lohn, Material, Gerät,
            * Gemeinkosten, Wagnis/Gewinn. Die Summen hält die Datenbank
            * (`kern.aktualisiere_kalkulation_summen`); diese Seite rechnet nichts.
            */}
          <section aria-labelledby="zusammensetzung" className="mb-s7 max-w-prose">
            <h2 id="zusammensetzung" className="text-h2 text-text">{tk.zusammensetzung}</h2>
            <p className="mb-s4 text-sm text-text-muted">{tk.zusammensetzungErklaerung}</p>
            <dl data-cse="kalkulation-bloecke"
                className="m-0 grid grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2">
              {([
                ['lohn', kopf.summe_lohn], ['material', kopf.summe_material],
                ['geraet', kopf.summe_geraet], ['gemeinkosten', kopf.summe_gemeinkosten],
                ['wagnisGewinn', kopf.summe_wagnis_gewinn], ['netto', kopf.summe_netto],
              ] as const).map(([block, betrag]) => (
                <div key={block} data-cse={`block-${block}`}>
                  <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                    {tk.block[block]}
                  </dt>
                  <dd className="m-0 mt-s1 text-sm tabular-nums text-text">{geld(betrag)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-s3 text-xs text-text-muted" data-cse="kalkulation-basis">
              {tk.basisSatz[kopf.gemeinkosten_basis ?? 'lohn'] ?? tk.basisSatz['lohn']}
            </p>
          </section>

          <section aria-labelledby="material" className="mb-s7 max-w-prose"
                   data-cse="kalkulation-material">
            <h2 id="material" className="text-h2 text-text">{tk.materialTitel}</h2>
            <p className="mb-s4 text-sm text-text-muted">{tk.materialErklaerung}</p>
            {kostenzeilen.length === 0 ? (
              <p className="mb-s4 text-sm text-text-muted" data-cse="material-leer">
                {tk.materialLeer}
              </p>
            ) : (
              <ul className="m-0 mb-s4 flex list-none flex-col gap-s3 p-0" data-cse="material-zeilen">
                {kostenzeilen.map((z) => (
                  <li key={z.id} data-cse="material-zeile"
                      className="rounded-lg border border-line bg-surface p-s4 text-sm text-text">
                    <div className="flex flex-wrap items-baseline justify-between gap-s3">
                      <span>
                        <span className="text-text-subtle">{tk.kostenart[z.kostenart] ?? ''}</span>
                        {' · '}{z.bezeichnung}
                      </span>
                      <span className="tabular-nums">
                        {`${mengeText(z.menge)} ${z.einheit ?? ''} × ${geld(z.einzelbetrag_cent)} `}
                        {'= '}<strong>{geld(z.betrag_cent)}</strong>
                      </span>
                    </div>
                    {kostenOffen ? (
                      <details className="mt-s3">
                        <summary className="cursor-pointer text-sm text-text-muted">
                          {tk.zeileBerichtigen}
                        </summary>
                        <form method="post" action="/api/kalkulation" className="mt-s3 grid grid-cols-1 gap-s3 sm:grid-cols-2">
                          <input type="hidden" name="aktion" value="kostenposition" />
                          <input type="hidden" name="angebotId" value={id} />
                          <input type="hidden" name="positionId" value={z.id} />
                          <label className="block text-sm text-text">
                            {tk.spalte.kostenart}
                            <select name="kostenart" defaultValue={z.kostenart} className={kostenFeld}>
                              <option value="material">{tk.kostenart['material']}</option>
                              <option value="geraet">{tk.kostenart['geraet']}</option>
                            </select>
                          </label>
                          <label className="block text-sm text-text">
                            {tk.spalte.bezeichnung}
                            <input name="bezeichnung" required defaultValue={z.bezeichnung}
                                   maxLength={200} className={kostenFeld} />
                          </label>
                          <label className="block text-sm text-text">
                            {tk.spalte.menge}
                            <input name="menge" required inputMode="decimal"
                                   defaultValue={mengeText(z.menge)} className={kostenFeld} />
                          </label>
                          <label className="block text-sm text-text">
                            {tk.spalte.einheit}
                            <input name="einheit" required maxLength={20}
                                   defaultValue={z.einheit ?? ''} className={kostenFeld} />
                          </label>
                          <label className="block text-sm text-text">
                            {tk.spalte.einzelpreis}
                            <input name="einzelpreis" required inputMode="decimal"
                                   defaultValue={eurText(z.einzelbetrag_cent)}
                                   className={kostenFeld} />
                          </label>
                          <div className="flex items-end">
                            <Button type="submit" variante="secondary">{tk.speichern}</Button>
                          </div>
                        </form>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {kostenOffen ? (
              <form method="post" action="/api/kalkulation" data-cse="material-hinzufuegen"
                    className="grid grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2">
                <input type="hidden" name="aktion" value="kostenposition" />
                <input type="hidden" name="angebotId" value={id} />
                <h3 className="m-0 text-h3 text-text sm:col-span-2">{tk.zeileHinzufuegen}</h3>
                <label className="block text-sm text-text">
                  {tk.spalte.kostenart}
                  <select name="kostenart" defaultValue="material" className={kostenFeld}
                          data-cse="material-art">
                    <option value="material">{tk.kostenart['material']}</option>
                    <option value="geraet">{tk.kostenart['geraet']}</option>
                  </select>
                </label>
                <label className="block text-sm text-text">
                  {tk.spalte.bezeichnung}
                  <input name="bezeichnung" required maxLength={200} className={kostenFeld}
                         data-cse="material-bezeichnung" />
                </label>
                <label className="block text-sm text-text">
                  {tk.spalte.menge}
                  <input name="menge" required inputMode="decimal" className={kostenFeld}
                         data-cse="material-menge" />
                </label>
                <label className="block text-sm text-text">
                  {tk.spalte.einheit}
                  <input name="einheit" required maxLength={20} className={kostenFeld}
                         data-cse="material-einheit" />
                </label>
                <label className="block text-sm text-text">
                  {tk.spalte.einzelpreis}
                  <input name="einzelpreis" required inputMode="decimal" className={kostenFeld}
                         data-cse="material-einzelpreis" />
                </label>
                <div className="flex items-end">
                  <Button type="submit" variante="primary" data-cse="material-speichern">
                    {tk.speichern}
                  </Button>
                </div>
                <p className="m-0 text-xs text-text-muted sm:col-span-2">{tk.mengeNullHinweis}</p>
              </form>
            ) : kopf.freigegeben && !eingefroren ? (
              <p className="text-sm text-text-muted" data-cse="material-freigegeben">
                {tk.gesperrtFreigegeben}
              </p>
            ) : null}
          </section>

          {offen ? (
            <p
              data-cse="kalkulation-offen"
              className="mb-s5 rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
            >
              <strong>Dieser Preis ruht auf unbestätigten Werten.</strong>{' '}
              {kopf.bemerkung ?? 'Stundenverrechnungssatz und Zuschläge (O-16)'}
              {kopf.leistungswert_offen
                ? ' — dazu der Reinigungsrichtwert je Belagsart (O-17).'
                : '.'}{' '}
              Solange das so ist, lässt sich das Angebot nicht versenden.
            </p>
          ) : (
            <p
              data-cse="kalkulation-bestaetigt"
              className="mb-s5 rounded-md border border-line bg-surface-2 p-s4 text-sm text-text"
            >
              Die Werte dieser Kalkulation sind bestätigt. Das Angebot kann versendet werden.
            </p>
          )}

          {eingefroren ? (
            <p data-cse="kalkulation-eingefroren" className="text-sm text-text-muted">
              Das Angebot ist versendet; die Kalkulation ist damit eingefroren und
              wird nicht mehr geändert. Ein anderer Preis braucht ein neues Angebot.
            </p>
          ) : (
            <form
              method="post"
              action="/api/kalkulation"
              data-cse="kalkulation-form"
              className="max-w-[52ch]"
            >
              <h2 className="text-h2 text-text">Werte bestätigen</h2>
              <p className="mb-s4 text-sm text-text-muted">
                Was hier eingetragen wird, gilt für <strong>dieses</strong> Angebot.
                Ein gruppenweiter Tarif ist noch nicht festgelegt (O-16) — bis er
                es ist, entscheidet die Leitung je Angebot, und die Kalkulation
                hält fest, wer wann was bestätigt hat.
              </p>
              <input type="hidden" name="angebotId" value={id} />

              <label className="mb-s4 block text-sm text-text">
                Stundenverrechnungssatz (€)
                <input
                  name="stundensatz"
                  data-cse="feld-stundensatz"
                  required
                  defaultValue={kopf.satz_cent === null
                    ? '' : formatiereGeld(cent(BigInt(kopf.satz_cent))).replace(' €', '')}
                  className="mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface px-s3 text-text"
                />
              </label>

              <label className="mb-s4 block text-sm text-text">
                Gemeinkosten rechnen auf
                <select
                  name="gemeinkostenBasis"
                  data-cse="feld-basis"
                  required
                  defaultValue={basisVorgabe}
                  className="mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface px-s3 text-text"
                >
                  <option value="lohn">{tk.basisOption.lohn}</option>
                  <option value="selbstkosten">{tk.basisOption.selbstkosten}</option>
                  {/*
                    * V-174: `je_kostenart` wurde gespeichert und auf den Lohn gerechnet.
                    * Sie braucht Sätze je Kostenart (O-16) und ist deshalb sichtbar,
                    * aber nicht wählbar — der Dienst weist sie ebenso ab.
                    */}
                  <option value="je_kostenart" disabled>{tk.basisOption.je_kostenart}</option>
                </select>
              </label>

              <label className="mb-s4 block text-sm text-text">
                Gemeinkostenzuschlag (%)
                <input
                  name="gemeinkosten"
                  data-cse="feld-gemeinkosten"
                  required
                  defaultValue={alsProzent(kopf.gemeinkosten_bp)}
                  className="mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface px-s3 text-text"
                />
              </label>

              <label className="mb-s4 block text-sm text-text">
                Wagnis und Gewinn (%)
                <input
                  name="wagnisGewinn"
                  data-cse="feld-wagnis"
                  required
                  defaultValue={alsProzent(kopf.wagnis_gewinn_bp)}
                  className="mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface px-s3 text-text"
                />
              </label>

              {kopf.frequenz_offen ? (
                <label className="mb-s4 block text-sm text-text">
                  Frequenzfaktor je Abrechnungsperiode (O-56)
                  <input
                    name="frequenzFaktor"
                    data-cse="feld-frequenz"
                    required
                    placeholder="z. B. 4,3333 für wöchentlich bei monatlicher Abrechnung"
                    className="mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface px-s3 text-text"
                  />
                  <span className="mt-s1 block text-xs text-text-muted">
                    Wie oft der Turnus in einer Abrechnungsperiode vorkommt. Bisher
                    geschätzt — ohne Ihre Zahl bleibt das Angebot gesperrt.
                  </span>
                </label>
              ) : null}

              {kopf.leistungswert_offen ? (
                <label className="mb-s4 flex items-start gap-s3 text-sm text-text">
                  <input
                    type="checkbox"
                    name="leistungswerte"
                    value="ja"
                    data-cse="feld-leistungswerte"
                    className="mt-1 min-h-5 min-w-5"
                  />
                  <span>
                    Auch die Reinigungsrichtwerte der hier benutzten Belagsarten
                    bestätigen (O-17) — <strong>für dieses Angebot</strong>. Der
                    gemeinsame Katalog bleibt unberührt: andere Kalkulationen auf
                    denselben Belagsarten bleiben gesperrt, bis sie jemand einzeln
                    ansieht.
                  </span>
                </label>
              ) : null}

              <button
                type="submit"
                data-cse="kalkulation-bestaetigen"
                className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
              >
                Werte bestätigen
              </button>
            </form>
          )}
        </>
      )}
    </PortalRahmen>
  );
}
