import type postgres from 'postgres';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { smsDienst } from '@/server/auth/sms';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { ZUGANG_TEXTE } from '@/lib/i18n/verwaltung/personal-zugang';
import {
  ZUGANGSCODE_COOKIE, leseZugangsstand, type Zugangsstand,
} from '@/server/services/personal/zugangscode';
import type { BereichSchluessel } from '@/lib/design/theme';
import { lesePerson, type PersonZeile } from '../../daten';
import { mandantTor, MandantAntwort } from '../../../../../unterseite';
import { kennungOder404 } from '../../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/personal/personen/[id]/zugang` — der Zugang einer
 * Mitarbeiterin: die Anmeldenummer einrichten, umschreiben, sperren und
 * entsperren, der Stand daneben, und der Anmeldecode aus der Hand der
 * Einsatzleitung, solange kein Gateway verbunden ist (V-014, EMP-01, EMP-14,
 * O-82, D-487, D-488).
 *
 * **Was hier bis V-014 fehlte.** Die Seite zeigte den Stand und stellte
 * Codes aus — und sagte bei fehlendem Zugang: „die Super-Administration
 * trägt die Nummer an der Person ein." Die konnte das nicht. `person.telefon`
 * ist ein Feld der Personalakte; angemeldet wird mit
 * `mitarbeiter_zugang.telefon_e164`, und für diese Spalte gab es keinen
 * Schreibweg ausser dem Seed. Beide Nummern stehen deshalb jetzt getrennt
 * und mit dem Unterschied daneben.
 *
 * Der Code wird einmal gezeigt — aus einem kurzlebigen Keks, den die Route
 * setzt; nie aus der Adresse.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const RECHT = 'personal.zugang_verwalten';
const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

function maskiert(telefon: string | null, leer: string): string {
  if (telefon === null || telefon.length < 4) return leer;
  return `${telefon.slice(0, 4)} … ${telefon.slice(-3)}`;
}

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

type Texte = (typeof ZUGANG_TEXTE)['de'];

/**
 * Was der Anmeldung im Weg steht — in der Reihenfolge, in der es auffaellt.
 *
 * `null` heisst: nichts steht im Weg. Jeder Satz nennt den Zustand UND den
 * naechsten Schritt; „geht nicht" allein hat dem Nutzer schon einmal einen
 * Vormittag gekostet (D-488).
 */
function hindernis(stand: Zugangsstand, t: Texte): string | null {
  if (!stand.hatZugang) return t.hindernisKeinZugang;
  if (stand.gesperrt) return t.hindernisGesperrt;
  if (!stand.hatKonto) return t.hindernisKeinKonto;
  if (stand.offeneCodes >= 3) return t.hindernisBremse;
  return null;
}

