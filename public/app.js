// LernFreund – Frontend-Logik. Alle Daten werden lokal im Browser gespeichert (localStorage).
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

// ---------- Zustand ----------

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* leerer Zustand */ }
  return { topics: [], activeId: null, minutesByDay: {}, grades: [], theme: null };
}
const state = loadState();
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { toast("Speichern im Browser nicht möglich."); }
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

async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Fehler beim Server.");
  return data;
}

function topicPayload(t) {
  return { subject: t.subject, topic: t.topic, level: t.level, goal: t.goal };
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
    if (t && confirm(`"${t.topic}" wirklich löschen?`)) {
      state.topics = state.topics.filter((x) => x.id !== t.id);
      if (state.activeId === t.id) state.activeId = state.topics[0]?.id || null;
      save(); renderAll();
    }
    return;
  }
  const li = e.target.closest("li[data-id]");
  if (li) { state.activeId = li.dataset.id; save(); renderAll(); }
});

function renderActiveTopic() {
  const t = activeTopic();
  const el = $("#activeTopic");
  if (!t) {
    el.innerHTML = `<div><h1>Willkommen bei LernFreund 👋</h1>
      <p class="muted">Wähle links dein Fach, gib ein Thema ein und dein KI-Coach Lumi hilft dir, es perfekt zu können.</p></div>`;
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
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...topicPayload(t), mode: currentMode, messages: t.chat }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Der Coach ist gerade nicht erreichbar.");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      bubble.innerHTML = md(answer);
      chat.scrollTop = chat.scrollHeight;
    }
  } catch (err) {
    answer += `\n\n⚠️ ${err.message}`;
  }
  bubble.classList.remove("typing");
  if (answer.trim()) t.chat.push({ role: "assistant", content: answer.trim() });
  else t.chat.pop(); // nichts bekommen → Frage wieder entfernen, damit der Verlauf gültig bleibt
  save();
  chatBusy = false;
  $("#sendBtn").disabled = false;
  renderChat();
}

$("#chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#chatInput").value;
  $("#chatInput").value = "";
  sendChat(text);
});
$("#chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chatForm").requestSubmit(); }
});
$("#clearChat").addEventListener("click", () => {
  const t = activeTopic();
  if (t && t.chat.length && confirm("Chatverlauf für dieses Thema löschen?")) { t.chat = []; save(); renderChat(); }
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
  if (t.plan && !confirm("Bestehenden Lernplan ersetzen?")) return;
  const btn = $("#planBtn");
  setBusy(btn, true, "Coach erstellt deinen Plan…");
  try {
    const plan = await api("/api/plan", {
      ...topicPayload(t), examDate, today: todayISO(),
      minutesPerDay: $("#planMinutes").value, daysPerWeek: $("#planDays").value, busyDays: $("#planBusy").value,
    });
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

function exportIcs(t) {
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
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = `Lernplan-${t.topic.replace(/[^\wäöüÄÖÜ-]+/g, "_")}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
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
    const data = await api("/api/quiz", { ...topicPayload(t), count: $("#quizCount").value, difficulty: $("#quizDiff").value });
    if (!data.questions.length) throw new Error("Keine Fragen erhalten.");
    quiz = { questions: data.questions, index: 0, score: 0, answered: false, wrong: [] };
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
    const data = await api("/api/cards", { ...topicPayload(t), count: 12 });
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
  const t = requireTopic();
  if (!t) return;
  const front = prompt("Vorderseite (Begriff / Frage):");
  if (!front) return;
  const back = prompt("Rückseite (Antwort):");
  if (!back) return;
  t.cards.push({ front, back, box: 1, next: "" });
  save(); renderCards();
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
    if ("Notification" in window && Notification.permission === "granted") new Notification("LernFreund", { body: timer.isBreak ? "Pause vorbei!" : "Lerneinheit geschafft!" });
    timer.left = timer.total;
  }
  renderTimer();
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* kein Ton möglich */ }
}

$("#timerStart").addEventListener("click", () => {
  if (timer.running) {
    clearInterval(timer.handle);
    timer.running = false;
  } else {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    timer.endAt = Date.now() + timer.left * 1000;
    timer.handle = setInterval(timerTick, 250);
    timer.running = true;
  }
  renderTimer();
});
$("#timerReset").addEventListener("click", () => {
  clearInterval(timer.handle);
  timer.running = false;
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
