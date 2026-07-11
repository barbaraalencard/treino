const STORAGE_KEY = "treino-ab:v1";
const HISTORY_LIMIT = 160;

const DEFAULT_WORKOUTS = {
  A: [
    {
      id: "a-leg-press",
      name: "Leg press",
      sets: 4,
      reps: "10-12",
      rest: 90,
      startingWeight: 0,
      note: "Ajuste o banco antes de começar."
    },
    {
      id: "a-cadeira-extensora",
      name: "Cadeira extensora",
      sets: 3,
      reps: "12",
      rest: 75,
      startingWeight: 0,
      note: ""
    },
    {
      id: "a-supino-maquina",
      name: "Supino máquina",
      sets: 4,
      reps: "8-10",
      rest: 90,
      startingWeight: 0,
      note: ""
    },
    {
      id: "a-remada-baixa",
      name: "Remada baixa",
      sets: 3,
      reps: "10-12",
      rest: 75,
      startingWeight: 0,
      note: ""
    }
  ],
  B: [
    {
      id: "b-agachamento",
      name: "Agachamento",
      sets: 4,
      reps: "8-10",
      rest: 120,
      startingWeight: 0,
      note: ""
    },
    {
      id: "b-stiff",
      name: "Stiff",
      sets: 3,
      reps: "10",
      rest: 90,
      startingWeight: 0,
      note: ""
    },
    {
      id: "b-puxada-alta",
      name: "Puxada alta",
      sets: 4,
      reps: "10-12",
      rest: 75,
      startingWeight: 0,
      note: ""
    },
    {
      id: "b-elevacao-lateral",
      name: "Elevação lateral",
      sets: 3,
      reps: "12-15",
      rest: 60,
      startingWeight: 0,
      note: ""
    }
  ]
};

const elements = {
  screenTitle: document.querySelector("#screenTitle"),
  workoutView: document.querySelector("#workoutView"),
  editView: document.querySelector("#editView"),
  historyView: document.querySelector("#historyView"),
  progressPanel: document.querySelector("#progressPanel"),
  pendingPanel: document.querySelector("#pendingPanel"),
  exerciseList: document.querySelector("#exerciseList"),
  editTitle: document.querySelector("#editTitle"),
  editList: document.querySelector("#editList"),
  historyList: document.querySelector("#historyList"),
  timerBar: document.querySelector("#timerBar"),
  importInput: document.querySelector("#importInput")
};

let state = loadState();
let ticker = null;

