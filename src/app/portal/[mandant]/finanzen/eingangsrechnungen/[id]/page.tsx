import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld, formatiereGeldIn, type Cent } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { EINGANGSRECHNUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/eingangsrechnungen';
import { ZAHLUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/zahlungen';
import { MAHNUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/mahnungen';
import { Hinweis } from '@/components/ui/Hinweis';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { vorbelegt } from '@/lib/formular/maske';
import { tagInSprache } from '@/lib/datum/kalendertag';
import {
  bankkonten, buchungenZuPosten, postenZuEingangsrechnung,
  type Bankkonto, type Buchungszeile, type Kreditorposten,
} from '@/server/services/finanz/zahlung/index';
import { formatiereIban } from '@/server/services/finanz/zahlung/iban';

/**
 * `/portal/[mandant]/finanzen/eingangsrechnungen/[id]` — der Beleg und sein
 * Weg (FIN-14, ACC-05, APR-01).
 *
 * **Die Seite zeigt genau die Handlung, die als NÄCHSTES möglich ist.** Die
 * Übergangstabelle steht in der Datenbank (0123); hier stünde sonst eine
 * zweite Fassung davon, und zwei Fassungen gehen beim ersten Widerspruch
 * auseinander. Was nicht erlaubt ist, wird deshalb nicht angeboten — und
 * wenn die Datenbank es doch abweist, sagt sie warum.
 *
 * **Freigeben und Buchen tragen ein eigenes Recht** (`eingang.freigeben`).
 * Wer erfasst, gibt nicht schon deswegen frei (Invariante 7). Die Freigabe
 * selbst friert ein, worüber entschieden wurde — Lieferant, Nummer, Datum,
 * Betrag —, damit eine nachträgliche Änderung sie nicht mehr deckt (K-13).
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  eingegangen: 'Entwurf', in_pruefung: 'In Prüfung', freigegeben: 'Bereit',
  gebucht: 'Abgeschlossen', abgelehnt: 'Abgelehnt',
};

interface Kopf {
  readonly id: string;
  readonly status: string;
  readonly interne_belegnummer: string | null;
  readonly lieferant: string | null;
  readonly rechnungsnummer_lieferant: string | null;
  readonly rechnungsdatum: string | null;
  readonly leistungsdatum: string | null;
  readonly faellig_am: string | null;
  readonly netto_cent: string | null;
  readonly steuer_cent: string | null;
  readonly brutto_cent: string | null;
  readonly bauabzugsteuer_cent: string;
  readonly abgelehnt_grund: string | null;
  readonly beleg_sha: string;
  readonly offen_cent: string | null;
}

interface SteuerZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly satz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

/** Ein extrahiertes Feld des Vorschlags, aus dem diese Rechnung entstand (PR 63, APR-03). */
interface HerkunftFeld {
  readonly id: string;
  readonly freigabe_id: string;
  readonly bezeichnung: string;
  readonly wert_nachher: string | null;
  readonly konfidenz: string | null;
  readonly unsicher: boolean;
  readonly quelle_zelle: string | null;
  readonly quelle_zitat: string | null;
}

export default async function EingangsrechnungDetail(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/eingangsrechnungen/[id]`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * `/freigaben/[id]` verlangt laut Manifest `freigabe.entscheiden`; diese
   * Seite oeffnet mit `eingang.lesen`. Wer den Beleg lesen darf, darf nicht
   * zwangslaeufig die Freigabe dahinter oeffnen — der Verweis fuehrte dann auf
   * 404 und verriete, was er nicht zeigen darf (AUT-06, Copilot-Runde auf
   * PR 16 / D-581). Ohne das Recht entfaellt der ganze Satz.
   */
  const darf = await haeltRechte(
    sitzung, 'freigabe.entscheiden', 'eingang.freigeben',
    'abrechnung.freistellung_pflegen', 'zahlung.lesen', 'zahlung.schreiben');

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(EINGANGSRECHNUNGEN_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);
  /*
   * Beträge in der Sprache der Sitzung (V-217) — die Seite ist zweisprachig,
   * die Zahlungstabelle schrieb trotzdem deutsch. Nur der Platzhalter im
   * Betragsfeld bleibt deutsch: er zeigt, wie `parseGeld` die Eingabe liest.
   */
  const geld = (c: Cent): string => formatiereGeldIn(c, zugang.sprache);
  const tz = nachSprache(ZAHLUNGEN_TEXTE, zugang.sprache);
  const tm = nachSprache(MAHNUNGEN_TEXTE, zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kopf: (await kontext.abfrage<Kopf>(
        `select er.id, er.status::text as status, er.interne_belegnummer,
                l.name as lieferant, er.rechnungsnummer_lieferant,
                to_char(er.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                to_char(er.leistungsdatum, 'DD.MM.YYYY') as leistungsdatum,
                to_char(er.faellig_am, 'DD.MM.YYYY') as faellig_am,
                er.netto_cent::text, er.steuer_cent::text, er.brutto_cent::text,
                er.bauabzugsteuer_cent::text, er.abgelehnt_grund,
                b.datei_sha256 as beleg_sha,
                (select op.offen_cent::text from offener_posten op
                  where op.eingangsrechnung_id = er.id) as offen_cent
           from eingangsrechnung er
           join beleg b on b.id = er.beleg_id and b.mandant_id = er.mandant_id
           left join lieferant l on l.id = er.lieferant_id and l.mandant_id = er.mandant_id
          where er.id = $1::uuid`, [id]))[0] ?? null,
      steuer: await kontext.abfrage<SteuerZeile>(
        `select s.id, g.bezeichnung, s.satz_bp, s.netto_cent::text, s.steuer_cent::text
           from eingangsrechnung_steuer s
           join steuersatz_gruppe g on g.id = s.steuersatz_gruppe_id
          where s.eingangsrechnung_id = $1::uuid
          order by s.satz_bp desc`, [id]),
      /*
       * Die Herkunft: wurde diese Rechnung aus einem E-Rechnungs-Vorschlag
       * uebernommen, stehen hier seine Felder mit Quelle und Konfidenz
       * (SEITENKARTE: „extracted fields with source and confidence").
       */
      herkunft: await kontext.abfrage<HerkunftFeld>(
        `select ff.id, ff.freigabe_id, ff.bezeichnung, ff.wert_nachher, ff.konfidenz::text as konfidenz,
                ff.unsicher, ff.quelle_zelle, ff.quelle_zitat
           from freigabe f
           join freigabe_feld ff on ff.freigabe_id = f.id and ff.mandant_id = f.mandant_id
          where f.bezug_typ = 'eingangsrechnung' and f.bezug_id = $1::uuid
            and f.aktion = 'eingangsrechnung_uebernehmen'
          order by ff.feld_pfad`, [id]),
      /*
       * Der Zahlungsausgang (V-216): der Kreditorposten, was darauf gezahlt
       * wurde, und die Konten, von denen gezahlt werden kann. Ohne
       * `zahlung.lesen` sieht die Seite keinen Posten — dann steht der
       * Abschnitt nicht da, statt „keine Zahlung" zu behaupten.
       */
      ...(darf['zahlung.lesen'] === true
        ? await (async () => {
          const posten = await postenZuEingangsrechnung(kontext, id);
          return {
            posten,
            zahlungen: posten === null ? [] : await buchungenZuPosten(kontext, posten.id),
            konten: darf['zahlung.schreiben'] === true ? await bankkonten(kontext) : [],
          };
        })()
        : { posten: null, zahlungen: [], konten: [] }),
    }))) as Promise<{ kopf: Kopf | null; steuer: readonly SteuerZeile[];
      herkunft: readonly HerkunftFeld[]; posten: Kreditorposten | null;
      zahlungen: readonly Buchungszeile[]; konten: readonly Bankkonto[] }>);

  if (daten.kopf === null) notFound();
  const kopf = daten.kopf;
  const ziel = `/api/finanzen/eingangsrechnungen?mandant=${mandant}`;
  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const knopf = 'min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold '
    + 'text-white hover:bg-brand-hover';
  const knopfStill = 'min-h-11 rounded-md border border-line-strong px-s5 py-s3 '
    + 'text-base text-text hover:bg-surface-2';
  /*
   * Rückmeldung und Abweisung aus `/api/finanzen/zahlungen` (V-216) — beide
   * nur als eigener Eintrag nachgeschlagen, nie roh angezeigt (D-728).
   */
  const meldung = eigenerEintrag(t.ausgangMeldungen, suche['meldung']) ?? null;
  const abgewiesen = typeof suche['fehler'] === 'string';
  const fehlerText = abgewiesen
    ? (eigenerEintrag(t.ausgangFehler, suche['fehler']) ?? t.ausgangFehlerSonst) : null;
  const zurueck = (name: string): string | undefined =>
    (abgewiesen ? vorbelegt(suche, name) : undefined);
  const { posten } = daten;
  const kannZahlen = kopf.status === 'gebucht' && posten !== null && posten.ausgeglichenAm === null
    && posten.offenCent > 0n && darf['zahlung.schreiben'] === true;

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/finanzen/eingangsrechnungen`, text: t.titel }}
      titel={kopf.interne_belegnummer ?? t.eingangsrechnung}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="eingangsrechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label={g.zurueck} className="mb-s3 flex flex-wrap gap-s4">
        {/*
          * Der Freigabebildschirm zeigt die vier Angaben, die der
          * Freigabesatz einfriert, und die Vier-Augen-Lage im Klartext. Er
          * oeffnet mit `eingang.freigeben`; ohne das Recht fuehrte der
          * Verweis auf 404 und verriete, was er verbirgt (AUT-06, D-581).
          */}
        {darf['eingang.freigeben'] === true ? (
          <Link
            href={`/portal/${mandant}/finanzen/eingangsrechnungen/${kopf.id}/freigabe`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t.freigabeAnsehen}
          </Link>
        ) : null}
        {/*
          * Die steuerliche Lage (§13b UStG, §48 EStG) steht auf einem eigenen
          * Blatt: es prueft gegen das Leistungsdatum und nennt die drei
          * Ausgaenge des §48 mit Namen. Es oeffnet laut Register mit
          * `abrechnung.freistellung_pflegen`.
          */}
        {darf['abrechnung.freistellung_pflegen'] === true ? (
          <Link
            href={`/portal/${mandant}/finanzen/eingangsrechnungen/${kopf.id}/steuer`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t.steuerlicheLage}
          </Link>
        ) : null}
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">
          {kopf.lieferant ?? t.ohneLieferant} ·{' '}
          {kopf.rechnungsnummer_lieferant ?? t.ohneNummer}
        </h1>
        <StatusPill zustand={PILLE[kopf.status] ?? 'Entwurf'} sprache={zugang.sprache} />
      </div>

      {kopf.abgelehnt_grund === null ? null : (
        <p className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          {t.abgelehntMit} {kopf.abgelehnt_grund}
        </p>
      )}

      <dl className="mb-s7 grid max-w-prose grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-text-muted">{t.interneBelegnummer}</dt>
          <dd className="text-text" data-cse="belegnummer">
            {kopf.interne_belegnummer
              ?? <span className="text-text-subtle">{t.entstehtBeimBuchen}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{t.rechnungsdatum}</dt>
          <dd className="text-text">{kopf.rechnungsdatum ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t.leistungsdatum}</dt>
          <dd className="text-text">{kopf.leistungsdatum ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{g.faellig}</dt>
          <dd className="text-text">{kopf.faellig_am ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t.brutto}</dt>
          <dd className="text-text">
            {kopf.brutto_cent === null ? '—' : geld(cent(BigInt(kopf.brutto_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{t.offenAnLieferanten}</dt>
          <dd className="text-text">
            {kopf.offen_cent === null
              ? <span className="text-text-subtle">{t.nochKeinPosten}</span>
              : geld(cent(BigInt(kopf.offen_cent)))}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="steuer-titel" className="mb-s7">
        <h2 id="steuer-titel" className="mb-s3 text-h2 text-text">
          {t.entgeltJeSteuersatz}
        </h2>
        {daten.steuer.length === 0 ? (
          <p className="rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
            {t.keineAufteilung}
          </p>
        ) : (
          <DataTable
            beschriftung={t.tabelleSteuerzeilen}
            zeilen={daten.steuer}
            schluessel={(s) => s.id}
            spalten={[
              { schluessel: 'gruppe', kopf: t.steuersatz, zelle: (s) => s.bezeichnung },
              {
                schluessel: 'netto', kopf: t.netto, numerisch: true,
                zelle: (s) => geld(cent(BigInt(s.netto_cent))),
              },
              {
                schluessel: 'steuer', kopf: t.steuer, numerisch: true,
                zelle: (s) => geld(cent(BigInt(s.steuer_cent))),
              },
            ]}
          />
        )}
      </section>

      {daten.herkunft.length > 0 ? (
        <section aria-labelledby="herkunft-titel" className="mb-s7" data-cse="herkunft-erechnung">
          <h2 id="herkunft-titel" className="mb-s3 text-h2 text-text">
            {t.herkunftTitel}
          </h2>
          <p className="mb-s4 max-w-prose text-sm text-text-muted">
            {t.herkunftErklaerung}
            {darf['freigabe.entscheiden'] === true ? (
              <>
                {' '}{t.entschiedenWurdeIn}{' '}
                <Link href={`/portal/${mandant}/freigaben/${daten.herkunft[0]!.freigabe_id}`}
                      className="underline underline-offset-2">
                  {t.derFreigabe}
                </Link>.
              </>
            ) : null}
          </p>
          <DataTable
            beschriftung={t.tabelleHerkunft}
            zeilen={daten.herkunft}
            schluessel={(h) => h.id}
            spalten={[
              { schluessel: 'feld', kopf: t.feld, zelle: (h) => h.bezeichnung },
              { schluessel: 'wert', kopf: t.wert,
                zelle: (h) => h.wert_nachher ?? <span className="text-text-subtle">—</span> },
              { schluessel: 'konfidenz', kopf: t.konfidenz, numerisch: true,
                zelle: (h) => h.konfidenz ?? '—' },
              { schluessel: 'quelle', kopf: t.quelle,
                zelle: (h) => (
                  <span className="flex min-w-0 flex-col text-xs text-text-muted">
                    <span className="break-all font-mono">{h.quelle_zelle ?? '—'}</span>
                    {h.quelle_zitat === null ? null : <q className="text-text">{h.quelle_zitat}</q>}
                  </span>
                ) },
            ]}
          />
        </section>
      ) : null}

      {meldung === null ? null : (
        <Hinweis art="erfolg" rolle="status" cse="ausgang-meldung" className="mb-s5 max-w-prose">{meldung}</Hinweis>
      )}
      {fehlerText === null ? null : (
        <Hinweis art="warnung" rolle="alert" cse="ausgang-fehler" className="mb-s5 max-w-prose">
          {fehlerText}
        </Hinweis>
      )}

      {/*
        * **Die Zahlungen an den Lieferanten** (V-216, FIN-14). Bis hierher gab
        * es auf der Kreditorenseite keinen Zahlungsweg: jede gebuchte
        * Eingangsrechnung stand für immer als unbezahlt in den offenen
        * Posten, der Altersstruktur, der Gruppensumme und dem Jahrespaket.
        */}
      {posten === null ? null : (
        <section aria-labelledby="zahlungen-titel" className="mb-s7" data-cse="ausgang-zahlungen">
          <h2 id="zahlungen-titel" className="mb-s3 text-h2 text-text">{t.zahlungenTitel}</h2>
          {daten.zahlungen.length === 0 ? (
            <p className="max-w-prose rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
              {t.keineZahlung}
            </p>
          ) : (
            <DataTable
              beschriftung={t.tabelleZahlungen}
              zeilen={daten.zahlungen}
              schluessel={(z) => z.id}
              spalten={[
                { schluessel: 'tag', kopf: t.zahlungstag,
                  zelle: (z) => (z.zahlungsdatum === null ? '—' : tagInSprache(z.zahlungsdatum, zugang.sprache)) },
                { schluessel: 'art', kopf: g.art,
                  zelle: (z) => eigenerEintrag(tm.zuordnungsarten, z.art) ?? '—' },
                { schluessel: 'betrag', kopf: g.betrag, numerisch: true,
                  zelle: (z) => geld(z.betragCent) },
                { schluessel: 'zahlung', kopf: tz.titel,
                  zelle: (z) => (z.zahlungId === null ? '—' : (
                    <Link href={`/portal/${mandant}/finanzen/zahlungen/${z.zahlungId}`}
                          className="underline underline-offset-2">
                      {z.storniertAm === null ? t.zahlungOeffnen : `${t.zahlungOeffnen} (${t.storniert})`}
                    </Link>
                  )) },
              ]}
            />
          )}

          {posten.ausgeglichenAm === null ? null : (
            /*
             * Ist der Posten ausgeglichen, verschwindet das Formular — und
             * der Satz sagt, warum (V-217; der Text lag seit V-216 unbenutzt).
             */
            <p data-cse="ausgang-bezahlt" className="mt-s4 max-w-prose text-sm text-text-muted">
              {t.bezahlt} {tagInSprache(posten.ausgeglichenAm, zugang.sprache)}.
            </p>
          )}

          {kannZahlen ? (
            <form method="post" action={`/api/finanzen/zahlungen?mandant=${mandant}`}
                  data-cse="ausgang-formular"
                  className="mt-s5 max-w-prose rounded-lg border border-line bg-surface p-s5">
              <h3 className="text-h3 text-text">{t.zahlungErfassenTitel}</h3>
              <p className="mt-s2 text-xs text-text-muted">{t.zahlungErfassenErklaerung}</p>
              <input type="hidden" name="aktion" value="ausgang" />
              <input type="hidden" name="eingangsrechnungId" value={kopf.id} />
              <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm text-text" htmlFor="betrag">{t.betragInEuro}</label>
                  <input id="betrag" name="betrag" type="text" inputMode="decimal" required
                         className={feld} placeholder={formatiereGeld(posten.offenCent).replace(/\s*€$/u, '')}
                         defaultValue={zurueck('betrag')} />
                </div>
                <div>
                  <label className="block text-sm text-text" htmlFor="zahlungsdatum">{t.zahlungstag}</label>
                  <input id="zahlungsdatum" name="zahlungsdatum" type="date" required className={feld}
                         defaultValue={zurueck('zahlungsdatum')} />
                </div>
              </div>
              <label className="mt-s4 block text-sm text-text" htmlFor="zahlungsmittel">{t.zahlungsweg}</label>
              <select id="zahlungsmittel" name="zahlungsmittel" required className={feld}
                      defaultValue={zurueck('zahlungsmittel') ?? 'ueberweisung'}>
                <option value="ueberweisung">{tz.mittelNamen.ueberweisung}</option>
                <option value="lastschrift">{tz.mittelNamen.lastschrift}</option>
                <option value="karte">{tz.mittelNamen.karte}</option>
                <option value="verrechnung">{tz.mittelNamen.verrechnung}</option>
              </select>
              <label className="mt-s4 block text-sm text-text" htmlFor="bankkontoId">{t.vonKonto}</label>
              <select id="bankkontoId" name="bankkontoId" className={feld}
                      defaultValue={zurueck('bankkontoId') ?? ''}>
                <option value="">{tz.ohneKontobezug}</option>
                {daten.konten.map((k) => (
                  <option key={k.id} value={k.id}>{k.bezeichnung} · {formatiereIban(k.iban)}</option>
                ))}
              </select>
              <label className="mt-s4 block text-sm text-text" htmlFor="referenz">{tz.verwendungszweck}</label>
              <input id="referenz" name="referenz" type="text" className={feld}
                     defaultValue={zurueck('referenz') ?? kopf.rechnungsnummer_lieferant ?? ''} />
              <button type="submit" className={`mt-s5 ${knopf}`} data-cse="ausgang-erfassen">
                {t.zahlungErfassen}
              </button>
            </form>
          ) : null}
        </section>
      )}

      <section aria-labelledby="weg-titel">
        <h2 id="weg-titel" className="mb-s3 text-h2 text-text">{t.naechsterSchritt}</h2>

        {kopf.status === 'gebucht' ? (
          <p className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.gebuchtUnter} {kopf.interne_belegnummer}{t.gebuchtErklaerung}
          </p>
        ) : kopf.status === 'abgelehnt' ? (
          <p className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.abgelehntErklaerung}
          </p>
        ) : (
          <div className="flex max-w-prose flex-col gap-s5">
            {kopf.status === 'eingegangen' ? (
              <form method="post" action={ziel}
                className="rounded-lg border border-line bg-surface p-s5">
                <input type="hidden" name="aktion" value="pruefen" />
                <input type="hidden" name="id" value={kopf.id} />
                <p className="mb-s3 text-sm text-text-muted">
                  {t.pruefenErklaerung}
                </p>
                <button type="submit" className={knopf}>{t.inPruefungGeben}</button>
              </form>
            ) : null}

            {kopf.status === 'in_pruefung' ? (
              <form method="post" action={ziel}
                className="rounded-lg border border-line bg-surface p-s5">
                <input type="hidden" name="aktion" value="freigeben" />
                <input type="hidden" name="id" value={kopf.id} />
                <label className="block text-sm text-text" htmlFor="begruendung">
                  {t.grundDerFreigabe}
                </label>
                <input
                  id="begruendung" name="begruendung" type="text" minLength={5}
                  placeholder={t.begruendungPlatzhalter} className={feld}
                />
                <p className="mt-s2 max-w-prose text-xs text-text-muted">
                  {t.freigabeFriertEin}
                </p>
                <button type="submit" className={`mt-s4 ${knopf}`}>{g.freigeben}</button>
              </form>
            ) : null}

            {kopf.status === 'freigegeben' ? (
              <form method="post" action={ziel}
                className="rounded-lg border border-line bg-surface p-s5">
                <input type="hidden" name="aktion" value="buchen" />
                <input type="hidden" name="id" value={kopf.id} />
                <p className="mb-s3 text-sm text-text-muted">
                  {t.buchenErklaerung}
                </p>
                <button type="submit" className={knopf}>{t.buchen}</button>
              </form>
            ) : null}

            <form method="post" action={ziel}
              className="rounded-lg border border-line bg-surface p-s5">
              <input type="hidden" name="aktion" value="ablehnen" />
              <input type="hidden" name="id" value={kopf.id} />
              <label className="block text-sm text-text" htmlFor="grund">
                {t.zurueckweisenMitGrund}
              </label>
              <input
                id="grund" name="grund" type="text" minLength={5}
                placeholder={t.zurueckweisenPlatzhalter} className={feld}
              />
              <p className="mt-s2 max-w-prose text-xs text-text-muted">
                {t.zeileBleibtStehen}
              </p>
              <button type="submit" className={`mt-s4 ${knopfStill}`}>{t.zurueckweisen}</button>
            </form>
          </div>
        )}
      </section>
    </PortalRahmen>
  );
}
