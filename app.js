const STORAGE_KEY = "treino-ab:v1";
const SYNC_META_KEY = "treino-ab:sync-meta:v1";
const HISTORY_LIMIT = 160;
const TYPE_LABELS = {
  normal: "Exercício",
  "bi-set": "Bi-set",
  "tri-set": "Tri-set",
  "drop-set": "Drop-set",
  unilateral: "Unilateral"
};
const TYPE_OPTIONS = ["normal", "bi-set", "tri-set", "drop-set", "unilateral"];

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
  workoutSwitcher: document.querySelector("#workoutSwitcher"),
  workoutView: document.querySelector("#workoutView"),
  editView: document.querySelector("#editView"),
  historyView: document.querySelector("#historyView"),
  pageJumpButtons: document.querySelector("#pageJumpButtons"),
  progressPanel: document.querySelector("#progressPanel"),
  pendingPanel: document.querySelector("#pendingPanel"),
  exerciseList: document.querySelector("#exerciseList"),
  editTitle: document.querySelector("#editTitle"),
  editList: document.querySelector("#editList"),
  exerciseHistory: document.querySelector("#exerciseHistory"),
  historyList: document.querySelector("#historyList"),
  syncPanel: document.querySelector("#syncPanel"),
  timerBar: document.querySelector("#timerBar"),
  importInput: document.querySelector("#importInput")
};

upgradeShellMarkup();

let state = loadState();
let syncInfo = loadSyncInfo(state);
let firebaseSync = null;
let firebaseStatus = {
  state: "idle",
  label: "Firebase não configurado",
  detail: "Preencha firebase-config.js para ativar o backup na nuvem.",
  uid: "",
  email: "",
  isAnonymous: true,
  provider: "",
  path: ""
};
let authForm = {
  email: "",
  password: ""
};
let isApplyingRemoteState = false;
let ticker = null;
let wakeLock = null;
let vibrationInfo = {
  state: "unknown",
  detail: ""
};

function upgradeShellMarkup() {
  document.title = "Treino";

  const stylesheet = document.querySelector('link[rel="stylesheet"]');
  if (stylesheet && !stylesheet.getAttribute("href")?.includes("v=11")) {
    stylesheet.setAttribute("href", "./styles.css?v=11");
  }

  if (!elements.workoutSwitcher) {
    const legacySwitcher = document.querySelector(".switcher");
    if (legacySwitcher) {
      legacySwitcher.id = "workoutSwitcher";
      legacySwitcher.innerHTML = "";
      elements.workoutSwitcher = legacySwitcher;
    }
  }

  const oldAddButton = document.querySelector('#editView .section-head > button[data-action="add-exercise"]');
  if (oldAddButton && !document.querySelector(".edit-actions")) {
    const actions = document.createElement("div");
    actions.className = "edit-actions";
    actions.innerHTML = `
      <button class="ghost small" type="button" data-action="delete-workout">Excluir treino</button>
      <button class="ghost small" type="button" data-action="add-workout">+ Treino</button>
      <button class="primary small" type="button" data-action="add-exercise">+ Exercício</button>
    `;
    oldAddButton.replaceWith(actions);
  }

  if (!elements.exerciseHistory && elements.historyList) {
    const history = document.createElement("div");
    history.id = "exerciseHistory";
    history.className = "exercise-history";
    elements.historyList.before(history);
    elements.exerciseHistory = history;
  }

  const importRow = document.querySelector(".import-row");
  if (importRow && !document.querySelector('[data-action="test-timer"]')) {
    const testButton = document.createElement("button");
    testButton.className = "ghost small";
    testButton.type = "button";
    testButton.dataset.action = "test-timer";
    testButton.textContent = "Testar timer";
    const clearButton = importRow.querySelector('[data-action="clear-history"]');
    importRow.insertBefore(testButton, clearButton || null);
  }

  if (!elements.pageJumpButtons) {
    const jumpButtons = document.createElement("section");
    jumpButtons.id = "pageJumpButtons";
    jumpButtons.className = "page-jump";
    jumpButtons.setAttribute("aria-label", "Atalhos de rolagem");
    jumpButtons.innerHTML = `
      <button type="button" data-action="scroll-top" aria-label="Subir para o início">↑</button>
      <button type="button" data-action="scroll-bottom" aria-label="Descer para o final">↓</button>
    `;
    (elements.timerBar || document.querySelector("main")).after(jumpButtons);
    elements.pageJumpButtons = jumpButtons;
  }
}

function createDefaultState() {
  const workouts = normalizeWorkouts(DEFAULT_WORKOUTS);
  return {
    activeWorkout: "A",
    activeView: "workout",
    workouts,
    drafts: {},
    history: [],
    timer: null,
    settings: {
      vibration: true,
      sound: true
    },
    ui: {
      collapsedEdit: {},
      expandedWorkoutCards: {}
    }
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return createDefaultState();
    const workouts = normalizeWorkouts(saved.workouts);
    const workoutIds = Object.keys(workouts);
    const activeWorkout = workouts[saved.activeWorkout] ? saved.activeWorkout : workoutIds[0] || "A";

    return {
      ...createDefaultState(),
      ...saved,
      workouts,
      activeWorkout,
      drafts: saved.drafts && typeof saved.drafts === "object" ? saved.drafts : {},
      history: Array.isArray(saved.history) ? saved.history : [],
      settings: {
        vibration: saved.settings?.vibration !== false,
        sound: saved.settings?.sound !== false
      },
      ui: {
        collapsedEdit: saved.ui?.collapsedEdit && typeof saved.ui.collapsedEdit === "object"
          ? saved.ui.collapsedEdit
          : {},
        expandedWorkoutCards: saved.ui?.expandedWorkoutCards && typeof saved.ui.expandedWorkoutCards === "object"
          ? saved.ui.expandedWorkoutCards
          : {}
      }
    };
  } catch {
    return createDefaultState();
  }
}

function loadSyncInfo(currentState) {
  try {
    const saved = JSON.parse(localStorage.getItem(SYNC_META_KEY));
    if (saved && typeof saved === "object") {
      return {
        localUpdatedAtMs: Number(saved.localUpdatedAtMs) || 0,
        remoteUpdatedAtMs: Number(saved.remoteUpdatedAtMs) || 0,
        lastSyncAtMs: Number(saved.lastSyncAtMs) || 0
      };
    }
  } catch {
    // Keep a fresh meta object when old data is malformed.
  }

  return {
    localUpdatedAtMs: hasUsefulLocalData(currentState) ? Date.now() : 0,
    remoteUpdatedAtMs: 0,
    lastSyncAtMs: 0
  };
}

function saveSyncInfo() {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncInfo));
}

function hasUsefulLocalData(candidateState) {
  if (!candidateState || typeof candidateState !== "object") return false;
  if (Array.isArray(candidateState.history) && candidateState.history.length) return true;

  const draftHasProgress = Object.values(candidateState.drafts || {}).some((draft) =>
    Object.values(draft?.logs || {}).some((log) =>
      Boolean(log?.done) ||
      Boolean(log?.skipped) ||
      Boolean(log?.notes) ||
      parseNumber(log?.weight, 0) > 0 ||
      parseNumber(log?.comboWeight, 0) > 0 ||
      parseNumber(log?.combo2Weight, 0) > 0
    )
  );
  if (draftHasProgress) return true;

  const defaultWorkouts = normalizeWorkouts(DEFAULT_WORKOUTS);
  return JSON.stringify(candidateState.workouts || {}) !== JSON.stringify(defaultWorkouts);
}

