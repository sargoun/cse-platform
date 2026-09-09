/**
 * Ein leerer Ersatz für `server-only` im Test.
 *
 * Das echte Paket wirft beim Import, sobald es ausserhalb einer
 * Server-Umgebung landet — genau dafür ist es da: es hält ein Modul mit
 * Datenbankzugriff oder Geheimnissen aus dem Client-Bündel. Vitest ist weder
 * das eine noch das andere, und ohne diesen Ersatz liesse sich kein Modul
 * prüfen, das die Zusicherung trägt.
 *
 * Der Ersatz gilt NUR im Test. Die Anwendung importiert weiterhin das echte
 * Paket, und der Build würde ein versehentlich im Client gelandetes Modul
 * weiterhin ablehnen.
 */
export {};
