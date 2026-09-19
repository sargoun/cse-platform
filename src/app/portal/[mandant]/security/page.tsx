import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { tagePlus } from '@/lib/datum/kalendertag';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { KpiStat } from '@/components/ui/KpiStat';
import { Hinweis } from '@/components/ui/Hinweis';
import { Icon } from '@/components/ui/Icon';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../unterseite';
import {
  ladeSecurityKopf, POSTEN_FENSTER_TAGE, WACHBUCH_FENSTER_TAGE,
  type SecurityKopf,
} from '@/server/services/security/uebersicht';

/**
 * `/portal/[mandant]/security` — der Modulkopf der Sicherheits- und
 * Objektschutzdienste (SEC-01, SEC-02, SEC-05).
 *
 * **Die dritte Kachel heisst „Vorkommnisse der letzten 7 Tage" und nicht
 * „offene Vorfälle".** Es gibt keinen Zustand „offen": `wachbuch_eintrag` hat
 * keine Spalte dafür, eine Korrektur ist eine nachfolgende Zeile
 * (`ersetzt_durch_id`), und ein Vorkommnis wird nie abgehakt — das ist der
 * Kern von SEC-05 und LEG-01. Eine Statusspalte zu erfinden wäre eine
 * Geschäftsregel mit Beweiswirkung; ein Zeitfenster ist eine Tatsache.
 *
 * **Abgelaufene § 34a-Nachweise stehen als SPERRGRUND, nicht als Warnung.**
 * SEC-04 ist eine harte Sperre: ohne gültigen Nachweis wird niemand
 * eingeteilt. Die Schwellen kommen aus `qualifikation.warnung_tage` über
 * `lageVon` — nie aus einer Zahl in dieser Datei.
 *
 * **Jede Kachel sagt, ob sie geprüft wurde.** Die Route hält `security.lesen`.
 * Die Postenbesetzung liegt hinter `dienstplan.lesen`, die Nachweise hinter
 * `personal.nachweis_lesen`, das Wachbuch hinter `wachbuch.lesen` — eine reine
 * Sicherheitsrolle hält die drei nicht zwangsläufig. RLS filtert still, und
 * eine Null wäre hier eine Entwarnung, die niemand geprüft hat.
 */
export const dynamic = 'force-dynamic';

const UNGEPRUEFT = 'nicht geprüft';

const LAGE_TEXT: Readonly<Record<string, string>> = {
  abgelaufen: 'abgelaufen — sperrt die Einteilung (SEC-04)',
  ungueltig: 'widerrufen oder abgelehnt — sperrt die Einteilung',
  kritisch: 'läuft in Kürze ab',
  warnung: 'läuft im Vorwarnfenster ab',
  gueltig: 'gültig',
  unbefristet: 'unbefristet',
};

/** Die Ziele des Modulkopfs mit ihrem Recht — jedes nach dem Manifest. */
const WEGE: readonly { pfad: string; titel: string; recht: string; satz: string }[] = [
  {
    pfad: 'security/posten',
    titel: 'Posten',
    recht: 'security.lesen',
    satz: 'Wachpositionen mit Mindest- und Sollbesetzung und den verlangten Qualifikationen.',
  },
  {
    pfad: 'security/wachbuch',
    titel: 'Wachbuch',
    recht: 'wachbuch.lesen',
    satz: 'Das Protokoll über alle Objekte — Serverzeit, laufende Nummer, Hashkette.',
  },
  {
    pfad: 'security/veranstaltungen',
    titel: 'Veranstaltungen',
    recht: 'security.lesen',
    satz: 'Kurzfristige Eventdienste mit ihrem Besetzungsstand.',
  },
  {
    pfad: 'security/dienstanweisungen',
    titel: 'Dienstanweisungen',
    recht: 'dienstanweisung.lesen',
    satz: 'Versionen mit Kenntnisnahmen — wer welche Fassung bestätigt hat.',
  },
  {
    pfad: 'security/schluessel',
    titel: 'Schlüssel',
    recht: 'schluessel.lesen',
    satz: 'Aktueller Besitzer und die vollständige Übergabekette.',
  },
  {
    pfad: 'security/bewacherregister',
    titel: 'Bewacherregister',
    recht: 'personal.bewacher_verwalten',
    satz: 'Bewacher-ID und Registerstand je Person — handerfasst, § 34a GewO.',
  },
];

