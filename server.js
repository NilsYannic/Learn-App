// Lern-App Server: liefert die Web-Oberfläche aus und spricht mit dem KI-Lerncoach (Claude).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

// Server-seitiger Fallback, falls eine Anfrage von Sicherheitsfiltern abgelehnt wird.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

const client = new Anthropic();

const COACH_SYSTEM = `Du bist "Lumi", ein freundlicher, geduldiger KI-Lerncoach für Schülerinnen und Schüler an einem Schweizer Gymnasium (ca. 14–18 Jahre).
Dein Ziel: Die lernende Person soll das gewählte Thema am Ende wirklich verstehen und sicher anwenden können – nicht nur auswendig lernen.

So arbeitest du:
- Antworte immer auf Deutsch (Schweizer Rechtschreibung, also "ss" statt "ß"), ausser das Fach ist eine Fremdsprache und Übungen in dieser Sprache sind sinnvoll.
- Erkläre Schritt für Schritt, mit einfachen Worten, Alltagsbeispielen und Eselsbrücken.
- Stelle aktiv Rückfragen und kleine Kontrollfragen, um zu prüfen, ob etwas verstanden wurde (sokratische Methode). Gib nicht einfach nur Lösungen von Hausaufgaben vor, sondern führe zur Lösung hin.
- Wenn ein Fehler passiert: freundlich korrigieren, erklären warum, und eine ähnliche Übung anbieten.
- Halte Antworten übersichtlich: kurze Absätze, Aufzählungen, **fett** für Schlüsselbegriffe. Formeln in einfacher Schreibweise (z.B. a² + b² = c²).
- Sei motivierend, aber ehrlich. Keine übertrieben langen Texte.
- Bleib beim Thema Lernen. Bei Themen, die nichts mit Schule zu tun haben, lenke freundlich zurück.`;

const MODE_HINTS = {
  erklaeren: "Modus: ERKLÄREN. Erkläre das Thema verständlich von Grund auf und prüfe am Ende mit 1–2 Fragen das Verständnis.",
  ueben: "Modus: ÜBEN. Gib eine passende Übungsaufgabe nach der anderen (steigende Schwierigkeit). Warte auf die Antwort, bevor du die Lösung zeigst.",
  pruefen: "Modus: PRÜFUNGSSIMULATION. Stelle prüfungsähnliche Fragen wie in einer Gymi-Prüfung, eine nach der anderen, und bewerte die Antworten mit kurzem Feedback und einer Note (Schweizer Skala 1–6).",
  zusammenfassen: "Modus: ZUSAMMENFASSUNG. Erstelle eine kompakte, gut strukturierte Zusammenfassung mit den wichtigsten Begriffen, Regeln/Formeln und typischen Fehlern.",
  feynman: "Modus: FEYNMAN-METHODE. Bitte die lernende Person, das Thema in eigenen Worten zu erklären, als würde sie es einem jüngeren Kind erklären. Gib danach Feedback, was gut war und was fehlt.",
};

function topicContext({ subject, topic, level, goal }) {
  return [
    `Fach: ${subject || "unbekannt"}`,
    `Thema: ${topic || "unbekannt"}`,
    level ? `Selbsteinschätzung des Vorwissens: ${level}` : "",
    goal ? `Ziel / Notizen der lernenden Person: ${goal}` : "",
  ].filter(Boolean).join("\n");
}

// ---------- Schemas für strukturierte Antworten ----------

const PlanSchema = z.object({
  summary: z.string().describe("Kurze, motivierende Übersicht über den Plan (2-3 Sätze)"),
  days: z.array(z.object({
    date: z.string().describe("Datum im Format YYYY-MM-DD"),
    title: z.string().describe("Kurzer Titel der Lerneinheit"),
    minutes: z.number().describe("Geplante Lernzeit in Minuten"),
    tasks: z.array(z.string()).describe("Konkrete, abhakbare Aufgaben für diesen Tag"),
    method: z.string().describe("Empfohlene Lernmethode, z.B. Karteikarten, Übungsaufgaben, Feynman, Pomodoro"),
  })),
  tips: z.array(z.string()).describe("3-5 persönliche Lerntipps"),
});

const QuizSchema = z.object({
  questions: z.array(z.object({
    question: z.string(),
    options: z.array(z.string()).describe("Genau 4 Antwortmöglichkeiten"),
    correctIndex: z.number().describe("Index (0-3) der richtigen Antwort"),
    explanation: z.string().describe("Kurze Erklärung, warum die Antwort richtig ist"),
  })),
});

const CardsSchema = z.object({
  cards: z.array(z.object({
    front: z.string().describe("Vorderseite: Begriff oder Frage"),
    back: z.string().describe("Rückseite: Erklärung oder Antwort, kurz und präzise"),
  })),
});

