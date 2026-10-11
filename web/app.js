// LernFreund – läuft als Claude-Artifact. Der KI-Coach nutzt das Claude-Konto der Person,
// Daten werden im Artifact-Speicher (db) und als Reserve im Browser gespeichert.
"use strict";

const SUBJECTS = [
  "Mathematik", "Deutsch", "Englisch", "Französisch", "Italienisch", "Latein", "Biologie", "Chemie", "Physik",
  "Geschichte", "Geografie", "Wirtschaft & Recht", "Informatik", "Bildnerisches Gestalten", "Musik", "Andere…",
];

const QUICK_PROMPTS = {
  erklaeren: ["Erklär mir das Thema von Anfang an", "Gib mir ein Beispiel aus dem Alltag", "Was sind typische Fehler?", "Hast du eine Eselsbrücke?"],
  ueben: ["Gib mir eine leichte Aufgabe", "Gib mir eine schwierigere Aufgabe", "Ich brauche einen Tipp"],
  pruefen: ["Starte die Prüfungssimulation", "Nächste Frage bitte"],
  zusammenfassen: ["Fass das Thema zusammen", "Mach mir einen Spickzettel mit Formeln/Regeln"],
  feynman: ["Ich erkläre dir jetzt das Thema:"],
};

const STORAGE_KEY = "lernfreund-v1";

const COACH_RULES = `Du bist "Lumi", ein freundlicher, geduldiger KI-Lerncoach für Schülerinnen und Schüler an einem Schweizer Gymnasium (ca. 14–18 Jahre).
Ziel: Die lernende Person soll das Thema am Ende wirklich verstehen und sicher anwenden können, nicht nur auswendig lernen.
- Schreib immer auf Deutsch mit Schweizer Rechtschreibung ("ss" statt "ß"). Ausnahme: Übungen in einer Fremdsprache, wenn das Fach eine Fremdsprache ist.
- Erkläre Schritt für Schritt, mit einfachen Worten, Alltagsbeispielen und Eselsbrücken.
- Stelle Rückfragen und kleine Kontrollfragen. Gib bei Hausaufgaben nicht einfach die Lösung, sondern führe zur Lösung hin.
- Bei Fehlern: freundlich korrigieren, erklären warum, eine ähnliche Übung anbieten.
- Kurze Absätze, Aufzählungen, **fett** für Schlüsselbegriffe. Formeln in einfacher Schreibweise (z.B. a² + b² = c²). Keine langen Texte.
- Bleib beim Lernen. Bei schulfremden Themen lenkst du freundlich zurück.`;

const MODE_HINTS = {
  erklaeren: "Modus ERKLÄREN: Erkläre das Thema verständlich von Grund auf und prüfe am Ende mit 1–2 Fragen das Verständnis.",
  ueben: "Modus ÜBEN: Gib eine Übungsaufgabe nach der anderen, mit steigender Schwierigkeit. Warte auf die Antwort, bevor du die Lösung zeigst.",
  pruefen: "Modus PRÜFUNGSSIMULATION: Stelle prüfungsähnliche Fragen wie an einer Gymi-Prüfung, eine nach der anderen, und bewerte jede Antwort mit kurzem Feedback und einer Note (Schweizer Skala 1–6).",
  zusammenfassen: "Modus ZUSAMMENFASSUNG: Erstelle eine kompakte, gut gegliederte Zusammenfassung mit den wichtigsten Begriffen, Regeln oder Formeln und typischen Fehlern.",
  feynman: "Modus FEYNMAN: Bitte die Person, das Thema in eigenen Worten zu erklären, als würde sie es einem jüngeren Kind erklären. Gib danach Feedback: was gut war und was fehlt.",
};

function topicContext(t) {
  return [`Fach: ${t.subject}`, `Thema: ${t.topic}`, `Vorwissen: ${t.level}`, t.goal ? `Notizen der lernenden Person: ${t.goal}` : ""]
    .filter(Boolean).join("\n");
}

// ---------- Zustand ----------

const DEFAULT_SETTINGS = { design: "tafel", musicStyle: "lofi", musicVolume: 0.6, musicAuto: true, pilotQuotes: false };

function emptyState() {
  return { topics: [], activeId: null, minutesByDay: {}, grades: [], theme: null, ...DEFAULT_SETTINGS };
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...emptyState(), ...JSON.parse(raw) };
  } catch { /* leerer Zustand */ }
  return emptyState();
}
const state = loadLocal();

// Cloud-Speicher: ein Dokument pro Thema plus ein "meta"-Dokument, privat pro Person.
const cloud = { col: null, saved: {}, queue: Promise.resolve() };
const MAX_CHAT = 60;

function topicDoc(t) {
  return { ...t, chat: t.chat.slice(-MAX_CHAT) };
}
function metaDoc() {
  const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, state[k]]));
  return { activeId: state.activeId, minutesByDay: state.minutesByDay, grades: state.grades, theme: state.theme, ...settings, order: state.topics.map((t) => t.id) };
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Browser-Speicher nicht verfügbar */ }
  if (!cloud.col) return;
  clearTimeout(save.t);
  save.t = setTimeout(syncCloud, 600);
}

function syncCloud() {
  cloud.queue = cloud.queue.then(async () => {
    const docs = { meta: metaDoc() };
    state.topics.forEach((t) => (docs["t_" + t.id] = topicDoc(t)));
    try {
      for (const [id, body] of Object.entries(docs)) {
        const json = JSON.stringify(body);
        if (cloud.saved[id] === json) continue;
        await cloud.col.doc(id).set(body);
        cloud.saved[id] = json;
      }
      for (const id of Object.keys(cloud.saved)) {
        if (!(id in docs)) { await cloud.col.doc(id).delete(); delete cloud.saved[id]; }
      }
    } catch (err) {
      console.warn("Cloud-Speichern fehlgeschlagen", err);
      cloud.col = null; // weiter nur im Browser speichern
    }
  });
}

async function connectCloud() {
  try {
    const [db, user] = await Promise.all([claude.use("db"), claude.use("user")]);
    if (!db || !user) return;
    const id = await user.id();
    if (!id) return;
    const col = db.collection("data/users/" + id);
    const snap = await col.get();
    if (snap.empty) {
      cloud.col = col;
      if (state.topics.length || state.grades.length) syncCloud(); // lokale Daten hochladen
      return;
    }
    const byId = {};
    let meta = null;
    snap.docs.forEach((d) => {
      const body = structuredClone(d.data());
      cloud.saved[d.id] = JSON.stringify(body);
      if (d.id === "meta") meta = body;
      else if (d.id.startsWith("t_")) byId[body.id] = body;
    });
    const order = meta?.order || Object.keys(byId);
    state.topics = order.map((id) => byId[id]).filter(Boolean)
      .concat(Object.values(byId).filter((t) => !order.includes(t.id)));
    if (meta) {
      state.activeId = meta.activeId; state.minutesByDay = meta.minutesByDay || {};
      state.grades = meta.grades || []; state.theme = meta.theme || null;
      for (const k of Object.keys(DEFAULT_SETTINGS)) state[k] = meta[k] ?? DEFAULT_SETTINGS[k];
    }
    cloud.col = col;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* egal */ }
    applyTheme();
    renderAll();
  } catch (err) {
    console.warn("Cloud-Speicher nicht verfügbar", err);
  }
}

// ---------- KI-Coach (Claude über das Konto der Person) ----------

let samplePromise = null;
function getSample() {
  if (!samplePromise) samplePromise = window.claude?.use ? window.claude.use("sample") : Promise.resolve(null);
  return samplePromise;
}

