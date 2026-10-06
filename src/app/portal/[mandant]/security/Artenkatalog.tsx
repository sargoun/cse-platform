import { Button } from '@/components/ui/Button';
import { Hinweis, type HinweisArt } from '@/components/ui/Hinweis';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { ARTEN_TEXTE, type ArtenMeldung } from '@/lib/i18n/verwaltung/security-arten';
import type { PortalSprache } from '@/lib/i18n/texte';
import {
  ART_SPRACHEN, type ArtSprache, type ArtTabelle, type ArtVoreinstellung, type ArtZeile,
} from '@/server/services/security/arten';

/**
 * Der Artenkatalog einer Gesellschaft — Posten- oder Schluesselarten — mit
 * seiner Pflege (O-148, D-783): Voreinstellung uebernehmen, bestaetigen,
 * archivieren, eine eigene Art ergaenzen. Ein Serverbaustein ohne Skript;
 * jede Handlung ist ein eigenes kleines Formular an die Route des Moduls —
 * nie ein Formular im Formular (der Browser schloesse das aeussere, und die
 * Felder dahinter gingen verloren).
 *
 * **Das Wort traegt die Bedeutung** (DESIGN §9, §1.16): eine Zeile der
 * Voreinstellung heisst „unbestätigt (Voreinstellung, O-148)", eine
 * bestaetigte oder selbst angelegte „bestätigt" — keine selbstgebaute Pille
 * (DESIGN §5 fuehrt ein geschlossenes Pillenvokabular). Jedes Wort kommt aus
 * `i18n/verwaltung/security-arten.ts`, in der Sprache der Sitzung (D-82).
 *
 * **Die Knoepfe stehen nur, wer sie druecken darf** (`darfSchreiben`, das
 * Schreibrecht des Moduls); die Route und die Datenbank pruefen es noch
 * einmal. Ohne das Recht bleibt der Katalog lesbar und sagt, wer ihn pflegt.
 */
export interface ArtenkatalogProps {
  readonly mandant: string;
  readonly tabelle: ArtTabelle;
  readonly sprache: PortalSprache | null;
  readonly zeilen: readonly ArtZeile[];
  readonly voreinstellung: readonly ArtVoreinstellung[];
  readonly darfSchreiben: boolean;
  /** Die Route des Moduls, `/api/sicherheit/posten` oder `…/schluessel`. */
  readonly action: string;
  /** `?arten=` vom Rueckweg der Route — ein Ergebnis oder ein Grund, nie Quelltext. */
  readonly meldung: string | null;
}

/** Welche Tonlage ein Ergebnis traegt — Technik, kein Text. */
const MELDUNG_ART: Readonly<Record<ArtenMeldung, HinweisArt>> = {
  voreinstellung: 'erfolg', voreinstellung_vorhanden: 'hinweis', bestaetigt: 'erfolg',
  archiviert: 'erfolg', angelegt: 'erfolg', bezeichnung_fehlt: 'warnung',
  bezeichnung_zu_lang: 'warnung', uebersetzung_zu_lang: 'warnung', doppelt: 'warnung',
  nicht_gefunden: 'warnung',
};

const feld = 'mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted';
const eingabe = 'min-h-11 w-full rounded-md border border-line bg-surface-3 '
  + 'px-s3 py-s2 text-sm text-text';