function createDefaultState() {
  return {
    activeWorkout: "A",
    activeView: "workout",
    workouts: structuredClone(DEFAULT_WORKOUTS),
    drafts: {},
    history: [],
    timer: null,
    settings: {
      vibration: true,
      sound: true
    }
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return createDefaultState();

    return {
      ...createDefaultState(),
      ...saved,
      workouts: {
        A: Array.isArray(saved.workouts?.A) ? saved.workouts.A : structuredClone(DEFAULT_WORKOUTS.A),
        B: Array.isArray(saved.workouts?.B) ? saved.workouts.B : structuredClone(DEFAULT_WORKOUTS.B)
      },
      drafts: saved.drafts && typeof saved.drafts === "object" ? saved.drafts : {},
      history: Array.isArray(saved.history) ? saved.history : [],
      settings: {
        vibration: saved.settings?.vibration !== false,
        sound: saved.settings?.sound !== false
      }
    };
  } catch {
    return createDefaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid(prefix = "item") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function activeWorkout() {
  return state.workouts[state.activeWorkout] || [];
}

function getDraft(workoutId = state.activeWorkout) {
  if (!state.drafts[workoutId]) {
    state.drafts[workoutId] = {
      startedAt: new Date().toISOString(),
      logs: {}
    };
  }

  for (const exercise of state.workouts[workoutId] || []) {
    if (!state.drafts[workoutId].logs[exercise.id]) {
      const last = getLastEntry(workoutId, exercise);
      state.drafts[workoutId].logs[exercise.id] = {
        done: 0,
        weight: last?.weight ?? exercise.startingWeight ?? 0,
        notes: "",
        skipped: false
      };
    }
  }

  return state.drafts[workoutId];
}

function getLog(exercise, workoutId = state.activeWorkout) {
  return getDraft(workoutId).logs[exercise.id];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseNumber(value, fallback = 0) {
  const normalized = String(value ?? "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatWeight(value) {
  const number = parseNumber(value, 0);
  if (!number) return "0 kg";
  return `${number.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;
}

function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatRest(seconds) {
  const value = parseInteger(seconds, 0);
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return map[char];
  });
}

function escapeAttr(value = "") {
  return escapeHTML(value).replace(/`/g, "&#096;");
}

function getTotals(workoutId = state.activeWorkout) {
  const workout = state.workouts[workoutId] || [];
  const draft = getDraft(workoutId);
  const totalSets = workout.reduce((sum, exercise) => sum + parseInteger(exercise.sets, 0), 0);
  const doneSets = workout.reduce((sum, exercise) => {
    const done = draft.logs[exercise.id]?.done ?? 0;
    return sum + clamp(done, 0, parseInteger(exercise.sets, 0));
  }, 0);
  const pending = workout.filter((exercise) => {
    const log = draft.logs[exercise.id];
    return !log?.skipped && (log?.done ?? 0) < parseInteger(exercise.sets, 0);
  });

  return {
    totalSets,
    doneSets,
    pending,
    completion: totalSets ? Math.round((doneSets / totalSets) * 100) : 0
  };
}

function getLastEntry(workoutId, exercise) {
  for (const session of state.history) {
    if (session.workoutId !== workoutId) continue;
    const byId = session.entries?.find((entry) => entry.exerciseId === exercise.id);
    if (byId) return byId;
    const byName = session.entries?.find(
      (entry) => entry.name.toLowerCase() === exercise.name.toLowerCase()
    );
    if (byName) return byName;
  }
  return null;
}

function render() {
  getDraft(state.activeWorkout);
  saveState();
  renderShell();
  renderWorkout();
  renderEdit();
  renderHistory();
  renderTimer();
}

function renderShell() {
  elements.screenTitle.textContent = `Treino ${state.activeWorkout}`;
  document.querySelectorAll("[data-workout]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.workout === state.activeWorkout);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.activeView);
  });

  elements.workoutView.classList.toggle("is-active", state.activeView === "workout");
  elements.editView.classList.toggle("is-active", state.activeView === "edit");
  elements.historyView.classList.toggle("is-active", state.activeView === "history");
}

function renderWorkout() {
  const workoutId = state.activeWorkout;
  const workout = activeWorkout();
  const totals = getTotals(workoutId);
  const progressAngle = `${totals.completion * 3.6}deg`;
  const draft = getDraft(workoutId);
  const startedAt = new Date(draft.startedAt).getTime();
  const elapsed = Number.isFinite(startedAt) ? Math.round((Date.now() - startedAt) / 1000) : 0;

  elements.progressPanel.innerHTML = `
    <div class="progress-grid">
      <div class="progress-main">
        <div class="progress-title">
          <strong>${totals.doneSets}</strong>
          <span>/ ${totals.totalSets} séries</span>
        </div>
        <div class="progress-bar" aria-hidden="true" style="--value: ${totals.completion}%">
          <span></span>
        </div>
        <p>${totals.pending.length} exercício${totals.pending.length === 1 ? "" : "s"} pendente${totals.pending.length === 1 ? "" : "s"} · ${formatDuration(elapsed)}</p>
      </div>
      <div class="round-meter" style="--angle: ${progressAngle}">
        <span>${totals.completion}%</span>
      </div>
    </div>
  `;

  elements.pendingPanel.innerHTML = totals.pending.length
    ? totals.pending
        .map((exercise) => `<span class="chip">${escapeHTML(exercise.name)}</span>`)
        .join("")
    : `<span class="chip done">Treino completo</span>`;

  if (!workout.length) {
    elements.exerciseList.innerHTML = `<div class="empty-state">Nenhum exercício no Treino ${workoutId}.</div>`;
    return;
  }

  elements.exerciseList.innerHTML = workout.map((exercise) => renderExerciseCard(exercise)).join("");
}

function renderExerciseCard(exercise) {
  const log = getLog(exercise);
  const sets = clamp(parseInteger(exercise.sets, 1), 1, 12);
  const done = clamp(parseInteger(log.done, 0), 0, sets);
  const isComplete = done >= sets;
  const isSkipped = Boolean(log.skipped);
  const lastEntry = getLastEntry(state.activeWorkout, exercise);
  const statusText = isSkipped ? "Pulado" : isComplete ? "Completo" : `${done}/${sets}`;
  const statusClass = isSkipped ? "skip" : isComplete ? "done" : "";
  const className = [
    "exercise-card",
    isComplete ? "is-complete" : "",
    isSkipped ? "is-skipped" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const setButtons = Array.from({ length: sets }, (_, index) => {
    const setNumber = index + 1;
    const isDone = setNumber <= done;
    return `
      <button class="set-dot ${isDone ? "done" : ""}" type="button"
        data-action="set-done" data-exercise="${escapeAttr(exercise.id)}" data-value="${setNumber}"
        aria-label="Série ${setNumber} de ${escapeAttr(exercise.name)}">
        ${setNumber}
      </button>
    `;
  }).join("");

  return `
    <article class="${className}" data-exercise-card="${escapeAttr(exercise.id)}">
      <div class="exercise-header">
        <div>
          <p class="eyebrow">Exercício</p>
          <h3>${escapeHTML(exercise.name)}</h3>
        </div>
        <span class="status-pill ${statusClass}">${statusText}</span>
      </div>

      <div class="exercise-meta">
        <div class="meta-item">
          <span>Reps</span>
          <strong>${escapeHTML(exercise.reps || "-")}</strong>
        </div>
        <div class="meta-item">
          <span>Pausa</span>
          <strong>${formatRest(exercise.rest)}</strong>
        </div>
        <div class="meta-item">
          <span>Última</span>
          <strong>${lastEntry ? formatWeight(lastEntry.weight) : formatWeight(exercise.startingWeight)}</strong>
        </div>
      </div>

      <div class="set-track" style="--sets: ${sets}">
        ${setButtons}
      </div>

      <div class="weight-row">
        <button type="button" data-action="weight-step" data-exercise="${escapeAttr(exercise.id)}" data-delta="-2.5" aria-label="Diminuir peso">−</button>
        <input type="number" inputmode="decimal" step="0.5" min="0"
          data-action="weight-input" data-exercise="${escapeAttr(exercise.id)}"
          aria-label="Peso usado em ${escapeAttr(exercise.name)}"
          value="${escapeAttr(log.weight ?? 0)}" />
        <button type="button" data-action="weight-step" data-exercise="${escapeAttr(exercise.id)}" data-delta="2.5" aria-label="Aumentar peso">+</button>
      </div>

      <div class="action-row">
        <button class="primary" type="button" data-action="mark-set" data-exercise="${escapeAttr(exercise.id)}"
          ${isComplete || isSkipped ? "disabled" : ""}>
          Registrar série
        </button>
        <button class="ghost" type="button" data-action="undo-set" data-exercise="${escapeAttr(exercise.id)}" aria-label="Desfazer série">↶</button>
        <button class="${isSkipped ? "ghost" : "danger"}" type="button" data-action="toggle-skip" data-exercise="${escapeAttr(exercise.id)}" aria-label="${isSkipped ? "Retomar exercício" : "Pular exercício"}">
          ${isSkipped ? "↺" : "×"}
        </button>
      </div>

      <textarea class="note-field" data-action="note-input" data-exercise="${escapeAttr(exercise.id)}"
        placeholder="${escapeAttr(exercise.note || "Observação rápida")}"
        aria-label="Observação de ${escapeAttr(exercise.name)}">${escapeHTML(log.notes || "")}</textarea>
    </article>
  `;
}

function renderEdit() {
  const workoutId = state.activeWorkout;
  const workout = activeWorkout();
  elements.editTitle.textContent = `Treino ${workoutId}`;

  if (!workout.length) {
    elements.editList.innerHTML = `<div class="empty-state">Nenhum exercício no Treino ${workoutId}.</div>`;
    return;
  }

  elements.editList.innerHTML = workout
    .map((exercise, index) => renderEditCard(exercise, index, workout.length))
    .join("");
}

function renderEditCard(exercise, index, total) {
  return `
    <article class="edit-card">
      <div class="edit-card-head">
        <h3>${escapeHTML(exercise.name || "Novo exercício")}</h3>
        <div class="move-row">
          <button class="mini-icon" type="button" data-action="move-exercise" data-exercise="${escapeAttr(exercise.id)}" data-direction="-1" aria-label="Subir exercício" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="mini-icon" type="button" data-action="move-exercise" data-exercise="${escapeAttr(exercise.id)}" data-direction="1" aria-label="Descer exercício" ${index === total - 1 ? "disabled" : ""}>↓</button>
          <button class="mini-icon" type="button" data-action="delete-exercise" data-exercise="${escapeAttr(exercise.id)}" aria-label="Excluir exercício">×</button>
        </div>
      </div>
      <div class="edit-grid">
        <label class="field wide">
          <span>Nome</span>
          <input type="text" data-edit-field="name" data-exercise="${escapeAttr(exercise.id)}" value="${escapeAttr(exercise.name)}" />
        </label>
        <label class="field">
          <span>Séries</span>
          <input type="number" inputmode="numeric" min="1" max="12" data-edit-field="sets" data-exercise="${escapeAttr(exercise.id)}" value="${escapeAttr(exercise.sets)}" />
        </label>
        <label class="field">
          <span>Reps</span>
          <input type="text" data-edit-field="reps" data-exercise="${escapeAttr(exercise.id)}" value="${escapeAttr(exercise.reps)}" />
        </label>
        <label class="field">
          <span>Pausa (s)</span>
          <input type="number" inputmode="numeric" min="0" max="600" data-edit-field="rest" data-exercise="${escapeAttr(exercise.id)}" value="${escapeAttr(exercise.rest)}" />
        </label>
        <label class="field">
          <span>Peso base</span>
          <input type="number" inputmode="decimal" step="0.5" min="0" data-edit-field="startingWeight" data-exercise="${escapeAttr(exercise.id)}" value="${escapeAttr(exercise.startingWeight ?? 0)}" />
        </label>
        <label class="field wide">
          <span>Nota fixa</span>
          <textarea data-edit-field="note" data-exercise="${escapeAttr(exercise.id)}">${escapeHTML(exercise.note || "")}</textarea>
        </label>
      </div>
    </article>
  `;
}

function renderHistory() {
  if (!state.history.length) {
    elements.historyList.innerHTML = `<div class="empty-state">Finalize um treino para criar o primeiro registro.</div>`;
    return;
  }

  elements.historyList.innerHTML = state.history.map(renderHistoryCard).join("");
}

function renderHistoryCard(session) {
  const entries = session.entries || [];
  const visibleEntries = entries
    .map((entry) => {
      const status = entry.skipped
        ? "pulado"
        : `${entry.doneSets}/${entry.plannedSets} · ${formatWeight(entry.weight)}`;
      return `
        <li>
          <strong>${escapeHTML(entry.name)}</strong>
          <span>${status}</span>
        </li>
      `;
    })
    .join("");

  return `
    <article class="history-card">
      <div class="history-top">
        <div>
          <h3>Treino ${escapeHTML(session.workoutId)} · ${formatDate(session.finishedAt)}</h3>
          <p>${session.doneSets}/${session.totalSets} séries · ${formatDuration(session.durationSeconds)}</p>
        </div>
        <span class="history-badge">${session.completion}%</span>
      </div>
      <ul class="history-exercises">${visibleEntries}</ul>
    </article>
  `;
}

function renderTimer() {
  const timer = state.timer;
  if (!timer || timer.workoutId !== state.activeWorkout) {
    elements.timerBar.classList.remove("is-active");
    elements.timerBar.innerHTML = "";
    return;
  }

  const remaining = getTimerRemaining(timer);
  const total = Math.max(1, timer.durationSeconds || remaining || 1);
  const completion = clamp(((total - remaining) / total) * 360, 0, 360);
  const exercise = (state.workouts[timer.workoutId] || []).find((item) => item.id === timer.exerciseId);
  const isPaused = timer.status === "paused";

  elements.timerBar.classList.add("is-active");
  elements.timerBar.innerHTML = `
    <div class="timer-content">
      <div class="timer-face" style="--angle: ${completion}deg">
        <span>${formatDuration(remaining)}</span>
      </div>
      <div class="timer-text">
        <strong>${escapeHTML(exercise?.name || "Pausa")}</strong>
        <span>${isPaused ? "Pausado" : "Descanso"}</span>
      </div>
      <div class="timer-actions">
        <button type="button" data-action="timer-add" aria-label="Adicionar 15 segundos">+15</button>
        <button type="button" data-action="timer-toggle" aria-label="${isPaused ? "Retomar timer" : "Pausar timer"}">${isPaused ? "▶" : "Ⅱ"}</button>
        <button type="button" data-action="timer-stop" aria-label="Encerrar timer">×</button>
      </div>
    </div>
  `;
}

function findExercise(exerciseId, workoutId = state.activeWorkout) {
  return (state.workouts[workoutId] || []).find((exercise) => exercise.id === exerciseId);
}

function findExerciseIndex(exerciseId, workoutId = state.activeWorkout) {
  return (state.workouts[workoutId] || []).findIndex((exercise) => exercise.id === exerciseId);
}

function markSet(exerciseId, value = null) {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;
  const log = getLog(exercise);
  const sets = clamp(parseInteger(exercise.sets, 1), 1, 12);
  const oldDone = clamp(parseInteger(log.done, 0), 0, sets);
  const nextDone = value === null ? oldDone + 1 : parseInteger(value, oldDone);

  log.done = clamp(nextDone, 0, sets);
  log.skipped = false;

  const totals = getTotals(state.activeWorkout);
  if (log.done > oldDone && totals.doneSets < totals.totalSets) {
    startTimer(exercise);
  }
  if (totals.doneSets >= totals.totalSets) {
    stopTimer(false);
  }

  saveState();
  render();
}

function undoSet(exerciseId) {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;
  const log = getLog(exercise);
  log.done = Math.max(0, parseInteger(log.done, 0) - 1);
  log.skipped = false;
  saveState();
  render();
}

function toggleSkip(exerciseId) {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;
  const log = getLog(exercise);
  log.skipped = !log.skipped;
  if (state.timer?.exerciseId === exerciseId) stopTimer(false);
  saveState();
  render();
}

function changeWeight(exerciseId, delta) {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;
  const log = getLog(exercise);
  const next = Math.max(0, parseNumber(log.weight, 0) + parseNumber(delta, 0));
  log.weight = Math.round(next * 2) / 2;
  saveState();
  render();
}

function updateWeight(exerciseId, value) {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;
  const log = getLog(exercise);
  log.weight = Math.max(0, parseNumber(value, 0));
  saveState();
}

function updateNote(exerciseId, value) {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;
  const log = getLog(exercise);
  log.notes = value;
  saveState();
}

function addExercise() {
  const workout = activeWorkout();
  workout.push({
    id: uid(`treino-${state.activeWorkout.toLowerCase()}`),
    name: "Novo exercício",
    sets: 3,
    reps: "10-12",
    rest: 75,
    startingWeight: 0,
    note: ""
  });
  saveState();
  render();
}

function deleteExercise(exerciseId) {
  const index = findExerciseIndex(exerciseId);
  if (index < 0) return;
  const exercise = activeWorkout()[index];
  const ok = window.confirm(`Excluir "${exercise.name}" do Treino ${state.activeWorkout}?`);
  if (!ok) return;
  activeWorkout().splice(index, 1);
  delete state.drafts[state.activeWorkout]?.logs?.[exerciseId];
  if (state.timer?.exerciseId === exerciseId) stopTimer(false);
  saveState();
  render();
}

function moveExercise(exerciseId, direction) {
  const workout = activeWorkout();
  const from = findExerciseIndex(exerciseId);
  const to = from + parseInteger(direction, 0);
  if (from < 0 || to < 0 || to >= workout.length) return;
  const [item] = workout.splice(from, 1);
  workout.splice(to, 0, item);
  saveState();
  render();
}

function updateExerciseField(exerciseId, field, value) {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;

  if (field === "sets") exercise[field] = clamp(parseInteger(value, 1), 1, 12);
  else if (field === "rest") exercise[field] = clamp(parseInteger(value, 0), 0, 600);
  else if (field === "startingWeight") exercise[field] = Math.max(0, parseNumber(value, 0));
  else exercise[field] = value;

  const log = getLog(exercise);
  log.done = clamp(parseInteger(log.done, 0), 0, parseInteger(exercise.sets, 1));
  saveState();
  render();
}

function startTimer(exercise) {
  const durationSeconds = clamp(parseInteger(exercise.rest, 0), 0, 600);
  if (!durationSeconds) {
    stopTimer(false);
    return;
  }

  state.timer = {
    workoutId: state.activeWorkout,
    exerciseId: exercise.id,
    status: "running",
    durationSeconds,
    endsAt: Date.now() + durationSeconds * 1000,
    remainingSeconds: durationSeconds
  };
  ensureTicker();
}

function getTimerRemaining(timer = state.timer) {
  if (!timer) return 0;
  if (timer.status === "paused") return Math.max(0, Math.round(timer.remainingSeconds || 0));
  return Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
}

function stopTimer(shouldRender = true) {
  state.timer = null;
  saveState();
  if (shouldRender) render();
}

function pauseOrResumeTimer() {
  if (!state.timer) return;
  if (state.timer.status === "paused") {
    state.timer.status = "running";
    state.timer.endsAt = Date.now() + Math.max(0, state.timer.remainingSeconds) * 1000;
  } else {
    state.timer.status = "paused";
    state.timer.remainingSeconds = getTimerRemaining(state.timer);
  }
  saveState();
  render();
}

function addTimerSeconds(seconds) {
  if (!state.timer) return;
  const extra = parseInteger(seconds, 0);
  if (state.timer.status === "paused") {
    state.timer.remainingSeconds = Math.max(0, state.timer.remainingSeconds + extra);
  } else {
    state.timer.endsAt += extra * 1000;
  }
  state.timer.durationSeconds = Math.max(state.timer.durationSeconds, getTimerRemaining(state.timer));
  saveState();
  render();
}

function ensureTicker() {
  if (ticker) return;
  ticker = window.setInterval(() => {
    if (!state.timer) {
      window.clearInterval(ticker);
      ticker = null;
      return;
    }

    if (state.timer.status === "running" && getTimerRemaining(state.timer) <= 0) {
      const exerciseId = state.timer.exerciseId;
      stopTimer(false);
      notifyRestEnd(exerciseId);
      render();
      return;
    }

    renderTimer();
  }, 500);
}

function notifyRestEnd(exerciseId) {
  if (state.settings.vibration && navigator.vibrate) {
    navigator.vibrate([180, 80, 180]);
  }

  if (!state.settings.sound) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.38);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.42);
  } catch {
    const exercise = findExercise(exerciseId);
    document.title = exercise ? `Pausa: ${exercise.name}` : "Pausa finalizada";
  }
}