function sampleErrorText(e) {
  switch (e?.code) {
    case "not_granted": return "Du hast dem Coach den Zugriff auf Claude nicht erlaubt. Lade die Seite neu und klicke auf „Erlauben“.";
    case "sampling_disabled": return "Claude ist für dein Konto gerade nicht verfügbar.";
    case "rate_limited": return "Du hast gerade sehr viele Anfragen geschickt oder dein Nutzungslimit erreicht. Warte etwas und versuch es dann nochmals.";
    case "session_expired": return "Bitte melde dich bei Claude neu an.";
    case "refused": return "Dazu kann der Coach nichts sagen. Formuliere die Frage anders.";
    case "invalid_json": return "Die Antwort des Coaches war unvollständig. Bitte nochmals versuchen.";
    case "cancelled": return "Abgebrochen.";
    default: return "Der Coach ist gerade nicht erreichbar. Versuch es gleich nochmals.";
  }
}

async function askJson(prompt) {
  const sample = await getSample();
  if (!sample) throw new Error("Der KI-Coach funktioniert nur, wenn du die App auf claude.ai öffnest.");
  try {
    return await sample.json(COACH_RULES + "\n\n" + prompt, { cache: false });
  } catch (e) {
    throw new Error(sampleErrorText(e));
  }
}

const $ = (sel) => document.querySelector(sel);
const activeTopic = () => state.topics.find((t) => t.id === state.activeId) || null;
let currentMode = "erklaeren";
let selectedSubject = SUBJECTS[0];

// ---------- Hilfsfunktionen ----------

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Kleiner, sicherer Markdown-Renderer (Text wird zuerst escaped).
function md(text) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = String(text).split("\n");
  let html = "", list = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of lines) {
    let m;
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^#{1,6}\s+(.*)/))) {
      closeList(); html += `<h4>${inline(m[1])}</h4>`;
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList(); html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add("hidden"), 3000);
}

// Eigener Bestätigungsdialog (Browser-Dialoge funktionieren im Artifact nicht).
function ask(message, okLabel = "Ja") {
  return new Promise((resolve) => {
    const dlg = $("#dialog");
    $("#dialogText").textContent = message;
    $("#dialogOk").textContent = okLabel;
    dlg.hidden = false;
    $("#dialogOk").focus();
    const done = (v) => { dlg.hidden = true; $("#dialogOk").onclick = $("#dialogCancel").onclick = null; resolve(v); };
    $("#dialogOk").onclick = () => done(true);
    $("#dialogCancel").onclick = () => done(false);
  });
}

