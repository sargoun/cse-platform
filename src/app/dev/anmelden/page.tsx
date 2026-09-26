import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type postgres from 'postgres';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { db } from '@/server/db/pool';
import { SITZUNG_COOKIE, devSitzungAusstellen, sitzungsKeksOptionen } from '@/server/auth/sitzung';
import { Marke } from '@/components/marke/Marke';
import { istBereich } from '@/lib/design/theme';

/**
 * `/dev/anmelden` — eine Sitzung ausstellen, OHNE Anmeldung.
 *
 * **Das ist die einzige Abkürzung im ganzen Zugangsweg**, und sie steht hinter
 * `CSE_DEV_FLAECHEN`. Alles danach ist echt: die Sitzung ist eine Zeile in
 * `benutzer_sitzung`, aufgelöst wird sie von `app.sitzung_aufloesen`, das
 * Portal kommt aus der Mitgliedschaft, die Rechte aus `app.hat_recht`, und die
 * Zeilen aus RLS. PR 20 ersetzt genau diese Seite durch Telefon + Einmalcode —
 * und sonst nichts.
 *
 * Ein Formular mit `action`, kein Klickskript: ohne JavaScript funktioniert es
 * genauso, und der Token wird als `httpOnly`-Cookie gesetzt, nicht im Browser
 * zusammengebaut.
 */
export const dynamic = 'force-dynamic';

interface Konto {
  id: string;
  name: string;
  email: string | null;
  rolle: string | null;
  mandant_id: string | null;
  mandant: string | null;
  slug: string | null;
}

async function konten(): Promise<readonly Konto[]> {
  return db().begin(async (tx: postgres.TransactionSql) => tx.unsafe(
    `select b.id, b.name, b.email,
            coalesce(gr.schluessel, r.schluessel) as rolle,
            bm.mandant_id, m.name as mandant, m.slug
       from benutzer b
       left join rolle gr on gr.id = b.globale_rolle_id
       left join benutzer_mandant bm
              on bm.benutzer_id = b.id and bm.entzogen_am is null and bm.ist_standard
       left join rolle r on r.id = bm.rolle_id
       left join mandant m on m.id = bm.mandant_id
      where b.status = 'aktiv' and not b.ist_dienstkonto and b.deaktiviert_am is null
        -- Ohne die mitarbeiter-Konten, seit PR 20 (EMP-01). Fuer diesen
        -- einen Weg gibt es jetzt eine echte Anmeldung: /auth/mitarbeiter,
        -- Telefon und Einmalcode. Eine Abkuerzung daneben stehen zu lassen
        -- hiesse, dass jede Pruefung sie nimmt und die Anmeldung ungeprueft
        -- bleibt -- und dass ein Entwicklungsbau einen zweiten Eingang zu
        -- demselben Portal hat.
        --
        -- Die uebrigen Rollen bleiben, weil ihr richtiger Eingang noch nicht
        -- existiert: /auth/login mit E-Mail, Kennwort und zweitem Faktor ist
        -- Phase 1 (AUT-01, AUT-02) und nicht gebaut. Diese Seite verschwindet
        -- mit ihm, nicht vorher.
        and coalesce(gr.schluessel, r.schluessel) is distinct from 'mitarbeiter'
      order by b.name`,
  )) as Promise<readonly Konto[]>;
}

/**
 * Die Telefonnummern der Demo-Beschäftigten — **damit man den echten Weg auch
 * gehen kann.**
 *
 * **Der Befund, der das nötig machte.** Der Absatz oben sagt seit PR 20:
 * „Beschäftigte melden sich unter /auth/mitarbeiter mit Telefonnummer und
 * Einmalcode an". Welche Nummern es gibt, stand nirgends — nicht hier, nicht
 * in `LOKAL-STARTEN.md`, nirgends auf einem Bildschirm. Wer die Demo ansieht,
 * kommt damit an der Mitarbeiteranmeldung nicht vorbei: er kann sie nicht
 * einmal falsch bedienen, weil er keine Eingabe hat.
 *
 * Ein Konto ohne Eingang ist ein Konto, das es für den Betrachter nicht gibt.
 * Die Nummern sind Demodaten und diese Seite ist im Deployment ein 404 — es
 * gibt keinen Grund, sie zu verschweigen, und einen guten, sie zu zeigen.
 *
 * **Und es bleibt der ECHTE Weg.** Hier steht kein Knopf, der anmeldet: der
 * wäre die zweite Tür, die PR 20 absichtlich zugemacht hat. Hier steht nur,
 * was man eintippen kann.
 */
