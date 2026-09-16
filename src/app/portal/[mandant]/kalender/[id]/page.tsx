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

export default async function Termin({ params }: {
  params: Promise<{ mandant: string; id: string }>;
}) {
  const { mandant, id } = await params;
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
                  as teilnehmer_namen
           from kalender_eintrag k
          where k.id = $1::uuid`, [id]);
      return k ?? null;
    }))) as Zeile | null;

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

  return rahmen(
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
    </article>,
  );
}
