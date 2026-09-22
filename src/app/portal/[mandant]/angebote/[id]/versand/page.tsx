import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { anbindungen } from '@/server/registry/integrationen';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { FEHLERTEXT, type VersandKopf } from './daten';

/**
 * `/portal/[mandant]/angebote/[id]/versand` — das eine Tor, durch das ein
 * Angebot das Haus verlaesst (OPS-08, APR-01, Invariante 7).
 *
 * **Die Seite zeigt drei Sperren, jede mit ihrem Satz**, und erst danach den
 * Knopf: offene Kalkulationswerte, fehlende Preisfreigabe, keine
 * Leistungsposition. Die Nummer steht als die, die GEZOGEN WIRD — nicht als
 * eine, die schon da waere: Entwuerfe haben keine, und sie entsteht in
 * demselben UPDATE, das `versendet_am` setzt (FIN-03).
 *
 * **Und sie behauptet nicht, eine Mail sei hinausgegangen.** Das Register der
 * Integrationen fuehrt `email` mit Stand `nicht_verbunden` (O-36). Der
 * Versand wird festgehalten, das Dokument bereitgestellt — verschickt wird
 * nichts, und das steht als eigener Block da, nicht im Kleingedruckten.
 * Einen Erfolg zu simulieren waere eine vorgetaeuschte Integration.
 *
 * **Der Knopf auf der Detailseite bleibt.** Er ist der kurze Weg fuer den
 * Fall, dass alles steht; diese Seite ist der lange, der zeigt, WAS
 * hinausgeht und an WEN. Beide fuehren durch dieselbe Pruefung im Dienst —
 * ein zweiter Weg mit eigener Pruefung waere ein zweiter Weg mit eigener
 * Luecke.
 */
export const dynamic = 'force-dynamic';