interface Beschaeftigt {
  id: string;
  name: string;
  telefon: string | null;
  mandant: string | null;
}

async function beschaeftigte(): Promise<readonly Beschaeftigt[]> {
  return db().begin(async (tx: postgres.TransactionSql) => tx.unsafe(
    `select b.id, b.name, p.telefon, m.name as mandant
       from benutzer b
       join person p on p.id = b.person_id
       -- Nur Nummern, die auch wirklich hindurchfuehren. Drei der elf
       -- Demopersonen mit Telefonnummer haben keinen Zugang: ihre Nummer
       -- landet auf der Codeseite ohne Code. Eine Liste, die solche Nummern
       -- anbietet, ist schlimmer als keine Liste -- sie schickt jemanden in
       -- eine Sackgasse, die wie ein Fehler aussieht.
       -- UND nicht gesperrt: app.zugang_code_anfordern weist einen gesperrten
       -- Zugang ab, ohne es zu sagen (AUT-06). Eine Nummer, die hier steht und
       -- dort still scheitert, ist genau die Sackgasse, die der Kommentar
       -- darueber vermeiden will. (Keine Backticks in diesem Kommentar: er
       -- steht in einem Template-Literal und wuerde es schliessen.)
       join mitarbeiter_zugang z on z.person_id = p.id and z.gesperrt_am is null
       left join benutzer_mandant bm
              on bm.benutzer_id = b.id and bm.entzogen_am is null and bm.ist_standard
       left join rolle r on r.id = bm.rolle_id
       left join mandant m on m.id = bm.mandant_id
      where b.status = 'aktiv' and not b.ist_dienstkonto and b.deaktiviert_am is null
        and coalesce((select gr.schluessel from rolle gr where gr.id = b.globale_rolle_id),
                     r.schluessel) = 'mitarbeiter'
        and p.telefon is not null
      order by b.name`,
  )) as Promise<readonly Beschaeftigt[]>;
}

