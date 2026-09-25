import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import type { BereichSchluessel } from '@/lib/design/theme';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { MandantAntwort, mandantTor } from '../../../unterseite';
import { Button } from '@/components/ui/Button';
import { Recht } from '@/components/ui/Recht';
import { haeltRechte } from '@/app/portal/rechte';
import { internSprache } from '@/lib/i18n/intern';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KALENDER_TERMIN_TEXTE } from '@/lib/i18n/verwaltung/kalender-termin';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { berlinFormularWert } from '@/lib/datum/formularzeit';
import { berlinKalendertag } from '@/server/services/zeit/dauer';
import { istEigeneArt } from '@/server/services/kalender/termin';
import { TerminFormular } from '../TerminFormular';

/**
 * `/portal/[mandant]/kalender/[id]` — ein Termin (CAL-01).
 *
 * **Nur Termine, die der Kalender BESITZT.** Eine Schicht hat hier keine
 * Detailseite: sie gehört dem Dienstplan, und ihr Eintrag im Kalender
 * verlinkt dorthin. Zwei Detailseiten für dieselbe Schicht wären zwei Orte,
 * an denen jemand sie zu ändern versucht — und nur einer von beiden wäre der
 * richtige.
 *
 * **Die UUID wird geprüft, bevor sie in eine Abfrage geht.** Ein Segment aus
 * der Adresse ist Eingabe; `$1::uuid` auf einem Nicht-UUID wirft einen
 * Datenbankfehler, und ein Datenbankfehler auf einer Seite ist eine
 * Fehlerseite statt eines 404 (AUT-06).
 */
export const dynamic = 'force-dynamic';

const IST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface Zeile {
  readonly id: string;
  readonly art: string;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly ort: string | null;
  readonly beginn: string;
  readonly ende: string;
  readonly ganztaegig: boolean;
  readonly abgesagt_am: string | null;
  readonly abgesagt_grund: string | null;
  readonly besitzer: string | null;
  readonly teilnehmer_namen: readonly string[];
  /** V-221: die Kennungen der Teilnehmenden — für das Formular „Termin ändern". */
  readonly teilnehmer: readonly string[];
}

const ART_WORT: Readonly<Record<string, string>> = {
  besprechung: 'Besprechung',
  kundentermin: 'Kundentermin',
  wiedervorlage: 'Wiedervorlage',
  bewerbungsgespraech: 'Bewerbungsgespräch',
  sonstiges: 'Termin',
};

function spanne(z: Zeile): string {
  const tag = new Intl.DateTimeFormat('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Europe/Berlin',
  });
  const zeit = new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  });
  const von = new Date(z.beginn);
  const bis = new Date(z.ende);
  if (z.ganztaegig) {
    /*
     * **Das Ende ist der Tag DANACH** (Migration 0160, wie in iCal). Ein
     * ganztaegiger Termin vom 12. bis 14. hat `ende` am 15.: eine Sekunde
     * abziehen macht daraus wieder den letzten Tag, an dem er faellt. Vorher
     * stand hier nur der Beginn -- ein dreitaegiger Termin sah aus wie ein
     * eintaegiger, und zwar ohne jeden Hinweis darauf.
     */
    const letzter = new Date(bis.getTime() - 1);
    return tag.format(von) === tag.format(letzter)
      ? `${tag.format(von)} · ganztägig`
      : `${tag.format(von)} – ${tag.format(letzter)} · ganztägig`;
  }
  const gleicherTag = tag.format(von) === tag.format(bis);
  return gleicherTag
    ? `${tag.format(von)}, ${zeit.format(von)} – ${zeit.format(bis)} Uhr`
    : `${tag.format(von)}, ${zeit.format(von)} Uhr – ${tag.format(bis)}, `
      + `${zeit.format(bis)} Uhr`;
}