async function structured(schema, prompt, effort = "medium") {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system: COACH_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("Der Coach konnte diese Anfrage leider nicht bearbeiten.");
  if (!response.parsed_output) throw new Error("Die Antwort des Coaches konnte nicht gelesen werden. Bitte nochmals versuchen.");
  return response.parsed_output;
}

// ---------- API-Handler ----------

async function handleChat(body, res) {
  const history = Array.isArray(body.messages) ? body.messages.slice(-40) : [];
  const messages = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return sendJson(res, 400, { error: "Keine Nachricht erhalten." });
  }

  const system = `${COACH_SYSTEM}\n\n${topicContext(body)}\n${MODE_HINTS[body.mode] || MODE_HINTS.erklaeren}`;

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      ...FALLBACK,
      output_config: { effort: "low" },
      system,
      messages,
    });
    stream.on("text", (text) => res.write(text));
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") res.write("\n\n_(Dazu kann ich leider nichts sagen. Lass uns beim Lernstoff bleiben!)_");
  } catch (err) {
    console.error(err);
    res.write(`\n\n⚠️ Fehler: ${friendlyError(err)}`);
  }
  res.end();
}

async function handlePlan(body) {
  const today = body.today || new Date().toISOString().slice(0, 10);
  const prompt = `Erstelle einen persönlichen Lernplan.

${topicContext(body)}
Heute ist: ${today}
Prüfungsdatum: ${body.examDate}
Verfügbare Lernzeit pro Tag: ca. ${body.minutesPerDay || 30} Minuten
Lerntage pro Woche: ${body.daysPerWeek || 5}
${body.busyDays ? `Tage ohne Lernzeit / Besonderes: ${body.busyDays}` : ""}

Regeln:
- Plane nur Tage von heute bis und mit dem Tag vor der Prüfung (wenn die Prüfung heute oder morgen ist, mache einen kompakten Notfallplan).
- Verteile den Stoff sinnvoll: zuerst verstehen, dann üben, dann wiederholen (Spaced Repetition). Die letzten 1–2 Tage vor der Prüfung sind für Wiederholung und eine Probeprüfung.
- Halte dich an die verfügbare Zeit und die Anzahl Lerntage pro Woche; lass freie Tage weg.
- Aufgaben müssen konkret und abhakbar sein (z.B. "5 Übungsaufgaben zu Bruchgleichungen lösen").
- Passe Schwierigkeit und Tempo an das Vorwissen an.`;
  return structured(PlanSchema, prompt, "medium");
}

async function handleQuiz(body) {
  const count = Math.min(Math.max(Number(body.count) || 5, 3), 10);
  const prompt = `Erstelle ein Quiz mit ${count} Multiple-Choice-Fragen (je genau 4 Antworten, genau eine richtig).

${topicContext(body)}
Schwierigkeit: ${body.difficulty || "mittel"}

Die Fragen sollen echtes Verständnis prüfen, nicht nur Auswendiggelerntes. Variiere die Position der richtigen Antwort.`;
  const quiz = await structured(QuizSchema, prompt, "low");
  quiz.questions = quiz.questions.filter((q) => q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length);
  return quiz;
}

async function handleCards(body) {
  const count = Math.min(Math.max(Number(body.count) || 10, 4), 25);
  const prompt = `Erstelle ${count} Karteikarten zum Thema. Vorderseite: Begriff oder Frage. Rückseite: kurze, präzise Antwort.

${topicContext(body)}`;
  return structured(CardsSchema, prompt, "low");
}

// ---------- HTTP-Server ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError || /authentication method/i.test(err?.message || "")) return "Der API-Schlüssel fehlt oder ist ungültig (ANTHROPIC_API_KEY).";
  if (err instanceof Anthropic.RateLimitError) return "Zu viele Anfragen – warte kurz und versuche es nochmals.";
  if (err instanceof Anthropic.APIConnectionError) return "Keine Verbindung zum KI-Coach. Bist du online?";
  if (err instanceof Anthropic.APIError) return `Der KI-Coach meldet einen Fehler (${err.status ?? "?"}).`;
  return err?.message || "Unbekannter Fehler.";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("Anfrage zu gross."));
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("Ungültige Anfrage.")); }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Nicht gefunden");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

const routes = { "/api/plan": handlePlan, "/api/quiz": handleQuiz, "/api/cards": handleCards };

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  if (req.method === "POST" && pathname.startsWith("/api/")) {
    try {
      const body = await readBody(req);
      if (pathname === "/api/chat") return await handleChat(body, res);
      const handler = routes[pathname];
      if (!handler) return sendJson(res, 404, { error: "Unbekannte Route." });
      return sendJson(res, 200, await handler(body));
    } catch (err) {
      console.error(err);
      if (!res.headersSent) return sendJson(res, 500, { error: friendlyError(err) });
      return res.end();
    }
  }
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`📚 Lern-App läuft auf http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Hinweis: ANTHROPIC_API_KEY ist nicht gesetzt – der KI-Coach funktioniert erst mit einem API-Schlüssel.");
  }
});