function saveState(options = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (options.sync === false || isApplyingRemoteState) return;
  syncInfo.localUpdatedAtMs = Date.now();
  saveSyncInfo();
  queueFirebaseSave();
}

function getUiState() {
  if (!state.ui || typeof state.ui !== "object") state.ui = {};
  if (!state.ui.collapsedEdit || typeof state.ui.collapsedEdit !== "object") {
    state.ui.collapsedEdit = {};
  }
  if (!state.ui.expandedWorkoutCards || typeof state.ui.expandedWorkoutCards !== "object") {
    state.ui.expandedWorkoutCards = {};
  }
  return state.ui;
}

function getWorkoutCardKey(exerciseId, workoutId = state.activeWorkout) {
  return `${workoutId}:${exerciseId}`;
}

function isWorkoutCardExpanded(exerciseId, workoutId = state.activeWorkout) {
  return Boolean(getUiState().expandedWorkoutCards[getWorkoutCardKey(exerciseId, workoutId)]);
}

function toggleWorkoutCard(exerciseId) {
  if (!exerciseId) return;
  const ui = getUiState();
  const key = getWorkoutCardKey(exerciseId);
  if (ui.expandedWorkoutCards[key]) {
    delete ui.expandedWorkoutCards[key];
  } else {
    ui.expandedWorkoutCards[key] = true;
  }
  saveState();
  render();
}

function uid(prefix = "item") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function activeWorkout() {
  return state.workouts[state.activeWorkout] || [];
}

