import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { Kommunikationsverlauf } from '@/components/portal/Kommunikationsverlauf';
import type { BereichSchluessel } from '@/lib/design/theme';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { VERLAUF_TEXTE } from '@/lib/i18n/verwaltung/crm-verlauf';
import { CRM_WEGE_TEXTE } from '@/lib/i18n/verwaltung/crm';
import {
  AKTIVITAET_GRENZE, AKTIVITAET_TAGE, leseAktivitaeten, type VerlaufEintrag,
} from '@/server/services/crm/verlauf';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { haeltRechte } from '../../../rechte';

/**
 * `/portal/[mandant]/crm/aktivitaet` — die Liste hinter der Kachel
 * „Aktivität (7 Tage)" (DSH-04, CRM-03, V-149, D-643).
 *
 * **Der Befund.** Die Kachel zählte `lead_aktivitaet` der letzten sieben
 * Tage und führte auf die Kundenliste — auf der keine einzige Aktivität
 * steht. Eine Zahl, die nicht zu ihren Zeilen führt, lässt genau die Frage
 * offen, die sie ausgelöst hat: WELCHE?
 *
 * Diese Seite zeigt dieselbe Menge (`leseAktivitaeten`: dieselbe Tabelle,
 * dieselbe Frist) mit demselben Bauteil wie Kunden- und Kontaktblatt. Sie
 * schreibt nichts: festgehalten wird dort, wo der Vorgang hängt.
 */
export const dynamic = 'force-dynamic';

export default async function Aktivitaet(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/crm/aktivitaet`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const darf = await haeltRechte(sitzung, 'system.benutzer_lesen');
  const t = nachSprache(VERLAUF_TEXTE, zugang.sprache);
  const wege = nachSprache(CRM_WEGE_TEXTE, zugang.sprache);

  const eintraege = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, (kontext) => leseAktivitaeten(kontext)),
  ) as Promise<readonly VerlaufEintrag[]>);

  return (
    <PortalRahmen
      titel={t.aktivitaetTitel}
      wurzelTitel={wege.crm}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="crm"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/crm`, text: wege.crm }}
    >
      <h1 className="mb-s3 text-h1 text-text">{t.aktivitaetTitel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted" data-cse="aktivitaet-erklaerung">
        {t.aktivitaetErklaerung(AKTIVITAET_TAGE)}
      </p>
      <Kommunikationsverlauf
        eintraege={eintraege}
        sprache={zugang.sprache}
        mandant={mandant}
        blatt="liste"
        darfNamen={darf['system.benutzer_lesen'] === true}
        /* Die Liste liest keine Nachrichten — die zählt die Kachel nicht. */
        darfNachrichten
        grenze={AKTIVITAET_GRENZE}
      />
    </PortalRahmen>
  );
}
