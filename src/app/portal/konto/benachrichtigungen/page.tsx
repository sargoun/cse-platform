import type postgres from 'postgres';
import Link from 'next/link';
import { db } from '@/server/db/pool';
import { bindeAnfrage } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { ladePraeferenzen } from '@/server/benachrichtigung/posteingang';
import { alleArten, modulTitel, modulVon } from '@/server/benachrichtigung/bootstrap';
import { emailDienst } from '@/server/versand/email';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import type { ArtDefinition, Kanal, KanalPraeferenz }
  from '@/server/benachrichtigung/registry';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { leisteFuer } from '@/server/registry/tableiste';
import { AnmeldungNoetig } from '../../Anmeldung';
import { leseKonto } from '../konto';

/**
 * `/portal/konto/benachrichtigungen` — die Kanäle je Art (NOT-02,
 * `04-SEITENKARTE.md` §9).
 *
 * **Unter „Konto" und nicht unter „Einstellungen", und das ist keine
 * Geschmacksfrage.** `benachrichtigung_praeferenz` hängt an `benutzer_id`, und
 * `t_praeferenz_eigene` bindet sie an `app.aktueller_benutzer()`: es sind die
 * Einstellungen DIESES MENSCHEN, gültig über alle Bereiche, in denen er
 * Mitglied ist. Unter „Einstellungen" stünden sie neben denen der
 * Gesellschaft — und die nächste Administration änderte sie in der Annahme,
 * für alle zu entscheiden.
 *
 * **`app` lässt sich nicht abwählen**, und das Kästchen ist deshalb gar nicht
 * da. `praeferenz_app_bleibt` erzwingt es in der Tabelle: der Posteingang ist
 * das Protokoll dessen, was jemandem mitgeteilt wurde. Abgeschaltet wird der
 * Weg nach draussen.
 *
 * **Nicht sammelbare Arten sind dabei, aber gekennzeichnet.** Eine
 * Freigabeanfrage oder eine Besetzungslücke für morgen geht nie in eine
 * Tageszusammenfassung — wer das nicht weiss, stellt sie ab und wundert sich.
 */
export const dynamic = 'force-dynamic';

const KANAL_TITEL: Readonly<Record<Kanal, string>> = { app: 'Portal', email: 'E-Mail' };

const PFAD = '/portal/konto/benachrichtigungen';

