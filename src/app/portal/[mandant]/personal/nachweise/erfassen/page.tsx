import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { NACHWEIS_ERFASSEN_TEXTE } from '@/lib/i18n/verwaltung/personal-nachweis';

/**
 * `/portal/[mandant]/personal/nachweise/erfassen` — einen
 * Qualifikationsnachweis aufnehmen (V-010, SEC-02, SEC-03, EMP-08, DOC-01,
 * § 34a GewO).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum diese Seite fehlte — und was das im Betrieb hiess.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0030` baut das Register vollständig: Qualifikationen, Nachweise, drei
 * Warnstufen, das Quittungsbuch, die Dokumentpflicht als Auslöser, der
 * nächtliche Statuslauf. Zwei Seiten lasen es, ein Nachtlauf warnte, das
 * Einsatztor sperrte.
 *
 * **Aufnehmen konnte es niemand.** Die Plattform konnte vor einer ablaufenden
 * Sachkunde warnen und eine Schicht ohne sie sperren — und die Zeile, vor der
 * sie warnt, entstand nirgends ausser im Seed. Für ein Sicherheitsunternehmen
 * ist das kein fehlendes Formular, sondern ein Register ohne Eingang.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Nachweis hängt am MENSCHEN.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `person_id`, nie `anstellung_id` (Invariante 9, D-09). Eine Sachkunde gilt
 * der Person; wer in zwei Gesellschaften beschäftigt ist, hat sie einmal.
 * Deshalb steht in der Auswahl der MENSCH und nicht die Beschäftigung —
 * `erfasst_von_mandant_id` trägt danach, wer aufgenommen hat.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Nachweis aufnehmen — Personal' };

const RECHT = 'personal.nachweis_verwalten';
const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

interface Auswahl { readonly id: string; readonly text: string }
interface QualiAuswahl extends Auswahl {
  readonly erfordert_dokument: boolean;
  readonly laeuft_ab: boolean;
  readonly monate: number | null;
}

export default async function NachweisErfassen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/nachweise/erfassen`;
  const register = `/portal/${mandant}/personal/nachweise`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(NACHWEIS_ERFASSEN_TEXTE, zugang.sprache);

  const darf = await haeltRechte(zugang.sitzung, RECHT);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      /*
       * **Die Menschen dieser Gesellschaft, nicht ihre Beschäftigungen.**
       * Wer zweimal beschäftigt ist, steht einmal in der Liste — sonst
       * entstünde derselbe Nachweis zweimal, und `nachweis_aktiv_uk` wiese
       * den zweiten erst beim Speichern ab.
       */
      personen: await kontext.abfrage<Auswahl>(
        `select distinct p.id,
                trim(coalesce(p.vorname,'') || ' ' || p.nachname) as text
           from person p
           join anstellung a on a.person_id = p.id
          where a.mandant_id = app.aktiver_mandant()
            -- Die Spalte heisst austritt (0002). Hier stand ausgeschieden_am,
            -- das es auf anstellung nicht gibt: die Seite endete fuer JEDEN
            -- Aufruf mit 500 — gefunden vom Durchlauf gegen den Produktionsbau.
            and a.geloescht_am is null
            and (a.austritt is null or a.austritt >= current_date)
          order by text limit 500`),
      qualifikationen: await kontext.abfrage<QualiAuswahl>(
        `select id, bezeichnung as text, erfordert_dokument, laeuft_ab,
                standard_gueltigkeit_monate as monate
           from qualifikation
          where archiviert_am is null
          order by bezeichnung limit 200`),
      dokumente: await kontext.abfrage<Auswahl>(
        `select id, titel as text from dokument
          where mandant_id = app.aktiver_mandant()
            and kategorie = 'mitarbeiter' and geloescht_am is null
          order by entstanden_am desc limit 200`),
    }))) as Promise<{
      personen: readonly Auswahl[];
      qualifikationen: readonly QualiAuswahl[];
      dokumente: readonly Auswahl[];
    }>);

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
      zurueck={{ ziel: register, text: t.abbrechen }}
    >
      <h1 className="mb-s2 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      <Hinweis art="hinweis" cse="nachweis-warum" className="mb-s6 max-w-prose">
        {t.warum}
      </Hinweis>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="nachweis-fehler" className="mb-s5 max-w-prose">
          {t.fehler[fehler] ?? fehler}
        </Hinweis>
      )}

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht} <Recht schluessel={RECHT} sprache={zugang.sprache} />.
        </Hinweis>
      ) : daten.personen.length === 0 ? (
        <Hinweis art="warnung" cse="keine-personen" className="max-w-prose">
          {t.keinePersonen}
        </Hinweis>
      ) : daten.qualifikationen.length === 0 ? (
        <Hinweis art="warnung" cse="keine-qualifikationen" className="max-w-prose">
          {t.keineQualifikationen}
        </Hinweis>
      ) : (
        <Card>
          <form method="post" action="/api/personal/nachweise"
                data-cse="nachweis-formular"
                className="flex max-w-[60ch] flex-col gap-s5">
            <input type="hidden" name="aktion" value="aufnehmen" />
            <input type="hidden" name="zurueck" value={register} />
            <input type="hidden" name="fehlerweg" value={pfad} />

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.person}
              <select name="person" required className={FELD} defaultValue=""
                      data-cse="nachweis-person">
                <option value="" disabled>{t.personWaehlen}</option>
                {daten.personen.map((p) => (
                  <option key={p.id} value={p.id}>{p.text}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.qualifikation}
              <select name="qualifikation" required className={FELD} defaultValue=""
                      data-cse="nachweis-qualifikation">
                <option value="" disabled>{t.qualifikationWaehlen}</option>
                {daten.qualifikationen.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.text}
                    {q.erfordert_dokument ? ` · ${t.erfordertDokument}` : ''}
                    {q.laeuft_ab && q.monate !== null
                      ? ` · ${t.laeuftAb} (${String(q.monate)})`
                      : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.gueltigAb}
                <input type="date" name="gueltig_ab" required className={FELD}
                       data-cse="nachweis-gueltig-ab" />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.gueltigBis} <span className="text-text-muted">{t.freiwillig}</span>
                <input type="date" name="gueltig_bis" className={FELD}
                       data-cse="nachweis-gueltig-bis" />
              </label>
            </div>
            <p className="m-0 -mt-s3 max-w-prose text-xs text-text-muted">
              {t.gueltigBisErklaerung}
            </p>

            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.nummer} <span className="text-text-muted">{t.freiwillig}</span>
                <input type="text" name="nummer" maxLength={80} className={FELD}
                       placeholder={t.nummerBeispiel} data-cse="nachweis-nummer" />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.stelle} <span className="text-text-muted">{t.freiwillig}</span>
                <input type="text" name="stelle" maxLength={120} className={FELD}
                       placeholder={t.stelleBeispiel} data-cse="nachweis-stelle" />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.ausgestelltAm} <span className="text-text-muted">{t.freiwillig}</span>
                <input type="date" name="ausgestellt_am" className={FELD}
                       data-cse="nachweis-ausgestellt" />
              </label>
            </div>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.dokument}
              <select name="dokument" className={FELD} defaultValue=""
                      data-cse="nachweis-dokument">
                <option value="">{t.ohneDokument}</option>
                {daten.dokumente.map((d) => (
                  <option key={d.id} value={d.id}>{d.text}</option>
                ))}
              </select>
              <span className="text-xs text-text-muted">{t.dokumentErklaerung}</span>
            </label>

            <div>
              <Button type="submit" variante="primary" data-cse="nachweis-speichern">
                {t.speichern}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </PortalRahmen>
  );
}
