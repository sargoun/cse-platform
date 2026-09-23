import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import {
  leseAnweisung, leseFassungen, STATUS_TEXT,
  type AnweisungZeile, type FassungZeile,
} from '@/server/services/security/dienstanweisung';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { kennungOder404 } from '../../../../kennung';

/**
 * `/portal/[mandant]/security/dienstanweisungen/[id]` — der Kopf und seine
 * Fassungen (SEC-06, DOC-05, Abnahme 1).
 *
 * **Jede Fassung bleibt sichtbar, mit ihrem Datum, ihrem Hash und der Zahl
 * ihrer Bestätigungen.** Das ist der Unterschied zwischen „Dokument mit
 * Versionsnummer" und Beweismittel: nach der Freigabe von Fassung 3 muss noch
 * lesbar sein, was Fassung 2 sagte und wer sie bestätigt hat — sonst ist die
 * Frage „was hat Fatima am 3. März bestätigt" nicht mehr beantwortbar.
 *
 * **Der Diff, den die Seitenkarte nennt, ist hier ein NEBENEINANDER.** Zwei
 * Fassungen stehen mit ihrem Text untereinander, und der Änderungshinweis
 * steht an der neueren. Eine zeichenweise Gegenüberstellung ist ein eigenes
 * Bauteil und steht nicht in DESIGN.md; sie hier zu erfinden verstiesse gegen
 * §12 („No component invented ad hoc"). Was der Vergleich beantworten soll —
 * was hat sich geändert — beantwortet der Hinweis genauer, weil ihn ein Mensch
 * geschrieben hat (D-231).
 */
export const dynamic = 'force-dynamic';

