import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import {
  ladeAbrufAuswahl, ladeKatalogzeilen, listeAbrufe, statuswechsel,
  PFLEGBARE_STATUS, SONDERLEISTUNG_STATUS, STATUS_TEXT,
  type AbrufAuswahl, type AbrufZeile, type KatalogAusschnitt, type SonderleistungStatus,
} from '@/server/services/reinigung/sonderleistung';

/**
 * `/portal/[mandant]/reinigung/sonderleistungen` — Glas, Sonderreinigung,
 * Warenräumung (CLN-05, OPS-06).
 *
 * **Zwei Abschnitte, weil es zwei Dinge sind.** Oben die KATALOGZEILEN mit
 * ihren Zeitwerten (`leistungskatalog_position`), unten die einzelnen ABRUFE
 * je Objekt (`sonderleistung`). Die Seitenkarte beschreibt „Katalogeinträge
 * mit eigenen Zeitwerten" und vergibt `katalog.schreiben`; welche Hälfte diese
 * Seite besitzt, steht damit nicht fest, und `/leistungskatalog` gibt es noch
 * nicht. Beide Hälften stehen deshalb hier — getrennt, beschriftet, jede
 * hinter ihrem Recht — und die offene Frage steht als O-702 daneben statt als
 * stille Entscheidung im Code.
 *
 * **Kein Preisfeld auf der Abrufzeile.** `sonderleistung` hat keine
 * Preisspalte (0067): bepreist wird über `auftrag_leistung.einzelpreis_cent`,
 * den mit diesem Kunden vereinbarten Preis. Eine dritte Zahl für denselben
 * Betrag wäre genau die Art Fehler, die erst in der Rechnung auffällt.
 *
 * **„Abgerechnet" setzt hier niemand.** Diesen Stempel setzt die
 * Rechnungsübernahme, und `einzelabruf.ts` liest ausschliesslich `erbracht`
 * als abrechenbar. Ein Zurückstellen von `abgerechnet` auf `erbracht` machte
 * den Abruf ein zweites Mal abrechenbar — die Regel dafür ist eine getestete
 * Funktion im Dienst (`statuswechsel`), nicht eine Bedingung in diesem
 * Formular.
 *
 * **Storniert wird, nicht gelöscht** (Invariante 8, `loeschsperre` steht auf
 * `true`): eigene Spalten, mit Grund und Urheber.
 */
export const dynamic = 'force-dynamic';

/**
 * DESIGN §5 führt ein geschlossenes Pillenvokabular, und „Beauftragt" sowie
 * „Erbracht" stehen nicht darin. Abgebildet statt erfunden — der nächste
 * Wortsatz gehört in DESIGN.md, nicht in diese Datei.
 */
const PILLE: Readonly<Record<SonderleistungStatus, PillZustand>> = {
  angefragt: 'Wartet',
  beauftragt: 'Offen',
  geplant: 'Geplant',
  erbracht: 'Bereit',
  abgerechnet: 'Abgeschlossen',
  storniert: 'Archiviert',
};

/** Punkt zu Komma — die Datenbank liefert Punkte, DESIGN §5 zeigt Kommas. */
function deutsch(wert: string | null): string {
  return wert === null ? '—' : wert.replace('.', ',');
}

/** Cent als Betrag — ganzzahlig gerechnet, nie durch einen Double. */
function euroAusCent(cent: string | null): string {
  if (cent === null) return '—';
  const negativ = cent.startsWith('-');
  const ziffern = (negativ ? cent.slice(1) : cent).padStart(3, '0');
  const ganz = ziffern.slice(0, -2);
  const rest = ziffern.slice(-2);
  return `${negativ ? '-' : ''}${ganz},${rest} €`;
}

