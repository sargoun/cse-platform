import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { Recht } from '@/components/ui/Recht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { FREISTELLUNG_TEXTE } from '@/lib/i18n/verwaltung/finanzen/freistellungen';
import { tagInSprache } from '@/lib/datum/kalendertag';
import { vorbelegt } from '@/lib/formular/maske';
import { eigenerEintrag } from '@/lib/nachschlagen';
import {
  ladeFreistellungAuswahl, listeFreistellungen, type FreistellungAuswahl,
  type FreistellungListe, type FreistellungStand,
} from '@/server/services/finanz/freistellung';

/**
 * `/portal/[mandant]/finanzen/freistellungen` — die Freistellungsbescheinigungen
 * nach § 48b EStG: erfassen, widerrufen, den Beleg verknüpfen (FIN-10, LEG-06,
 * V-283, O-604, D-845).
 *
 * **Lesen mit `finanzen.lesen`, pflegen mit `finanzen.schreiben`** — genau
 * die zwei Rechte der Policy auf `freistellungsbescheinigung` (0118). Die
 * Voreinstellung zu O-604 (D-779): die Buchhaltung pflegt sie; die
 * Steuerseite der Eingangsrechnung liest sie nur.
 *
 * **Erfasst, nie geändert** (0530). Nummer, Finanzamt, Zeitraum und Umfang
 * stehen auf festgeschriebenen Belegen; eine falsch erfasste Bescheinigung
 * wird widerrufen und neu erfasst. Darum gibt es hier kein „Bearbeiten".
 */
export const dynamic = 'force-dynamic';

const RECHT = 'finanzen.schreiben';

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

/* Die Farbe ist nie das einzige Signal: das Wort steht immer dabei (DESIGN §9). */
const STAND_TON: Readonly<Record<FreistellungStand, string>> = {
  gueltig: 'text-success',
  kuenftig: 'text-text-muted',
  abgelaufen: 'text-text-muted',
  widerrufen: 'text-warning',
};

