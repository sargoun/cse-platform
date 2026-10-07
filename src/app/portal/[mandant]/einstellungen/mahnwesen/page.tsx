import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { mahnstufen, type Zinsberechnung } from '@/server/services/finanz/mahnung/stufen';
import { AUFSCHLAG_B2B_BP, AUFSCHLAG_B2C_BP }
  from '@/server/services/finanz/mahnung/stufen.platzhalter';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { vorbelegt } from '@/lib/formular/maske';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { tagDeutsch } from '@/lib/datum/kalendertag';
import { MAHNTEXT_HOECHSTENS } from '@/server/services/finanz/mahnung/stufen';
import {
  BASISZINS_AB_JAHR, QUELLE_VOREINSTELLUNG, basispunkteAlsProzent, leseBasiszinssaetze,
  leseDeckung, type BasiszinsZeile, type Deckung,
} from '@/server/services/finanz/mahnung/basiszinssatz';
import { gelesenerHinweis } from '@/server/rueckmeldung/hinweis-keks';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/einstellungen/mahnwesen` — der Ort, an dem O-19
 * beantwortet wird (FIN-15).
 *
 * **Solange eine Stufe „unbestätigt" trägt, mahnt der Lauf nicht.** Das ist
 * keine Sperre, die jemand vergessen hat, sondern die Antwort auf eine
 * Geschäftsregel, die niemand getroffen hat: Frist, Gebühr und Zinsart je
 * Stufe sind eine Entscheidung der Gesellschaft. Diese Seite nimmt sie
 * entgegen — und bis dahin sagt sie, was fehlt.
 *
 * **Eine bestätigte Fassung löst die vorherige ab, sie überschreibt sie
 * nicht.** Eine versendete Mahnung beruft sich auf die Stufe, wie sie GALT;
 * ohne die alte Fassung liesse sich ein geforderter Betrag nicht mehr
 * herleiten (Invariante 8).
 *
 * // TODO(client, O-19): Mahnstufen — Fristen, Gebühren je Stufe, Zinsart und
 * ab welcher Stufe eine Folgeaktion vorgesehen ist.
 */
export const dynamic = 'force-dynamic';

/**
 * Der Grund einer Abweisung (`?fehler=`), falls kein Satz mitkam — nur über
 * `eigenerEintrag()` nachgeschlagen, nie roh angezeigt (D-728).
 */
const FEHLER: Readonly<Record<string, string>> = {
  unvollstaendig: 'Die Stufe wurde nicht bestätigt: es fehlen Angaben.',
  ungueltig: 'Die Stufe wurde nicht bestätigt: eine Angabe ist ungültig.',
  ueberlappt: 'Die Stufe wurde nicht bestätigt: für diesen Tag gilt schon eine Fassung.',
  geld: 'Die Stufe wurde nicht bestätigt: die Gebühr ist kein Eurobetrag.',
};

/**
 * Die Zinsart in Worten (V-217) — die Tabelle zeigte den Schlüssel
 * (`gesetzlich_b2b`). Dieselben Worte wie die Auswahl im Formular.
 */
const ZINSART: Readonly<Record<Zinsberechnung, string>> = {
  keine: '—',
  gesetzlich_b2b: 'gesetzlich, Unternehmen',
  gesetzlich_b2c: 'gesetzlich, Verbraucher',
  vertraglich: 'vertraglich vereinbart',
};

/**
 * Der Rückweg des Basiszinssatzes (`?basiszins=`, V-299) — ein Schlüssel,
 * nachgeschlagen über `eigenerEintrag()`, nie roh angezeigt (D-728).
 */
const BASISZINS_MELDUNG: Readonly<Record<string, {
  readonly art: 'erfolg' | 'hinweis' | 'warnung'; readonly text: string;
}>> = {
  eingetragen: { art: 'erfolg', text: 'Der Basiszinssatz ist eingetragen.' },
  korrigiert: { art: 'erfolg', text: 'Der Basiszinssatz ist korrigiert — alter und neuer Wert stehen im Protokoll.' },
  unveraendert: { art: 'hinweis', text: 'Dieser Satz war für das Halbjahr schon so eingetragen — nichts geändert.' },
  halbjahr_ungueltig: { art: 'warnung', text: `Nicht eingetragen: das Halbjahr ist kein Kalenderhalbjahr ab ${String(BASISZINS_AB_JAHR)} bis zum nächsten Jahr.` },
  satz_ungueltig: { art: 'warnung', text: 'Nicht eingetragen: der Satz ist eine Prozentzahl mit höchstens zwei Nachkommastellen, etwa 1,27.' },
  satz_unplausibel: { art: 'warnung', text: 'Nicht eingetragen: der Satz liegt außerhalb von −10 % bis +20 % — bitte die Einheit prüfen.' },
  quelle_fehlt: { art: 'warnung', text: 'Nicht eingetragen: die Quelle fehlt.' },
  nur_super_admin: { art: 'warnung', text: 'Nicht eingetragen: den Basiszinssatz trägt die Super-Administration ein.' },
  ueberlappt: { art: 'warnung', text: 'Nicht eingetragen: für einen Tag dieses Halbjahres gilt schon ein anderer Satz.' },
};

/** „2027-01-01" → „1. Halbjahr 2027"; „2026-07-01" → „2. Halbjahr 2026". */
function halbjahrName(von: string): string {
  return `${von.slice(5, 7) === '01' ? '1.' : '2.'} Halbjahr ${von.slice(0, 4)}`;
}

export default async function Mahnwesen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const hinweis = await gelesenerHinweis(`/portal/${mandant}/einstellungen/mahnwesen`);
  /*
   * Eine Abweisung bringt die Eingaben zurück (V-214, D-599): erkannt an
   * `?fehler=`, und nur dann belegt die Maske ihre Felder aus der Adresse vor.
   */
  const abgewiesen = typeof suche['fehler'] === 'string';
  const fehlerText = abgewiesen ? (eigenerEintrag(FEHLER, suche['fehler']) ?? null) : null;
  const zurueck = (name: string): string | undefined =>
    (abgewiesen ? vorbelegt(suche, name) : undefined);
  const zugang = await portalZugang(`/portal/${mandant}/einstellungen/mahnwesen`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /**
   * Die Stufen UND der früheste Tag, an dem eine neue Fassung beginnen kann.
   *
   * Er kommt aus der Datenbank, nicht aus `new Date()`: die Uhr des
   * Node-Prozesses liest UTC und böte am 31.12. um 23:30 Berliner Zeit den
   * falschen Tag an (K-11, Invariante 2).
   */
  const darf = await haeltRechte(sitzung, 'system.referenzdaten_verwalten');
  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      stufen: await mahnstufen(kontext),
      tage: await kontext.abfrage<{ heute: string; morgen: string }>(
        `select app.berlin_heute()::text as heute,
                (app.berlin_heute() + 1)::text as morgen`),
      basiszins: await leseBasiszinssaetze(kontext),
      deckung: await leseDeckung(kontext),
      /* Dieselbe Frage, die die Policies von `basiszinssatz` stellen (0125). */
      superAdmin: (await kontext.abfrage<{ ja: boolean }>(
        `select app.ist_super_admin() as ja`))[0]?.ja === true,
    }))) as Promise<{
      stufen: Awaited<ReturnType<typeof mahnstufen>>;
      tage: readonly { heute: string; morgen: string }[];
      basiszins: readonly BasiszinsZeile[];
      deckung: Deckung;
      superAdmin: boolean;
    }>);
  const stufen = daten.stufen;
  const darfBasiszins = darf['system.referenzdaten_verwalten'] === true && daten.superAdmin;
  const basiszinsMeldung = eigenerEintrag(BASISZINS_MELDUNG, suche['basiszins']) ?? null;
  /* Vorgeschlagen wird die kommende Hälfte — die, nach der der Wächter fragt. */
  const vorschlagJahr = daten.deckung.naechsteAb.slice(0, 4);
  const vorschlagHaelfte = daten.deckung.naechsteAb.slice(5, 7) === '01' ? '1' : '2';
  const heute = daten.tage[0]?.heute ?? '';
  const morgen = daten.tage[0]?.morgen ?? '';

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const laufend = stufen.filter((s) => s.gueltigBis === null);
  const offen = laufend.filter((s) => s.istPlatzhalter).length;

  return (
    <PortalRahmen
      titel="Mahnwesen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Mahnwesen</h1>

      {fehlerText !== null && (typeof hinweis !== 'string' || hinweis === '') ? (
        <Hinweis art="warnung" rolle="alert" cse="stufen-fehler" className="mb-s5">
          {fehlerText}
        </Hinweis>
      ) : null}

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p
          data-cse="stufen-hinweis"
          className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text"
        >
          {hinweis}
        </p>
      ) : null}

      <p
        data-cse="stufen-offen"
        data-offen={String(offen)}
        className="mb-s7 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
      >
        {offen === 0
          ? 'Alle laufenden Stufen sind bestätigt. Der nächtliche Lauf schlägt danach '
            + 'Mahnungen vor — versendet wird weiterhin nichts ohne Freigabe.'
          : `${String(offen)} laufende Stufe(n) sind unbestätigt (O-19). Solange das so `
            + 'ist, erzeugt der Mahnlauf für sie keinen Vorschlag und nennt den Grund. '
            + 'Frist, Gebühr und Zinsart sind eine Entscheidung der Gesellschaft — sie '
            + 'werden hier eingetragen, nicht geraten.'}
      </p>

      <section aria-labelledby="stufen-titel" className="mb-s7">
        <h2 id="stufen-titel" className="mb-s3 text-h2 text-text">Stufen</h2>
        {stufen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Es ist keine Stufe hinterlegt.
          </p>
        ) : (
          <DataTable
            beschriftung="Mahnstufen mit Frist, Gebühr, Zinsart, Gültigkeit und Zustand"
            zeilen={[...stufen]}
            schluessel={(s) => s.id}
            spalten={[
              { schluessel: 'stufe', kopf: 'Stufe', zelle: (s) => String(s.stufe) },
              { schluessel: 'bez', kopf: 'Bezeichnung', zelle: (s) => s.bezeichnung },
              {
                schluessel: 'frist', kopf: 'Ab Tag', numerisch: true,
                zelle: (s) => String(s.tageNachFaelligkeit),
              },
              {
                schluessel: 'gebuehr', kopf: 'Gebühr', numerisch: true,
                zelle: (s) => formatiereGeld(s.gebuehrCent),
              },
              {
                schluessel: 'zins', kopf: 'Zins',
                zelle: (s) => ZINSART[s.zinsberechnung],
              },
              {
                schluessel: 'gueltig', kopf: 'Gültig',
                zelle: (s) => `${tagDeutsch(s.gueltigAb)} – ${
                  s.gueltigBis === null ? 'offen' : tagDeutsch(s.gueltigBis)}`,
              },
              {
                /* V-214: ob die Fassung einen Brieftext trägt. */
                schluessel: 'mahntext', kopf: 'Mahntext',
                zelle: (s) => (s.textbaustein === null ? 'nicht hinterlegt' : 'hinterlegt'),
              },
              {
                schluessel: 'zustand', kopf: 'Zustand',
                zelle: (s) => (
                  s.gueltigBis !== null
                    ? <StatusPill zustand="Archiviert" />
                    : s.istPlatzhalter
                      ? <StatusPill zustand="Entwurf" />
                      : <StatusPill zustand="Aktiv" />
                ),
              },
            ]}
          />
        )}
      </section>

      <section
        aria-labelledby="bestaetigen-titel"
        className="max-w-prose rounded-lg border border-line bg-surface p-s5"
      >
        <h2 id="bestaetigen-titel" className="text-h2 text-text">Stufe bestätigen</h2>
        <p className="mt-s2 text-xs text-text-muted">
          Die neue Fassung gilt ab dem angegebenen Tag; die bisherige endet am
          Tag davor und bleibt lesbar.
        </p>
        <form method="post" action={`/api/einstellungen/mahnwesen?mandant=${mandant}`}>
          <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-text" htmlFor="stufe">Stufe</label>
              <input
                id="stufe" name="stufe" type="number" min={1} step={1} required
                className={feld} defaultValue={zurueck('stufe') ?? 1}
              />
            </div>
            <div>
              <label className="block text-sm text-text" htmlFor="tage">
                Greift ab Tag nach Fälligkeit
              </label>
              <input
                id="tage" name="tage" type="number" min={0} step={1} required
                className={feld} defaultValue={zurueck('tage') ?? 14}
              />
            </div>
          </div>

          <label className="mt-s4 block text-sm text-text" htmlFor="bezeichnung">
            Bezeichnung
          </label>
          <input
            id="bezeichnung" name="bezeichnung" type="text" required className={feld}
            placeholder="Zahlungserinnerung" defaultValue={zurueck('bezeichnung')}
          />

          <label className="mt-s4 block text-sm text-text" htmlFor="gebuehr">
            Mahngebühr in Euro
          </label>
          <input
            id="gebuehr" name="gebuehr" type="text" inputMode="decimal" required
            className={feld} placeholder="0,00" defaultValue={zurueck('gebuehr')}
          />

          <label className="mt-s4 block text-sm text-text" htmlFor="zinsberechnung">
            Verzugszins
          </label>
          <select id="zinsberechnung" name="zinsberechnung" required className={feld}
                  defaultValue={zurueck('zinsberechnung') ?? 'keine'}>
            <option value="keine">kein Verzugszins</option>
            <option value="gesetzlich_b2b">
              gesetzlich, Unternehmen (Basiszins + {String(AUFSCHLAG_B2B_BP / 100)} Punkte)
            </option>
            <option value="gesetzlich_b2c">
              gesetzlich, Verbraucher (Basiszins + {String(AUFSCHLAG_B2C_BP / 100)} Punkte)
            </option>
            <option value="vertraglich">vertraglich vereinbart</option>
          </select>

          <label className="mt-s4 block text-sm text-text" htmlFor="aufschlag">
            Vereinbarter Aufschlag in Basispunkten (nur bei „vertraglich“)
          </label>
          <input
            id="aufschlag" name="aufschlag" type="number" min={0} step={1} className={feld}
            defaultValue={zurueck('aufschlag')}
          />

          {/*
            * **Die Folgeaktion** (V-098).
            *
            * `bestaetigeStufe` nimmt sie seit je entgegen und
            * `mahn_folgeaktion` kennt die vier Werte seit `0125` — das
            * Formular schickte keine, also stand jede Stufe auf „keine". Die
            * Liste zeigte die Spalte trotzdem an, und was dort stand, war
            * nicht das, was jemand entschieden hatte, sondern der
            * Vorgabewert der Spalte.
            *
            * **Welche Aktion zu welcher Stufe gehört, entscheidet ein Mensch
            * und nicht dieses Formular.** Ein Vorgabewert ausser „keine" wäre
            * eine erfundene Eskalationsregel — und die drei anderen sind
            * ernst: ein Lieferstopp trifft den laufenden Auftrag, ein
            * Mahnbescheid ist ein gerichtliches Verfahren.
            */}
          <label className="mt-s4 block text-sm text-text" htmlFor="folgeaktion">
            Folgeaktion dieser Stufe
          </label>
          <select id="folgeaktion" name="folgeaktion" required className={feld}
                  defaultValue={zurueck('folgeaktion') ?? 'keine'}>
            <option value="keine">keine</option>
            <option value="lieferstopp">Lieferstopp</option>
            <option value="inkasso">Inkasso</option>
            <option value="mahnbescheid">Mahnbescheid</option>
          </select>
          <p className="mt-s2 text-xs text-text-muted">
            Die Plattform LÖST sie nicht aus — sie hält fest, was auf dieser
            Stufe vereinbart ist. Ein Lieferstopp trifft den laufenden Auftrag,
            ein Mahnbescheid ist ein gerichtliches Verfahren; beides tut ein
            Mensch.
          </p>

          <label className="mt-s4 block text-sm text-text" htmlFor="gueltigAb">
            Gültig ab
          </label>
          <input
            id="gueltigAb" name="gueltigAb" type="date" required className={feld}
            min={heute} defaultValue={zurueck('gueltigAb') ?? morgen}
          />
          <p className="mt-s2 text-xs text-text-muted">
            Vorgeschlagen ist der morgige Tag: solange für diese Stufe eine
            Fassung läuft, beginnt die neue am Tag danach. Rückwirkend ginge
            sie nicht — sie änderte die Grundlage bereits versendeter
            Mahnungen.
          </p>

          {/*
            * **Der Mahntext** (V-214).
            *
            * `mahnstufe.textbaustein` gab es seit `0125`, die Vorlagenseite
            * zeigte ihn als „Mahntext je Stufe“ und sagte, er werde hier
            * gepflegt — hier stand kein Feld, kein Weg schrieb ihn, und der
            * Mahnungsdienst las ihn nicht. Das Schreiben war eine Liste von
            * Beträgen ohne jeden Brieftext.
            *
            * **Kein vorgeschlagener Wortlaut.** Was eine Zahlungserinnerung
            * oder eine letzte Mahnung sagt, entscheidet die Gesellschaft; ein
            * Platzhaltertext, der eine Frist androht oder ein gerichtliches
            * Verfahren ankündigt, wäre eine erfundene Erklärung in ihrem Namen.
            */}
          <label className="mt-s4 block text-sm text-text" htmlFor="textbaustein">
            Mahntext dieser Stufe
          </label>
          <textarea
            id="textbaustein" name="textbaustein" rows={6} maxLength={MAHNTEXT_HOECHSTENS}
            className={feld} defaultValue={zurueck('textbaustein')}
            data-cse="stufen-mahntext"
          />
          <p className="mt-s2 text-xs text-text-muted">
            Er steht im Schreiben zwischen Datum und Forderungsliste, so wie Sie
            ihn hier eintragen — höchstens {String(MAHNTEXT_HOECHSTENS)} Zeichen.
            Leer gelassen, übernimmt die neue Fassung den Mahntext der laufenden
            Fassung dieser Stufe, wenn diese bestätigt ist. Der Text einer
            unbestätigten Platzhalterfassung wird nicht übernommen.
          </p>
          <label className="mt-s2 flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="ohneMahntext" value="1"
              defaultChecked={zurueck('ohneMahntext') === '1'} />
            Diese Fassung ohne Mahntext
          </label>

          <p className="mt-s4 text-xs text-text-muted">
            Der Basiszinssatz nach § 247 BGB wird nicht in der Stufe gepflegt: er ist
            eine halbjährliche Bekanntmachung der Deutschen Bundesbank und gilt für alle
            Gesellschaften — eingetragen unten im Abschnitt „Basiszinssatz“. Fehlt der
            Satz, fordert eine Mahnung keinen Zins und sagt es.
          </p>

          <button
            type="submit"
            className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
          >
            Stufe bestätigen
          </button>
        </form>
      </section>

      <section id="basiszins" aria-labelledby="basiszins-titel" data-cse="basiszins" className="mt-s7">
        <h2 id="basiszins-titel" className="mb-s3 text-h2 text-text">Basiszinssatz (§ 247 BGB)</h2>
        {basiszinsMeldung !== null ? (
          <Hinweis art={basiszinsMeldung.art} rolle={basiszinsMeldung.art === 'warnung' ? 'alert' : 'status'}
                   cse="basiszins-meldung" className="mb-s4">
            {basiszinsMeldung.text}
          </Hinweis>
        ) : null}
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Er ändert sich zum 1. Januar und zum 1. Juli und gilt für alle Gesellschaften.
          Voreinstellung (O-358): zentral für die Gruppe eingetragen von der
          Super-Administration, je Halbjahr nach der Bekanntmachung der Deutschen
          Bundesbank. Der Wächter lässt am 15. Juni und 15. Dezember seinen Lauf
          scheitern, wenn die kommende Hälfte fehlt, und benachrichtigt niemanden eigens.
        </p>
        <ul data-cse="basiszins-deckung" className="mb-s4 grid max-w-prose gap-s2 text-sm text-text">
          <li data-gedeckt={String(daten.deckung.heute !== null)}>
            Heute:{' '}
            {daten.deckung.heute === null
              ? 'kein Satz — eine Mahnung fordert keinen Verzugszins und sagt es.'
              : basispunkteAlsProzent(daten.deckung.heute)}
          </li>
          <li data-gedeckt={String(daten.deckung.naechste !== null)}>
            Ab {tagDeutsch(daten.deckung.naechsteAb)}:{' '}
            {daten.deckung.naechste === null
              ? 'noch kein Satz eingetragen.'
              : basispunkteAlsProzent(daten.deckung.naechste)}
          </li>
        </ul>
        {daten.basiszins.length > 0 ? (
          <div data-cse="basiszins-liste" className="mb-s5">
            <DataTable
              beschriftung="Eingetragene Basiszinssätze"
              zeilen={daten.basiszins}
              schluessel={(z) => z.id}
              spalten={[
                { schluessel: 'halbjahr', kopf: 'Halbjahr', zelle: (z) => (
                  z.bis === null ? `ab ${tagDeutsch(z.von)}` : halbjahrName(z.von)) },
                { schluessel: 'satz', kopf: 'Satz', zelle: (z) => basispunkteAlsProzent(z.satzBp) },
                { schluessel: 'quelle', kopf: 'Quelle', zelle: (z) => z.quelle },
              ]}
            />
          </div>
        ) : null}
        {darfBasiszins ? (
          <form method="post" action="/api/finanzen/basiszinssatz" data-cse="basiszins-formular"
                className="max-w-prose rounded-lg border border-line bg-surface p-s5">
            <div className="grid grid-cols-1 gap-s4 md:grid-cols-2">
              <label className="block text-sm text-text" htmlFor="basiszins-jahr">
                Jahr
                <input id="basiszins-jahr" name="jahr" inputMode="numeric" required
                  pattern="[0-9]{4}" defaultValue={vorschlagJahr} className={feld} />
              </label>
              <label className="block text-sm text-text" htmlFor="basiszins-haelfte">
                Halbjahr
                <select id="basiszins-haelfte" name="haelfte" defaultValue={vorschlagHaelfte}
                  className={feld}>
                  <option value="1">1. Halbjahr (ab 1. Januar)</option>
                  <option value="2">2. Halbjahr (ab 1. Juli)</option>
                </select>
              </label>
              <label className="block text-sm text-text" htmlFor="basiszins-satz">
                Satz in Prozent
                <input id="basiszins-satz" name="satz" required inputMode="decimal"
                  placeholder="z. B. 1,27" className={feld} />
              </label>
              <label className="block text-sm text-text" htmlFor="basiszins-quelle">
                Quelle
                <input id="basiszins-quelle" name="quelle" required maxLength={200}
                  defaultValue={QUELLE_VOREINSTELLUNG} className={feld} />
              </label>
            </div>
            <p className="mt-s3 text-xs text-text-muted">
              Wie bekanntgegeben, mit höchstens zwei Nachkommastellen; ein negativer Satz
              wird mit Minus eingetragen. Ein schon eingetragenes Halbjahr wird korrigiert,
              und das Protokoll nennt alten und neuen Wert.
            </p>
            <button
              type="submit"
              className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
            >
              Basiszinssatz eintragen
            </button>
          </form>
        ) : (
          <p data-cse="basiszins-nur-lesen" className="max-w-prose text-sm text-text-muted">
            Eingetragen wird er von der Super-Administration (Recht{' '}
            <Recht schluessel="system.referenzdaten_verwalten" />, mit zweitem Faktor);
            hier steht, was gilt.
          </p>
        )}
      </section>
    </PortalRahmen>
  );
}