export default async function Dienstanweisung(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/security/dienstanweisungen/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const heute = await berlinHeute();
  const { kopf, fassungen } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        kopf: await leseAnweisung(kontext, id),
        fassungen: await leseFassungen(kontext, id),
      }))) as Promise<{
        kopf: AnweisungZeile | null; fassungen: readonly FassungZeile[];
      }>);

  // Kein 403: eine fremde Anweisung ist für diese Anmeldung nicht vorhanden
  // (AUT-06). Der Unterschied wäre die Auskunft, dass es sie gibt.
  if (kopf === null) notFound();

  const feld = 'mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted';
  const eingabe = 'min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'px-s3 py-s2 text-sm text-text';
  const bereich = 'w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 '
    + 'text-sm text-text';

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/security/dienstanweisungen`, text: 'Dienstanweisungen' }}
      titel={kopf.titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstanweisungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.titel}</h1>
        <StatusPill zustand={kopf.status === 'entwurf' ? 'Entwurf' : 'Aktiv'} />
      </div>

      <p className="mb-s5 text-sm text-text-muted">
        {kopf.objekt ?? (kopf.posten ?? 'Gesellschaftsweit')}
        {' · '}
        {STATUS_TEXT[kopf.status]}
        {kopf.kenntnisnahmePflicht ? ' · Kenntnisnahme pflichtig' : ' · ohne Pflicht'}
        {!kopf.neueVersionOeffnetPflicht
          && ' · neue Fassungen verlangen keine neue Bestätigung (O-153)'}
      </p>

      {kopf.kenntnisnahmePflicht && (
        <p className="mb-s5">
          <Link
            href={`/portal/${mandant}/security/dienstanweisungen/${id}/kenntnisnahmen`}
            className="text-base text-text underline-offset-2 hover:text-brand"
            data-cse="kenntnisstand"
          >
            Kenntnisnahmen: <span className="cse-zahl">{kopf.bestaetigt}</span>
            {' von '}<span className="cse-zahl">{kopf.pflichtig}</span> →
          </Link>
        </p>
      )}

      <h2 className="mb-s3 text-h2 text-text">Fassungen</h2>
      <ul className="m-0 mb-s6 list-none p-0">
        {fassungen.map((f) => (
          <li
            key={f.id}
            data-cse="fassung"
            data-fassung={f.id}
            data-version={f.version}
            data-aktiv={f.istAktiv ? 'ja' : 'nein'}
            className="mb-s3 rounded-lg border border-line bg-surface p-s4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-s3">
              <h3 className="m-0 text-h3 text-text">
                Fassung <span className="cse-zahl">{f.version}</span>
              </h3>
              <StatusPill
                zustand={f.istAktiv ? 'Aktiv' : (f.veroeffentlicht ? 'Archiviert' : 'Entwurf')}
              />
            </div>
            <p className="m-0 mt-s2 text-sm text-text-muted">
              Gilt ab <span className="cse-zahl">{f.gueltigAb}</span>
              {f.veroeffentlichtLokal !== null && (
                <> · freigegeben <span className="cse-zahl">{f.veroeffentlichtLokal}</span></>
              )}
              {' · '}
              <span className="cse-zahl">{f.kenntnisnahmen}</span> Bestätigungen
              {f.sprachen.length > 0 && ` · Übersetzt: ${f.sprachen.join(', ')}`}
            </p>
            {f.aenderungshinweis !== null && (
              <p className="m-0 mt-s2 text-sm text-text">{f.aenderungshinweis}</p>
            )}
            {f.inhalt !== null && (
              <p className="mt-s3 whitespace-pre-wrap text-base text-text">{f.inhalt}</p>
            )}
            {/*
              Der Digest steht auf dem Bildschirm, weil die Kenntnisnahme ihn
              KOPIERT. Wer in drei Jahren fragt, was bestätigt wurde, vergleicht
              zwei Zeichenfolgen — nicht zwei Erinnerungen.
            */}
            <p className="m-0 mt-s3 break-all text-micro text-text-subtle">
              <span className={feld}>Prüfsumme</span>
              <span className="cse-zahl" data-cse="inhalt-hash">{f.inhaltHash}</span>
            </p>

            {!f.veroeffentlicht && (
              <form
                action={`/api/sicherheit/dienstanweisungen/${id}/version`}
                method="post"
                className="mt-s4"
              >
                <input type="hidden" name="mandant" value={mandant} />
                <input type="hidden" name="fassung" value={f.id} />
                <Button type="submit" variante="secondary">Fassung freigeben</Button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <h2 className="mb-s2 text-h2 text-text">Neue Fassung</h2>
      <p className="mb-s4 max-w-prose text-sm text-text-muted">
        Eine veröffentlichte Fassung wird nicht geändert — die Datenbank weist
        das ab. Eine Änderung ist eine neue Fassung: sie bekommt die nächste
        Nummer, und jede frühere Bestätigung ist damit veraltet. Die alten
        Zeilen bleiben unverändert stehen.
      </p>

      <form
        action={`/api/sicherheit/dienstanweisungen/${id}/version`}
        method="post"
        className="max-w-prose rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="mandant" value={mandant} />

        <label className="mb-s4 block">
          <span className={feld}>Gilt ab</span>
          <input
            name="gueltig_ab" type="date" required className={eingabe}
            defaultValue={heute}
          />
        </label>

        <label className="mb-s4 block">
          <span className={feld}>Text (deutsch)</span>
          <textarea name="inhalt" rows={10} required className={bereich} />
        </label>

        <label className="mb-s3 block">
          <span className={feld}>English</span>
          <textarea name="inhalt_en" rows={3} className={bereich} />
        </label>
        <label className="mb-s3 block">
          <span className={feld}>العربية</span>
          <textarea name="inhalt_ar" rows={3} dir="rtl" className={bereich} />
        </label>
        <label className="mb-s4 block">
          <span className={feld}>Türkçe</span>
          <textarea name="inhalt_tr" rows={3} className={bereich} />
        </label>

        <label className="mb-s4 block">
          <span className={feld}>Was hat sich geändert?</span>
          <input
            name="aenderungshinweis" maxLength={200} className={eingabe}
            placeholder="Neuer Alarmweg, Abschnitt 4"
          />
        </label>

        <label className="mb-s5 flex items-center gap-s2 text-sm text-text">
          <input
            type="checkbox" name="veroeffentlichen" value="1" defaultChecked
            className="min-h-6 min-w-6"
          />
          Sofort freigeben — jede frühere Bestätigung wird damit veraltet
        </label>

        <Button type="submit" variante="primary">Fassung anlegen</Button>
      </form>
    </PortalRahmen>
  );
}