export default async function Freistellungen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/finanzen/freistellungen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(FREISTELLUNG_TEXTE, zugang.sprache);
  const darf = await haeltRechte(zugang.sitzung, RECHT);
  const schreiben = darf[RECHT] === true && zugang.sitzung.ansicht !== 'gruppe';

  const suche = await searchParams;
  /* D-599/D-728: Grund und Ergebnis nur als EIGENER Eintrag der Tabelle. */
  const fehler = typeof suche['fehler'] === 'string'
    ? (eigenerEintrag(t.fehler, suche['fehler']) ?? t.fehlerUnbekannt) : null;
  const erfolg = typeof suche['freistellung'] === 'string'
    ? eigenerEintrag(t.erfolg, suche['freistellung']) ?? null : null;
  /* Eine abgewiesene Erfassung kommt mit ihren Eingaben zurück (V-240). */
  const v = (name: string): string => vorbelegt(suche, name) ?? '';

  const { liste, auswahl } = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      liste: await listeFreistellungen(kontext),
      auswahl: schreiben ? await ladeFreistellungAuswahl(kontext) : null,
    }))) as Promise<{ liste: FreistellungListe; auswahl: FreistellungAuswahl | null }>);
  const { heute, zeilen } = liste;
  const tag = (d: string): string => tagInSprache(d, zugang.sprache);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={!schreiben}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.einleitung}</p>

      {fehler !== null && (
        <Hinweis art="warnung" cse="freistellung-abgewiesen" rolle="alert" className="mb-s5 max-w-prose">
          <strong>{t.abgewiesen}</strong>{' '}
          {fehler}
        </Hinweis>
      )}
      {erfolg !== null && (
        <Hinweis art="erfolg" cse="freistellung-gespeichert" rolle="status" className="mb-s5 max-w-prose">
          {erfolg}
        </Hinweis>
      )}

      <Hinweis art="warnung" cse="freistellung-voreinstellung" className="mb-s6 max-w-prose">
        {t.voreinstellung}
      </Hinweis>

      {!schreiben && (
        <p className="mb-s5 max-w-prose text-sm text-text-muted" data-cse="freistellung-kein-recht">
          {t.keinSchreibrechtVor}{' '}<Recht schluessel={RECHT} sprache={zugang.sprache} />{' '}{t.keinSchreibrechtNach}
        </p>
      )}

      <section data-cse="freistellung-liste" className="mb-s7">
        {zeilen.length === 0 ? (
          <p className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.leer}
          </p>
        ) : (
          <DataTable
            beschriftung={t.titel}
            zeilen={zeilen}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'traeger', kopf: t.spalteTraeger,
                zelle: (z) => (
                  <span className="flex flex-col">
                    <span className="text-text">{z.traegerName ?? '—'}</span>
                    <span className="text-xs text-text-muted">
                      {z.traeger === 'kunde' ? t.kunde : t.lieferant}
                    </span>
                  </span>
                ),
              },
              {
                schluessel: 'nummer', kopf: t.spalteNummer,
                zelle: (z) => (
                  <span className="flex flex-col">
                    <span className="tabular-nums text-text" data-cse="freistellung-nummer">{z.nummer}</span>
                    <span className="text-xs text-text-muted">{z.finanzamt}</span>
                  </span>
                ),
              },
              {
                schluessel: 'zeitraum', kopf: t.spalteZeitraum,
                zelle: (z) => (
                  <span className="flex flex-col tabular-nums">
                    <span>{tag(z.gueltigVon)} – {tag(z.gueltigBis)}</span>
                    {z.widerrufenAm !== null && (
                      <span className="text-xs text-warning">{t.widerrufenAb(tag(z.widerrufenAm))}</span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'umfang', kopf: t.spalteUmfang,
                zelle: (z) => (z.umfang === 'auftragsbezogen'
                  ? t.auftragsbezogen(z.auftragsnummer ?? '—') : t.unbeschraenkt),
              },
              {
                schluessel: 'beleg', kopf: t.spalteBeleg,
                zelle: (z) => (
                  <span className="flex flex-col">
                    {z.dokumentId === null
                      ? <span className="text-text-subtle">{t.ohneBeleg}</span>
                      : (
                        <a href={`/api/dokumente/${z.dokumentId}/datei`}
                           className="text-text underline-offset-2 hover:text-brand hover:underline">
                          {z.dokument ?? t.oeffnen}
                        </a>
                      )}
                    <span className="text-xs text-text-muted">{t.belege(z.belege)}</span>
                  </span>
                ),
              },
              {
                schluessel: 'stand', kopf: t.spalteStand,
                zelle: (z) => (
                  <span data-cse="freistellung-stand" data-stand={z.stand}
                        className={`text-sm ${STAND_TON[z.stand]}`}>
                    {t.stand[z.stand]}
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>

      {schreiben && auswahl !== null && zeilen.some((z) => z.stand === 'gueltig'
        || z.stand === 'kuenftig' || (z.dokumentId === null && auswahl.belege.length > 0)) && (
        <section data-cse="freistellung-pflege" className="mb-s7 flex flex-col gap-s4">
          {zeilen.map((z) => {
            const widerrufbar = z.stand === 'gueltig' || z.stand === 'kuenftig';
            const verknuepfbar = z.dokumentId === null && auswahl.belege.length > 0;
            if (!widerrufbar && !verknuepfbar) return null;
            return (
              <div key={z.id} data-cse="freistellung-handlungen" data-nummer={z.nummer}
                   className="rounded-lg border border-line bg-surface p-s4">
                <h2 className="mb-s3 mt-0 text-h3 text-text">
                  {z.nummer} <span className="text-sm font-normal text-text-muted">· {z.traegerName ?? '—'}</span>
                </h2>
                <div className="flex flex-wrap items-start gap-s5">
                  {widerrufbar && (
                    <form method="post" action="/api/finanzen/freistellungen"
                          className="flex max-w-[40ch] flex-col gap-s2">
                      <input type="hidden" name="aktion" value="widerrufen" />
                      <input type="hidden" name="id" value={z.id} />
                      <input type="hidden" name="zurueck" value={pfad} />
                      <label className="flex flex-col gap-s2 text-sm text-text">
                        {t.widerrufAb}
                        <input type="date" name="ab" required defaultValue={heute}
                               min={heute} max={z.gueltigBis} className={FELD} />
                      </label>
                      <span className="text-xs text-text-muted">{t.widerrufHinweis}</span>
                      <Button type="submit" variante="secondary" data-cse="freistellung-widerrufen">
                        {t.widerrufen}
                      </Button>
                    </form>
                  )}
                  {verknuepfbar && (
                    <form method="post" action="/api/finanzen/freistellungen"
                          className="flex max-w-[48ch] flex-col gap-s2">
                      <input type="hidden" name="aktion" value="beleg" />
                      <input type="hidden" name="id" value={z.id} />
                      <input type="hidden" name="zurueck" value={pfad} />
                      <label className="flex flex-col gap-s2 text-sm text-text">
                        {t.belegVerknuepfen}
                        <select name="dokument_id" required defaultValue="" className={FELD}>
                          <option value="" disabled>{t.keineAuswahl}</option>
                          {auswahl.belege.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      </label>
                      <Button type="submit" variante="secondary" data-cse="freistellung-beleg">
                        {t.verknuepfen}
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {schreiben && auswahl !== null && (
        <section data-cse="freistellung-neu" className="max-w-[64ch]">
          <h2 className="mb-s3 mt-0 text-h2 text-text">{t.neuTitel}</h2>
          <form method="post" action="/api/finanzen/freistellungen"
                className="flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="aktion" value="anlegen" />
            <input type="hidden" name="zurueck" value={pfad} />

            <fieldset className="flex flex-col gap-s2 border-0 p-0">
              <legend className="mb-s2 text-sm font-semibold text-text">{t.feldTraeger}</legend>
              <label className="flex min-h-11 items-start gap-s2 text-sm text-text">
                <input type="radio" name="traeger" value="lieferant" className="mt-s1"
                       defaultChecked={v('traeger') !== 'kunde'} />
                <span>{t.lieferantErklaerung}</span>
              </label>
              <label className="flex min-h-11 items-start gap-s2 text-sm text-text">
                <input type="radio" name="traeger" value="kunde" className="mt-s1"
                       defaultChecked={v('traeger') === 'kunde'} />
                <span>{t.kundeErklaerung}</span>
              </label>
            </fieldset>

            <div className="flex flex-wrap gap-s4">
              <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                {t.feldLieferant}
                <select name="lieferant_id" defaultValue={v('lieferant_id')} className={FELD}>
                  <option value="">{t.keineAuswahl}</option>
                  {auswahl.lieferanten.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                {t.feldKunde}
                <select name="kunde_id" defaultValue={v('kunde_id')} className={FELD}>
                  <option value="">{t.keineAuswahl}</option>
                  {auswahl.kunden.map((k) => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <span className="text-xs text-text-muted">{t.traegerHinweis}</span>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.feldNummer}
              <input type="text" name="nummer" required minLength={3} maxLength={100}
                     defaultValue={v('nummer')} className={FELD} />
            </label>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.feldFinanzamt}
              <input type="text" name="finanzamt" required minLength={3} maxLength={200}
                     defaultValue={v('finanzamt')} className={FELD} />
            </label>
            <div className="flex flex-wrap gap-s4">
              <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                {t.feldVon}
                <input type="date" name="gueltig_von" required defaultValue={v('gueltig_von')}
                       className={FELD} />
              </label>
              <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                {t.feldBis}
                <input type="date" name="gueltig_bis" required defaultValue={v('gueltig_bis')}
                       className={FELD} />
              </label>
            </div>

            <fieldset className="flex flex-col gap-s2 border-0 p-0">
              <legend className="mb-s2 text-sm font-semibold text-text">{t.feldUmfang}</legend>
              <label className="flex min-h-11 items-start gap-s2 text-sm text-text">
                <input type="radio" name="umfang" value="unbeschraenkt" className="mt-s1"
                       defaultChecked={v('umfang') !== 'auftragsbezogen'} />
                <span>{t.unbeschraenkt}</span>
              </label>
              <label className="flex min-h-11 items-start gap-s2 text-sm text-text">
                <input type="radio" name="umfang" value="auftragsbezogen" className="mt-s1"
                       defaultChecked={v('umfang') === 'auftragsbezogen'} />
                <span>{t.umfangAuftragsbezogen}</span>
              </label>
            </fieldset>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.feldAuftrag}
              <select name="auftrag_id" defaultValue={v('auftrag_id')} className={FELD}>
                <option value="">{t.keineAuswahl}</option>
                {auswahl.auftraege.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.feldBeleg}
              <select name="dokument_id" defaultValue={v('dokument_id')} className={FELD}>
                <option value="">{t.keinBeleg}</option>
                {auswahl.belege.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <span className="text-xs text-text-muted">{t.belegHinweis}</span>
            </label>

            <p className="m-0 text-xs text-text-muted">{t.festHinweis}</p>
            <div>
              <Button type="submit" variante="primary" data-cse="freistellung-anlegen">
                {t.anlegen}
              </Button>
            </div>
          </form>
        </section>
      )}
    </PortalRahmen>
  );
}
