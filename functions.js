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

      // Queue off: let the normal click flow run (transition + engine start).
      if (!queueIsEnabled()) return;

      event.stopPropagation();
      if (typeof requestGeneration === "function") requestGeneration();
    },
    true
  );

  // Engine fired this from onQueueMessage() the moment the slot opened.
  document.addEventListener("tbc:queue-admitted", () => {
    if (typeof goToScreen === "function") goToScreen("run");
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

  let open = false;
  let tween = null;

  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", content.id);
  applyLabel();

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

// TUTORIAL -------------------------------------------------------------------
// Six-card stepper, shown once per browser the first time the visitor reaches
// the run screen. Sessions are created by the canvas click, so nothing is
// allocated while this is open — the only clock running is the queue's
// admission grace.

const TUTORIAL_SEEN_KEY = "tbc.tutorial.seen.v1";
// Set true while testing / demoing so the tutorial shows on every visit.
const TUTORIAL_ALWAYS_SHOW = false;
let tutorial = null;

function tutorialSeen() {
  if (TUTORIAL_ALWAYS_SHOW) return false;
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

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

    window.tbcTrack?.("demo_tutorial_exited", {
      reason,
      step: index + 1,
      completed: index === steps.length - 1,
    });

    root.dataset.state = "closed";
    try {
      localStorage.setItem(TUTORIAL_SEEN_KEY, "true");
    } catch {
      // Private browsing — the tutorial will simply show again next visit.
    }
    if (window.lenis) window.lenis.start();

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

  // Open on the attribute flip rather than on timeline completion. goToScreen's
  // timeline runs the outgoing blur, the flip, then a staggered reveal — waiting
  // for all of it puts the modal seconds behind the screen it belongs to.
  const shell = byId("experience");
  if (shell) {
    new MutationObserver(() => {
      if (shell.dataset.screen === "run") open();
    }).observe(shell, { attributes: true, attributeFilter: ["data-screen"] });
  }

  tutorial = {
    open,
    close,
    reset: () => localStorage.removeItem(TUTORIAL_SEEN_KEY),
  };
  window.tbcTutorial = tutorial;
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
});