function getWorkoutIds() {
  return Object.keys(state.workouts || {}).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

function getNextWorkoutId() {
  const ids = getWorkoutIds();
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const nextLetter = letters.split("").find((letter) => !ids.includes(letter));
  if (nextLetter) return nextLetter;
  let index = ids.length + 1;
  while (ids.includes(String(index))) index += 1;
  return String(index);
}

function normalizeWorkouts(workouts = {}) {
  const source = workouts && typeof workouts === "object" ? workouts : {};
  const normalized = {};

  Object.entries(source).forEach(([id, workout]) => {
    if (!Array.isArray(workout)) return;
    const safeId = String(id || "").trim().toUpperCase();
    if (!safeId) return;
    normalized[safeId] = normalizeWorkout(workout);
  });

  if (!Object.keys(normalized).length) {
    normalized.A = normalizeWorkout(DEFAULT_WORKOUTS.A);
    normalized.B = normalizeWorkout(DEFAULT_WORKOUTS.B);
  }

  return normalized;
}

function normalizeWorkout(workout = []) {
  return workout.map((exercise) => normalizeExercise(exercise));
}

function normalizeExercise(exercise = {}) {
  const combo = exercise.combo || {};
  const combo2 = exercise.combo2 || {};
  const type = TYPE_OPTIONS.includes(exercise.type)
    ? exercise.type
    : combo.enabled
      ? "bi-set"
      : "normal";
  const comboEnabled = type === "bi-set" || type === "tri-set" || Boolean(combo.enabled);
  const combo2Enabled = type === "tri-set" || Boolean(combo2.enabled);

  return {
    id: exercise.id || uid("exercise"),
    name: exercise.name || "Novo exercício",
    type,
    sets: clamp(parseInteger(exercise.sets, 3), 1, 12),
    reps: exercise.reps || "",
    rest: clamp(parseInteger(exercise.rest, 75), 0, 600),
    startingWeight: Math.max(0, parseNumber(exercise.startingWeight, 0)),
    note: exercise.note || "",
    dropSets: clamp(parseInteger(exercise.dropSets, 2), 1, 6),
    unilateralMode: exercise.unilateralMode || "ambos",
    combo: {
      enabled: comboEnabled,
      name: combo.name || "",
      reps: combo.reps || "",
      startingWeight: Math.max(0, parseNumber(combo.startingWeight, 0)),
      note: combo.note || ""
    },
    combo2: {
      enabled: combo2Enabled,
      name: combo2.name || "",
      reps: combo2.reps || "",
      startingWeight: Math.max(0, parseNumber(combo2.startingWeight, 0)),
      note: combo2.note || ""
    }
  };
}

function ensureCombo(exercise) {
  if (!exercise.combo) {
    exercise.combo = {
      enabled: false,
      name: "",
      reps: "",
      startingWeight: 0,
      note: ""
    };
  }
  return exercise.combo;
}

function ensureCombo2(exercise) {
  if (!exercise.combo2) {
    exercise.combo2 = {
      enabled: false,
      name: "",
      reps: "",
      startingWeight: 0,
      note: ""
    };
  }
  return exercise.combo2;
}

function getCombo(exercise) {
  return getCombos(exercise)[0] || null;
}

function getExerciseType(exercise) {
  if (TYPE_OPTIONS.includes(exercise.type)) return exercise.type;
  return exercise.combo?.enabled ? "bi-set" : "normal";
}

function getTypeLabel(type) {
  return TYPE_LABELS[type] || TYPE_LABELS.normal;
}

function getCombos(exercise) {
  const type = getExerciseType(exercise);
  const combos = [];
  const combo = exercise.combo;
  const combo2 = exercise.combo2;

  if ((type === "bi-set" || type === "tri-set") && combo?.enabled) {
    combos.push({ ...combo, field: "comboWeight", index: 0 });
  }

  if (type === "tri-set" && combo2?.enabled) {
    combos.push({ ...combo2, field: "combo2Weight", index: 1 });
  }

  return combos;
}

function getExerciseLabel(exercise) {
  const names = [exercise.name, ...getCombos(exercise).map((combo) => combo.name).filter(Boolean)];
  return names.join(" + ");
}

function getComboEntry(entry, index = 0) {
  if (Array.isArray(entry?.combos)) return entry.combos[index] || null;
  if (index === 0) return entry?.combo || null;
  return null;
}

function getWeightField(kind = "main") {
  if (kind === "combo") return "comboWeight";
  if (kind === "combo2") return "combo2Weight";
  return "weight";
}

function getDraft(workoutId = state.activeWorkout) {
  if (!state.drafts[workoutId]) {
    state.drafts[workoutId] = {
      startedAt: new Date().toISOString(),
      logs: {}
    };
  }

  for (const exercise of state.workouts[workoutId] || []) {
    const combos = getCombos(exercise);
    if (!state.drafts[workoutId].logs[exercise.id]) {
      const last = getLastEntry(workoutId, exercise);
      state.drafts[workoutId].logs[exercise.id] = {
        done: 0,
        weight: last?.weight ?? exercise.startingWeight ?? 0,
        comboWeight: getComboEntry(last, 0)?.weight ?? combos[0]?.startingWeight ?? 0,
        combo2Weight: getComboEntry(last, 1)?.weight ?? combos[1]?.startingWeight ?? 0,
        notes: "",
        skipped: false
      };
    } else if (combos.length) {
      const last = getLastEntry(workoutId, exercise);
      const log = state.drafts[workoutId].logs[exercise.id];
      if (log.comboWeight === undefined || log.comboWeight === null || log.comboWeight === "") {
        log.comboWeight = getComboEntry(last, 0)?.weight ?? combos[0]?.startingWeight ?? 0;
      }
      if (combos[1] && (log.combo2Weight === undefined || log.combo2Weight === null || log.combo2Weight === "")) {
        log.combo2Weight = getComboEntry(last, 1)?.weight ?? combos[1]?.startingWeight ?? 0;
      }
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

function findHistoryEntry(session, exercise) {
  const byId = session.entries?.find((entry) => entry.exerciseId === exercise.id);
  if (byId) return byId;
  return session.entries?.find(
    (entry) => entry.name?.toLowerCase() === exercise.name.toLowerCase()
  ) || null;
}

function getExerciseEntries(workoutId, exercise) {
  return state.history
    .filter((session) => session.workoutId === workoutId)
    .map((session) => {
      const entry = findHistoryEntry(session, exercise);
      return entry ? { ...entry, sessionFinishedAt: session.finishedAt } : null;
    })
    .filter(Boolean);
}

function getBestWeight(workoutId, exercise) {
  return getExerciseEntries(workoutId, exercise).reduce((best, entry) => {
    if (entry.skipped) return best;
    return Math.max(best, parseNumber(entry.weight, 0));
  }, 0);
}

function isPersonalRecord(workoutId, exercise, weight) {
  const best = getBestWeight(workoutId, exercise);
  return best > 0 && parseNumber(weight, 0) > best;
}

function getLoadSuggestion(exercise, lastEntry = null) {
  if (!lastEntry) return formatWeight(exercise.startingWeight);
  if (lastEntry.skipped || parseInteger(lastEntry.doneSets, 0) < parseInteger(lastEntry.plannedSets, 0)) {
    return `Manter ${formatWeight(lastEntry.weight)}`;
  }
  return `${formatWeight(parseNumber(lastEntry.weight, 0) + 2.5)}`;
}

function render() {
  getDraft(state.activeWorkout);
  saveState({ sync: false });
  renderShell();
  renderWorkout();
  renderEdit();
  renderHistory();
  renderSyncPanel();
  renderTimer();
}

function renderShell() {
  elements.screenTitle.textContent = `Treino ${state.activeWorkout}`;
  if (elements.workoutSwitcher) {
    elements.workoutSwitcher.innerHTML = getWorkoutIds()
      .map((workoutId) => `
        <button class="switch-button ${workoutId === state.activeWorkout ? "is-active" : ""}" type="button" data-workout="${escapeAttr(workoutId)}">
          Treino ${escapeHTML(workoutId)}
        </button>
      `)
      .join("");
  }
  document.querySelectorAll("[data-workout]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.workout === state.activeWorkout);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.activeView);
  });

  elements.workoutView.classList.toggle("is-active", state.activeView === "workout");
  elements.editView.classList.toggle("is-active", state.activeView === "edit");
  elements.historyView.classList.toggle("is-active", state.activeView === "history");
  elements.pageJumpButtons?.classList.toggle("is-visible", state.activeView === "edit");
}

function renderWorkout() {
  const workoutId = state.activeWorkout;
  const workout = activeWorkout();
  const totals = getTotals(workoutId);
  const progressAngle = `${totals.completion * 3.6}deg`;
  const draft = getDraft(workoutId);
  const startedAt = new Date(draft.startedAt).getTime();
  const elapsed = Number.isFinite(startedAt) ? Math.round((Date.now() - startedAt) / 1000) : 0;
  const nextExercise = totals.pending[0];
  const nextLog = nextExercise ? getLog(nextExercise, workoutId) : null;
  const nextSets = nextExercise ? clamp(parseInteger(nextExercise.sets, 1), 1, 12) : 0;
  const nextDone = nextLog ? clamp(parseInteger(nextLog.done, 0), 0, nextSets) : 0;

  elements.progressPanel.innerHTML = `
    <div class="progress-grid">
      <div class="progress-main">
        <p class="eyebrow">Treino ${escapeHTML(workoutId)} em andamento</p>
        <div class="progress-title">
          <strong>${totals.doneSets}</strong>
          <span>/ ${totals.totalSets} séries</span>
        </div>
        <div class="progress-bar" aria-hidden="true" style="--value: ${totals.completion}%">
          <span></span>
        </div>
        <div class="progress-facts">
          <span>${totals.pending.length} pendente${totals.pending.length === 1 ? "" : "s"}</span>
          <span>${formatDuration(elapsed)}</span>
        </div>
        <div class="next-box ${nextExercise ? "" : "is-complete"}">
          <span>${nextExercise ? "Agora" : "Hoje"}</span>
          <strong>${nextExercise ? escapeHTML(getExerciseLabel(nextExercise)) : "Treino completo"}</strong>
          <small>${nextExercise ? `${nextDone}/${nextSets} séries · ${formatRest(nextExercise.rest)} pausa` : "Pronto para salvar."}</small>
        </div>
      </div>
      <div class="round-meter" style="--angle: ${progressAngle}">
        <span>${totals.completion}%</span>
      </div>
    </div>
  `;

  elements.pendingPanel.innerHTML = totals.pending.length
    ? totals.pending
        .map((exercise) => `<span class="chip">${escapeHTML(getExerciseLabel(exercise))}</span>`)
        .join("")
    : `<span class="chip done">Treino completo</span>`;

  if (!workout.length) {
    elements.exerciseList.innerHTML = `<div class="empty-state">Nenhum exercício no Treino ${workoutId}.</div>`;
    return;
  }

  const pendingIds = new Set(totals.pending.map((exercise) => exercise.id));
  const currentExercise = nextExercise ? [nextExercise] : [];
  const pendingExercises = workout.filter((exercise) => pendingIds.has(exercise.id) && exercise.id !== nextExercise?.id);
  const completedExercises = workout.filter((exercise) => !pendingIds.has(exercise.id));
  elements.exerciseList.innerHTML = [
    renderExerciseSection("Agora", currentExercise, { variant: "current", currentId: nextExercise?.id }),
    renderExerciseSection("Próximos", pendingExercises, { variant: "pending", collapsible: true }),
    renderExerciseSection("Concluídos", completedExercises, { variant: "completed", collapsible: true })
  ].join("");
}

function renderExerciseSection(title, exercises, options = {}) {
  if (!exercises.length) return "";
  const className = ["exercise-section", options.variant ? `is-${options.variant}` : ""].filter(Boolean).join(" ");
  return `
    <section class="${className}">
      <div class="list-label">${escapeHTML(title)}</div>
      ${exercises.map((exercise) => renderExerciseCard(exercise, {
        isCurrent: exercise.id === options.currentId,
        isCollapsible: Boolean(options.collapsible)
      })).join("")}
    </section>
  `;
}

function renderExerciseCard(exercise, options = {}) {
  const log = getLog(exercise);
  const sets = clamp(parseInteger(exercise.sets, 1), 1, 12);
  const done = clamp(parseInteger(log.done, 0), 0, sets);
  const isComplete = done >= sets;
  const isSkipped = Boolean(log.skipped);
  const isCollapsible = Boolean(options.isCollapsible);
  const isExpanded = options.isCurrent || !isCollapsible || isWorkoutCardExpanded(exercise.id);
  const isCompact = isCollapsible && !isExpanded;
  const lastEntry = getLastEntry(state.activeWorkout, exercise);
  const type = getExerciseType(exercise);
  const combos = getCombos(exercise);
  const suggestion = getLoadSuggestion(exercise, lastEntry);
  const currentWeight = parseNumber(log.weight, exercise.startingWeight ?? 0);
  const isRecord = isPersonalRecord(state.activeWorkout, exercise, currentWeight);
  const statusText = isSkipped ? "Pulado" : isComplete ? "Completo" : `${done}/${sets}`;
  const statusClass = isSkipped ? "skip" : isComplete ? "done" : "";
  const className = [
    "exercise-card",
    options.isCurrent ? "is-current" : "",
    isCompact ? "is-compact" : "",
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
  const comboPanels = combos
    .map((combo, index) => `
      <div class="combo-panel">
        <div>
          <p class="eyebrow">Parte ${index + 2}</p>
          <h4>${escapeHTML(combo.name || "Exercício combinado")}</h4>
        </div>
        <div class="combo-facts">
          <span>${escapeHTML(combo.reps || "-")} reps</span>
          <span>Última ${formatWeight(getComboEntry(lastEntry, index)?.weight ?? combo.startingWeight)}</span>
        </div>
      </div>
    `)
    .join("");
  const comboWeightBlocks = combos
    .map((combo) => renderWeightBlock({
      exercise,
      label: `Peso - ${combo.name || "combinado"}`,
      value: log[combo.field] ?? getComboEntry(lastEntry, combo.index)?.weight ?? combo.startingWeight ?? 0,
      kind: combo.field === "combo2Weight" ? "combo2" : "combo"
    }))
    .join("");
  const typeDetail = type === "drop-set"
    ? `<span>${parseInteger(exercise.dropSets, 2)} drops</span>`
    : type === "unilateral"
      ? `<span>${escapeHTML(exercise.unilateralMode || "ambos")}</span>`
      : "";

  if (isCompact) {
    return `
      <article class="${className}" data-exercise-card="${escapeAttr(exercise.id)}">
        <div class="compact-toggle" data-action="toggle-workout-card" data-exercise="${escapeAttr(exercise.id)}" aria-label="Mostrar detalhes de ${escapeAttr(exercise.name)}">
          <div class="exercise-header">
            <div>
              <p class="eyebrow">${escapeHTML(getTypeLabel(type))}</p>
              <h3>${escapeHTML(getExerciseLabel(exercise))}</h3>
            </div>
            <div class="status-stack">
              ${isRecord ? `<span class="record-pill">Recorde</span>` : ""}
              <span class="status-pill ${statusClass}">${statusText}</span>
            </div>
          </div>
          <div class="compact-summary">
            <span>${done}/${sets} séries</span>
            <span>${formatWeight(currentWeight)}</span>
            <span>${formatRest(exercise.rest)}</span>
            <span class="compact-more">Detalhes</span>
          </div>
        </div>
        <div class="compact-actions">
          <button class="ghost small" type="button" data-action="toggle-workout-card" data-exercise="${escapeAttr(exercise.id)}">Abrir</button>
          <button class="${isSkipped ? "ghost" : "danger"} small" type="button" data-action="toggle-skip" data-exercise="${escapeAttr(exercise.id)}">
            ${isSkipped ? "Retomar" : "Pular"}
          </button>
        </div>
      </article>
    `;
  }

  const headerAttributes = isCollapsible
    ? ` data-action="toggle-workout-card" data-exercise="${escapeAttr(exercise.id)}" aria-label="Ocultar detalhes de ${escapeAttr(exercise.name)}"`
    : "";

  return `
    <article class="${className}" data-exercise-card="${escapeAttr(exercise.id)}">
      <div class="exercise-header" ${headerAttributes}>
          <div>
            <p class="eyebrow">${escapeHTML(getTypeLabel(type))}</p>
            <h3>${escapeHTML(getExerciseLabel(exercise))}</h3>
          </div>
          <div class="status-stack">
            ${isRecord ? `<span class="record-pill">Recorde</span>` : ""}
            <span class="status-pill ${statusClass}">${statusText}</span>
            ${isCollapsible ? `<span class="collapse-hint">Ocultar</span>` : ""}
          </div>
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
        <div class="meta-item">
          <span>Sugestão</span>
          <strong>${escapeHTML(suggestion)}</strong>
        </div>
        ${typeDetail ? `<div class="meta-item">${typeDetail}<strong>${escapeHTML(getTypeLabel(type))}</strong></div>` : ""}
      </div>
      ${comboPanels}

      <div class="set-track" style="--sets: ${sets}">
        ${setButtons}
      </div>

      ${renderWeightBlock({
        exercise,
        label: `Peso - ${exercise.name}`,
        value: log.weight ?? 0,
        kind: "main"
      })}
      ${comboWeightBlocks}

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

function renderWeightBlock({ exercise, label, value, kind }) {
  return `
    <div class="weight-block">
      <div class="weight-label">${escapeHTML(label)}</div>
      <div class="weight-row">
        <button type="button" data-action="weight-step" data-kind="${kind}" data-exercise="${escapeAttr(exercise.id)}" data-delta="-2.5" aria-label="Diminuir ${escapeAttr(label)}">−</button>
        <input type="number" inputmode="decimal" step="0.5" min="0"
          data-action="weight-input" data-kind="${kind}" data-exercise="${escapeAttr(exercise.id)}"
          aria-label="${escapeAttr(label)}"
          value="${escapeAttr(value ?? 0)}" />
        <button type="button" data-action="weight-step" data-kind="${kind}" data-exercise="${escapeAttr(exercise.id)}" data-delta="2.5" aria-label="Aumentar ${escapeAttr(label)}">+</button>
      </div>
    </div>
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
  const combo = ensureCombo(exercise);
  const combo2 = ensureCombo2(exercise);
  const type = getExerciseType(exercise);
  const comboFields = type === "bi-set" || type === "tri-set"
    ? renderComboEditFields(exercise, "combo", combo, type === "tri-set" ? "2º exercício" : "Exercício combinado")
    : "";
  const combo2Fields = type === "tri-set"
    ? renderComboEditFields(exercise, "combo2", combo2, "3º exercício")
    : "";
  const dropFields = type === "drop-set"
    ? `
      <label class="field wide">
        <span>Quantidade de drops</span>
        <input type="number" inputmode="numeric" min="1" max="6" data-edit-field="dropSets" data-exercise="${escapeAttr(exercise.id)}" value="${escapeAttr(exercise.dropSets ?? 2)}" />
      </label>
    `
    : "";
  const unilateralFields = type === "unilateral"
    ? `
      <label class="field wide">
        <span>Como registrar</span>
        <input type="text" data-edit-field="unilateralMode" data-exercise="${escapeAttr(exercise.id)}" value="${escapeAttr(exercise.unilateralMode || "ambos")}" />
      </label>
    `
    : "";
  const isCollapsed = Boolean(getUiState().collapsedEdit[exercise.id]);

  return `
    <article class="edit-card ${isCollapsed ? "is-collapsed" : ""}">
      <div class="edit-card-head">
        <div>
          <p class="eyebrow">${escapeHTML(getTypeLabel(type))}</p>
          <h3>${escapeHTML(getExerciseLabel(exercise) || "Novo exercício")}</h3>
        </div>
        <div class="move-row">
          <button class="mini-icon" type="button" data-action="toggle-edit-collapse" data-exercise="${escapeAttr(exercise.id)}" aria-label="${isCollapsed ? "Expandir exercício" : "Encolher exercício"}">${isCollapsed ? "+" : "−"}</button>
          <button class="mini-icon" type="button" data-action="move-exercise" data-exercise="${escapeAttr(exercise.id)}" data-direction="-1" aria-label="Subir exercício" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="mini-icon" type="button" data-action="move-exercise" data-exercise="${escapeAttr(exercise.id)}" data-direction="1" aria-label="Descer exercício" ${index === total - 1 ? "disabled" : ""}>↓</button>
          <button class="mini-icon" type="button" data-action="delete-exercise" data-exercise="${escapeAttr(exercise.id)}" aria-label="Excluir exercício">×</button>
        </div>
      </div>
      ${renderEditSummary(exercise)}
      ${isCollapsed ? "" : `
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
        ${renderTypeButtons(exercise, type)}
        ${comboFields}
        ${combo2Fields}
        ${dropFields}
        ${unilateralFields}
      </div>
      `}
    </article>
  `;
}

function renderEditSummary(exercise) {
  return `
    <div class="edit-summary">
      <span>${parseInteger(exercise.sets, 0)} séries</span>
      <span>${escapeHTML(exercise.reps || "-")} reps</span>
      <span>${formatRest(exercise.rest)}</span>
      <span>${formatWeight(exercise.startingWeight)}</span>
    </div>
  `;
}

function renderTypeButtons(exercise, activeType) {
  return `
    <div class="type-control">
      <span>Tipo</span>
      <div>
        ${TYPE_OPTIONS.map((type) => `
          <button class="${type === activeType ? "is-active" : ""}" type="button"
            data-action="set-exercise-type" data-exercise="${escapeAttr(exercise.id)}" data-type="${escapeAttr(type)}">
            ${escapeHTML(getTypeLabel(type))}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderComboEditFields(exercise, prefix, combo, title) {
  return `
    <div class="combo-edit-panel">
      <label class="field wide">
        <span>${escapeHTML(title)}</span>
        <input type="text" data-edit-field="${escapeAttr(prefix)}.name" data-exercise="${escapeAttr(exercise.id)}" value="${escapeAttr(combo.name)}" />
      </label>
      <label class="field">
        <span>Reps</span>
        <input type="text" data-edit-field="${escapeAttr(prefix)}.reps" data-exercise="${escapeAttr(exercise.id)}" value="${escapeAttr(combo.reps)}" />
      </label>
      <label class="field">
        <span>Peso</span>
        <input type="number" inputmode="decimal" step="0.5" min="0" data-edit-field="${escapeAttr(prefix)}.startingWeight" data-exercise="${escapeAttr(exercise.id)}" value="${escapeAttr(combo.startingWeight ?? 0)}" />
      </label>
      <label class="field wide">
        <span>Nota</span>
        <textarea data-edit-field="${escapeAttr(prefix)}.note" data-exercise="${escapeAttr(exercise.id)}">${escapeHTML(combo.note || "")}</textarea>
      </label>
    </div>
  `;
}

function renderHistory() {
  renderExerciseHistory();

  if (!state.history.length) {
    elements.historyList.innerHTML = `<div class="empty-state">Finalize um treino para criar o primeiro registro.</div>`;
    return;
  }

  elements.historyList.innerHTML = state.history.map(renderHistoryCard).join("");
}

function renderExerciseHistory() {
  if (!elements.exerciseHistory) return;
  const workout = activeWorkout();
  if (!workout.length) {
    elements.exerciseHistory.innerHTML = "";
    return;
  }

  const cards = workout
    .map((exercise) => {
      const entries = getExerciseEntries(state.activeWorkout, exercise);
      const last = entries[0] || null;
      const bestWeight = getBestWeight(state.activeWorkout, exercise);
      if (!last) {
        return `
          <article class="exercise-history-card">
            <div class="exercise-history-main">
              <p class="eyebrow">${escapeHTML(getTypeLabel(getExerciseType(exercise)))}</p>
              <h3>${escapeHTML(getExerciseLabel(exercise))}</h3>
              <div class="load-trend empty">Sem cargas registradas</div>
            </div>
            <div class="history-side">
              <span class="suggestion-pill">Sem registro</span>
            </div>
          </article>
        `;
      }

      const suggestion = getLoadSuggestion(exercise, last);
      const trend = getLoadTrend(entries);
      const comboLine = (Array.isArray(last.combos) ? last.combos : last.combo ? [last.combo] : [])
        .map((combo) => `${combo.name}: ${formatWeight(combo.weight)}`)
        .join(" · ");

      return `
        <article class="exercise-history-card">
          <div class="exercise-history-main">
            <p class="eyebrow">${escapeHTML(getTypeLabel(last.type || getExerciseType(exercise)))}</p>
            <h3>${escapeHTML(getExerciseLabel(exercise))}</h3>
            <small>${formatWeight(last.weight)} · ${last.doneSets}/${last.plannedSets} séries${comboLine ? ` · ${escapeHTML(comboLine)}` : ""}</small>
            ${renderLoadTrend(entries, bestWeight)}
          </div>
          <div class="history-side">
            ${bestWeight ? `<strong>Melhor ${formatWeight(bestWeight)}</strong>` : ""}
            <span class="trend-pill is-${trend.state}">${escapeHTML(trend.label)}</span>
            <span class="suggestion-pill">${escapeHTML(suggestion)}</span>
          </div>
        </article>
      `;
    })
    .join("");

  elements.exerciseHistory.innerHTML = `
    <div class="history-subhead">
      <p class="eyebrow">Evolução</p>
      <h3>Treino ${escapeHTML(state.activeWorkout)}</h3>
    </div>
    ${cards}
  `;
}

function getLoadTrend(entries) {
  const weights = entries
    .filter((entry) => !entry.skipped)
    .map((entry) => parseNumber(entry.weight, 0))
    .filter((weight) => weight > 0);
  if (weights.length < 2) return { state: "neutral", label: "Base" };
  const [latest, previous] = weights;
  if (latest > previous) return { state: "up", label: "Subiu" };
  if (latest < previous) return { state: "down", label: "Reduziu" };
  return { state: "stable", label: "Estável" };
}

function renderLoadTrend(entries, bestWeight) {
  const recent = entries.slice(0, 5).reverse();
  if (!recent.length) return `<div class="load-trend empty">Sem cargas registradas</div>`;

  return `
    <div class="load-trend" aria-label="Últimas 5 cargas">
      ${recent.map((entry) => {
        const weight = parseNumber(entry.weight, 0);
        const isBest = bestWeight > 0 && weight === bestWeight;
        return `<span class="load-pill ${isBest ? "is-best" : ""}">${formatWeight(weight)}</span>`;
      }).join("")}
    </div>
  `;
}

function renderHistoryCard(session) {
  const entries = session.entries || [];
  const visibleEntries = entries
    .map((entry) => {
      const status = entry.skipped
        ? "pulado"
        : `${entry.doneSets}/${entry.plannedSets} · ${formatWeight(entry.weight)}`;
      const combos = Array.isArray(entry.combos) ? entry.combos : entry.combo ? [entry.combo] : [];
      const combo = combos
        .map((item) => `<small>+ ${escapeHTML(item.name)} · ${formatWeight(item.weight)}</small>`)
        .join("");
      return `
        <li>
          <div>
            <strong>${escapeHTML(entry.name)}</strong>
            ${combo}
          </div>
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

function renderSyncPanel() {
  if (!elements.syncPanel) return;
  const canSync = Boolean(firebaseSync);
  const statusClass = firebaseStatus.state === "error" ? "error" : canSync ? "ok" : "idle";
  const lastSync = syncInfo.lastSyncAtMs ? formatDate(new Date(syncInfo.lastSyncAtMs).toISOString()) : "Nunca";
  const accountLabel = firebaseStatus.email
    ? firebaseStatus.email
    : firebaseStatus.uid
      ? firebaseStatus.isAnonymous ? "Conta anônima deste aparelho" : firebaseStatus.uid
      : "Sem conta conectada";

  elements.syncPanel.innerHTML = `
    <div class="sync-copy">
      <p class="eyebrow">Firebase</p>
      <h3>${escapeHTML(firebaseStatus.label)}</h3>
      <p>${escapeHTML(firebaseStatus.detail || "")}</p>
      <span class="sync-last">Conta: ${escapeHTML(accountLabel)}</span>
      <span class="sync-last">UID: ${escapeHTML(firebaseStatus.uid || "-")}</span>
      <span class="sync-last">Caminho: ${escapeHTML(firebaseStatus.path || "-")}</span>
      <span class="sync-last">Última sync: ${escapeHTML(lastSync)}</span>
    </div>
    <div class="auth-box">
      <button class="ghost small" type="button" data-action="login-google" ${canSync ? "" : "disabled"}>Google</button>
      <label class="field">
        <span>E-mail</span>
        <input type="email" inputmode="email" autocomplete="email" data-auth-field="email" value="${escapeAttr(authForm.email)}" />
      </label>
      <label class="field">
        <span>Senha</span>
        <input type="password" autocomplete="current-password" data-auth-field="password" value="${escapeAttr(authForm.password)}" />
      </label>
      <div class="auth-actions">
        <button class="ghost small" type="button" data-action="login-email" ${canSync ? "" : "disabled"}>Entrar</button>
        <button class="ghost small" type="button" data-action="signup-email" ${canSync ? "" : "disabled"}>Criar</button>
        <button class="danger small" type="button" data-action="logout-firebase" ${canSync ? "" : "disabled"}>Sair</button>
      </div>
    </div>
    <div class="sync-actions">
      <span class="sync-dot ${statusClass}"></span>
      <button class="ghost small" type="button" data-action="sync-now" ${canSync ? "" : "disabled"}>Sincronizar</button>
      <button class="ghost small" type="button" data-action="pull-cloud" ${canSync ? "" : "disabled"}>Baixar</button>
      <button class="ghost small" type="button" data-action="push-cloud" ${canSync ? "" : "disabled"}>Enviar</button>
    </div>
  `;
}

function renderTimer() {
  const timer = state.timer;
  if (!timer || timer.workoutId !== state.activeWorkout) {
    elements.timerBar.classList.remove("is-active");
    elements.timerBar.innerHTML = "";
    if (!timer) releaseWakeLock();
    return;
  }

  const remaining = getTimerRemaining(timer);
  const total = Math.max(1, timer.durationSeconds || remaining || 1);
  const completion = clamp(((total - remaining) / total) * 360, 0, 360);
  const completionPercent = clamp(((total - remaining) / total) * 100, 0, 100);
  const exercise = (state.workouts[timer.workoutId] || []).find((item) => item.id === timer.exerciseId);
  const timerLabel = timer.label || (exercise ? getExerciseLabel(exercise) : "Pausa");
  const isPaused = timer.status === "paused";
  const vibrationNotice = getVibrationNotice();

  elements.timerBar.classList.add("is-active");
  elements.timerBar.innerHTML = `
    <div class="timer-progress-line" style="--value: ${completionPercent}%"><span></span></div>
    <div class="timer-content">
      <div class="timer-face" style="--angle: ${completion}deg">
        <span>${formatDuration(remaining)}</span>
      </div>
      <div class="timer-text">
        <span>${isPaused ? "Pausado" : "Descanso ativo"}</span>
        <strong>${escapeHTML(timerLabel)}</strong>
        ${vibrationNotice ? `<small>${escapeHTML(vibrationNotice)}</small>` : ""}
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

function changeWeight(exerciseId, delta, kind = "main") {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;
  const log = getLog(exercise);
  const field = getWeightField(kind);
  const next = Math.max(0, parseNumber(log[field], 0) + parseNumber(delta, 0));
  log[field] = Math.round(next * 2) / 2;
  saveState();
  render();
}

function updateWeight(exerciseId, value, kind = "main") {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;
  const log = getLog(exercise);
  const field = getWeightField(kind);
  log[field] = Math.max(0, parseNumber(value, 0));
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
    type: "normal",
    sets: 3,
    reps: "10-12",
    rest: 75,
    startingWeight: 0,
    note: "",
    dropSets: 2,
    unilateralMode: "ambos",
    combo: {
      enabled: false,
      name: "",
      reps: "",
      startingWeight: 0,
      note: ""
    },
    combo2: {
      enabled: false,
      name: "",
      reps: "",
      startingWeight: 0,
      note: ""
    }
  });
  saveState();
  render();
}

function addWorkout() {
  const workoutId = getNextWorkoutId();
  state.workouts[workoutId] = [];
  state.activeWorkout = workoutId;
  state.activeView = "edit";
  getDraft(workoutId);
  saveState();
  render();
  scrollToTop();
}

function deleteWorkout() {
  const ids = getWorkoutIds();
  if (ids.length <= 1) {
    window.alert("Mantenha pelo menos um treino.");
    return;
  }

  const ok = window.confirm(`Excluir o Treino ${state.activeWorkout}?`);
  if (!ok) return;

  const previousWorkout = state.activeWorkout;
  delete state.workouts[previousWorkout];
  delete state.drafts[previousWorkout];
  if (state.timer?.workoutId === previousWorkout) state.timer = null;
  state.activeWorkout = getWorkoutIds()[0] || "A";
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
  delete getUiState().collapsedEdit[exerciseId];
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

function toggleEditCollapse(exerciseId) {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;
  const ui = getUiState();
  ui.collapsedEdit[exerciseId] = !ui.collapsedEdit[exerciseId];
  saveState({ sync: false });
  render();
}

function toggleCombo(exerciseId) {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;
  const combo = ensureCombo(exercise);
  combo.enabled = !combo.enabled;
  exercise.type = combo.enabled ? "bi-set" : "normal";
  if (combo.enabled && !combo.name) combo.name = "Exercício combinado";
  const log = getLog(exercise);
  if (combo.enabled && (log.comboWeight === undefined || log.comboWeight === null || log.comboWeight === "")) {
    log.comboWeight = combo.startingWeight ?? 0;
  }
  saveState();
  render();
}

function setExerciseType(exerciseId, type) {
  const exercise = findExercise(exerciseId);
  if (!exercise || !TYPE_OPTIONS.includes(type)) return;

  const combo = ensureCombo(exercise);
  const combo2 = ensureCombo2(exercise);
  exercise.type = type;
  combo.enabled = type === "bi-set" || type === "tri-set";
  combo2.enabled = type === "tri-set";

  if (combo.enabled && !combo.name) combo.name = "Exercício combinado";
  if (combo2.enabled && !combo2.name) combo2.name = "Terceiro exercício";

  const log = getLog(exercise);
  if (combo.enabled && (log.comboWeight === undefined || log.comboWeight === null || log.comboWeight === "")) {
    log.comboWeight = combo.startingWeight ?? 0;
  }
  if (combo2.enabled && (log.combo2Weight === undefined || log.combo2Weight === null || log.combo2Weight === "")) {
    log.combo2Weight = combo2.startingWeight ?? 0;
  }

  saveState();
  render();
}

function updateExerciseField(exerciseId, field, value, shouldRender = true) {
  const exercise = findExercise(exerciseId);
  if (!exercise) return;

  if (field.startsWith("combo.") || field.startsWith("combo2.")) {
    const isSecondCombo = field.startsWith("combo2.");
    const combo = isSecondCombo ? ensureCombo2(exercise) : ensureCombo(exercise);
    const comboField = field.replace(isSecondCombo ? "combo2." : "combo.", "");
    const weightField = isSecondCombo ? "combo2Weight" : "comboWeight";
    if (comboField === "startingWeight") {
      const previousWeight = Math.max(0, parseNumber(combo[comboField], 0));
      combo[comboField] = Math.max(0, parseNumber(value, 0));
      const log = getLog(exercise);
      if (parseInteger(log.done, 0) === 0 || parseNumber(log[weightField], 0) === previousWeight) {
        log[weightField] = combo[comboField];
      }
    } else {
      combo[comboField] = value;
    }
  } else if (field === "sets") exercise[field] = clamp(parseInteger(value, 1), 1, 12);
  else if (field === "rest") exercise[field] = clamp(parseInteger(value, 0), 0, 600);
  else if (field === "dropSets") exercise[field] = clamp(parseInteger(value, 1), 1, 6);
  else if (field === "type") setExerciseType(exerciseId, value);
  else if (field === "startingWeight") {
    const previousWeight = Math.max(0, parseNumber(exercise[field], 0));
    exercise[field] = Math.max(0, parseNumber(value, 0));
    const log = getLog(exercise);
    if (parseInteger(log.done, 0) === 0 || parseNumber(log.weight, 0) === previousWeight) {
      log.weight = exercise[field];
    }
  }
  else exercise[field] = value;

  const log = getLog(exercise);
  log.done = clamp(parseInteger(log.done, 0), 0, parseInteger(exercise.sets, 1));
  saveState();
  if (shouldRender) render();
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
    remainingSeconds: durationSeconds,
    lastCountdownVibration: null
  };
  vibrateDevice(70, "inicio");
  requestWakeLock();
  ensureTicker();
}

function startTestTimer() {
  state.timer = {
    workoutId: state.activeWorkout,
    exerciseId: "__timer-test__",
    label: "Teste de descanso",
    status: "running",
    durationSeconds: 10,
    endsAt: Date.now() + 10000,
    remainingSeconds: 10,
    lastCountdownVibration: null
  };
  vibrateDevice([80, 40, 80], "teste");
  requestWakeLock();
  ensureTicker();
  saveState();
  render();
}

function vibrateDevice(pattern, reason = "") {
  if (!state.settings.vibration) {
    vibrationInfo = {
      state: "off",
      detail: "Vibração desligada"
    };
    return false;
  }

  if (!navigator.vibrate) {
    vibrationInfo = {
      state: "unsupported",
      detail: "Vibração indisponível neste navegador"
    };
    return false;
  }

  try {
    const didVibrate = navigator.vibrate(pattern);
    vibrationInfo = didVibrate
      ? { state: "ok", detail: reason ? "Vibração ativa" : "" }
      : { state: "blocked", detail: "Vibração bloqueada pelo navegador" };
    return didVibrate;
  } catch {
    vibrationInfo = {
      state: "blocked",
      detail: "Vibração bloqueada pelo navegador"
    };
    return false;
  }
}

function getVibrationNotice() {
  if (!state.settings.vibration) return "Vibração desligada";
  if (!navigator.vibrate) return "Vibração indisponível neste navegador";
  if (vibrationInfo.state === "blocked") return vibrationInfo.detail;
  if (vibrationInfo.state === "unsupported") return vibrationInfo.detail;
  return "";
}

async function requestWakeLock() {
  if (wakeLock || !navigator.wakeLock || document.visibilityState !== "visible") return;

  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (!wakeLock) return;
  const lock = wakeLock;
  wakeLock = null;
  lock.release().catch(() => {});
}

function syncWakeLockWithTimer() {
  if (state.timer?.status === "running") {
    requestWakeLock();
  } else {
    releaseWakeLock();
  }
}

function getTimerRemaining(timer = state.timer) {
  if (!timer) return 0;
  if (timer.status === "paused") return Math.max(0, Math.round(timer.remainingSeconds || 0));
  return Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
}

function stopTimer(shouldRender = true) {
  state.timer = null;
  releaseWakeLock();
  saveState();
  if (shouldRender) render();
}

function pauseOrResumeTimer() {
  if (!state.timer) return;
  if (state.timer.status === "paused") {
    state.timer.status = "running";
    state.timer.endsAt = Date.now() + Math.max(0, state.timer.remainingSeconds) * 1000;
    requestWakeLock();
  } else {
    state.timer.status = "paused";
    state.timer.remainingSeconds = getTimerRemaining(state.timer);
    releaseWakeLock();
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
      releaseWakeLock();
      return;
    }

    syncWakeLockWithTimer();
    notifyRestCountdown(state.timer);

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

function notifyRestCountdown(timer) {
  if (!timer || timer.status !== "running") return;

  const remaining = getTimerRemaining(timer);
  if (remaining < 1 || remaining > 5) return;
  if (timer.lastCountdownVibration === remaining) return;

  timer.lastCountdownVibration = remaining;
  vibrateDevice(remaining === 1 ? [180, 60, 220] : [110, 45, 110], "contagem");
}

function notifyRestEnd(exerciseId) {
  vibrateDevice([220, 80, 220, 80, 320], "fim");

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
      const combos = getCombos(exercise);
      const savedCombos = combos.map((combo) => ({
        name: combo.name || "Exercício combinado",
        reps: combo.reps || "",
        weight: parseNumber(log[combo.field], combo.startingWeight ?? 0),
        note: combo.note || ""
      }));
      return {
        exerciseId: exercise.id,
        name: exercise.name,
        label: getExerciseLabel(exercise),
        type: getExerciseType(exercise),
        plannedSets: parseInteger(exercise.sets, 0),
        reps: exercise.reps || "",
        rest: parseInteger(exercise.rest, 0),
        weight: parseNumber(log.weight, 0),
        doneSets: clamp(parseInteger(log.done, 0), 0, parseInteger(exercise.sets, 0)),
        skipped: Boolean(log.skipped),
        notes: log.notes || "",
        combos: savedCombos,
        combo: savedCombos[0] || null
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
      const workouts = normalizeWorkouts(next.workouts);
      state = {
        ...createDefaultState(),
        ...next,
        workouts,
        activeWorkout: workouts[next.activeWorkout] ? next.activeWorkout : Object.keys(workouts)[0] || "A",
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

function getFirebaseSetup() {
  const setup = window.TREINO_FIREBASE_CONFIG;
  if (!setup) return null;
  const config = setup.config || setup.firebaseConfig || setup;
  const enabled = setup.enabled === true || Boolean(config?.apiKey && config?.projectId && config?.appId);
  if (!enabled) return null;
  if (!config?.apiKey || !config?.projectId || !config?.appId) return null;
  return {
    config,
    appName: setup.appName || "treino-ab",
    documentPath: setup.documentPath || null
  };
}

function setFirebaseStatus(next) {
  firebaseStatus = {
    ...firebaseStatus,
    ...next
  };
  renderSyncPanel();
}

function getStateForSync() {
  return JSON.parse(JSON.stringify(state));
}

function normalizeRemoteState(payload = {}) {
  const workouts = normalizeWorkouts(payload.workouts);
  return {
    ...createDefaultState(),
    ...payload,
    workouts,
    drafts: payload.drafts && typeof payload.drafts === "object" ? payload.drafts : {},
    history: Array.isArray(payload.history) ? payload.history : [],
    settings: {
      vibration: payload.settings?.vibration !== false,
      sound: payload.settings?.sound !== false
    },
    activeWorkout: workouts[payload.activeWorkout] ? payload.activeWorkout : Object.keys(workouts)[0] || "A",
    activeView: state.activeView || "workout"
  };
}

function applyRemoteState(remoteState, remoteUpdatedAtMs = Date.now()) {
  isApplyingRemoteState = true;
  state = normalizeRemoteState(remoteState);
  syncInfo.localUpdatedAtMs = remoteUpdatedAtMs;
  syncInfo.remoteUpdatedAtMs = remoteUpdatedAtMs;
  syncInfo.lastSyncAtMs = Date.now();
  saveSyncInfo();
  saveState({ sync: false });
  isApplyingRemoteState = false;
  render();
}

function queueFirebaseSave() {
  if (!firebaseSync) return;
  firebaseSync.queueSave(getStateForSync(), syncInfo.localUpdatedAtMs);
}

async function initFirebaseSync() {
  const setup = getFirebaseSetup();
  if (!setup) {
    renderSyncPanel();
    return;
  }

  setFirebaseStatus({
    state: "connecting",
    label: "Conectando ao Firebase",
    detail: "Preparando backup do treino no Firestore."
  });

  try {
    const module = await import("./firebase-sync.js?v=5");
    firebaseSync = await module.createFirebaseSync({
      ...setup,
      getLocalState: getStateForSync,
      getLocalUpdatedAtMs: () => syncInfo.localUpdatedAtMs,
      onRemoteState: applyRemoteState,
      onSaved: (remoteUpdatedAtMs) => {
        syncInfo.remoteUpdatedAtMs = remoteUpdatedAtMs;
        syncInfo.lastSyncAtMs = Date.now();
        saveSyncInfo();
      },
      onStatus: setFirebaseStatus
    });
    await firebaseSync.syncNow();
  } catch (error) {
    setFirebaseStatus({
      state: "error",
      label: "Firebase com erro",
      detail: error?.message || "Não foi possível iniciar a sincronização."
    });
  }
}

async function syncNow() {
  if (!firebaseSync) return;
  try {
    await firebaseSync.syncNow();
  } catch (error) {
    setFirebaseStatus({
      state: "error",
      label: "Erro ao sincronizar",
      detail: error?.message || "Não consegui sincronizar agora."
    });
  }
}

async function pullCloud() {
  if (!firebaseSync) return;
  const ok = window.confirm("Baixar os dados da nuvem e substituir este aparelho?");
  if (!ok) return;
  try {
    await firebaseSync.pullRemote({ force: true });
  } catch (error) {
    setFirebaseStatus({
      state: "error",
      label: "Erro ao baixar",
      detail: error?.message || "Não consegui baixar os dados da nuvem."
    });
  }
}

async function pushCloud() {
  if (!firebaseSync) return;
  const ok = window.confirm("Enviar os dados deste aparelho para a nuvem?");
  if (!ok) return;
  syncInfo.localUpdatedAtMs = Date.now();
  saveSyncInfo();
  try {
    await firebaseSync.pushLocal(getStateForSync(), syncInfo.localUpdatedAtMs);
  } catch (error) {
    setFirebaseStatus({
      state: "error",
      label: "Erro ao enviar",
      detail: error?.message || "Não consegui enviar os dados para a nuvem."
    });
  }
}

function getAuthCredentials() {
  return {
    email: authForm.email.trim(),
    password: authForm.password
  };
}

async function loginGoogle() {
  if (!firebaseSync?.signInWithGoogle) return;
  try {
    await firebaseSync.signInWithGoogle();
  } catch {
    renderSyncPanel();
  }
}

async function loginEmail() {
  if (!firebaseSync?.signInWithEmail) return;
  const { email, password } = getAuthCredentials();
  if (!email || !password) {
    window.alert("Informe e-mail e senha.");
    return;
  }
  try {
    await firebaseSync.signInWithEmail(email, password);
  } catch {
    renderSyncPanel();
  }
}

async function signupEmail() {
  if (!firebaseSync?.createAccountWithEmail) return;
  const { email, password } = getAuthCredentials();
  if (!email || password.length < 6) {
    window.alert("Informe um e-mail e uma senha com pelo menos 6 caracteres.");
    return;
  }
  try {
    await firebaseSync.createAccountWithEmail(email, password);
  } catch {
    renderSyncPanel();
  }
}

async function logoutFirebase() {
  if (!firebaseSync?.signOutUser) return;
  const ok = window.confirm("Sair da conta atual neste aparelho?");
  if (!ok) return;
  try {
    await firebaseSync.signOutUser();
  } catch {
    renderSyncPanel();
  }
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
  else if (action === "weight-step") changeWeight(exerciseId, actionElement.dataset.delta, actionElement.dataset.kind);
  else if (action === "add-exercise") addExercise();
  else if (action === "add-workout") addWorkout();
  else if (action === "delete-workout") deleteWorkout();
  else if (action === "delete-exercise") deleteExercise(exerciseId);
  else if (action === "move-exercise") moveExercise(exerciseId, actionElement.dataset.direction);
  else if (action === "toggle-edit-collapse") toggleEditCollapse(exerciseId);
  else if (action === "toggle-workout-card") toggleWorkoutCard(exerciseId);
  else if (action === "toggle-combo") toggleCombo(exerciseId);
  else if (action === "set-exercise-type") setExerciseType(exerciseId, actionElement.dataset.type);
  else if (action === "timer-toggle") pauseOrResumeTimer();
  else if (action === "timer-add") addTimerSeconds(15);
  else if (action === "timer-stop") stopTimer();
  else if (action === "test-timer") startTestTimer();
  else if (action === "reset-today") resetCurrentDraft();
  else if (action === "clear-history") clearHistory();
  else if (action === "export-data") exportData();
  else if (action === "finish-workout") finishWorkout();
  else if (action === "sync-now") syncNow();
  else if (action === "pull-cloud") pullCloud();
  else if (action === "push-cloud") pushCloud();
  else if (action === "login-google") loginGoogle();
  else if (action === "login-email") loginEmail();
  else if (action === "signup-email") signupEmail();
  else if (action === "logout-firebase") logoutFirebase();
  else if (action === "scroll-top") scrollToTop();
  else if (action === "scroll-bottom") scrollToBottom();
}

function handleInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

  if (target.dataset.authField) {
    authForm[target.dataset.authField] = target.value;
  } else if (target.dataset.action === "weight-input") {
    updateWeight(target.dataset.exercise, target.value, target.dataset.kind);
  } else if (target.dataset.action === "note-input") {
    updateNote(target.dataset.exercise, target.value);
  } else if (target.dataset.editField) {
    updateExerciseField(target.dataset.exercise, target.dataset.editField, target.value, false);
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

function scrollToBottom() {
  window.requestAnimationFrame(() => {
    const bottom = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      0
    );
    window.scrollTo({ top: bottom, behavior: "smooth" });
  });
}

function addFinishButton() {
  const button = document.createElement("button");
  button.className = "primary finish-button";
  button.type = "button";
  button.dataset.action = "finish-workout";
  button.textContent = "Finalizar treino";
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    syncWakeLockWithTimer();
  } else {
    releaseWakeLock();
  }
});

render();
addFinishButton();
ensureTicker();
syncWakeLockWithTimer();
registerServiceWorker();
initFirebaseSync();
