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
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { BELEGE_TEXTE } from '@/lib/i18n/verwaltung/finanzen/belege';
import { AUSGABE_ERFASSEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/ausgabe-erfassen';
import { Button } from '@/components/ui/Button';
import { Recht } from '@/components/ui/Recht';
import { eigenerEintrag } from '@/lib/nachschlagen';

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

/**
 * Die Zustandsfolge in ihrer Reihenfolge — dieselbe wie
 * `fin.ausgabe_uebergang`. Wohin ein Zustand fuehrt, steht ausgeschrieben in
 * der Texttabelle (`t.folge`); hier stehen nur die Schluessel.
 */
const FOLGE: readonly AusgabeStatus[] = [
  'erfasst', 'freigegeben', 'gebucht', 'abgelehnt',
];

/*
 * Rechte-, Ereignis-, Index- und Ausloesernamen lauten in beiden Sprachen
 * gleich und stehen deshalb hier und nicht in der Texttabelle (siehe den Kopf
 * von `i18n/verwaltung/finanzen/belege.ts`).
 */
const RECHT_ERSTATTUNG_LESEN = 'personal.erstattung_lesen';
const EREIGNIS_ERSTATTUNG_GELESEN = 'ausgabe.erstattung_gelesen';
const INDEX_QUELLE_AUSGABE_UK = 'quelle_ausgabe_uk';
const AUSLOESER_AUSGABE_UEBERGANG = 'fin.ausgabe_uebergang';

export default async function Ausgabenblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  /*
   * **Der Rückweg der drei Formulare dieses Blatts** (V-197). Freigeben,
   * Ablehnen und Buchen schicken `fehlerweg` hierher, und die Route hängt
   * den Grund als `?fehler=` an (`kein_beleg`, `kein_uebergang`,
   * `grund_fehlt` …). Das Blatt nahm keine Suchparameter an: „Freigeben" ohne
   * Beleg endete auf derselben Seite, nichts war geschehen, und kein Satz
   * sagte, warum.
   */
  const fehler = (await searchParams)['fehler'];
  kennungOder404(id);
  const pfad = `/portal/${mandant}/finanzen/ausgaben/${id}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(BELEGE_TEXTE, zugang.sprache);
  const e = nachSprache(AUSGABE_ERFASSEN_TEXTE, zugang.sprache);

  /*
   * Drei Nachbarrechte: die Erstattung (`personal.erstattung_lesen`), die
   * Rechnungszeile (`finanzen.lesen`) und der Auftrag (`auftrag.lesen`). Diese
   * Seite öffnet mit `eingang.lesen` und hält keines davon zwangsläufig —
   * ohne sie steht Text statt eines Verweises (AUT-06, D-581).
   */
  const darf = await haeltRechte(
    sitzung, 'personal.erstattung_lesen', 'finanzen.lesen', 'auftrag.lesen',
    'eingang.freigeben', 'buchhaltung.schreiben');

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
         * Gefragt wird nur, wenn das Ja/Nein überhaupt eine Erstattung
         * gemeldet hat: `erstattung()` ruft
         * `app.ausgabe_erstattung_lesen()`, und die PROTOKOLLIERT jeden
         * Aufruf. Ein Protokolleintrag für jede Ausgabenseite machte das
         * Protokoll unlesbar — genau dort, wo es lesbar bleiben muss
         * (SEC-A9).
         *
         * Das Ja/Nein selbst kommt aus `app.ausgabe_ist_erstattung()` (0184)
         * und protokolliert nicht. Vorher stand in derselben Spaltenliste der
         * protokollierende Definer: die Liste schrieb damit bei jedem
         * Seitenaufruf eine Zeile je Erstattung und diese Seite zwei — die
         * Flut, die dieser Kommentar zu vermeiden behauptete.
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
      titel={t.ausgabeTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      /*
       * Der Rückweg steht in der EIGENSCHAFT und nicht als eigenes `<nav>`
       * im Inhalt (V-111). Hier stand beides untereinander: der abgeleitete
       * Pfeil der Hülle und ein zweiter mit demselben Ziel. Zwei Ausgänge,
       * die dasselbe sagen, lassen den Leser prüfen, ob sie es wirklich tun
       * — ein doppelter Ausgang ist schlechter als ein fehlender.
       */
      zurueck={{ ziel: `/portal/${mandant}/finanzen/ausgaben`, text: t.ausgabenTitel }}
    >
      {typeof fehler === 'string' && (
        <Hinweis art="warnung" cse="ausgabe-fehler" rolle="alert" className="mb-s5 max-w-prose">
          {eigenerEintrag(e.fehler, fehler) ?? e.fehlerAllgemein}
        </Hinweis>
      )}

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{a.bezeichnung}</h1>
        <span className="inline-flex flex-wrap items-center gap-s2">
          <StatusPill zustand={PILLE[a.status]} sprache={zugang.sprache} />
          <span className="text-xs text-text-muted">{t.zustandBlatt[a.status]}</span>
        </span>
      </div>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">{t.ausgabedatum}</dt>
          <dd className="text-sm text-text">{a.ausgabedatum}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.kategorie}</dt>
          <dd className="text-sm text-text">
            {a.kategorie}
            {a.kategorieIstPlatzhalter
              ? <span className="text-warning">{t.unbestaetigtStrich}</span>
              : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.bezahltMit}</dt>
          <dd className="text-sm text-text">
            {t.zahlungsmittelBlatt[
              a.zahlungsmittel as keyof typeof t.zahlungsmittelBlatt]
              ?? a.zahlungsmittel}
            {a.kasse === null ? '' : ` · ${a.kasse}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.netto}</dt>
          <dd className="cse-zahl text-sm text-text">{formatiereGeld(a.nettoCent)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.umsatzsteuer}</dt>
          <dd className="cse-zahl text-sm text-text">{formatiereGeld(a.steuerCent)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.brutto}</dt>
          <dd className="cse-zahl text-base text-text">{formatiereGeld(a.bruttoCent)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.weiterberechenbar}</dt>
          <dd className="text-sm text-text">
            {a.weiterberechenbar ? t.jaFin07 : t.nein}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.auftrag}</dt>
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
          <dt className="text-xs text-text-muted">{t.beleg}</dt>
          <dd className="text-sm text-text">
            {a.belegId === null
              ? (
                <span className={a.belegPflichtVerletzt ? 'text-warning' : 'text-text-subtle'}>
                  {a.belegPflichtVerletzt
                    ? t.belegFehltInDiesemZustand
                    : t.nochKeiner}
                </span>
              )
              : (
                <Link
                  href={`/portal/${mandant}/finanzen/belege/${a.belegId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {a.belegnummer ?? t.belegOhneNummer}
                </Link>
              )}
          </dd>
        </div>
      </dl>

      {a.status === 'abgelehnt' ? (
        <Hinweis art="hinweis" cse="ausgabe-abgelehnt" className="mb-s5">
          <p className="m-0 max-w-prose">
            {t.zurueckgewiesenVor} {t.zitatAuf}{a.abgelehntGrund ?? '—'}{t.zitatZu}
            {t.zurueckgewiesenNach}
          </p>
        </Hinweis>
      ) : null}

      {a.belegId === null && a.status === 'erfasst' ? (
        <Hinweis art="warnung" cse="ausgabe-beleg-fehlt" className="mb-s5">
          <p className="m-0 max-w-prose">
            <strong>{t.ohneBelegKeineFreigabe}</strong> {t.ohneBelegErzwungenVor}{' '}
            <em>{t.freigegebenWort}</em> {t.ohneBelegErzwungenNach}
          </p>
          <p className="m-0 mt-s2 max-w-prose">
            {EIGENBELEG_PLATZHALTER.herkunft}
          </p>
        </Hinweis>
      ) : null}

      <h2 className="mb-s3 text-h2 text-text">{t.steuerJeGruppeTitel}</h2>
      {steuer === null || steuer.zeilen.length === 0 ? (
        <Hinweis
          art={a.status === 'gebucht' ? 'warnung' : 'hinweis'}
          cse="ausgabe-keine-steuerzeilen"
          className="mb-s5"
        >
          <p className="m-0 max-w-prose">
            {a.status === 'gebucht' ? t.gebuchtOhneAufteilung : t.nochKeineAufteilung}
          </p>
          <p className="m-0 mt-s2 max-w-prose">
            {t.keinSatzZurueckgerechnetVor} <strong>{t.keinBetont}</strong>{' '}
            {t.keinSatzZurueckgerechnetNach}
          </p>
        </Hinweis>
      ) : (
        <>
          <DataTable
            beschriftung={t.tabelleSteuerzeilen}
            zeilen={steuer.zeilen}
            schluessel={(z) => z.steuersatzGruppeId}
            spalten={[
              { schluessel: 'gruppe', kopf: t.steuersatzgruppe, zelle: (z) => z.gruppe },
              {
                schluessel: 'satz', kopf: t.satz, numerisch: true,
                zelle: (z) => `${(z.satzBp / 100).toLocaleString('de-DE')} %`,
              },
              {
                schluessel: 'kategorie', kopf: t.en16931Kategorie,
                zelle: (z) => z.kategorie,
              },
              {
                schluessel: 'netto', kopf: t.netto, numerisch: true,
                zelle: (z) => formatiereGeld(z.nettoCent),
              },
              {
                schluessel: 'steuer', kopf: t.ust, numerisch: true,
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
              {t.zeilensumme} {formatiereGeld(steuer.nettoCent)} {t.nettoSchraeg}{' '}
              {formatiereGeld(steuer.steuerCent)} {t.steuerKopf}{' '}
              {formatiereGeld(a.nettoCent)} / {formatiereGeld(a.steuerCent)}
              {steuer.stimmtMitKopf ? t.stimmenUeberein : t.weichenAb}
            </p>
          </div>
        </>
      )}

      <h2 className="mb-s3 text-h2 text-text">{t.erstattungTitel}</h2>
      <div
        data-cse="ausgabe-erstattung"
        data-ist-erstattung={String(a.istErstattung)}
        className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm"
      >
        {daten.erstattung === null ? (
          <p className="m-0 max-w-prose text-text-muted">
            {darf['personal.erstattung_lesen'] === true
              ? t.keineErstattung
              : `${t.keineAngabeErstattungVor}${RECHT_ERSTATTUNG_LESEN}`
                + `${t.keineAngabeErstattungNach}`}
          </p>
        ) : (
          <>
            <p className="m-0 max-w-prose text-text">
              {t.erstattetAnAnstellung}{' '}
              <strong>{daten.erstattung.personalnummer ?? t.ohnePersonalnummer}</strong>.
            </p>
            <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
              {t.erstattungAnAnstellungVor}{' '}
              <code>{EREIGNIS_ERSTATTUNG_GELESEN}</code>
              {t.erstattungAnAnstellungNach}
            </p>
          </>
        )}
      </div>

      <h2 className="mb-s3 text-h2 text-text">{t.weiterberechnungTitel}</h2>
      {daten.weiter.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {a.weiterberechenbar
            ? `${t.nochNichtWeiterberechnetVor}${INDEX_QUELLE_AUSGABE_UK}`
              + `${t.nochNichtWeiterberechnetNach}`
            : t.nichtWeiterberechenbar}
        </p>
      ) : (
        <DataTable
          beschriftung={t.tabelleWeiterberechnung}
          zeilen={daten.weiter}
          schluessel={(w) => `${w.rechnungId}-${String(w.positionNr)}`}
          spalten={[
            {
              schluessel: 'rechnung',
              kopf: t.rechnung,
              zelle: (w) => (darf['finanzen.lesen'] === true ? (
                <Link
                  href={`/portal/${mandant}/finanzen/rechnungen/${w.rechnungId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {w.rechnungNummer ?? t.entwurfOhneNummer}
                </Link>
              ) : (w.rechnungNummer ?? t.entwurfOhneNummer)),
            },
            {
              schluessel: 'position', kopf: t.position, numerisch: true,
              zelle: (w) => w.positionNr,
            },
            {
              schluessel: 'bezeichnung', kopf: t.zeile,
              zelle: (w) => w.positionBezeichnung,
            },
            {
              schluessel: 'wirksam',
              kopf: t.wirksam,
              zelle: (w) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill
                    zustand={w.wirksam ? 'Aktiv' : 'Archiviert'}
                    sprache={zugang.sprache}
                  />
                  <span className="text-xs text-text-muted">
                    {w.wirksam
                      ? `${t.berechnet} · ${w.rechnungStatus}`
                      : t.unwirksamAusStorno}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}

      {/*
        * ═══════════════════════════════════════════════════════════════════
        * **Die Entscheidung — sie fehlte ganz** (V-011).
        * ═══════════════════════════════════════════════════════════════════
        *
        * `0180` baut vier Zustände und ihren Übergangsauslöser; zwei Seiten
        * zeigten sie. Nur bewegen konnte sie niemand: eine Ausgabe stand auf
        * „erfasst" und blieb dort, weil zwischen Tabelle und Oberfläche kein
        * Dienst stand.
        *
        * Freigeben, ablehnen und buchen sind Entscheidungen über Geld und
        * hängen deshalb an `eingang.freigeben` — nicht an dem Recht, mit dem
        * man erfasst. Wer eine Quittung eintippt, gibt sie nicht schon
        * deshalb frei; das ist die Trennung, die das Vieraugenprinzip
        * ausmacht.
        */}
      <h2 className="mb-s3 mt-s7 text-h2 text-text">{e.entscheidung}</h2>
      <p className="mb-s4 max-w-prose text-sm text-text-muted">
        {e.entscheidungErklaerung}
      </p>

      {a.status === 'gebucht' || a.status === 'abgelehnt' ? (
        <Hinweis art="hinweis" cse="ausgabe-entschieden" className="mb-s5 max-w-prose">
          {e.entschieden}
        </Hinweis>
      ) : darf['eingang.freigeben'] !== true ? (
        <Hinweis art="hinweis" cse="kein-entscheidungsrecht" className="mb-s5 max-w-prose">
          {e.keinEntscheidungsrecht}{' '}
          <Recht schluessel="eingang.freigeben" sprache={zugang.sprache} />.
        </Hinweis>
      ) : (
        <div className="mb-s5 flex flex-col gap-s4 rounded-lg border border-line
                        bg-surface p-s5">
          {a.status === 'erfasst' ? (
            <form method="post" action="/api/finanzen/ausgaben"
                  data-cse="ausgabe-freigeben-form">
              <input type="hidden" name="aktion" value="freigeben" />
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="zurueck" value={pfad} />
              <input type="hidden" name="fehlerweg" value={pfad} />
              <Button type="submit" variante="primary" data-cse="ausgabe-freigeben">
                {e.freigeben}
              </Button>
              <span className="ml-s3 text-xs text-text-muted">{e.freigebenErklaerung}</span>
            </form>
          ) : darf['buchhaltung.schreiben'] !== true ? (
            /*
             * **Kein Knopf, der in eine rohe Ausnahme führt** (V-128, AUT-06).
             * Buchen schreibt ins Hauptbuch: die Periode wird angelegt und als
             * `cse_app` zurückgelesen, und dafür verlangt 0127
             * `buchhaltung.lesen`/`.schreiben`. Ohne das Recht kam der Mensch
             * bis zum Klick und bekam dann „Die Periode liess sich weder
             * anlegen noch lesen" — ein 500, der „mein Fehler" sagt, wo „dir
             * fehlt ein Recht" die Wahrheit ist.
             */
            <p className="m-0 text-sm text-text-muted" data-cse="kein-buchungsrecht">
              {e.keinBuchungsrecht}{' '}
              <Recht schluessel="buchhaltung.schreiben" sprache={zugang.sprache} />.
            </p>
          ) : (
            <form method="post" action="/api/finanzen/ausgaben"
                  data-cse="ausgabe-buchen-form">
              <input type="hidden" name="aktion" value="buchen" />
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="zurueck" value={pfad} />
              <input type="hidden" name="fehlerweg" value={pfad} />
              <Button type="submit" variante="primary" data-cse="ausgabe-buchen">
                {e.buchen}
              </Button>
              <span className="ml-s3 text-xs text-text-muted">{e.buchenErklaerung}</span>
            </form>
          )}

          <form method="post" action="/api/finanzen/ausgaben"
                data-cse="ausgabe-ablehnen-form"
                className="flex flex-wrap items-end gap-s3 border-t border-line pt-s4">
            <input type="hidden" name="aktion" value="ablehnen" />
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="zurueck" value={pfad} />
            <input type="hidden" name="fehlerweg" value={pfad} />
            <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
              {e.ablehnenGrund}
              <input type="text" name="grund" required minLength={3} maxLength={500}
                     className="min-h-11 w-full rounded-md border border-line bg-surface
                                px-s3 py-s2 text-sm text-text"
                     data-cse="ausgabe-ablehnen-grund" />
            </label>
            <Button type="submit" variante="secondary" data-cse="ausgabe-ablehnen">
              {e.ablehnen}
            </Button>
          </form>
        </div>
      )}

      <h2 className="mb-s3 mt-s7 text-h2 text-text">{t.zustandsverlauf}</h2>
      <div className="rounded-lg border border-line bg-surface-2 p-s5 text-sm">
        <ul className="m-0 list-none space-y-s2 p-0">
          {FOLGE.map((von) => (
            <li
              key={von}
              className={`flex flex-wrap items-baseline gap-s3 ${
                von === a.status ? 'text-text' : 'text-text-muted'}`}
            >
              <StatusPill zustand={PILLE[von]} sprache={zugang.sprache} />
              <span className="text-xs">→ {t.folge[von]}</span>
              {von === a.status ? (
                <span className="text-xs font-semibold">{t.hier}</span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="m-0 mt-s3 max-w-prose text-xs text-text-muted">
          {t.uebergangErzwungenVor}
          <code>{AUSLOESER_AUSGABE_UEBERGANG}</code>
          {t.uebergangErzwungenMitte}{' '}
          <strong>{t.geloeschtWirdNichts}</strong> {t.uebergangErzwungenNach}{' '}
          <em>{t.gebuchtWort}</em> {t.abGebucht}
        </p>
      </div>
    </PortalRahmen>
  );
}
