import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type postgres from 'postgres';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { db } from '@/server/db/pool';
import { SITZUNG_COOKIE, devSitzungAusstellen } from '@/server/auth/sitzung';

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
      order by b.name`,
  )) as Promise<readonly Konto[]>;
}

export default async function DevAnmeldung() {
  if (!devFlaechenAn()) notFound();
  const liste = await konten();

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

    (await cookies()).set(SITZUNG_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 12 * 60 * 60,
    });

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
    <main className="mx-auto flex max-w-content flex-col gap-s5 p-s6">
      <h1 className="text-h1 text-text">Entwicklungsanmeldung</h1>
      <p className="max-w-[72ch] text-base text-text-muted">
        Stellt eine echte Sitzung aus, ohne nach einem Kennwort zu fragen. Nur
        auf den Entwicklungsflächen; ein Deployment liefert hier 404. Die
        richtige Anmeldung (Telefon + Einmalcode) kommt mit PR 20.
      </p>

      <ul className="flex flex-col gap-s3">
        {liste.map((k) => (
          <li key={k.id} className="rounded-lg border border-line bg-surface p-s4">
            <form action={anmelden} className="flex flex-wrap items-center gap-s3">
              <input type="hidden" name="benutzer" value={k.id} />
              <input type="hidden" name="mandant" value={k.mandant_id ?? ''} />
              {/* Der Slug fuer das Ziel: die Handlung kennt sonst nur die id. */}
              <input type="hidden" name="slug" value={k.slug ?? ''} />
              <input
                type="hidden" name="ansicht"
                value={k.rolle === 'mitarbeiter' ? 'person'
                  : k.rolle === 'kunde' ? 'kunde' : 'mandant'}
              />
              <span className="text-base text-text">{k.name}</span>
              <span className="text-sm text-text-muted">
                {k.rolle ?? 'ohne Rolle'}
                {k.mandant === null ? '' : ` · ${k.mandant}`}
              </span>
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
                className="ml-auto min-h-[44px] rounded-md bg-brand px-s4 text-base text-white"
              >
                Anmelden
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
