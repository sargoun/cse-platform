import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { bindeAnfrage } from '@/server/kontext/index';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import { AnmeldungNoetig } from './Anmeldung';

/**
 * `/portal` — der Wegweiser, der gefehlt hat.
 *
 * **Der Befund, gemeldet aus dem Betrieb.** Wer sich mit einem
 * `intern`-Konto anmeldete und keinen Rückweg mitbrachte, landete auf
 * `/portal` — und `/portal` ist keine Seite: die Adresse steht in keinem
 * Manifest, also antwortete Next.js mit 404. Die erste Seite nach einer
 * erfolgreichen Anmeldung war „Diese Seite gibt es hier nicht."
 *
 * **Sieben Stellen zeigten hierher**, und keine von ihnen war falsch:
 * `wegNachAnmeldung`, beide Stufen des zweiten Faktors, die
 * Wiederherstellungscodes, zwei Benachrichtigungsrouten und die
 * Angebotsroute schreiben alle `?? '/portal'` als letzten Ausweg. Sie einzeln
 * zu reparieren hiesse, dieselbe Fallunterscheidung siebenmal zu führen — und
 * beim achten Aufrufer wieder zu vergessen. **Eine Adresse, die überall als
 * Rückfallziel steht, muss selbst wissen, wohin sie gehört.**
 *
 * **Warum kein Manifesteintrag.** Diese Seite zeigt nichts. Sie liest die
 * Sitzung und leitet weiter — es gibt hier kein Recht zu prüfen, weil es
 * nichts zu sehen gibt. Ein Eintrag mit einem Leserecht machte aus einem
 * Wegweiser eine Sache, die man „lesen darf", und die Prüfung liefe an einer
 * Seite ohne Inhalt.
 *
 * **Und warum nicht zurück auf die Anmeldung.** Ohne Sitzung steht hier
 * dieselbe Karte wie auf jeder anderen Portalseite (`AnmeldungNoetig`) und
 * keine Weiterleitung: eine Weiterleitung auf die Anmeldung, die nach dem
 * Erfolg wieder hierher führt, ist genau eine Schleife zu viel.
 */
export const dynamic = 'force-dynamic';

export default async function PortalWegweiser() {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return <AnmeldungNoetig />;

  /*
   * Die beiden festen Portale zuerst — sie haben genau eine Wurzel, und die
   * steht als Literal da, damit `typedRoutes` sie prüft.
   */
  if (sitzung.portal === 'mitarbeiter') redirect('/portal/mein');
  if (sitzung.portal === 'kunde') redirect('/portal/kunde');
  if (sitzung.ansicht === 'gruppe') redirect('/portal/gruppe');

  /*
   * Ein `intern`-Konto hat keine feste Wurzel: der Bereich steht im Pfad.
   * Steht schon einer in der Sitzung, geht es dorthin — sonst zur Wahl
   * (§4.4). Der Slug kommt aus der DATENBANK und nie aus der Anfrage (K-02),
   * deshalb ist `alsRoute` hier die eine erlaubte Umdeutung: `typedRoutes`
   * kennt `/portal/[mandant]`, aber keinen zur Laufzeit gebauten Pfad.
   */
  const slug = sitzung.aktiverMandantId === null ? null : await bereichsSlug(sitzung);
  redirect(slug === null ? '/auth/bereich' : alsRoute(`/portal/${slug}`));
}

async function bereichsSlug(sitzung: Awaited<ReturnType<typeof aktuelleSitzung>>):
Promise<string | null> {
  if (sitzung === null) return null;
  const [zeile] = await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, sitzung);
    return (await tx.unsafe(
      `select slug from mandant where id = $1`, [sitzung.aktiverMandantId],
    )) as { slug: string }[];
  }) as Promise<{ slug: string }[]>);
  return zeile?.slug ?? null;
}
