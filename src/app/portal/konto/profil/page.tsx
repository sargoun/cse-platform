import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { leisteFuer } from '@/server/registry/tableiste';
import {
  meinBeschriftungen, meinTexte, PORTAL_BCP47, PORTAL_EIGENNAME, PORTAL_RICHTUNG,
  PORTAL_SPRACHEN,
} from '@/lib/i18n/texte';
import { leseKonto } from '../konto';
import { AnmeldungNoetig } from '../../Anmeldung';

/**
 * `/portal/konto/profil` — die eigene Sprache und die eigenen Angaben
 * (EMP-12, §9 `USR`, Phase 1).
 *
 * **Der Befund, der diese Seite nötig machte — ein Nutzerbericht.** Auf dem
 * Telefon einer Mitarbeiterin ist die untere Leiste die GANZE Navigation
 * (SEITENKARTE §11.2), und ihr fünftes Ziel heisst „Profil". Es führte auf
 * „Dieses Modul wird noch gebaut — die Seite dahinter entsteht in Phase 1".
 * Phase 1 ist seit Langem abgehakt.
 *
 * **Dahinter lag mehr als eine fehlende Seite.** `src/lib/i18n/texte.ts`
 * übersetzt das Arbeiterportal vollständig in vier Sprachen — de, en, ar, tr,
 * samt `dir="rtl"`. Die Sprache kommt aus `person.sprache`. Und sie liess sich
 * **nirgends ändern**: keine Seite, keine Route, kein Recht. Wer nicht die
 * Sprache sprach, die in seiner Zeile stand, konnte nichts daran tun. EMP-12
 * war gebaut und für niemanden erreichbar.
 *
 * **Die Sprache steht in IHRER Sprache da, nie übersetzt.** „العربية" und
 * nicht „Arabisch": wer die Oberfläche gerade nicht lesen kann, sucht das
 * Wort, das er kennt — eine übersetzte Sprachliste ist genau für den
 * unbrauchbar, der sie braucht.
 *
 * **Geändert wird hier NUR die Sprache.** Name, Telefonnummer und Anschrift
 * gehören zu den Stammdaten, die die Personalverwaltung pflegt — und die
 * Telefonnummer ist der Anmeldeweg (EMP-01). Sie hier änderbar zu machen
 * hiesse, den Einmalcode auf ein beliebiges Telefon umleiten zu lassen; das
 * Spaltenrecht aus `0165` lässt es gar nicht erst zu.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Profil — CSE Gruppe' };

/** Die Beschriftungen dieser Seite in den vier Portalsprachen. */
const TEXTE = {
  de: {
    titel: 'Profil', sprache: 'Sprache', name: 'Name', anmeldung: 'Anmeldung',
    speichern: 'Sprache speichern',
    gespeichert: 'Die Sprache ist gespeichert.',
    hinweis: 'Ihre Angaben pflegt die Personalverwaltung. Die Sprache stellen Sie selbst ein.',
  },
  en: {
    titel: 'Profile', sprache: 'Language', name: 'Name', anmeldung: 'Sign-in',
    speichern: 'Save language',
    gespeichert: 'Your language has been saved.',
    hinweis: 'Your details are maintained by HR. The language is yours to set.',
  },
  ar: {
    titel: 'الملف الشخصي', sprache: 'اللغة', name: 'الاسم', anmeldung: 'تسجيل الدخول',
    speichern: 'حفظ اللغة',
    gespeichert: 'تم حفظ اللغة.',
    hinweis: 'بياناتك تديرها إدارة شؤون الموظفين. اللغة تختارها بنفسك.',
  },
  tr: {
    titel: 'Profil', sprache: 'Dil', name: 'Ad', anmeldung: 'Giriş',
    speichern: 'Dili kaydet',
    gespeichert: 'Diliniz kaydedildi.',
    hinweis: 'Bilgilerinizi İK yönetir. Dili kendiniz seçersiniz.',
  },
} as const;