export default async function Sonderleistungen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const meldung = typeof suche['ok'] === 'string' ? suche['ok'] : null;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const tor = await mandantTor(`/portal/${mandant}/reinigung/sonderleistungen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* AUT-06: der Leistungsnachweis dahinter verlangt `nachweis.lesen`, das
     Pflegen der Abrufe `reinigung.schreiben`, das der Katalogzeilen
     `katalog.schreiben`. Ein Verweis oder Knopf ohne das Recht dahinter führt
     auf 404 bzw. auf einen Fehler — und verrät, was er nicht zeigen darf. */
  const darf = await haeltRechte(
    sitzung, 'nachweis.lesen', 'reinigung.schreiben', 'katalog.schreiben',
  );

  const heute = await berlinHeute();
  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      abrufe: await listeAbrufe(kontext),
      katalog: await ladeKatalogzeilen(kontext),
      auswahl: await ladeAbrufAuswahl(kontext),
    }))) as Promise<{
      abrufe: readonly AbrufZeile[];
      katalog: KatalogAusschnitt;
      auswahl: AbrufAuswahl;
    }>);

  const offen = daten.abrufe.filter(
    (a) => a.status === 'angefragt' || a.status === 'beauftragt' || a.status === 'geplant').length;
  const erbracht = daten.abrufe.filter((a) => a.status === 'erbracht').length;
  const ohneVertragszeile = daten.abrufe.filter(
    (a) => !a.hatVertragszeile && a.status !== 'storniert').length;
  const platzhalter = daten.katalog.zeilen.filter((z) => z.istPlatzhalter).length;

  /*
   * Die Vertragszeilen nach Objekt gruppiert. `auftrag_leistung.objekt_id` ist
   * NULLABLE — eine Rahmenzeile gilt fuer den ganzen Auftrag und bekommt
   * deshalb eine eigene, benannte Gruppe statt still zu fehlen. Der Objektname
   * kommt aus `auswahl.objekte`; ist er nicht lesbar (`objekt.lesen` fehlt),
   * steht die Auftragsnummer in der Zeile selbst.
   */
  const objektName = new Map(daten.auswahl.objekte.map((o) => [o.id, o.bezeichnung]));
  const vertragszeilenJeObjekt = [
    ...daten.auswahl.objekte.map((o) => ({
      schluessel: o.id,
      name: o.bezeichnung,
      zeilen: daten.auswahl.vertragszeilen.filter((v) => v.objektId === o.id),
    })),
    {
      schluessel: '__ohne_objekt',
      name: 'Ohne Objektbezug — gilt für den ganzen Auftrag',
      zeilen: daten.auswahl.vertragszeilen.filter(
        (v) => v.objektId === null || !objektName.has(v.objektId)),
    },
  ].filter((g) => g.zeilen.length > 0);

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';
  const kleinfeld = 'min-h-11 rounded-md border border-line bg-surface-3 px-s2 text-sm text-text';
  const kannErfassen = darf['reinigung.schreiben'] === true
    && daten.auswahl.objekte.length > 0 && daten.auswahl.katalog.length > 0;

  return (
    <PortalRahmen
      titel="Sonderleistungen"
      wurzelTitel="Reinigung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/reinigung`, text: 'Reinigung' }}
    >
      <h1 className="mb-s2 text-h1 text-text">Sonderleistungen</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Glasreinigung, Sonderreinigung, Warenräumung — Leistungen, die einzeln
        beauftragt werden und nicht im laufenden Vertrag stecken. Oben stehen
        die <strong className="text-text">Katalogzeilen</strong> mit ihren
        Zeitwerten, unten die <strong className="text-text">einzelnen Abrufe</strong>
        {' '}je Objekt.
      </p>

      {meldung !== null && (
        <Hinweis art="erfolg" cse="sonderleistung-ok" className="mb-s5 max-w-prose">
          <strong>Gespeichert.</strong> {meldung}
        </Hinweis>
      )}
      {fehler !== null && (
        <Hinweis art="warnung" cse="sonderleistung-fehler" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong> {fehler}
        </Hinweis>
      )}

      <Hinweis art="hinweis" cse="sonderleistung-o702" className="mb-s6 max-w-prose">
        <strong>Offen (O-702):</strong> ob diese Seite die Katalogzeilen, die
        Abrufe oder beides pflegt, ist nicht entschieden — und den
        Leistungskatalog als eigene Seite gibt es noch nicht. Bis dahin stehen
        beide Hälften hier. Der <strong>Listenpreis</strong> einer Katalogzeile
        wird hier bewusst nicht geändert: er geht in Angebote und Rechnungen,
        und zwei Seiten, die dieselbe Preisspalte schreiben, sind eine Seite zu
        viel.
      </Hinweis>

      <div className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiStat label="Abrufe" wert={String(daten.abrufe.length)} icon="auftrag" ton="info" />
        <KpiStat
          label="Offen"
          wert={String(offen)}
          icon="warnung"
          ton={offen === 0 ? 'muted' : 'warning'}
        />
        <KpiStat
          label="Erbracht, abrechenbar"
          wert={String(erbracht)}
          icon="rechnung"
          ton={erbracht === 0 ? 'muted' : 'success'}
        />
        <KpiStat
          label="Ohne Vertragszeile"
          wert={String(ohneVertragszeile)}
          icon="fehler"
          ton={ohneVertragszeile === 0 ? 'muted' : 'danger'}
        />
      </div>

      {ohneVertragszeile > 0 && (
        <Hinweis art="warnung" cse="abruf-ohne-vertragszeile" className="mb-s6 max-w-prose">
          <strong>{ohneVertragszeile} Abruf(e) hängen an keiner Vertragszeile.</strong>{' '}
          Der Preis eines Abrufs kommt aus <code>auftrag_leistung</code> — dem mit
          diesem Kunden vereinbarten Preis. Ohne Vertragszeile lässt sich der
          Abruf nicht abrechnen, auch wenn er erbracht ist.
        </Hinweis>
      )}

      {/* ===== Abschnitt 1: die Katalogzeilen ============================== */}
      <section className="mb-s7" data-cse="sonderleistung-katalog">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">Katalogzeilen mit Zeitwert</h2>
          <p className="m-0 text-sm text-text-muted">
            {daten.katalog.geprueft
              ? `${String(daten.katalog.zeilen.length)} Zeile(n), davon ${String(platzhalter)} unbestätigt`
              : 'nicht geprüft'}
          </p>
        </div>

        {!daten.katalog.geprueft ? (
          <Hinweis art="hinweis" cse="katalog-ungeprueft" className="max-w-prose">
            <strong>Nicht geprüft.</strong> Der Leistungskatalog liegt hinter dem
            Recht <code>katalog.lesen</code>, das dieses Konto hier nicht hält.
            Das ist nicht dasselbe wie ein leerer Katalog — die Abrufe unten sind
            davon unberührt, weil sie auf <code>reinigung.lesen</code> laufen.
          </Hinweis>
        ) : daten.katalog.zeilen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Keine gültige Katalogzeile. Ohne Katalogzeile lässt sich kein Abruf
            erfassen — ein Abruf hängt zwingend an einer Position.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {daten.katalog.zeilen.map((z) => (
              <li key={z.id} className="mb-s3" data-cse="katalogzeile" data-oz={z.oz}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-s3">
                    <span className="text-base text-text">
                      <span className="tabular-nums text-text-muted">{z.oz}</span>
                      {' · '}
                      {z.kurztext}
                    </span>
                    <span className="text-sm tabular-nums text-text-muted">
                      Zeitwert {deutsch(z.zeitwertMinuten)} Min. / {z.einheit}
                    </span>
                  </div>
                  {z.langtext !== null && (
                    <p className="m-0 mt-s2 max-w-prose text-sm text-text-muted">{z.langtext}</p>
                  )}
                  <p className="m-0 mt-s2 text-sm text-text-muted">
                    Listenpreis {euroAusCent(z.standardEinzelpreisCent)}
                    {z.leistungswert !== null
                      && ` · Leistungswert ${deutsch(z.leistungswert)} m²/h`}
                    {' · '}
                    {z.abrufe === 0 ? 'kein Abruf' : `${String(z.abrufe)} Abruf(e)`}
                    {' · gültig ab '}
                    <span className="tabular-nums">{z.gueltigAb}</span>
                    {/*
                      §1.16: eine unbestätigte Katalogzeile sagt das — als WORT
                      und nicht nur als Farbe (DESIGN §9). Eine eigene Pille
                      wäre die erfundene Komponente, die CLAUDE.md ausschliesst;
                      DESIGN §5 führt „Unbestätigter Wert" noch nicht.
                    */}
                    {z.istPlatzhalter && (
                      <span className="ml-s2 text-warning">· Zeitwert unbestätigt (O-17)</span>
                    )}
                  </p>

                  {darf['katalog.schreiben'] === true && (
                    <form
                      method="post"
                      action="/api/reinigung/sonderleistungen"
                      data-cse="zeitwert-formular"
                      className="mt-s4 flex flex-wrap items-end gap-s3 border-t border-line pt-s4"
                    >
                      <input type="hidden" name="mandant" value={mandant} />
                      <input type="hidden" name="art" value="zeitwert" />
                      <input type="hidden" name="position" value={z.id} />
                      <label className="block">
                        <span className="mb-s1 block text-xs text-text-muted">
                          Zeitwert (Minuten je Einheit)
                        </span>
                        <input
                          name="zeitwert"
                          inputMode="decimal"
                          defaultValue={z.zeitwertMinuten ?? ''}
                          className={`${kleinfeld} w-32`}
                          placeholder="12,5"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-s1 block text-xs text-text-muted">Einheit</span>
                        <input
                          name="einheit"
                          maxLength={20}
                          defaultValue={z.einheit}
                          className={`${kleinfeld} w-24`}
                        />
                      </label>
                      <label className="inline-flex min-h-11 items-center gap-s2 text-sm text-text">
                        <input
                          type="checkbox"
                          name="bestaetigt"
                          value="ja"
                          defaultChecked={!z.istPlatzhalter}
                        />
                        Zeitwert bestätigt
                      </label>
                      <Button type="submit" variante="secondary" data-cse="zeitwert-speichern">
                        Zeitwert speichern
                      </Button>
                    </form>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== Abschnitt 2: die Abrufe ===================================== */}
      <section className="mb-s6" data-cse="sonderleistung-abrufe">
        <h2 className="mb-s4 text-h3 text-text">Abrufe</h2>

        {daten.abrufe.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Kein Abruf erfasst. Das heisst: keiner ist beauftragt worden — nicht,
            dass keine Sonderleistung möglich wäre.
          </p>
        ) : (
          <DataTable<AbrufZeile>
            beschriftung="Einzelabrufe mit Objekt, Kunde, Ausführungsfenster und Zustand"
            zeilen={daten.abrufe}
            schluessel={(a) => a.id}
            spalten={[
              {
                schluessel: 'bezeichnung',
                kopf: 'Abruf',
                zelle: (a) => (
                  <span>
                    <span className={a.status === 'storniert' ? 'line-through' : ''}>
                      {a.bezeichnung}
                    </span>
                    <span className="block text-micro text-text-muted">
                      {a.katalogKurztext ?? 'Katalogzeile nicht geprüft'}
                      {a.revier !== null && ` · ${a.revier}`}
                    </span>
                  </span>
                ),
              },
              {
                schluessel: 'objekt',
                kopf: 'Objekt · Kunde',
                zelle: (a) => (
                  <span>
                    {a.objekt ?? <span className="text-text-muted">nicht geprüft</span>}
                    <span className="block text-micro text-text-muted">
                      {a.kunde ?? 'Kunde nicht geprüft'}
                    </span>
                  </span>
                ),
              },
              {
                schluessel: 'beauftragt',
                kopf: 'Beauftragt am',
                zelle: (a) => (
                  <span>
                    <span className="tabular-nums">{a.beauftragtAm}</span>
                    {a.beauftragtDurch !== null && (
                      <span className="block text-micro text-text-muted">
                        durch {a.beauftragtDurch}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'fenster',
                kopf: 'Ausführung',
                zelle: (a) => (a.ausfuehrungVon === null && a.ausfuehrungBis === null
                  ? '—'
                  : (
                    <span className="tabular-nums">
                      {a.ausfuehrungVon ?? '?'} – {a.ausfuehrungBis ?? '?'}
                    </span>
                  )),
              },
              {
                schluessel: 'menge',
                kopf: 'Menge',
                numerisch: true,
                zelle: (a) => (a.menge === null
                  ? '—'
                  : `${deutsch(a.menge)} ${a.einheit ?? ''}`.trim()),
              },
              {
                schluessel: 'nachweis',
                kopf: 'Leistungsnachweis',
                zelle: (a) => (a.leistungsnachweisId === null
                  ? '—'
                  : darf['nachweis.lesen'] === true ? (
                    <Link
                      href={`/portal/${mandant}/reinigung/leistungsnachweise/${a.leistungsnachweisId}`}
                      className="underline hover:text-text"
                    >
                      {a.leistungsnachweisNummer ?? 'Nachweis'}
                    </Link>
                  ) : (a.leistungsnachweisNummer ?? 'Nachweis')),
              },
              {
                schluessel: 'status',
                kopf: 'Zustand',
                zelle: (a) => (
                  <span>
                    <StatusPill zustand={PILLE[a.status]} />
                    <span className="block text-micro text-text-muted">
                      {STATUS_TEXT[a.status]}
                    </span>
                    {a.storniertAmLokal !== null && (
                      <span className="block text-micro text-text-muted">
                        storniert {a.storniertAmLokal}
                        {a.stornoGrund !== null && ` — ${a.stornoGrund}`}
                      </span>
                    )}
                  </span>
                ),
              },
              ...(darf['reinigung.schreiben'] === true ? [{
                schluessel: 'pflege',
                kopf: 'Zustand setzen',
                zelle: (a: AbrufZeile) => {
                  /*
                   * Angeboten wird NUR, was `statuswechsel` erlaubt — dieselbe
                   * getestete Funktion, die der Dienst anwendet. Eine zweite
                   * Liste hier wäre die zweite Meinung darüber, was zulässig
                   * ist, und die erste, die auseinanderläuft.
                   */
                  const moeglich = PFLEGBARE_STATUS.filter(
                    (s) => statuswechsel(a.status, s).erlaubt);
                  if (moeglich.length === 0) {
                    const grund = statuswechsel(a.status, 'erbracht').grund;
                    return (
                      <span className="text-micro text-text-muted" data-cse="abruf-endzustand">
                        {grund ?? 'Endzustand.'}
                      </span>
                    );
                  }
                  return (
                    <div className="flex flex-col gap-s2">
                      <form
                        method="post"
                        action="/api/reinigung/sonderleistungen"
                        className="flex flex-wrap items-end gap-s2"
                        data-cse="abruf-status-formular"
                      >
                        <input type="hidden" name="mandant" value={mandant} />
                        <input type="hidden" name="art" value="status" />
                        <input type="hidden" name="abruf" value={a.id} />
                        <select
                          name="status"
                          required
                          className={`${kleinfeld} w-36`}
                          aria-label={`Neuer Zustand für ${a.bezeichnung}`}
                        >
                          {moeglich.map((s) => (
                            <option key={s} value={s}>{STATUS_TEXT[s]}</option>
                          ))}
                        </select>
                        <Button type="submit" variante="ghost" className="px-s3">
                          Setzen
                        </Button>
                      </form>
                      <form
                        method="post"
                        action="/api/reinigung/sonderleistungen"
                        className="flex flex-wrap items-end gap-s2"
                        data-cse="abruf-storno-formular"
                      >
                        <input type="hidden" name="mandant" value={mandant} />
                        <input type="hidden" name="art" value="storno" />
                        <input type="hidden" name="abruf" value={a.id} />
                        <input
                          name="grund"
                          required
                          maxLength={200}
                          placeholder="Stornogrund"
                          className={`${kleinfeld} w-36`}
                          aria-label={`Stornogrund für ${a.bezeichnung}`}
                        />
                        <Button type="submit" variante="ghost" className="px-s3">
                          Stornieren
                        </Button>
                      </form>
                    </div>
                  );
                },
              }] : []),
            ]}
          />
        )}
      </section>

      {/* ===== Abschnitt 3: einen Abruf erfassen =========================== */}
      {darf['reinigung.schreiben'] === true && (
        <section data-cse="sonderleistung-erfassen">
          <h2 className="mb-s4 text-h3 text-text">Abruf erfassen</h2>

          {daten.auswahl.geprueft['objekt.lesen'] !== true && (
            <Hinweis art="warnung" cse="abruf-kein-objektrecht" className="mb-s4 max-w-prose">
              <strong>Die Objektauswahl ist leer, weil <code>objekt.lesen</code> fehlt.</strong>{' '}
              Ein Abruf hängt zwingend an einem Objekt und an dessen Kunden.
            </Hinweis>
          )}
          {daten.auswahl.geprueft['katalog.lesen'] !== true && (
            <Hinweis art="warnung" cse="abruf-kein-katalogrecht" className="mb-s4 max-w-prose">
              <strong>Die Katalogauswahl ist leer, weil <code>katalog.lesen</code> fehlt.</strong>{' '}
              Ein Abruf hängt zwingend an einer Katalogposition.
            </Hinweis>
          )}
          {daten.auswahl.geprueft['auftrag.lesen'] !== true ? (
            <Hinweis art="warnung" cse="abruf-kein-auftragsrecht" className="mb-s4 max-w-prose">
              <strong>Die Vertragszeilen sind nicht geprüft, weil{' '}
              <code>auftrag.lesen</code> fehlt.</strong>{' '}
              Die Auswahl bleibt deshalb leer — das heisst <em>nicht</em>, dass
              es keine Vertragszeilen gibt. Ein hier ohne Vertragszeile erfasster
              Abruf ist nicht abrechenbar: die Rechnungsübernahme verbindet
              <code> sonderleistung</code> per INNER JOIN mit
              <code> auftrag_leistung</code>.
            </Hinweis>
          ) : daten.auswahl.vertragszeilen.length === 0 && (
            <Hinweis art="warnung" cse="abruf-keine-vertragszeilen" className="mb-s4 max-w-prose">
              <strong>Diese Gesellschaft hat keine lebende Vertragszeile.</strong>{' '}
              Ohne sie lässt sich ein Abruf nicht abrechnen. Bitte zuerst den
              Auftrag mit seinen Leistungspositionen anlegen.
            </Hinweis>
          )}

          <form
            method="post"
            action="/api/reinigung/sonderleistungen"
            data-cse="abruf-formular"
            className="flex max-w-form flex-col gap-s4 rounded-lg border border-line
                       bg-surface p-s5"
          >
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="art" value="abruf" />
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Objekt (mit Kunde)</span>
              <select name="objekt" required className={feld} data-cse="abruf-objekt">
                {daten.auswahl.objekte.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.bezeichnung}
                    {o.kunde === null ? ' — ohne Kunde, nicht abrufbar' : ` · ${o.kunde}`}
                  </option>
                ))}
              </select>
              <span className="mt-s1 block text-xs text-text-subtle">
                Der Kunde wird vom Objekt übernommen — ein Abruf ohne Kunde lässt
                sich nicht abrechnen.
              </span>
            </label>
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Katalogposition</span>
              <select name="position" required className={feld} data-cse="abruf-position">
                {daten.auswahl.katalog.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.oz} · {k.kurztext} ({k.einheit})
                    {k.istPlatzhalter ? ' — Zeitwert unbestätigt' : ''}
                  </option>
                ))}
              </select>
            </label>
            {/*
              Die Vertragszeile ist das Feld, ohne das der Abruf tote Arbeit
              waere: `finanz/abrechnungsart/einzelabruf.ts` verbindet
              `sonderleistung` per INNER JOIN mit `auftrag_leistung`. Die Liste
              daneben meldet solche Zeilen als „Ohne Vertragszeile" — sie hier
              nicht anzubieten hiesse, den gemeldeten Fehler selbst zu
              erzeugen. Zeilen ohne Objektbezug gelten fuer den ganzen Auftrag
              und stehen in einer eigenen Gruppe.
            */}
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Vertragszeile</span>
              <select name="auftrag_leistung" className={feld} data-cse="abruf-vertragszeile">
                <option value="">— noch keine, Abruf bleibt nicht abrechenbar —</option>
                {vertragszeilenJeObjekt.map((g) => (
                  <optgroup key={g.schluessel} label={g.name}>
                    {g.zeilen.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.auftragNummer} · Pos. {v.positionNr} · {v.bezeichnung}
                        {v.einheit === null ? '' : ` (${v.einheit})`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="mt-s1 block text-xs text-text-subtle">
                <strong className="text-text">
                  Ohne Vertragszeile lässt sich der Abruf nicht abrechnen.
                </strong>{' '}
                Die Auswahl bleibt trotzdem freiwillig: ein Abruf entsteht oft
                vor dem Nachtrag. Die Liste oben führt solche Zeilen dann als
                offen — nachtragen lässt sich die Zuordnung noch nicht (O-708).
              </span>
            </label>
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Revier (optional)</span>
              <select name="revier" className={feld}>
                <option value="">— kein bestimmtes Revier —</option>
                {daten.auswahl.reviere.map((r) => (
                  <option key={r.id} value={r.id}>{r.bezeichnung}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Bezeichnung</span>
              <input
                name="bezeichnung"
                required
                maxLength={160}
                className={feld}
                placeholder="Glasreinigung Treppenhaus, aussen"
              />
            </label>
            <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-s1 block text-sm text-text">Beauftragt am</span>
                <input
                  name="beauftragt_am"
                  type="date"
                  required
                  defaultValue={heute}
                  className={feld}
                />
              </label>
              <label className="block">
                <span className="mb-s1 block text-sm text-text">Beauftragt durch (Name)</span>
                <input name="beauftragt_durch" maxLength={120} className={feld} />
              </label>
              <label className="block">
                <span className="mb-s1 block text-sm text-text">Ausführung von</span>
                <input name="ausfuehrung_von" type="date" className={feld} />
              </label>
              <label className="block">
                <span className="mb-s1 block text-sm text-text">Ausführung bis</span>
                <input name="ausfuehrung_bis" type="date" className={feld} />
              </label>
              <label className="block">
                <span className="mb-s1 block text-sm text-text">Menge</span>
                <input name="menge" inputMode="decimal" className={feld} placeholder="24,5" />
              </label>
              <label className="block">
                <span className="mb-s1 block text-sm text-text">Einheit</span>
                <input name="einheit" maxLength={20} className={feld} placeholder="m²" />
              </label>
            </div>
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Zustand</span>
              <select name="status" className={feld} defaultValue="angefragt">
                {PFLEGBARE_STATUS.map((s) => (
                  <option key={s} value={s}>{STATUS_TEXT[s]}</option>
                ))}
              </select>
              <span className="mt-s1 block text-xs text-text-subtle">
                {/* „abgerechnet" fehlt hier absichtlich: diesen Stempel setzt die
                    Rechnungsübernahme, und nur sie. */}
                „{STATUS_TEXT.abgerechnet}" steht nicht zur Wahl — diesen Stempel
                setzt die Rechnungsübernahme. „{STATUS_TEXT.storniert}" läuft über
                den Stornoweg mit Grund.
              </span>
            </label>
            <div>
              <Button
                type="submit"
                variante="secondary"
                data-cse="abruf-erfassen"
                disabled={!kannErfassen}
              >
                Abruf erfassen
              </Button>
              {!kannErfassen && (
                <p className="m-0 mt-s3 text-xs text-warning">
                  Ohne Objekt und Katalogposition lässt sich kein Abruf erfassen.
                </p>
              )}
            </div>
          </form>

          <p className="mt-s4 max-w-prose text-xs text-text-subtle">
            Die sechs Zustände eines Abrufs:{' '}
            {SONDERLEISTUNG_STATUS.map((s) => STATUS_TEXT[s]).join(' · ')}. Eine
            feste Reihenfolge gibt es nicht — 0067 legt keine fest, und ein
            abgesagter Termin geht von „Geplant" zurück auf „Beauftragt".
          </p>
        </section>
      )}
    </PortalRahmen>
  );
}
