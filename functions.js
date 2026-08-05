// App glue for the TBC Neural Optimizer demo.
// Depends on pair.js (engine) for: state, queueState, stop, handleStopRequest,
// requestGeneration, tbcPublicText, drawRuntimeTrace.
// Depends on demo.js / core.js for: goToScreen, shell, durationBase, easeOut.

const byId = (id) => document.getElementById(id);
const hasEngine = () =>
  typeof state !== "undefined" && typeof queueState !== "undefined";

// ENGINE STATUS PILL ---------------------------------------------------------
// Overrides pair.js status rendering. Dormant until the engine (pair.js) loads.

let systemHealth = "unavailable";

const STATUS_LABELS = {
  ready: "Ready",
  finalized: "Completed",
  generating: "Generating",
  finalizing: "Finalizing",
  paused: "Paused",
  degraded: "Degraded",
  unavailable: "Offline",
};

function setSystemStatus(status, message, detail = "") {
  systemHealth = status;
  const root = byId("systemStatus");
  if (root) {
    root.title =
      typeof tbcPublicText === "function"
        ? tbcPublicText(detail, "TBC runtime status unavailable.")
        : detail || "TBC runtime status unavailable.";
  }
  renderStatusPill();
}

function pillState() {
  if (!hasEngine()) return systemHealth;
  if (state.stopping || state.quality.jobId) return "finalizing";

  // No sessions exist until the visitor clicks a canvas — being admitted and
  // sitting on the run screen is not generating.
  if (!state.running && !state.starting) {
    if (
      typeof hasRunData === "function" &&
      hasRunData() &&
      systemHealth !== "unavailable"
    )
      return "finalized";
    return systemHealth === "ready" ? "ready" : systemHealth;
  }

  if (state.starting) return "generating";

  const active = state.panePhase.filter((p) => p === "live" || p === "paused");
  if (active.length && active.every((p) => p === "paused")) return "paused";
  if (state.panePhase.includes("error")) return "degraded";
  return "generating";
}

function renderStatusPill() {
  const root = byId("systemStatus");
  if (!root) return;
  const next = pillState();
  if (root.dataset.state === next) return;
  root.dataset.state = next;
  const label = byId("systemStatusText");
  if (label) label.textContent = STATUS_LABELS[next] || next;
}

function setStatus(message) {
  const node = byId("status");
  if (!node) return;
  const text =
    typeof tbcPublicText === "function"
      ? tbcPublicText(message)
      : message || "";
  node.textContent = text;
  node.dataset.idle = text === "Ready to generate." ? "true" : "false";
}

// The engine only calls setSystemStatus on its 15s health check, so run-state
// changes (generating / paused / degraded) would otherwise show up late. This
// poll is cheap: renderStatusPill bails immediately when nothing has changed.
function initStatusPillWatch() {
  window.setInterval(renderStatusPill, 250);
}

// QUEUE ----------------------------------------------------------------------
// When the play queue is enabled server-side, pressing Play puts the visitor in
// line rather than starting immediately. Staying on the select screen while
// queued reads far better than a run screen with two dead panes, so the
// transition to "run" is deferred until the engine reports admission.

function queueIsEnabled() {
  if (typeof window.TBC_QUEUE_ENABLED === "boolean")
    return window.TBC_QUEUE_ENABLED;
  return hasEngine() ? Boolean(queueState.enabled) : false;
}

let awaitingPreparedTransition = false;

// Returning visitors have no tutorial to fill the wait, so hold the transition
// until the pair is ready. The run screen then arrives complete, with the
// prompt already visible, instead of sitting empty for three seconds.
function transitionWhenPrepared(maxWaitMs = 6000) {
  if (awaitingPreparedTransition) return;
  awaitingPreparedTransition = true;
  const startedAt = performance.now();

  const finish = () => {
    if (!awaitingPreparedTransition) return;
    awaitingPreparedTransition = false;
    if (typeof goToScreen === "function") goToScreen("run");
  };

  const tick = () => {
    if (!awaitingPreparedTransition) return;
    if (hasEngine() && state.prepared) return finish();
    if (performance.now() - startedAt >= maxWaitMs) return finish();
    window.setTimeout(tick, 100);
  };

  tick();
}

