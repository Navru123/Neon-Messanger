# NEON Gruppenchat

Ein futuristischer Gruppenchat mit Raum-Code. Alle Teilnehmenden schreiben in denselben Chat. Die Nachrichten werden serverseitig in SQLite gespeichert und sind weiterhin verfügbar, wenn der Raum-Ersteller seinen Browser schließt.

## Was kann die Website?

- Raum erstellen und einen 8-stelligen Einladungscode bekommen
- Einladungslink kopieren oder über Outlook teilen
- Alle Teilnehmenden können in den Gruppenchat schreiben
- Live-Anzeige, wer online ist
- Die letzten 100 Nachrichten werden beim Beitreten geladen
- Nachrichten werden in SQLite gespeichert; sie bleiben nach Browser-Neustarts vorhanden
- Responsive Design für Handy und Desktop
- Grundlegende Schutzmaßnahmen: HTTPS über den Hosting-Anbieter, Rate-Limit für Nachrichten, Sicherheitsheader und begrenzte Eingabelängen

## Lokal testen

Node.js 20 oder neuer installieren. Im Projektordner:

```bash
npm install
npm start
```

Dann `http://localhost:3000` öffnen. Für Freunde außerhalb deines Geräts brauchst du eine gehostete URL; `localhost` ist nur auf deinem eigenen Gerät erreichbar.

## Online stellen

Diese App braucht Hosting für Node.js/WebSockets **und persistenten Speicher**.

1. Lade alle Dateien aus diesem ZIP in ein neues privates oder öffentliches GitHub-Repository.
2. Wähle einen Hosting-Anbieter, der Node.js und Socket.IO/WebSockets unterstützt.
3. Setze den Startbefehl auf `npm start`.
4. Lege einen persistenten Datenträger/Volume an und setze `DB_PATH` auf einen Pfad innerhalb dieses Volumes, zum Beispiel `/var/data/chat.db`.
5. Stelle die Website bereit und teile die HTTPS-URL mit Freunden.

Wenn der Hosting-Anbieter den Datenträger nicht dauerhaft speichert, können Daten bei einem Neustart oder einer neuen Bereitstellung verloren gehen. Prüfe diese Einstellung beim Anbieter.

## Wichtige Grenzen

- Der Raum-Code ist ein Einladungsschlüssel: Jeder, der den Code oder den Link hat, kann beitreten. Teile ihn nur mit deinen Freunden.
- Namen sind nicht durch Konten oder Passwörter geschützt; sie können nachgeahmt werden.
- Der Server verarbeitet und speichert Nachrichten. Das ist **keine Ende-zu-Ende-Verschlüsselung**. Teile dort keine Passwörter oder sehr privaten Informationen.
- Pro Raum werden im Verlauf die letzten 100 Nachrichten an neue Teilnehmende geladen; weitere Nachrichten bleiben in der Datenbank, erscheinen aber nicht automatisch im anfänglichen Verlauf.
- Räume und gespeicherte Nachrichten werden im einfachen Starterprojekt nicht automatisch gelöscht.


## Website-Loader / Hosting-Konfiguration

Im Projekt-Root liegt `render.yaml`. Diese Datei beschreibt den Node-Webservice und den persistenten Datenordner. Die vollständigen Schritte stehen in `ONLINE-STELLEN.md`.
