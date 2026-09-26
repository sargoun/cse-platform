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
        *
        * Und nur mit einer Auswahl (TEN-06, D-43, V-165): mit einem einzigen
        * Bereich fuehrte der Verweis auf eine Wahl mit einer Zeile.
        */}
      {k.bereiche.length > 1 && (
        <p data-cse="konto-wechsel" className="mt-s4 max-w-[72ch] text-sm text-text-subtle">
          Gewechselt wird über <a href="/auth/bereich"
            className="text-text underline underline-offset-4">Bereich wechseln</a> —
          der Wechsel wird protokolliert.
        </p>
      )}

      {/*
        * ═══════════════════════════════════════════════════════════════════
        * **Hier stand „Noch nicht gebaut" — und drei der vier Seiten gab es**
        * (V-038).
        * ═══════════════════════════════════════════════════════════════════
        *
        * `profil`, `benachrichtigungen` und `kalender-feed` sind seit ihren
        * Phasen fertig; `sicherheit` kam mit V-039 dazu. Der Absatz behauptete
        * das Gegenteil, und er war der EINZIGE Text an dieser Stelle: wer über
        * die Kontowurzel kam, las, es gebe nichts, und ging.
        *
        * Das ist die teuerste Sorte Lücke, weil sie aktiv in die Irre führt —
        * anders als ein fehlender Verweis, den man wenigstens suchen kann.
        */}
      <h2 className="mb-s3 mt-s6 text-h3 text-text">Ihr Konto</h2>
      <ul className="m-0 flex max-w-[72ch] list-none flex-col gap-s3 p-0"
          data-cse="konto-seiten">
        {[
          { ziel: '/portal/konto/profil', titel: 'Profil',
            text: 'Name, Anmeldung und die Sprache der Oberfläche (de · en · ar · tr).' },
          { ziel: '/portal/konto/sicherheit', titel: 'Sicherheit',
            text: 'Kennwort, zweite Stufe, Wiederherstellungscodes — und die Liste '
              + 'Ihrer aktiven Anmeldungen, jede einzeln beendbar.' },
          { ziel: '/portal/konto/benachrichtigungen', titel: 'Benachrichtigungen',
            text: 'Je Art: was in den Posteingang kommt und was zusätzlich hinausgeht. '
              + 'Der Posteingang selbst lässt sich nicht abschalten — er ist das '
              + 'Protokoll dessen, was Ihnen mitgeteilt wurde.' },
          { ziel: '/portal/konto/kalender-feed', titel: 'Kalender-Feed',
            text: 'Die persönliche iCal-Adresse: einmal anzeigen, erneuern, widerrufen.' },
        ].map((e) => (
          <li key={e.ziel} className="rounded-lg border border-line bg-surface p-s4">
            <a href={e.ziel} data-cse="konto-seite"
               className="text-base text-text underline underline-offset-4">
              {e.titel}
            </a>
            <p className="m-0 mt-s1 text-sm text-text-muted">{e.text}</p>
          </li>
        ))}
      </ul>
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
