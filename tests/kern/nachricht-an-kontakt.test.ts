/**
 * Die Nutzlast einer Kontaktnachricht bindet GENAU den Text, der hinausgeht
 * (V-101, Invariante 7, D-621).
 *
 * Die Freigabe des Verfassers trägt `policy.nutzlastHash` über diese Nutzlast;
 * `gate()` vergleicht beim Versand denselben Abdruck. Ändert sich zwischen
 * Freigabe und Versand ein Wort, ein Kanal oder ein Zweck, muss der Abdruck
 * ein anderer sein — sonst gälte eine Freigabe für etwas, das niemand
 * gesehen hat.
 */
import { describe, expect, it } from 'vitest';
import { nutzlastHash } from '../../src/server/agent/policy.js';
import {
  KANAELE, ZWECKE, nachrichtNutzlast, type NachrichtAnKontakt,
} from '../../src/server/services/crm/nachricht-an-kontakt.js';

const M = '11111111-1111-1111-1111-111111111111';
const BASIS: NachrichtAnKontakt = {
  ansprechpartnerId: '22222222-2222-2222-2222-222222222222',
  kanal: 'email', zweck: 'vertraglich',
  betreff: 'Reinigungsplan Oktober', text: 'Guten Tag, anbei der Plan für Oktober.',
};

const abdruck = (e: NachrichtAnKontakt): string =>
  nutzlastHash(nachrichtNutzlast(M, 'bestandskunde', e));

describe('die Nutzlast einer Kontaktnachricht', () => {
  it('trägt die Aktion des Tores und die Grundlage des Empfängers', () => {
    const n = nachrichtNutzlast(M, 'bestandskunde', BASIS);
    expect(n.aktion).toBe('email_senden');
    expect(n.empfaengerRechtsgrundlage).toBe('bestandskunde');
    expect(n.inhalt).toMatchObject({ kanal: 'email', zweck: 'vertraglich' });
  });

  it('ein geändertes WORT ergibt einen anderen Abdruck', () => {
    expect(abdruck({ ...BASIS, text: 'Guten Tag, anbei der Plan für November.' }))
      .not.toBe(abdruck(BASIS));
  });

  it('ebenso ein anderer Kanal, Zweck, Betreff oder Empfänger', () => {
    const alle = new Set([
      abdruck(BASIS),
      abdruck({ ...BASIS, kanal: 'sms' }),
      abdruck({ ...BASIS, zweck: 'werbung' }),
      abdruck({ ...BASIS, betreff: 'Anderer Betreff' }),
      abdruck({ ...BASIS, ansprechpartnerId: '33333333-3333-3333-3333-333333333333' }),
    ]);
    expect(alle.size).toBe(5);
  });

  it('und derselbe Inhalt ergibt denselben Abdruck — sonst passte keine Freigabe', () => {
    expect(abdruck({ ...BASIS })).toBe(abdruck(BASIS));
  });

  it('die Listen der Kanäle und Zwecke sind die des Datenbanktyps', () => {
    expect([...KANAELE]).toEqual(['email', 'sms']);
    expect([...ZWECKE]).toEqual(['vertraglich', 'transaktional', 'werbung']);
  });
});
