# NEON Chat online stellen

Dieses Paket enthält bereits `render.yaml`. Damit kann ein Hosting-Anbieter die Node.js-Website mit den passenden Startbefehlen und einem Speicherort für die Chat-Daten einrichten.

## Online stellen

1. Entpacke diese ZIP-Datei.
2. Lade **alle Dateien und Ordner** in ein neues GitHub-Repository hoch. Die Datei `render.yaml` muss direkt im Hauptordner liegen.
3. Öffne Render und verbinde das Repository als **Blueprint**. Render liest die `render.yaml` und zeigt dir die geplanten Ressourcen.
4. Prüfe die Konfiguration und starte das Deployment.
5. Nach erfolgreichem Deployment zeigt das Hosting eine HTTPS-Adresse für deine Website. Teile genau diese Adresse mit deinen Freunden.

## Wichtig

- Du musst die Dateien zuerst in ein Git-Repository hochladen; nur die ZIP-Datei lokal zu haben erzeugt noch keinen öffentlichen Weblink.
- Dieses Setup verwendet einen dauerhaften Datenträger unter `/var/data`, damit die SQLite-Nachrichtenbank Neustarts und Deployments übersteht. Laut Render-Dokumentation benötigen persistente Datenträger einen bezahlten Web-Service-Plan. Prüfe die aktuellen Preise und bitte eine erwachsene Person um Hilfe, bevor du irgendetwas Bezahltes aktivierst.
- Der Server läuft online, auch wenn du deinen eigenen Browser schließt. Dein Computer muss nicht eingeschaltet bleiben.
- Der Raum-Code ist ein Einladungsschlüssel. Teile ihn nur mit Menschen, denen du vertraust.
- Der Server kann Nachrichten lesen; es gibt keine echte Ende-zu-Ende-Verschlüsselung. Teile keine Passwörter oder sensiblen Informationen im Chat.
