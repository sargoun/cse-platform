import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { tagDeutsch } from '@/lib/datum/kalendertag';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { ENTSCHEIDUNG_FEHLER_TEXTE } from '@/lib/i18n/verwaltung/personal-entscheidung';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { DataTable } from '@/components/ui/DataTable';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinAnzeige } from '@/server/services/zeit/dauer';
import {
  findeAbwesenheit, leseGrund,
  type AbwesenheitZeile, type AbwesenheitsGrund,
} from '@/server/services/abwesenheit/index';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { kennungOder404 } from '../../../../kennung';

/**
 * `/portal/[mandant]/personal/abwesenheiten/[id]` — eine Abwesenheit, ihr
 * Zeitraum, ihre Entscheidung (EMP-05, EMP-10, TIM-05, LEG-09, Art. 9 DSGVO).
 *
 * **Der Grund steht NICHT im Normalfall darin.** Art, AU-Tatsache und
 * Bemerkung sind `cse_app` als Spaltenrecht entzogen (0073); sie kommen nur
 * ueber `app.abwesenheit_grund_lesen`, und **jeder** solche Aufruf schreibt
 * eine Art.-9-Auditzeile. Sie bei jedem Seitenaufruf mitzulesen hiesse, das
 * Protokoll mit Zugriffen zu fuellen, die niemand wollte — und damit die
 * Auskunft „wer hat den Grund gelesen" wertlos zu machen. Der Grund kommt
 * deshalb erst auf ausdrueckliche Anforderung (`?grund=1`), und die Seite sagt
 * darunter, dass der Zugriff protokolliert wurde.
 *
 * **„Kein Recht" und „kein Grund hinterlegt" sind zwei Saetze.** Ohne
 * `zeit.abwesenheit_grund_lesen` wirft die Funktion mit 42501 statt leer zu
 * liefern; diese Seite spricht den Unterschied aus.
 *
 * **Das Urlaubskonto haengt an einem ANDEREN Recht** (`zeit.konto_lesen`) als
 * diese Seite (`zeit.abwesenheit_lesen`). Es wird deshalb VORHER gefragt: null
 * Zeilen saehen sonst aus wie „kein Urlaubsanspruch hinterlegt", und das ist
 * eine ganz andere Auskunft.
 */
export const dynamic = 'force-dynamic';

const STATUS_PILL: Readonly<Record<string, PillZustand>> = {
  beantragt: 'Wartet',
  genehmigt: 'Bereit',
  abgelehnt: 'Abgelehnt',
  storniert: 'Archiviert',
  erfasst: 'Abgeschlossen',
};

const STATUS_TEXT: Readonly<Record<string, string>> = {
  beantragt: 'beantragt — es entscheidet noch jemand',
  genehmigt: 'genehmigt',
  abgelehnt: 'abgelehnt',
  storniert: 'storniert — die Zeile bleibt (Invariante 8)',
  erfasst: 'erfasst — zur Kenntnis genommen, nicht genehmigt',
};

interface Urlaubsstand {
  readonly jahr: number;
  readonly anspruch: string;
  readonly genommen: string;
  readonly rest: string;
  readonly abgeschlossen: boolean;
}

/** `"4.000"` → `„4"`, `"4.500"` → `„4,5"` — wie in der Liste. */
function tageText(roh: string | null): string {
  if (roh === null) return '—';
  const [ganz = '0', bruch = ''] = roh.split('.');
  const gekuerzt = bruch.replace(/0+$/u, '');
  return gekuerzt === '' ? ganz : `${ganz},${gekuerzt}`;
}