function initQueueGating() {
  // Capture phase on document: this runs before the click reaches #startBtn,
  // so it preempts both the engine's own listener and demo.js's
  // [data-screen-go] transition. Because propagation is stopped, this handler
  // takes responsibility for calling requestGeneration() itself.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      const start =
        target instanceof Element ? target.closest("#startBtn") : null;
      if (!start || start.disabled) return;

      // First-time visitors complete the tutorial before joining the queue.
      // Otherwise a long tutorial can consume the 30-second admission/start
      // budget before the model sockets are allowed to generate.
      if (!tutorialSeen() && tutorial) {
        if (typeof goToScreen === "function") goToScreen("run");
        // Let the screen transition get underway before the modal lands on top.
        window.setTimeout(() => tutorial.open({ force: true }), 700);
      }

      // Queue off: let the normal click flow run (transition + engine start).
      if (!queueIsEnabled()) return;

      event.stopPropagation();
      if (typeof requestGeneration === "function") requestGeneration();
    },
    true
  );

  document.addEventListener("tbc:queue-admitted", () => {
    if (typeof goToScreen !== "function") return;
    // First-time visitors already moved to the run screen when Play was
    // clicked, so the tutorial has somewhere to sit.
    if (!tutorialSeen()) {
      goToScreen("run");
      return;
    }
    transitionWhenPrepared();
  });

  document.addEventListener("tbc:preparation-ended", () => {
    awaitingPreparedTransition = false;
    pendingPlayAfterTutorial = false;
    tutorial?.close("preparation-ended");
    if (typeof goToScreen === "function") goToScreen("select");
  });

  document.addEventListener("tbc:replay-started", () => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const target = document.getElementById("pane0Card");
    if (!target) return;
    window.requestAnimationFrame(() => {
      if (window.lenis) {
        window.lenis.resize();
        window.lenis.scrollTo(target, {
          offset: -80,
          force: true,
          duration: 0.8,
        });
      } else {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

// BACK BUTTON ----------------------------------------------------------------
// Stops any live run (engine), then returns to the select screen.

function abandonQualityScoring() {
  if (!hasEngine() || !state.quality.jobId) return;
  clearQualityPoll();
  state.quality.requestVersion += 1;
  state.quality.jobId = null;
  state.quality.jobMode = null;
  setQualityPhase("unavailable", "Scoring was canceled when you left the run.");
}

function initBackButton() {
  const back = document.querySelector('[data-demo-controller="back"]');
  if (!back) return;

  back.addEventListener("click", () => {
    window.TBC_RESET_DEMO?.();

    if (typeof goToScreen === "function") goToScreen("select");
    if (typeof hideQueue === "function") hideQueue();
    if (!hasEngine()) return;

    const busy =
      state.running ||
      state.starting ||
      queueState.requested ||
      state.ws.some(Boolean);

    // handleStopRequest also releases an unstarted queue slot, which plain
    // stop() does not — important if someone backs out while waiting in line.
    if (busy && typeof handleStopRequest === "function") {
      void handleStopRequest().then(abandonQualityScoring);
    } else {
      abandonQualityScoring();
    }
  });
}

// PANE PAUSE LABELS ----------------------------------------------------------
// Mirrors pair.js's aria-label flips onto the visible button text.

function initPauseLabels() {
  ["pane0Pause", "pane1Pause"].forEach((id) => {
    const btn = byId(id);
    if (!btn) return;
    const label = btn.querySelector("span");
    if (!label) return;

    const obs = new MutationObserver(() => {
      label.textContent = btn.getAttribute("aria-label")?.startsWith("Resume")
        ? "Resume"
        : "Pause";
    });
    obs.observe(btn, { attributes: true, attributeFilter: ["aria-label"] });
  });
}

let fullMetrics = null;
const FULL_METRICS_DEFAULT_OPEN = true;

function initFullMetrics() {
  const toggle = document.querySelector(".demo_run_toggle");
  const content = byId("fullMetricsContent");
  if (!toggle || !content) return;

  const label = toggle.querySelector(".demo_run_toggle_text");
  const columns = gsap.utils.toArray(content.children);
  const LABELS = { closed: "View full metrics", open: "Hide full metrics" };
  const HIDDEN = { y: "2rem", autoAlpha: 0 };
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  let open = FULL_METRICS_DEFAULT_OPEN;
  let tween = null;

  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-controls", content.id);
  toggle.classList.toggle("is-open", open);
  applyLabel();

  if (open) {
    content.classList.add("is-open");
    gsap.set(columns, { clearProps: "all" });
  }

  function applyLabel() {
    const text = open ? LABELS.open : LABELS.closed;
    if (label) label.textContent = text;
    toggle.setAttribute("aria-label", text);
  }

  function settle() {
    gsap.set(columns, { clearProps: "transform,opacity,visibility" });
  }

  function setOpen(next) {
    if (next === open) return;
    open = next;
    tween?.kill();

    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("is-open", open);
    applyLabel();

    if (!open) {
      content.classList.remove("is-open");
      gsap.set(columns, { clearProps: "all" });
      return;
    }

    window.tbcTrack?.("demo_full_metrics_opened");

    gsap.set(columns, HIDDEN);
    content.classList.add("is-open");

    if (typeof drawRuntimeTrace === "function") drawRuntimeTrace();

    if (reduceMotion) {
      settle();
      return;
    }

    tween = gsap.to(columns, {
      y: "0rem",
      autoAlpha: 1,
      duration: 0.6,
      stagger: 0.05,
      ease: "power4.out",
      onComplete: settle,
    });
  }

  toggle.addEventListener("click", () => setOpen(!open));
  fullMetrics = { isOpen: () => open, setOpen };
}

function initQueueDismiss() {
  const bar = byId("queueBar");
  if (!bar || typeof ScrollTrigger === "undefined") return;

  let trigger = null;

  function disarm() {
    trigger?.kill();
    trigger = null;
  }

  function dismiss() {
    disarm();
    gsap.to(bar, {
      autoAlpha: 0,
      y: "1rem",
      duration: 0.6,
      ease: "power4.out",
      onComplete: () => {
        if (typeof hideQueue === "function") hideQueue();
        gsap.set(bar, { clearProps: "all" });
      },
    });
  }

  function arm() {
    disarm();
    const origin = window.scrollY;
    trigger = ScrollTrigger.create({
      start: 0,
      end: "max",
      onUpdate: (self) => {
        if (Math.abs(self.scroll() - origin) >= 8) dismiss();
      },
    });
  }

  function sync() {
    const complete = !bar.hidden && bar.dataset.queueState === "complete";
    if (complete && !trigger) arm();
    else if (!complete) disarm();
  }

  new MutationObserver(sync).observe(bar, {
    attributes: true,
    attributeFilter: ["hidden", "data-queue-state"],
  });

  sync();
}

function initMobileControlsVisibility() {
  const bar = document.querySelector(".controls_mobile_wrap");
  if (!bar || typeof ScrollTrigger === "undefined") return;
  if (!window.matchMedia("(pointer: coarse)").matches) return;

  let trigger = null;
  let hidden = false;

  function disarm() {
    trigger?.kill();
    trigger = null;
  }

  function hide() {
    disarm();
    if (hidden) return;
    hidden = true;
    gsap.to(bar, {
      autoAlpha: 0,
      y: "1rem",
      duration: 0.6,
      ease: "power4.out",
      onComplete: () => {
        bar.classList.add("is-dismissed");
        gsap.set(bar, { clearProps: "all" });
      },
    });
  }

  function show() {
    if (!hidden) return;
    hidden = false;
    bar.classList.remove("is-dismissed");
    gsap.fromTo(
      bar,
      { autoAlpha: 0, y: "1rem" },
      {
        autoAlpha: 1,
        y: "0rem",
        duration: 0.6,
        ease: "power4.out",
        onComplete: () => gsap.set(bar, { clearProps: "all" }),
      }
    );
  }

  // Scrolling away from the demo means the visitor is reading, not driving.
  function armScrollDismiss() {
    disarm();
    const origin = window.scrollY;
    trigger = ScrollTrigger.create({
      start: 0,
      end: "max",
      onUpdate: (self) => {
        if (Math.abs(self.scroll() - origin) >= 80) hide();
      },
    });
  }

  document.addEventListener("tbc:run-ended", hide);
  document.addEventListener("tbc:replay-started", hide);
  document.addEventListener("tbc:lead-started", show);
}

// TUTORIAL -------------------------------------------------------------------
// Six-card stepper, shown before the first queue request. Returning visitors
// skip it and proceed directly to queue admission and pair preparation.

const TUTORIAL_SEEN_KEY = "tbc.tutorial.seen.v1";
// Set true while testing / demoing so the tutorial shows on every visit.
const TUTORIAL_ALWAYS_SHOW = false;
let tutorial = null;
let pendingPlayAfterTutorial = false;

function tutorialSeen() {
  if (TUTORIAL_ALWAYS_SHOW) return false;
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

let tutorialCompleted = false;

// The flag is written on the canvas click rather than on close, so someone who
// skips the walkthrough or leaves without playing still sees it next visit.
function markTutorialSeen() {
  if (!tutorialCompleted) return;
  try {
    localStorage.setItem(TUTORIAL_SEEN_KEY, "true");
  } catch {
    // Private browsing — the tutorial will simply show again next visit.
  }
}

window.markTutorialSeen = markTutorialSeen;

function initTutorial() {
  const root = document.querySelector("[data-tutorial]");
  if (!root) return;

  const steps = [...root.querySelectorAll("[data-tutorial-step]")];
  if (!steps.length) return;

  const card = root.querySelector("[data-tutorial-card]") || root;
  const count = root.querySelector("[data-tutorial-count]");
  const progress = root.querySelector("[data-tutorial-progress]");
  const nextBtn = root.querySelector('[data-tutorial-action="next"]');
  const doneBtn = root.querySelector('[data-tutorial-action="done"]');
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  let index = 0;

  // Settle the DOM before anything can be seen: step one visible, the rest
  // hidden, Next showing and Start playing held back.
  steps.forEach((step, i) => {
    step.hidden = i !== 0;
  });
  if (nextBtn) nextBtn.hidden = steps.length === 1;
  if (doneBtn) doneBtn.hidden = steps.length > 1;
  if (count) count.textContent = `1/${steps.length}`;
  if (progress) gsap.set(progress, { width: `${(1 / steps.length) * 100}%` });

  function render(nextIndex, animate = true) {
    index = nextIndex;
    const current = steps[index];
    const last = index === steps.length - 1;

    if (last) tutorialCompleted = true;

    window.tbcTrack?.("demo_tutorial_step_viewed", {
      step: index + 1,
      total: steps.length,
    });

    if (count) count.textContent = `${index + 1}/${steps.length}`;
    if (progress) {
      const width = `${((index + 1) / steps.length) * 100}%`;
      if (reduceMotion) gsap.set(progress, { width });
      else gsap.to(progress, { width, duration: 0.4, ease: "power4.out" });
    }

    if (nextBtn) nextBtn.hidden = last;
    if (doneBtn) doneBtn.hidden = !last;

    steps.forEach((step) => {
      step.hidden = step !== current;
    });

    if (!animate || reduceMotion) return;
    gsap.fromTo(
      current,
      { autoAlpha: 0, y: "2rem", filter: "blur(3px)" },
      {
        autoAlpha: 1,
        y: "0rem",
        filter: "blur(0px)",
        duration: 0.8,
        ease: "power4.out",
        onComplete: () => gsap.set(current, { clearProps: "all" }),
      }
    );
  }

  function open({ force = false } = {}) {
    if (root.dataset.state === "open") return;
    if (!force && tutorialSeen()) return;

    render(0, false);
    root.hidden = false;
    root.dataset.state = "open";
    if (window.lenis) window.lenis.stop();

    card.setAttribute("tabindex", "-1");
    card.focus({ preventScroll: true });

    if (reduceMotion) return;
    gsap.fromTo(
      card,
      { autoAlpha: 0, y: "4rem", filter: "blur(6px)" },
      {
        autoAlpha: 1,
        y: "0rem",
        filter: "blur(0px)",
        duration: 0.8,
        ease: "power4.out",
      }
    );
  }

  function close(reason = "unknown") {
    if (root.dataset.state !== "open") return;
    const resumePendingPlay = pendingPlayAfterTutorial;
    pendingPlayAfterTutorial = false;

    window.tbcTrack?.("demo_tutorial_exited", {
      reason,
      step: index + 1,
      completed: index === steps.length - 1,
    });

    root.dataset.state = "closed";
    if (window.lenis) window.lenis.start();

    // Marking the tutorial seen before requesting generation prevents the run
    // screen observer below from immediately reopening it.
    if (resumePendingPlay && typeof requestGeneration === "function")
      requestGeneration();

    if (state?.reprepareAfterTutorial) {
      state.reprepareAfterTutorial = false;
      if (typeof requestGeneration === "function") requestGeneration();
    }

    const finish = () => {
      root.hidden = true;
      gsap.set([root, card], { clearProps: "all" });
      // Land focus on the optimized pane so the next click or Tab is where the
      // visitor needs to be.
      byId("pane1")?.focus({ preventScroll: true });
    };

    if (reduceMotion) finish();
    else
      gsap.to(root, {
        autoAlpha: 0,
        duration: 0.8,
        ease: "power4.out",
        onComplete: finish,
      });
  }

  // Track where the press started so a text-selection drag that ends on the
  // scrim doesn't read as a scrim click — the click event fires on the common
  // ancestor, which would be the scrim itself.
  let pressedOnScrim = false;

  root.addEventListener("pointerdown", (event) => {
    pressedOnScrim = event.target === root;
  });

  root.addEventListener("click", (event) => {
    if (event.target === root) {
      if (pressedOnScrim) close("close");
      return;
    }
    const action =
      event.target instanceof Element
        ? event.target.closest("[data-tutorial-action]")
        : null;
    if (!action) return;
    if (action.dataset.tutorialAction === "next")
      render(Math.min(index + 1, steps.length - 1));
    else close(action.dataset.tutorialAction);
  });

  document.addEventListener("keydown", (event) => {
    if (root.dataset.state !== "open") return;
    if (event.key === "Escape") close("escape");
    else if (event.key === "ArrowRight" && index < steps.length - 1)
      render(index + 1);
    else if (event.key === "ArrowLeft" && index > 0) render(index - 1);
  });

  tutorial = {
    open,
    close,
    reset: () => localStorage.removeItem(TUTORIAL_SEEN_KEY),
  };
  window.tbcTutorial = tutorial;
}

/* Mobile touch controls */

const MOBILE_LOOK_SENSITIVITY = 1.0;

function isCoarsePointer() {
  return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
}

function setupMobileButtons() {
  const buttons = document.querySelectorAll(".controls_mobile_wrap [data-key]");
  if (!buttons.length) return;

  for (const button of buttons) {
    const key = button.dataset.key;
    let activePointerId = null;

    const press = (event) => {
      if (!state.running) return;
      event.preventDefault();
      activePointerId = event.pointerId;
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // Capture is an optimization; the release handlers still fire without it.
      }
      state.keys.set(key, 1);
      button.classList.add("is-pressed");
    };

    const release = (event) => {
      if (activePointerId !== null && event.pointerId !== activePointerId)
        return;
      activePointerId = null;
      state.keys.set(key, 0);
      button.classList.remove("is-pressed");
    };

    button.addEventListener("pointerdown", press, { passive: false });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  }
}

function setupMobileLook() {
  const canvases = [
    document.getElementById("pane0"),
    document.getElementById("pane1"),
  ].filter(Boolean);

  for (const canvas of canvases) {
    let activePointerId = null;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "mouse") return;
        if (!state.running) return;

        // In sequential only the lead pane is drivable. Without this, a drag
        // on the follow pane writes into state.camera[0] and pollutes the
        // recorded track that the base model replays.
        if (isSequential() && canvas.id !== "pane1") return;

        // preventDefault below suppresses iOS's synthesized click, so the
        // armed -> lead transition has to be driven from here.
        if (state.sequentialPhase === "armed" && canvas.id === "pane1") {
          beginLeadPhase();
        }

        event.preventDefault();
        activePointerId = event.pointerId;
        activePointerId = event.pointerId;
        lastX = event.clientX;
        lastY = event.clientY;
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          // Capture is optional; pointermove still reports while the finger is down.
        }
      },
      { passive: false }
    );

    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (activePointerId === null || event.pointerId !== activePointerId)
          return;
        event.preventDefault();
        const dx = (event.clientX - lastX) * MOBILE_LOOK_SENSITIVITY;
        const dy = (event.clientY - lastY) * MOBILE_LOOK_SENSITIVITY;
        lastX = event.clientX;
        lastY = event.clientY;
        // Sequential replays the recorded lead track onto the follow pane, so
        // live input must only reach the lead camera.
        if (isSequential()) {
          state.camera[1].dx += dx;
          state.camera[1].dy += dy;
        } else {
          for (const camera of state.camera) {
            camera.dx += dx;
            camera.dy += dy;
          }
        }
      },
      { passive: false }
    );

    const end = (event) => {
      if (activePointerId !== null && event.pointerId !== activePointerId)
        return;
      activePointerId = null;
    };

    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("lostpointercapture", end);
  }
}

function setupMobileInputSafety() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") resetInput();
  });
}

function setupMobileControls() {
  if (!isCoarsePointer()) return;
  setupMobileButtons();
  setupMobileLook();
  setupMobileInputSafety();
}

// INIT -----------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", function () {
  initBackButton();
  initTutorial();
  initPauseLabels();
  initQueueGating();
  initStatusPillWatch();
  initFullMetrics();
  initQueueDismiss();
  initMobileControlsVisibility();
  setupMobileControls();
});