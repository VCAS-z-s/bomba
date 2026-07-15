(() => {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    minSeconds: 30,
    maxSeconds: 90,
    showCountdown: false,
    allowManualExplosion: false,
  });
  const SETTINGS_KEY = "bomba-settings-v1";
  const MAX_SECONDS = 3600;
  const TICK_TEST_DURATION_MS = 2200;
  const EXPLOSION_STATUS_HOLD_MS = 5000;

  const state = {
    gameState: "ready",
    isRunning: false,
    hasExploded: false,
    roundId: 0,
    selectedDurationMs: 0,
    endTimeMs: 0,
    rafId: 0,
    explosionTimeoutId: 0,
    tickPreviewTimeoutId: 0,
    explosionStatusTimeoutId: 0,
    wakeLock: null,
  };

  const elements = {};
  let tickAudio;
  let explosionAudio;

  document.addEventListener("DOMContentLoaded", initializeApp);

  function initializeApp() {
    cacheElements();
    bindEvents();
    loadSettings();
    setupAudio();
    setGameState("ready", "Připraveno");
    updateControls();
    updateCountdown();
    registerServiceWorker();
  }

  function cacheElements() {
    elements.form = document.getElementById("settingsForm");
    elements.minSeconds = document.getElementById("minSeconds");
    elements.maxSeconds = document.getElementById("maxSeconds");
    elements.showCountdown = document.getElementById("showCountdown");
    elements.allowManualExplosion = document.getElementById("allowManualExplosion");
    elements.statusText = document.getElementById("statusText");
    elements.errorText = document.getElementById("errorText");
    elements.countdownText = document.getElementById("countdownText");
    elements.startButton = document.getElementById("startButton");
    elements.manualExplosionButton = document.getElementById("manualExplosionButton");
    elements.stopButton = document.getElementById("stopButton");
    elements.testTickButton = document.getElementById("testTickButton");
    elements.testExplosionButton = document.getElementById("testExplosionButton");
  }

  function bindEvents() {
    elements.startButton.addEventListener("click", startGame);
    elements.stopButton.addEventListener("click", () => stopGame("Kolo zastaveno"));
    elements.manualExplosionButton.addEventListener("click", handleManualExplosionClick);
    elements.testTickButton.addEventListener("click", testTicking);
    elements.testExplosionButton.addEventListener("click", testExplosion);
    elements.form.addEventListener("input", handleSettingsInput);
    elements.form.addEventListener("click", resetExplosionStatusIfIdle);
    elements.startButton.addEventListener("click", resetExplosionStatusIfIdle);
    elements.stopButton.addEventListener("click", resetExplosionStatusIfIdle);
    elements.testTickButton.addEventListener("click", resetExplosionStatusIfIdle);
    elements.testExplosionButton.addEventListener("click", resetExplosionStatusIfIdle);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", cancelActiveTimers);
  }

  function handleSettingsInput() {
    if (!state.isRunning) {
      clearError();
      saveSettings();
      updateControls();
    }
  }

  function setupAudio() {
    tickAudio = new Audio("./assets/tick.wav");
    tickAudio.preload = "auto";
    tickAudio.loop = true;

    explosionAudio = new Audio("./assets/explosion.wav");
    explosionAudio.preload = "auto";
  }

  function loadSettings() {
    const fallback = { ...DEFAULT_SETTINGS };

    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        applySettings(fallback);
        return;
      }

      const parsed = JSON.parse(raw);
      applySettings({
        minSeconds: sanitizeNumber(parsed.minSeconds, DEFAULT_SETTINGS.minSeconds),
        maxSeconds: sanitizeNumber(parsed.maxSeconds, DEFAULT_SETTINGS.maxSeconds),
        showCountdown: Boolean(parsed.showCountdown),
        allowManualExplosion: Boolean(parsed.allowManualExplosion),
      });
    } catch (_error) {
      applySettings(fallback);
    }
  }

  function applySettings(settings) {
    elements.minSeconds.value = String(settings.minSeconds);
    elements.maxSeconds.value = String(settings.maxSeconds);
    elements.showCountdown.checked = settings.showCountdown;
    elements.allowManualExplosion.checked = settings.allowManualExplosion;
  }

  function saveSettings() {
    const settings = {
      minSeconds: elements.minSeconds.value,
      maxSeconds: elements.maxSeconds.value,
      showCountdown: elements.showCountdown.checked,
      allowManualExplosion: elements.allowManualExplosion.checked,
    };

    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_error) {
      // localStorage může být omezené; aplikace má dál fungovat.
    }
  }

  function validateSettings() {
    const minValue = Number.parseFloat(elements.minSeconds.value);
    const maxValue = Number.parseFloat(elements.maxSeconds.value);

    if (elements.minSeconds.value.trim() === "" || elements.maxSeconds.value.trim() === "") {
      return { valid: false, message: "Vyplň minimální i maximální čas." };
    }

    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      return { valid: false, message: "Časy musí být čísla." };
    }

    if (minValue <= 0 || maxValue <= 0) {
      return { valid: false, message: "Časy musí být kladná čísla větší než nula." };
    }

    if (minValue > maxValue) {
      return { valid: false, message: "Minimální čas nesmí být větší než maximální čas." };
    }

    if (minValue > MAX_SECONDS || maxValue > MAX_SECONDS) {
      return { valid: false, message: `Čas nesmí překročit ${MAX_SECONDS} sekund.` };
    }

    return { valid: true, minSeconds: minValue, maxSeconds: maxValue };
  }

  async function startGame() {
    if (state.isRunning) {
      return;
    }

    clearError();
    const validation = validateSettings();
    if (!validation.valid) {
      showError(validation.message);
      setGameState("error", validation.message);
      return;
    }

    saveSettings();
    prepareNewRound();
    const roundId = state.roundId;
    const durationSeconds = randomBetween(validation.minSeconds, validation.maxSeconds);
    state.selectedDurationMs = durationSeconds * 1000;
    state.endTimeMs = performance.now() + state.selectedDurationMs;

    try {
      await ensureAudioReady();
      await startTicking(roundId);
    } catch (_error) {
      stopGame("Chyba při přehrávání zvuku", { preserveStateLabel: true });
      setGameState("error", "Chyba při přehrávání zvuku");
      showError("Zvuk se nepodařilo spustit. Zkontroluj hlasitost, oprávnění a připojený reproduktor.");
      return;
    }

    state.isRunning = true;
    state.hasExploded = false;
    setGameState("running", "Bomba tiká");
    updateControls();
    updateCountdown();
    requestWakeLock();

    state.explosionTimeoutId = window.setTimeout(() => {
      triggerExplosion("auto", roundId);
    }, Math.max(0, state.selectedDurationMs + 24));

    state.rafId = window.requestAnimationFrame(() => countdownLoop(roundId));
  }

  function prepareNewRound() {
    cancelActiveTimers();
    stopTicking();
    stopExplosion();
    state.roundId += 1;
    state.selectedDurationMs = 0;
    state.endTimeMs = 0;
    state.hasExploded = false;
    state.isRunning = false;
    hideCountdown();
    clearError();
    setGameState("ready", "Připraveno");
  }

  async function ensureAudioReady() {
    tickAudio.load();
    explosionAudio.load();
    await Promise.resolve();
  }

  async function startTicking(roundId) {
    if (roundId !== state.roundId) {
      return;
    }

    stopTicking();
    tickAudio.currentTime = 0;
    await playAudio(tickAudio);
  }

  function stopTicking() {
    if (!tickAudio) {
      return;
    }
    tickAudio.pause();
    tickAudio.currentTime = 0;
  }

  function stopExplosion() {
    if (!explosionAudio) {
      return;
    }
    explosionAudio.pause();
    explosionAudio.currentTime = 0;
  }

  async function playExplosion(roundId) {
    if (roundId !== state.roundId) {
      return;
    }
    stopExplosion();
    await playAudio(explosionAudio);
  }

  async function playAudio(audioElement) {
    const playResult = audioElement.play();
    if (playResult && typeof playResult.then === "function") {
      await playResult;
    }
  }

  function countdownLoop(roundId) {
    if (!state.isRunning || roundId !== state.roundId) {
      return;
    }

    const now = performance.now();
    if (now >= state.endTimeMs) {
      triggerExplosion("auto", roundId);
      return;
    }

    updateCountdown();
    state.rafId = window.requestAnimationFrame(() => countdownLoop(roundId));
  }

  function updateCountdown() {
    if (!state.isRunning || !elements.showCountdown.checked) {
      hideCountdown();
      return;
    }

    const remainingMs = Math.max(0, state.endTimeMs - performance.now());
    const remainingSeconds = (remainingMs / 1000).toFixed(1).replace(".", ",");
    elements.countdownText.hidden = false;
    elements.countdownText.textContent = `Zbývá ${remainingSeconds} s`;
  }

  function hideCountdown() {
    elements.countdownText.hidden = true;
    elements.countdownText.textContent = "Zbývá 0,0 s";
  }

  async function triggerExplosion(origin, roundId = state.roundId) {
    if (!state.isRunning || state.hasExploded || roundId !== state.roundId) {
      return;
    }

    state.hasExploded = true;
    state.isRunning = false;
    cancelActiveTimers();
    stopTicking();
    updateControls();
    setGameState("exploded", "Výbuch!");
    hideCountdown();
    releaseWakeLock();

    try {
      await playExplosion(roundId);
    } catch (_error) {
      showError("Výbuch se nepodařilo přehrát. Kolo bylo bezpečně ukončeno.");
    }

    if (origin === "manual") {
      elements.manualExplosionButton.disabled = true;
    }

    latchExplosionStatus();
    window.setTimeout(() => finishGame(), 260);
  }

  async function handleManualExplosionClick() {
    if (state.isRunning) {
      await triggerExplosion("manual");
      return;
    }

    if (!elements.allowManualExplosion.checked) {
      return;
    }

    clearError();
    cancelActiveTimers();
    stopTicking();
    setGameState("exploded", "Výbuch!");
    elements.manualExplosionButton.disabled = true;

    try {
      await ensureAudioReady();
      await playExplosion(state.roundId);
    } catch (_error) {
      showError("Ukázku výbuchu se nepodařilo přehrát.");
    }

    latchExplosionStatus();
  }

  function stopGame(statusMessage, options = {}) {
    const { preserveStateLabel = false } = options;
    cancelActiveTimers();
    state.isRunning = false;
    state.hasExploded = false;
    stopTicking();
    stopExplosion();
    releaseWakeLock();

    if (!preserveStateLabel) {
      setGameState("stopped", statusMessage);
    }

    finishGame();
  }

  function finishGame() {
    state.isRunning = false;
    state.selectedDurationMs = 0;
    state.endTimeMs = 0;
    updateControls();
    hideCountdown();
  }

  function cancelActiveTimers() {
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    if (state.explosionTimeoutId) {
      window.clearTimeout(state.explosionTimeoutId);
      state.explosionTimeoutId = 0;
    }
    if (state.tickPreviewTimeoutId) {
      window.clearTimeout(state.tickPreviewTimeoutId);
      state.tickPreviewTimeoutId = 0;
    }
    if (state.explosionStatusTimeoutId) {
      window.clearTimeout(state.explosionStatusTimeoutId);
      state.explosionStatusTimeoutId = 0;
    }
  }

  function setGameState(nextState, statusMessage) {
    state.gameState = nextState;
    elements.statusText.textContent = statusMessage;
  }

  function latchExplosionStatus() {
    if (state.explosionStatusTimeoutId) {
      window.clearTimeout(state.explosionStatusTimeoutId);
    }
    state.explosionStatusTimeoutId = window.setTimeout(() => {
      if (!state.isRunning && state.gameState === "exploded") {
        resetExplosionStatus();
      }
    }, EXPLOSION_STATUS_HOLD_MS);
  }

  function resetExplosionStatusIfIdle() {
    if (!state.isRunning && state.gameState === "exploded") {
      resetExplosionStatus();
    }
  }

  function resetExplosionStatus() {
    if (state.explosionStatusTimeoutId) {
      window.clearTimeout(state.explosionStatusTimeoutId);
      state.explosionStatusTimeoutId = 0;
    }
    if (!state.isRunning) {
      setGameState("ready", "Připraveno");
      updateControls();
    }
  }

  function updateControls() {
    const running = state.isRunning;
    elements.startButton.disabled = running;
    elements.minSeconds.disabled = running;
    elements.maxSeconds.disabled = running;
    elements.showCountdown.disabled = running;
    elements.allowManualExplosion.disabled = running;
    elements.stopButton.disabled = !running;
    elements.testTickButton.disabled = running;
    elements.testExplosionButton.disabled = running;

    const showManualButton = elements.allowManualExplosion.checked;
    elements.manualExplosionButton.hidden = !showManualButton;
    elements.manualExplosionButton.disabled = !showManualButton;
  }

  async function testTicking() {
    if (state.isRunning) {
      return;
    }

    clearError();
    cancelActiveTimers();
    stopExplosion();

    try {
      await ensureAudioReady();
      stopTicking();
      tickAudio.currentTime = 0;
      await playAudio(tickAudio);
      state.tickPreviewTimeoutId = window.setTimeout(() => {
        stopTicking();
        state.tickPreviewTimeoutId = 0;
      }, TICK_TEST_DURATION_MS);
    } catch (_error) {
      showError("Ukázku tikání se nepodařilo přehrát.");
    }
  }

  async function testExplosion() {
    if (state.isRunning) {
      return;
    }

    clearError();
    cancelActiveTimers();
    stopTicking();

    try {
      await ensureAudioReady();
      await playExplosion(state.roundId);
    } catch (_error) {
      showError("Ukázku výbuchu se nepodařilo přehrát.");
    }
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || !state.isRunning) {
      return;
    }

    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
    } catch (_error) {
      state.wakeLock = null;
    }
  }

  async function releaseWakeLock() {
    if (!state.wakeLock) {
      return;
    }

    try {
      await state.wakeLock.release();
    } catch (_error) {
      // Wake lock už mohl být uvolněn systémem.
    } finally {
      state.wakeLock = null;
    }
  }

  function handleVisibilityChange() {
    if (!state.isRunning) {
      return;
    }

    if (document.visibilityState === "visible") {
      if (performance.now() >= state.endTimeMs) {
        triggerExplosion("auto", state.roundId);
        return;
      }
      updateCountdown();
      requestWakeLock();
    }
  }

  function showError(message) {
    elements.errorText.hidden = false;
    elements.errorText.textContent = message;
  }

  function clearError() {
    elements.errorText.hidden = true;
    elements.errorText.textContent = "";
  }

  function sanitizeNumber(value, fallback) {
    const parsed = Number.parseFloat(String(value));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_SECONDS) {
      return fallback;
    }
    return parsed;
  }

  function randomBetween(min, max) {
    if (min === max) {
      return min;
    }
    return min + Math.random() * (max - min);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const isSecureContext =
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    if (!isSecureContext) {
      return;
    }

    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Selhání SW nesmí zablokovat základní použití aplikace.
    });
  }
})();