export default async function Versand(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const pfad = `/portal/${mandant}/angebote/${id}/versand`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;
  const darf = await haeltRechte(
    sitzung, 'angebot.lesen', 'kalkulation.lesen', 'angebot.preis_freigeben');

  const kopf = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [z] = await kontext.abfrage<VersandKopf>(
        `select a.id, a.titel, a.status::text as status, a.netto_cent::text,
                a.angebotsnummer, ku.name as kunde, ku.id as kunde_id,
                /*
                 * Der Ansprechpartner aus der ANGEBOTSZEILE, nicht der
                 * Hauptkontakt des Kunden. Wer das Angebot bekommt, hat es
                 * angefragt; ein automatisch gewaehlter Empfaenger waere ein
                 * Empfaenger, den niemand benannt hat.
                 */
                nullif(btrim(concat_ws(' ', ap.titel, ap.vorname, ap.nachname)), '')
                  as ansprechpartner,
                ap.email as ansprechpartner_email,
                to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
                to_char(a.freigegeben_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as freigegeben_am,
                fb.name as freigegeben_von,
                to_char(a.versendet_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as versendet_am,
                vb.name as versendet_von,
                (select count(*) from angebotsposition p
                  where p.angebot_id = a.id and p.typ = 'leistung')::text as positionen,
                exists (select 1 from kalkulation_platzhalter kp
                         where kp.angebot_id = a.id) as kalkulation_offen,
                (select app.hat_recht('kalkulation.lesen', app.aktiver_mandant()))
                  as darf_kalkulation_lesen,
                /*
                 * DEN Nummernkreis pruefen, nicht auf ihn hoffen.
                 *
                 * vergebeNummer wirft einen NummernkreisFehler, wenn die
                 * Gesellschaft keinen Angebotskreis fuehrt — und der Mandant
                 * operations fuehrt ueberhaupt keinen. Ohne diese Zeile
                 * verspraeche die Seite eine Nummer, die niemand ziehen kann,
                 * und der Klick endete in einem Konflikt, den man vorher
                 * haette sagen koennen.
                 */
                exists (select 1 from nummernkreis n
                         where n.mandant_id = a.mandant_id
                           and n.kreis_typ = 'angebot') as hat_nummernkreis
           from angebot a
           join kunde ku on ku.id = a.kunde_id
           left join ansprechpartner ap on ap.id = a.ansprechpartner_id
           left join benutzer fb on fb.id = a.freigegeben_von
           left join benutzer vb on vb.id = a.versendet_von
          where a.id = $1`, [id]);
      return z ?? null;
    })) as Promise<VersandKopf | null>);

  if (kopf === null) notFound();

  const versendet = kopf.versendet_am !== null;
  const ohneFreigabe = kopf.freigegeben_am === null;
  const ohnePositionen = Number(kopf.positionen) === 0;
  /** Fehlende Sicht ist keine Bestaetigung (AUT-05) — wie auf der Freigabeseite. */
  const sichtFehlt = !kopf.darf_kalkulation_lesen;
  const offen = kopf.kalkulation_offen || sichtFehlt;
  /*
   * Der Stand kommt aus dem REGISTER, nicht aus einer Konstante hier.
   *
   * `anbindungen()` liest ihn bei jedem Aufruf aus den Adaptern, die die
   * Verbindung auch benutzen — eine zweite Liste verpasste den Tag, an dem
   * ein Schluessel gesetzt wird, und behauptete danach weiter
   * „nicht verbunden" (oder, schlimmer, das Gegenteil).
   */
  const email = anbindungen().find((i) => i.schluessel === 'email');
  const emailVerbunden = email?.stand === 'verbunden';
  const versandMoeglich = !versendet && !ohneFreigabe && !ohnePositionen && !offen
    && kopf.hat_nummernkreis
    && (kopf.status === 'entwurf' || kopf.status === 'in_pruefung');

  return (
    <PortalRahmen
      titel={`Versand — ${kopf.titel}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={versendet}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="angebote"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['angebot.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/angebote/${id}`, text: 'Zum Angebot' } }
        : {})}
    >
      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">Versand</h1>
        <StatusPill zustand={versendet ? 'Angebot' : versandMoeglich ? 'Bereit' : 'Wartet'} />
      </div>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="versand-fehler" className="mb-s5">
          <strong>Das Angebot ist nicht hinausgegangen.</strong>{' '}
          {FEHLERTEXT[fehler] ?? 'Der Vorgang wurde abgewiesen.'}
        </Hinweis>
      )}

      <section aria-labelledby="empfaenger" className="mb-s6">
        <h2 id="empfaenger" className="text-h2 text-text">Was hinausgeht, und an wen</h2>
        <dl className="m-0 mt-s4 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3 rounded-lg border border-line bg-surface p-s5">
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Kunde</dt>
          <dd className="m-0 text-sm text-text">{kopf.kunde}</dd>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Ansprechpartner
          </dt>
          <dd className="m-0 text-sm text-text">
            {kopf.ansprechpartner === null ? (
              <span className="text-text-subtle">
                keiner am Angebot hinterlegt — der Versand hält trotzdem fest, dass
                dieses Angebot hinausgegangen ist
              </span>
            ) : (
              <>
                {kopf.ansprechpartner}
                {kopf.ansprechpartner_email === null ? null : (
                  <span className="block text-xs text-text-muted">
                    {kopf.ansprechpartner_email}
                  </span>
                )}
              </>
            )}
          </dd>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Netto</dt>
          <dd data-cse="netto" className="m-0 cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(kopf.netto_cent)))}
          </dd>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Nummer</dt>
          <dd className="m-0 text-sm text-text">
            {kopf.angebotsnummer ?? (
              <span className="text-text-subtle">
                {kopf.hat_nummernkreis
                  ? 'wird beim Versand aus dem Angebotskreis gezogen'
                  : 'diese Gesellschaft führt keinen Angebotskreis'}
              </span>
            )}
          </dd>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Gültig bis
          </dt>
          <dd className="m-0 text-sm text-text">
            {kopf.gueltig_bis ?? <span className="text-text-subtle">—</span>}
          </dd>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Dokument
          </dt>
          <dd className="m-0 text-sm text-text">
            {versendet ? (
              <Link
                href={`/portal/${mandant}/angebote/${id}/pdf`}
                data-cse="zum-dokument"
                className="text-text underline underline-offset-2 hover:text-brand"
              >
                Angebotsdokument ansehen →
              </Link>
            ) : (
              <span className="text-text-subtle">
                entsteht mit dem Versand — es trägt die Nummer, und ohne Nummer gibt
                es kein Dokument
              </span>
            )}
          </dd>
        </dl>
      </section>

      <section aria-labelledby="kanal" className="mb-s6">
        <h2 id="kanal" className="text-h2 text-text">Der Versandkanal</h2>
        {emailVerbunden ? (
          <Hinweis art="hinweis" cse="kanal-verbunden" className="mt-s4">
            Der E-Mail-Versender ist verbunden. Das Angebot geht nach dem Klick
            an den hinterlegten Ansprechpartner.
          </Hinweis>
        ) : (
          <Hinweis art="warnung" cse="kanal-nicht-verbunden" className="mt-s4">
            <strong>E-Mail-Versender nicht verbunden (offen, O-36).</strong> Es
            ist kein EU-gehosteter Transaktionsversender mit DPA gewählt. Dieser
            Klick <em>hält den Versand fest</em> — er zieht die Nummer, friert die
            Kalkulation ein, schreibt die Umsatzsteuerzeilen und stellt das
            Dokument bereit. <strong>Verschickt wird nichts.</strong> Das Angebot
            geht auf dem bisherigen Weg hinaus; hier steht danach, wann und von
            wem es freigegeben wurde.
          </Hinweis>
        )}
      </section>

      <section aria-labelledby="sperren" className="mb-s6">
        <h2 id="sperren" className="text-h2 text-text">Die drei Sperren</h2>

        {offen ? (
          <Hinweis art="warnung" cse="sperre-kalkulation" className="mt-s4">
            <strong>1 · Unbestätigte Kalkulationswerte.</strong>{' '}
            {sichtFehlt ? (
              <>
                Ihnen fehlt <code className="text-text">kalkulation.lesen</code>;
                die Datenbank antwortet mit nichts, und das heißt nicht „alles
                bestätigt". Der Versand bleibt gesperrt, weil sich seine
                Voraussetzung von hier aus nicht prüfen lässt (AUT-05).
              </>
            ) : (
              <>
                Der Preis ruht auf offenen Fragen (O-16, O-17, O-56).{' '}
                {darf['kalkulation.lesen'] === true ? (
                  <Link
                    href={`/portal/${mandant}/angebote/${id}/kalkulation`}
                    data-cse="zur-kalkulation"
                    className="text-text underline underline-offset-2 hover:text-brand"
                  >
                    Werte bestätigen →
                  </Link>
                ) : null}
              </>
            )}
          </Hinweis>
        ) : (
          <p data-cse="sperre-kalkulation-frei" className="mt-s4 text-sm text-text">
            <strong>1 · Kalkulationswerte</strong> — bestätigt.
          </p>
        )}

        {ohneFreigabe ? (
          <Hinweis art="warnung" cse="sperre-freigabe" className="mt-s3">
            <strong>2 · Keine Preisfreigabe.</strong> Den Preis hat niemand
            verantwortet. Das ist ein eigener Vorgang mit eigenem Recht{' '}
            (<code className="text-text">angebot.preis_freigeben</code>) — und
            genau deshalb nicht dieser Klick.{' '}
            {darf['angebot.preis_freigeben'] === true ? (
              <Link
                href={`/portal/${mandant}/angebote/${id}/freigabe`}
                data-cse="zur-freigabe"
                className="text-text underline underline-offset-2 hover:text-brand"
              >
                Zur Preisfreigabe →
              </Link>
            ) : (
              <>Ihnen fehlt dieses Recht; die Freigabe erklärt die Leitung.</>
            )}
          </Hinweis>
        ) : (
          <p data-cse="sperre-freigabe-frei" className="mt-s3 text-sm text-text">
            <strong>2 · Preisfreigabe</strong> — erteilt am {kopf.freigegeben_am}
            {kopf.freigegeben_von === null ? '' : ` von ${kopf.freigegeben_von}`}.
          </p>
        )}

        {ohnePositionen ? (
          <Hinweis art="warnung" cse="sperre-positionen" className="mt-s3">
            <strong>3 · Keine Leistungsposition.</strong> Ein Angebot ohne Zeile
            wäre ein Dokument über nichts, und seine Steuerzeilen entstünden aus
            einer leeren Gruppierung.
          </Hinweis>
        ) : (
          <p data-cse="sperre-positionen-frei" className="mt-s3 text-sm text-text">
            <strong>3 · Leistungspositionen</strong> — {kopf.positionen} Zeile(n).
          </p>
        )}

        {kopf.hat_nummernkreis ? null : (
          <Hinweis art="warnung" cse="ohne-nummernkreis" className="mt-s3">
            <strong>Kein Angebotskreis in dieser Gesellschaft.</strong> Ein
            Entwurf hat keine Nummer, und sie entsteht in demselben UPDATE wie{' '}
            <code className="text-text">versendet_am</code> (FIN-03). Ohne Kreis
            gibt es nichts zu ziehen — der Versand würde abgewiesen, bevor er
            beginnt. Erst einen Angebotskreis unter <em>Finanzen › Nummernkreise</em>{' '}
            eröffnen.
          </Hinweis>
        )}
      </section>

      {versendet ? (
        <Hinweis art="erfolg" cse="schon-versendet">
          <strong>Versendet am {kopf.versendet_am}</strong>
          {kopf.versendet_von === null ? '' : ` von ${kopf.versendet_von}`} — Nummer{' '}
          <strong>{kopf.angebotsnummer}</strong>. Zeiten in{' '}
          <em>Europe/Berlin</em>, gespeichert in UTC (Invariante 2). Ein
          versendetes Angebot ist unveränderlich; ein anderer Preis braucht eine
          neue Version.
        </Hinweis>
      ) : versandMoeglich ? (
        <form
          method="post"
          action={`/api/angebot?mandant=${mandant}`}
          data-cse="versand-form"
          className="max-w-[52ch]"
        >
          {/*
            * Dieselbe Adresse wie der Knopf auf der Detailseite, dieselbe
            * Aktion, derselbe Dienst. Ein eigener Weg fuer diese Seite waere
            * ein zweiter Weg mit eigener Luecke.
            */}
          <input type="hidden" name="aktion" value="versenden" />
          <input type="hidden" name="angebotId" value={id} />
          {/*
            * `zurueck` — sonst kann auf dieser Seite kein Fehlersatz stehen.
            *
            * `/api/angebot` antwortete auf jeden abgewiesenen Versand mit JSON
            * 409; der `?fehler=`-Block oben und die Satztabelle in `daten.ts`
            * waren damit unerreichbar, und ein Mensch sah `{"fehler":"…"}` auf
            * weissem Grund. Die Route kennt das Feld jetzt und leitet auf
            * genau diese Seite zurueck (D-562) — dieselbe Mechanik wie in
            * `uebergang.ts`.
            */}
          <input type="hidden" name="zurueck" value={pfad} />
          <button
            type="submit"
            data-cse="versenden"
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
          >
            {emailVerbunden ? 'Angebot versenden' : 'Versand festhalten'}
          </button>
          <p className="mt-s3 text-xs text-text-muted">
            Dieser Klick zieht die Nummer und friert die Kalkulation ein. Er ist
            ein POST und kein Link: eine Adresse, die etwas aus dem Haus lässt,
            würde von jedem weitergeleiteten Verweis ausgelöst (Invariante 7).
          </p>
        </form>
      ) : (
        <p data-cse="versand-unmoeglich" className="text-sm text-text-muted">
          Solange eine der Sperren oben steht, gibt es hier keinen Knopf.
        </p>
      )}
    </PortalRahmen>
  );
}
