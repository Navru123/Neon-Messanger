# NEON Messenger

Responsive Messenger mit Registrierung, Direktnachrichten, Gruppen, Echtzeit-Chat, Datei-Uploads und Moderationsbereich. Bestehende Raumcode-Chats bleiben im Backend erhalten.

## Lokal starten

Node.js 20 oder neuer erforderlich.

```bash
npm install
npm run check
npm start
```

Die Anwendung läuft anschließend auf http://localhost:3000. SQLite und Uploads liegen standardmäßig unter `data/`.

## Kontosicherheit und E-Mail

Registrierung benötigt E-Mail-Bestätigung. Passwort-Reset- und Bestätigungslinks werden per SMTP verschickt. Für lokale Entwicklung können Links in Serverlogs und API-Antworten erscheinen; das ist nur für Entwicklung gedacht.

Produktionsvariablen:

| Variable | Zweck |
| --- | --- |
| `SESSION_SECRET` | Zufälliges, dauerhaftes Geheimnis mit mindestens 32 Zeichen; zwingend in Produktion |
| `PUBLIC_URL` | Öffentliche Basis-URL, z. B. `https://deine-domain.example` |
| `SMTP_HOST` | SMTP-Server des Mailanbieters |
| `SMTP_PORT` | Meist 587 für STARTTLS oder 465 für TLS |
| `SMTP_SECURE` | `true` für TLS ab Verbindungsstart, sonst `false` |
| `SMTP_USER` / `SMTP_PASS` | SMTP-Zugangsdaten |
| `SMTP_FROM` | Verifizierte Absenderadresse |
| `ADMIN_EMAIL` | E-Mail des Admin-Kontos, vor der Registrierung setzen |
| `DB_PATH` | Pfad zur SQLite-Datenbank |

Die SMTP-Daten erhältst du von deinem Mailanbieter. Niemals Passwörter oder SMTP-Schlüssel in GitHub-Dateien committen.

## Render-Bereitstellung

`render.yaml` legt einen Node-Webservice, ein dauerhaftes Volume und die nötigen Umgebungsvariablen-Platzhalter an. Ein persistentes Volume kann kostenpflichtig sein. Vor dem Deployment die angezeigten Kosten und Konfiguration prüfen.

1. `PUBLIC_URL` auf die endgültige HTTPS-Adresse setzen.
2. SMTP-Server, Port, TLS-Einstellung, Nutzer, Passwort und Absender konfigurieren.
3. `ADMIN_EMAIL` vor dem Registrieren des Admin-Kontos setzen.
4. Sicherstellen, dass `SESSION_SECRET` dauerhaft bleibt.
5. Nach dem Deployment Registrierung, E-Mail-Link, Login, Passwort-Reset, Direktchat, Gruppe, Avatar, Datei-Upload und Moderation testen.

## Funktionen und Grenzen

- Passwörter werden mit scrypt gehasht; Sessions sind signiert und über HttpOnly-Cookies geschützt.
- Bestätigungslinks laufen nach 24 Stunden ab; Passwort-Reset-Links nach einer Stunde und sind nur einmal nutzbar.
- Avatar-Bilder: JPEG, PNG und WebP bis 2 MB, mit Dateisignatur-Prüfung.
- Chat-Dateien bis 8 MB; Downloads sind nur für Mitglieder der jeweiligen Unterhaltung verfügbar. Dateisignaturen werden geprüft; das ersetzt keinen Virenscanner.
- Admin-Moderation: Meldungen bearbeiten, Nachrichten entfernen, Konten sperren.
- Es gibt **keine Ende-zu-Ende-Verschlüsselung**; der Server kann gespeicherte Nachrichten lesen.
- E-Mail-Verifizierung schützt nicht vor kompromittierten E-Mail-Konten. Vor öffentlichem Einsatz sollten Integrationstests, Backup-/Löschregeln, Monitoring und gegebenenfalls Virenscan ergänzt werden.

## CI

GitHub Actions führt `npm install`, JavaScript-Syntaxprüfungen und einen Smoke-Test des Health-Endpunkts aus. Das ist kein vollständiger Browser- oder Sicherheitstest.
