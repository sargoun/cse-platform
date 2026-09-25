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
import { KONTO_BENACHRICHTIGUNG_TEXTE } from '@/lib/i18n/konto';
import {
  meinBeschriftungen, meinTexte, PORTAL_BCP47, PORTAL_RICHTUNG, type PortalSprache,
} from '@/lib/i18n/texte';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { setzeEin } from '@/lib/i18n/vorlage';
import { emailDienst } from '@/server/versand/email';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import type {
  ArtDefinition, BenachrichtigungsKontext, Kanal, KanalPraeferenz,
} from '@/server/benachrichtigung/registry';
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

  /*
   * **Die Hülle der Beschäftigten spricht ihre Sprache** (V-200, EMP-12,
   * SEITENKARTE §12) — die Seite war fest deutsch. Und sie zeigt nur die
   * Arten, die einen Menschen im Arbeiterportal ERREICHEN: die, deren Ziel
   * unter `/portal/mein` liegt (V-102). Die übrigen — neue Anfrage,
   * KI-Budget, Vergaberadar — gehen an die Verwaltung; hier standen sie
   * trotzdem, deutsch, mit ihrem Schlüssel als Überschrift. Ihre gespeicherte
   * Wahl reist als verstecktes Feld mit und bleibt, wie sie war.
   */
  const arbeiter = sitzung.portal === 'mitarbeiter';
  const sprache: PortalSprache = arbeiter ? (k.sprache ?? 'de') : 'de';
  const t = KONTO_BENACHRICHTIGUNG_TEXTE[sprache];
  const meine = arbeiter ? meinTexte(sprache) : null;
  const kanalTitel: Readonly<Record<Kanal, string>> = { app: t.kanalApp, email: t.kanalEmail };
  const beispiel: BenachrichtigungsKontext = {
    mandantId: '', mandantSlug: k.slug, sprache: k.sprache,
    objektTyp: 'beispiel', objektId: '', daten: {},
  };
  const erreichtArbeiter = (a: ArtDefinition): boolean =>
    (a.ziel(beispiel) ?? '').startsWith('/portal/mein');
  /* Der Name einer Art — nie ihr Schlüssel (V-200). */
  const artName = (a: ArtDefinition): string => {
    const hinten = a.schluessel.split('.')[1] ?? '';
    return eigenerEintrag(t.art, hinten)
      ?? eigenerEintrag(KONTO_BENACHRICHTIGUNG_TEXTE.de.art, hinten) ?? '—';
  };

  const alle = alleArten();
  const definitionen = arbeiter ? alle.filter(erreichtArbeiter) : alle;
  const verborgen = arbeiter ? alle.filter((a) => !erreichtArbeiter(a)) : [];
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

  /* Beschäftigte lesen 16 px (DESIGN §8); die Verwaltung behält ihre Grössen. */
  const klein = arbeiter ? 'text-base' : 'text-sm';
  const groesse = arbeiter ? 'base' : 'sm';

  return (
    <div lang={PORTAL_BCP47[sprache]} dir={PORTAL_RICHTUNG[sprache]} data-sprache={sprache}>
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.konto}
      bereich={null}
      nurLesen={sitzung.ansicht === 'gruppe'}
      leiste={leisteFuer(sitzung.portal, sitzung.ansicht, k.rolle)}
      wurzel={wurzel}
      sichtbareTabs={k.sichtbareTabs}
      navigationsRechte={k.navigationsRechte}
      {...(meine === null ? {} : { beschriftungen: meinBeschriftungen(meine) })}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{t.titel}</h1>
        {k.slug === null ? null : (
          <Link href={`/portal/${k.slug}/benachrichtigungen`} data-cse="zu-posteingang"
                className="text-sm text-text underline underline-offset-2">
            {t.zumPosteingang}
          </Link>
        )}
      </div>

      <p className={`mb-s5 max-w-prose ${klein} text-text-muted`}>
        <strong className="text-text">{t.einleitungFett}</strong>{' '}
        {t.einleitung}
      </p>

      {gespeichert && (
        <Hinweis art="erfolg" cse="praeferenz-gespeichert" rolle="status" groesse={groesse}
                 className="mb-s5 max-w-prose">
          <strong>{t.gespeichertTitel}</strong>{' '}
          {t.gespeichert}
        </Hinweis>
      )}

      {!post.verbunden && (
        <Hinweis art="warnung" cse="email-nicht-verbunden" groesse={groesse}
                 className="mb-s5 max-w-prose">
          <strong>{t.emailTitel}</strong>{' '}
          {t.email}
        </Hinweis>
      )}

      <form method="post" action="/api/benachrichtigungen/praeferenz"
            data-cse="praeferenz-formular" className="flex flex-col gap-s5">
        <input type="hidden" name="zurueck" value={PFAD} />
        {/*
          * Die Arten, die diese Hülle nicht zeigt, behalten ihre Wahl: die
          * Route setzt JEDE Art nach dem, was das Formular schickt.
          */}
        {verborgen.map((a) => {
          const gewaehlt = praeferenz[a.schluessel] ?? a.kanaeleVorgabe;
          return gewaehlt.includes('email')
            ? <input key={a.schluessel} type="hidden" name={`kanal:${a.schluessel}:email`} value="on" />
            : null;
        })}

        {[...gruppen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, arten]) => (
          <Card key={m} className="flex flex-col gap-s4">
            <h2 className="text-h2 text-text">{eigenerEintrag(t.modul, m) ?? modulTitel(m)}</h2>
            <ul className="flex flex-col gap-s4">
              {arten.map((a) => {
                const aktiv = praeferenz[a.schluessel] ?? a.kanaeleVorgabe;
                return (
                  <li key={a.schluessel} data-cse="praeferenz-zeile" data-art={a.schluessel}
                      className="flex flex-col gap-s2 border-t border-line pt-s4
                                 first:border-0 first:pt-0 sm:flex-row sm:items-start
                                 sm:justify-between">
                    <div className="min-w-0 max-w-prose">
                      <p className="text-base text-text">{artName(a)}</p>
                      <p className={`${klein} text-text-muted`}>
                        {/* Die Vorschau in DER Sprache, in der die Meldung
                            ankaeme (V-102) — sonst verspraeche die Seite
                            Deutsch und zugestellt wuerde Arabisch. */}
                        {a.text({
                          mandantId: '', mandantSlug: k.slug, sprache: k.sprache,
                          objektTyp: 'beispiel', objektId: '', daten: {},
                        })}
                      </p>
                      {!a.sammelbar && (
                        <p className={`mt-s1 ${arbeiter ? 'text-base' : 'text-xs'} text-text-subtle`}>
                          {t.sofort}
                        </p>
                      )}
                    </div>
                    <fieldset className="flex shrink-0 items-center gap-s4">
                      <legend className="sr-only">
                        {setzeEin(t.kanaeleFuer, { art: artName(a) })}
                      </legend>
                      <span className={`inline-flex min-h-11 items-center gap-s2 ${klein}
                                        text-text-subtle`}>
                        <input type="checkbox" checked disabled aria-label={kanalTitel.app}
                               className="h-4 w-4 accent-brand" />
                        {kanalTitel.app}
                      </span>
                      <label className={`inline-flex min-h-11 cursor-pointer items-center gap-s2
                                         ${klein} text-text`}>
                        <input
                          type="checkbox"
                          name={`kanal:${a.schluessel}:email`}
                          defaultChecked={aktiv.includes('email')}
                          className="h-4 w-4 accent-brand"
                        />
                        {kanalTitel.email}
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
            {t.speichern}
          </Button>
        </div>
      </form>
    </PortalRahmen>
    </div>
  );
}
