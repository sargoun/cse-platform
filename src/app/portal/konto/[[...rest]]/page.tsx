import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { meinBeschriftungen, meinTexte } from '@/lib/i18n/texte';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { leisteFuer } from '@/server/registry/tableiste';
import { leseKonto } from '../konto';
import { Unterseite } from '../../unterseite';
import { AnmeldungNoetig } from '../../Anmeldung';

/**
 * `/portal/konto/…` — die Kontoseiten (§9, `USR`).
 *
 * Optionaler Catch-all, weil `/portal/konto` selbst keine Manifestroute ist.
 * Die Wurzel beantwortet diese Datei deshalb SELBST; alles darunter geht an
 * `Unterseite`, die im Manifest nachschlaegt und ohne Eintrag auf 404 faellt.
 *
 * **Warum die Wurzel eine eigene Seite bekommen hat.** Sie fiel vorher in
 * `Unterseite`, und dort traf `findeRoute('/portal/konto')` auf
 * `/portal/[mandant]` — `[mandant]` nahm jedes Segment, also auch `konto`.
 * Die Adresse wurde damit unter der Bedingung des Mandanten-Dashboards
 * geprueft und mit dessen Auskunft beantwortet: „dieses Modul entsteht in
 * Phase 3", ueber einem Menue der Gesellschaft, in der man gerade steht. Der
 * Mustervergleich kennt die reservierten Namen jetzt (`routen.ts`), und damit
 * waere die Wurzel ein ehrliches 404 geworden — fuer einen Punkt, den die
 * Kopfzeile jeder Portalseite anbietet. Ein angebotener Weg, der ins Leere
 * fuehrt, ist der Fehler, den dieser Zweig schon dreimal hatte.
 *
 * **Was hier steht, steht bereits fest.** Name, Anmeldung, Rolle, aktiver
 * Bereich, die Bereiche dieses Kontos: alles aus der Sitzung und der
 * Mitgliedschaftstabelle, nichts gerechnet und nichts angenommen. Geaendert
 * wird hier NICHTS — Profil (`/portal/konto/profil`) und Sicherheit
 * (`/portal/konto/sicherheit`) sind eigene Routen mit eigenen Bedingungen.
 */
export const dynamic = 'force-dynamic';


function Zeile({ was, wert }: { readonly was: string; readonly wert: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-s4 border-b border-line py-s3">
      <dt className="w-32 text-sm text-text-muted">{was}</dt>
      {/* `min-w-0 break-words`: eine Anmeldung wie `kunde.demo@example.test`
          hat keine Trennstelle und schob die Zeile bei 375px ueber den Rand —
          dieselbe Ursache wie im Impressum (Gesellschaften.tsx). */}
      <dd className="m-0 min-w-0 break-words text-base text-text">{wert}</dd>
    </div>
  );
}