export default async function DevAnmeldung() {
  if (!devFlaechenAn()) notFound();
  const liste = await konten();
  const kraefte = await beschaeftigte();

  async function anmelden(daten: FormData): Promise<void> {
    'use server';
    if (!devFlaechenAn()) notFound();
    const benutzerId = String(daten.get('benutzer') ?? '');
    const mandantId = String(daten.get('mandant') ?? '');
    const mandantSlug = String(daten.get('slug') ?? '');
    const ansicht = String(daten.get('ansicht') ?? 'mandant');

    const { token } = await (db().begin(async (tx: postgres.TransactionSql) =>
      devSitzungAusstellen(
        tx, benutzerId, mandantId === '' ? null : mandantId,
        ansicht === 'person' ? 'person' : ansicht === 'kunde' ? 'kunde'
          : ansicht === 'gruppe' ? 'gruppe' : 'mandant',
      )) as Promise<{ token: string }>);

    // Dieselben Attribute wie die echte Anmeldung — vor allem `secure`.
    (await cookies()).set(SITZUNG_COOKIE, token, sitzungsKeksOptionen());

    /**
     * **Und dann WEITER — dorthin, wo dieses Konto hingehoert.**
     *
     * Vorher endete die Handlung hier. Die Sitzung stand, der Keks lag im
     * Browser, und Next zeichnete dieselbe Liste neu: der Knopf sah aus, als
     * reagiere er nicht. Wer das sieht, drueckt ein zweites Mal, legt eine
     * zweite Sitzung an, gibt auf und meldet „die Anmeldung ist kaputt" —
     * obwohl sie funktioniert hat.
     *
     * Eine Anmeldung, die nichts sichtbar tut, ist keine Anmeldung. Das Ziel
     * folgt der Ansicht, weil es sonst zweimal gepflegt werden muesste:
     * `person` hat kein Mandantenportal (und bekaeme dort 404), `kunde`
     * ebenso, und die Gruppensicht liegt auf eigenem Pfad.
     */
    redirect(
      ansicht === 'person' ? '/portal/mein'
        : ansicht === 'kunde' ? '/portal/kunde'
          : ansicht === 'gruppe' ? '/portal/gruppe'
            : `/portal/${mandantSlug === '' ? 'gruppe' : mandantSlug}`,
    );
  }

  return (
    <div className="relative min-h-dvh">
      <div aria-hidden="true"
           className="pointer-events-none fixed inset-0 bg-wash-brand" />
    <main className="relative mx-auto flex w-full max-w-wahl flex-col gap-s5 p-s5 sm:p-s6">
      <a href="/" data-cse="dev-zurueck"
         className="group inline-flex items-center gap-s3 self-start rounded-md p-s1">
        <Marke art="gruppe" groesse="lg" />
        <span className="flex flex-col">
          <span className="text-base font-semibold text-text">CSE Gruppe</span>
          <span className="text-xs text-text-subtle transition-colors duration-fast
                           ease-brand group-hover:text-text-muted">
            <span aria-hidden="true">←</span> Zur Website
          </span>
        </span>
      </a>
      <h1 className="m-0 text-h1 text-text">Entwicklungsanmeldung</h1>
      <p className="m-0 max-w-[72ch] text-base text-text-muted">
        Stellt eine echte Sitzung aus, ohne nach einem Kennwort zu fragen. Nur
        auf den Entwicklungsflächen; ein Deployment liefert hier 404.{' '}
        <strong className="text-text">
          Beschäftigte stehen hier nicht mehr:
        </strong>{' '}
        sie melden sich unter <a className="underline" href="/auth/mitarbeiter">
          /auth/mitarbeiter
        </a> mit Telefonnummer und Einmalcode an (EMP-01). Für die übrigen
        Rollen bleibt diese Seite, bis <code>/auth/login</code> mit Kennwort
        und zweitem Faktor gebaut ist (Phase 1, AUT-01/AUT-02).
      </p>

      {kraefte.length > 0 && (
        <section data-cse="dev-telefonnummern"
                 className="rounded-lg border border-line bg-surface p-s5">
          <h2 className="mb-s2 text-h3 text-text">Beschäftigte: Nummern zum Ausprobieren</h2>
          <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
            Diese Nummern gehören den Demo-Beschäftigten. Auf{' '}
            <a className="underline" href="/auth/mitarbeiter">/auth/mitarbeiter</a>{' '}
            eintippen — der Code steht danach auf dem Bildschirm, weil kein
            SMS-Gateway verbunden ist (O-82). Deutsche Schreibweise mit führender
            Null geht genauso: <code>0170 1000000</code>.
          </p>
          <ul className="flex flex-col gap-s2">
            {kraefte.map((k) => (
              <li key={k.id} data-cse="dev-telefon"
                  className="flex flex-wrap items-baseline justify-between gap-s3 border-b border-line py-s2 last:border-0">
                <span className="text-sm text-text">{k.name}</span>
                <span className="flex items-baseline gap-s3">
                  <span className="text-xs text-text-subtle">{k.mandant ?? '—'}</span>
                  <code data-cse="dev-telefon-nummer" className="text-sm text-text">
                    {k.telefon}
                  </code>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        * **Die ganze ZEILE ist der Knopf** (DESIGN §5 „Chooser rows").
        *
        * Hier standen neun rote Knoepfe untereinander. §5 sagt „one primary
        * button per view", und der Grund steht dort daneben: Rot ist knapp,
        * und ein Bildschirm mit neun roten Knoepfen hat gar keine
        * Hauptaktion — das Auge findet keine Ruhe und muss jede Zeile einzeln
        * lesen. Eine Auswahl hat ohnehin KEINE Hauptaktion: jede Zeile ist
        * gleich sehr der Punkt.
        *
        * Also traegt die Zeile selbst die Handlung. Das ist zugleich die
        * groessere Trefferflaeche (§9) und die ruhigere Flaeche.
        */}
      <ul className="m-0 flex list-none flex-col gap-s3 p-0">
        {liste.map((k) => (
          <li key={k.id}>
            <form action={anmelden} className="m-0">
              <input type="hidden" name="benutzer" value={k.id} />
              <input type="hidden" name="mandant" value={k.mandant_id ?? ''} />
              {/* Der Slug fuer das Ziel: die Handlung kennt sonst nur die id. */}
              <input type="hidden" name="slug" value={k.slug ?? ''} />
              {/*
                * Die Ansicht folgt der MITGLIEDSCHAFT, nicht nur der Rolle.
                *
                * Vorher fiel alles, was nicht `mitarbeiter` oder `kunde` war,
                * auf `mandant` — auch die Gruppen-Administration, die in
                * keiner Gesellschaft Mitglied ist. Die Sitzung entstand dann
                * mit `ansicht = 'mandant'` und `aktiver_mandant_id = null`,
                * und `sitzung_ansicht_stimmig` wies sie ab: die Anmeldung
                * endete in „Application error" mit einem Digest, aus dem
                * niemand etwas lesen kann. `'gruppe'` erzeugte dieser
                * Ausdruck ueberhaupt nie — die Handlung und die Weiterleitung
                * kannten den Fall, das Formular schickte ihn nur nicht.
                */}
              <input
                type="hidden" name="ansicht"
                value={k.rolle === 'mitarbeiter' ? 'person'
                  : k.rolle === 'kunde' ? 'kunde'
                    : k.mandant_id === null ? 'gruppe' : 'mandant'}
              />
              <button
                type="submit"
                data-cse="dev-anmelden"
                data-rolle={k.rolle ?? ''}
                /**
                 * Die Kennung des Kontos steht am Knopf, damit eine Pruefung
                 * sich als EINEN BESTIMMTEN Menschen anmelden kann.
                 * `[data-rolle="mitarbeiter"]` griff das erste Konto dieser
                 * Rolle heraus — solange es nur eines gab, war das dasselbe,
                 * und mit dem zweiten prueft dieselbe Zeile plötzlich eine
                 * andere Person, ohne dass irgendetwas rot wird.
                 */
                data-email={k.email ?? ''}
                className="flex min-h-16 w-full items-center gap-s4 rounded-lg border
                           border-line bg-surface-2 p-s4 text-left transition-all
                           duration-base ease-brand hover:-translate-y-px
                           hover:border-line-strong"
              >
                <Marke art={istBereich(k.slug) ? k.slug : 'gruppe'} groesse="md" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-semibold text-text">{k.name}</span>
                  <span className="truncate text-sm text-text-muted">
                    {k.mandant ?? 'Gruppe'}
                  </span>
                </span>
                {/*
                  * Die Rolle als Etikett und nicht als Fliesstext: sie ist der
                  * SCHLUESSEL aus `rolle.schluessel` und steht so auch in
                  * jedem Protokolleintrag. Eine Pruefung greift sie ueber
                  * `data-rolle` am Knopf, nicht ueber diesen Text.
                  */}
                <span className="shrink-0 rounded-full border border-line-strong
                                 px-s3 py-s1 font-mono text-xs text-text-muted">
                  {k.rolle ?? 'ohne Rolle'}
                </span>
                <span aria-hidden="true" className="shrink-0 text-text-subtle">→</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
    </div>
  );
}
