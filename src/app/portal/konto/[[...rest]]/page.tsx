import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { bindeAnfrage } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { NAVIGATION } from '@/server/registry/navigation';
import { leisteFuer, tableiste } from '@/server/registry/tableiste';
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

interface KontoBild {
  readonly name: string | null;
  readonly email: string | null;
  readonly person: string | null;
  readonly rolle: string | null;
  readonly aktiv: string | null;
  readonly slug: string | null;
  readonly bereiche: readonly { slug: string; name: string; ist_standard: boolean }[];
  readonly sichtbareTabs: Readonly<Record<string, boolean>>;
  readonly navigationsRechte: Readonly<Record<string, boolean>>;
}

async function leseKonto(sitzung: Parameters<typeof bindeAnfrage>[1]): Promise<KontoBild> {
  return db().begin(async (tx: postgres.TransactionSql) => {
    /*
     * Eine Abfrage, ein Kontext. `bindeAnfrage` setzt die K-02-GUCs; alles
     * darunter liest unter der RLS dieser Sitzung und nicht daneben.
     */
    await bindeAnfrage(tx, sitzung);
    const [z] = (await tx.unsafe(
      `select b.name,
              b.email,
              case when p.id is null then null
                   else p.vorname || ' ' || p.nachname end as person,
              r.schluessel as rolle,
              m.name       as aktiv,
              m.slug       as slug
         from benutzer b
         left join person p           on p.id = b.person_id
         left join mandant m          on m.id = $1
         left join benutzer_mandant bm on bm.benutzer_id = b.id
                                      and bm.mandant_id  = $1
                                      and bm.entzogen_am is null
         left join rolle r            on r.id = bm.rolle_id
        where b.id = $2`,
      [sitzung.aktiverMandantId, sitzung.benutzerId],
    )) as { name: string | null; email: string | null; person: string | null;
            rolle: string | null; aktiv: string | null; slug: string | null }[];

    /*
     * `switcher_bereiche()` und nicht die RLS-Sicht auf `mandant`: im
     * Mandanten-Scope zeigt die Sicht nur den AKTIVEN Bereich, und dann
     * behauptete diese Seite, das Konto habe genau eine Mitgliedschaft.
     */
    const bereiche = (await tx.unsafe(
      `select slug, name, ist_standard from app.switcher_bereiche()`,
    )) as { slug: string; name: string; ist_standard: boolean }[];

    /*
     * **Die Rechte der Leiste in DERSELBEN gebundenen Transaktion.**
     *
     * `app.hat_recht` antwortet ohne die K-02-GUCs immer `false`. Getrennt
     * gefragt bekaeme diese Seite deshalb eine leere Tab-Leiste und ein
     * leeres „Mehr"-Blatt — und am Telefon ist dieses Blatt der einzige Weg
     * zurueck in die Module. Genau so war es hier schon einmal, unter einer
     * anderen Ursache.
     */
    const ziele = tableiste(leisteFuer(sitzung.portal, sitzung.ansicht, z?.rolle ?? null)).ziele;
    const gefragt = [...new Set([
      ...ziele.map((t) => t.recht).filter((r): r is string => r !== null),
      ...NAVIGATION.map((n) => n.recht),
    ])];
    const rechteZeilen = gefragt.length === 0 ? [] : (await tx.unsafe(
      sitzung.aktiverMandantId === null
        ? `select r as recht,
                  exists (select 1 from unnest(app.sichtbare_mandanten()) as m(id)
                           where app.hat_recht(r, m.id)) as ok
             from unnest($1::text[]) as r`
        : `select r as recht, app.hat_recht(r, $2::uuid) as ok
             from unnest($1::text[]) as r`,
      sitzung.aktiverMandantId === null
        ? [gefragt] : [gefragt, sitzung.aktiverMandantId],
    )) as { recht: string; ok: boolean }[];
    const gehalten = new Set(rechteZeilen.filter((r) => r.ok).map((r) => r.recht));

    const sichtbareTabs: Record<string, boolean> = {};
    for (const t of ziele) sichtbareTabs[t.schluessel] = t.recht === null || gehalten.has(t.recht);
    const navigationsRechte: Record<string, boolean> = {};
    for (const n of NAVIGATION) navigationsRechte[n.schluessel] = gehalten.has(n.recht);

    return {
      name: z?.name ?? null,
      email: z?.email ?? null,
      person: z?.person ?? null,
      rolle: z?.rolle ?? null,
      aktiv: z?.aktiv ?? null,
      slug: z?.slug ?? null,
      bereiche,
      sichtbareTabs,
      navigationsRechte,
    };
  }) as Promise<KontoBild>;
}

function Zeile({ was, wert }: { readonly was: string; readonly wert: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-s4 border-b border-line py-s3">
      <dt className="w-32 text-sm text-text-muted">{was}</dt>
      <dd className="m-0 text-base text-text">{wert}</dd>
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

  return (
    <PortalRahmen
      titel="Konto"
      bereich={null}
      nurLesen={sitzung.ansicht === 'gruppe'}
      leiste={leisteFuer(sitzung.portal, sitzung.ansicht, k.rolle)}
      wurzel={wurzel}
      sichtbareTabs={k.sichtbareTabs}
      navigationsRechte={k.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">Konto</h1>

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