export default async function Praeferenzen(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  const gespeichert = suche['gespeichert'] === '1';

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return <AnmeldungNoetig />;
  const k = await leseKonto(sitzung);

  /*
   * Dieselbe Wurzel wie die Kontowurzel: das PORTAL, nicht das Konto. Eine
   * Leiste, die im Kreis fuehrt, ist eine Sackgasse mit Menue.
   */
  const wurzel = sitzung.ansicht === 'gruppe' ? '/portal/gruppe'
    : sitzung.portal === 'mitarbeiter' ? '/portal/mein'
    : sitzung.portal === 'kunde' ? '/portal/kunde'
    : k.slug === null ? '/auth/bereich' : `/portal/${k.slug}`;

  const definitionen = alleArten();
  const praeferenz = await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, sitzung);
    const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
    return ladePraeferenzen({ abfrage });
  }) as Promise<KanalPraeferenz>);

  const post = emailDienst(devFlaechenAn());

  /** Nach Modul gruppiert — zwölf Zeilen in einer Liste liest niemand. */
  const gruppen = new Map<string, ArtDefinition[]>();
  for (const a of [...definitionen].sort((x, y) => x.schluessel.localeCompare(y.schluessel))) {
    const m = modulVon(a.schluessel);
    gruppen.set(m, [...(gruppen.get(m) ?? []), a]);
  }

  return (
    <PortalRahmen
      titel="Benachrichtigungen"
      wurzelTitel="Konto"
      bereich={null}
      nurLesen={sitzung.ansicht === 'gruppe'}
      leiste={leisteFuer(sitzung.portal, sitzung.ansicht, k.rolle)}
      wurzel={wurzel}
      sichtbareTabs={k.sichtbareTabs}
      navigationsRechte={k.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Benachrichtigungen</h1>
        {k.slug === null ? null : (
          <Link href={`/portal/${k.slug}/benachrichtigungen`} data-cse="zu-posteingang"
                className="text-sm text-text underline underline-offset-2">
            Zum Posteingang
          </Link>
        )}
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Diese Einstellung gehört <strong className="text-text">Ihnen</strong> und gilt in allen
        Bereichen, in denen Sie Mitglied sind — nicht der Gesellschaft. Der Eintrag im Portal
        lässt sich nicht abschalten: er ist das Protokoll dessen, was Ihnen mitgeteilt wurde.
        Abgeschaltet wird der Weg nach draussen.
      </p>

      {gespeichert && (
        <Hinweis art="erfolg" cse="praeferenz-gespeichert" className="mb-s5 max-w-prose">
          <strong>Gespeichert.</strong> Die Einstellung wirkt ab der nächsten Meldung — nicht
          erst nach einem Neustart.
        </Hinweis>
      )}

      {!post.verbunden && (
        <Hinweis art="warnung" cse="email-nicht-verbunden" className="mb-s5 max-w-prose">
          <strong>E-Mail-Versand: nicht verbunden.</strong> Es ist kein Postausgang hinterlegt
          (offene Frage O-501). „E-Mail" lässt sich hier bereits einstellen; zugestellt wird
          nichts, solange kein Anbieter mit Auftragsverarbeitungsvertrag in der EU eingerichtet
          ist. Bis dahin ist der Posteingang der einzige Weg.
        </Hinweis>
      )}

      <form method="post" action="/api/benachrichtigungen/praeferenz"
            data-cse="praeferenz-formular" className="flex flex-col gap-s5">
        <input type="hidden" name="zurueck" value={PFAD} />

        {[...gruppen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, arten]) => (
          <Card key={m} className="flex flex-col gap-s4">
            <h2 className="text-h2 text-text">{modulTitel(m)}</h2>
            <ul className="flex flex-col gap-s4">
              {arten.map((a) => {
                const aktiv = praeferenz[a.schluessel] ?? a.kanaeleVorgabe;
                return (
                  <li key={a.schluessel} data-cse="praeferenz-zeile" data-art={a.schluessel}
                      className="flex flex-col gap-s2 border-t border-line pt-s4
                                 first:border-0 first:pt-0 sm:flex-row sm:items-start
                                 sm:justify-between">
                    <div className="min-w-0 max-w-prose">
                      <p className="text-base text-text">{a.schluessel.split('.')[1]}</p>
                      <p className="text-sm text-text-muted">
                        {/* Die Vorschau in DER Sprache, in der die Meldung
                            ankaeme (V-102) — sonst verspraeche die Seite
                            Deutsch und zugestellt wuerde Arabisch. */}
                        {a.text({
                          mandantId: '', mandantSlug: k.slug, sprache: k.sprache,
                          objektTyp: 'beispiel', objektId: '', daten: {},
                        })}
                      </p>
                      {!a.sammelbar && (
                        <p className="mt-s1 text-xs text-text-subtle">
                          Kommt immer sofort — nie in einer Tageszusammenfassung.
                        </p>
                      )}
                    </div>
                    <fieldset className="flex shrink-0 items-center gap-s4">
                      <legend className="sr-only">Kanäle für {a.schluessel}</legend>
                      <span className="inline-flex min-h-11 items-center gap-s2 text-sm
                                       text-text-subtle">
                        <input type="checkbox" checked disabled aria-label="Portal"
                               className="h-4 w-4 accent-brand" />
                        {KANAL_TITEL.app}
                      </span>
                      <label className="inline-flex min-h-11 cursor-pointer items-center gap-s2
                                        text-sm text-text">
                        <input
                          type="checkbox"
                          name={`kanal:${a.schluessel}:email`}
                          defaultChecked={aktiv.includes('email')}
                          className="h-4 w-4 accent-brand"
                        />
                        {KANAL_TITEL.email}
                      </label>
                    </fieldset>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}

        <div>
          <Button type="submit" variante="primary" data-cse="praeferenz-speichern">
            Speichern
          </Button>
        </div>
      </form>
    </PortalRahmen>
  );
}