const todayISO = () => isoDate(new Date());
function isoDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysUntil(iso) {
  if (!iso) return null;
  const a = new Date(todayISO() + "T00:00:00"), b = new Date(iso + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
function formatDate(iso, opts = { weekday: "short", day: "numeric", month: "short" }) {
  return new Date(iso + "T00:00:00").toLocaleDateString("de-CH", opts);
}

function requireTopic() {
  const t = activeTopic();
  if (!t) toast("Wähle zuerst ein Fach und ein Thema aus 👈");
  return t;
}

function setBusy(btn, busy, label) {
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> ${label || "Coach denkt nach…"}`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.label || btn.innerHTML;
    btn.disabled = false;
  }
}

function logMinutes(min) {
  const d = todayISO();
  state.minutesByDay[d] = (state.minutesByDay[d] || 0) + min;
  save();
  renderStreak();
}

function markActiveToday() {
  const d = todayISO();
  if (!(d in state.minutesByDay)) { state.minutesByDay[d] = 0; save(); renderStreak(); }
}

function streakCount() {
  let count = 0;
  const d = new Date();
  if (!(isoDate(d) in state.minutesByDay)) d.setDate(d.getDate() - 1); // heute zählt erst, wenn gelernt
  while (isoDate(d) in state.minutesByDay) { count++; d.setDate(d.getDate() - 1); }
  return count;
}

// ---------- Theme ----------

function applyTheme() {
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
}
$("#themeToggle").addEventListener("click", () => {
  const dark = state.theme ? state.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  state.theme = dark ? "light" : "dark";
  save(); applyTheme();
});

// ---------- Fach & Thema ----------

function renderSubjects() {
  $("#subjects").innerHTML = SUBJECTS.map((s) =>
    `<button type="button" class="${s === selectedSubject ? "active" : ""}" data-s="${esc(s)}">${esc(s)}</button>`).join("");
  $("#customSubject").classList.toggle("hidden", selectedSubject !== "Andere…");
}
$("#subjects").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  selectedSubject = b.dataset.s;
  renderSubjects();
});

$("#topicForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const subject = selectedSubject === "Andere…" ? $("#customSubject").value.trim() : selectedSubject;
  const topic = $("#topicInput").value.trim();
  if (!subject || !topic) return toast("Bitte Fach und Thema angeben.");
  const t = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    subject, topic,
    level: $("#levelInput").value,
    goal: $("#goalInput").value.trim(),
    examDate: $("#examInput").value || "",
    chat: [], plan: null, planDone: {}, quizHistory: [], cards: [],
    createdAt: Date.now(),
  };
  state.topics.unshift(t);
  state.activeId = t.id;
  save();
  e.target.reset();
  renderAll();
  switchTab("coach");
  sendChat(`Hallo! Ich möchte "${topic}" in ${subject} lernen. Wo fangen wir an?`);
});

function renderTopicList() {
  const list = $("#topicList");
  if (!state.topics.length) {
    list.innerHTML = `<li class="muted" style="cursor:default">Noch keine Themen – leg oben los! ✨</li>`;
    return;
  }
  list.innerHTML = state.topics.map((t) => {
    const d = daysUntil(t.examDate);
    const badge = d !== null && d >= 0 ? `<span class="pill">${d === 0 ? "heute!" : `in ${d} T.`}</span>` : "";
    return `<li class="${t.id === state.activeId ? "active" : ""}" data-id="${t.id}">
      <div><div class="t-sub">${esc(t.subject)}</div><div>${esc(t.topic)} ${badge}</div></div>
      <button class="del" data-del="${t.id}" title="Thema löschen">✕</button></li>`;
  }).join("");
}
$("#topicList").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    const t = state.topics.find((x) => x.id === del.dataset.del);
    if (t) ask(`„${t.topic}“ mit Chat, Lernplan und Karten löschen?`, "Löschen").then((ok) => {
      if (!ok) return;
      state.topics = state.topics.filter((x) => x.id !== t.id);
      if (state.activeId === t.id) state.activeId = state.topics[0]?.id || null;
      save(); renderAll();
    });
    return;
  }
  const li = e.target.closest("li[data-id]");
  if (li) { state.activeId = li.dataset.id; save(); renderAll(); }
});

function renderActiveTopic() {
  const t = activeTopic();
  const el = $("#activeTopic");
  if (!t) {
    el.innerHTML = `<div><h1>Hoi! Was lernst du gerade? 👋</h1>
      <ol class="steps">
        <li><strong>Fach wählen und Thema eingeben</strong>, z.B. Mathematik → Quadratische Gleichungen.</li>
        <li><strong>Mit Coach Lumi lernen:</strong> erklären lassen, üben, Prüfung simulieren.</li>
        <li><strong>Prüfungsdatum setzen</strong>, dann macht dir Lumi einen Lernplan bis dahin.</li>
      </ol>
      <p class="notice" style="margin-top:12px">Beim ersten Gespräch fragt Claude, ob die App dein Claude-Konto nutzen darf. Klick auf „Erlauben“.</p></div>`;
    return;
  }
  const d = daysUntil(t.examDate);
  let cd = `<button class="btn small" id="setExam">📅 Prüfungsdatum setzen</button>`;
  if (t.examDate) {
    cd = d < 0 ? `<span class="muted">Prüfung war am ${formatDate(t.examDate)}</span>`
      : `<strong>${d === 0 ? "Heute!" : d}</strong><span class="muted">${d === 0 ? "Viel Erfolg! 🍀" : d === 1 ? "Tag bis zur Prüfung" : "Tage bis zur Prüfung"}</span>`;
  }
  el.innerHTML = `<div><span class="subject-badge">${esc(t.subject)}</span><h1>${esc(t.topic)}</h1>
    <span class="muted">${esc(t.level)}</span></div><div class="countdown">${cd}</div>`;
  $("#setExam")?.addEventListener("click", () => { switchTab("plan"); $("#planExam").focus(); });
}

// ---------- Tabs ----------

function switchTab(name) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.id !== `tab-${name}`));
  if (name === "coach") $("#chat").scrollTop = $("#chat").scrollHeight;
}
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) switchTab(b.dataset.tab);
});

// ---------- Übersicht ----------

function renderOverview() {
  const totalMin = Object.values(state.minutesByDay).reduce((a, b) => a + b, 0);
  const allQuizzes = state.topics.flatMap((t) => t.quizHistory || []);
  const avgQuiz = allQuizzes.length ? Math.round(allQuizzes.reduce((a, q) => a + q.score / q.total, 0) / allQuizzes.length * 100) : null;
  const t = activeTopic();
  const planProg = t?.plan ? planProgress(t) : null;
  $("#statsGrid").innerHTML = [
    ["🔥", streakCount(), "Tage Lern-Serie"],
    ["⏱️", totalMin >= 60 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `${totalMin}m`, "Lernzeit total"],
    ["📚", state.topics.length, "Themen"],
    ["❓", avgQuiz === null ? "–" : `${avgQuiz}%`, "Quiz-Schnitt"],
    ["🗓️", planProg === null ? "–" : `${planProg}%`, "Lernplan (aktuelles Thema)"],
  ].map(([i, v, l]) => `<div class="stat"><div class="v">${i} ${v}</div><div class="l">${l}</div></div>`).join("");

  // Heutige Aufgaben aus allen Lernplänen
  const today = todayISO();
  const items = [];
  for (const topic of state.topics) {
    topic.plan?.days.forEach((day, di) => {
      if (day.date === today) items.push({ topic, day, di });
    });
  }
  $("#todayTasks").innerHTML = items.length ? items.map(({ topic, day, di }) => `
    <div style="margin-bottom:10px"><h3>${esc(topic.subject)} · ${esc(day.title)} <span class="pill">${day.minutes} min</span></h3>
    ${day.tasks.map((task, ti) => taskHtml(topic, di, ti, task)).join("")}</div>`).join("")
    : `<p class="muted">Für heute ist nichts geplant. Erstelle einen Lernplan oder übe mit dem Coach! 💪</p>`;

  const exams = state.topics.filter((x) => x.examDate && daysUntil(x.examDate) >= 0)
    .sort((a, b) => a.examDate.localeCompare(b.examDate));
  $("#upcomingExams").innerHTML = exams.length ? `<table><tbody>${exams.map((x) => {
    const d = daysUntil(x.examDate);
    return `<tr><td>${formatDate(x.examDate)}</td><td><strong>${esc(x.subject)}</strong> – ${esc(x.topic)}</td>
      <td class="${d <= 3 ? "bad" : ""}">${d === 0 ? "heute" : `in ${d} Tagen`}</td></tr>`;
  }).join("")}</tbody></table>` : `<p class="muted">Keine Prüfungen eingetragen.</p>`;

  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(isoDate(d)); }
  const max = Math.max(30, ...days.map((d) => state.minutesByDay[d] || 0));
  $("#weekChart").innerHTML = days.map((d) => {
    const v = state.minutesByDay[d] || 0;
    return `<div class="bar-wrap"><span class="bv">${v ? v + "m" : ""}</span><div class="bar" style="height:${(v / max) * 100}%"></div>
      <span class="bl">${formatDate(d, { weekday: "short" })}</span></div>`;
  }).join("");
}

// ---------- Coach-Chat ----------

function renderChat() {
  const t = activeTopic();
  const chat = $("#chat");
  if (!t) {
    chat.innerHTML = `<div class="empty">🤖 Hoi! Ich bin Lumi, dein Lerncoach.<br>Wähle links ein Fach und ein Thema, dann legen wir los.</div>`;
  } else if (!t.chat.length) {
    chat.innerHTML = `<div class="empty">🤖 Bereit für <strong>${esc(t.topic)}</strong>! Stell mir eine Frage oder wähle unten einen Vorschlag.</div>`;
  } else {
    chat.innerHTML = t.chat.map((m) => m.role === "user"
      ? `<div class="msg user">${esc(m.content)}</div>`
      : `<div class="msg assistant">${md(m.content)}</div>`).join("");
  }
  chat.scrollTop = chat.scrollHeight;
  $("#quickPrompts").innerHTML = (QUICK_PROMPTS[currentMode] || []).map((q) => `<button type="button">${esc(q)}</button>`).join("");
}

$("#modes").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  currentMode = b.dataset.mode;
  document.querySelectorAll("#modes button").forEach((x) => x.classList.toggle("active", x === b));
  renderChat();
});

$("#quickPrompts").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (currentMode === "feynman") { $("#chatInput").value = b.textContent + " "; $("#chatInput").focus(); return; }
  sendChat(b.textContent);
});

let chatBusy = false;
let chatCtl = null;
async function sendChat(text) {
  const t = requireTopic();
  if (!t || chatBusy || !text.trim()) return;
  chatBusy = true;
  $("#sendBtn").disabled = true;
  markActiveToday();
  t.chat.push({ role: "user", content: text.trim() });
  save();
  renderChat();

  const chat = $("#chat");
  const bubble = document.createElement("div");
  bubble.className = "msg assistant typing";
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;

  let answer = "";
  chatCtl = new AbortController();
  $("#stopBtn").hidden = false;
  try {
    const sample = await getSample();
    if (!sample) throw { code: "unavailable" };
    const rules = `${COACH_RULES}\n\n${topicContext(t)}\n${MODE_HINTS[currentMode] || MODE_HINTS.erklaeren}\n\nDas Gespräch mit der lernenden Person folgt.`;
    const history = t.chat.slice(-30);
    while (history.length && history[0].role !== "user") history.shift();
    const { text: reply, truncated } = await sample([{ role: "user", content: rules }, ...history], {
      cache: false,
      signal: chatCtl.signal,
      onText: ({ text: soFar }) => {
        answer = soFar;
        bubble.innerHTML = md(answer);
        chat.scrollTop = chat.scrollHeight;
      },
    });
    answer = reply + (truncated ? "\n\n_(Antwort wurde gekürzt. Frag nach dem Rest.)_" : "");
  } catch (e) {
    if (e?.code === "unavailable") answer = "⚠️ Der KI-Coach funktioniert nur, wenn du die App auf claude.ai öffnest.";
    else if (e?.code === "refused") answer = "⚠️ " + sampleErrorText(e);
    else {
      answer = e?.text || answer;
      if (e?.code !== "cancelled") answer += `\n\n⚠️ ${sampleErrorText(e)}`;
    }
  }
  $("#stopBtn").hidden = true;
  bubble.classList.remove("typing");
  if (answer.trim()) t.chat.push({ role: "assistant", content: answer.trim() });
  else t.chat.pop(); // nichts bekommen → Frage wieder entfernen, damit der Verlauf gültig bleibt
  save();
  chatBusy = false;
  $("#sendBtn").disabled = false;
  renderChat();
}

$("#stopBtn").addEventListener("click", () => chatCtl?.abort());

$("#chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#chatInput").value;
  $("#chatInput").value = "";
  sendChat(text);
});
$("#chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chatForm").requestSubmit(); }
});
$("#clearChat").addEventListener("click", async () => {
  const t = activeTopic();
  if (t && t.chat.length && await ask("Chatverlauf für dieses Thema löschen?", "Löschen")) { t.chat = []; save(); renderChat(); }
});

// ---------- Lernplan ----------

function planProgress(t) {
  const all = t.plan.days.reduce((n, d) => n + d.tasks.length, 0);
  const done = Object.values(t.planDone || {}).filter(Boolean).length;
  return all ? Math.round((done / all) * 100) : 0;
}

function taskHtml(t, di, ti, task) {
  const key = `${di}-${ti}`;
  const checked = t.planDone?.[key];
  return `<label class="task ${checked ? "checked" : ""}"><input type="checkbox" data-topic="${t.id}" data-key="${key}" ${checked ? "checked" : ""}>
    <span>${esc(task)}</span></label>`;
}

function onTaskToggle(e) {
  const cb = e.target.closest("input[type=checkbox][data-key]");
  if (!cb) return;
  const t = state.topics.find((x) => x.id === cb.dataset.topic);
  if (!t) return;
  t.planDone = t.planDone || {};
  t.planDone[cb.dataset.key] = cb.checked;
  if (cb.checked) { markActiveToday(); }
  save();
  renderPlan(); renderOverview();
  if (cb.checked && t.plan && planProgress(t) === 100) toast("🎉 Lernplan komplett erledigt! Super gemacht!");
}
$("#planView").addEventListener("change", onTaskToggle);
$("#todayTasks").addEventListener("change", onTaskToggle);

function renderPlan() {
  const t = activeTopic();
  $("#planExam").value = t?.examDate || "";
  $("#planExam").min = todayISO();
  const view = $("#planView");
  if (!t) { view.innerHTML = ""; return; }
  if (!t.plan) {
    view.innerHTML = `<div class="card empty">🗓️ Noch kein Lernplan. Wähle dein Prüfungsdatum und der Coach erstellt dir einen persönlichen Plan.</div>`;
    return;
  }
  const today = todayISO();
  const prog = planProgress(t);
  view.innerHTML = `
    <div class="card">
      <h2>Dein Plan bis ${formatDate(t.examDate, { weekday: "long", day: "numeric", month: "long" })}</h2>
      <p>${esc(t.plan.summary)}</p>
      <div class="progress"><div style="width:${prog}%"></div></div>
      <div class="row" style="justify-content:space-between"><span class="muted">${prog}% erledigt</span>
        <button class="btn small" id="icsBtn">📅 In Kalender exportieren</button></div>
    </div>
    ${t.plan.days.map((day, di) => {
      const done = day.tasks.length && day.tasks.every((_, ti) => t.planDone?.[`${di}-${ti}`]);
      const cls = [done ? "done" : "", day.date === today ? "today" : "", day.date < today ? "past" : ""].join(" ");
      return `<div class="card plan-day ${cls}">
        <header><div><div class="date">${day.date === today ? "Heute · " : ""}${formatDate(day.date, { weekday: "long", day: "numeric", month: "long" })}</div>
        <h3>${esc(day.title)}</h3></div><div><span class="pill">⏱️ ${day.minutes} min</span><span class="pill">${esc(day.method)}</span></div></header>
        ${day.tasks.map((task, ti) => taskHtml(t, di, ti, task)).join("")}
      </div>`;
    }).join("")}
    ${t.plan.tips?.length ? `<div class="card"><h2>💡 Tipps vom Coach</h2><ul class="tips">${t.plan.tips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}`;
  $("#icsBtn").addEventListener("click", () => exportIcs(t));
}

$("#planForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = requireTopic();
  if (!t) return;
  const examDate = $("#planExam").value;
  if (daysUntil(examDate) < 0) return toast("Das Prüfungsdatum liegt in der Vergangenheit.");
  if (t.plan && !(await ask("Deinen bestehenden Lernplan durch einen neuen ersetzen?", "Ersetzen"))) return;
  const btn = $("#planBtn");
  setBusy(btn, true, "Coach erstellt deinen Plan…");
  try {
    const busy = $("#planBusy").value.trim();
    const plan = await askJson(`Erstelle einen persönlichen Lernplan.

${topicContext(t)}
Heute ist: ${todayISO()} (${formatDate(todayISO(), { weekday: "long" })})
Prüfungsdatum: ${examDate}
Lernzeit pro Tag: ca. ${$("#planMinutes").value} Minuten
Lerntage pro Woche: ${$("#planDays").value}
${busy ? `Besondere Tage: ${busy}` : ""}

Regeln:
- Plane nur Tage von heute bis und mit dem Tag vor der Prüfung. Ist die Prüfung heute oder morgen, mach einen kompakten Notfallplan.
- Zuerst verstehen, dann üben, dann wiederholen (verteiltes Wiederholen). Die letzten 1–2 Tage sind für Wiederholung und eine Probeprüfung.
- Halte dich an die Lernzeit und die Anzahl Lerntage pro Woche; freie Tage lässt du weg.
- Aufgaben sind konkret und abhakbar (z.B. "5 Übungsaufgaben zu Bruchgleichungen lösen"), 2–4 pro Tag.
- Passe Tempo und Schwierigkeit an das Vorwissen an.

Antworte nur mit JSON in genau dieser Form:
{"summary": "2-3 motivierende Sätze zum Plan", "days": [{"date": "YYYY-MM-DD", "title": "kurzer Titel", "minutes": 30, "method": "z.B. Übungsaufgaben", "tasks": ["Aufgabe 1", "Aufgabe 2"]}], "tips": ["3-5 persönliche Lerntipps"]}`);
    if (!plan || !Array.isArray(plan.days) || !plan.days.length) throw new Error("Der Plan war unvollständig. Bitte nochmals versuchen.");
    plan.days = plan.days.filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date)).map((d) => ({
      date: d.date, title: String(d.title || "Lernen"), minutes: Number(d.minutes) || 30,
      method: String(d.method || ""), tasks: Array.isArray(d.tasks) ? d.tasks.map(String) : [],
    }));
    plan.summary = String(plan.summary || "");
    plan.tips = Array.isArray(plan.tips) ? plan.tips.map(String) : [];
    plan.days.sort((a, b) => a.date.localeCompare(b.date));
    t.examDate = examDate; t.plan = plan; t.planDone = {};
    save(); renderAll();
    toast("✅ Dein Lernplan ist bereit!");
  } catch (err) {
    toast("⚠️ " + err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function exportIcs(t) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const icsEsc = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const events = t.plan.days.map((d, i) => {
    const start = d.date.replace(/-/g, "");
    const end = new Date(d.date + "T00:00:00"); end.setDate(end.getDate() + 1);
    return ["BEGIN:VEVENT", `UID:${t.id}-${i}@lernfreund`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${isoDate(end).replace(/-/g, "")}`, `SUMMARY:${icsEsc(`📚 ${t.subject}: ${d.title} (${d.minutes} min)`)}`,
      `DESCRIPTION:${icsEsc(d.tasks.map((x) => "• " + x).join("\n"))}`, "END:VEVENT"].join("\r\n");
  });
  const exam = t.examDate.replace(/-/g, "");
  events.push(["BEGIN:VEVENT", `UID:${t.id}-exam@lernfreund`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${exam}`,
    `SUMMARY:${icsEsc(`📝 Prüfung ${t.subject}: ${t.topic}`)}`, "END:VEVENT"].join("\r\n"));
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LernFreund//DE", ...events, "END:VCALENDAR"].join("\r\n");
  const downloads = await window.claude?.use?.("downloads");
  if (!downloads) return toast("Der Kalender-Export ist hier nicht verfügbar.");
  try {
    await downloads.save({ filename: `Lernplan-${t.topic.replace(/[^\wäöüÄÖÜ-]+/g, "_")}.ics`, data: ics });
  } catch (e) {
    if (e?.code === "rejected_extension") toast("Kalenderdateien kann diese Ansicht nicht speichern.");
    else if (e?.code !== "declined") toast("Der Export hat nicht geklappt.");
  }
}

// ---------- Quiz ----------

let quiz = null; // { questions, index, score, answered, wrong: [] }

function renderQuiz() {
  const view = $("#quizView");
  const t = activeTopic();
  if (!quiz) {
    const hist = t?.quizHistory || [];
    view.innerHTML = hist.length ? `<div class="card"><h2>Bisherige Quiz</h2><table><tbody>${hist.slice(-8).reverse().map((h) =>
      `<tr><td>${formatDate(h.date)}</td><td>${h.score} / ${h.total}</td><td>${Math.round(h.score / h.total * 100)}%</td></tr>`).join("")}</tbody></table></div>` : "";
    return;
  }
  if (quiz.index >= quiz.questions.length) {
    const pct = Math.round((quiz.score / quiz.questions.length) * 100);
    const msg = pct === 100 ? "Perfekt! Du kannst das Thema! 🏆" : pct >= 75 ? "Sehr gut! Fast perfekt 💪" : pct >= 50 ? "Gut! Schau dir die Fehler nochmals an." : "Weiter üben – der Coach hilft dir! 🤗";
    view.innerHTML = `<div class="card center"><div class="score-big">${quiz.score} / ${quiz.questions.length}</div><p>${msg}</p>
      <div class="row center">${quiz.wrong.length ? `<button class="btn primary" id="discussWrong">🤖 Fehler mit Coach besprechen</button>` : ""}
      <button class="btn" id="quizAgain">Neues Quiz</button></div></div>`;
    $("#quizAgain").addEventListener("click", () => $("#quizForm").requestSubmit());
    $("#discussWrong")?.addEventListener("click", () => {
      const text = "Ich hatte im Quiz diese Fragen falsch. Kannst du mir erklären, was ich falsch verstanden habe?\n\n" +
        quiz.wrong.map((w) => `• Frage: ${w.question}\n  Meine Antwort: ${w.mine}\n  Richtig: ${w.right}`).join("\n");
      switchTab("coach");
      sendChat(text);
    });
    return;
  }
  const q = quiz.questions[quiz.index];
  view.innerHTML = `<div class="card">
    <div class="muted">Frage ${quiz.index + 1} von ${quiz.questions.length} · Punkte: ${quiz.score}</div>
    <div class="progress"><div style="width:${(quiz.index / quiz.questions.length) * 100}%; background:var(--primary)"></div></div>
    <h3 style="margin-top:12px">${esc(q.question)}</h3>
    <div class="q-options">${q.options.map((o, i) => `<button class="q-option" data-i="${i}">${String.fromCharCode(65 + i)}) ${esc(o)}</button>`).join("")}</div>
    <div id="qFeedback"></div></div>`;
}

$("#quizView").addEventListener("click", (e) => {
  const b = e.target.closest(".q-option");
  if (b && quiz && !quiz.answered) {
    quiz.answered = true;
    const q = quiz.questions[quiz.index];
    const i = Number(b.dataset.i);
    const right = i === q.correctIndex;
    if (right) quiz.score++;
    else quiz.wrong.push({ question: q.question, mine: q.options[i], right: q.options[q.correctIndex] });
    document.querySelectorAll(".q-option").forEach((x, xi) => {
      x.disabled = true;
      if (xi === q.correctIndex) x.classList.add("correct");
      else if (xi === i) x.classList.add("wrong");
    });
    $("#qFeedback").innerHTML = `<div class="q-explain"><strong>${right ? "✅ Richtig!" : "❌ Leider falsch."}</strong> ${esc(q.explanation)}</div>
      <div class="row-end" style="margin-top:10px"><button class="btn primary" id="qNext">${quiz.index + 1 < quiz.questions.length ? "Weiter →" : "Ergebnis anzeigen"}</button></div>`;
    return;
  }
  if (e.target.id === "qNext") {
    quiz.index++; quiz.answered = false;
    if (quiz.index >= quiz.questions.length) {
      const t = activeTopic();
      t.quizHistory = t.quizHistory || [];
      t.quizHistory.push({ date: todayISO(), score: quiz.score, total: quiz.questions.length });
      markActiveToday();
      save(); renderOverview();
    }
    renderQuiz();
  }
});

$("#quizForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = requireTopic();
  if (!t) return;
  const btn = $("#quizBtn");
  setBusy(btn, true, "Coach erstellt dein Quiz…");
  try {
    const data = await askJson(`Erstelle ein Quiz mit ${$("#quizCount").value} Multiple-Choice-Fragen, je genau 4 Antworten, genau eine richtig.

${topicContext(t)}
Schwierigkeit: ${$("#quizDiff").value}

Die Fragen prüfen echtes Verständnis, nicht nur Auswendiggelerntes. Verteile die richtige Antwort auf verschiedene Positionen.
Antworte nur mit JSON in genau dieser Form:
{"questions": [{"question": "…", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "kurze Erklärung, warum das richtig ist"}]}`);
    const questions = (Array.isArray(data?.questions) ? data.questions : [])
      .filter((q) => q && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.options.length)
      .map((q) => ({ question: String(q.question), options: q.options.map(String), correctIndex: q.correctIndex, explanation: String(q.explanation || "") }));
    if (!questions.length) throw new Error("Keine Fragen erhalten. Bitte nochmals versuchen.");
    quiz = { questions, index: 0, score: 0, answered: false, wrong: [] };
    renderQuiz();
  } catch (err) {
    toast("⚠️ " + err.message);
  } finally {
    setBusy(btn, false);
  }
});

// ---------- Karteikarten (vereinfachtes Leitner-System) ----------

let cardIndex = 0;

function dueCards(t) {
  // Box 1 immer, Box 2 jeden 2. Tag, Box 3 jeden 4. Tag (vereinfacht)
  const today = todayISO();
  return t.cards.filter((c) => !c.next || c.next <= today);
}

function renderCards() {
  const view = $("#cardsView");
  const t = activeTopic();
  if (!t) { view.innerHTML = ""; return; }
  if (!t.cards.length) {
    view.innerHTML = `<div class="card empty">🃏 Noch keine Karten für dieses Thema.</div>`;
    return;
  }
  const due = dueCards(t);
  const boxCount = [1, 2, 3].map((b) => t.cards.filter((c) => (c.box || 1) === b).length);
  const stats = `<div class="boxes"><span class="pill">📦 Box 1: ${boxCount[0]}</span><span class="pill">📦 Box 2: ${boxCount[1]}</span>
    <span class="pill">⭐ Box 3 (sitzt!): ${boxCount[2]}</span><span class="pill">Heute fällig: ${due.length}</span></div>`;
  if (!due.length) {
    view.innerHTML = `<div class="card center"><p>🎉 Alle Karten für heute gelernt!</p>${stats}
      <button class="btn" id="cardsAll" style="margin-top:10px">Trotzdem alle wiederholen</button></div>`;
    $("#cardsAll").addEventListener("click", () => { t.cards.forEach((c) => (c.next = "")); save(); renderCards(); });
    return;
  }
  if (cardIndex >= due.length) cardIndex = 0;
  const c = due[cardIndex];
  view.innerHTML = `<div class="card">
    <div class="muted" style="margin-bottom:8px">Karte ${cardIndex + 1} von ${due.length} · tippe zum Umdrehen</div>
    <div class="flashcard" id="flashcard"><div class="flashcard-inner">
      <div class="flashcard-face">${esc(c.front)}</div>
      <div class="flashcard-face back">${esc(c.back)}</div></div></div>
    <div class="row center"><button class="btn danger" data-know="0">😕 Wusste ich nicht</button>
      <button class="btn success" data-know="1">😎 Gewusst!</button></div>
    ${stats}</div>`;
}

$("#cardsView").addEventListener("click", (e) => {
  const fc = e.target.closest("#flashcard");
  if (fc) { fc.classList.toggle("flipped"); return; }
  const b = e.target.closest("[data-know]");
  if (!b) return;
  const t = activeTopic();
  const due = dueCards(t);
  const c = due[cardIndex];
  if (!c) return;
  const intervals = { 1: 0, 2: 2, 3: 4 };
  if (b.dataset.know === "1") {
    c.box = Math.min((c.box || 1) + 1, 3);
    const d = new Date(); d.setDate(d.getDate() + intervals[c.box]);
    c.next = intervals[c.box] ? isoDate(d) : "";
    if (!c.next) cardIndex++;
  } else {
    c.box = 1; c.next = "";
    cardIndex++;
  }
  markActiveToday();
  save(); renderCards();
});

$("#cardsBtn").addEventListener("click", async () => {
  const t = requireTopic();
  if (!t) return;
  const btn = $("#cardsBtn");
  setBusy(btn, true, "Coach schreibt Karten…");
  try {
    const data = await askJson(`Erstelle 12 Karteikarten. Vorderseite: Begriff oder Frage. Rückseite: kurze, präzise Antwort.

${topicContext(t)}
${t.cards.length ? `Diese Karten gibt es schon, wiederhole sie nicht: ${t.cards.map((c) => c.front).slice(0, 60).join(" | ")}` : ""}

Antworte nur mit JSON in genau dieser Form:
{"cards": [{"front": "…", "back": "…"}]}`);
    data.cards = (Array.isArray(data?.cards) ? data.cards : []).filter((c) => c && c.front && c.back)
      .map((c) => ({ front: String(c.front), back: String(c.back) }));
    if (!data.cards.length) throw new Error("Keine Karten erhalten. Bitte nochmals versuchen.");
    t.cards.push(...data.cards.map((c) => ({ ...c, box: 1, next: "" })));
    cardIndex = 0;
    save(); renderCards();
    toast(`✅ ${data.cards.length} neue Karten!`);
  } catch (err) {
    toast("⚠️ " + err.message);
  } finally {
    setBusy(btn, false);
  }
});

$("#addCardBtn").addEventListener("click", () => {
  if (!requireTopic()) return;
  $("#cardForm").hidden = !$("#cardForm").hidden;
  if (!$("#cardForm").hidden) $("#cardFront").focus();
});
$("#cardForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = requireTopic();
  const front = $("#cardFront").value.trim(), back = $("#cardBack").value.trim();
  if (!t || !front || !back) return toast("Bitte beide Seiten ausfüllen.");
  t.cards.push({ front, back, box: 1, next: "" });
  e.target.reset();
  save(); renderCards();
  toast("Karte gespeichert.");
});

// ---------- Pomodoro-Timer ----------

const timer = { total: 25 * 60, left: 25 * 60, running: false, isBreak: false, handle: null, endAt: 0 };

function renderTimer() {
  const m = Math.floor(timer.left / 60), s = timer.left % 60;
  const txt = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  $("#timerDisplay").textContent = txt;
  $("#timerStart").textContent = timer.running ? "⏸️ Pause" : "▶️ Start";
  document.title = timer.running ? `${txt} · LernFreund` : "LernFreund";
  const t = activeTopic();
  $("#timerInfo").textContent = timer.isBreak ? "Pause – steh auf, trink Wasser, beweg dich 🚶"
    : t ? `Lernzeit für: ${t.subject} – ${t.topic}` : "";
}

function timerTick() {
  timer.left = Math.max(0, Math.round((timer.endAt - Date.now()) / 1000));
  if (timer.left === 0) {
    clearInterval(timer.handle);
    timer.running = false;
    if (!timer.isBreak) {
      logMinutes(Math.round(timer.total / 60));
      renderOverview();
      toast("🎉 Lerneinheit geschafft! Zeit für eine Pause.");
    } else {
      toast("⏰ Pause vorbei – weiter geht's!");
    }
    beep();
    timer.left = timer.total;
  }
  renderTimer();
}

function beep() {
  try {
    const ctx = music.ctx || new AudioContext();
    [0, 0.18, 0.36].forEach((d, i) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.frequency.value = [660, 880, 1320][i];
      g.gain.setValueAtTime(0.25, ctx.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.3);
      osc.connect(g).connect(ctx.destination);
      osc.start(ctx.currentTime + d);
      osc.stop(ctx.currentTime + d + 0.32);
    });
  } catch { /* kein Ton möglich */ }
}