function finishWorkout() {
  const workoutId = state.activeWorkout;
  const workout = activeWorkout();
  const draft = getDraft(workoutId);
  const totals = getTotals(workoutId);
  const hasAnyProgress = workout.some((exercise) => {
    const log = draft.logs[exercise.id];
    return (log?.done ?? 0) > 0 || Boolean(log?.skipped) || Boolean(log?.notes);
  });

  if (!hasAnyProgress) {
    window.alert("Registre ao menos uma série antes de finalizar.");
    return;
  }

  if (totals.pending.length) {
    const ok = window.confirm(`Ainda faltam ${totals.pending.length} exercício(s). Finalizar mesmo assim?`);
    if (!ok) return;
  }

  const startedAt = new Date(draft.startedAt).getTime();
  const finishedAt = new Date().toISOString();
  const durationSeconds = Number.isFinite(startedAt)
    ? Math.max(0, Math.round((Date.now() - startedAt) / 1000))
    : 0;

  const session = {
    id: uid("sessao"),
    workoutId,
    startedAt: draft.startedAt,
    finishedAt,
    durationSeconds,
    totalSets: totals.totalSets,
    doneSets: totals.doneSets,
    completion: totals.completion,
    entries: workout.map((exercise) => {
      const log = draft.logs[exercise.id] || {};
      return {
        exerciseId: exercise.id,
        name: exercise.name,
        plannedSets: parseInteger(exercise.sets, 0),
        reps: exercise.reps || "",
        rest: parseInteger(exercise.rest, 0),
        weight: parseNumber(log.weight, 0),
        doneSets: clamp(parseInteger(log.done, 0), 0, parseInteger(exercise.sets, 0)),
        skipped: Boolean(log.skipped),
        notes: log.notes || ""
      };
    })
  };

  state.history.unshift(session);
  state.history = state.history.slice(0, HISTORY_LIMIT);
  delete state.drafts[workoutId];
  if (state.timer?.workoutId === workoutId) state.timer = null;
  saveState();
  render();
}

