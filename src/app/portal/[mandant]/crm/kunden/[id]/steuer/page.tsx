import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import {
  alsStatusZeilen, bescheinigungAm, leseSteuerblatt, type Steuerblatt,
} from '@/server/services/finanz/kunde-steuer';
import { reverseChargeLage } from '@/server/services/finanz/steuer/nachweis';
import {
  FORMATE, FORMAT_TEXT, WEGE, WEG_TEXT, versandLage, wegVerbunden,
  type Rechnungsformat, type Uebertragungsweg,
} from '@/server/services/crm/erechnung';
import { versandwege, type Versandweg } from '@/server/services/finanz/versand';
import { tagDeutsch } from '@/lib/datum/kalendertag';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { Unternavigation } from '../Unternavigation';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/crm/kunden/[id]/steuer` — die steuerlichen Angaben eines
 * Kunden (FIN-09, FIN-10, FIN-11, LEG-05, LEG-06).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Das Tor der Route (`abrechnung.lesen`) trägt diese Seite NIE allein.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sie ist eine Unterseite des Kundenblatts und braucht zuerst die
 * `kunde`-Zeile; deren Policy `t_mandant` verlangt zum Lesen `crm.lesen`.
 * Wer nur `abrechnung.lesen` hält, bekommt die Zeile überhaupt nicht — und
 * das Hausmuster antwortet dann mit 404 auf einen Kunden, der existiert. Die
 * beiden §13b-/§48b-Tabellen verlangen zusätzlich `finanzen.lesen`.
 *
 * Das ist ein Widerspruch zwischen `routen.generiert.ts` und der RLS, und er
 * wird hier BENANNT statt umschifft: fehlt `finanzen.lesen`, stehen die
 * Blöcke mit dem Satz da, welches Recht fehlt — nicht als leere Liste. Eine
 * leere §13b-Liste ist eine Aussage über den KUNDEN („kein Status, also
 * Umsatzsteuer ausweisen"), nicht über die Berechtigung, und genau die kostet
 * Geld.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Seite RECHNET nicht. Sie fragt die geprüften Funktionen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §13b: `reverseChargeLage(zeilen, stichtag, leistungsart)` — rein, geprüft,
 * dieselbe Funktion, die die Rechnung fragt. §48b: `bescheinigungAm(zeilen,
 * stichtag)`, und zwar AM LEISTUNGSDATUM, nicht heute. FIN-11:
 * `versandLage(kaeufer)` — ein Pflichtkäufer ohne Übertragungsweg sperrt den
 * Versand statt auf E-Mail zurückzufallen (07-INTEGRATIONEN §12.1).
 */
export const dynamic = 'force-dynamic';

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

const ART_TEXT: Readonly<Record<string, string>> = {
  bau: 'Bauleistungen (§ 13b Abs. 2 Nr. 4 UStG)',
  gebaeudereinigung: 'Gebäudereinigung (§ 13b Abs. 2 Nr. 8 UStG)',
};

interface Kopf {
  readonly id: string;
  readonly name: string;
  readonly kundennummer: string;
  readonly typ: string;
}

export default async function Steuer(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<{ meldung?: string; erfolg?: string; stichtag?: string }>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/crm/kunden/${id}/steuer`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const darf = await haeltRechte(sitzung,
    'crm.lesen', 'crm_entgelt.lesen', 'abrechnung.lesen', 'system.benutzer_verwalten',
    'dokument.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select k.id, k.name, k.kundennummer, k.typ::text as typ
           from kunde k
          where k.mandant_id = app.aktiver_mandant() and k.id = $1::uuid
            and k.archiviert_am is null`, [id]);
      if (kopf === undefined) return null;
      const blatt = await leseSteuerblatt(kontext, id);
      if (blatt === null) return null;
      /* Derselbe Schlüssel, den der Auslöser 0181 prüft — siehe unten. */
      return { kopf, blatt, wege: await versandwege(kontext) };
    })) as Promise<{
      kopf: Kopf; blatt: Steuerblatt; wege: readonly Versandweg[];
    } | null>);

  if (daten === null) notFound();
  const { kopf, blatt } = daten;

  /*
   * Der Stichtag kommt aus der Adresse oder ist der heutige Berliner Tag —
   * und der kommt aus der DATENBANK. `new Date()` läse die Uhr des
   * Node-Prozesses in UTC und zeigte zwischen Mitternacht und 02:00 den
   * Vortag (K-11, Invariante 2).
   */
  const stichtag = /^\d{4}-\d{2}-\d{2}$/u.test(suche.stichtag ?? '')
    ? (suche.stichtag as string)
    : blatt.heute;

  const zeilen = alsStatusZeilen(blatt.bauleistender);
  const lagen = (['bau', 'gebaeudereinigung'] as const).map((art) => ({
    art, lage: reverseChargeLage(zeilen, stichtag, art),
  }));
  const bescheinigung = bescheinigungAm(blatt.bescheinigungen, stichtag);

  /*
   * Der Postausgang wird GEFRAGT, nicht behauptet — und zwar an DERSELBEN
   * Stelle, die auch die Rechnung fragt.
   *
   * `versandwege()` liest `versand.email.verbunden` aus `mandant_einstellung`;
   * denselben Schlüssel prüft der Auslöser `rechnung_versand_2_kanal_
   * verbunden` (0181), bevor er eine Versandzeile annimmt. `erechnung.ts`
   * führte `email` daneben als „braucht keinen Anschluss" und liess dieses
   * Blatt „Versand bereit" zeigen für einen Kanal, den die Datenbank bei
   * jedem Versuch abweist. Zwei Wahrheiten über einen Anschluss, und die
   * freundlichere stand auf dem Bildschirm.
   */
  const emailWeg = daten.wege.find((w: Versandweg) => w.kanal === 'email');
  const umgebung = { postausgangVerbunden: emailWeg?.verbunden === true };

  const versand = versandLage({
    xrechnungPflicht: blatt.kopf.xrechnung_pflicht,
    istOeffentlicherAuftraggeber: blatt.kopf.ist_oeffentlicher_auftraggeber,
    leitwegId: blatt.kopf.leitweg_id,
    kaeuferReferenz: blatt.kopf.kaeufer_referenz,
    elektronischeAdresse: blatt.kopf.elektronische_adresse,
    elektronischeAdresseSchema: blatt.kopf.elektronische_adresse_schema,
    uebertragungsweg: blatt.kopf.uebertragungsweg,
    rechnungsformat: blatt.kopf.rechnungsformat,
    rechnungEmail: blatt.kopf.rechnung_email,
  }, umgebung);

  const VERSAND_PILLE = {
    gesperrt: 'Fehler', offen: 'Wartet', bereit: 'Bereit', nicht_verbunden: 'Inaktiv',
  } as const;

  return (
    <PortalRahmen
      titel="Steuer"
      wurzelTitel="CRM"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="crm"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/crm/kunden`, text: 'Alle Kunden' }}
    >
      <h1 className="mb-s3 text-h1 text-text">{kopf.name}</h1>
      <Unternavigation mandant={mandant} kundeId={id} aktiv="steuer" rechte={darf} />

      {typeof suche.meldung === 'string' && suche.meldung !== '' ? (
        <Hinweis art="warnung" cse="steuer-meldung" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong> {suche.meldung}
        </Hinweis>
      ) : null}
      {typeof suche.erfolg === 'string' && suche.erfolg !== '' ? (
        <Hinweis art="erfolg" cse="steuer-erfolg" className="mb-s5 max-w-prose">
          {suche.erfolg}
        </Hinweis>
      ) : null}

      {/* -------------------------------------------------- Stichtag */}
      <form method="get" action={pfad} className="mb-s6 flex flex-wrap items-end gap-s3">
        <label className="flex flex-col gap-s2 text-sm text-text">
          Stichtag der Leistung
          <input type="date" name="stichtag" defaultValue={stichtag} className={FELD}
                 data-cse="steuer-stichtag" />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Zu diesem Tag prüfen
        </button>
        <p className="m-0 max-w-prose text-xs text-text-muted">
          <strong>Nicht „heute".</strong> §13b und §48b werden am
          LEISTUNGSDATUM beurteilt: ein Kunde, der seit letztem Monat kein
          Bauleistender mehr ist, war es im August — und eine Rechnung über August muss
          das tragen. Welcher Tag gilt, wenn der Leistungszeitraum eine Statusgrenze
          überschreitet, ist offen (O-21).
        </p>
      </form>

      {/* -------------------------------------- (a) Steuerliche Identität */}
      <section aria-labelledby="identitaet" className="mb-s7">
        <h2 id="identitaet" className="text-h2 text-text">Steuerliche Identität</h2>
        <dl className="m-0 mt-s3 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-text-muted">USt-IdNr. (BT-48)</dt>
            <dd className="m-0 mt-s1 text-sm text-text tabular-nums" data-cse="steuer-ustid">
              {blatt.kopf.ust_id ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Steuernummer</dt>
            <dd className="m-0 mt-s1 text-sm text-text tabular-nums">
              {blatt.kopf.steuernummer ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Art</dt>
            <dd className="m-0 mt-s1 text-sm text-text">
              {blatt.kopf.ist_oeffentlicher_auftraggeber
                ? 'öffentlicher Auftraggeber'
                : kopf.typ}
            </dd>
          </div>
        </dl>
        <p className="mt-s3 max-w-prose text-xs text-text-muted">
          Gepflegt werden diese beiden im Kundenstamm. Eine Prüfung gegen VIES findet
          NICHT statt: §13b und §48 EStG werden aus datierten Nachweisen entschieden,
          nie aus einem Abruf (07-INTEGRATIONEN §12.4).
        </p>
      </section>

      {/* -------------------------------------- (b) Elektronische Rechnung */}
      <section aria-labelledby="erechnung" className="mb-s7">
        <h2 id="erechnung" className="text-h2 text-text">
          Elektronische Rechnung (FIN-11)
        </h2>

        <div className="mt-s3 rounded-lg border border-line bg-surface p-s5"
             data-cse="steuer-versand" data-art={versand.art}>
          <p className="m-0 flex flex-wrap items-center gap-s3">
            <StatusPill zustand={VERSAND_PILLE[versand.art]} />
            <span className="text-sm text-text">{versand.text}</span>
          </p>
          {versand.fehlend.length === 0 ? null : (
            <ul className="m-0 mt-s4 list-none space-y-s3 p-0" data-cse="steuer-fehlend">
              {versand.fehlend.map((f) => (
                <li key={f.bt + f.feld} className="rounded-md border border-line bg-surface-2 p-s4">
                  <p className="m-0 flex flex-wrap items-baseline gap-s3">
                    <span className="text-sm font-semibold text-danger">{f.bt}</span>
                    <span className="text-xs text-text-muted">{f.regel}</span>
                  </p>
                  <p className="m-0 mt-s2 max-w-prose text-sm text-text">{f.text}</p>
                  <p className="m-0 mt-s2 text-xs text-text-muted">
                    Zu pflegen unter {f.feld}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <dl className="m-0 mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-text-muted">Leitweg-ID (BT-10)</dt>
            <dd className="m-0 mt-s1 text-sm text-text tabular-nums" data-cse="steuer-leitweg">
              {blatt.kopf.leitweg_id ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Käuferreferenz (BT-10)</dt>
            <dd className="m-0 mt-s1 text-sm text-text">
              {blatt.kopf.kaeufer_referenz ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">
              Elektronische Adresse (BT-49 / BT-49-1)
            </dt>
            <dd className="m-0 mt-s1 text-sm text-text">
              {blatt.kopf.elektronische_adresse ?? '—'}
              {blatt.kopf.elektronische_adresse_schema === null ? null : (
                <span className="block text-xs text-text-muted">
                  Schema {blatt.kopf.elektronische_adresse_schema}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Übertragungsweg</dt>
            <dd className="m-0 mt-s1 text-sm text-text" data-cse="steuer-weg">
              {blatt.kopf.uebertragungsweg === null
                ? 'nicht verabredet (O-22)'
                : WEG_TEXT[blatt.kopf.uebertragungsweg]}
              {blatt.kopf.uebertragungsweg !== null
                && !wegVerbunden(blatt.kopf.uebertragungsweg, umgebung) ? (
                  <span className="block text-xs text-warning" data-cse="steuer-weg-unverbunden">
                    nicht verbunden
                  </span>
                ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Rechnungsformat</dt>
            <dd className="m-0 mt-s1 text-sm text-text">
              {blatt.kopf.rechnungsformat === null
                ? 'nicht verabredet (O-22)'
                : FORMAT_TEXT[blatt.kopf.rechnungsformat]}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">XRechnung verlangt</dt>
            <dd className="m-0 mt-s1 text-sm text-text">
              {blatt.kopf.xrechnung_pflicht ? 'ja' : 'nein'}
            </dd>
          </div>
        </dl>

        <p className="mt-s4 max-w-prose text-xs text-text-muted">
          <strong>Peppol, ZRE und OZG-RE sind nicht verbunden.</strong> Es sind keine
          Zugangsdaten hinterlegt und kein Anschluss gebaut (O-22). Die Schnittstelle
          steht, das Dokument entsteht und ist herunterladbar — übermittelt wird bis auf
          Weiteres von Hand. Ein Versand, der „erfolgreich" meldet, ohne dass etwas
          ankommt, wäre der teuerste Fehler dieser Seite: die Zahlungsfrist läuft, und
          der Mahnlauf mahnt einen Beleg an, den niemand erhalten hat.
        </p>
        {umgebung.postausgangVerbunden ? null : (
          <p className="mt-s3 max-w-prose text-xs text-text-muted"
             data-cse="steuer-postausgang">
            <strong>Auch E-Mail ist kein Anschluss dieser Installation.</strong>{' '}
            {emailWeg?.grund
              ?? 'Für den Kanal „E-Mail" ist keine Verbindung hinterlegt.'} Der Weg
            „E-Mail" darf deshalb verabredet werden — er steht dann als{' '}
            <em>nicht verbunden</em> und nie als <em>bereit</em>. Kundenportal und Post
            brauchen keinen Anschluss: dort bedient ein Mensch den Weg.
          </p>
        )}

        {blatt.rechte.crmSchreiben ? (
          <details className="mt-s5" data-cse="steuer-erechnung-aendern">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text">
              Rechnungsangaben ändern
            </summary>
            <form
              method="post" action="/api/crm/kunde/steuer"
              data-cse="steuer-erechnung-formular"
              className="mt-s4 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
            >
              <input type="hidden" name="was" value="erechnung" />
              <input type="hidden" name="kundeId" value={id} />
              <input type="hidden" name="zurueck" value={pfad} />

              <label className="flex flex-col gap-s2 text-sm text-text">
                Leitweg-ID
                <input name="leitwegId" className={FELD}
                       defaultValue={blatt.kopf.leitweg_id ?? ''}
                       data-cse="steuer-leitweg-feld" />
                <span className="text-xs text-text-muted">
                  Der CHECK <code className="text-text">kunde_leitweg_form</code> nimmt
                  Ziffern, Buchstaben, Doppelpunkt, Punkt und Bindestrich, 3 bis 46
                  Zeichen.
                </span>
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Käuferreferenz
                <input name="kaeuferReferenz" className={FELD}
                       defaultValue={blatt.kopf.kaeufer_referenz ?? ''} />
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Elektronische Adresse
                <input name="elektronischeAdresse" className={FELD}
                       defaultValue={blatt.kopf.elektronische_adresse ?? ''} />
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Schema der elektronischen Adresse
                <input name="elektronischeAdresseSchema" className={FELD}
                       defaultValue={blatt.kopf.elektronische_adresse_schema ?? ''}
                       placeholder="0204" />
                <span className="text-xs text-text-muted">
                  <code className="text-text">0204</code> für die Leitweg-ID,
                  <code className="text-text"> EM</code> für E-Mail,
                  <code className="text-text"> 0088</code> für eine GLN. Eine Adresse
                  ohne Schema ist nicht auflösbar.
                </span>
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Übertragungsweg
                <select name="uebertragungsweg" className={FELD}
                        defaultValue={blatt.kopf.uebertragungsweg ?? ''}
                        data-cse="steuer-weg-feld">
                  <option value="">nicht verabredet</option>
                  {WEGE.map((w: Uebertragungsweg) => (
                    <option key={w} value={w}>
                      {WEG_TEXT[w]}
                      {wegVerbunden(w, umgebung) ? '' : ' — nicht verbunden'}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-text-muted">
                  Leer heisst „nicht verabredet" und NICHT „E-Mail". Ein Pflichtkäufer
                  ohne Weg sperrt den Versand, statt auf einen Kanal zurückzufallen
                  (O-22).
                </span>
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Rechnungsformat
                <select name="rechnungsformat" className={FELD}
                        defaultValue={blatt.kopf.rechnungsformat ?? ''}>
                  <option value="">nicht verabredet</option>
                  {FORMATE.map((f: Rechnungsformat) => (
                    <option key={f} value={f}>{FORMAT_TEXT[f]}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-s2 text-sm text-text">
                <input type="checkbox" name="xrechnungPflicht" value="1"
                       defaultChecked={blatt.kopf.xrechnung_pflicht}
                       data-cse="steuer-pflicht-feld" />
                Dieser Käufer verlangt eine XRechnung
              </label>
              <button
                type="submit" data-cse="steuer-erechnung-speichern"
                className="min-h-11 self-start rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover"
              >
                Rechnungsangaben speichern
              </button>
            </form>
          </details>
        ) : null}
      </section>

      {/* -------------------------------------- (c) §13b-Nachweis */}
      <section aria-labelledby="dreizehnb" className="mb-s7">
        <h2 id="dreizehnb" className="text-h2 text-text">
          § 13b UStG — Steuerschuldnerschaft des Leistungsempfängers
        </h2>

        {!blatt.rechte.finanzenLesen ? (
          <Hinweis art="warnung" cse="steuer-13b-verdeckt" className="mt-s3 max-w-prose">
            <strong>Die §13b-Zeitscheiben sind Ihnen nicht sichtbar.</strong> Dafür
            fehlt <Recht schluessel="finanzen.lesen" /> — das Tor dieser
            Route (<Recht schluessel="abrechnung.lesen" />) deckt die
            Tabelle nicht. <strong>Das heisst NICHT, dass kein Status hinterlegt
            ist.</strong> Eine leere Liste hier wäre die Aussage „Umsatzsteuer
            ausweisen", und die wäre möglicherweise falsch.
          </Hinweis>
        ) : (
          <>
            <div className="mt-s3 grid grid-cols-1 gap-s4 sm:grid-cols-2"
                 data-cse="steuer-13b-lage">
              {lagen.map(({ art, lage }) => (
                <div key={art} className="rounded-lg border border-line bg-surface p-s5"
                     data-cse="steuer-13b-fall" data-art={art}
                     data-greift={String(lage.greift)}>
                  <p className="m-0 flex flex-wrap items-center gap-s3">
                    <StatusPill zustand={lage.greift ? 'Aktiv' : 'Inaktiv'} />
                    <span className="text-sm font-semibold text-text">
                      {ART_TEXT[art] ?? art}
                    </span>
                  </p>
                  <p className="m-0 mt-s3 max-w-prose text-sm text-text">{lage.grund}</p>
                  {lage.hinweis === null ? null : (
                    <p className="m-0 mt-s3 text-sm text-text">
                      Pflichthinweis auf der Rechnung (§ 14a Abs. 5 UStG):{' '}
                      <em className="text-text">„{lage.hinweis}"</em>
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-s3 max-w-prose text-xs text-text-muted">
              Diese Antwort kommt aus{' '}
              <code className="text-text">reverseChargeLage</code> — derselben
              geprüften Funktion, die auch die Rechnung fragt. Die Seite rechnet
              nichts.
            </p>

            {blatt.bauleistender.length === 0 ? (
              <p className="mt-s4 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Für diesen Kunden ist keine Zeitscheibe hinterlegt. Ohne Nachweis wird
                die Umsatzsteuer ausgewiesen — die sichere Richtung: zu Unrecht
                ausgewiesene Steuer wird geschuldet (§ 14c UStG) und ist korrigierbar,
                eine zu Unrecht verlagerte ist beim Empfänger ein Ausfall.
              </p>
            ) : (
              <div className="mt-s4">
                <DataTable
                  beschriftung="Zeitscheiben des §13b-Status je Leistungsart"
                  zeilen={blatt.bauleistender}
                  schluessel={(z) => z.id}
                  spalten={[
                    {
                      schluessel: 'art', kopf: 'Leistungsart',
                      zelle: (z) => ART_TEXT[z.leistungsart] ?? z.leistungsart,
                    },
                    {
                      schluessel: 'status', kopf: 'Bauleistender',
                      zelle: (z) => (
                        <StatusPill zustand={z.ist_bauleistender ? 'Aktiv' : 'Abgelehnt'} />
                      ),
                    },
                    {
                      schluessel: 'ab', kopf: 'Gilt ab',
                      zelle: (z) => (
                        <span className="tabular-nums">{tagDeutsch(z.gilt_ab)}</span>
                      ),
                    },
                    {
                      schluessel: 'bis', kopf: 'Gilt bis',
                      zelle: (z) => (
                        <span className="tabular-nums">
                          {z.gilt_bis === null ? 'offen' : tagDeutsch(z.gilt_bis)}
                        </span>
                      ),
                    },
                    { schluessel: 'grundlage', kopf: 'Grundlage', zelle: (z) => z.grundlage },
                  ]}
                />
              </div>
            )}

            {blatt.rechte.finanzenSchreiben ? (
              <details className="mt-s5" data-cse="steuer-13b-anlegen">
                <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text">
                  Zeitscheibe hinzufügen
                </summary>
                <form
                  method="post" action="/api/crm/kunde/steuer"
                  data-cse="steuer-13b-formular"
                  className="mt-s4 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
                >
                  <input type="hidden" name="was" value="bauleistender" />
                  <input type="hidden" name="kundeId" value={id} />
                  <input type="hidden" name="zurueck" value={pfad} />

                  <label className="flex flex-col gap-s2 text-sm text-text">
                    Leistungsart
                    <select name="leistungsart" required className={FELD}
                            data-cse="steuer-13b-art">
                      <option value="bau">{ART_TEXT['bau']}</option>
                      <option value="gebaeudereinigung">
                        {ART_TEXT['gebaeudereinigung']}
                      </option>
                    </select>
                    <span className="text-xs text-text-muted">
                      Nur diese zwei. Welche weiteren Tatbestände des § 13b Abs. 2 UStG
                      die Gruppe berühren, ist offen (O-104) — ein dritter Wert wäre eine
                      Geschäftsregel, die niemand getroffen hat.
                    </span>
                  </label>
                  <fieldset className="m-0 flex flex-col gap-s2 border-0 p-0">
                    <legend className="mb-s2 p-0 text-sm font-semibold text-text">
                      Ist der Kunde in diesem Zeitraum Bauleistender?
                    </legend>
                    <label className="flex items-center gap-s2 text-sm text-text">
                      <input type="radio" name="istBauleistender" value="1" required
                             data-cse="steuer-13b-ja" />
                      Ja — die Steuerschuld geht über
                    </label>
                    <label className="flex items-center gap-s2 text-sm text-text">
                      <input type="radio" name="istBauleistender" value="0" required />
                      Nein — ausdrücklich nicht
                    </label>
                    <p className="m-0 mt-s2 text-xs text-text-muted">
                      Ein ausdrückliches „nein" ist mehr als eine fehlende Zeile: es
                      dokumentiert, dass gefragt wurde.
                    </p>
                  </fieldset>
                  <div className="flex flex-wrap gap-s4">
                    <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                      Gilt ab
                      <input type="date" name="giltAb" required className={FELD}
                             data-cse="steuer-13b-ab" />
                    </label>
                    <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                      Gilt bis (leer = offen)
                      <input type="date" name="giltBis" className={FELD} />
                    </label>
                  </div>
                  <label className="flex flex-col gap-s2 text-sm text-text">
                    Grundlage (Pflicht)
                    <input name="grundlage" required className={FELD}
                           placeholder="Bestätigung USt 1 TG vom 12.01.2025"
                           data-cse="steuer-13b-grundlage" />
                    <span className="text-xs text-text-muted">
                      Womit ist der Status belegt? Wie er zu belegen ist, ist offen
                      (O-104) — was hier steht, ist das, was in einer Prüfung vorgelegt
                      wird.
                    </span>
                  </label>
                  <p className="m-0 text-xs text-text-muted">
                    Überschneidet sich der Zeitraum mit einem vorhandenen, wird er
                    abgewiesen und die kollidierende Zeile genannt: zwei überlappende
                    Scheiben liessen offen, welche am Leistungsdatum gilt.
                  </p>
                  <button
                    type="submit" data-cse="steuer-13b-speichern"
                    className="min-h-11 self-start rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover"
                  >
                    Zeitscheibe anlegen
                  </button>
                </form>
              </details>
            ) : (
              <p className="mt-s4 max-w-prose text-xs text-text-muted">
                Zum Eintragen einer Zeitscheibe fehlt
                <Recht schluessel="finanzen.schreiben" />.
              </p>
            )}
          </>
        )}
      </section>

      {/* -------------------------------------- (d) §48b-Bescheinigung */}
      <section aria-labelledby="achtundvierzigb">
        <h2 id="achtundvierzigb" className="text-h2 text-text">
          § 48b EStG — Freistellungsbescheinigung
        </h2>

        {!blatt.rechte.finanzenLesen ? (
          <Hinweis art="warnung" cse="steuer-48b-verdeckt" className="mt-s3 max-w-prose">
            <strong>Die Freistellungsbescheinigungen sind Ihnen nicht sichtbar.</strong>{' '}
            Dafür fehlt <Recht schluessel="finanzen.lesen" />. Eine leere
            Liste hier hiesse „15 % Bauabzugsteuer einbehalten" — und das wäre
            möglicherweise falsch.
          </Hinweis>
        ) : (
          <>
            <div className="mt-s3 rounded-lg border border-line bg-surface p-s5"
                 data-cse="steuer-48b-lage" data-gueltig={String(bescheinigung !== null)}>
              <p className="m-0 flex flex-wrap items-center gap-s3">
                <StatusPill zustand={bescheinigung === null ? 'Fehler' : 'Aktiv'} />
                <span className="text-sm text-text">
                  {bescheinigung === null
                    ? `Am ${tagDeutsch(stichtag)} liegt keine gültige Bescheinigung vor.`
                    : `Am ${tagDeutsch(stichtag)} gültig: `
                      + `${bescheinigung.bescheinigung_nummer} `
                      + `(${bescheinigung.finanzamt}), bis `
                      + `${tagDeutsch(bescheinigung.gueltig_bis)}.`}
                </span>
              </p>
              <p className="m-0 mt-s3 max-w-prose text-sm text-text-muted">
                Geprüft wird AM STICHTAG, nicht heute. Wer die Gültigkeit vor der
                Zahlung prüft und ob die Bescheinigung je Kunde, je Auftrag oder je
                Nachunternehmer geführt wird, ist offen (O-67).
              </p>
            </div>

            {blatt.bescheinigungen.length === 0 ? (
              <p className="mt-s4 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Keine Bescheinigung erfasst.
              </p>
            ) : (
              <div className="mt-s4">
                <DataTable
                  beschriftung="Freistellungsbescheinigungen nach § 48b EStG"
                  zeilen={blatt.bescheinigungen}
                  schluessel={(z) => z.id}
                  spalten={[
                    {
                      schluessel: 'nummer', kopf: 'Nummer',
                      zelle: (z) => <span className="tabular-nums">{z.bescheinigung_nummer}</span>,
                    },
                    { schluessel: 'fa', kopf: 'Finanzamt', zelle: (z) => z.finanzamt },
                    {
                      schluessel: 'gueltig', kopf: 'Gültig',
                      zelle: (z) => (
                        <span className="tabular-nums">
                          {tagDeutsch(z.gueltig_von)} – {tagDeutsch(z.gueltig_bis)}
                        </span>
                      ),
                    },
                    {
                      schluessel: 'umfang', kopf: 'Umfang',
                      zelle: (z) => (z.umfang === 'unbeschraenkt'
                        ? 'unbeschränkt'
                        : `Auftrag ${z.auftragsnummer ?? '—'}`),
                    },
                    {
                      schluessel: 'zustand', kopf: 'Zustand',
                      zelle: (z) => (z.widerrufen_am !== null
                        ? (
                          <span className="inline-flex flex-wrap items-center gap-s2">
                            <StatusPill zustand="Abgelehnt" />
                            <span className="text-xs text-text-muted">
                              widerrufen {tagDeutsch(z.widerrufen_am)}
                            </span>
                          </span>
                        )
                        : z.gueltig_von <= stichtag && z.gueltig_bis >= stichtag
                          ? <StatusPill zustand="Aktiv" />
                          : <StatusPill zustand="Archiviert" />),
                    },
                    {
                      schluessel: 'scan', kopf: 'Scan',
                      /*
                       * Der Verweis nur mit `dokument.lesen` — das Dokumentblatt
                       * verlangt es, und ein Knopf, der auf ein 404 zeigt (AUT-06),
                       * ist schlechter als keiner. Ohne das Recht steht, DASS ein
                       * Scan hinterlegt ist: das ist eine Aussage über die
                       * Bescheinigung, nicht über die Berechtigung.
                       */
                      zelle: (z) => (z.dokument_id === null ? '—'
                        : darf['dokument.lesen'] !== true
                          ? (
                            <span className="text-text-subtle"
                                  title="Zum Öffnen fehlt dokument.lesen">
                              hinterlegt
                            </span>
                          ) : (
                            <Link
                              href={`/portal/${mandant}/dokumente/${z.dokument_id}`}
                              className="text-text underline-offset-2 hover:text-brand hover:underline"
                            >
                              öffnen
                            </Link>
                          )),
                    },
                    ...(blatt.rechte.finanzenSchreiben ? [{
                      schluessel: 'widerruf', kopf: 'Widerruf',
                      zelle: (z: typeof blatt.bescheinigungen[number]) => (
                        z.widerrufen_am !== null ? <span className="text-text-subtle">—</span> : (
                          <form method="post" action="/api/crm/kunde/steuer"
                                data-cse="steuer-48b-widerruf-formular"
                                className="flex flex-wrap items-end gap-s2">
                            <input type="hidden" name="was" value="widerruf" />
                            <input type="hidden" name="kundeId" value={id} />
                            <input type="hidden" name="bescheinigungId" value={z.id} />
                            <input type="hidden" name="zurueck" value={pfad} />
                            <input type="date" name="widerrufenAm" required
                                   defaultValue={blatt.heute}
                                   className="min-h-11 rounded-md border border-line bg-surface px-s2 py-s1 text-xs text-text" />
                            <button
                              type="submit" data-cse="steuer-48b-widerrufen"
                              className="min-h-11 rounded-md border border-line-strong px-s3 py-s2 text-xs text-text hover:bg-surface-2"
                            >
                              widerrufen
                            </button>
                          </form>
                        )
                      ),
                    }] : []),
                  ]}
                />
                <p className="mt-s3 max-w-prose text-xs text-text-muted">
                  Ein Widerruf ist ein DATUM, keine Löschung (Invariante 8): jede
                  Rechnung, die sich auf eine Bescheinigung berufen hat, muss
                  herleitbar bleiben.
                </p>
              </div>
            )}

            {blatt.rechte.finanzenSchreiben ? (
              <details className="mt-s5" data-cse="steuer-48b-anlegen">
                <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text">
                  Bescheinigung erfassen
                </summary>
                <form
                  method="post" action="/api/crm/kunde/steuer"
                  data-cse="steuer-48b-formular"
                  className="mt-s4 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
                >
                  <input type="hidden" name="was" value="bescheinigung" />
                  <input type="hidden" name="kundeId" value={id} />
                  <input type="hidden" name="zurueck" value={pfad} />

                  <label className="flex flex-col gap-s2 text-sm text-text">
                    Nummer der Bescheinigung
                    <input name="nummer" required className={FELD}
                           data-cse="steuer-48b-nummer" />
                  </label>
                  <label className="flex flex-col gap-s2 text-sm text-text">
                    Ausstellendes Finanzamt
                    <input name="finanzamt" required className={FELD} />
                  </label>
                  <div className="flex flex-wrap gap-s4">
                    <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                      Gültig von
                      <input type="date" name="gueltigVon" required className={FELD} />
                    </label>
                    <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                      Gültig bis
                      <input type="date" name="gueltigBis" required className={FELD} />
                    </label>
                  </div>
                  <label className="flex flex-col gap-s2 text-sm text-text">
                    Umfang
                    <select name="umfang" required className={FELD}
                            data-cse="steuer-48b-umfang">
                      <option value="unbeschraenkt">unbeschränkt — gilt für jeden Auftrag</option>
                      <option value="auftragsbezogen">auftragsbezogen</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-s2 text-sm text-text">
                    Auftrag (nur bei „auftragsbezogen")
                    {/*
                      * Eine AUSWAHL, kein Freitextfeld. Wer „Auftrag" liest,
                      * tippt sonst die Auftragsnummer — und die ging bis
                      * hierher ungeprüft als `::uuid` in das INSERT: `22P02`,
                      * 500, Eingabe weg. Der Dienst prüft die Kennung
                      * zusätzlich, weil eine Auswahl im Browser keine Wache
                      * ist.
                      */}
                    {blatt.rechte.auftragLesen ? (
                      <select name="auftragId" className={FELD}
                              defaultValue="" data-cse="steuer-48b-auftrag">
                        <option value="">keiner — unbeschränkte Bescheinigung</option>
                        {blatt.auftraege.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.auftragsnummer} · {a.bezeichnung}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input name="auftragId" className={FELD}
                             data-cse="steuer-48b-auftrag-feld" />
                    )}
                    <span className="text-xs text-text-muted">
                      Der CHECK <code className="text-text">fsb_umfang_auftrag</code>
                      {' '}nimmt den Auftrag genau dann, wenn der Umfang
                      „auftragsbezogen" ist.
                      {blatt.rechte.auftragLesen
                        ? (blatt.auftraege.length === 0
                          ? ' Zu diesem Kunden steht kein Auftrag — eine auftragsbezogene'
                            + ' Bescheinigung ist deshalb hier nicht erfassbar.'
                          : '')
                        : ' Die Auswahl der Aufträge ist Ihnen nicht sichtbar — dafür'
                          + ' fehlt `auftrag.lesen`. Erwartet wird deshalb die Kennung'
                          + ' aus der Adresszeile des Auftrags, nicht die'
                          + ' Auftragsnummer.'}
                    </span>
                  </label>
                  <label className="flex flex-col gap-s2 text-sm text-text">
                    Scan (Dokumentkennung, optional)
                    <input name="dokumentId" className={FELD}
                           data-cse="steuer-48b-dokument" />
                    <span className="text-xs text-text-muted">
                      Die <strong>Kennung</strong> aus der Adresszeile des Dokuments
                      (36 Zeichen, mit Bindestrichen) — nicht der Dateiname und nicht
                      die Belegnummer. Das Dokument liegt im privaten Speicher und wird
                      über eine signierte Adresse geöffnet — nie öffentlich.
                    </span>
                  </label>
                  <button
                    type="submit" data-cse="steuer-48b-speichern"
                    className="min-h-11 self-start rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover"
                  >
                    Bescheinigung erfassen
                  </button>
                </form>
              </details>
            ) : null}
          </>
        )}
      </section>
    </PortalRahmen>
  );
}