function startTimer() {
  timer.endAt = Date.now() + timer.left * 1000;
  timer.handle = setInterval(timerTick, 250);
  timer.running = true;
  if (state.musicAuto && !timer.isBreak) startMusic();
}
function stopTimer() {
  clearInterval(timer.handle);
  timer.running = false;
  if (state.musicAuto) stopMusic();
}

$("#timerStart").addEventListener("click", () => {
  if (timer.running) stopTimer();
  else startTimer();
  renderTimer();
});
$("#timerReset").addEventListener("click", () => {
  stopTimer();
  timer.left = timer.total;
  renderTimer();
});
$("#timerModes").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || timer.running) return;
  document.querySelectorAll("#timerModes button").forEach((x) => x.classList.toggle("active", x === b));
  timer.total = timer.left = Number(b.dataset.min) * 60;
  timer.isBreak = !!b.dataset.break;
  renderTimer();
});

// ---------- Musik (wird live im Browser erzeugt, keine Dateien nötig) ----------

// Akkorde als MIDI-Noten (60 = C4). Ein Akkord pro Takt, 16 Schritte pro Takt.
const MUSIC_STYLES = {
  lofi: {
    name: "Lo-Fi Fokus", desc: "ruhig, gleichmässig, ideal zum Konzentrieren", bpm: 76, swing: 0.12, wave: "triangle", cutoff: 1300,
    chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]], bass: [36, 33, 29, 31],
    kick: [0, 7, 10], snare: [4, 12], hat: 2, lead: null, crackle: true,
  },
  upbeat: {
    name: "Motivation", desc: "fröhlich und mit Schwung", bpm: 112, swing: 0, wave: "sawtooth", cutoff: 2200,
    chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], bass: [36, 31, 33, 29],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: 1, lead: { every: 2, pattern: [0, 1, 2, 1] }, crackle: false,
  },
  pilot: {
    name: "Startbahn", desc: "episch wie ein Start – Schub für die Prüfung", bpm: 124, swing: 0, wave: "sawtooth", cutoff: 2600,
    chords: [[62, 65, 69], [58, 62, 65], [53, 57, 60], [60, 64, 67]], bass: [38, 34, 29, 36],
    kick: [0, 3, 8, 11], snare: [4, 12], hat: 1, lead: { every: 1, pattern: [0, 1, 2, 3, 2, 1] }, crackle: false,
  },
  ambient: {
    name: "Wolkenmeer", desc: "sanfte Klangflächen, ohne Schlagzeug", bpm: 56, swing: 0, wave: "sine", cutoff: 900,
    chords: [[60, 67, 71, 74], [57, 64, 67, 72], [53, 60, 64, 69], [55, 62, 65, 71]], bass: [36, 33, 29, 31],
    kick: [], snare: [], hat: 0, lead: { every: 4, pattern: [3, 2, 1, 2] }, crackle: false,
  },
};

