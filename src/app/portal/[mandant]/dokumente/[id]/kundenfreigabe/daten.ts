import 'server-only';

/** Die Fehlertexte der Dokument-Kundenfreigabe — NEBEN `page.tsx`. */

export const FEHLERTEXT: Readonly<Record<string, string>> = {
  ohne_kunde:
    'Ohne Kundenzuordnung gibt es keinen Kunden, dem dieses Dokument gehört — erst den '
    + 'Kunden in den Metadaten hinterlegen.',
  ohne_grund:
    'Eine Freigabe — und ihre Rücknahme — nennt ihren Grund. Er steht im Prüfprotokoll.',
  schon_so: 'Der Schalter stand schon so; es wurde nichts geändert.',
  geloescht: 'Dieses Dokument ist gelöscht und wird nicht freigegeben.',
  nicht_gefunden: 'Dieses Dokument gibt es nicht.',
  kein_recht:
    'Ihnen fehlt dokument.kunde_freigeben. Dokumente ablegen zu dürfen (dokument.schreiben) '
    + 'ist nicht dasselbe wie zu entscheiden, was ein Kunde sieht.',
};
