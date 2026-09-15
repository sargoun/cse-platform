import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { bindeAnfrage, gruppenMandanten } from '@/server/kontext/index';
import { istPortalSprache, type PortalSprache } from '@/lib/i18n/texte';
import { NAVIGATION } from '@/server/registry/navigation';
import { modulAktiv, type Modulbuchung } from '@/server/registry/modul';
import { leisteFuer, tableiste } from '@/server/registry/tableiste';

/**
 * Was eine Kontoseite ueber das angemeldete Konto wissen muss.
 *
 * **Warum es eine eigene Datei ist.** Die Funktion stand in
 * `konto/[[...rest]]/page.tsx` und war damit an die Wurzelseite gebunden.
 * `/portal/konto/benachrichtigungen` (NOT-02) ist eine eigene Route — und
 * braucht dieselbe Leiste, dieselben sichtbaren Tabs und dieselben
 * Navigationsrechte. Sie dort nachzubauen hiesse, eine zweite Fassung zu
 * pflegen, die genau dann auseinanderlaeuft, wenn jemand die erste anfasst.
 *
 * Eine Abfrage, ein Kontext: `bindeAnfrage` setzt die K-02-GUCs, und alles
 * darunter liest unter der RLS dieser Sitzung.
 */
export interface KontoBild {
  readonly name: string | null;
  readonly email: string | null;
  readonly person: string | null;
  readonly rolle: string | null;
  readonly aktiv: string | null;
  readonly slug: string | null;
  readonly bereiche: readonly { slug: string; name: string; ist_standard: boolean }[];
  readonly sichtbareTabs: Readonly<Record<string, boolean>>;
  readonly navigationsRechte: Readonly<Record<string, boolean>>;
  /** Die Sprache der Person (EMP-12) — fuer die Leiste einer Arbeiterin (D-419). */
  readonly sprache: PortalSprache | null;
}

export async function leseKonto(sitzung: Parameters<typeof bindeAnfrage>[1]): Promise<KontoBild> {
  return db().begin(async (tx: postgres.TransactionSql) => {
    /*
     * Eine Abfrage, ein Kontext. `bindeAnfrage` setzt die K-02-GUCs; alles
     * darunter liest unter der RLS dieser Sitzung und nicht daneben.
     */
    await bindeAnfrage(tx, sitzung);
    /*
     * **Im Gruppen-Scope IST `app.mandant_ids` die sichtbare Menge** — genau
     * wie in `portalZugang`, und aus demselben Grund: `app.sichtbare_mandanten()`
     * liest diese Einstellung, und `app.hat_recht` prueft jedes `gruppe.*`-Recht
     * ueber sie. Sie fehlte hier. Die Antwort war fuer jedes Recht `false`, die
     * Gruppenleitung hatte auf ihrem Konto weder Leiste noch Schiene — gefunden
     * vom Durchlauf, benannt von der Durchsicht (D-422).
     */
    if (sitzung.ansicht === 'gruppe') {
      const mandanten = await gruppenMandanten(tx);
      if (mandanten.length > 0) {
        await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`,
          [mandanten.join(',')]);
      }
    }
    const [z] = (await tx.unsafe(
      `select b.name,
              b.email,
              case when p.id is null then null
                   else p.vorname || ' ' || p.nachname end as person,
              p.sprache,
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
            sprache: string | null; rolle: string | null; aktiv: string | null;
            slug: string | null }[];

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

    /*
     * **Recht UND Modul — wie in `portalZugang`, nicht nur das Recht.**
     *
     * Hier fehlte die zweite Frage, und die Folge war der einzige 404 im
     * Portal, den ein Menue selbst erzeugte: `admin` haelt `bau.lesen`,
     * `security.lesen` und `reinigung.lesen` in JEDEM Bereich, also zeigten
     * Seitenleiste und „Mehr"-Blatt auf `/portal/konto` der Reinigung die
     * Punkte Bau, Security, Dienstanweisungen und Schluessel — und jeder
     * davon fiel auf 404, weil das Modul dort nicht gebucht ist (D-377).
     * `portalZugang` bildet die Schnittmenge seit D-377; diese Seite liest
     * ihre Karte selbst und muss es genauso tun.
     */
    const [mb] = sitzung.aktiverMandantId === null ? [] : (await tx.unsafe(
      `select module, module_gepflegt from mandant where id = $1`,
      [sitzung.aktiverMandantId],
    )) as { module: readonly string[] | null; module_gepflegt: boolean }[];
    const buchung: Modulbuchung = sitzung.ansicht === 'gruppe'
      ? { module: [], gepflegt: false }
      : { module: mb?.module ?? [], gepflegt: mb?.module_gepflegt === true };
    const frei = (recht: string | null): boolean =>
      recht === null || modulAktiv(buchung, recht);

    const sichtbareTabs: Record<string, boolean> = {};
    for (const t of ziele) {
      sichtbareTabs[t.schluessel] = (t.recht === null || gehalten.has(t.recht)) && frei(t.recht);
    }
    const navigationsRechte: Record<string, boolean> = {};
    for (const n of NAVIGATION) {
      navigationsRechte[n.schluessel] = gehalten.has(n.recht) && frei(n.recht);
    }

    const rohSprache = z?.sprache ?? '';
    return {
      name: z?.name ?? null,
      email: z?.email ?? null,
      person: z?.person ?? null,
      sprache: istPortalSprache(rohSprache) ? rohSprache : null,
      rolle: z?.rolle ?? null,
      aktiv: z?.aktiv ?? null,
      slug: z?.slug ?? null,
      bereiche,
      sichtbareTabs,
      navigationsRechte,
    };
  }) as Promise<KontoBild>;
}