const music = { ctx: null, bus: null, filter: null, playing: false, step: 0, nextTime: 0, handle: null, noise: null, crackle: null };
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function ensureAudio() {
  if (music.ctx) return music.ctx;
  const ctx = new AudioContext();
  music.ctx = ctx;
  music.filter = ctx.createBiquadFilter();
  music.filter.type = "lowpass";
  music.bus = ctx.createGain();
  music.bus.connect(music.filter).connect(ctx.destination);
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  music.noise = buf;
  return ctx;
}

function tone(freq, t, dur, { type = "triangle", gain = 0.1, attack = 0.02, release = 0.2 } = {}) {
  const ctx = music.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(music.bus);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noiseHit(t, dur, filterType, freq, gain) {
  const ctx = music.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = music.noise;
  f.type = filterType;
  f.frequency.value = freq;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(music.bus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function kick(t) {
  const ctx = music.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  osc.connect(g).connect(music.bus);
  osc.start(t);
  osc.stop(t + 0.32);
}

function playStep(step, t) {
  const st = MUSIC_STYLES[state.musicStyle] || MUSIC_STYLES.lofi;
  const bar = Math.floor(step / 16) % st.chords.length, s16 = step % 16;
  const sixteenth = 60 / st.bpm / 4, barLen = sixteenth * 16;
  const chord = st.chords[bar];
  if (s16 === 0) {
    chord.forEach((n) => tone(midiHz(n), t, barLen, { type: st.wave, gain: 0.045, attack: st.bpm < 70 ? 0.8 : 0.15, release: 0.5 }));
  }
  if (s16 === 0 || (st.bpm > 100 && s16 === 8)) {
    tone(midiHz(st.bass[bar]), t, (st.bpm > 100 ? 8 : 16) * sixteenth * 0.9, { type: "sine", gain: 0.22, attack: 0.01, release: 0.15 });
  }
  if (st.kick.includes(s16)) kick(t);
  if (st.snare.includes(s16)) noiseHit(t, 0.18, "bandpass", 1800, 0.25);
  if (st.hat && s16 % st.hat === 0) noiseHit(t, 0.05, "highpass", 7000, s16 % 4 === 2 ? 0.09 : 0.05);
  if (st.lead && s16 % st.lead.every === 0) {
    const i = (s16 / st.lead.every) % st.lead.pattern.length;
    const n = chord[st.lead.pattern[i] % chord.length] + 12;
    tone(midiHz(n), t, sixteenth * st.lead.every * 0.9, { type: st.bpm < 70 ? "sine" : "square", gain: st.bpm < 70 ? 0.05 : 0.03, attack: 0.01, release: 0.08 });
  }
  if (st.crackle && Math.random() < 0.3) noiseHit(t + Math.random() * sixteenth, 0.01, "highpass", 3000, 0.03);
}

function scheduleMusic() {
  const st = MUSIC_STYLES[state.musicStyle] || MUSIC_STYLES.lofi;
  const sixteenth = 60 / st.bpm / 4;
  while (music.nextTime < music.ctx.currentTime + 0.15) {
    playStep(music.step, music.nextTime);
    const swing = st.swing ? (music.step % 2 === 0 ? 1 + st.swing : 1 - st.swing) : 1;
    music.nextTime += sixteenth * swing;
    music.step = (music.step + 1) % 64;
  }
}

function applyMusicSettings() {
  if (!music.ctx) return;
  const st = MUSIC_STYLES[state.musicStyle] || MUSIC_STYLES.lofi;
  music.filter.frequency.setTargetAtTime(st.cutoff, music.ctx.currentTime, 0.1);
  music.bus.gain.setTargetAtTime(state.musicVolume * 0.8, music.ctx.currentTime, 0.05);
}

function startMusic() {
  try {
    const ctx = ensureAudio();
    ctx.resume();
    if (music.playing) return;
    music.playing = true;
    music.step = 0;
    music.nextTime = ctx.currentTime + 0.05;
    music.bus.gain.setValueAtTime(0, ctx.currentTime);
    applyMusicSettings();
    music.handle = setInterval(scheduleMusic, 25);
    scheduleMusic();
  } catch {
    toast("Musik kann in diesem Browser nicht abgespielt werden.");
  }
  renderMusic();
}

function stopMusic() {
  if (!music.playing) return;
  music.playing = false;
  clearInterval(music.handle);
  music.bus.gain.setTargetAtTime(0, music.ctx.currentTime, 0.15);
  renderMusic();
}

function renderMusic() {
  $("#musicStyles").innerHTML = Object.entries(MUSIC_STYLES).map(([k, st]) =>
    `<button type="button" class="${k === state.musicStyle ? "active" : ""}" data-style="${k}" title="${esc(st.desc)}">${esc(st.name)}</button>`).join("");
  $("#musicToggle").textContent = music.playing ? "⏹️ Musik aus" : "🎵 Musik an";
  $("#musicVolume").value = Math.round(state.musicVolume * 100);
  $("#musicDesc").textContent = (MUSIC_STYLES[state.musicStyle] || MUSIC_STYLES.lofi).desc;
}

$("#musicToggle").addEventListener("click", () => (music.playing ? stopMusic() : startMusic()));
$("#musicStyles").addEventListener("click", (e) => {
  const b = e.target.closest("[data-style]");
  if (!b) return;
  state.musicStyle = b.dataset.style;
  save();
  if (music.playing) { music.step = 0; applyMusicSettings(); }
  renderMusic();
});
$("#musicVolume").addEventListener("input", (e) => {
  state.musicVolume = Number(e.target.value) / 100;
  applyMusicSettings();
});
$("#musicVolume").addEventListener("change", () => save());

// ---------- Designs & Einstellungen ----------

const DESIGNS = {
  tafel: { name: "Wandtafel", desc: "Grün und Kreide, hell oder dunkel", swatch: ["#f3f5f2", "#1f6f5c", "#f2c94c"], timerTitle: "Pomodoro-Timer" },
  pilot: { name: "Cockpit", desc: "Nachtflug mit Instrumenten-Anzeigen und Pilotensprüchen", swatch: ["#0a1626", "#ffb020", "#5fd3f3"], timerTitle: "Flugzeit ✈️", pilot: true },
  ozean: { name: "Ozean", desc: "frisches Blau, hell", swatch: ["#eef6fb", "#0f6fa8", "#2ec4b6"], timerTitle: "Pomodoro-Timer" },
  sunset: { name: "Abendrot", desc: "warme Farben, hell", swatch: ["#fff6ef", "#c2410c", "#f59e0b"], timerTitle: "Pomodoro-Timer" },
  space: { name: "Weltall", desc: "dunkles Violett mit Sternen", swatch: ["#0e0b1f", "#a78bfa", "#f472b6"], timerTitle: "Pomodoro-Timer" },
};

const PILOT_QUOTES = [
  { text: "Jede Stunde Lernen ist eine Flugstunde auf dem Weg ins Cockpit." },
  { text: "Wenn alles gegen dich zu laufen scheint, denk daran: Ein Flugzeug hebt gegen den Wind ab, nicht mit ihm.", by: "Henry Ford zugeschrieben" },
  { text: "Mathe, Physik und Englisch sind deine Checkliste fürs Cockpit. Hak heute einen Punkt ab." },
  { text: "Hast du einmal das Fliegen erlebt, wirst du immer mit dem Blick zum Himmel gehen.", by: "Leonardo da Vinci zugeschrieben" },
  { text: "Captains werden nicht geboren. Sie werden gemacht – eine Lerneinheit nach der anderen." },
  { text: "Der Himmel ist nicht die Grenze. Er ist dein zukünftiges Büro." },
  { text: "Piloten üben jeden Ablauf, bis er sitzt. Genau das machst du gerade auch." },
  { text: "V1, Rotate, Positive Climb: Heute ist dein Startlauf." },
  { text: "Tipp: Schau dir SPHAIR an – das Schweizer Programm, das junge Flugtalente entdeckt." },
];

function quoteOfDay(offset = 0) {
  const day = Math.floor(new Date(todayISO() + "T00:00:00").getTime() / 86400000);
  return PILOT_QUOTES[(day + offset) % PILOT_QUOTES.length];
}
let quoteOffset = 0;

function renderQuote() {
  const show = DESIGNS[state.design]?.pilot || state.pilotQuotes;
  const el = $("#quoteBanner");
  el.hidden = !show;
  if (!show) return;
  const q = quoteOfDay(quoteOffset);
  el.innerHTML = `<div class="quote-icon" aria-hidden="true">${PLANE_SVG}</div>
    <div class="quote-body"><div class="quote-label">Mission: Pilot werden</div>
    <blockquote>„${esc(q.text)}“</blockquote>${q.by ? `<cite>– ${esc(q.by)}</cite>` : ""}</div>
    <button class="btn ghost small" id="nextQuote" title="Anderen Spruch zeigen">Neuer Spruch</button>`;
  $("#nextQuote").addEventListener("click", () => { quoteOffset++; renderQuote(); });
}

const PLANE_SVG = `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;

function applyDesign() {
  const d = DESIGNS[state.design] ? state.design : "tafel";
  document.documentElement.dataset.design = d;
  $("#themeToggle").hidden = d !== "tafel";
  $("#timerTitle").textContent = DESIGNS[d].timerTitle;
  renderQuote();
}

function renderSettings() {
  $("#designGrid").innerHTML = Object.entries(DESIGNS).map(([k, d]) => `
    <button type="button" class="design-option ${k === state.design ? "active" : ""}" data-design="${k}" aria-pressed="${k === state.design}">
      <span class="swatches">${d.swatch.map((c) => `<span style="background:${c}"></span>`).join("")}</span>
      <strong>${esc(d.name)}</strong><span class="muted">${esc(d.desc)}</span></button>`).join("");
  $("#setMusicAuto").checked = state.musicAuto;
  $("#setPilotQuotes").checked = state.pilotQuotes;
}

$("#designGrid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-design]");
  if (!b) return;
  state.design = b.dataset.design;
  if (state.design === "pilot" && !music.playing) state.musicStyle = "pilot";
  save();
  applyDesign(); renderSettings(); renderMusic();
  toast(state.design === "pilot" ? "✈️ Willkommen im Cockpit, Captain!" : `Design „${DESIGNS[state.design].name}“ aktiv.`);
});
$("#setMusicAuto").addEventListener("change", (e) => { state.musicAuto = e.target.checked; save(); });
$("#setPilotQuotes").addEventListener("change", (e) => { state.pilotQuotes = e.target.checked; save(); renderQuote(); });

// ---------- Notenrechner (Schweizer Skala 1–6) ----------

function renderGrades() {
  $("#gradeSubject").innerHTML = SUBJECTS.filter((s) => s !== "Andere…")
    .concat(state.topics.map((t) => t.subject).filter((s) => !SUBJECTS.includes(s)))
    .filter((s, i, a) => a.indexOf(s) === i)
    .map((s) => `<option>${esc(s)}</option>`).join("");
  const t = activeTopic();
  if (t) $("#gradeSubject").value = t.subject;

  const bySubject = {};
  state.grades.forEach((g, i) => (bySubject[g.subject] = bySubject[g.subject] || []).push({ ...g, i }));
  const subjects = Object.keys(bySubject);
  if (!subjects.length) { $("#gradesView").innerHTML = `<div class="card empty">📊 Noch keine Noten eingetragen.</div>`; return; }

  const avg = (list) => list.reduce((a, g) => a + g.grade * g.weight, 0) / list.reduce((a, g) => a + g.weight, 0);
  const round = (x) => Math.round(x * 2) / 2; // Zeugnis: auf halbe Noten gerundet
  const cls = (x) => (x >= 4 ? "good" : "bad");
  const subjectAvgs = subjects.map((s) => round(avg(bySubject[s])));
  const pluspunkte = subjectAvgs.reduce((a, x) => a + (x >= 4 ? x - 4 : 2 * (x - 4)), 0);

  $("#gradesView").innerHTML = `
    <div class="stats-grid">
      <div class="stat"><div class="v ${cls(subjectAvgs.reduce((a, b) => a + b, 0) / subjectAvgs.length)}">${(subjectAvgs.reduce((a, b) => a + b, 0) / subjectAvgs.length).toFixed(2)}</div><div class="l">Gesamtschnitt</div></div>
      <div class="stat"><div class="v ${pluspunkte >= 0 ? "good" : "bad"}">${pluspunkte >= 0 ? "+" : ""}${pluspunkte}</div><div class="l">Pluspunkte (Unterschreitungen doppelt)</div></div>
    </div>
    ${subjects.map((s) => {
      const a = avg(bySubject[s]);
      const sumW = bySubject[s].reduce((x, g) => x + g.weight, 0);
      const need = (4 * (sumW + 1) - a * sumW); // nötige Note (einfach gewichtet) für Schnitt 4
      return `<div class="card"><header class="row" style="justify-content:space-between"><h3>${esc(s)}</h3>
        <span>Schnitt: <strong class="${cls(a)}">${a.toFixed(2)}</strong> → Zeugnis <strong>${round(a).toFixed(1)}</strong></span></header>
        <table><tbody>${bySubject[s].map((g) => `<tr><td>${esc(g.label || "Note")}</td><td><strong class="${cls(g.grade)}">${g.grade}</strong></td>
          <td class="muted">×${g.weight}</td><td style="text-align:right"><button class="btn ghost small" data-delgrade="${g.i}">✕</button></td></tr>`).join("")}</tbody></table>
        ${a < 4 ? `<p class="muted">Für einen 4er-Schnitt brauchst du in der nächsten (einfachen) Prüfung mindestens eine <strong>${need <= 6 ? need.toFixed(2) : "6 – mehrere Prüfungen nötig"}</strong>.</p>` : ""}
      </div>`;
    }).join("")}`;
}
$("#gradeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const grade = Number($("#gradeValue").value);
  if (!(grade >= 1 && grade <= 6)) return toast("Noten gehen von 1 bis 6.");
  state.grades.push({ subject: $("#gradeSubject").value, grade, weight: Number($("#gradeWeight").value), label: $("#gradeLabel").value.trim() });
  save();
  $("#gradeValue").value = ""; $("#gradeLabel").value = "";
  renderGrades();
});
$("#gradesView").addEventListener("click", (e) => {
  const b = e.target.closest("[data-delgrade]");
  if (!b) return;
  state.grades.splice(Number(b.dataset.delgrade), 1);
  save(); renderGrades();
});

// ---------- Start ----------

function renderStreak() { $("#streak").textContent = `🔥 ${streakCount()}`; }

function renderAll() {
  applyDesign();
  renderSettings();
  renderMusic();
  renderTopicList();
  renderActiveTopic();
  renderOverview();
  renderChat();
  quiz = null; cardIndex = 0;
  renderPlan();
  renderQuiz();
  renderCards();
  renderGrades();
  renderStreak();
  renderTimer();
}

applyTheme();
renderSubjects();
renderAll();
connectCloud();
