import type postgres from 'postgres';
import type { ReactNode } from 'react';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { farbeVon, ladeIdentitaet, type Identitaet }
  from '@/server/services/mandant/identitaet';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/identitaet` — das Erscheinungsbild dieser
 * Gesellschaft (TEN-07, TEN-10, PUB-09, PRO-01, DESIGN §1/§6/§9/§11, D-10).
 *
 * **Die Farbe ist ein Token und wird hier nicht gewaehlt.** Gespeichert ist
 * der Name (`area-bau`), den Wert liefert `globals.css` aus DESIGN §1. Das
 * Farbfeld unten ZEIGT ihn; es gibt keinen Waehler, und das ist die Regel
 * und nicht ein fehlendes Feature: ein fuenfter Bereich braucht zuerst einen
 * Eintrag in `docs/DESIGN.md`, dann eine Migration, die den `CHECK`
 * erweitert (01-KERN §6.2, CLAUDE.md).
 *
 * **Es gibt keinen Hochladeknopf, weil es keinen Hochladeweg gibt.**
 * `BUCKETS` in `server/storage/adapter.ts` kennt keinen Marken-Bucket, und
 * unter `src/app/api/medien` liegt kein POST. Die Seite sagt das an der
 * Stelle, an der der Knopf stuende — ein Knopf, der nichts tut, laesst
 * jemanden glauben, das Logo sei hinterlegt (O-12).
 *
 * **Alternativtexte sind pflegbar, auch ohne Bild.** Sie sind Text, sie sind
 * nach PUB-09/LEG-07 (BFSG, WCAG 2.1 AA) Pflicht, und sie koennen vor dem
 * Bild da sein. Ein oeffentlich sichtbares Profil ohne Alt-Text weist die
 * Datenbank ab (`mi_alt_text`, 0200) und der Dienst vorher mit dem Satz,
 * welches Feld fehlt.
 */
export const dynamic = 'force-dynamic';

function Feld({ label, wert, hinweis }: {
  readonly label: string;
  readonly wert: string | null | undefined;
  readonly hinweis?: string;
}) {
  return (
    <div className="contents">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 text-sm text-text">
        {wert === null || wert === undefined || wert === ''
          ? <span className="text-text-subtle">nicht hinterlegt</span>
          : wert}
        {hinweis === undefined ? null
          : <span className="ml-s2 text-xs text-text-subtle">{hinweis}</span>}
      </dd>
    </div>
  );
}

function Abschnitt({ titel, kinder }: { readonly titel: string; readonly kinder: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-s5">
      <h2 className="mb-s4 text-h3 text-text">{titel}</h2>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">{kinder}</dl>
    </section>
  );
}

export default async function IdentitaetSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const { hinweis } = await searchParams;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/identitaet`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const identitaet = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeIdentitaet(kontext)),
  ) as Promise<Identitaet | null>);

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  if (identitaet === null) {
    return (
      <PortalRahmen
        titel="Identität"
        wurzelTitel="Einstellungen"
        bereich={mandant as BereichSchluessel}
        nurLesen
        leiste={zugang.leiste}
        wurzel={`/portal/${mandant}`}
        aktiverTab="mehr"
        sichtbareTabs={zugang.sichtbareTabs}
        navigationsRechte={zugang.navigationsRechte}
      >
        <h1 className="mb-s3 text-h1 text-text">Identität</h1>
        <Hinweis art="warnung" cse="identitaet-fehlt" className="max-w-prose">
          <strong>Für diesen Bereich ist keine Identitätszeile hinterlegt.</strong> Sie
          entsteht mit dem Bereich selbst, und seit der Migration 0336 für jeden
          Bereich — auch für einen, für den <code>docs/DESIGN.md</code> §1 noch keinen
          Bereichston führt; der bleibt dann leer und wird hier als Platzhalter
          angezeigt (TEN-08). Fehlt die Zeile trotzdem, ist das ein Datenbefund und
          keine offene Designfrage: bitte melden. Eine Ersatzfarbe wird hier in keinem
          Fall gewählt.
        </Hinweis>
      </PortalRahmen>
    );
  }

  const farbe = farbeVon(identitaet.identitaetsToken);
  const ohneBild = [identitaet.logoHellPfad, identitaet.logoDunkelPfad,
    identitaet.logoDruckPfad, identitaet.avatarPfad, identitaet.coverPfad]
    .filter((p) => p === null).length;

  return (
    <PortalRahmen
      titel="Identität"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Identität</h1>
      <p className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        Woraus das Erscheinungsbild dieser Gesellschaft besteht: Kurzname und
        Identitätsfarbe, Logo, Avatar und Titelbild mit ihren Alternativtexten, der
        Claim — und die drei rechtlichen Fusszeilen, die auf jedem Brief, jeder Rechnung
        und jedem Angebot dieser Entität stehen.
      </p>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p data-cse="identitaet-hinweis"
           className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          {hinweis}
        </p>
      ) : null}

      {identitaet.platzhalterMedien ? (
        <Hinweis art="warnung" cse="identitaet-platzhalter" className="mb-s5 max-w-[72ch]">
          <strong>Die Bilder sind Platzhalter (D-10).</strong> Echte Logodateien als SVG
          (O-12) und echte Fotografie der vier Bereiche (O-13) liegen nicht vor. O-13 ist
          ausdrücklich ein Launch-Blocker: eine öffentliche Seite mit Platzhalterbildern
          ist keine Visitenkarte, sondern eine Baustelle mit Firmennamen darüber.
        </Hinweis>
      ) : null}

      <Hinweis art="hinweis" cse="identitaet-upload" className="mb-s7 max-w-[72ch]">
        <strong>Hochgeladen wird hier nichts — noch nicht.</strong> Für Logo, Avatar und
        Titelbild gibt es keinen Speicherort und keinen Annahmeweg: der Objektspeicher
        führt die Behälter <code>dokumente</code>, <code>archiv</code> und
        <code> einsatz-medien</code>, keinen für Markenmaterial. Deshalb steht hier kein
        Knopf, der nichts tut. Die Alternativtexte sind trotzdem pflegbar — sie sind
        Pflicht (PUB-09, LEG-07) und können vor dem Bild da sein.
      </Hinweis>

      <div className="mb-s7 grid grid-cols-1 gap-s4 lg:grid-cols-2">
        <Abschnitt titel="Bereich" kinder={<>
          <Feld label="Kurzname" wert={identitaet.kurzname} />
          <div className="contents">
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Identitätsfarbe
            </dt>
            <dd className="m-0 text-sm text-text">
              <span data-cse="identitaet-token" data-token={identitaet.identitaetsToken}
                    className="flex items-center gap-s3">
                {/*
                  * Der Hex-Wert steht hier als STIL und nicht als Tailwind-Klasse:
                  * er ist Daten aus DESIGN §1, keine Gestaltungsentscheidung dieser
                  * Seite, und eine Klasse je Bereich waere eine zweite Liste.
                  */}
                <span aria-hidden="true"
                      className="inline-block h-6 w-6 rounded-md border border-line"
                      style={farbe === null ? undefined : { backgroundColor: farbe }} />
                <code className="text-xs">
                  {identitaet.identitaetsToken ?? 'nicht hinterlegt'}
                </code>
                <span className="text-xs text-text-muted">
                  {/*
                    * Kein Token heisst NICHT „Fehler": eine Gesellschaft darf
                    * bestehen, bevor DESIGN §1 einen Bereichston fuer sie
                    * fuehrt (TEN-08, 0336). Sie steht dann sichtbar als
                    * Platzhalter da — und keine Ersatzfarbe wird gewaehlt.
                    * // TODO(client, O-750): Welcher Bereichston (DESIGN §1, Kontrast nach §9) gilt fuer eine fuenfte Gesellschaft, und darf ihr Profil oeffentlich gehen, bevor er eingetragen ist?
                    */}
                  {identitaet.identitaetsToken === null
                    ? 'Platzhalter (O-750): für diesen Bereich führt DESIGN §1 noch keinen '
                      + 'Bereichston. Erst ein Eintrag in docs/DESIGN.md (Farbe mit '
                      + 'geprüftem Kontrast), dann eine Migration — hier wird keine '
                      + 'Ersatzfarbe gewählt.'
                    : farbe === null
                      ? 'kein Wert in DESIGN §1 — dann fehlt der Eintrag, nicht die Farbe'
                      : `${farbe} · Wert aus docs/DESIGN.md §1, hier nicht wählbar`}
                </span>
              </span>
            </dd>
          </div>
          <Feld label="Claim" wert={identitaet.claim} />
          <div className="contents">
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Öffentlich sichtbar
            </dt>
            <dd className="m-0 text-sm text-text">
              <StatusPill zustand={identitaet.oeffentlichSichtbar ? 'Aktiv' : 'Inaktiv'} />
            </dd>
          </div>
          <Feld label="Eigene Domain" wert={identitaet.domain}
                hinweis="offen (O-08): eigene Domains je Bereich oder Pfade unter einer Gruppendomain" />
        </>} />

        <Abschnitt titel="Bilder und Alternativtexte" kinder={<>
          <Feld label="Logo hell" wert={identitaet.logoHellPfad} />
          <Feld label="Logo dunkel" wert={identitaet.logoDunkelPfad} />
          <Feld label="Logo Druck" wert={identitaet.logoDruckPfad} />
          <Feld label="Alternativtext Logo" wert={identitaet.logoAlt} />
          <Feld label="Avatar" wert={identitaet.avatarPfad} />
          <Feld label="Alternativtext Avatar" wert={identitaet.avatarAlt} />
          <Feld label="Titelbild" wert={identitaet.coverPfad} />
          <Feld label="Alternativtext Titelbild" wert={identitaet.coverAlt} />
        </>} />

        <Abschnitt titel="Rechtliche Fusszeilen (DESIGN §11)" kinder={<>
          <Feld label="Brief" wert={identitaet.briefFuss} />
          <Feld label="Rechnung" wert={identitaet.rechnungFuss} />
          <Feld label="Angebot" wert={identitaet.angebotFuss} />
        </>} />

        <Abschnitt titel="E-Mail" kinder={<>
          <Feld label="Absender" wert={identitaet.emailAbsender} />
          <Feld label="Signatur" wert={identitaet.emailSignatur} />
          <Feld label="Zuletzt gepflegt"
                wert={identitaet.geaendertAm === null ? null
                  : `${identitaet.geaendertAm}${identitaet.geaendertVon === null ? ''
                    : ` · ${identitaet.geaendertVon}`}`} />
        </>} />
      </div>

      <Hinweis art="hinweis" cse="identitaet-k12" className="mb-s7 max-w-[72ch]">
        <strong>Die Rechnungs-Fusszeile gehört in die Rechnung kopiert, nicht
        verlinkt (K-12)</strong> — eine spätere Änderung darf eine festgeschriebene
        Rechnung nicht verändern und die Hashkette nicht stillschweigend entwerten.
        <strong> Dieses Kopieren ist noch nicht gebaut:</strong> der kanonische
        Rechnungs-Payload führt kein Feld für die Fusszeile der Gesellschaft; was heute
        auf einer Rechnung steht, kommt aus dem freien Fusstext der Rechnung selbst. Bis
        dahin wirkt eine Änderung hier auf keine bestehende und auf keine neue Rechnung.
      </Hinweis>

      <section aria-labelledby="pflegen-titel"
               className="max-w-prose rounded-lg border border-line bg-surface p-s5">
        <h2 id="pflegen-titel" className="text-h2 text-text">Identität pflegen</h2>
        <p className="mt-s2 text-xs text-text-muted">
          {ohneBild === 0
            ? 'Alle Bildpfade sind hinterlegt.'
            : `${String(ohneBild)} von 5 Bildpfaden sind nicht hinterlegt — sie kommen `
              + 'mit O-12/O-13, nicht über dieses Formular.'}{' '}
          Kartentext und Profiltext werden hier nicht gepflegt: sie stehen je Sprache
          unter Website › Unternehmensprofil (D-82), und zwei Editoren auf einem Text
          wären ein Defekt.
        </p>
        <form method="post" action={`/api/einstellungen/identitaet?mandant=${mandant}`}>
          <label className="mt-s4 block text-sm text-text" htmlFor="kurzname">Kurzname</label>
          <input id="kurzname" name="kurzname" type="text" required className={feld}
                 defaultValue={identitaet.kurzname} />

          <label className="mt-s4 block text-sm text-text" htmlFor="claim">Claim</label>
          <input id="claim" name="claim" type="text" className={feld}
                 defaultValue={identitaet.claim ?? ''} />

          <label className="mt-s4 block text-sm text-text" htmlFor="logoAlt">
            Alternativtext Logo
          </label>
          <input id="logoAlt" name="logoAlt" type="text" className={feld}
                 defaultValue={identitaet.logoAlt ?? ''} />

          <label className="mt-s4 block text-sm text-text" htmlFor="avatarAlt">
            Alternativtext Avatar
          </label>
          <input id="avatarAlt" name="avatarAlt" type="text" className={feld}
                 defaultValue={identitaet.avatarAlt ?? ''} />

          <label className="mt-s4 block text-sm text-text" htmlFor="coverAlt">
            Alternativtext Titelbild
          </label>
          <input id="coverAlt" name="coverAlt" type="text" className={feld}
                 defaultValue={identitaet.coverAlt ?? ''} />

          <label className="mt-s4 block text-sm text-text" htmlFor="briefFuss">
            Fusszeile Brief
          </label>
          <textarea id="briefFuss" name="briefFuss" rows={3} className={feld}
                    defaultValue={identitaet.briefFuss ?? ''} />

          <label className="mt-s4 block text-sm text-text" htmlFor="rechnungFuss">
            Fusszeile Rechnung
          </label>
          <textarea id="rechnungFuss" name="rechnungFuss" rows={3} className={feld}
                    defaultValue={identitaet.rechnungFuss ?? ''} />

          <label className="mt-s4 block text-sm text-text" htmlFor="angebotFuss">
            Fusszeile Angebot
          </label>
          <textarea id="angebotFuss" name="angebotFuss" rows={3} className={feld}
                    defaultValue={identitaet.angebotFuss ?? ''} />

          <label className="mt-s4 block text-sm text-text" htmlFor="emailAbsender">
            E-Mail-Absender
          </label>
          <input id="emailAbsender" name="emailAbsender" type="text" className={feld}
                 defaultValue={identitaet.emailAbsender ?? ''} />
          <p className="mt-s2 text-xs text-text-muted">
            Ein Absender hier verschickt noch nichts: ein EU-gehosteter
            Transaktionsmailer ist nicht gewählt (O-36), also geht nichts hinaus. Die
            Adresse steht trotzdem auf Angeboten und Briefen.
          </p>

          <label className="mt-s4 block text-sm text-text" htmlFor="emailSignatur">
            E-Mail-Signatur
          </label>
          <textarea id="emailSignatur" name="emailSignatur" rows={3} className={feld}
                    defaultValue={identitaet.emailSignatur ?? ''} />

          <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="oeffentlichSichtbar" value="ja"
                   defaultChecked={identitaet.oeffentlichSichtbar} />
            Öffentlich sichtbar (Startseite und Profilseite)
          </label>
          <p className="text-xs text-text-muted">
            Ein öffentlich sichtbares Profil braucht für jedes ausgelieferte Bild einen
            Alternativtext — sonst wird gespeichert abgewiesen, und zwar mit dem Namen
            des fehlenden Feldes.
          </p>

          <button type="submit"
                  className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover">
            Identität speichern
          </button>
        </form>
      </section>
    </PortalRahmen>
  );
}
