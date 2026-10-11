# 📚 LernFreund – deine Lern-App mit KI-Coach

LernFreund hilft dir, jedes Schulthema richtig zu verstehen. Du wählst ein Fach und ein Thema, und der KI-Lerncoach **Lumi** (läuft mit Claude) begleitet dich, bis du es kannst.

## Funktionen

| | Funktion | Was sie macht |
|---|---|---|
| 🤖 | **KI-Lerncoach** | Chat mit 5 Modi: *Erklären*, *Üben*, *Prüfungssimulation* (mit Note 1–6), *Zusammenfassung* und *Feynman-Methode* (du erklärst, der Coach gibt Feedback) |
| 🗓️ | **Persönlicher Lernplan** | Prüfungsdatum, Minuten pro Tag und Lerntage wählen → der Coach erstellt einen Plan mit abhakbaren Aufgaben pro Tag. Export in deinen Kalender (.ics) |
| ❓ | **Quiz** | Multiple-Choice-Fragen mit Erklärungen. Falsche Antworten kannst du direkt mit dem Coach besprechen |
| 🃏 | **Karteikarten** | Vom Coach erstellt oder selbst geschrieben, mit Lernboxen: Karten, die du nicht weisst, kommen öfter dran |
| ⏱️ | **Pomodoro-Timer** | 25/50 Minuten lernen, 5/15 Minuten Pause. Die Lernzeit wird automatisch gezählt |
| 📊 | **Notenrechner** | Schweizer Notenskala 1–6, Gewichtungen, Zeugnisnote, Pluspunkte und welche Note du für einen 4er brauchst |
| 🏠 | **Übersicht** | Lern-Serie 🔥, heutige Aufgaben, Prüfungs-Countdown und Lernzeit der Woche |
| 🌓 | **Hell/Dunkel-Modus** | Funktioniert auch auf dem Handy |

Deine Daten (Themen, Chats, Pläne, Noten) bleiben **lokal in deinem Browser** gespeichert.

## Starten

Du brauchst [Node.js](https://nodejs.org) (Version 18 oder neuer) und einen API-Schlüssel von der [Claude Console](https://platform.claude.com).

```bash
npm install
export ANTHROPIC_API_KEY="dein-schlüssel"   # Windows (PowerShell): $env:ANTHROPIC_API_KEY="dein-schlüssel"
npm start
```

Dann im Browser öffnen: **http://localhost:3000**

> ⚠️ Gib deinen API-Schlüssel nie weiter und lade ihn nie auf GitHub hoch.

### Optionale Einstellungen

- `PORT` – anderer Port (Standard: 3000)
- `CLAUDE_MODEL` – anderes Claude-Modell (Standard: `claude-opus-5-5`)

## Aufbau

```
server.js          Node-Server: Webseite + KI-Coach (Chat, Lernplan, Quiz, Karteikarten)
public/index.html  Oberfläche
public/style.css   Design (inkl. Dunkelmodus und Handy-Ansicht)
public/app.js      Logik im Browser
```

## Web-Version (ohne Installation, ohne API-Schlüssel)

Im Ordner `web/` liegt eine Version, die direkt auf claude.ai läuft: **https://claude.ai/artifact/GnLzgFJzAAd85mhnxanUs8**

Der Coach nutzt dort dein eigenes Claude-Konto (beim ersten Mal auf „Erlauben“ klicken). Deine Daten werden privat in der App gespeichert.
`web/index.html` ist die fertige Seite, `web/style.css` und `web/app.js` sind die Quelldateien dafür.