export default async function SecurityKopfSeite(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/security`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* AUT-06: jeder Verweisblock unten steht unter dem Recht SEINES Ziels. Ein
     Menüpunkt, der auf 404 führt, verrät die Existenz dessen, was er nicht
     zeigen darf.

     Liste und Blatt tragen dabei VERSCHIEDENE Rechte: `…/personal/nachweise`
     verlangt `personal.nachweis_lesen`, das Einzelblatt
     `…/personal/nachweise/[id]` aber `personal.nachweis_verwalten`. Beide
     werden gefragt, sonst führte der Name einer Person auf ein 404. */
  const darf = await haeltRechte(sitzung, ...WEGE.map((w) => w.recht),
    'personal.nachweis_lesen', 'personal.nachweis_verwalten', 'dienstplan.lesen');

  const heute = await berlinHeute();
  const fenster = { von: heute, bis: tagePlus(heute, POSTEN_FENSTER_TAGE) };
  const wachbuchVon = tagePlus(heute, -(WACHBUCH_FENSTER_TAGE - 1));

  const kopf = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) =>
      ladeSecurityKopf(kontext, heute, fenster, wachbuchVon))) as Promise<SecurityKopf>);

  const gesperrt = kopf.nachweise === null
    ? null
    : kopf.nachweise.filter((n) => n.lage === 'abgelaufen' || n.lage === 'ungueltig').length;
  const polizei = kopf.vorkommnisse === null
    ? null
    : kopf.vorkommnisse.filter((v) => v.polizeiInformiert).length;

  return (
    <PortalRahmen
      titel="Sicherheit"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Sicherheit</h1>
        <p className="m-0 text-sm tabular-nums text-text-muted">Stand {heute} (Berlin)</p>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Posten, Nachweise, Wachbuch. Ein Posten ist die zu besetzende Position,
        der § 34a-Nachweis die Voraussetzung dafür, dass jemand sie besetzen
        darf, und das Wachbuch das Protokoll dessen, was auf ihr geschah — mit
        Serverzeit und Hashkette, ohne Rückdatierung und ohne Löschung.
      </p>

      <div className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <KpiStat
          label={`Unterbesetzt (${String(POSTEN_FENSTER_TAGE)} Tage)`}
          wert={kopf.luecken === null ? UNGEPRUEFT : String(kopf.luecken.length)}
          icon="security"
          ton={kopf.luecken === null || kopf.luecken.length === 0 ? 'muted' : 'warning'}
        />
        {/*
          Die Beschriftung sagt, was gezählt wird: ALLE Nachweise dieser
          Gesellschaft mit Frist, nicht nur die nach § 34a — `leseRegister`
          kennt keinen Qualifikationsfilter. „N sperren die Einteilung" stand
          hier früher und war zweimal zu viel behauptet: SEC-04 sperrt an
          `einsatzanforderung.zwingend` des Postens
          (`app.einsatz_qualifikation_erfuellt`), nicht an der Lage einer
          beliebigen Katalogzeile.
        */}
        <KpiStat
          label="Nachweise abgelaufen oder ablaufend"
          wert={kopf.nachweise === null ? UNGEPRUEFT : String(kopf.nachweise.length)}
          icon="person"
          ton={kopf.nachweise === null ? 'muted'
            : gesperrt !== null && gesperrt > 0 ? 'danger'
              : kopf.nachweise.length === 0 ? 'muted' : 'warning'}
          {...(gesperrt !== null && gesperrt > 0
            ? { delta: { richtung: 'ab' as const, text: `${String(gesperrt)} abgelaufen oder ungültig` } }
            : {})}
        />
        <KpiStat
          label={`Vorkommnisse (${String(WACHBUCH_FENSTER_TAGE)} Tage)`}
          wert={kopf.vorkommnisse === null ? UNGEPRUEFT : String(kopf.vorkommnisse.length)}
          icon="wachbuch"
          ton={kopf.vorkommnisse === null || kopf.vorkommnisse.length === 0 ? 'muted' : 'info'}
          {...(polizei !== null && polizei > 0
            ? { delta: { richtung: 'ab' as const, text: `${String(polizei)} mit Polizei` } }
            : {})}
        />
      </div>

      {/* --- Liste 1: Posten und ihre Lücken -------------------------------- */}
      <section className="mb-s6" data-cse="security-posten">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">Posten</h2>
          {darf['security.lesen'] === true && (
            <Link
              href={`/portal/${mandant}/security/posten`}
              className="text-sm underline hover:text-text"
            >
              Alle Posten
            </Link>
          )}
        </div>

        {kopf.luecken === null || kopf.posten === null ? (
          <Hinweis art="hinweis" cse="posten-ungeprueft" className="max-w-prose">
            <strong>Nicht geprüft.</strong> Die Besetzung eines Postens steht in
            den Schichten, und die liegen hinter <code>dienstplan.lesen</code>.
            Die Posten selbst sind unter „Alle Posten" sichtbar — ob sie besetzt
            sind, sagt diese Ansicht nicht. „0 unterbesetzt" wäre hier die
            gefährlichste Zahl auf dem Bildschirm.
          </Hinweis>
        ) : kopf.luecken.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {kopf.posten.length === 0
              ? 'Noch kein Posten angelegt. Ein Posten ist die zu besetzende Position an einem Objekt.'
              : `Alle ${String(kopf.posten.length)} Posten erreichen in den nächsten `
                + `${String(POSTEN_FENSTER_TAGE)} Tagen ihre Mindestbesetzung.`}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {kopf.luecken.slice(0, 15).map((l) => (
              <li
                key={l.einsatzId}
                data-cse="security-unterbesetzt"
                className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3
                           border-b border-line pb-s2 text-sm last:border-0"
              >
                <span className="text-text">
                  {l.postenBezeichnung}
                  {' · '}
                  <span className="tabular-nums text-text-muted">
                    {l.beginnLokal} – {l.endeLokal}
                  </span>
                </span>
                <span className="tabular-nums text-warning">
                  {l.besetztAnzahl} von {l.minBesetzung} — es fehlen {l.fehlend}
                </span>
              </li>
            ))}
            {kopf.luecken.length > 15 && (
              <li className="pt-s2 text-sm text-text-muted">
                … und {kopf.luecken.length - 15} weitere Schicht(en).
              </li>
            )}
          </ul>
        )}
      </section>

      {/* --- Liste 2: Nachweise mit Frist ------------------------------------ */}
      <section className="mb-s6" data-cse="security-nachweise">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">Nachweise mit Frist</h2>
          {darf['personal.nachweis_lesen'] === true && (
            <Link
              href={`/portal/${mandant}/personal/nachweise`}
              className="text-sm underline hover:text-text"
            >
              Nachweisregister
            </Link>
          )}
        </div>

        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Alle Nachweise dieser Gesellschaft, die abgelaufen sind oder im
          Vorwarnfenster stehen — nicht nur die nach § 34a; die
          Bewacherqualifikationen sind in der Liste markiert. Die Schwellen
          kommen aus <code>qualifikation.warnung_tage</code>, nie aus dieser
          Ansicht. Ob eine abgelaufene Zeile eine Einteilung <em>sperrt</em>,
          entscheidet die Anforderung des jeweiligen Postens
          (<code>einsatzanforderung.zwingend</code>), nicht diese Liste —
          welche Teilmenge der Modulkopf zeigen soll, ist offen (O-706).
        </p>

        {kopf.nachweise === null ? (
          <Hinweis art="hinweis" cse="nachweise-ungeprueft" className="max-w-prose">
            <strong>Nicht geprüft.</strong> Nachweise hängen am Menschen und liegen
            hinter <code>personal.nachweis_lesen</code> — ein Recht, das eine reine
            Sicherheitsrolle nicht hält. Das ist nicht dasselbe wie „alle
            Nachweise sind gültig".
          </Hinweis>
        ) : kopf.nachweise.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Kein Nachweis ist abgelaufen oder steht im Vorwarnfenster. Die
            Schwellen kommen aus dem Qualifikationskatalog, nicht aus dieser
            Ansicht.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {kopf.nachweise.slice(0, 15).map((n) => {
              const sperrt = n.lage === 'abgelaufen' || n.lage === 'ungueltig';
              return (
                <li
                  key={n.zeile.nachweisId}
                  data-cse="security-nachweis"
                  data-lage={n.lage}
                  className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3
                             border-b border-line pb-s2 text-sm last:border-0"
                >
                  <span className="text-text">
                    {darf['personal.nachweis_verwalten'] === true ? (
                      <Link
                        href={`/portal/${mandant}/personal/nachweise/${n.zeile.nachweisId}`}
                        className="underline hover:text-text"
                      >
                        {n.zeile.name}
                      </Link>
                    ) : n.zeile.name}
                    <span className="ml-s2 text-text-muted">{n.zeile.qualifikation}</span>
                    {n.bewacher && (
                      <span className="ml-s2 text-micro uppercase tracking-[0.08em] text-text-subtle">
                        § 34a
                      </span>
                    )}
                  </span>
                  {/* §9: das WORT trägt die Bedeutung, nicht die Farbe. */}
                  <span className={sperrt ? 'text-danger' : 'text-warning'}>
                    {sperrt && (
                      <Icon
                        name="fehler"
                        groesse="sm"
                        className="mr-s2 inline-block align-[-2px]"
                      />
                    )}
                    {LAGE_TEXT[n.lage] ?? n.lage}
                    {n.zeile.gueltigBis !== null && (
                      <span className="ml-s2 tabular-nums">
                        ({n.zeile.gueltigBis}
                        {n.zeile.restTage !== null
                          && (n.zeile.restTage < 0
                            ? `, seit ${String(-n.zeile.restTage)} Tagen`
                            : `, ${String(n.zeile.restTage)} Tage`)}
                        )
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
            {kopf.nachweise.length > 15 && (
              <li className="pt-s2 text-sm text-text-muted">
                … und {kopf.nachweise.length - 15} weitere.
              </li>
            )}
          </ul>
        )}
      </section>

      {/* --- Liste 3: Wachbuch, letzte 7 Tage ------------------------------- */}
      <section className="mb-s6" data-cse="security-wachbuch">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">
            Vorkommnisse · {kopf.wachbuchVon} bis {heute}
          </h2>
          {darf['wachbuch.lesen'] === true && (
            <Link
              href={`/portal/${mandant}/security/wachbuch`}
              className="text-sm underline hover:text-text"
            >
              Ganzes Wachbuch
            </Link>
          )}
        </div>

        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          <strong className="text-text">Ein Zeitfenster, kein Zustand.</strong> Das
          Wachbuch kennt kein „offen" und kein „geschlossen": eine Richtigstellung
          ist eine nachfolgende Zeile, die auf die alte zeigt, und ein Vorkommnis
          wird nie abgehakt. Deshalb steht hier, was in den letzten{' '}
          {WACHBUCH_FENSTER_TAGE} Tagen eingetragen wurde.
        </p>

        {kopf.vorkommnisse === null ? (
          <Hinweis art="hinweis" cse="wachbuch-ungeprueft" className="max-w-prose">
            <strong>Nicht geprüft.</strong> Das Wachbuch liegt hinter
            <code> wachbuch.lesen</code>, das dieses Konto hier nicht hält.
          </Hinweis>
        ) : kopf.vorkommnisse.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            In diesem Fenster wurde kein Vorkommnis eingetragen. Das heisst: keines
            wurde eingetragen — nicht, dass keines geschehen wäre.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {kopf.vorkommnisse.map((v) => (
              <li key={v.id} className="mb-s3" data-cse="security-vorkommnis">
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-s3">
                    <span className="text-base text-text">
                      {darf['wachbuch.lesen'] === true ? (
                        <Link
                          href={`/portal/${mandant}/security/wachbuch/${v.id}`}
                          className="underline-offset-2 hover:text-brand hover:underline"
                        >
                          {v.nummer} · {v.betreff}
                        </Link>
                      ) : `${v.nummer} · ${v.betreff}`}
                    </span>
                    <span className="text-sm tabular-nums text-text-muted">{v.erfasstLokal}</span>
                  </div>
                  <p className="m-0 mt-s2 text-sm text-text-muted">
                    {v.objekt}
                    {' · '}
                    {v.urheber ?? '—'}
                    {v.nachgetragen && (
                      <span className="ml-s2 text-warning">· nachgetragen</span>
                    )}
                    {v.polizeiInformiert && (
                      <span className="ml-s2 text-warning">· Polizei informiert</span>
                    )}
                    {v.storniert && (
                      <span className="ml-s2 text-text-muted">
                        · richtiggestellt{v.stornoGrund === null ? '' : ` — ${v.stornoGrund}`}
                      </span>
                    )}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Die Wege des Moduls ------------------------------------------- */}
      <section data-cse="security-wege">
        <h2 className="mb-s4 text-h3 text-text">Im Modul</h2>
        <div className="grid grid-cols-1 gap-s4 md:grid-cols-2 xl:grid-cols-3">
          {/*
            Jeder Kasten steht unter dem Recht SEINES Ziels. Ein ausgegrauter
            Verweis wäre kein Schutz: er verrät die Existenz dessen, was er
            nicht zeigen darf (AUT-06). Deshalb fehlt der Kasten ganz.
          */}
          {WEGE.filter((w) => darf[w.recht] === true).map((w) => (
            <Link key={w.pfad} href={`/portal/${mandant}/${w.pfad}`} className="group no-underline">
              <Card interaktiv>
                <div className="text-base text-text">{w.titel}</div>
                <p className="m-0 mt-s2 text-sm text-text-muted">{w.satz}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </PortalRahmen>
  );
}
