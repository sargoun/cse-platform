import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
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
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { ZAHLUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/zahlungen';

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

/** Eine Rechnung mit noch nicht gebuchtem § 48-EStG-Einbehalt (V-090). */
interface EinbehaltZeile {
  readonly id: string;
  readonly nummer: string | null;
  readonly einbehalt_cent: string;
  readonly kunde_name: string | null;
}

interface ZahlungZeile {
  readonly id: string;
  readonly zahlungsdatum: string;
  readonly betrag_cent: string;
  readonly zahlungsmittel: string;
  readonly referenz: string | null;
  readonly storniert_am: string | null;
  readonly verteilt_cent: string;
}

export default async function Zahlungen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const hinweis = typeof suche['hinweis'] === 'string' ? suche['hinweis'] : null;
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

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(ZAHLUNGEN_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      posten: await offenePosten(kontext, { nurOffene: true }),
      konten: await bankkonten(kontext),
      /*
       * **Die Rechnungen mit offenem § 48-Einbehalt** (V-090). Sie stehen
       * NICHT in `offenePosten`: der Posten kennt nur seinen Restbetrag, nicht
       * dessen Herkunft. Was hier fehlt, ist die Frage, ob der Einbehalt schon
       * gebucht wurde — `zz_bauabzug_je_posten` (0130) laesst genau einen zu,
       * und ein Knopf, der zuverlaessig „schon gebucht" antwortet, ist ein
       * Knopf, den niemand mehr liest.
       */
      einbehalte: await kontext.abfrage<EinbehaltZeile>(
        `select r.id, r.nummer,
                r.einbehalt_bauabzugsteuer_cent::text as einbehalt_cent,
                k.name as kunde_name
           from rechnung r
           join offener_posten op
             on op.rechnung_id = r.id and op.mandant_id = r.mandant_id
           left join kunde k on k.id = op.kunde_id and k.mandant_id = op.mandant_id
          where r.mandant_id = app.aktiver_mandant()
            and r.einbehalt_bauabzugsteuer_cent > 0
            and op.ausgeglichen_am is null
            and not exists (select 1 from zahlung_zuordnung zz
                             where zz.offener_posten_id = op.id
                               and zz.art = 'bauabzugsteuer_einbehalt')
          order by r.nummer`),
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
      einbehalte: readonly EinbehaltZeile[];
      zahlungen: readonly ZahlungZeile[];
    }>);

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const forderungen = daten.posten.filter((p) => p.art === 'debitor');
  const guthaben = daten.posten.filter((p) => p.art === 'debitor_guthaben');
  const summeOffen = forderungen.reduce((s, p) => s + p.offenCent, 0n);

  return (
    <PortalRahmen
      titel={t.titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zahlungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-center justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.titel}</h1>
        {/*
          * **Der Weg zu den Bankkonten** (V-007). `legeBankkontoAn` gibt es
          * seit `0121` und rief niemand: „Eingegangen auf" unten kannte nur,
          * was der Seed angelegt hatte.
          */}
        <Link
          href={`/portal/${mandant}/finanzen/bankkonten`}
          data-cse="zu-den-bankkonten"
          className="inline-flex min-h-11 items-center rounded-md border border-line
                     px-s3 text-sm text-text-muted transition-colors duration-fast
                     hover:border-line-strong hover:text-text"
        >
          {t.zuDenBankkonten}
        </Link>
      </div>

      {hinweis === null ? null : (
        <Hinweis
          art={hinweis === 'bauabzug' || hinweis === 'ausgeglichen' ? 'erfolg' : 'hinweis'}
          cse="zahlung-hinweis"
          className="mb-s5 max-w-prose"
        >
          {hinweis === 'bauabzug' ? t.bauabzugGebucht
            : hinweis === 'ausgeglichen' ? t.ausgeglichen
            : hinweis}
        </Hinweis>
      )}

      <section aria-labelledby="forderungen-titel" className="mb-s7">
        <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 id="forderungen-titel" className="text-h2 text-text">{t.offeneForderungen}</h2>
          <p className="text-sm text-text-muted">
            {t.summeOffen}{' '}
            <strong className="text-text">{formatiereGeld(cent(summeOffen))}</strong>
          </p>
        </div>

        {forderungen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.keineForderung}
          </p>
        ) : (
          <DataTable
            beschriftung={t.tabelleForderungen}
            zeilen={forderungen}
            schluessel={(p) => p.id}
            spalten={[
              {
                schluessel: 'nummer',
                kopf: t.rechnung,
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
              { schluessel: 'kunde', kopf: g.kunde, zelle: (p) => p.kundeName ?? '—' },
              {
                schluessel: 'betrag', kopf: g.betrag, numerisch: true,
                zelle: (p) => formatiereGeld(p.betragCent),
              },
              {
                schluessel: 'bezahlt', kopf: t.bezahlt, numerisch: true,
                zelle: (p) => formatiereGeld(p.bezahltCent),
              },
              {
                schluessel: 'offen', kopf: t.offen, numerisch: true,
                zelle: (p) => <strong>{formatiereGeld(p.offenCent)}</strong>,
              },
              {
                schluessel: 'faellig',
                kopf: g.faellig,
                zelle: (p) => (
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    {p.faelligAm}
                    {p.ueberfaelligTage > 0 ? (
                      <StatusPill zustand="Überfällig" sprache={zugang.sprache} />
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>

      {/*
        * **Der Einbehalt nach § 48 EStG** (V-090). `bucheBauabzug` gibt es
        * seit `0130`, mit Sperre gegen die Doppelbuchung — und hatte weder
        * Route noch Knopf. Ohne ihn bleibt auf jeder Rechnung eines
        * bauabzugspflichtigen Kunden genau dieser Betrag offen: 15 % der
        * Summe, dauerhaft, in jeder Altersliste und in jedem Mahnlauf. Der
        * Kunde hat ihn ans Finanzamt abgeführt und schuldet ihn nicht mehr.
        */}
      {daten.einbehalte.length === 0 ? null : (
        <section aria-labelledby="bauabzug-titel" className="mb-s7">
          <h2 id="bauabzug-titel" className="mb-s3 text-h2 text-text">
            {t.bauabzugTitel}
          </h2>
          <p className="mb-s3 max-w-prose text-sm text-text-muted">
            {t.bauabzugErklaerung}
          </p>
          <ul className="m-0 list-none p-0" data-cse="bauabzug-liste">
            {daten.einbehalte.map((e) => (
              <li key={e.id} data-cse="bauabzug-zeile" data-rechnung={e.id}
                  className="mb-s3 flex flex-wrap items-center justify-between gap-s3
                             rounded-lg border border-line bg-surface p-s4">
                <span className="text-sm text-text">
                  {e.nummer ?? '—'}
                  <span className="block text-xs text-text-muted">
                    {e.kunde_name ?? '—'}
                  </span>
                </span>
                <span className="text-sm tabular-nums text-text">
                  {t.einbehalt}{': '}
                  <strong>{formatiereGeld(cent(BigInt(e.einbehalt_cent)))}</strong>
                </span>
                <form method="post" action={`/api/finanzen/zahlungen?mandant=${mandant}`}>
                  <input type="hidden" name="aktion" value="bauabzug" />
                  <input type="hidden" name="rechnungId" value={e.id} />
                  {/*
                    * `secondary` und nicht `primary`: der rote Knopf steht
                    * einmal je Seite, und auf dieser gehoert er dem Erfassen
                    * eines Zahlungseingangs (DESIGN §6).
                    */}
                  <Button type="submit" variante="secondary" data-cse="bauabzug-buchen">
                    {t.bauabzugBuchen}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        * **Posten gegen Posten** (V-091, §7.4). `gleicheAus` gibt es seit
        * `0121` und war nicht auslösbar. Der Fall: ein Kunde hat überzahlt
        * oder eine Rechnung wurde storniert, und das Guthaben soll die
        * nächste Forderung decken — ohne dass eine Zahlung erfunden wird,
        * die nie geflossen ist.
        */}
      {forderungen.length === 0 || guthaben.length === 0 ? null : (
        <section aria-labelledby="ausgleich-titel" className="mb-s7">
          <h2 id="ausgleich-titel" className="mb-s3 text-h2 text-text">
            {t.ausgleichTitel}
          </h2>
          <p className="mb-s3 max-w-prose text-sm text-text-muted">
            {t.ausgleichErklaerung}
          </p>
          <form
            method="post"
            action={`/api/finanzen/zahlungen?mandant=${mandant}`}
            data-cse="ausgleich-formular"
            className="flex max-w-[56ch] flex-col gap-s4"
          >
            <input type="hidden" name="aktion" value="ausgleichen" />
            <label className="text-sm text-text">
              {t.ausgleichForderung}
              <select name="sollPostenId" required className={feld}
                      defaultValue="" data-cse="ausgleich-soll">
                <option value="" disabled>{t.ausgleichForderung}</option>
                {forderungen.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.rechnungsnummer ?? '—'} · ${p.kundeName ?? '—'} · `
                     + formatiereGeld(p.offenCent)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-text">
              {t.ausgleichGuthaben}
              <select name="habenPostenId" required className={feld}
                      defaultValue="" data-cse="ausgleich-haben">
                <option value="" disabled>{t.ausgleichGuthaben}</option>
                {guthaben.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.kundeName ?? '—'} · ${formatiereGeld(p.offenCent)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-text">
              {t.ausgleichBetrag}
              <input type="text" name="ausgleichBetrag" required inputMode="decimal"
                     className={feld} data-cse="ausgleich-betrag" />
            </label>
            <label className="text-sm text-text">
              {t.ausgleichGrund}
              <input type="text" name="grund" required minLength={5} maxLength={500}
                     className={feld} placeholder={t.ausgleichGrundBeispiel}
                     data-cse="ausgleich-grund" />
            </label>
            <div>
              <Button type="submit" variante="secondary" data-cse="ausgleich-buchen">
                {t.ausgleichBuchen}
              </Button>
            </div>
          </form>
        </section>
      )}

      {guthaben.length === 0 ? null : (
        <section aria-labelledby="guthaben-titel" className="mb-s7">
          <h2 id="guthaben-titel" className="mb-s3 text-h2 text-text">{t.guthabenTitel}</h2>
          <p className="mb-s3 max-w-prose text-sm text-text-muted">
            {t.guthabenErklaerung}
          </p>
          <DataTable
            beschriftung={t.tabelleGuthaben}
            zeilen={guthaben}
            schluessel={(p) => p.id}
            spalten={[
              { schluessel: 'kunde', kopf: g.kunde, zelle: (p) => p.kundeName ?? '—' },
              {
                schluessel: 'offen', kopf: t.offen, numerisch: true,
                zelle: (p) => formatiereGeld(p.offenCent),
              },
              { schluessel: 'seit', kopf: t.seit, zelle: (p) => p.faelligAm },
            ]}
          />
        </section>
      )}

      <section aria-labelledby="erfassen-titel" className="mb-s7">
        <h2 id="erfassen-titel" className="mb-s3 text-h2 text-text">{t.erfassenTitel}</h2>

        {forderungen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.keineForderungZumBuchen}
          </p>
        ) : (
          <form
            method="post"
            action={`/api/finanzen/zahlungen?mandant=${mandant}`}
            className="max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <label className="block text-sm text-text" htmlFor="rechnungId">{t.rechnung}</label>
            <select id="rechnungId" name="rechnungId" required className={feld}>
              {forderungen.map((p) => (
                <option key={p.id} value={p.rechnungId ?? ''}>
                  {p.rechnungsnummer ?? '—'} · {p.kundeName ?? '—'} · {t.offen}{' '}
                  {formatiereGeld(p.offenCent)}
                </option>
              ))}
            </select>

            <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <label className="block text-sm text-text" htmlFor="betrag">
                  {t.betragInEuro}
                </label>
                <input
                  id="betrag" name="betrag" type="text" inputMode="decimal" required
                  placeholder="1190,00" className={feld}
                />
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="zahlungsdatum">
                  {t.buchungstag}
                </label>
                <input
                  id="zahlungsdatum" name="zahlungsdatum" type="date" required className={feld}
                />
              </div>
            </div>

            <label className="mt-s4 block text-sm text-text" htmlFor="zahlungsmittel">
              {t.zahlungsmittel}
            </label>
            <select id="zahlungsmittel" name="zahlungsmittel" required className={feld}>
              <option value="ueberweisung">{t.mittelNamen.ueberweisung}</option>
              <option value="lastschrift">{t.mittelNamen.lastschrift}</option>
              <option value="karte">{t.mittelNamen.karte}</option>
              <option value="verrechnung">{t.mittelNamen.verrechnung}</option>
            </select>
            {/*
              * `bar` fehlt mit Absicht: eine Barzahlung verlangt eine Kasse
              * (§7.1), und ohne Kassenbuch (PR 54.3) gäbe es zu ihr keinen
              * Beleg. Ein Auswahlwert, der beim Speichern scheitert, ist
              * schlechter als keiner.
              */}

            <label className="mt-s4 block text-sm text-text" htmlFor="bankkontoId">
              {t.eingegangenAuf}
            </label>
            <select id="bankkontoId" name="bankkontoId" className={feld}>
              <option value="">{t.ohneKontobezug}</option>
              {daten.konten.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.bezeichnung} · {formatiereIban(k.iban)}
                </option>
              ))}
            </select>

            <label className="mt-s4 block text-sm text-text" htmlFor="referenz">
              {t.verwendungszweck}
            </label>
            <input id="referenz" name="referenz" type="text" className={feld} />

            <p className="mt-s4 max-w-prose text-xs text-text-muted">
              {t.ueberzahlungHinweis}
            </p>

            <button
              type="submit"
              className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
            >
              {t.zahlungErfassen}
            </button>
          </form>
        )}
      </section>

      <section aria-labelledby="eingang-titel">
        <h2 id="eingang-titel" className="mb-s3 text-h2 text-text">{t.eingaengeTitel}</h2>
        {daten.zahlungen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.keineZahlung}
          </p>
        ) : (
          <DataTable
            beschriftung={t.tabelleEingaenge}
            zeilen={daten.zahlungen}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'datum',
                kopf: g.datum,
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
                schluessel: 'betrag', kopf: g.betrag, numerisch: true,
                zelle: (z) => formatiereGeld(cent(BigInt(z.betrag_cent))),
              },
              {
                schluessel: 'mittel', kopf: t.mittel,
                zelle: (z) => t.mittelNamen[z.zahlungsmittel as keyof typeof t.mittelNamen]
                  ?? z.zahlungsmittel,
              },
              {
                schluessel: 'referenz', kopf: t.referenz,
                zelle: (z) => z.referenz ?? <span className="text-text-subtle">—</span>,
              },
              {
                schluessel: 'zustand',
                kopf: g.zustand,
                zelle: (z) => {
                  if (z.storniert_am !== null) {
                    return <StatusPill zustand="Archiviert" sprache={zugang.sprache} />;
                  }
                  const rest = BigInt(z.betrag_cent) - BigInt(z.verteilt_cent);
                  return rest === 0n
                    ? <StatusPill zustand="Abgeschlossen" sprache={zugang.sprache} />
                    : (
                      <span className="text-sm text-warning">
                        {formatiereGeld(cent(rest))} {t.nichtZugeordnet}
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