export default async function Profil(
  { searchParams }: {
    readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return <AnmeldungNoetig />;
  const k = await leseKonto(sitzung);

  const suche = searchParams === undefined ? {} : await searchParams;
  const gespeichert = suche['gespeichert'] === '1';

  /*
   * **Die Wurzel ist das PORTAL, nicht das Konto** — wortgleich die Begründung
   * der Kontowurzel: zeigte die Leiste auf `/portal/konto`, wäre das Konto
   * eine Sackgasse mit einer Navigation, die im Kreis führt.
   */
  const wurzel = sitzung.ansicht === 'gruppe' ? '/portal/gruppe'
    : sitzung.portal === 'mitarbeiter' ? '/portal/mein'
    : sitzung.portal === 'kunde' ? '/portal/kunde'
    : k.slug === null ? '/auth/bereich' : `/portal/${k.slug}`;

  /** Ohne hinterlegte Sprache ist Deutsch der Stand, nicht eine Annahme. */
  const aktuell = k.sprache ?? 'de';
  const t = TEXTE[aktuell];
  /* Die Hülle in der Sprache der Person — dieselbe Regel wie D-419. */
  const meine = sitzung.portal === 'mitarbeiter' ? meinTexte(aktuell) : null;

  return (
    <div lang={PORTAL_BCP47[aktuell]} dir={PORTAL_RICHTUNG[aktuell]} data-sprache={aktuell}>
      <PortalRahmen
        titel={t.titel}
        bereich={null}
        nurLesen={sitzung.ansicht === 'gruppe'}
        leiste={leisteFuer(sitzung.portal, sitzung.ansicht, k.rolle)}
        wurzel={wurzel}
        aktiverTab="profil"
        sichtbareTabs={k.sichtbareTabs}
        navigationsRechte={k.navigationsRechte}
        {...(meine === null ? {} : { beschriftungen: meinBeschriftungen(meine) })}
      >
        <h1 className="mb-s5 text-h1 text-text">{t.titel}</h1>

        {gespeichert && (
          <Hinweis art="erfolg" cse="sprache-gespeichert" className="mb-s5">
            {t.gespeichert}
          </Hinweis>
        )}

        <dl data-cse="profil-angaben" className="m-0 mb-s6 max-w-[72ch]">
          <div className="grid grid-cols-[auto_1fr] gap-s4 border-b border-line py-s3">
            <dt className="w-32 text-sm text-text-muted">{t.name}</dt>
            <dd className="m-0 min-w-0 break-words text-base text-text">
              {k.person ?? k.name ?? '—'}
            </dd>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-s4 border-b border-line py-s3">
            <dt className="w-32 text-sm text-text-muted">{t.anmeldung}</dt>
            <dd className="m-0 min-w-0 break-words text-base text-text">{k.email ?? '—'}</dd>
          </div>
        </dl>

        <h2 className="mb-s3 text-h3 text-text">{t.sprache}</h2>
        <form
          method="post"
          action="/api/konto/sprache"
          data-cse="sprache-formular"
          className="max-w-[72ch]"
        >
          <input type="hidden" name="zurueck" value="/portal/konto/profil?gespeichert=1" />
          {/*
            * **Radioknöpfe, keine Auswahlliste.** Vier Einträge passen auf
            * jeden Bildschirm, und eine zugeklappte Liste verlangt vom
            * Menschen genau das, was er gerade nicht kann: die Oberfläche
            * lesen, um an die Sprache zu kommen, die er lesen kann.
            */}
          <fieldset className="m-0 border-0 p-0">
            <legend className="sr-only">{t.sprache}</legend>
            <div className="flex flex-col gap-s2">
              {PORTAL_SPRACHEN.map((s) => (
                <label
                  key={s}
                  data-cse="sprache-wahl"
                  data-wert={s}
                  className={`flex min-h-11 cursor-pointer items-center gap-s3 rounded-md border px-s4 transition-colors duration-fast ${
                    s === aktuell
                      ? 'border-brand bg-brand-soft text-text'
                      : 'border-line bg-surface text-text hover:border-line-strong'
                  }`}
                >
                  <input
                    type="radio"
                    name="sprache"
                    value={s}
                    defaultChecked={s === aktuell}
                    className="h-4 w-4 accent-[var(--farbe-brand)]"
                  />
                  {/* Der Eigenname bleibt in SEINER Schreibrichtung stehen. */}
                  <span lang={PORTAL_BCP47[s]} dir={PORTAL_RICHTUNG[s]} className="text-base">
                    {PORTAL_EIGENNAME[s]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" variante="primary" data-cse="sprache-speichern"
                  className="mt-s4">
            {t.speichern}
          </Button>
        </form>

        <p className="mt-s6 max-w-[72ch] text-sm text-text-subtle">{t.hinweis}</p>
      </PortalRahmen>
    </div>
  );
}