export default async function Zugang(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  if (!UUID.test(id)) notFound();
  const pfad = `/portal/${mandant}/personal/personen/${id}/zugang`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(ZUGANG_TEXTE, zugang.sprache);
  /* AUT-06: das Personenblatt `…/personen/[id]` verlangt laut Manifest
     `personal.lesen`, diese Seite `personal.zugang_verwalten` — wer nur das
     zweite hält, bekam hinter „Zur Person" ein 404. Ein Verweis auf 404
     verrät, was er nicht zeigen darf (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(zugang.sitzung, 'personal.lesen', RECHT);
  const suche = await searchParams;
  const einWert = (name: string): string | null =>
    typeof suche[name] === 'string' ? suche[name] : null;
  const grund = einWert('grund');
  const fehler = einWert('fehler');
  const erledigt = einWert('erledigt') !== null;

  const heute = await berlinHeute();
  const gelesen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      person: await lesePerson(kontext, heute, id),
      stand: await leseZugangsstand(kontext, id),
    }))) as Promise<{ person: PersonZeile | null; stand: Zugangsstand }>);
  const person = gelesen.person;
  if (person === null) notFound();
  const stand = gelesen.stand;
  const sperre = hindernis(stand, t);

  const sms = smsDienst(devFlaechenAn());
  const code = (await cookies()).get(ZUGANGSCODE_COOKIE)?.value ?? null;
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2';
  const darfSchreiben = darf[RECHT] === true;

  /** Die drei Felder, die jedes Formular dieser Seite an die Route reicht. */
  const verdeckt = (aktion: string) => (
    <>
      <input type="hidden" name="aktion" value={aktion} />
      <input type="hidden" name="person" value={id} />
      <input type="hidden" name="zurueck" value={pfad} />
    </>
  );

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
      <div className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{t.titel} — {person.name}</h1>
        {darf['personal.lesen'] === true && (
          <Link href={`/portal/${mandant}/personal/personen/${id}`} className={knopf}>
            {t.zurPerson}
          </Link>
        )}
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      {erledigt ? (
        <Hinweis art="erfolg" cse="zugang-erledigt" className="mb-s5 max-w-prose">
          {t.erledigt}
        </Hinweis>
      ) : null}
      {fehler !== null ? (
        <Hinweis art="warnung" cse="zugang-fehler" className="mb-s5 max-w-prose">
          {t.fehler[fehler] ?? fehler}
        </Hinweis>
      ) : null}

      <dl data-cse="zugang-stand" className="mb-s5 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
        <dt className="text-text-muted">{t.anmeldenummer}</dt>
        <dd className="text-text" data-cse="zugang-anmeldenummer">
          <span className="tabular-nums">{stand.telefonMaskiert ?? t.leer}</span>
          <span className="mt-s1 block text-xs text-text-muted">
            {t.anmeldenummerErklaerung}
          </span>
        </dd>
        <dt className="text-text-muted">{t.akteTelefon}</dt>
        <dd className="text-text" data-cse="zugang-akte-telefon">
          <span className="tabular-nums">{maskiert(person.telefon, t.leer)}</span>
          <span className="mt-s1 block text-xs text-text-muted">
            {t.akteTelefonErklaerung}
          </span>
        </dd>
        <dt className="text-text-muted">{t.anmeldung}</dt>
        <dd className="text-text">{t.anmeldungErklaerung}</dd>
        <dt className="text-text-muted">{t.smsVersand}</dt>
        <dd className="text-text" data-cse="zugang-sms">
          {sms.verbunden ? sms.name : t.smsNichtVerbunden}
        </dd>
        <dt className="text-text-muted">{t.zugang}</dt>
        <dd className="text-text" data-cse="zugang-vorhanden">
          {!stand.hatZugang ? t.zugangKeiner
            : stand.gesperrt ? t.zugangGesperrt : t.zugangEingerichtet}
        </dd>
        {stand.gesperrt ? (
          <>
            <dt className="text-text-muted">{t.gesperrtSeit}</dt>
            <dd className="text-text" data-cse="zugang-gesperrt-seit">
              {stand.gesperrtAm === null ? t.leer : BERLIN.format(stand.gesperrtAm)}
            </dd>
            <dt className="text-text-muted">{t.sperrgrund}</dt>
            <dd className="text-text" data-cse="zugang-sperrgrund">
              {stand.sperrgrund ?? t.leer}
            </dd>
          </>
        ) : null}
        <dt className="text-text-muted">{t.konto}</dt>
        <dd className="text-text" data-cse="zugang-konto">
          {stand.hatKonto ? t.kontoAktiv : t.kontoKeines}
        </dd>
        <dt className="text-text-muted">{t.offeneCodes}</dt>
        <dd className="text-text tabular-nums" data-cse="zugang-offene-codes">
          {stand.offeneCodes} {t.vonDrei}
        </dd>
        <dt className="text-text-muted">{t.letzteAnmeldung}</dt>
        <dd className="text-text" data-cse="zugang-letzte-anmeldung">
          {stand.letzteAnmeldung === null ? t.nochKeine : BERLIN.format(stand.letzteAnmeldung)}
        </dd>
      </dl>

      {sperre !== null ? (
        <Hinweis art="warnung" cse="zugang-hindernis" className="mb-s5 max-w-prose">
          <strong>{t.gehtNichtDurch}</strong> {sperre}
        </Hinweis>
      ) : null}

      {code !== null ? (
        <Hinweis art="erfolg" cse="zugang-code" className="mb-s5 max-w-prose">
          <strong>{t.codeAusgestellt}</strong> {t.codeNennen}{' '}
          <code data-cse="zugang-code-wert" className="rounded-md bg-surface-3 px-s2 py-s1 font-mono text-base tracking-widest">{code}</code>
          <span className="mt-s2 block text-xs">{t.codeWeg}</span>
        </Hinweis>
      ) : null}
      {grund !== null ? (
        <Hinweis art="warnung" cse="zugang-abgewiesen" className="mb-s5 max-w-prose">
          <strong>{t.codeKeiner}</strong> {t.codeGrund[grund] ?? grund}
        </Hinweis>
      ) : null}

      <form method="post" action="/api/personal/zugang-code" data-cse="zugang-formular"
            className="mb-s6 flex max-w-prose flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
        <input type="hidden" name="mandant" value={mandant} />
        <input type="hidden" name="person" value={id} />
        <p className="text-sm text-text">
          {sms.verbunden ? t.codeFormularMitSms : t.codeFormularOhneSms}
        </p>
        <div>
          <Button type="submit" variante="primary" data-cse="zugang-code-ausstellen"
                  disabled={!darfSchreiben || !stand.hatZugang || stand.gesperrt
                            || stand.offeneCodes >= 3}>
            {t.codeAusstellen}
          </Button>
        </div>
      </form>

      {!darfSchreiben ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht} <Recht schluessel={RECHT} sprache={zugang.sprache} />.
        </Hinweis>
      ) : !stand.hatZugang ? (
        <Card>
          <form method="post" action="/api/personal/zugang" data-cse="zugang-einrichten"
                className="flex max-w-[60ch] flex-col gap-s4">
            {verdeckt('einrichten')}
            <h2 className="m-0 text-h2 text-text">{t.einrichtenTitel}</h2>
            <p className="m-0 text-sm text-text-muted">{t.einrichtenErklaerung}</p>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.nummer}
              <input type="tel" name="telefon" required maxLength={32} className={FELD}
                     placeholder={t.nummerBeispiel} data-cse="zugang-nummer-neu" />
              <span className="text-xs text-text-muted">{t.nummerErklaerung}</span>
            </label>
            <div>
              <Button type="submit" variante="primary" data-cse="zugang-einrichten-knopf">
                {t.einrichten}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <div className="flex flex-col gap-s5">
          <Card>
            <form method="post" action="/api/personal/zugang" data-cse="zugang-nummer-aendern"
                  className="flex max-w-[60ch] flex-col gap-s4">
              {verdeckt('nummer_aendern')}
              <h2 className="m-0 text-h2 text-text">{t.aendernTitel}</h2>
              <p className="m-0 text-sm text-text-muted">{t.aendernErklaerung}</p>
              <Hinweis art="warnung" cse="zugang-aendern-warnung" className="max-w-prose">
                {t.aendernWarnung}
              </Hinweis>
              <label className="flex flex-col gap-s2 text-sm text-text">
                {t.nummer}
                <input type="tel" name="telefon" required maxLength={32} className={FELD}
                       placeholder={t.nummerBeispiel} data-cse="zugang-nummer-aendern-feld" />
                <span className="text-xs text-text-muted">{t.nummerErklaerung}</span>
              </label>
              <div>
                <Button type="submit" variante="secondary" data-cse="zugang-aendern-knopf">
                  {t.aendern}
                </Button>
              </div>
            </form>
          </Card>

          {stand.gesperrt ? (
            <Card>
              <form method="post" action="/api/personal/zugang" data-cse="zugang-entsperren"
                    className="flex max-w-[60ch] flex-col gap-s4">
                {verdeckt('entsperren')}
                <h2 className="m-0 text-h2 text-text">{t.entsperrenTitel}</h2>
                <p className="m-0 text-sm text-text-muted">{t.entsperrenErklaerung}</p>
                <div>
                  <Button type="submit" variante="primary" data-cse="zugang-entsperren-knopf">
                    {t.entsperren}
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <Card>
              <form method="post" action="/api/personal/zugang" data-cse="zugang-sperren"
                    className="flex max-w-[60ch] flex-col gap-s4">
                {verdeckt('sperren')}
                <h2 className="m-0 text-h2 text-text">{t.sperrenTitel}</h2>
                <p className="m-0 text-sm text-text-muted">{t.sperrenErklaerung}</p>
                <label className="flex flex-col gap-s2 text-sm text-text">
                  {t.sperrgrundFeld}
                  <input type="text" name="grund" required minLength={3} maxLength={200}
                         className={FELD} placeholder={t.sperrgrundBeispiel}
                         data-cse="zugang-sperrgrund" />
                </label>
                <div>
                  <Button type="submit" variante="danger" data-cse="zugang-sperren-knopf">
                    {t.sperren}
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </div>
      )}
    </PortalRahmen>
  );
}
