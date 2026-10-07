import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  TeamFehler, beendeMitgliedschaft, legeTeamAn, ordneZu, setzeTeamleitung,
} from '@/server/services/kern/team';

/**
 * `POST /api/kalender/teams` — Teams anlegen, Beschäftigungen zuordnen,
 * Mitgliedschaften beenden (V-378, O-650, D-813).
 *
 * Ein Formular, vier Vorgänge (`vorgang`): `anlegen`, `zuordnen`, `beenden`
 * und `leitung` (die Leitung eines Teams setzen oder entfernen).
 * Das Recht ist `kalender.schreiben` — Teams gehören dem Kalendermodul
 * (§7.5), und die Policies aus 0230 verlangen dasselbe.
 *
 * **Zurück gehen nur Schlüssel** (V-275): `?erfolg=<vorgang>` oder
 * `?fehler=<grund>` auf Kalender › Teams; die Seite schlägt die Sätze nach.
 * Der Slug kommt aus der SITZUNG, nie aus dem Formular (Invariante 3).
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function feld(daten: FormData, name: string): string {
  const w = daten.get(name);
  return typeof w === 'string' ? w : '';
}

/** Leer heisst „ohne Leitung"; alles andere muss eine Kennung sein. */
function leitungAus(daten: FormData): string | null {
  const w = feld(daten, 'leitung').trim();
  if (w === '') return null;
  if (!UUID.test(w)) throw new TeamFehler('unbekannte_leitung');
  return w;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const vorgang = feld(daten, 'vorgang');
  let ziel = '/portal';

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'kalender.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich !== undefined) ziel = `/portal/${bereich.slug}/kalender/teams`;

        if (vorgang === 'anlegen') {
          await legeTeamAn(kontext, {
            name: feld(daten, 'name'), bereich: feld(daten, 'bereich'),
            leitungBenutzerId: leitungAus(daten),
          });
        } else if (vorgang === 'leitung') {
          const team = feld(daten, 'team');
          if (!UUID.test(team)) throw new TeamFehler('unbekanntes_team');
          await setzeTeamleitung(kontext, team, leitungAus(daten));
        } else if (vorgang === 'zuordnen') {
          const team = feld(daten, 'team');
          const anstellung = feld(daten, 'anstellung');
          if (!UUID.test(team)) throw new TeamFehler('unbekanntes_team');
          if (!UUID.test(anstellung)) throw new TeamFehler('unbekannte_beschaeftigung');
          await ordneZu(kontext, { teamId: team, anstellungId: anstellung, rolle: feld(daten, 'rolle') });
        } else if (vorgang === 'beenden') {
          const mitglied = feld(daten, 'mitglied');
          if (!UUID.test(mitglied)) throw new TeamFehler('unbekannte_mitgliedschaft');
          await beendeMitgliedschaft(kontext, mitglied);
        } else {
          throw new TeamFehler('unbekannter_vorgang');
        }
      })));
    return zurueck(anfrage, ziel, 'erfolg', vorgang);
  } catch (fehler) {
    if (fehler instanceof TeamFehler) return zurueck(anfrage, ziel, 'fehler', fehler.grund);
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}

/** 303 auf Kalender › Teams mit genau EINEM Schlüssel — nie einem Satz. */
function zurueck(
  anfrage: NextRequest, ziel: string, name: 'erfolg' | 'fehler', schluessel: string,
): NextResponse {
  const adresse = internesZiel(ziel, ziel, anfrage);
  adresse.searchParams.set(name, schluessel);
  return NextResponse.redirect(adresse, 303);
}