export function Artenkatalog(p: ArtenkatalogProps) {
  const t = nachSprache(ARTEN_TEXTE, p.sprache);
  const k = t.katalog[p.tabelle];
  const meldungArt = eigenerEintrag(MELDUNG_ART, p.meldung);
  const meldungText = eigenerEintrag(t.meldung, p.meldung);
  const mitUebersetzung = (z: ArtZeile): readonly ArtSprache[] =>
    ART_SPRACHEN.filter((s) => z.uebersetzungen[s] !== undefined);

  return (
    <section data-cse={`${p.tabelle}-katalog`} className="mt-s6 rounded-lg border border-line bg-surface p-s5">
      <h2 className="mb-s2 text-h3 text-text">{k.titel}</h2>
      <p className="mb-s4 max-w-prose text-sm text-text-muted">
        {k.erklaerung}{' '}
        {t.einleitung}
      </p>

      {meldungArt !== undefined && meldungText !== undefined && (
        <Hinweis art={meldungArt} cse={`${p.tabelle}-meldung`} className="mb-s4 max-w-prose">
          {meldungText}
        </Hinweis>
      )}

      {p.zeilen.length === 0 ? (
        <div data-cse={`${p.tabelle}-leer`} className="mb-s4 rounded-md border border-line bg-surface-3 p-s3">
          <p className="m-0 text-sm text-text-muted">
            {t.keine(k.einzahl)}{' '}
            {p.voreinstellung.map((a) => a.bezeichnung).join(', ')}.{' '}
            {p.darfSchreiben ? t.uebernehmenHinweis : t.uebernehmenOhneRecht}
          </p>
          {p.darfSchreiben && (
            <form method="post" action={p.action} className="mt-s3">
              <input type="hidden" name="mandant" value={p.mandant} />
              <input type="hidden" name="aktion" value={`${p.tabelle}en_voreinstellung`} />
              <Button type="submit" variante="secondary" data-cse={`${p.tabelle}en-voreinstellung`}>
                {t.uebernehmen}
              </Button>
            </form>
          )}
        </div>
      ) : (
        <ul className="m-0 mb-s4 list-none p-0">
          {p.zeilen.map((z) => (
            <li
              key={z.id}
              data-cse={p.tabelle}
              data-art={z.id}
              data-schluessel={z.schluessel}
              data-platzhalter={z.istPlatzhalter ? 'ja' : 'nein'}
              className="flex flex-wrap items-center justify-between gap-s3 border-b border-line py-s3 last:border-0"
            >
              <div>
                <span className="text-base text-text">{z.bezeichnung}</span>
                {' · '}
                {z.istPlatzhalter
                  ? <span className="text-sm text-warning">{t.unbestaetigt}</span>
                  : <span className="text-sm text-text-muted">{t.bestaetigtWort}</span>}
                {mitUebersetzung(z).length > 0 && (
                  <p className="m-0 mt-s1 text-xs text-text-subtle">
                    {mitUebersetzung(z).map((s) => `${t.sprache[s]}: ${z.uebersetzungen[s] ?? ''}`).join(' · ')}
                  </p>
                )}
              </div>
              {p.darfSchreiben && (
                <div className="flex flex-wrap gap-s2">
                  {z.istPlatzhalter && (
                    <form method="post" action={p.action}>
                      <input type="hidden" name="mandant" value={p.mandant} />
                      <input type="hidden" name="aktion" value={`${p.tabelle}_bestaetigen`} />
                      <input type="hidden" name="art" value={z.id} />
                      <Button type="submit" variante="secondary" data-cse={`${p.tabelle}-bestaetigen`}>
                        {t.bestaetigen}
                      </Button>
                    </form>
                  )}
                  <form method="post" action={p.action}>
                    <input type="hidden" name="mandant" value={p.mandant} />
                    <input type="hidden" name="aktion" value={`${p.tabelle}_archivieren`} />
                    <input type="hidden" name="art" value={z.id} />
                    <Button type="submit" variante="ghost" data-cse={`${p.tabelle}-archivieren`}>
                      {t.archivieren}
                    </Button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {p.darfSchreiben && (
        <details data-cse={`${p.tabelle}-ergaenzen`}>
          <summary className="cursor-pointer text-sm text-text">{t.ergaenzen(k.einzahl)}</summary>
          <form method="post" action={p.action} className="mt-s3 max-w-prose">
            <input type="hidden" name="mandant" value={p.mandant} />
            <input type="hidden" name="aktion" value={`${p.tabelle}_anlegen`} />
            <label className="mb-s3 block">
              <span className={feld}>{t.bezeichnung}</span>
              <input name="bezeichnung" required maxLength={120} className={eingabe} />
            </label>
            <div className="mb-s3 grid gap-s3 sm:grid-cols-3">
              {ART_SPRACHEN.map((s) => (
                <label key={s} className="block">
                  <span className={feld}>{t.uebersetzungFeld(t.sprache[s])}</span>
                  <input
                    name={`bezeichnung_${s}`} maxLength={120} className={eingabe}
                    dir={s === 'ar' ? 'rtl' : undefined}
                  />
                </label>
              ))}
            </div>
            <p className="mb-s3 max-w-prose text-sm text-text-muted">{t.eigeneArt}</p>
            <Button type="submit" variante="secondary" data-cse={`${p.tabelle}-anlegen`}>
              {t.anlegen(k.einzahl)}
            </Button>
          </form>
        </details>
      )}
    </section>
  );
}
