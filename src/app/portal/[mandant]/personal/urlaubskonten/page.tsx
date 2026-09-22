import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { URLAUBSKONTEN_TEXTE } from '@/lib/i18n/verwaltung/urlaubskonten';
import { formatiereMenge } from '@/server/services/finanz/menge';
import { leseUrlaubskonten } from '@/server/services/zeit/urlaubskonto';

/**
 * `/portal/[mandant]/personal/urlaubskonten` — der Urlaubsanspruch je
 * Anstellung und Jahr (V-117, V-118, EMP-05, § 3 BUrlG).
 *
 * **Gefunden hat den Befund eine Sperrklinke, kein Mensch.**
 * `tests/kern/dienst-verdrahtung.test.ts` fragt, ob jede schreibende
 * Dienstfunktion einen Aufrufer hat — `eroeffneUrlaubskonto` hatte ausser
 * Tests keinen, `setzeAnspruch` überhaupt keinen. Beide sind seit `0061`
 * fertig, und der Anspruch, gegen den jeder Urlaubsantrag rechnet, liess sich
 * nirgends eintragen.
 *
 * **„nicht hinterlegt" steht da, wo es zutrifft, und nicht „0 Tage".** Die
 * beiden sind verschiedene Aussagen: das erste ist eine offene Frage, das
 * zweite eine Auskunft. Wer „Resturlaub: 0" liest, plant sein Jahr danach.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'zeit.schreiben';
const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export const metadata = { title: 'Urlaubskonten' };

interface AnstellungZeile {
  readonly id: string;
  readonly name: string;
}

export default async function Urlaubskonten(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/urlaubskonten`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(URLAUBSKONTEN_TEXTE, zugang.sprache);

  const darf = await haeltRechte(zugang.sitzung, RECHT);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const gespeichert = suche['gespeichert'] === '1';

  const heute = await berlinHeute();
  const jahr = /^\d{4}$/u.test(String(suche['jahr'] ?? ''))
    ? Number(suche['jahr']) : Number(heute.slice(0, 4));

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      konten: await leseUrlaubskonten(kontext, { jahr }),
      /*
       * Die Namen stehen NICHT in `urlaubskonto` — es kennt nur die
       * Anstellung. Die Zuordnung hier statt im Dienst: `leseUrlaubskonten`
       * gehoert der Rechnung, nicht der Anzeige, und ein Name darin machte
       * ihn von `personal.lesen` abhaengig.
       */
      anstellungen: await kontext.abfrage<AnstellungZeile>(
        `select a.id, (p.nachname || ', ' || p.vorname) as name
           from anstellung a join person p on p.id = a.person_id
          where a.geloescht_am is null and a.status = 'aktiv'
          order by p.nachname, p.vorname limit 500`),
    }))) as Promise<{
      konten: Awaited<ReturnType<typeof leseUrlaubskonten>>;
      anstellungen: readonly AnstellungZeile[];
    }>);

  const namen = new Map(daten.anstellungen.map((a) => [a.id, a.name]));

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="personal"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 mt-0 text-h1 text-text">{`${t.titel} ${String(jahr)}`}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      {gespeichert && (
        <Hinweis art="erfolg" cse="anspruch-gespeichert" className="mb-s5 max-w-prose">
          {t.gespeichert}
        </Hinweis>
      )}
      {fehler === null ? null : (
        <Hinweis art="warnung" cse="anspruch-fehler" className="mb-s5 max-w-prose">
          {t.fehler[fehler] ?? fehler}
        </Hinweis>
      )}

      {daten.konten.length === 0 ? (
        <Hinweis art="warnung" cse="keine-urlaubskonten" className="mb-s6 max-w-prose">
          <strong className="block">{t.keine}</strong>
          {t.keineErklaerung}
        </Hinweis>
      ) : (
        <div className="mb-s6">
          <DataTable
            beschriftung={t.titel}
            zeilen={daten.konten}
            schluessel={(k) => k.id}
            spalten={[
              {
                schluessel: 'person', kopf: t.person,
                zelle: (k) => namen.get(k.anstellungId) ?? '—',
              },
              {
                schluessel: 'anspruch', kopf: t.anspruch, numerisch: true,
                /* Die Unterscheidung, um die es geht (O-18). */
                zelle: (k) => (k.anspruchOffen
                  ? <span className="text-warning">{t.anspruchOffen}</span>
                  : formatiereMenge(k.anspruchTage)),
              },
              {
                schluessel: 'uebertrag', kopf: t.uebertrag, numerisch: true,
                zelle: (k) => formatiereMenge(k.uebertragTage),
              },
              {
                schluessel: 'zusatz', kopf: t.zusatz, numerisch: true,
                zelle: (k) => formatiereMenge(k.zusatzTage),
              },
              {
                schluessel: 'genommen', kopf: t.genommen, numerisch: true,
                zelle: (k) => formatiereMenge(k.genommenTage),
              },
              {
                schluessel: 'rest', kopf: t.rest, numerisch: true,
                zelle: (k) => (k.anspruchOffen
                  ? <span className="text-text-subtle">—</span>
                  : <strong>{formatiereMenge(k.restTage)}</strong>),
              },
            ]}
          />
        </div>
      )}

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht}{' '}
          <code className="font-mono">{RECHT}</code>.
        </Hinweis>
      ) : (
        <Card>
          <h2 className="mb-s3 mt-0 text-h3 text-text">{t.eintragenTitel}</h2>
          <p className="mb-s4 max-w-prose text-sm text-text-muted">
            {t.eintragenErklaerung}
          </p>
          <form
            method="post"
            action="/api/personal/urlaubsanspruch"
            data-cse="anspruch-formular"
            className="flex max-w-[56ch] flex-col gap-s4"
          >
            <input type="hidden" name="zurueck" value={`${pfad}?jahr=${String(jahr)}&gespeichert=1`} />
            <input type="hidden" name="fehlerweg" value={`${pfad}?jahr=${String(jahr)}`} />
            <input type="hidden" name="jahr" value={String(jahr)} />
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.person}
              <select name="anstellung" required className={FELD} defaultValue=""
                      data-cse="anspruch-anstellung">
                <option value="" disabled>{t.person}</option>
                {daten.anstellungen.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.anspruch}
              <input type="text" name="anspruch" required inputMode="decimal"
                     maxLength={10} className={FELD} data-cse="anspruch-tage" />
              <span className="text-xs text-text-muted">{t.anspruchErklaerung}</span>
            </label>
            <div className="flex flex-wrap gap-s4">
              <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                {t.uebertrag} <span className="text-text-muted">{t.freiwillig}</span>
                <input type="text" name="uebertrag" inputMode="decimal" maxLength={10}
                       className={FELD} data-cse="anspruch-uebertrag" />
              </label>
              <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                {t.verfaelltAm} <span className="text-text-muted">{t.freiwillig}</span>
                <input type="date" name="verfaellt_am" className={FELD} />
              </label>
            </div>
            <span className="text-xs text-text-muted">{t.uebertragErklaerung}</span>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.zusatz} <span className="text-text-muted">{t.freiwillig}</span>
              <input type="text" name="zusatz" inputMode="decimal" maxLength={10}
                     className={FELD} data-cse="anspruch-zusatz" />
              <span className="text-xs text-text-muted">{t.zusatzErklaerung}</span>
            </label>
            <div>
              <Button type="submit" variante="primary" data-cse="anspruch-speichern">
                {t.speichern}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </PortalRahmen>
  );
}
