import { cookies } from 'next/headers';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { anbieter } from '@/server/auth/kennwort-anmeldung';
import { EINLADUNG_COOKIE } from '@/server/services/system/verwaltungskonto';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { VERWALTUNGSKONTO_TEXTE }
  from '@/lib/i18n/verwaltung/einstellungen/verwaltungskonto';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/einstellungen/benutzer/einladen` — ein Verwaltungskonto
 * einladen (AUT-04, D-610, 0372).
 *
 * **Die Seite, die es nie gab.** Bis 0372 war der SEED die einzige Stelle,
 * die in `benutzer` schrieb: ein neuer Admin liess sich nur durch einen
 * erneuten Seed-Lauf einsetzen, auf einer Produktionsdatenbank also gar
 * nicht. Die Nachbarseite `…/benutzer` traegt im Kopf ausdruecklich „lesend"
 * und schliesst mit dem Satz, die Benutzerverwaltung „komme noch".
 *
 * **Nur der Super-Admin sieht sie ueberhaupt** — das Recht
 * `system.verwaltungskonto_erstellen` ist `nur_global` (D-610), und das
 * Manifest der Route prueft es. Wer es nicht haelt, bekommt 404 und nicht
 * einen ausgegrauten Knopf: ein Knopf auf eine 404 verraet, was er nicht
 * zeigen darf (AUT-06, D-581).
 *
 * **Der Link steht genau einmal hier und wird nicht versendet.** Es ist kein
 * Mailanbieter verbunden (O-501); ein vorgetaeuschter Versand waere
 * schlimmer als keiner (CLAUDE.md „no fake integrations"). Er kommt ueber
 * einen fuenf Minuten lebenden `httpOnly`-Keks von der Route, nie ueber die
 * Adresse — ein Token in der URL steht in jedem Zugriffsprotokoll.
 */
export const dynamic = 'force-dynamic';

interface Props {
  readonly params: Promise<{ mandant: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function VerwaltungskontoEinladen(
  { params, searchParams }: Props,
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/einstellungen/benutzer/einladen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const t = nachSprache(VERWALTUNGSKONTO_TEXTE, zugang.sprache);
  /*
   * **Der Rueckweg haengt am Recht seines ZIELS, nicht am Recht dieser Seite.**
   * Die Benutzerliste verlangt `system.benutzer_lesen`; wer es nicht haelt,
   * bekommt dort 404 — und ein Pfeil auf eine 404 verraet, was er nicht
   * zeigen darf (AUT-06, D-581). In der Praxis haelt ein Super-Admin beides,
   * aber „in der Praxis" ist keine Pruefung: `tests/kern/verweis-rechte.test.ts`
   * verlangt, dass die Seite das Recht ihres Verweisziels selbst prueft, und
   * diese Zeile ist die Antwort darauf.
   */
  const darf = await haeltRechte(zugang.sitzung, 'system.benutzer_lesen');
  const link = (await cookies()).get(EINLADUNG_COOKIE)?.value ?? null;
  const meldungRoh = (await searchParams)['meldung'];
  const meldung = typeof meldungRoh === 'string' ? meldungRoh : null;
  const hausintern = anbieter() === 'demo';

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.wurzelTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['system.benutzer_lesen'] === true
        ? { zurueck: {
          ziel: `/portal/${mandant}/einstellungen/benutzer`,
          text: t.zurueckZurListe,
        } }
        : {})}
    >
      <h1 className="mb-s3 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-[68ch] text-base text-text-muted">{t.untertitel}</p>

      {/*
        * Die Begruendung steht VOR dem Formular, nicht als Fussnote. Wer hier
        * landet, ist der einzige Mensch, der das darf — und der Satz erklaert,
        * warum er es allein darf (D-610).
        */}
      <Hinweis art="hinweis" cse="vk-nur-super-admin" className="mb-s5 max-w-prose">
        <strong>{t.nurSuperAdminTitel}</strong> {t.nurSuperAdmin}
      </Hinweis>

      {link !== null && (
        <Hinweis art="erfolg" cse="vk-link" className="mb-s5 max-w-prose">
          <strong>{t.linkTitel}</strong> {t.linkErklaerung}
          <br /><br />
          <span className="text-sm text-text-muted">{t.linkKopieren}:</span>
          <br />
          <code data-cse="vk-link-wert" className="break-all font-mono text-sm text-text">
            {`/auth/einladung/${link}`}
          </code>
          <br /><br />
          <span className="text-sm">{t.linkEinmal}</span>
        </Hinweis>
      )}

      {meldung !== null && link === null && (
        <Hinweis art="warnung" cse="vk-meldung" className="mb-s5 max-w-prose">
          <strong>{t.fehlerTitel}</strong> {meldung}
        </Hinweis>
      )}

      {!hausintern && (
        <Hinweis art="warnung" cse="vk-anbieter" className="mb-s5 max-w-prose">
          {t.keinVersand}
        </Hinweis>
      )}

      <form action="/api/system/verwaltungskonto" method="post"
            data-cse="vk-formular" className="flex max-w-form flex-col gap-s4">
        <input type="hidden" name="zurueck" value={pfad} />
        <FormField label={t.email} name="email" type="email" required
                   autoComplete="off" hinweis={t.emailHinweis} />
        <FormField label={t.name} name="name" type="text" required
                   autoComplete="off" hinweis={t.nameHinweis} />

        <fieldset className="flex flex-col gap-s2 border-0 p-0">
          <legend className="mb-s2 text-sm font-semibold text-text">{t.rolle}</legend>
          <label className="flex min-h-11 items-start gap-s2 text-sm text-text">
            <input type="radio" name="rolle" value="admin" defaultChecked
                   className="mt-s1" data-cse="vk-rolle-admin" />
            <span>{t.rolleAdmin}</span>
          </label>
          <label className="flex min-h-11 items-start gap-s2 text-sm text-text">
            <input type="radio" name="rolle" value="leitung"
                   className="mt-s1" data-cse="vk-rolle-leitung" />
            <span>{t.rolleLeitung}</span>
          </label>
        </fieldset>

        <Button type="submit" variante="primary" data-cse="vk-einladen">
          {t.einladen}
        </Button>
      </form>

      {/*
        * **Der Satz bleibt, die Frage ist beantwortet (D-617).** Wer hier eine
        * zweite Super-Administration sucht, soll erfahren, dass sie ueber die
        * UMGEBUNG entsteht — und nicht, dass ein Knopf fehlt. Ein fehlender
        * Knopf laedt zum Suchen ein; ein Satz beendet die Suche.
        */}
      <p data-cse="vk-o887" className="mt-s5 max-w-[68ch] text-sm text-text-subtle">
        {t.superAdminOffen}
      </p>
    </PortalRahmen>
  );
}