export default async function Abwesenheitsblatt({
  params, searchParams,
}: {
  params: Promise<{ mandant: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/personal/abwesenheiten/${id}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: jeder Querverweis wird vorher gefragt — ein Knopf, dessen Ziel
     dieselbe Sitzung nicht oeffnen darf, verraet, was er nicht zeigen darf
     (D-581). `zeit.konto_lesen` entscheidet zusaetzlich, ob das Urlaubskonto
     ueberhaupt gelesen wird. */
  const darf = await haeltRechte(
    zugang.sitzung,
    'zeit.abwesenheit_genehmigen', 'zeit.abwesenheit_grund_lesen',
    'zeit.konto_lesen', 'zeit.antrag_entscheiden', 'personal.lesen');

  const suche = await searchParams;
  const grundGewuenscht = suche['grund'] === '1';
  /* Der Grund eines abgewiesenen Formulars, als Satz nachgeschlagen (D-753) —
     nie Text aus der Adresse. */
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const fehlerTexte = nachSprache(ENTSCHEIDUNG_FEHLER_TEXTE, zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const zeile = await findeAbwesenheit(kontext, id);
      if (zeile === null) return { zeile: null, konto: null, grund: null, grundFehler: null };

      const jahr = Number(zeile.von.slice(0, 4));
      const konto = darf['zeit.konto_lesen'] === true
        ? (await kontext.abfrage<Urlaubsstand>(
          `select jahr,
                  anspruch_tage::text  as anspruch,
                  genommen_tage::text  as genommen,
                  rest_tage::text      as rest,
                  (abgeschlossen_am is not null) as abgeschlossen
             from urlaubskonto
            where anstellung_id = $1::uuid and jahr = $2`,
          [zeile.anstellungId, jahr]))[0] ?? null
        : null;

      /*
       * Der Grund wird nur geholt, wenn jemand ihn ANGEFORDERT hat — und nur
       * mit dem eigenen Recht. Die Rechtefrage steht davor, damit der Aufruf
       * gar nicht erst laeuft: ein 42501 mitten in der Seite waere eine
       * Auditzeile weniger, aber ein Fehlerbildschirm mehr.
       */
      let grund: AbwesenheitsGrund | null = null;
      let grundFehler: string | null = null;
      if (grundGewuenscht) {
        if (darf['zeit.abwesenheit_grund_lesen'] !== true) {
          grundFehler = 'kein_recht';
        } else {
          grund = await leseGrund(kontext, id);
          if (grund === null) grundFehler = 'keine_zeile';
        }
      }
      return { zeile, konto, grund, grundFehler };
    })) as Promise<{
      zeile: AbwesenheitZeile | null;
      konto: Urlaubsstand | null;
      grund: AbwesenheitsGrund | null;
      grundFehler: string | null;
    }>);

  // Kein Unterschied zwischen „gibt es nicht" und „darfst du nicht sehen"
  // (AUT-06).
  if (daten.zeile === null) notFound();
  const { zeile, konto, grund, grundFehler } = daten;

  const verweis = 'inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text';
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text';
  const entscheidbar = zeile.status === 'beantragt';
  const stornierbar = zeile.status === 'beantragt' || zeile.status === 'genehmigt'
    || zeile.status === 'erfasst';

  return (
    <PortalRahmen
      titel="Abwesenheit"
      wurzelTitel="Personal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="personal"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div data-cse="abwesenheit-kopf" className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{zeile.personName}</h1>
        <span className="flex items-center gap-s2">
          <StatusPill zustand={STATUS_PILL[zeile.status] ?? 'Offen'} />
          <span className="text-sm text-text-muted">
            {STATUS_TEXT[zeile.status] ?? zeile.status}
          </span>
        </span>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        <Link href={`/portal/${mandant}/personal/abwesenheiten`} className={verweis}>
          Zur Liste
        </Link>
        {darf['personal.lesen'] === true && (
          <Link
            href={`/portal/${mandant}/personal/anstellungen/${zeile.anstellungId}`}
            className={verweis}
          >
            Zur Beschäftigung
          </Link>
        )}
        {darf['zeit.konto_lesen'] === true && (
          <Link
            href={`/portal/${mandant}/personal/stundenkonten/${zeile.anstellungId}`}
            className={verweis}
          >
            Stundenkonto
          </Link>
        )}
        {zeile.antragId !== null && darf['zeit.antrag_entscheiden'] === true && (
          <Link href={`/portal/${mandant}/personal/antraege/${zeile.antragId}`} className={verweis}>
            Zum Antrag
          </Link>
        )}
      </nav>

      {fehler !== null && (
        <Hinweis art="warnung" cse="abwesenheit-fehler" rolle="alert" className="mb-s5 max-w-prose">
          <strong>{fehlerTexte.titel}</strong>{' '}
          {eigenerEintrag(fehlerTexte.fehler, fehler) ?? fehlerTexte.sonst}
        </Hinweis>
      )}

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s4 text-h3 text-text">Zeitraum</h2>
        <dl data-cse="abwesenheit-felder" className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
          <Feld label="Von" wert={`${tagDeutsch(zeile.von)}${zeile.vonHalbtags ? ' (halber Tag)' : ''}`} />
          <Feld label="Bis" wert={`${tagDeutsch(zeile.bis)}${zeile.bisHalbtags ? ' (halber Tag)' : ''}`} />
          <Feld label="Angerechnete Tage" wert={tageText(zeile.tageAngerechnet)} />
          <Feld label="Gemeldet" wert={berlinAnzeige(zeile.gemeldetAm)} />
          <Feld
            label="Genehmigt"
            wert={zeile.genehmigtAm === null ? '—' : berlinAnzeige(zeile.genehmigtAm)}
          />
          <Feld
            label="Storniert"
            wert={zeile.storniertAm === null ? '—' : berlinAnzeige(zeile.storniertAm)}
          />
        </dl>
        <p className="mb-0 mt-s4 text-xs text-text-subtle">
          Alle Zeitpunkte in Europe/Berlin; gespeichert sind sie UTC
          (Invariante 2). Die angerechneten Tage rechnet ein getesteter Dienst
          ohne Wochenenden und Berliner Feiertage — welche Wochentage als
          Arbeitstage gelten, ist noch nicht entschieden (O-18).
        </p>
      </section>

      <h2 className="mb-s3 text-h2 text-text">Urlaubskonto {zeile.von.slice(0, 4)}</h2>
      {darf['zeit.konto_lesen'] !== true ? (
        <p data-cse="urlaub-kein-recht" className="mb-s6 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Leserecht auf Urlaubskonten in dieser Gesellschaft
          (<span className="font-mono">zeit.konto_lesen</span>). Das heisst
          nicht, dass keines hinterlegt ist — diese Seite kann es nur nicht
          sehen.
        </p>
      ) : konto === null ? (
        <p data-cse="urlaub-keines" className="mb-s6 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für {zeile.von.slice(0, 4)} ist kein Urlaubsanspruch hinterlegt. Ein
          Urlaubsantrag wird ohne ihn nicht genehmigt (O-18) — sonst stünde der
          Resturlaub im Minus, ohne dass jemand das entschieden hätte.
        </p>
      ) : (
        <div data-cse="urlaub-stand" className="mb-s6">
          <DataTable
            beschriftung={`Urlaubskonto ${String(konto.jahr)}`}
            zeilen={[konto]}
            schluessel={(k) => String(k.jahr)}
            spalten={[
              { schluessel: 'jahr', kopf: 'Jahr', numerisch: true, zelle: (k) => String(k.jahr) },
              { schluessel: 'anspruch', kopf: 'Anspruch', numerisch: true, zelle: (k) => tageText(k.anspruch) },
              { schluessel: 'genommen', kopf: 'Genommen', numerisch: true, zelle: (k) => tageText(k.genommen) },
              {
                schluessel: 'rest',
                kopf: 'Rest',
                numerisch: true,
                zelle: (k) => (
                  <span className={Number(k.rest) < 0 ? 'text-danger' : ''}>
                    {tageText(k.rest)}
                  </span>
                ),
              },
              {
                schluessel: 'status',
                kopf: 'Status',
                zelle: (k) => (k.abgeschlossen ? 'abgeschlossen' : 'offen'),
              },
            ]}
          />
        </div>
      )}

      <h2 className="mb-s3 text-h2 text-text">Grund</h2>
      {!grundGewuenscht ? (
        <div data-cse="grund-tor" className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5">
          <p className="m-0 text-sm text-text">
            Warum jemand fehlt, steht hier nicht von selbst. Art der
            Abwesenheit, eine vorliegende Arbeitsunfähigkeitsbescheinigung und
            jede Bemerkung sind Gesundheitsdaten nach Art. 9 DSGVO; sie hängen
            an einem eigenen Recht, und <strong>jeder</strong> Abruf wird
            protokolliert (LEG-09).
          </p>
          {darf['zeit.abwesenheit_grund_lesen'] === true ? (
            <Link
              href={`/portal/${mandant}/personal/abwesenheiten/${id}?grund=1`}
              className="mt-s4 inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
              data-cse="grund-anfordern"
            >
              Grund anzeigen — der Abruf wird protokolliert
            </Link>
          ) : (
            <p className="mb-0 mt-s4 text-sm text-text-muted">
              Diese Sitzung hält <span className="font-mono">zeit.abwesenheit_grund_lesen</span> nicht.
            </p>
          )}
        </div>
      ) : grundFehler === 'kein_recht' ? (
        <Hinweis art="warnung" cse="grund-kein-recht" className="mb-s6 max-w-prose">
          <strong>Kein Recht auf den Grund.</strong> Das ist etwas anderes als
          „kein Grund hinterlegt": die Zeile trägt eine Art, diese Sitzung darf
          sie nicht sehen (<span className="font-mono">zeit.abwesenheit_grund_lesen</span>,
          Art. 9 DSGVO).
        </Hinweis>
      ) : grund === null ? (
        <p data-cse="grund-keine-zeile" className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Zu dieser Abwesenheit ist kein Grund hinterlegt.
        </p>
      ) : (
        <section data-cse="grund" className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
            <Feld label="Art" wert={grund.abwesenheitsart} />
            <Feld
              label="Gesundheitsbezogen"
              wert={grund.istGesundheitsbezogen ? 'Ja (Art. 9 DSGVO)' : 'Nein'}
            />
            <Feld
              label="AU-Bescheinigung"
              wert={grund.auBescheinigungVorliegt
                ? `liegt vor${grund.auBis === null ? '' : ` bis ${grund.auBis}`}`
                : 'liegt nicht vor'}
            />
            <Feld label="Bemerkung" wert={grund.bemerkung ?? '—'} />
            <Feld label="Ablehnungsgrund" wert={grund.ablehnungsgrund ?? '—'} />
          </dl>
          <p className="mb-0 mt-s4 text-xs text-text-subtle" data-cse="grund-protokoll">
            Dieser Abruf steht im Protokoll — mit Ihrem Konto, dem Zeitpunkt und
            der Rechtsgrundlage (Art. 9 Abs. 2 lit. b DSGVO).
          </p>
        </section>
      )}

      <h2 className="mb-s3 text-h2 text-text">Entscheidung</h2>
      {darf['zeit.abwesenheit_genehmigen'] !== true ? (
        <p data-cse="entscheidung-kein-recht" className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Über eine Abwesenheit entscheidet, wer{' '}
          <span className="font-mono">zeit.abwesenheit_genehmigen</span> hält — wer
          eine Krankmeldung aufnehmen darf, darf darum noch keinen Urlaub
          genehmigen.
        </p>
      ) : !entscheidbar && !stornierbar ? (
        <p data-cse="entscheidung-abgeschlossen" className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Entschieden ist entschieden. Eine abgelehnte oder stornierte
          Abwesenheit wird nicht zurückgedreht und nicht gelöscht
          (Invariante 8); eine neue Lage ist eine neue Meldung.
        </p>
      ) : (
        <form
          method="post"
          action={`/api/abwesenheiten/${id}`}
          data-cse="entscheidung-formular"
          className="flex max-w-prose flex-col gap-s3 rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="mandant" value={mandant} />
          <input type="hidden" name="zurueck" value={pfad} />
          <label className="flex flex-col gap-s2 text-sm text-text">
            Grund (bei Ablehnung und Stornierung Pflicht)
            <input
              name="grund"
              className={feld}
              placeholder="Was spricht dagegen — oder warum wird zurückgenommen?"
            />
          </label>
          <div className="flex flex-wrap gap-s3">
            {entscheidbar && (
              <>
                <Button type="submit" name="entscheidung" value="genehmigt" variante="primary">
                  Genehmigen
                </Button>
                <Button type="submit" name="entscheidung" value="abgelehnt" variante="secondary">
                  Ablehnen
                </Button>
              </>
            )}
            {stornierbar && (
              <Button type="submit" name="entscheidung" value="storniert" variante="ghost">
                Stornieren
              </Button>
            )}
          </div>
          <p className="m-0 text-xs text-text-subtle">
            Eine Stornierung löscht nichts: die Zeile bleibt mit Zeitpunkt und
            Urheber, das Urlaubskonto bekommt seine Tage zurück, und der Grund
            steht im Protokoll — nicht in der Bemerkung, die der Planung als
            Gesundheitsdatum entzogen ist.
          </p>
        </form>
      )}
    </PortalRahmen>
  );
}

function Feld({ label, wert }: { readonly label: string; readonly wert: string }) {
  return (
    <div className="contents">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 text-sm text-text">{wert}</dd>
    </div>
  );
}
