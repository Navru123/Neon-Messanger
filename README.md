# NEON Messenger

NEON Messenger ist eine Node.js-/Socket.IO-Chat-App mit responsiver Oberfläche, Benutzerkonten, Direktnachrichten und Gruppen. Der bisherige Raumcode-Chat bleibt für vorhandene Räume und ältere Clients verfügbar.

## Funktionen

- Registrierung mit E-Mail, Benutzername, Anzeigename und Passwort
- Passwort-Hashes mit scrypt, signierte HttpOnly-Sitzungscookies und serverseitige Authentifizierung
- Private Direktnachrichten und Gruppen mit bis zu 20 Mitgliedern
- Echtzeit-Nachrichten über Socket.IO; gespeicherte Nachrichten in SQLite
- Profilname und Farb-Avatar
- Uploads bis 8 MB: JPEG, PNG, GIF, WebP, PDF und Textdateien; Downloads sind auf Chat-Mitglieder beschränkt
- Admin-Moderation: Meldungen ansehen/erledigen, Nachrichten entfernen und Konten sperren
- Ratenbegrenzung, Helmet-Sicherheitsheader, Eingabegrenzen und Berechtigungsprüfungen auf dem Server
- Smartphone- und Desktop-Layout
- Legacy-Raumcodes und bestehende Raum-Nachrichten bleiben im Backend erhalten

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm run check
npm start
```

Öffne danach http://localhost:3000. Datenbank und Uploads werden standardmäßig im Ordner `data/` abgelegt. Für eine echte Bereitstellung brauchst du persistenten Speicher.

## Konfiguration

| Variable | Zweck |
| --- | --- |
| `PORT` | Port des Webservers (vom Hosting-Anbieter gesetzt) |
| `DB_PATH` | Vollständiger Pfad zur SQLite-Datenbank |
| `SESSION_SECRET` | Zufälliges Geheimnis mit mindestens 32 Zeichen; in Produktion dauerhaft konfigurieren |
| `ADMIN_EMAIL` | E-Mail-Adresse, die bei der Registrierung Admin-Rechte erhält |

**Admin-Konto:** Setze `ADMIN_EMAIL` vor der Registrierung auf die E-Mail-Adresse des gewünschten Admin-Kontos. Registriere dieses Konto danach. Bereits bestehende Konten werden dadurch nicht automatisch zu Admins. Halte diese Umgebungsvariable privat.

## Render

Die Datei `render.yaml` konfiguriert einen Node-Webservice, ein persistentes Volume unter `/var/data` und ein generiertes `SESSION_SECRET`. Beim Verknüpfen des Projekts prüfe die angezeigten Ressourcen und Kosten, bevor du ein Deployment startest. Persistente Datenträger können kostenpflichtig sein.

Nach dem Deployment:
1. Trage `ADMIN_EMAIL` in den privaten Umgebungsvariablen des Dienstes ein, bevor das Admin-Konto registriert wird.
2. Kontrolliere, dass `SESSION_SECRET` dauerhaft erhalten bleibt.
3. Prüfe `/api/health` und teste Registrierung, Login, Direktchat, Gruppe, Upload und Abmeldung.

## Wichtige Sicherheitsgrenzen

- Das ist **keine Ende-zu-Ende-Verschlüsselung**: Der Server kann gespeicherte Nachrichten verarbeiten und lesen.
- Die Registrierung prüft das E-Mail-Format, sendet aber noch keine Verifizierungs-E-Mail und bietet keinen Passwort-Reset.
- Avatare sind aktuell farbige Initialen; Bild-Avatar-Uploads sind noch nicht implementiert.
- Uploads sind auf Dateiendungen nicht angewiesen, aber die Prüfung nutzt den vom Client angegebenen MIME-Typ. Für öffentlich genutzte Dienste empfiehlt sich zusätzlich serverseitige Dateiinhaltsprüfung und Virenscan.
- Admins können Meldungen prüfen, Nachrichten entfernen und Nicht-Admin-Konten sperren. Es gibt noch kein erweitertes Rollenmodell oder Gruppen-Owner-Management.
- Die SQLite-Datenbank und Uploads müssen auf einem dauerhaften Volume liegen. Ohne persistente Speicherung gehen sie bei Neustarts/Deployments möglicherweise verloren.
- Verwende ein starkes, einzigartiges Passwort und teile keine privaten Informationen in Chats mit Personen, denen du nicht vertraust.

## Bekannte nächste Schritte vor öffentlichem Einsatz

Diese Überarbeitung wurde über die GitHub-Datei-API erstellt; in dieser Umgebung wurde kein vollständiger lokaler Build mit Installation aller Abhängigkeiten ausgeführt. Vor produktivem Einsatz müssen die Änderungen in einer echten Node.js-Umgebung getestet werden. Empfehlenswert sind automatisierte Integrationstests, E-Mail-Verifizierung/Passwort-Reset, Dateiinhaltsprüfung und Datenschutz-/Löschregeln.
