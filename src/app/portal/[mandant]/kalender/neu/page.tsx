import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import type { BereichSchluessel } from '@/lib/design/theme';
import { internSprache } from '@/lib/i18n/intern';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KALENDER_TERMIN_TEXTE } from '@/lib/i18n/verwaltung/kalender-termin';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { vorbelegt } from '@/lib/formular/maske';
import { haeltRechte } from '@/app/portal/rechte';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { MandantAntwort, mandantTor } from '../../../unterseite';
import { TerminFormular } from '../TerminFormular';

/**
 * `/portal/[mandant]/kalender/neu` — einen eigenen Termin anlegen (CAL-01,
 * V-221, D-715).
 *
 * **Warum es diese Seite gibt.** `kalender_eintrag` kennt seit 0160
 * Besprechung, Kundentermin und sonstigen Termin — und kein Bildschirm legte
 * einen an. Meetings und Kundentermine aus CAL-01 entstanden nur im Seed.
 *
 * **Nur was der Kalender besitzt.** Schichten, Wiedervorlagen und
 * Bewerbungsgespräche haben ihre eigene Quelle; die Seite sagt das, statt
 * eine zweite Wahrheit über sie anzulegen.
 *
 * Zweisprachig von Anfang an (D-592): jedes sichtbare Wort kommt aus
 * `verwaltung/kalender-termin.ts`.
 */
export const dynamic = 'force-dynamic';

export default async function NeuerTermin({ params, searchParams }: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const suche = await searchParams;
  const tor = await mandantTor(`/portal/${mandant}/kalender/neu`, mandant);
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const sprache = internSprache(zugang.sprache);
  const t = nachSprache(KALENDER_TERMIN_TEXTE, sprache);
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  /*
   * Die Namen der anderen liest nur, wer `system.benutzer_lesen` hält — ohne
   * es führt der Termin allein, wer ihn anlegt (dieselbe Grenze wie bei der
   * Wiedervorlage im CRM). Die Auswahl zeigt nur, was der Dienst annimmt.
   */
  const darf = await haeltRechte(zugang.sitzung, 'system.benutzer_lesen');
  const benutzer = darf['system.benutzer_lesen'] !== true ? null
    : await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, (kontext) => kontext.abfrage<{ id: string; name: string }>(
        `select distinct b.id, b.name
           from benutzer b
           join benutzer_mandant bm on bm.benutzer_id = b.id
          where bm.mandant_id = app.aktiver_mandant() and bm.entzogen_am is null
            and b.status = 'aktiv' and b.ist_dienstkonto = false
            and b.id <> app.aktueller_benutzer()
          order by b.name`))) as Promise<readonly { id: string; name: string }[]>);

  return (
    <PortalRahmen
      titel={t.neuTitel}
      wurzelTitel={t.zumKalender}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="kalender"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5">
        <Link href={alsRoute(`/portal/${mandant}/kalender`)} data-cse="zum-kalender"
              className="text-sm text-text underline underline-offset-2">
          {t.zumKalender}
        </Link>
      </div>
      <h1 className="mb-s3 text-h1 text-text">{t.neuTitel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.neuEinleitung}</p>

      {fehler !== null && (
        <Hinweis art="warnung" cse="termin-fehler" className="mb-s5 max-w-prose">
          <strong>{t.nichtGespeichert}</strong>{' '}
          {eigenerEintrag(t.fehler, fehler) ?? t.fehlerSonst}
        </Hinweis>
      )}

      {benutzer === null && (
        <p className="mb-s4 max-w-prose text-xs text-text-muted" data-cse="termin-ohne-namen">
          {t.teilnehmendeOhneRecht}{' '}
          <Recht schluessel="system.benutzer_lesen" sprache={sprache} />
        </p>
      )}

      <TerminFormular
        t={t}
        aktion="/api/kalender/eintraege"
        zurueck={`/portal/${mandant}/kalender/neu`}
        benutzer={benutzer ?? []}
        werte={{
          art: vorbelegt(suche, 'art') ?? 'besprechung',
          titel: vorbelegt(suche, 'titel') ?? '',
          ort: vorbelegt(suche, 'ort') ?? '',
          beschreibung: vorbelegt(suche, 'beschreibung') ?? '',
          ganztaegig: vorbelegt(suche, 'ganztaegig') === 'ja',
          beginn: vorbelegt(suche, 'beginn') ?? '',
          ende: vorbelegt(suche, 'ende') ?? '',
          vonTag: vorbelegt(suche, 'vonTag') ?? '',
          bisTag: vorbelegt(suche, 'bisTag') ?? '',
          teilnehmer: [],
        }}
        knopf={t.anlegen}
        cse="termin-neu"
      />
    </PortalRahmen>
  );
}
