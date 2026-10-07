import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { AUFTRAG_LEISTUNGEN_TEXTE } from '@/lib/i18n/verwaltung/auftrag-leistungen';
import { setzeEin } from '@/lib/i18n/vorlage';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { vorbelegt } from '@/lib/formular/maske';
import { tagInSprache } from '@/lib/datum/kalendertag';
import { cent, formatiereGeldIn } from '@/server/services/finanz/geld';
import { formatiereMengeIn, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { prozentTextIn } from '@/server/services/finanz/prozent';
import { einheiten, steuersaetzeAm, type SteuersatzWahl } from '@/server/services/angebot/von-hand';
import {
  PFLEGBARE_AUFTRAGSZUSTAENDE, leseLeistungszeilen, type Leistungszeile,
} from '@/server/services/auftrag/leistung';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/auftraege/[id]/leistungen` — die Leistungszeilen eines
 * Auftrags (V-360, O-921, D-825).
 *
 * Lesen mit `auftrag.lesen`, anlegen, im Preis anpassen und beenden mit
 * `auftrag.schreiben` (die Policy aus 0050). Ohne Schreibrecht steht ein Satz
 * statt der Formulare (AUT-06). Aus einem Angebot kommen die Zeilen bei der
 * Annahme; eine beendete Zeile bleibt mit ihrem letzten Tag stehen, eine
 * ersetzte nennt ihre Nachfolgerin (D-826).
 */
export const dynamic = 'force-dynamic';

const FELD = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm '
  + 'text-text';

interface Kopf {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly status: string;
  readonly heute: string;
}

export default async function Leistungszeilen(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id: roh } = await params;
  const id = kennungOder404(roh);
  const pfad = `/portal/${mandant}/auftraege/${id}/leistungen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const sprache = zugang.sprache;
  const t = nachSprache(AUFTRAG_LEISTUNGEN_TEXTE, sprache);
  const darfSchreiben = (await haeltRechte(zugang.sitzung, 'auftrag.schreiben'))[
    'auftrag.schreiben'] === true;
  const suche = await searchParams;
  const fehlerSchluessel = typeof suche['fehler'] === 'string'
    && /^[a-z_]{1,64}$/u.test(suche['fehler']) ? suche['fehler'] : null;
  const fehler = fehlerSchluessel === null
    ? null : (eigenerEintrag(t.fehler, fehlerSchluessel) ?? t.fehlerSonst);
  const erfolg = typeof suche['erfolg'] === 'string' ? eigenerEintrag(t.erfolg, suche['erfolg']) : null;

  const geladen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select a.id, a.auftragsnummer, a.bezeichnung, a.status::text as status,
                app.berlin_heute()::text as heute
           from auftrag a
          where a.id = $1::uuid and a.mandant_id = app.aktiver_mandant()`, [id]);
      if (kopf === undefined) return { kopf: undefined, zeilen: [], einheiten: [], saetze: [] };
      return {
        kopf,
        zeilen: await leseLeistungszeilen(kontext, id),
        einheiten: darfSchreiben ? await einheiten(kontext) : [],
        saetze: darfSchreiben ? await steuersaetzeAm(kontext, kopf.heute) : [],
      };
    })) as Promise<{
      kopf: Kopf | undefined;
      zeilen: readonly Leistungszeile[];
      einheiten: readonly { readonly schluessel: string; readonly bezeichnung: string }[];
      saetze: readonly SteuersatzWahl[];
    }>);

  if (geladen.kopf === undefined) notFound();
  const k = geladen.kopf;
  const pflegbar = (PFLEGBARE_AUFTRAGSZUSTAENDE as readonly string[]).includes(k.status);
  /* Nach einer Abweisung stehen die Eingaben wieder da (`maskeFelder`, V-240). */
  const eingabe = (name: string, sonst = ''): string =>
    (fehler !== null ? vorbelegt(suche, name) ?? sonst : sonst);

  const steuer = (z: Leistungszeile): string => {
    if (z.steuerKennzeichen === 'reverse_charge_13b') return '§ 13b UStG';
    if (z.steuerKennzeichen === 'steuerfrei') return '0 %';
    return prozentTextIn(z.steuersatzBp, sprache);
  };

  return (
    <PortalRahmen
      titel={t.titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="auftraege"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/auftraege/${id}`, text: t.zumAuftrag }}
    >
      <h1 className="mb-s2 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s2 mt-0 text-sm text-text">
        {k.bezeichnung} <span className="font-mono text-text-muted">{k.auftragsnummer}</span>
      </p>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.einleitung}</p>

      {erfolg !== null && (
        <Hinweis art="erfolg" rolle="status" cse="leistungen-erfolg" className="mb-s5 max-w-prose">
          {erfolg}
        </Hinweis>
      )}
      {fehler !== null && (
        <Hinweis art="warnung" rolle="alert" cse="leistungen-fehler" className="mb-s5 max-w-prose">
          {fehler}
        </Hinweis>
      )}

      {geladen.zeilen.length === 0 ? (
        <p className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
           data-cse="leistungen-leer">
          {t.keineZeilen}
        </p>
      ) : (
        <div className="mb-s6 overflow-x-auto">
          <table className="w-full border-collapse text-sm" data-cse="leistungen-tabelle">
            <thead>
              <tr className="border-b border-line text-left text-xs text-text-muted">
                <th scope="col" className="p-s2">{t.spalten.position}</th>
                <th scope="col" className="p-s2">{t.spalten.bezeichnung}</th>
                <th scope="col" className="p-s2 text-right">{t.spalten.menge}</th>
                <th scope="col" className="p-s2 text-right">{t.spalten.einzelpreis}</th>
                <th scope="col" className="p-s2 text-right">{t.spalten.gesamt}</th>
                <th scope="col" className="p-s2">{t.spalten.steuer}</th>
                <th scope="col" className="p-s2">{t.spalten.gueltig}</th>
                <th scope="col" className="p-s2">{t.spalten.herkunft}</th>
              </tr>
            </thead>
            <tbody>
              {geladen.zeilen.map((z) => (
                <tr key={z.id} data-cse="leistungszeile" data-lebt={z.lebt ? 'ja' : 'nein'}
                    className={`border-b border-line align-top ${z.lebt ? 'text-text' : 'text-text-muted'}`}>
                  <td className="p-s2 tabular-nums">{z.positionNr}</td>
                  <td className="p-s2">
                    {z.bezeichnung}
                    {z.beschreibung !== null && (
                      <span className="block text-xs text-text-muted">{z.beschreibung}</span>
                    )}
                    {darfSchreiben && pflegbar && z.preisAnpassbar && (
                        <form method="post" action="/api/auftrag/leistungen"
                              data-cse="leistungszeile-preis"
                              aria-label={`${t.preisTitel}: ${z.bezeichnung}`}
                              className="mt-s2 flex flex-wrap items-end gap-s2">
                          <input type="hidden" name="vorgang" value="preis" />
                          <input type="hidden" name="auftragId" value={k.id} />
                          <input type="hidden" name="zeileId" value={z.id} />
                          <input type="hidden" name="zurueck" value={pfad} />
                          <label className="flex flex-col gap-s1 text-xs text-text-muted">
                            {t.preisNeu}
                            <input name="neuerPreis" required inputMode="decimal" className={FELD} />
                          </label>
                          <label className="flex flex-col gap-s1 text-xs text-text-muted">
                            {t.preisAb}
                            <input type="date" name="stichtag" required className={FELD} />
                          </label>
                          <Button type="submit" variante="secondary">{t.preisKnopf}</Button>
                        </form>
                    )}
                    {darfSchreiben && pflegbar && z.gueltigBis === null && (
                        <form method="post" action="/api/auftrag/leistungen"
                              data-cse="leistungszeile-beenden"
                              aria-label={`${t.beendenTitel}: ${z.bezeichnung}`}
                              className="mt-s2 flex flex-wrap items-end gap-s2">
                          <input type="hidden" name="vorgang" value="beenden" />
                          <input type="hidden" name="auftragId" value={k.id} />
                          <input type="hidden" name="zeileId" value={z.id} />
                          <input type="hidden" name="zurueck" value={pfad} />
                          <label className="flex flex-col gap-s1 text-xs text-text-muted">
                            {t.beendenZum}
                            <input type="date" name="gueltigBis" required min={z.gueltigAb}
                                   className={FELD} />
                          </label>
                          <Button type="submit" variante="ghost">{t.beendenKnopf}</Button>
                        </form>
                    )}
                  </td>
                  <td className="p-s2 text-right tabular-nums">
                    {z.menge === null ? '—'
                      : `${formatiereMengeIn(mengeAusPostgresOderNull(z.menge), sprache)} ${z.einheit ?? ''}`}
                  </td>
                  <td className="p-s2 text-right tabular-nums">
                    {z.einzelpreisCent === null ? '—' : formatiereGeldIn(cent(z.einzelpreisCent), sprache)}
                  </td>
                  <td className="p-s2 text-right tabular-nums">
                    {formatiereGeldIn(cent(z.gesamtpreisCent), sprache)}
                  </td>
                  <td className="p-s2">{steuer(z)}</td>
                  <td className="p-s2 tabular-nums">
                    {z.gueltigBis === null
                      ? setzeEin(t.ab, { ab: tagInSprache(z.gueltigAb, sprache) })
                      : setzeEin(t.abBis, {
                        ab: tagInSprache(z.gueltigAb, sprache), bis: tagInSprache(z.gueltigBis, sprache),
                      })}
                    {!z.lebt && z.gueltigBis !== null && (
                      <span className="block text-xs">{t.beendet}</span>
                    )}
                  </td>
                  <td className="p-s2 text-xs">
                    {z.ersetztPosition !== null
                      ? setzeEin(t.ersetzt, { nr: String(z.ersetztPosition) })
                      : (z.ausAngebot ? t.ausAngebot : t.vonHand)}
                    {z.ersetztDurchPosition !== null && (
                      <span className="block text-text-muted" data-cse="leistungszeile-ersetzt">
                        {setzeEin(t.ersetztDurch, { nr: String(z.ersetztDurchPosition) })}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!darfSchreiben ? (
        <p className="max-w-prose text-sm text-text-muted" data-cse="leistungen-ohne-schreibrecht">
          {t.ohneSchreibrecht}
        </p>
      ) : pflegbar && (
        <section aria-labelledby="leistung-neu" className="max-w-prose" data-cse="leistung-neu">
          <h2 id="leistung-neu" className="mb-s3 text-h3 text-text">{t.neuTitel}</h2>
          <p className="mb-s4 text-sm text-text-muted">{t.neuHinweis}</p>
          <form method="post" action="/api/auftrag/leistungen"
                className="flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="vorgang" value="anlegen" />
            <input type="hidden" name="auftragId" value={k.id} />
            <input type="hidden" name="zurueck" value={pfad} />
            <label className="flex flex-col text-sm text-text">
              {t.bezeichnung}
              <input name="bezeichnung" required maxLength={200} className={FELD}
                     defaultValue={eingabe('bezeichnung')} data-cse="leistung-bezeichnung" />
            </label>
            <label className="flex flex-col text-sm text-text">
              {t.beschreibung}
              <textarea name="beschreibung" rows={2} maxLength={2000} className={FELD}
                        defaultValue={eingabe('beschreibung')} />
            </label>
            <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <label className="flex flex-col text-sm text-text">
                {t.menge}
                <input name="menge" required inputMode="decimal" className={FELD}
                       defaultValue={eingabe('menge')} />
              </label>
              <label className="flex flex-col text-sm text-text">
                {t.einheit}
                <select name="einheit" required className={FELD} defaultValue={eingabe('einheit')}>
                  <option value="" disabled>{t.einheitWaehlen}</option>
                  {geladen.einheiten.map((e) => (
                    <option key={e.schluessel} value={e.schluessel}>{e.bezeichnung}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-sm text-text">
                {t.einzelpreis}
                <input name="einzelpreis" required inputMode="decimal" className={FELD}
                       defaultValue={eingabe('einzelpreis')} />
                <span className="mt-s1 text-xs text-text-muted">{t.einzelpreisHinweis}</span>
              </label>
              <label className="flex flex-col text-sm text-text">
                {t.steuersatz}
                <select name="steuersatz" required className={FELD} defaultValue={eingabe('steuersatz')}>
                  <option value="" disabled>{t.steuersatzWaehlen}</option>
                  {geladen.saetze.map((s) => (
                    <option key={s.schluessel} value={s.schluessel}>{s.bezeichnung}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col text-sm text-text">
              {t.gueltigAb}
              <input type="date" name="gueltigAb" required className={FELD}
                     defaultValue={eingabe('gueltigAb', k.heute)} />
            </label>
            <div>
              <Button type="submit" variante="primary" data-cse="leistung-anlegen">{t.anlegenKnopf}</Button>
            </div>
          </form>
        </section>
      )}
    </PortalRahmen>
  );
}