function resetCurrentDraft() {
  const ok = window.confirm(`Reiniciar o Treino ${state.activeWorkout} de hoje?`);
  if (!ok) return;
  delete state.drafts[state.activeWorkout];
  if (state.timer?.workoutId === state.activeWorkout) state.timer = null;
  saveState();
  render();
}

function clearHistory() {
  if (!state.history.length) return;
  const ok = window.confirm("Limpar todo o histórico?");
  if (!ok) return;
  state.history = [];
  saveState();
  render();
}

function exportData() {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `treino-ab-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const next = JSON.parse(String(reader.result || ""));
      if (!next.workouts || !next.history) throw new Error("Arquivo invalido");
      state = {
        ...createDefaultState(),
        ...next,
        activeWorkout: next.activeWorkout === "B" ? "B" : "A",
        activeView: "history"
      };
      saveState();
      render();
    } catch {
      window.alert("Não consegui importar esse arquivo.");
    } finally {
      elements.importInput.value = "";
    }
  };
  reader.readAsText(file);
}

function handleClick(event) {
  const workoutButton = event.target.closest("[data-workout]");
  if (workoutButton) {
    state.activeWorkout = workoutButton.dataset.workout;
    saveState();
    render();
    scrollToTop();
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.activeView = viewButton.dataset.view;
    saveState();
    render();
    scrollToTop();
    return;
  }

  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  const action = actionElement.dataset.action;
  const exerciseId = actionElement.dataset.exercise;

  if (action === "mark-set") markSet(exerciseId);
  else if (action === "set-done") markSet(exerciseId, actionElement.dataset.value);
  else if (action === "undo-set") undoSet(exerciseId);
  else if (action === "toggle-skip") toggleSkip(exerciseId);
  else if (action === "weight-step") changeWeight(exerciseId, actionElement.dataset.delta);
  else if (action === "add-exercise") addExercise();
  else if (action === "delete-exercise") deleteExercise(exerciseId);
  else if (action === "move-exercise") moveExercise(exerciseId, actionElement.dataset.direction);
  else if (action === "timer-toggle") pauseOrResumeTimer();
  else if (action === "timer-add") addTimerSeconds(15);
  else if (action === "timer-stop") stopTimer();
  else if (action === "reset-today") resetCurrentDraft();
  else if (action === "clear-history") clearHistory();
  else if (action === "export-data") exportData();
  else if (action === "finish-workout") finishWorkout();
}

function handleInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

  if (target.dataset.action === "weight-input") {
    updateWeight(target.dataset.exercise, target.value);
  } else if (target.dataset.action === "note-input") {
    updateNote(target.dataset.exercise, target.value);
  }
}

function handleChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

  if (target.dataset.editField) {
    updateExerciseField(target.dataset.exercise, target.dataset.editField, target.value);
  } else if (target.id === "importInput") {
    importData(target.files?.[0]);
  }
}

function scrollToTop() {
  window.requestAnimationFrame(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  });
}

function addFinishButton() {
  const button = document.createElement("button");
  button.className = "primary";
  button.type = "button";
  button.dataset.action = "finish-workout";
  button.textContent = "Finalizar treino";
  button.style.width = "100%";
  button.style.marginTop = "12px";
  button.style.minHeight = "52px";
  elements.exerciseList.after(button);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const canRegister = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!canRegister) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

document.addEventListener("click", handleClick);
document.addEventListener("input", handleInput);
document.addEventListener("change", handleChange);

render();
addFinishButton();
ensureTicker();
registerServiceWorker();
