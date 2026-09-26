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
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { BELEGE_TEXTE } from '@/lib/i18n/verwaltung/finanzen/belege';
import { Recht } from '@/components/ui/Recht';
import { haeltRechte } from '@/app/portal/rechte';
import { AUSGABE_ERFASSEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/ausgabe-erfassen';

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

/*
 * Die PILLE bildet den Zustand auf das FESTE Pillenvokabular aus DESIGN §5 ab.
 * Sie bleibt deutsch und bleibt hier: der Wert ist ein Schluessel, der die
 * Farbe waehlt — die Pille uebersetzt ihre Beschriftung selbst.
 */
const PILLE: Readonly<Record<AusgabeStatus, PillZustand>> = {
  erfasst: 'Entwurf',
  freigegeben: 'Bereit',
  gebucht: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
};

/*
 * Der Rechtename lautet in beiden Sprachen gleich und steht deshalb hier und
 * nicht in der Texttabelle (siehe den Kopf von
 * `i18n/verwaltung/finanzen/belege.ts`).
 */
const RECHT_ERSTATTUNG_LESEN = 'personal.erstattung_lesen';

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
  /* Der Monat aus den Monatszahlen (V-215) — nur in genau dieser Form. */
  const monatRoh = typeof suche['monat'] === 'string' ? suche['monat'] : null;
  const monat = monatRoh !== null && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(monatRoh) ? monatRoh : null;
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
    monat,
    /* Wie die Spalte „Betriebsausgaben" zählt (V-217) — Monatszahlen und Übersicht verlinken so. */
    nurAufwand: suche['aufwand'] === 'ja',
  };

  const tor = await mandantTor(`/portal/${mandant}/finanzen/ausgaben`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(BELEGE_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);
  const e = nachSprache(AUSGABE_ERFASSEN_TEXTE, zugang.sprache);

  /*
   * Das Recht der Erfassungsseite — VOR dem Rendern (AUT-06). Diese Liste
   * oeffnet mit `eingang.lesen`; erfassen verlangt `eingang.schreiben`, und
   * ein Knopf, den jeder sieht, fuehrte fuer den Rest auf 404.
   */
  const darf = await haeltRechte(zugang.sitzung, 'eingang.schreiben');

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

  /*
   * `max-w-full` — und ohne es hilft `flex-wrap` an der Filterzeile nichts.
   *
   * Gemessen am Telefon (390px): diese Seite lief 88px hinaus, in `security`
   * 56px, in `bau` 53px. Der schuldige Kasten war jedes Mal ein
   * Auswahlfeld. Ein `select` ist so breit wie seine LÄNGSTE Option
   * („freigegeben — zur Buchung bereit", eine Kategoriebezeichnung mit
   * „(unbestätigt)") und schrumpft nicht: es umbricht nicht, also ist seine
   * Mindestbreite seine Breite. `flex-wrap` bricht die ZEILE um, und das
   * nützt nichts, wenn schon ein EINZELNES Kind breiter ist als die Spalte —
   * genau die Lehre aus D-594, nur eine Ebene tiefer am Formularfeld.
   *
   * Deshalb beides: `min-w-0` nimmt dem Flex-Element seine
   * inhaltsgetriebene Mindestbreite (D-420), `max-w-full` bindet das Feld
   * darin an seinen Kasten statt an seine längste Option.
   */
  const feld = 'min-h-11 max-w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const gefiltert = filter.jahr !== null || filter.status !== null
    || filter.kategorieId !== null || filter.nurWeiterberechenbar || filter.monat !== null
    || filter.nurAufwand;
  const belegLuecken = daten.zeilen.filter((z) => z.belegPflichtVerletzt);
  const platzhalterKategorien = daten.zeilen.filter((z) => z.kategorieIstPlatzhalter);

  return (
    <PortalRahmen
      titel={t.ausgabenTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <span className="flex flex-wrap items-baseline gap-s4">
          <h1 className="m-0 text-h1 text-text">{t.ausgabenTitel}</h1>
          {/*
            * **Der Weg zur Erfassung — bis V-011 gab es ihn nicht**, und
            * dahinter auch keine Seite: `0180` baute die ganze
            * Zustandsmaschine, und schreiben konnte sie niemand.
            */}
          {darf['eingang.schreiben'] === true ? (
            <Link
              href={`/portal/${mandant}/finanzen/ausgaben/erfassen`}
              data-cse="zur-erfassung"
              className="inline-flex min-h-11 items-center rounded-md border
                         border-line-strong px-s4 text-sm text-text no-underline
                         hover:bg-surface-2"
            >
              {e.titel}
            </Link>
          ) : null}
        </span>
        {monat === null ? null : (
          <p data-cse="monat-filter" className="text-sm text-text-muted">
            {t.belegdatumImMonat}{' '}
            <strong>{monat.slice(5, 7)}/{monat.slice(0, 4)}</strong>{' '}
            <Link href={`/portal/${mandant}/finanzen/ausgaben`} className="underline underline-offset-2">{t.alleZeigen}</Link>
          </p>
        )}
        <form method="get" className="flex min-w-0 flex-wrap items-end gap-s3">
          {/* Der Monat bleibt beim Verfeinern stehen; „alle zeigen" hebt ihn auf. */}
          {monat === null ? null : <input type="hidden" name="monat" value={monat} />}
          <div className="min-w-0">
            <label className="block text-xs text-text-muted" htmlFor="jahr">{t.jahr}</label>
            <input
              id="jahr" name="jahr" type="number" min="2000" max="2999" step="1"
              defaultValue={filter.jahr ?? ''} placeholder={t.alle} className={feld}
            />
          </div>
          <div className="min-w-0">
            <label className="block text-xs text-text-muted" htmlFor="status">
              {g.zustand}
            </label>
            <select id="status" name="status" defaultValue={filter.status ?? ''} className={feld}>
              <option value="">{t.alle}</option>
              {AUSGABE_STATUS.map((s) => (
                <option key={s} value={s}>{t.zustandListe[s]}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className="block text-xs text-text-muted" htmlFor="kategorie">
              {t.kategorie}
            </label>
            <select
              id="kategorie" name="kategorie"
              defaultValue={filter.kategorieId ?? ''} className={feld}
            >
              <option value="">{t.alle}</option>
              {daten.kategorien.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.bezeichnung}{k.istPlatzhalter ? t.unbestaetigtKlammer : ''}
                </option>
              ))}
            </select>
          </div>
          <label className="flex min-h-11 min-w-0 items-center gap-s2 text-sm text-text">
            <input
              type="checkbox" name="weiterberechenbar" value="ja"
              defaultChecked={filter.nurWeiterberechenbar}
            />
            {t.nurWeiterberechenbar}
          </label>
          <label className="flex min-h-11 min-w-0 items-center gap-s2 text-sm text-text">
            <input
              type="checkbox" name="aufwand" value="ja" data-cse="filter-aufwand"
              defaultChecked={filter.nurAufwand}
            />
            {t.nurAufwand}
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
          >
            {t.anzeigen}
          </button>
          {gefiltert ? (
            <Link
              href={`/portal/${mandant}/finanzen/ausgaben`}
              className="text-sm text-text-muted underline underline-offset-2 hover:text-text"
            >
              {g.zuruecksetzen}
            </Link>
          ) : null}
        </form>
      </div>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <KpiStat label={t.ausgabenTitel} wert={String(daten.summe.anzahl)} icon="euro" />
        <KpiStat
          label={t.netto}
          wert={formatiereGeld(daten.summe.nettoCent)}
          icon="euro"
        />
        <KpiStat
          label={t.brutto}
          wert={formatiereGeld(daten.summe.bruttoCent)}
          icon="euro"
        />
      </div>

      {daten.summe.jeStatus.length === 0 ? null : (
        <div
          data-cse="ausgaben-summen-je-status"
          className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm"
        >
          <h2 className="mb-s3 text-h3 text-text">{t.summenJeZustand}</h2>
          <ul className="m-0 flex flex-col gap-s2 p-0">
            {daten.summe.jeStatus.map((s) => (
              <li key={s.status} className="flex flex-wrap items-baseline gap-s3">
                <StatusPill zustand={PILLE[s.status]} sprache={zugang.sprache} />
                <span className="text-xs text-text-muted">{t.zustandListe[s.status]}</span>
                <span className="cse-zahl text-text">
                  {s.anzahl} · {t.netto} {formatiereGeld(s.nettoCent)} · {t.ust}{' '}
                  {formatiereGeld(s.steuerCent)} · {t.brutto}{' '}
                  {formatiereGeld(s.bruttoCent)}
                </span>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-s3 max-w-prose text-xs text-text-muted">
            {t.gezaehltInDatenbank}
          </p>
        </div>
      )}

      {belegLuecken.length > 0 ? (
        <Hinweis art="warnung" cse="ausgaben-ohne-beleg" className="mb-s5">
          <p className="m-0 max-w-prose">
            {belegLuecken.length === 1
              ? t.einAusgabeOhneBeleg
              : `${String(belegLuecken.length)}${t.ausgabenOhneBeleg}`}{' '}
            {t.ohneBelegErklaerung}
          </p>
        </Hinweis>
      ) : null}

      <Hinweis art="warnung" cse="ausgaben-eigenbeleg" className="mb-s5">
        <p className="m-0 max-w-prose">
          <strong>{t.belegfreiNichtVorgesehen}</strong>{' '}
          {EIGENBELEG_PLATZHALTER.herkunft}
        </p>
        <p className="m-0 mt-s2 max-w-prose">
          {t.tseOffen}
        </p>
      </Hinweis>

      {platzhalterKategorien.length > 0 ? (
        <Hinweis art="hinweis" cse="ausgaben-kategorie-platzhalter" className="mb-s5">
          <p className="m-0 max-w-prose">
            {t.kategoriePlatzhalterVor}{' '}
            <strong>{t.kategoriePlatzhalterBetont}</strong>{' '}
            {t.kategoriePlatzhalterNach}
          </p>
        </Hinweis>
      ) : null}

      {daten.zeilen.length === 0 ? (
        <Hinweis art="hinweis" cse="ausgaben-leer">
          <p className="m-0 max-w-prose">
            {gefiltert ? t.keineAusgabeZumFilter : t.keineAusgabeErfasst}
          </p>
        </Hinweis>
      ) : (
        <DataTable
          beschriftung={t.tabelleAusgaben}
          zeilen={daten.zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'datum', kopf: g.datum,
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
              kopf: t.kategorie,
              zelle: (z) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{z.kategorie}</span>
                  {z.kategorieIstPlatzhalter ? (
                    <span className="text-xs text-warning">{t.unbestaetigtO05}</span>
                  ) : null}
                </span>
              ),
            },
            {
              schluessel: 'bezeichnung',
              kopf: g.bezeichnung,
              zelle: (z) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{z.bezeichnung}</span>
                  <span className="text-xs text-text-muted">
                    {t.zahlungsmittelListe[
                      z.zahlungsmittel as keyof typeof t.zahlungsmittelListe]
                      ?? z.zahlungsmittel}
                    {z.kasse === null ? '' : ` · ${z.kasse}`}
                    {z.auftragsnummer === null
                      ? '' : ` · ${t.auftrag} ${z.auftragsnummer}`}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'netto', kopf: t.netto, numerisch: true,
              zelle: (z) => formatiereGeld(z.nettoCent),
            },
            {
              schluessel: 'steuer', kopf: t.ust, numerisch: true,
              zelle: (z) => formatiereGeld(z.steuerCent),
            },
            {
              schluessel: 'brutto', kopf: t.brutto, numerisch: true,
              zelle: (z) => formatiereGeld(z.bruttoCent),
            },
            {
              schluessel: 'beleg',
              kopf: t.beleg,
              zelle: (z) => (z.belegId === null
                ? (
                  <span className={z.belegPflichtVerletzt ? 'text-warning' : 'text-text-subtle'}>
                    {z.belegPflichtVerletzt ? t.belegFehltDarfNichtSein : t.nochKeiner}
                  </span>
                )
                : (
                  <Link
                    href={`/portal/${mandant}/finanzen/belege/${z.belegId}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.belegnummer ?? t.ohneNummer}
                  </Link>
                )),
            },
            {
              schluessel: 'zustand',
              kopf: g.zustand,
              zelle: (z) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    <StatusPill zustand={PILLE[z.status]} sprache={zugang.sprache} />
                    <span className="text-xs text-text-muted">
                      {z.abgelehntGrund ?? t.zustandListe[z.status]}
                    </span>
                  </span>
                  <span className="text-xs text-text-muted">
                    {z.weiterberechenbar ? t.weiterberechenbarJa : t.weiterberechenbarNein}
                    {z.istErstattung ? t.erstattungSuffix : ''}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        {t.ausgabenFussnoteVor}
        <Recht schluessel={RECHT_ERSTATTUNG_LESEN} sprache={zugang.sprache} />
        {t.ausgabenFussnoteNach}
      </p>
    </PortalRahmen>
  );
}