async function KontoWurzel() {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return <AnmeldungNoetig />;
  const k = await leseKonto(sitzung);

  /*
   * **Die Wurzel ist das PORTAL, nicht das Konto.**
   *
   * Jeder Tab und der Name in der Kopfzeile fuehren damit dorthin zurueck, wo
   * gearbeitet wird. Zeigten sie auf `/portal/konto`, waere das Konto eine
   * Sackgasse mit einer Leiste, die im Kreis fuehrt — und `Mehr` ergaebe
   * `/portal/konto/zeiten`, eine Adresse, die es nicht gibt.
   */
  const wurzel = sitzung.ansicht === 'gruppe' ? '/portal/gruppe'
    : sitzung.portal === 'mitarbeiter' ? '/portal/mein'
    : sitzung.portal === 'kunde' ? '/portal/kunde'
    : k.slug === null ? '/auth/bereich' : `/portal/${k.slug}`;
  /*
   * Eine Arbeiterin kommt ueber „Konto" und „Profil" hierher — und fand
   * Leiste, Spur und Kopfzeile wieder auf Deutsch, obwohl ihr Portal
   * uebersetzt ist. Die Huelle folgt ihrer Sprache; der Inhalt der Seite
   * bleibt deutsch, bis das Profil (`/portal/konto/profil`) gebaut ist (D-419).
   */
  const t = sitzung.portal === 'mitarbeiter' && k.sprache !== null
    ? meinTexte(k.sprache) : null;

  return (
    <PortalRahmen
      titel={t?.konto ?? 'Konto'}
      bereich={null}
      nurLesen={sitzung.ansicht === 'gruppe'}
      leiste={leisteFuer(sitzung.portal, sitzung.ansicht, k.rolle)}
      wurzel={wurzel}
      sichtbareTabs={k.sichtbareTabs}
      navigationsRechte={k.navigationsRechte}
      {...(t === null ? {} : { beschriftungen: meinBeschriftungen(t) })}
    >
      <h1 className="mb-s5 text-h1 text-text">{t?.konto ?? 'Konto'}</h1>

      <dl data-cse="konto-angaben" className="m-0 max-w-[72ch]">
        <Zeile was="Name" wert={k.person ?? k.name ?? '—'} />
        <Zeile was="Anmeldung" wert={k.email ?? '—'} />
        <Zeile
          was="Ansicht"
          wert={sitzung.ansicht === 'gruppe'
            ? 'Gruppenübersicht (nur lesen)'
            : (k.aktiv ?? '—')}
        />
        <Zeile was="Rolle" wert={k.rolle ?? '—'} />
        {/*
          * Die zweite Stufe steht hier, weil sie sichtbar sein muss, bevor sie
          * pflicht wird: wer nicht weiss, dass sein Konto nur `aal1` traegt,
          * haelt das Fehlen der Abfrage fuer Bequemlichkeit statt fuer eine
          * offene Flanke (AUT-02).
          */}
        <Zeile
          was="Zweite Stufe"
          wert={sitzung.aal === 'aal2' ? 'aktiv in dieser Sitzung' : 'in dieser Sitzung nicht verlangt'}
        />
      </dl>

      <h2 className="mb-s3 mt-s6 text-h3 text-text">Bereiche dieses Kontos</h2>
      {k.bereiche.length === 0 ? (
        <p data-cse="konto-kein-bereich" className="max-w-[72ch] text-base text-text-muted">
          Diesem Konto ist kein Bereich zugewiesen. Das ist keine Störung der
          Anmeldung: die Zuweisung erfolgt in der Benutzerverwaltung.
        </p>
      ) : (
        <ul data-cse="konto-bereiche" className="m-0 max-w-[72ch] list-none p-0">
          {k.bereiche.map((b) => (
            <li key={b.slug}
                className="flex min-h-11 items-center justify-between border-b border-line py-s3">
              <span className="text-base text-text">{b.name}</span>
              {b.name === k.aktiv && (
                <span data-cse="konto-aktiv" className="text-sm text-text-muted">aktiv</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {/*
        * Der Wechsel geschieht NICHT hier. `/auth/bereich` traegt ihn, und
        * dort ist jede Zeile ein POST — koennte ein GET den aktiven Mandanten
        * aendern, waere die URL der Mandantenzustand (Invariante 3).
        */}
      <p className="mt-s4 max-w-[72ch] text-sm text-text-subtle">
        Gewechselt wird über <a href="/auth/bereich"
          className="text-text underline underline-offset-4">Bereich wechseln</a> —
        der Wechsel wird protokolliert.
      </p>

      <h2 className="mb-s3 mt-s6 text-h3 text-text">Noch nicht gebaut</h2>
      <p className="max-w-[72ch] text-base text-text-muted">
        Profil, Passwort und zweite Stufe, Benachrichtigungen und der
        Kalender-Feed sind eigene Seiten unter dieser Adresse. Sie stehen in der
        Seitenkarte und entstehen in ihren Phasen; bis dahin steht hier kein
        Formular, das nichts speichert.
      </p>
    </PortalRahmen>
  );
}

export default async function KontoRest(
  { params }: { params: Promise<{ rest?: string[] }> },
) {
  const { rest } = await params;
  if (rest === undefined || rest.length === 0) return <KontoWurzel />;
  return <Unterseite pfad={`/portal/konto/${rest.join('/')}`} bereich={null} />;
}
