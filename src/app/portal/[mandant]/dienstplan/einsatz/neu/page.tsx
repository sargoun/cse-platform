import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { SCHICHT_TEXTE } from '@/lib/i18n/verwaltung/dienstplan-schicht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { LeistungsankerFeld } from '@/components/portal/LeistungsankerFeld';
import { LEISTUNGSANKER_TEXTE } from '@/lib/i18n/verwaltung/leistungsanker';
import {
  ANKERBARE_AUFTRAGSZUSTAENDE, listeAnkerbareLeistungen, type AnkerbareLeistung,
} from '@/server/services/dienstplan/leistungsanker';

/**
 * `/portal/[mandant]/dienstplan/einsatz/neu` — eine einzelne Schicht
 * (V-013, TIM-01, TIM-04).
 *
 * **Warum diese Seite überhaupt existiert.** `einsatz.quelle` kennt seit
 * `0028` den Wert `manuell`, und ein Auslöser vergibt für eine schlüssellose
 * Zeile eigens `manuell:<id>` — die Datenbank war vorbereitet, nur legte
 * niemand eine an. Ein Einsatz entstand aus einer Serie, aus einer
 * Veranstaltung oder gar nicht; wer eine Sonderreinigung am Samstag planen
 * wollte, musste eine Serie anlegen, die ab Montag weitergeneriert.
 *
 * **Nur Objekte MIT Kunden stehen zur Wahl.** `kern.einsatz_kunde_setzen`
 * leitet den Kunden aus dem Objekt ab und wirft, wenn keiner da ist. Ein
 * Formular, das die Wahl anbietet und danach abweist, ist eine Falle; die
 * Seite nennt die kundenlosen Objekte trotzdem — abgeblendet, mit dem Grund
 * daneben, statt sie zu verschweigen.
 *
 * **Die Leistungszeile ist der Abrechnungsanker** (V-191, TIM-12). Der
 * Zeiteintrag erbt sie von der Schicht — und nur sie; der Auftrag allein
 * bringt keine Stunde in eine Abrechnung. Das Feld steht nur für den, der
 * Aufträge lesen darf; ohne das Recht sagt die Seite es, statt eine leere
 * Liste zu zeigen.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'dienstplan.schreiben';
const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

interface ObjektZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly hat_kunde: boolean;
}
interface RevierZeile {
  readonly id: string; readonly bezeichnung: string; readonly objekt: string;
}
interface AuftragZeile {
  readonly id: string; readonly nummer: string; readonly bezeichnung: string | null;
}

export default async function NeueSchicht(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/dienstplan/einsatz/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(SCHICHT_TEXTE, zugang.sprache);
  const darf = await haeltRechte(zugang.sitzung, RECHT, 'auftrag.lesen');
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const tagRoh = typeof suche['tag'] === 'string' ? suche['tag'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [heute] = await kontext.abfrage<{ tag: string }>(
        `select app.berlin_heute()::text as tag`);
      return {
        heute: heute?.tag ?? '',
        objekte: await kontext.abfrage<ObjektZeile>(
          `select id, bezeichnung, (kunde_id is not null) as hat_kunde
             from objekt where archiviert_am is null
            order by (kunde_id is null), bezeichnung limit 300`),
        reviere: await kontext.abfrage<RevierZeile>(
          `select r.id, r.bezeichnung, o.bezeichnung as objekt
             from revier r join objekt o on o.id = r.objekt_id and o.mandant_id = r.mandant_id
            where r.archiviert_am is null and o.archiviert_am is null
            order by o.bezeichnung, r.sortierung, r.bezeichnung limit 300`),
        /*
         * Dieselben Zustände wie die Leistungszeile derselben Maske (V-192,
         * O-927) — vorher nahm die Zeile auch `angelegt` und `abgeschlossen`.
         */
        auftraege: await kontext.abfrage<AuftragZeile>(
          `select id, auftragsnummer as nummer, bezeichnung
             from auftrag where status::text = any($1::text[])
            order by auftragsnummer desc limit 200`, [[...ANKERBARE_AUFTRAGSZUSTAENDE]]),
        leistungen: darf['auftrag.lesen'] === true ? await listeAnkerbareLeistungen(kontext) : null,
      };
    })) as Promise<{
      heute: string; objekte: readonly ObjektZeile[];
      reviere: readonly RevierZeile[]; auftraege: readonly AuftragZeile[];
      leistungen: readonly AnkerbareLeistung[] | null;
    }>);

  const plan = `/portal/${mandant}/dienstplan/tag`;
  const tag = tagRoh !== null && /^\d{4}-\d{2}-\d{2}$/u.test(tagRoh) ? tagRoh : daten.heute;
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong '
    + 'px-s5 py-s3 text-sm text-text hover:bg-surface-2';
  const mitKunde = daten.objekte.filter((o) => o.hat_kunde);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: plan, text: t.abbrechen }}
    >
      <div className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.titel}</h1>
        <Link href={`/portal/${mandant}/dienstplan/tag`} className={knopf}>{t.zumPlan}</Link>
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      <Hinweis art="hinweis" cse="schicht-warum" className="mb-s6 max-w-prose">
        {t.warum}
      </Hinweis>

      {fehler !== null ? (
        <Hinweis art="warnung" cse="schicht-fehler" className="mb-s5 max-w-prose">
          {eigenerEintrag(t.fehler, fehler)
            ?? eigenerEintrag(nachSprache(LEISTUNGSANKER_TEXTE, zugang.sprache).fehler, fehler)
            ?? t.fehlerSonst}
        </Hinweis>
      ) : null}

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht} <Recht schluessel={RECHT} sprache={zugang.sprache} />.
        </Hinweis>
      ) : mitKunde.length === 0 ? (
        <Hinweis art="warnung" cse="keine-objekte" className="max-w-prose">
          {t.keineObjekte}
        </Hinweis>
      ) : (
        <Card>
          <form method="post" action="/api/dienstplan/einsatz" data-cse="schicht-formular"
                className="flex max-w-[60ch] flex-col gap-s5">
            <input type="hidden" name="aktion" value="anlegen" />
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="zurueck" value={plan} />
            <input type="hidden" name="fehlerweg" value={pfad} />

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.objekt}
              <select name="objekt" required className={FELD} defaultValue=""
                      data-cse="schicht-objekt">
                <option value="" disabled>{t.objektWaehlen}</option>
                {daten.objekte.map((o) => (
                  <option key={o.id} value={o.id} disabled={!o.hat_kunde}>
                    {o.bezeichnung}{o.hat_kunde ? '' : ` · ${t.ohneKunde}`}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.datum}
                <input type="date" name="datum" required className={FELD}
                       defaultValue={tag} data-cse="schicht-datum" />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.beginn}
                <input type="time" name="beginn" required className={FELD}
                       data-cse="schicht-beginn" />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.ende}
                <input type="time" name="ende" required className={FELD}
                       data-cse="schicht-ende" />
              </label>
            </div>

            <label className="flex items-start gap-s3 text-sm text-text">
              <input type="checkbox" name="folgetag" value="1" className="mt-s1 min-h-5 min-w-5"
                     data-cse="schicht-folgetag" />
              <span>
                {t.folgetag}
                <span className="mt-s1 block text-xs text-text-muted">{t.folgetagErklaerung}</span>
              </span>
            </label>

            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.soll}
                <input type="number" name="soll" min={1} max={99} defaultValue={1} required
                       className={FELD} data-cse="schicht-soll" />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.min}
                <input type="number" name="min" min={1} max={99} defaultValue={1} required
                       className={FELD} data-cse="schicht-min" />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.pause} <span className="text-text-muted">{t.minuten}</span>
                <input type="number" name="pause" min={0} max={1439} defaultValue={0}
                       className={FELD} data-cse="schicht-pause" />
              </label>
            </div>
            <p className="m-0 -mt-s3 max-w-prose text-xs text-text-muted">
              {t.besetzungErklaerung}
            </p>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.revier} <span className="text-text-muted">{t.freiwillig}</span>
              <select name="revier" className={FELD} defaultValue="" data-cse="schicht-revier">
                <option value="">{t.ohneRevier}</option>
                {daten.reviere.map((r) => (
                  <option key={r.id} value={r.id}>{r.objekt} · {r.bezeichnung}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.auftrag} <span className="text-text-muted">{t.freiwillig}</span>
              <select name="auftrag" className={FELD} defaultValue="" data-cse="schicht-auftrag">
                <option value="">{t.ohneAuftrag}</option>
                {daten.auftraege.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nummer}{a.bezeichnung === null ? '' : ` · ${a.bezeichnung}`}
                  </option>
                ))}
              </select>
              <span className="text-xs text-text-muted">{t.auftragErklaerung}</span>
            </label>

            <LeistungsankerFeld leistungen={daten.leistungen} gewaehlt={null}
                                sprache={zugang.sprache} feldKlasse={FELD} />

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.notiz} <span className="text-text-muted">{t.freiwillig}</span>
              <input type="text" name="notiz" maxLength={300} className={FELD}
                     data-cse="schicht-notiz" />
              <span className="text-xs text-text-muted">{t.notizErklaerung}</span>
            </label>

            <div className="flex flex-wrap gap-s3">
              <Button type="submit" variante="primary" data-cse="schicht-anlegen">
                {t.anlegen}
              </Button>
              <Link href={`/portal/${mandant}/dienstplan/tag`} className={knopf}>{t.abbrechen}</Link>
            </div>
          </form>
        </Card>
      )}
    </PortalRahmen>
  );
}
