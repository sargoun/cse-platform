/**
 * 0171 — `akquise` als fünfte Lead-Herkunft (§12 der Auftragsbeschreibung,
 * CRM-01, D-01).
 *
 * **Eine eigene Datei, weil Postgres es so verlangt.** Ein mit
 * `alter type … add value` hinzugefügter Enum-Wert lässt sich in DERSELBEN
 * Transaktion nicht benutzen; die Migration, die ihn schreibt, käme an ihrem
 * eigenen Wert nicht vorbei. Der Migrator fährt jede Datei in einer eigenen
 * Transaktion — also bekommt der Wert eine eigene Datei, und 0172 darf ihn
 * verwenden.
 *
 * **Warum die Herkunft überhaupt getrennt wird.** `lead_quelle` sagt, WOHER
 * ein Lead kommt, und daran hängt mehr als eine Statistik: ein `webformular`
 * trägt eine Anfrage des Kunden und damit eine Rechtsgrundlage nach § 7
 * Abs. 2 UWG, ein Treffer aus der Akquise-Recherche trägt KEINE. Beides in
 * denselben Topf zu werfen hiesse, den Unterschied zu verlieren, an dem die
 * ganze Ausgangsprüfung hängt (D-01, `app.darf_kontaktiert_werden`).
 */

alter type lead_quelle add value 'akquise';