export default async function Termin({ params, searchParams }: {
  params: Promise<{ mandant: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  /* V-221: die Rückmeldung der Routen `api/kalender/eintraege[/id]` — ein Schlüssel oder nichts. */
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const erledigt = suche['erledigt'] === 'angelegt' || suche['erledigt'] === 'geaendert'
    || suche['erledigt'] === 'abgesagt' ? suche['erledigt'] : null;
  /*
   * **Hier steht mit Absicht KEIN `kennungOder404`.**
   *
   * Es stand hier, und es hat eine Zusage dieser Seite gebrochen: „ein
   * fremder oder erfundener Termin ist eine Auskunft, kein Fehler". Eine
   * Kennung, die gar keine UUID ist, ist von aussen nicht davon zu
   * unterscheiden, dass der Termin einer anderen Gesellschaft gehört — und
   * genau diese Ununterscheidbarkeit ist AUT-06. Ein 404 daraus zu machen
   * hiesse, zwei Fälle verschieden zu beantworten, die gleich aussehen
   * müssen.
   *
   * Vor dem Datenbankfehler schützt diese Seite selbst: die Abfrage unten
   * läuft nur bei gültiger Kennung und antwortet sonst `null` — womit der
   * Hinweis „Diesen Termin gibt es nicht" erscheint, der hier hingehört.
   */
  /*
   * Der KONKRETE Pfad, nicht das Routenmuster -- wie auf jeder anderen
   * Detailseite (`angebote/[id]` und die uebrigen). `zugang.pfad` wird zum
   * `zurueck` des Wechselblatts, und `rueckwegImBereich` weist einen Pfad mit
   * eckigen Klammern ab: der Rueckweg fiel still weg, und wer die Gesellschaft
   * wechselte, landete auf der Uebersicht statt wieder hier.
   */
  const tor = await mandantTor(`/portal/${mandant}/kalender/${id}`, mandant);
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const zeile = !IST_UUID.test(id) ? null : await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, zugang.sitzung, async (kontext) => {
      const [k] = await kontext.abfrage<Zeile>(
        `select k.id::text as id, k.art::text as art, k.titel, k.beschreibung, k.ort,
                k.beginn::text as beginn, k.ende::text as ende, k.ganztaegig,
                k.abgesagt_am::text as abgesagt_am, k.abgesagt_grund,
                (select b.name from benutzer b where b.id = k.besitzer_benutzer_id)
                  as besitzer,
                coalesce((select array_agg(b.name order by b.name)
                            from benutzer b where b.id = any (k.teilnehmer)), '{}')
                  as teilnehmer_namen,
                k.teilnehmer::text[] as teilnehmer
           from kalender_eintrag k
          where k.id = $1::uuid`, [id]);
      return k ?? null;
    }))) as Zeile | null;

  const sprache = internSprache(zugang.sprache);
  const t = nachSprache(KALENDER_TERMIN_TEXTE, sprache);
  /*
   * V-221: ändern und absagen darf, wer Termine setzt (`kalender.schreiben`,
   * dieselbe Schranke wie `t_kalender_schreiben`, 0160) — und nur, was der
   * Kalender selbst besitzt. Die Namen der anderen für die Teilnehmerauswahl
   * nur mit `system.benutzer_lesen`.
   */
  const darf = await haeltRechte(zugang.sitzung, 'kalender.schreiben', 'system.benutzer_lesen');
  const benutzer = zeile === null || darf['system.benutzer_lesen'] !== true
    || !istEigeneArt(zeile.art) || zeile.abgesagt_am !== null ? []
    : await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, (kontext) => kontext.abfrage<{ id: string; name: string }>(
        `select distinct b.id, b.name
           from benutzer b
           join benutzer_mandant bm on bm.benutzer_id = b.id
          where bm.mandant_id = app.aktiver_mandant() and bm.entzogen_am is null
            and b.status = 'aktiv' and b.ist_dienstkonto = false
            and b.id <> app.aktueller_benutzer()
          order by b.name`))) as Promise<readonly { id: string; name: string }[]>);

  const rahmen = (kinder: React.ReactNode) => (
    <PortalRahmen
      titel={zeile?.titel ?? 'Termin'}
      wurzelTitel="Kalender"
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
          Zum Kalender
        </Link>
      </div>
      {kinder}
    </PortalRahmen>
  );

  /*
   * **Nicht gefunden und nicht sichtbar sind DASSELBE** (AUT-06). Ein Termin
   * einer anderen Gesellschaft darf sich nicht dadurch verraten, dass die
   * Antwort „kein Zugriff" statt „gibt es nicht" lautet.
   */
  if (zeile === null) {
    return rahmen(
      <Hinweis art="warnung" cse="termin-fehlt" className="max-w-prose">
        Diesen Termin gibt es nicht — oder er gehört einer anderen Gesellschaft.
        Beides sieht von hier aus gleich aus, und das ist Absicht.
      </Hinweis>,
    );
  }

  const zurueck = `/portal/${mandant}/kalender/${zeile.id}`;
  const letzterTag = new Date(new Date(zeile.ende).getTime() - 1);

  return rahmen(
    <>
    {erledigt !== null && (
      <Hinweis art="erfolg" cse="termin-erledigt" className="mb-s5 max-w-prose">
        {erledigt === 'angelegt' ? t.angelegt : erledigt === 'geaendert' ? t.geaendert : t.abgesagt}
      </Hinweis>
    )}
    {fehler !== null && (
      <Hinweis art="warnung" cse="termin-fehler" className="mb-s5 max-w-prose">
        <strong>{t.nichtGespeichert}</strong>{' '}
        {eigenerEintrag(t.fehler, fehler) ?? t.fehlerSonst}
      </Hinweis>
    )}
    <article className="max-w-prose">
      <p className="text-xs font-semibold uppercase tracking-widest text-text-subtle"
         data-cse="termin-art">
        {ART_WORT[zeile.art] ?? 'Termin'}
      </p>
      <h1 className={`mt-s1 text-h1 ${zeile.abgesagt_am === null
        ? 'text-text' : 'text-text-subtle line-through'}`} data-cse="termin-titel">
        {zeile.titel}
      </h1>
      <p className="mt-s2 text-sm text-text-muted" data-cse="termin-zeit">{spanne(zeile)}</p>

      {zeile.abgesagt_am !== null && (
        <Hinweis art="warnung" cse="termin-abgesagt" className="mt-s4">
          <strong>Abgesagt.</strong> {zeile.abgesagt_grund}
          {' '}Der Termin bleibt stehen, damit jeder, der ihn im Kalender hat, die Absage
          sieht — ein gelöschter Termin verschwindet stillschweigend.
        </Hinweis>
      )}

      <dl className="mt-s6 grid gap-s4 sm:grid-cols-2">
        {zeile.ort !== null && zeile.ort !== '' && (
          <div>
            <dt className="text-xs uppercase tracking-widest text-text-subtle">Ort</dt>
            <dd className="mt-s1 text-sm text-text" data-cse="termin-ort">{zeile.ort}</dd>
          </div>
        )}
        {zeile.besitzer !== null && (
          <div>
            <dt className="text-xs uppercase tracking-widest text-text-subtle">Führt</dt>
            <dd className="mt-s1 text-sm text-text">{zeile.besitzer}</dd>
          </div>
        )}
        {zeile.teilnehmer_namen.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-widest text-text-subtle">Teilnehmende</dt>
            <dd className="mt-s1 text-sm text-text">{zeile.teilnehmer_namen.join(' · ')}</dd>
          </div>
        )}
      </dl>

      {zeile.beschreibung !== null && zeile.beschreibung !== '' && (
        <p className="mt-s6 whitespace-pre-line text-sm text-text-muted"
           data-cse="termin-beschreibung">
          {zeile.beschreibung}
        </p>
      )}
    </article>

    {/* ------------------------------------ Termin ändern und absagen (V-221) */}
    {/*
      * **Der Schreibweg, den es nicht gab.** Besprechungen und Kundentermine
      * entstanden nur im Seed, und `abgesagt_am` setzte niemand. Jetzt:
      * ändern und absagen, was der Kalender besitzt — mit Grund, und der
      * Termin bleibt stehen (D-715). Wiedervorlagen und Gespräche verweisen
      * auf ihre Quelle.
      */}
    <section aria-labelledby="termin-pflege" className="mt-s7 max-w-prose" data-cse="termin-pflege">
      <h2 id="termin-pflege" className="mb-s3 text-h3 text-text">{t.bearbeitenTitel}</h2>
      {zeile.art === 'wiedervorlage' ? (
        <p className="text-sm text-text-muted" data-cse="termin-fremd">{t.fremdeArtWiedervorlage}</p>
      ) : zeile.art === 'bewerbungsgespraech' ? (
        <p className="text-sm text-text-muted" data-cse="termin-fremd">{t.fremdeArtGespraech}</p>
      ) : zeile.abgesagt_am !== null ? (
        <p className="text-sm text-text-muted" data-cse="termin-abgesagt-fest">
          {t.abgesagtNichtAenderbar}
        </p>
      ) : darf['kalender.schreiben'] !== true ? (
        <p className="text-sm text-text-muted" data-cse="termin-ohne-recht">
          {t.ohneRecht}{' '}
          <Recht schluessel="kalender.schreiben" sprache={sprache} />.
        </p>
      ) : (
        <div className="flex flex-col gap-s5">
          <TerminFormular
            t={t}
            aktion={`/api/kalender/eintraege/${zeile.id}`}
            zurueck={zurueck}
            benutzer={benutzer}
            aendern
            werte={{
              art: zeile.art,
              titel: zeile.titel,
              ort: zeile.ort ?? '',
              beschreibung: zeile.beschreibung ?? '',
              ganztaegig: zeile.ganztaegig,
              beginn: zeile.ganztaegig ? '' : berlinFormularWert(new Date(zeile.beginn)),
              ende: zeile.ganztaegig ? '' : berlinFormularWert(new Date(zeile.ende)),
              vonTag: zeile.ganztaegig ? berlinKalendertag(new Date(zeile.beginn)) : '',
              bisTag: zeile.ganztaegig ? berlinKalendertag(letzterTag) : '',
              teilnehmer: zeile.teilnehmer,
            }}
            knopf={t.speichern}
            cse="termin-aendern"
          />
          <form method="post" action={`/api/kalender/eintraege/${zeile.id}`}
                data-cse="termin-absagen"
                className="flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
            <h3 className="m-0 text-base font-semibold text-text">{t.absagenTitel}</h3>
            <input type="hidden" name="aktion" value="absagen" />
            <input type="hidden" name="zurueck" value={zurueck} />
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.absageGrund}
              <textarea name="grund" rows={2} required data-cse="termin-absage-grund"
                        placeholder={t.absageGrundBeispiel}
                        className="w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />
            </label>
            <p className="m-0 text-xs text-text-muted">{t.absageHinweis}</p>
            <div>
              <Button type="submit" variante="danger" data-cse="termin-absagen-abschicken">
                {t.absagen}
              </Button>
            </div>
          </form>
        </div>
      )}
    </section>
    </>,
  );
}
