// TBC-branded separate-session comparison. The workers stay on independent
// GPUs and consume the same live controls at their native generation cadence.
//
// -----------------------------------------------------------------------------
// Webflow fork (base: pair.js?v=tbc-37). Diff from upstream is deliberately
// small so this stays a quick re-sync when TBC ships a new engine. Only four
// things change; everything else is upstream verbatim:
//   1. Origin is configurable (API_BASE / WS_BASE) instead of hard same-origin.
//   2. The metric / heatmap setup functions BIND to the hand-built Webflow
//      nodes instead of replaceChildren-rebuilding them (which wiped the design
//      and destroyed the .metric-arrow SVGs).
//   3. Metric cards bind by data-key across the whole document, not per
//      container. A key may appear on several cards (e.g. "fps" is both the
//      run screen's Render Rate and Pipeline Breakdown's Frames / Sec) and all
//      of them update together. Card labels and tooltip copy are owned by
//      Webflow, never overwritten. The Video Quality card is bound separately
//      off data-metric-card="video-quality" because it is fed by the /quality
//      sidecar rather than metricValue().
//   4. Metric deltas write the % into .metric-delta-value and set
//      .metric-delta[data-state]; the CSS rotates/colours the arrow. No glyphs.
// Screen transitions, the back button, and the Full Metrics toggle live in
// core.js / functions.js (app glue), NOT here.
// -----------------------------------------------------------------------------

// Origin config. Both fall through to current same-origin behaviour when the
// globals are unset, so nothing changes when the engine runs on TBC's server.
// On tbc.co, set window.TBC_API_BASE / window.TBC_WS_BASE (before this loads)
// to the backend origin, or proxy the backend to the same origin.
const API_BASE = window.TBC_API_BASE || "";
const WS_BASE =
  window.TBC_WS_BASE ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

const MODELS = ["oasis-500m", "causal_v4c"];
const MODEL_META = {
  "oasis-500m": { label: "Oasis 500M", short: "Base" },
  causal_v4c: {
    label: "Oasis 500M + TBC Neural Optimizer",
    short: "Optimized",
  },
};
const PIPELINE_DEPTH = 2;
const MAX_METRIC_SAMPLES = 600;
const METRIC_RENDER_INTERVAL_MS = 250;
const TRACE_WINDOW_SECONDS = 30;
const MATRIX_BUCKET_COUNT = 6;
const MAX_PRESENTATION_QUEUE_FRAMES = 8;
const PRESENTATION_PREROLL_FRAMES = [2, 3];
const FREE_RUN_INPUT_INTERVAL_MS = 50;
const PLAYBACK = { SIMULTANEOUS: "simultaneous", SEQUENTIAL: "sequential" };
const LEAD_PANE = 1;
const FOLLOW_PANE = 0;
const SEQUENTIAL_LEAD_SECONDS = 30;
const MAX_RECORDED_EVENTS = 2000;
const FREE_RUN_NEGOTIATION_TIMEOUT_MS = 1000;
const QUALITY_POLL_INTERVAL_MS = 1500;
const QUALITY_REPORT_ENDPOINT = 200;
const RECENT_RUNS_STORAGE_KEY = "tbc.pair.recentRuns.v1";
const MAX_RECENT_RUNS = 5;
const QUEUE_STOP_RESERVE_SECONDS = 5;

window.tbcTrack = function (event, props) {
  if (typeof window.posthog === "undefined") return;
  try {
    window.posthog.capture(event, props || {});
  } catch {
    // Analytics must never break the demo.
  }
};

const MAX_DISPLAY_FRAMES = 200;
const MAX_RUN_SECONDS = 30;
const ICON_ROOT = `${API_BASE}/static/tbc/icons`;
const QUALITY_COLORS = [
  "var(--quality-detail)",
  "var(--quality-contrast)",
  "var(--quality-exposure)",
  "var(--quality-continuity)",
];

const QUALITY_DIMENSIONS = [
  { key: "selected_vbench_mean", label: "VBench", shortLabel: "Selected mean" },
  {
    key: "subject_consistency",
    label: "Subject Consistency",
    shortLabel: "Subject",
  },
  {
    key: "aesthetic_quality",
    label: "Aesthetic Quality",
    shortLabel: "Aesthetic",
  },
  { key: "imaging_quality", label: "Imaging Quality", shortLabel: "Imaging" },
];

const DATA_SOURCES = Object.freeze({
  CURRENT_RUN: "current-run",
  LAST_RUN: "last-run",
  SYSTEM_LIVE: "system-live",
  UNAVAILABLE: "unavailable",
});

const RESULT_METRICS = [
  {
    key: "cost",
    label: "Cost / sec",
    unit: "USD",
    direction: "lower",
    precision: 4,
    icon: "dollar-sign.svg",
    tooltip:
      "Estimated compute cost per generated video second, using the configured GPU-hour price and measured generation throughput.",
    format: (value) => `$${value.toFixed(4)} USD`,
  },
  {
    key: "throughput",
    label: "Throughput",
    unit: "F/S",
    direction: "higher",
    precision: 1,
    icon: "activity.svg",
    tooltip:
      "End-to-end frames generated per second under sustained load, including sampling, decode, and delivery overhead.",
  },
  {
    key: "p50",
    label: "TPOF p50",
    unit: "MS",
    direction: "lower",
    precision: 1,
    icon: "gauge.svg",
    tooltip:
      "Median Time per Output Frame: the worker time needed to produce a generated frame. Lower is better.",
  },
  {
    key: "p99",
    label: "TPOF p99",
    unit: "MS",
    direction: "lower",
    precision: 1,
    icon: "gauge.svg",
    tooltip:
      "99th-percentile Time per Output Frame, showing slow tail frames. Lower is better.",
  },
  {
    key: "ttff",
    label: "TTFF",
    unit: "MS",
    direction: "lower",
    precision: 0,
    icon: "clock-3.svg",
    tooltip:
      "Time to First Frame, measured from requesting the GPU session until the first generated frame arrives.",
  },
  {
    key: "fps",
    label: "Frames/sec",
    unit: "F/S",
    direction: "higher",
    precision: 1,
    icon: "layers-2.svg",
    tooltip:
      "Sampling-stage frames per second, calculated from worker-reported model sampling time. Throughput includes the complete frame pipeline.",
  },
  {
    key: "frames",
    label: "Total frames",
    unit: "",
    direction: "higher",
    precision: 0,
    icon: "layers-2.svg",
    tooltip: "Total frames generated by each model in this paired run.",
  },
];

const LIVE_METRICS = [
  {
    key: "fps",
    label: "Frames/sec",
    unit: "F/S",
    direction: "higher",
    precision: 1,
    icon: "layers-2.svg",
    tooltip:
      "Sampling-stage frames per second, calculated from worker-reported model sampling time. Throughput includes the complete frame pipeline.",
  },
  {
    key: "decode",
    label: "Decode",
    unit: "MS",
    direction: "lower",
    precision: 1,
    icon: "icon-01-cv-enhancement.svg",
    tooltip: "Mean VAE decode time per generated frame on each worker.",
  },
  {
    key: "encode",
    label: "Encode",
    unit: "MS",
    direction: "lower",
    precision: 1,
    icon: "layers-2.svg",
    tooltip:
      "Mean browser-delivery image encoding time per generated frame on each worker.",
  },
  {
    key: "activeStreams",
    label: "Active streams",
    unit: "",
    direction: "neutral",
    precision: 0,
    icon: "activity.svg",
    tooltip:
      "Worker-reported concurrent generation streams sharing the model runtime when this frame was produced.",
  },
  {
    key: "memory",
    label: "GPU memory",
    unit: "GB",
    direction: "lower",
    precision: 1,
    icon: "activity.svg",
    format: (value) => `${(value / 1024).toFixed(1)} GB`,
    tooltip:
      "Peak reserved GPU memory per worker during generation, as reported by the runtime. Lower is better.",
  },
];

const MATRIX_METRICS = [
  {
    key: "throughput",
    label: "/throughput",
    direction: "higher",
    unit: "f/s",
    precision: 1,
  },
  {
    key: "frameMs",
    label: "/frame",
    direction: "lower",
    unit: "ms",
    precision: 1,
  },
  {
    key: "sampleMs",
    label: "/sampler",
    direction: "lower",
    unit: "ms",
    precision: 1,
  },
  {
    key: "decodeMs",
    label: "/decode",
    direction: "lower",
    unit: "ms",
    precision: 1,
  },
  {
    key: "encodeMs",
    label: "/encode",
    direction: "lower",
    unit: "ms",
    precision: 1,
  },
  {
    key: "memoryMb",
    label: "/memory",
    direction: "lower",
    unit: "MB",
    precision: 0,
  },
];

const TRACE_METRICS = {
  throughput: {
    label: "Native throughput",
    unit: "frames/sec",
    precision: 1,
    subtitle: "Worker-reported native throughput over the last 30 seconds",
  },
  frameMs: {
    label: "Frame time",
    unit: "ms",
    precision: 1,
    subtitle: "Worker-reported end-to-end frame time over the last 30 seconds",
  },
};

const el = (id) => document.getElementById(id);
const canvases = [el("pane0"), el("pane1")];
const contexts = canvases.map((canvas) => canvas.getContext("2d"));
const heatmapNodes = new Map();

// key -> [nodeSet, ...]. A metric key can legitimately appear on more than one
// card (the run screen's Render Rate and Pipeline Breakdown's Frames / Sec are
// both data-key="fps"), so every bound card for a key updates together.
const metricNodes = new Map();

// The pause/resume + start icons are real Webflow assets already in the DOM.
// Capture them at init and swap between them rather than pointing at
// /static/tbc/icons (which won't resolve on the Webflow origin). Set on init.
let PAUSE_ICON = "";
let PLAY_ICON = "";

// One flat registry keyed by metric key. RESULT_METRICS and LIVE_METRICS
// overlap on "fps" with byte-identical definitions, so first-wins is safe.
const METRIC_DEFINITIONS = [
  ...new Map(
    [...RESULT_METRICS, ...LIVE_METRICS].map((definition) => [
      definition.key,
      definition,
    ])
  ).values(),
];

// Video quality is produced by the /quality sidecar, not by metricValue(), so
// it binds off its own attribute and updates from renderReportQuality().
const QUALITY_METRIC = {
  key: "quality",
  label: "Video quality",
  direction: "higher",
  format: (value) => formatQualityScore(value),
};

function makeStats() {
  return {
    requestStartedAt: null,
    firstFrameAt: null,
    lastFrameAt: null,
    elapsedMs: 0,
    pauseElapsedMs: 0,
    emaFps: null,
    emaMs: null,
    ttffMs: null,
    frames: 0,
    generatedFrames: 0,
    latencies: [],
    sampleTimes: [],
    decodeTimes: [],
    encodeTimes: [],
    memoryReservedMb: null,
    activeStreams: null,
    history: [],
  };
}

const state = {
  running: false,
  starting: false,
  stopping: false,
  cancelStart: false,
  intentionalStop: false,
  scene: null,
  sceneLabel: null,
  scenesReady: false,
  scenesLoading: false,
  keys: new Map(),
  latestKeys: {},
  camera: [
    { dx: 0, dy: 0 },
    { dx: 0, dy: 0 },
  ],
  sessions: [null, null],
  ws: [null, null],
  streamsOpen: [false, false],
  expectedClose: [false, false],
  primed: [false, false],
  freeRun: [false, false],
  freeRunFallbackTimers: [null, null],
  inputTimer: null,
  requestInputTimer: null,
  inFlight: [0, 0],
  lastMeta: [null, null],
  nextTick: [0, 0],
  stats: [makeStats(), makeStats()],
  panePhase: ["ready", "ready"],
  paused: [false, false],
  pendingFrames: [null, null],
  renderVersion: [0, 0],
  presentationQueues: [[], []],
  presentationTimers: [null, null],
  presentationBusy: [false, false],
  presentationPrimed: [false, false],
  nextPresentationAt: [null, null],
  run: {
    id: null,
    phase: "ready",
    startedAt: null,
    endedAt: null,
    endReason: null,
  },
  runCapTimer: null,
  metricTimer: null,
  lastMetricRenderAt: 0,
  playback: String(window.TBC_PLAYBACK || PLAYBACK.SIMULTANEOUS).toLowerCase(),
  sequentialPhase: "idle", // idle | lead | replay | done
  leadTimer: null,
  leadCountdownTimer: null,
  leadStartedAt: 0,
  recording: { active: false, startedAt: 0, events: [] },
  replay: { index: 0, startedAt: 0 },
  traceMetric: "throughput",
  traceResizeObserver: null,
  cost: {
    initialized: false,
    configured: false,
    enabled: false,
    gpuHourlyUsd: null,
    outputVideoFps: 20,
    message: "The cost backend is not configured.",
  },
  quality: {
    initialized: false,
    configured: false,
    enabled: false,
    workerState: "offline",
    phase: "unavailable",
    jobId: null,
    jobMode: null,
    result: null,
    message: "The report quality sidecar is unavailable.",
    pollTimer: null,
    requestVersion: 0,
    reportEndpoint: QUALITY_REPORT_ENDPOINT,
  },
};

const queueState = {
  initialized: false,
  enabled: false,
  cid: null,
  ws: null,
  playSeconds: 60,
  remainingSeconds: null,
  admitted: false,
  requested: false,
  readySent: false,
  ending: false,
  reconnecting: false,
};

function beginRun() {
  const startedAt = Date.now();
  state.run = {
    id: `run-${startedAt}`,
    phase: "initializing",
    startedAt,
    endedAt: null,
    endReason: null,
  };
}

function finishRun(reason, phase = "stopped") {
  if (!state.run.id) return;
  state.run.phase = phase;
  state.run.endedAt = Date.now();
  state.run.endReason = reason;

  window.tbcTrack?.("demo_run_ended", {
    reason,
    completed:
      reason === "frame-cap" ||
      reason === "time-cap" ||
      reason === "queue-evicted",
    errored: state.panePhase.includes("error"),
    duration_seconds: Math.round(
      (state.run.endedAt - state.run.startedAt) / 1000
    ),
    frames_optimized: state.stats[1].generatedFrames,
    frames_base: state.stats[0].generatedFrames,
    scene: state.sceneLabel,
  });
}

function hasRunData() {
  return state.stats.some((stats) => stats.frames > 0);
}

function deriveRunPhase() {
  if (state.starting) return "initializing";
  const activeCount = state.panePhase.filter(
    (phase) => phase === "live" || phase === "paused"
  ).length;
  const hasError = state.panePhase.some((phase) => phase === "error");
  if (state.running) {
    if (hasError) return activeCount > 0 ? "degraded" : "error";
    if (activeCount > 0) return "live";
    return "initializing";
  }
  if (state.run.phase === "error") return "error";
  if (hasRunData()) return "last-run";
  return "ready";
}

function reconcileRunLifecycle() {
  if (!state.run.id || state.run.endedAt !== null) return;
  if (state.starting) {
    state.run.phase = "initializing";
    return;
  }
  if (state.running) state.run.phase = deriveRunPhase();
}

function livePanelProvenance() {
  const phase = deriveRunPhase();
  if (phase === "initializing") {
    return {
      source: DATA_SOURCES.CURRENT_RUN,
      state: "idle",
      label: "Initializing",
    };
  }
  if (phase === "live") {
    return {
      source: DATA_SOURCES.CURRENT_RUN,
      state: "live",
      label: "Live run",
    };
  }
  if (phase === "degraded" || phase === "error") {
    return {
      source: state.run.id
        ? DATA_SOURCES.CURRENT_RUN
        : DATA_SOURCES.UNAVAILABLE,
      state: "error",
      label: "Error",
    };
  }
  if (phase === "last-run") {
    return { source: DATA_SOURCES.LAST_RUN, state: "idle", label: "Last run" };
  }
  return { source: DATA_SOURCES.UNAVAILABLE, state: "idle", label: "Waiting" };
}

function qualityPanelProvenance() {
  const quality = state.quality;
  const scoring = [
    "exporting",
    "queued",
    "preparing",
    "vbench",
    "dispersion",
    "fvd",
    "finalizing",
  ].includes(quality.phase);
  if (quality.phase === "waiting") {
    return {
      source: DATA_SOURCES.CURRENT_RUN,
      state: "idle",
      label: "After run",
    };
  }
  if (scoring) {
    return {
      source: DATA_SOURCES.SYSTEM_LIVE,
      state: "live",
      label: quality.phase === "queued" ? "Queued" : "Scoring",
    };
  }
  if (quality.phase === "complete" && quality.result?.outcome === "complete") {
    return { source: DATA_SOURCES.LAST_RUN, state: "idle", label: "Scored" };
  }
  if (quality.phase === "complete") {
    return {
      source: DATA_SOURCES.LAST_RUN,
      state: "idle",
      label: "Not scored",
    };
  }
  if (quality.phase === "error") {
    return { source: DATA_SOURCES.SYSTEM_LIVE, state: "error", label: "Error" };
  }
  return {
    source: DATA_SOURCES.UNAVAILABLE,
    state: "idle",
    label: "Unavailable",
  };
}

function setPanelProvenance(
  rootId,
  textId,
  provenance = livePanelProvenance()
) {
  const root = el(rootId);
  const label = el(textId);
  if (!root || !label) return;
  root.dataset.state = provenance.state;
  root.dataset.source = provenance.source;
  root.title =
    provenance.source === DATA_SOURCES.CURRENT_RUN
      ? "Telemetry from this browser's current paired run"
      : provenance.source === DATA_SOURCES.LAST_RUN
      ? "Frozen telemetry from this browser's most recent paired run"
      : provenance.source === DATA_SOURCES.SYSTEM_LIVE
      ? "Status from the post-run report quality sidecar"
      : "No browser-run telemetry is available";
  label.textContent = provenance.label;
}

function updateLivePanelProvenance() {
  const provenance = livePanelProvenance();
  setPanelProvenance("resultsLiveLabel", "resultsLiveText", provenance);
  setPanelProvenance("eventsLivePill", "eventsLiveText", provenance);
  setPanelProvenance("heatmapSourcePill", "heatmapSourceText", provenance);
  setPanelProvenance("traceLivePill", "traceLiveText", provenance);
  const qualityProvenance = qualityPanelProvenance();
  setPanelProvenance("qualityLivePill", "qualityLiveText", qualityProvenance);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function pushSample(values, value) {
  if (!Number.isFinite(value)) return;
  values.push(value);
  if (values.length > MAX_METRIC_SAMPLES) values.shift();
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clearQualityPoll() {
  if (state.quality.pollTimer !== null)
    window.clearTimeout(state.quality.pollTimer);
  state.quality.pollTimer = null;
}

function setQualityPhase(phase, message = state.quality.message) {
  state.quality.phase = phase;
  state.quality.message = message;
  renderReportQuality();
  renderMetrics();
  renderEventFeed();
  updateLivePanelProvenance();
  syncControls();
}

function resetQualityForRun() {
  clearQualityPoll();
  state.quality.requestVersion += 1;
  state.quality.jobId = null;
  state.quality.jobMode = null;
  state.quality.result = null;
  if (state.quality.enabled) {
    setQualityPhase(
      "waiting",
      "Quality evaluation will start after generation completes."
    );
  } else {
    setQualityPhase(
      "unavailable",
      state.quality.message || "The report quality sidecar is unavailable."
    );
  }
}

function applyQualityStatus(payload) {
  if (!payload || payload.job_id !== state.quality.jobId) return;
  state.quality.message = payload.message || state.quality.message;
  if (payload.status === "complete") {
    clearQualityPoll();
    const result = payload.result || null;
    state.quality.jobId = null;
    state.quality.jobMode = null;
    if (result?.outcome === "complete") {
      state.quality.result = result;
    }
    if (result?.outcome !== "complete") state.quality.result = result;
    setQualityPhase("complete", result?.message || payload.message);
    // The queue bar is left on its wrapping message when a run ends by
    // eviction, since stop({fromQueue:true}) skips the closing showQueue().
    // Scoring finishing is the real end of the run, so resolve it here.
    if (queueState.ending) {
      showQueue("Run complete. Results are ready below.", {
        state: "complete",
      });
    }
    upsertRecentRun();
    return;
  }
  if (payload.status === "error") {
    clearQualityPoll();
    state.quality.jobId = null;
    state.quality.jobMode = null;
    setQualityPhase(
      "error",
      payload.message || "Report quality scoring failed."
    );
    if (queueState.ending) {
      showQueue("Run complete. Results are ready below.", {
        state: "complete",
      });
    }
    upsertRecentRun();
    return;
  }
  setQualityPhase(payload.stage || payload.status || "queued", payload.message);
}

async function pollQualityJob() {
  clearQualityPoll();
  const jobId = state.quality.jobId;
  if (!jobId) return;
  try {
    const response = await fetch(
      `${API_BASE}/quality/jobs/${encodeURIComponent(jobId)}`,
      { cache: "no-store" }
    );
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        payload.error || `quality status failed (${response.status})`
      );
    if (state.quality.jobId !== jobId) return;
    applyQualityStatus(payload);
  } catch (error) {
    if (state.quality.jobId !== jobId) return;
    state.quality.jobId = null;
    state.quality.jobMode = null;
    const message = error instanceof Error ? error.message : String(error);
    setQualityPhase("error", message);
    upsertRecentRun();
  }
  if (state.quality.jobId === jobId) {
    state.quality.pollTimer = window.setTimeout(
      () => void pollQualityJob(),
      QUALITY_POLL_INTERVAL_MS
    );
  }
}

async function submitQualityRun(sessionIds) {
  if (!state.quality.enabled) return;
  if (!state.run.id || sessionIds.some((sessionId) => !sessionId)) {
    setQualityPhase(
      "error",
      "Both live sessions must remain available to export a paired quality run."
    );
    return;
  }
  clearQualityPoll();
  const requestVersion = ++state.quality.requestVersion;
  state.quality.jobId = null;
  state.quality.jobMode = "final";
  setQualityPhase("exporting", "Freezing and exporting both generated clips.");
  try {
    // The sidecar validates that the caller owns both sessions, so this needs
    // the same queue CID that createSession() sends. Without it the request is
    // rejected with a 409 on every path, including a manual stop mid-turn.
    const headers = { "content-type": "application/json" };
    if (queueState.cid) headers["x-queue-cid"] = queueState.cid;
    const response = await fetch(`${API_BASE}/quality/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        run_id: state.run.id,
        scene: state.scene,
        sessions: sessionIds,
        mode: "final",
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.job_id) {
      throw new Error(
        payload.error || `quality submission failed (${response.status})`
      );
    }
    if (state.quality.requestVersion !== requestVersion) return;
    state.quality.jobId = payload.job_id;
    state.quality.jobMode = "final";
    applyQualityStatus(payload);
    void pollQualityJob();
  } catch (error) {
    if (state.quality.requestVersion !== requestVersion) return;
    state.quality.jobId = null;
    state.quality.jobMode = null;
    setQualityPhase(
      "error",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function initQuality() {
  if (state.stopping) return;
  try {
    const response = await fetch(`${API_BASE}/quality/config`, {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`quality config failed (${response.status})`);
    const config = await response.json();
    state.quality.configured = Boolean(config.configured);
    state.quality.enabled = Boolean(config.enabled);
    state.quality.workerState = config.worker?.state || "offline";
    const reportEndpoint = finiteNumber(config.method?.endpoint_frame);
    if (reportEndpoint !== null) state.quality.reportEndpoint = reportEndpoint;
    state.quality.message = state.quality.enabled
      ? `Quality is scored after generation at frame ${state.quality.reportEndpoint}.`
      : state.quality.configured
      ? "The report quality worker is offline."
      : "The report quality sidecar is not configured.";
  } catch (error) {
    state.quality.configured = false;
    state.quality.enabled = false;
    state.quality.workerState = "offline";
    console.warn("[quality] config failed:", error);
    state.quality.message =
      "Video quality scoring is unavailable for this run.";
  }
  state.quality.initialized = true;
  if (state.quality.jobId) return;
  if (state.running && state.quality.enabled && !state.quality.result) {
    setQualityPhase(
      "waiting",
      "Quality evaluation will start after generation completes."
    );
  } else if (!state.quality.result) {
    setQualityPhase("unavailable", state.quality.message);
  }
}

async function initCost() {
  try {
    const response = await fetch(`${API_BASE}/cost/config`, {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`cost config failed (${response.status})`);
    const config = await response.json();
    const gpuHourlyUsd = finiteNumber(config.inputs?.gpu_hourly_cost_usd);
    const outputVideoFps = finiteNumber(config.inputs?.output_video_fps);
    state.cost.configured = Boolean(config.configured);
    state.cost.enabled = Boolean(config.enabled);
    state.cost.gpuHourlyUsd = gpuHourlyUsd;
    if (outputVideoFps !== null) state.cost.outputVideoFps = outputVideoFps;
    state.cost.message =
      config.error ||
      (state.cost.enabled
        ? "Cost uses the configured per-GPU hourly rate and measured generation throughput."
        : "Cost/sec is unavailable until the deployment provides a per-GPU hourly rate.");
  } catch (error) {
    state.cost.configured = false;
    state.cost.enabled = false;
    state.cost.gpuHourlyUsd = null;
    state.cost.message = error instanceof Error ? error.message : String(error);
  }
  state.cost.initialized = true;
  renderMetrics();
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((percentileValue / 100) * (sorted.length - 1)))
  );
  return sorted[index];
}

function formatMetricValue(definition, value) {
  if (!Number.isFinite(value)) return "--";
  if (definition.format) return definition.format(value);
  const formatted = Number(value).toFixed(definition.precision ?? 1);
  return definition.unit ? `${formatted} ${definition.unit}` : formatted;
}

function formatQualityScore(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "--";
}

function formatDispersion(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "--";
}

function costPerGeneratedVideoSecond(throughputFps) {
  if (!state.cost.enabled || !Number.isFinite(state.cost.gpuHourlyUsd))
    return null;
  if (
    !Number.isFinite(state.cost.outputVideoFps) ||
    !Number.isFinite(throughputFps) ||
    throughputFps <= 0
  )
    return null;
  return (
    (state.cost.gpuHourlyUsd / 3600) *
    (state.cost.outputVideoFps / throughputFps)
  );
}

function readRecentRuns() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(RECENT_RUNS_STORAGE_KEY) || "[]"
    );
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_RUNS) : [];
  } catch {
    return [];
  }
}

function currentRunSnapshot() {
  const result =
    state.quality.result?.outcome === "complete" ? state.quality.result : null;
  return {
    id: state.run.id,
    scene: state.sceneLabel || state.scene || "Minecraft scene",
    started_at: state.run.startedAt,
    ended_at: state.run.endedAt,
    duration_ms: Math.max(...state.stats.map((stats) => stats.elapsedMs || 0)),
    quality_state: result ? "complete" : state.quality.phase,
    metrics: {
      cost: {
        base: costPerGeneratedVideoSecond(
          metricValue("throughput", state.stats[0])
        ),
        optimized: costPerGeneratedVideoSecond(
          metricValue("throughput", state.stats[1])
        ),
      },
      p50: {
        base: metricValue("p50", state.stats[0]),
        optimized: metricValue("p50", state.stats[1]),
      },
      p99: {
        base: metricValue("p99", state.stats[0]),
        optimized: metricValue("p99", state.stats[1]),
      },
      ttff: {
        base: metricValue("ttff", state.stats[0]),
        optimized: metricValue("ttff", state.stats[1]),
      },
      fps: {
        base: metricValue("fps", state.stats[0]),
        optimized: metricValue("fps", state.stats[1]),
      },
      frames: {
        base: metricValue("frames", state.stats[0]),
        optimized: metricValue("frames", state.stats[1]),
      },
      throughput: {
        base: metricValue("throughput", state.stats[0]),
        optimized: metricValue("throughput", state.stats[1]),
      },
    },
    fvd: result?.cohort_metrics?.fvd || null,
  };
}

function upsertRecentRun() {
  if (!state.run.id || !hasRunData()) return;
  const runs = readRecentRuns().filter((run) => run?.id !== state.run.id);
  runs.unshift(currentRunSnapshot());
  try {
    localStorage.setItem(
      RECENT_RUNS_STORAGE_KEY,
      JSON.stringify(runs.slice(0, MAX_RECENT_RUNS))
    );
  } catch {
    // Recent-run history is a browser convenience; the live run remains usable without storage.
  }
  renderRecentRuns();
}

function appendRecentRunMetric(row, label, pair, formatter) {
  const cell = document.createElement("div");
  const heading = document.createElement("span");
  heading.textContent = label;
  const base = finiteNumber(pair?.base);
  const optimized = finiteNumber(pair?.optimized);
  cell.append(heading);
  if (base === null && optimized === null) {
    const pending = document.createElement("strong");
    pending.textContent = "Pending";
    cell.append(pending);
  } else {
    const pairValues = document.createElement("div");
    pairValues.className = "recent-run-pair";
    const baseValue = document.createElement("span");
    baseValue.textContent = `Base ${base === null ? "--" : formatter(base)}`;
    const optimizedValue = document.createElement("span");
    optimizedValue.className = "recent-run-neural";
    optimizedValue.textContent = `Neural ${
      optimized === null ? "--" : formatter(optimized)
    }`;
    pairValues.append(baseValue, optimizedValue);
    cell.append(pairValues);
  }
  row.append(cell);
}

function renderRecentRuns() {
  const target = el("recentRunsList");
  if (!target) return;
  const runs = readRecentRuns();
  target.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement("p");
    empty.className = "recent-runs-empty";
    empty.textContent = "Completed runs will appear here.";
    target.append(empty);
    return;
  }
  for (const run of runs) {
    const row = document.createElement("article");
    row.className = "recent-run-row";
    const scene = document.createElement("div");
    const sceneLabel = document.createElement("span");
    const sceneValue = document.createElement("strong");
    sceneLabel.textContent = "Scene";
    sceneValue.textContent = run.scene || "Minecraft scene";
    scene.append(sceneLabel, sceneValue);
    const time = document.createElement("div");
    const timeLabel = document.createElement("span");
    const timeValue = document.createElement("strong");
    timeLabel.textContent = run.started_at
      ? new Date(run.started_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Run";
    timeValue.textContent = `Generated in ${formatGeneratedDuration(
      run.duration_ms || 0
    )}`;
    time.append(timeLabel, timeValue);
    row.append(scene, time);
    appendRecentRunMetric(
      row,
      "Cost / sec",
      run.metrics?.cost,
      (value) => `$${value.toFixed(4)}`
    );
    appendRecentRunMetric(
      row,
      "Throughput",
      run.metrics?.throughput,
      (value) => `${value.toFixed(1)} frames/sec`
    );
    appendRecentRunMetric(
      row,
      "TPOF p50",
      run.metrics?.p50 || run.metrics?.frame_efficiency,
      (value) => `${value.toFixed(0)} ms`
    );
    if (run.metrics?.frames) {
      appendRecentRunMetric(row, "Total frames", run.metrics.frames, (value) =>
        value.toFixed(0)
      );
    }
    target.append(row);
  }
}

// ---------------------------------------------------------------------------
// Metric cards
//
// Every .metric-card carrying a data-key is bound wherever it sits in the DOM.
// Nothing is built here: the label copy, tooltip text and .metric-arrow SVG are
// all authored in Webflow and left untouched. Values land in the Neural/Base
// <strong>s, the delta % lands in .metric-delta-value, and
// .metric-delta[data-state] drives the CSS-rotated arrow.
// ---------------------------------------------------------------------------

let tooltipSeq = 0;

function bindMetricTooltip(card, definition, labelText) {
  if (!labelText) return;
  const tooltip = card.querySelector(".metric-tooltip");

  // A card opts out simply by not having a .metric-tooltip in the Webflow
  // markup, or by leaving it empty. Strip any stale wiring and stop.
  if (!tooltip || !tooltip.textContent.trim()) {
    labelText.removeAttribute("aria-describedby");
    labelText.removeAttribute("tabindex");
    if (tooltip) tooltip.hidden = true;
    return;
  }

  // Keep the Webflow-authored id where there is one; only mint an id for cards
  // that lack one, so two cards sharing a key can't produce a duplicate id.
  const tooltipId =
    tooltip.id || `metricTooltip-${definition.key}-${++tooltipSeq}`;
  tooltip.hidden = false;
  tooltip.id = tooltipId;
  tooltip.setAttribute("role", "tooltip");
  labelText.setAttribute("aria-describedby", tooltipId);
  labelText.tabIndex = 0;
}

// Returns the card's node set, or null when the markup isn't a metric card.
function bindMetricCard(card, definition) {
  if (!card || !definition) return null;

  const optimizedValue = card.querySelector(".metric-value-neural strong");
  const baseValue = card.querySelector(
    ".metric-value:not(.metric-value-neural) strong"
  );
  if (!optimizedValue || !baseValue) return null;

  const labelText = card.querySelector(".metric-label-text");
  bindMetricTooltip(card, definition, labelText);

  return {
    card,
    delta: card.querySelector(".metric-delta"),
    deltaValue: card.querySelector(".metric-delta-value"),
    baseValue,
    optimizedValue,
    signed: card.dataset.deltaSign === "true",
    label: labelText?.textContent.trim() || definition.label,
  };
}

function updateMetricNode(nodes, definition, base, optimized, source) {
  nodes.baseValue.textContent = formatMetricValue(definition, base);
  nodes.optimizedValue.textContent = formatMetricValue(definition, optimized);

  const complete = Number.isFinite(base) && Number.isFinite(optimized);
  nodes.card.dataset.state = complete ? "complete" : "waiting";
  if (source) nodes.card.dataset.source = source;
  nodes.card.setAttribute(
    "aria-label",
    `${nodes.label}. Base ${formatMetricValue(
      definition,
      base
    )}; Neural ${formatMetricValue(definition, optimized)}.`
  );

  if (!nodes.delta) return;
  const setDelta = (text, deltaState, deltaDirection = "flat") => {
    if (nodes.deltaValue) nodes.deltaValue.textContent = text;
    else nodes.delta.textContent = text;
    nodes.delta.dataset.state = deltaState;
    nodes.delta.dataset.direction = deltaDirection;
    const spoken =
      deltaState === "improved"
        ? `${text}, improved`
        : deltaState === "regressed"
        ? `${text}, regressed`
        : text === "--"
        ? "no comparison yet"
        : text === "same"
        ? "no change"
        : text === "varies"
        ? "values differ"
        : `${text}, unchanged`;
    nodes.card.setAttribute(
      "aria-label",
      `${nodes.label}. Base ${formatMetricValue(definition, base)}; ` +
        `Neural ${formatMetricValue(definition, optimized)}. ${spoken}.`
    );
  };

  if (!complete) {
    setDelta("--", "neutral", "flat");
    return;
  }

  // Neutral metrics have no better/worse and no meaningful %, so they report
  // whether the two workers agree. Checked before the base === 0 guard, since
  // a legitimate 0 vs 0 is "same", not "no data".
  if (definition.direction === "neutral") {
    const identical =
      formatMetricValue(definition, base) ===
      formatMetricValue(definition, optimized);
    setDelta(identical ? "same" : "varies", "neutral", "flat");
    return;
  }

  if (base === 0) {
    setDelta("--", "neutral", "flat");
    return;
  }

  // Never show a delta the displayed values contradict: encode renders both
  // sides as "1.3 MS" at precision 1, so a raw 5.7% gap reads as a bug.
  if (
    formatMetricValue(definition, base) ===
    formatMetricValue(definition, optimized)
  ) {
    setDelta("0.0%", "neutral", "flat");
    return;
  }

  const rawChange = ((optimized - base) / Math.abs(base)) * 100;
  // Round before deriving the sign, or a -0.04% drift prints "-0.0%".
  const rounded = Number(rawChange.toFixed(1));
  const magnitude = Math.abs(rounded).toFixed(1);
  const direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const sign = !nodes.signed ? "" : rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  const improvement = definition.direction === "lower" ? -rounded : rounded;

  setDelta(
    `${sign}${magnitude}%`,
    improvement >= 0 ? "improved" : "regressed",
    direction
  );
}

// Push one metric to every card bound to its key.
function updateMetric(definition, base, optimized, source) {
  const bound = metricNodes.get(definition.key);
  if (!bound) return;
  for (const nodes of bound)
    updateMetricNode(nodes, definition, base, optimized, source);
}

function metricValue(key, stats) {
  if (key === "cost") return costPerGeneratedVideoSecond(stats.emaFps);
  if (key === "throughput") return stats.emaFps;
  if (key === "ttff") return stats.ttffMs;
  if (key === "p50") return percentile(stats.latencies, 50);
  if (key === "p99") return percentile(stats.latencies, 99);
  if (key === "fps") {
    const sampleMs = mean(stats.sampleTimes);
    return Number.isFinite(sampleMs) && sampleMs > 0 ? 1000 / sampleMs : null;
  }
  if (key === "sample") return mean(stats.sampleTimes);
  if (key === "decode") return mean(stats.decodeTimes);
  if (key === "encode") return mean(stats.encodeTimes);
  if (key === "memory") return stats.memoryReservedMb;
  if (key === "activeStreams") return stats.activeStreams;
  if (key === "frames")
    return state.run.id || stats.generatedFrames > 0
      ? stats.generatedFrames
      : null;
  return null;
}

function historicalResultMetric(key) {
  const latest = readRecentRuns()[0];
  if (!latest?.metrics) return null;
  if (key === "p50")
    return latest.metrics.p50 || latest.metrics.frame_efficiency || null;
  return latest.metrics[key] || null;
}

function renderMetrics() {
  if (!metricNodes.size) return;
  const provenance = livePanelProvenance();
  for (const definition of METRIC_DEFINITIONS) {
    let base = metricValue(definition.key, state.stats[0]);
    let optimized = metricValue(definition.key, state.stats[1]);
    let source = provenance.source;
    // Only the keys persisted by currentRunSnapshot() have history; everything
    // else falls straight through and stays on the live (or empty) value.
    if (!Number.isFinite(base) && !Number.isFinite(optimized)) {
      const historical = historicalResultMetric(definition.key);
      base = finiteNumber(historical?.base);
      optimized = finiteNumber(historical?.optimized);
      if (Number.isFinite(base) || Number.isFinite(optimized))
        source = DATA_SOURCES.LAST_RUN;
    }
    updateMetric(definition, base, optimized, source);
  }
}

function renderQualityMetric() {
  const result = state.quality.result;
  const scored = result?.outcome === "complete";
  updateMetric(
    QUALITY_METRIC,
    scored ? qualityMetric(result, "base", "selected_vbench_mean") : null,
    scored ? qualityMetric(result, "optimized", "selected_vbench_mean") : null,
    scored ? DATA_SOURCES.LAST_RUN : DATA_SOURCES.UNAVAILABLE
  );
}

function setupMetricCards() {
  metricNodes.clear();

  for (const definition of METRIC_DEFINITIONS) {
    const bound = [
      ...document.querySelectorAll(
        `.metric-card[data-key="${definition.key}"]`
      ),
    ]
      .map((card) => bindMetricCard(card, definition))
      .filter(Boolean);
    if (bound.length) metricNodes.set(definition.key, bound);
  }

  const qualityCard = bindMetricCard(
    document.querySelector('.metric-card[data-metric-card="video-quality"]'),
    QUALITY_METRIC
  );
  if (qualityCard) metricNodes.set(QUALITY_METRIC.key, [qualityCard]);

  renderMetrics();
  renderQualityMetric();
}

function renderLiveDashboard() {
  renderMetrics();
  renderVisualizations();
  renderEventFeed();
}

function renderLiveMetrics() {
  state.metricTimer = null;
  state.lastMetricRenderAt = performance.now();
  renderLiveDashboard();
}

function scheduleMetricRender() {
  if (state.metricTimer !== null) return;
  const elapsed = performance.now() - state.lastMetricRenderAt;
  const delay = Math.max(0, METRIC_RENDER_INTERVAL_MS - elapsed);
  state.metricTimer = window.setTimeout(renderLiveMetrics, delay);
}

function setupPerformanceHeatmap() {
  const target = el("performanceHeatmap");
  if (!target) return;
  heatmapNodes.clear();
  // Bind the pre-authored 6-row x 6-cell grid; reset the design's placeholder
  // values back to empty so the first real run paints from a clean state.
  const rows = [...target.querySelectorAll(".heatmap-row")];
  MATRIX_METRICS.forEach((definition, rowIndex) => {
    const row = rows[rowIndex];
    if (!row) return;
    const cells = [...row.querySelectorAll(".heatmap-cell")];
    cells.forEach((cell, index) => {
      cell.dataset.band = "empty";
      cell.textContent = "-";
      cell.setAttribute(
        "aria-label",
        `${definition.label} window ${index + 1}: no paired data`
      );
    });
    heatmapNodes.set(definition.key, cells);
  });
}

function bucketMean(history, key, startSeconds, endSeconds, includeEnd) {
  const values = [];
  for (const point of history) {
    const inside =
      point.timeS >= startSeconds &&
      (includeEnd ? point.timeS <= endSeconds : point.timeS < endSeconds);
    if (inside && Number.isFinite(point[key])) values.push(point[key]);
  }
  return mean(values);
}

function improvementPercent(definition, base, optimized) {
  if (!Number.isFinite(base) || !Number.isFinite(optimized) || base === 0)
    return null;
  const change = ((optimized - base) / Math.abs(base)) * 100;
  return definition.direction === "lower" ? -change : change;
}

function heatmapBand(delta) {
  if (!Number.isFinite(delta)) return "empty";
  if (delta < -5) return "regressed";
  if (delta <= 5) return "neutral";
  if (delta <= 40) return "improved";
  return "strong";
}

function formatHistoryValue(definition, value) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(definition.precision)} ${definition.unit}`.trim();
}

function renderPerformanceHeatmap() {
  if (!heatmapNodes.size) return;
  const lastTimes = state.stats
    .map((stats) => stats.history.at(-1)?.timeS)
    .filter(Number.isFinite);
  const latestTime = lastTimes.length ? Math.max(...lastTimes) : 0;
  const windowEnd = Math.max(MATRIX_BUCKET_COUNT, latestTime);
  const windowStart = Math.max(0, windowEnd - MATRIX_BUCKET_COUNT);

  for (const definition of MATRIX_METRICS) {
    const cells = heatmapNodes.get(definition.key) || [];
    for (let index = 0; index < MATRIX_BUCKET_COUNT; index += 1) {
      const bucketStart = windowStart + index;
      const bucketEnd = bucketStart + 1;
      const base = bucketMean(
        state.stats[0].history,
        definition.key,
        bucketStart,
        bucketEnd,
        index === MATRIX_BUCKET_COUNT - 1
      );
      const optimized = bucketMean(
        state.stats[1].history,
        definition.key,
        bucketStart,
        bucketEnd,
        index === MATRIX_BUCKET_COUNT - 1
      );
      const delta = improvementPercent(definition, base, optimized);
      const cell = cells[index];
      if (!cell) continue;

      cell.dataset.band = heatmapBand(delta);
      cell.textContent = Number.isFinite(delta)
        ? `${delta >= 0 ? "+" : ""}${Math.round(delta)}`
        : "-";
      const timeLabel = `${bucketStart.toFixed(0)}-${bucketEnd.toFixed(
        0
      )} seconds`;
      const detail = Number.isFinite(delta)
        ? `${definition.label}, ${timeLabel}: Base ${formatHistoryValue(
            definition,
            base
          )}, TBC ${formatHistoryValue(definition, optimized)}, ${
            delta >= 0 ? "+" : ""
          }${delta.toFixed(1)}% optimization change`
        : `${definition.label}, ${timeLabel}: no paired data`;
      cell.setAttribute("aria-label", detail);
      cell.title = detail;
    }
  }
}

function cssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function niceAxisMaximum(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const normalized = value / exponent;
  const multiplier =
    normalized <= 1
      ? 1
      : normalized <= 2
      ? 2
      : normalized <= 2.5
      ? 2.5
      : normalized <= 5
      ? 5
      : 10;
  return multiplier * exponent;
}

function latestTraceValue(stats, key) {
  for (let index = stats.history.length - 1; index >= 0; index -= 1) {
    const value = stats.history[index][key];
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function formatTraceValue(definition, value) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(definition.precision)} ${definition.unit}`;
}

function renderTraceStatus(hasData) {
  const provenance = livePanelProvenance();
  if (!hasData && provenance.source === DATA_SOURCES.LAST_RUN) {
    setPanelProvenance("traceLivePill", "traceLiveText", {
      source: DATA_SOURCES.UNAVAILABLE,
      state: "idle",
      label: "Waiting",
    });
    return;
  }
  setPanelProvenance("traceLivePill", "traceLiveText", provenance);
}

function drawTraceSeries(context, points, key, color, xScale, yScale) {
  const visible = points.filter(
    (point) => Number.isFinite(point[key]) && xScale.visible(point.timeS)
  );
  if (!visible.length) return;
  context.beginPath();
  visible.forEach((point, index) => {
    const x = xScale.value(point.timeS);
    const y = yScale(point[key]);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = color;
  context.lineWidth = 2.2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();

  const latest = visible.at(-1);
  context.beginPath();
  context.arc(
    xScale.value(latest.timeS),
    yScale(latest[key]),
    3.2,
    0,
    Math.PI * 2
  );
  context.fillStyle = color;
  context.fill();
}

function drawRuntimeTrace() {
  const canvas = el("runtimeTraceCanvas");
  if (!canvas) return;
  const definition = TRACE_METRICS[state.traceMetric];
  const cssWidth = Math.round(canvas.clientWidth);
  const cssHeight = Math.round(canvas.clientHeight);
  if (cssWidth < 2 || cssHeight < 2) return;
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const targetWidth = Math.round(cssWidth * pixelRatio);
  const targetHeight = Math.round(cssHeight * pixelRatio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  const context = canvas.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const latestTimes = state.stats
    .map((stats) => stats.history.at(-1)?.timeS)
    .filter(Number.isFinite);
  const latestTime = latestTimes.length ? Math.max(...latestTimes) : 0;
  const xMax = Math.max(TRACE_WINDOW_SECONDS, latestTime);
  const xMin = Math.max(0, xMax - TRACE_WINDOW_SECONDS);
  const visiblePoints = state.stats.flatMap((stats) =>
    stats.history.filter(
      (point) =>
        point.timeS >= xMin &&
        point.timeS <= xMax &&
        Number.isFinite(point[state.traceMetric])
    )
  );
  const hasData = visiblePoints.length > 0;
  const fallbackMaximum = state.traceMetric === "throughput" ? 10 : 100;
  const dataMaximum = hasData
    ? Math.max(...visiblePoints.map((point) => point[state.traceMetric]))
    : fallbackMaximum;
  const yMax = niceAxisMaximum(Math.max(dataMaximum * 1.08, fallbackMaximum));
  const padding = { left: 48, right: 14, top: 18, bottom: 30 };
  const plotWidth = cssWidth - padding.left - padding.right;
  const plotHeight = cssHeight - padding.top - padding.bottom;
  const xScale = {
    visible: (value) => value >= xMin && value <= xMax,
    value: (value) =>
      padding.left + ((value - xMin) / Math.max(1, xMax - xMin)) * plotWidth,
  };
  const yScale = (value) =>
    padding.top + (1 - Math.max(0, Math.min(1, value / yMax))) * plotHeight;
  const edge = cssColor("--edge", "#4a6578");
  const secondary = cssColor("--trace-axis", "rgba(255,255,255,0.7)");
  const baseColor = cssColor("--mono", "#aac0d1");
  const tbcColor = cssColor("--tbc", "#efff42");

  context.font = `10px ${cssColor("--font-mono", "monospace")}`;
  context.textBaseline = "middle";
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const yValue = yMax * (1 - ratio);
    const y = padding.top + plotHeight * ratio;
    context.beginPath();
    context.setLineDash([3, 5]);
    context.moveTo(padding.left, y);
    context.lineTo(cssWidth - padding.right, y);
    context.strokeStyle = edge;
    context.globalAlpha = 0.62;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;
    context.setLineDash([]);
    context.fillStyle = secondary;
    context.textAlign = "right";
    context.fillText(
      yValue >= 100 ? yValue.toFixed(0) : yValue.toFixed(1),
      padding.left - 8,
      y
    );
  }

  context.textBaseline = "alphabetic";
  for (let index = 0; index <= 3; index += 1) {
    const value = xMin + ((xMax - xMin) * index) / 3;
    context.fillStyle = secondary;
    context.textAlign = index === 0 ? "left" : index === 3 ? "right" : "center";
    context.fillText(
      `${value.toFixed(0)}s`,
      xScale.value(value),
      cssHeight - 8
    );
  }
  context.fillStyle = secondary;
  context.textAlign = "left";
  context.fillText(definition.unit, padding.left, 11);

  drawTraceSeries(
    context,
    state.stats[0].history,
    state.traceMetric,
    baseColor,
    xScale,
    yScale
  );
  drawTraceSeries(
    context,
    state.stats[1].history,
    state.traceMetric,
    tbcColor,
    xScale,
    yScale
  );

  el("traceEmpty").hidden = hasData;
  const baseValue = latestTraceValue(state.stats[0], state.traceMetric);
  const optimizedValue = latestTraceValue(state.stats[1], state.traceMetric);
  el("traceBaseValue").textContent = formatTraceValue(definition, baseValue);
  el("traceTbcValue").textContent = formatTraceValue(
    definition,
    optimizedValue
  );
  el("traceSubtitle").textContent = definition.subtitle;
  const summary = hasData
    ? `${definition.label}: Base ${formatTraceValue(
        definition,
        baseValue
      )}; TBC optimized ${formatTraceValue(definition, optimizedValue)}.`
    : `No ${definition.label.toLowerCase()} trace data yet.`;
  el("runtimeTraceSummary").textContent = summary;
  canvas.setAttribute(
    "aria-label",
    `${definition.label} over time. ${summary}`
  );
  renderTraceStatus(hasData);
}

function selectTraceMetric(key, { focus = false } = {}) {
  if (!TRACE_METRICS[key]) return;
  state.traceMetric = key;
  for (const button of document.querySelectorAll("[data-trace-metric]")) {
    const selected = button.dataset.traceMetric === key;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    if (selected && focus) button.focus();
  }
  drawRuntimeTrace();
}

function setupVisualizations() {
  setupPerformanceHeatmap();
  const tabs = [...document.querySelectorAll("[data-trace-metric]")];
  tabs.forEach((button, index) => {
    button.addEventListener("click", () =>
      selectTraceMetric(button.dataset.traceMetric)
    );
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      selectTraceMetric(next.dataset.traceMetric, { focus: true });
    });
  });
  selectTraceMetric(state.traceMetric);

  if ("ResizeObserver" in window) {
    state.traceResizeObserver = new ResizeObserver(() => drawRuntimeTrace());
    state.traceResizeObserver.observe(el("runtimeTraceCanvas"));
  } else {
    window.addEventListener("resize", drawRuntimeTrace);
  }
  renderPerformanceHeatmap();
  drawRuntimeTrace();
}

// The Full Metrics toggle is now a button (#fullMetricsToggle) + #fullMetricsContent
// div, animated with GSAP in functions.js. That layer owns show/hide, the
// aria-expanded/.is-open state, the #fullMetricsLabel text, and calling
// drawRuntimeTrace() on open. The ResizeObserver on #runtimeTraceCanvas (see
// setupVisualizations) also remeasures the trace when the panel unhides, so the
// engine no longer needs a setupFullMetrics().

function renderVisualizations() {
  renderPerformanceHeatmap();
  drawRuntimeTrace();
}

function tbcPublicText(value, fallback = "TBC runtime status unavailable.") {
  const text = String(value || "");
  return /bluesky|ambient/i.test(text) ? fallback : text;
}

function setStatus(message) {
  const node = el("status");
  if (!node) return;
  const text = tbcPublicText(message);
  node.textContent = text;
  // The design hides the status line via [data-idle='true']; only surface it
  // when there's something active to say.
  node.dataset.idle = String(text === "" || /^ready to generate/i.test(text));
}

function setSystemStatus(status, message, detail = "") {
  const root = el("systemStatus");
  root.dataset.state = status;
  root.title = tbcPublicText(detail, "TBC runtime status unavailable.");
  el("systemStatusText").textContent = tbcPublicText(message);
}

function setEventRow(id, status, title, detail, tag) {
  const root = el(id);
  if (!root) return;
  root.dataset.state = status;
  el(`${id}Title`).textContent = tbcPublicText(title);
  el(`${id}Detail`).textContent = tbcPublicText(detail);
  el(`${id}Tag`).textContent = tbcPublicText(tag);
}

function renderEventFeed() {
  if (!el("runtimeEvent")) return;
  const phases = state.panePhase;
  const runPhase = deriveRunPhase();
  const failedIndex = phases.findIndex((phase) => phase === "error");
  const activeCount = phases.filter(
    (phase) => phase === "live" || phase === "paused"
  ).length;
  const pausedCount = phases.filter((phase) => phase === "paused").length;

  if (failedIndex !== -1) {
    setEventRow(
      "runtimeEvent",
      "error",
      `${MODEL_META[MODELS[failedIndex]].short} stream needs attention`,
      activeCount > 0
        ? "The sibling stream remains independently available for this run."
        : "No aggregate or cross-user state is shown here.",
      "Error"
    );
  } else if (state.starting) {
    setEventRow(
      "runtimeEvent",
      "info",
      "Allocating paired GPU sessions",
      "Both models are initializing from the same scene.",
      "Starting"
    );
  } else if (activeCount > 0 && pausedCount === activeCount) {
    setEventRow(
      "runtimeEvent",
      "info",
      "Both displays are paused",
      "Generation continues on both workers; only browser presentation is paused.",
      "Paused"
    );
  } else if (pausedCount > 0) {
    setEventRow(
      "runtimeEvent",
      "info",
      "One display is paused",
      "Generation continues; the other pane remains visible in real time.",
      "Paused"
    );
  } else if (activeCount === 2) {
    setEventRow(
      "runtimeEvent",
      "success",
      "Both model streams are live",
      "Keyboard and pointer input are reaching two independent workers.",
      "Success"
    );
  } else if (activeCount === 1) {
    setEventRow(
      "runtimeEvent",
      "info",
      "One stream is live",
      "The other pane is still initializing.",
      "Live"
    );
  } else if (runPhase === "last-run") {
    setEventRow(
      "runtimeEvent",
      "stopped",
      "Last run finished normally",
      "The readings shown here compare the TBC-optimized and base video model.",
      "Last run"
    );
  } else {
    setEventRow(
      "runtimeEvent",
      "idle",
      "Ready for a paired run",
      "Both GPU sessions will report independently.",
      "Ready"
    );
  }

  const optimized = state.stats[1];
  const optimizedP50 = percentile(optimized.latencies, 50);
  const live = state.running && activeCount > 0;
  const optimizedLive = phases[1] === "live" || phases[1] === "paused";
  if (Number.isFinite(optimized.emaFps) && live && optimizedLive) {
    const latencyDetail = Number.isFinite(optimizedP50)
      ? `The median frame is ${optimizedP50.toFixed(1)} milliseconds long.`
      : "Waiting for enough frames to measure frame time.";
    setEventRow(
      "throughputEvent",
      "success",
      `TBC is running at ${optimized.emaFps.toFixed(1)} frames/sec`,
      latencyDetail,
      "Live"
    );
  } else if (
    Number.isFinite(optimized.emaFps) &&
    state.running &&
    failedIndex === 1
  ) {
    const latencyDetail = Number.isFinite(optimizedP50)
      ? `The median frame was ${optimizedP50.toFixed(
          1
        )} milliseconds long before the optimized stream ended.`
      : "The optimized model stopped before it could report frame timings.";
    setEventRow(
      "throughputEvent",
      "error",
      `TBC speed before the error was ${optimized.emaFps.toFixed(
        1
      )} frames/sec`,
      latencyDetail,
      "Error"
    );
  } else if (Number.isFinite(optimized.emaFps)) {
    const latencyDetail = Number.isFinite(optimizedP50)
      ? `The median frame was ${optimizedP50.toFixed(1)} milliseconds long.`
      : "Measured from the previous paired run.";
    setEventRow(
      "throughputEvent",
      "info",
      `Last TBC speed was ${optimized.emaFps.toFixed(1)} frames/sec`,
      latencyDetail,
      "Last run"
    );
  } else if (state.starting) {
    setEventRow(
      "throughputEvent",
      "info",
      "Waiting for the first frame",
      "Speed and frame time appear once a model returns a frame.",
      "Starting"
    );
  } else {
    setEventRow(
      "throughputEvent",
      "idle",
      "Waiting for live speed",
      "Frame timings appear here during a run.",
      "Info"
    );
  }

  const baseFrames = state.stats[0].frames;
  const optimizedFrames = state.stats[1].frames;
  const deliveredFrames = baseFrames + optimizedFrames;
  const quality = state.quality;
  const baseQuality =
    quality.result?.panes?.base?.metrics?.selected_vbench_mean;
  const optimizedQuality =
    quality.result?.panes?.optimized?.metrics?.selected_vbench_mean;
  const qualityScoring = [
    "exporting",
    "queued",
    "preparing",
    "vbench",
    "dispersion",
    "fvd",
    "finalizing",
  ].includes(quality.phase);
  const qualityWindow = quality.result?.window;
  if (qualityScoring) {
    const title =
      quality.phase === "exporting"
        ? "Exporting the final paired run"
        : quality.phase === "queued"
        ? "Report scoring queued"
        : "Report quality scoring in progress";
    setEventRow(
      "qualitySnapshotEvent",
      "info",
      title,
      quality.message,
      "Scoring"
    );
  } else if (
    quality.phase === "complete" &&
    quality.result?.outcome === "complete"
  ) {
    setEventRow(
      "qualitySnapshotEvent",
      "success",
      "Quality scoring is complete",
      `Frames ${qualityWindow?.start_frame}-${
        qualityWindow?.end_frame
      } used VBench quality score: Base model ${formatQualityScore(
        baseQuality
      )}, TBC ${formatQualityScore(optimizedQuality)}.`,
      "Scored"
    );
  } else if (quality.phase === "complete") {
    setEventRow(
      "qualitySnapshotEvent",
      "info",
      "Run was not scored",
      quality.message,
      "Not scored"
    );
  } else if (quality.phase === "waiting") {
    const requiredFrames = state.quality.reportEndpoint;
    setEventRow(
      "qualitySnapshotEvent",
      "info",
      "Quality scores after generation",
      `Base ${baseFrames} / ${requiredFrames}; TBC ${optimizedFrames} / ${requiredFrames} generated frames. For a clean final score, let both counters reach ${requiredFrames} before stopping.`,
      "After run"
    );
  } else if (quality.phase === "error") {
    setEventRow(
      "qualitySnapshotEvent",
      "error",
      "TBC quality scoring did not complete",
      "The live video and runtime metrics are still available. Run again to retry quality scoring.",
      "Error"
    );
  } else {
    setEventRow(
      "qualitySnapshotEvent",
      "idle",
      "Report quality scoring unavailable",
      quality.message,
      "Unavailable"
    );
  }

  setPanelProvenance("eventsLivePill", "eventsLiveText");
  el("eventsFooterText").textContent = live
    ? "Current viewer run"
    : deliveredFrames > 0
    ? "Frozen last-run telemetry"
    : "No run data yet";
  el(
    "eventsFrameCount"
  ).textContent = `${baseFrames} / ${optimizedFrames} frames`;
}

function updateResultsState() {
  updateLivePanelProvenance();
  renderReportQuality();
  renderEventFeed();
}

function setPanePhase(index, phase, message = "") {
  const labels = {
    ready: "Ready",
    initializing: "Initializing",
    waiting: "Waiting",
    live: "Live",
    replaying: "Replaying",
    paused: "Paused",
    stopped: "Stopped",
    error: "Error",
  };
  state.panePhase[index] = phase;
  el(`pane${index}Card`).dataset.state = phase;
  const status = el(`pane${index}Status`);
  status.dataset.state = phase;
  status.textContent =
    phase === "stopped" && state.stats[index].frames > 0
      ? `Generated in ${formatGeneratedDuration(state.stats[index].elapsedMs)}`
      : labels[phase] || phase;

  const error = el(`pane${index}Error`);
  error.hidden = phase !== "error";
  if (phase === "error") {
    el(`pane${index}ErrorMessage`).textContent =
      message || "The live session ended unexpectedly.";
  }

  const pause = el(`pane${index}Pause`);
  pause.hidden = !(phase === "live" || phase === "paused");
  const activity = el(`pane${index}Activity`);
  activity.style.width =
    phase === "live" || phase === "paused" || phase === "replaying"
      ? "100%"
      : phase === "initializing"
      ? "28%"
      : "0%";
  if (isSequential() && index === FOLLOW_PANE && phase === "live") {
    setPanePrompt(FOLLOW_PANE, "");
  }
  reconcileRunLifecycle();
  updateResultsState();
}

function showPaneError(index, message) {
  setPanePhase(
    index,
    "error",
    tbcPublicText(
      message,
      `${
        MODEL_META[MODELS[index]].short
      } could not continue. Retry this pane or start a new run.`
    )
  );
  const sibling = index === 0 ? 1 : 0;
  if (
    state.panePhase[sibling] === "live" ||
    state.panePhase[sibling] === "paused"
  ) {
    setStatus(
      `${
        MODEL_META[MODELS[index]].short
      } needs attention; the other stream is still live.`
    );
  } else {
    setStatus("The live comparison needs attention.");
  }
  fillPanePipeline(sibling);
}

function setPickerEnabled(enabled) {
  for (const tile of el("sceneTiles").querySelectorAll(".scene-tile"))
    tile.disabled = !enabled;
  if (!enabled) el("modelSelector").open = false;
}

function setupModelPicker() {
  const selector = el("modelSelector");
  const availableOption = selector.querySelector(
    '[role="option"][aria-selected="true"]'
  );
  availableOption?.addEventListener("click", () => {
    selector.open = false;
  });
  selector.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    selector.open = false;
    selector.querySelector("summary")?.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (selector.open && !selector.contains(event.target))
      selector.open = false;
  });
}

function formatCountdown(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const remaining = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(remaining / 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining % 60).padStart(
    2,
    "0"
  )}`;
}

function generatingLabel() {
  const countdown = queueState.readySent
    ? formatCountdown(runSecondsRemaining())
    : null;
  return countdown ? `Generating ${countdown}` : "Generating";
}

function syncControls() {
  const startButton = el("startBtn");
  const stopButton = el("stopBtn");
  if (!startButton || !stopButton) return;
  const startLabel = startButton.querySelector("span");
  const generating =
    state.starting ||
    state.running ||
    queueState.requested ||
    Boolean(state.quality.jobId);
  // The design conveys the generating state via this class + the button label,
  // so leave the Webflow-hosted play icon in place (its /static swap would 404).
  startButton.classList.toggle("is-generating", generating);

  if (state.starting) {
    startButton.hidden = false;
    startButton.disabled = true;
    startLabel.textContent = generatingLabel();
    stopButton.hidden = false;
    stopButton.disabled = false;
    return;
  }

  if (state.stopping) {
    startButton.hidden = false;
    startButton.disabled = true;
    startLabel.textContent = "Finalizing";
    stopButton.hidden = true;
    return;
  }

  if (state.quality.jobId) {
    startButton.hidden = false;
    startButton.disabled = true;
    startLabel.textContent = "Finalizing";
    stopButton.hidden = true;
    return;
  }

  if (state.running) {
    startButton.hidden = false;
    startButton.disabled = true;
    startLabel.textContent = generatingLabel();
    stopButton.hidden = false;
    stopButton.disabled = false;
    return;
  }

  if (queueState.requested && !queueState.admitted) {
    startButton.hidden = false;
    startButton.disabled = true;
    startLabel.textContent = "Waiting";
    stopButton.hidden = false;
    stopButton.disabled = false;
    return;
  }

  startLabel.textContent = state.stats.some((stats) => stats.frames > 0)
    ? "Run again"
    : "Play";
  startButton.hidden = false;
  startButton.disabled = !state.scenesReady || !queueState.initialized;
  stopButton.hidden = true;
  stopButton.disabled = true;
}

function resetInput() {
  state.keys.clear();
  state.latestKeys = {};
  state.camera = [
    { dx: 0, dy: 0 },
    { dx: 0, dy: 0 },
  ];
}

function keyName(event) {
  if (event.code === "Space") return "space";
  return event.key ? event.key.toLowerCase() : event.code.toLowerCase();
}

function isEditableTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

const SCROLL_KEYS = [
  " ",
  "Spacebar",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
];

window.addEventListener("keydown", (event) => {
  if (!state.running || isEditableTarget(event.target)) return;
  state.keys.set(keyName(event), 1);

  // Leave real controls alone — Space and Enter activate Pause, Retry, the
  // trace tabs. Only the canvases and bare document get their keys swallowed.
  const onControl =
    event.target instanceof Element &&
    event.target.closest("button, a, summary, [role='button']");

  // While a run is live the demo owns the keyboard. Space, arrows and the page
  // keys all scroll the document by default, which fights the game controls.
  if (!onControl && SCROLL_KEYS.includes(event.key)) event.preventDefault();

  if (
    (document.pointerLockElement ||
      canvases.includes(document.activeElement)) &&
    ["Shift", "Control"].includes(event.key)
  ) {
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  state.keys.set(keyName(event), 0);
});

window.addEventListener("blur", resetInput);

for (const canvas of canvases) {
  canvas.tabIndex = 0;
  canvas.addEventListener("click", () => {
    // Pre-run: this click creates the sessions. Nothing is open before it, so
    // there's no idle stream for the worker to time out.
    if (!state.running && !state.starting && !state.stopping) {
      if (queueState.enabled && !queueState.admitted) return;
      if (!state.scenesReady || !queueState.initialized) return;

      window.tbcTrack("demo_canvas_play_clicked", {
        pane: canvases.indexOf(canvas) === 1 ? "optimized" : "base",
        scene: state.sceneLabel,
      });

      // Lock first, synchronously — start() is async and awaiting it would
      // spend the user activation this gesture carries.
      canvas.focus({ preventScroll: true });
      try {
        const request = canvas.requestPointerLock();
        if (request && typeof request.catch === "function")
          request.catch(() => {});
      } catch {
        // Pointer lock is optional; keyboard and click controls still work.
      }
      void start();
      return;
    }

    if (!state.running || !canvas.requestPointerLock) return;
    if (isSequential()) {
      if (canvases.indexOf(canvas) !== LEAD_PANE) return;
      if (state.sequentialPhase === "armed") beginLeadPhase();
      else if (state.sequentialPhase !== "lead") return;
    }
    canvas.focus({ preventScroll: true });
    try {
      const request = canvas.requestPointerLock();
      if (request && typeof request.catch === "function")
        request.catch(() => {});
    } catch {
      // Pointer lock is optional; keyboard and click controls still work.
    }
  });
  canvas.addEventListener("mousedown", (event) => {
    if (state.running) state.keys.set(`mouse${event.button}`, 1);
  });
  canvas.addEventListener("mouseup", (event) =>
    state.keys.set(`mouse${event.button}`, 0)
  );
  canvas.addEventListener("contextmenu", (event) => {
    if (state.running) event.preventDefault();
  });
}

function syncPointerLockState() {
  document.documentElement.dataset.pointerLocked = String(
    canvases.includes(document.pointerLockElement)
  );
}
document.addEventListener("pointerlockchange", syncPointerLockState);
document.addEventListener("pointerlockerror", syncPointerLockState);

window.addEventListener("mousemove", (event) => {
  if (!state.running || !canvases.includes(document.pointerLockElement)) return;
  for (const camera of state.camera) {
    camera.dx += event.movementX || 0;
    camera.dy += event.movementY || 0;
  }
});

function snapshotInput() {
  const keys = {};
  for (const [key, value] of state.keys.entries()) keys[key] = value;
  state.latestKeys = keys;
}

function startRequestInputPump() {
  snapshotInput();
  if (state.requestInputTimer !== null) return;
  state.requestInputTimer = window.setInterval(snapshotInput, 33);
}

function stopRequestInputPump() {
  if (state.requestInputTimer !== null) {
    window.clearInterval(state.requestInputTimer);
  }
  state.requestInputTimer = null;
}

function buildActionPayload(index, tick) {
  const camera = state.camera[index];
  const payload = {
    keys: state.latestKeys,
    camera: { dx: camera.dx, dy: camera.dy },
    image_format: "jpeg",
    quality: 85,
    tick,
  };
  camera.dx = 0;
  camera.dy = 0;
  if (
    state.recording.active &&
    index === LEAD_PANE &&
    state.recording.events.length < MAX_RECORDED_EVENTS
  ) {
    // payload.keys and payload.camera are freshly built and never mutated
    // after this point, so storing the references is safe.
    state.recording.events.push({
      t: performance.now() - state.recording.startedAt,
      keys: payload.keys,
      camera: payload.camera,
    });
  }
  return payload;
}

function sendMessageToPane(index, message) {
  const ws = state.ws[index];
  if (!state.running || !ws || ws.readyState !== WebSocket.OPEN) return false;
  if (
    state.panePhase[index] === "error" ||
    state.panePhase[index] === "stopped"
  )
    return false;
  try {
    ws.send(message);
    state.inFlight[index] += 1;
    return true;
  } catch (error) {
    showPaneError(
      index,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

function sendPaneAction(index) {
  if (!state.running || !state.streamsOpen[index]) return false;
  const tick = state.nextTick[index];
  state.nextTick[index] += 1;
  return sendMessageToPane(
    index,
    JSON.stringify(buildActionPayload(index, tick))
  );
}

function clearFreeRunFallback(index) {
  const timer = state.freeRunFallbackTimers[index];
  if (timer !== null) window.clearTimeout(timer);
  state.freeRunFallbackTimers[index] = null;
}

function stopInputPump() {
  if (state.inputTimer !== null) window.clearInterval(state.inputTimer);
  state.inputTimer = null;
}

function sendFreeRunInput(index) {
  if (!state.running || !state.streamsOpen[index] || !state.freeRun[index])
    return;
  // The lead pane is frozen once replay starts; stop feeding it live input.
  if (state.sequentialPhase === "replay" && index === LEAD_PANE) return;

  const ws = state.ws[index];
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const replaying = state.sequentialPhase === "replay" && index === FOLLOW_PANE;
  let recorded = null;

  if (replaying) {
    recorded = replayActionFor(performance.now() - state.replay.startedAt);
    if (state.replay.index >= state.recording.events.length) {
      // finishReplay is idempotent, so repeated calls are harmless.
      finishReplay();
    }
    if (!recorded) return;
  }

  const tick = state.nextTick[index];
  state.nextTick[index] += 1;
  const action = recorded
    ? { ...recorded, image_format: "jpeg", quality: 85, tick }
    : buildActionPayload(index, tick);

  try {
    ws.send(JSON.stringify({ type: "input", ...action }));
  } catch (error) {
    showPaneError(
      index,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function ensureInputPump() {
  if (state.inputTimer !== null) return;
  state.inputTimer = window.setInterval(() => {
    if (!state.running) return;
    for (let index = 0; index < MODELS.length; index += 1)
      sendFreeRunInput(index);
  }, FREE_RUN_INPUT_INTERVAL_MS);
}

function negotiateFreeRun(index) {
  const ws = state.ws[index];
  if (!state.running || !ws || ws.readyState !== WebSocket.OPEN) return;
  const tick = state.nextTick[index];
  state.nextTick[index] += 1;
  try {
    ws.send(
      JSON.stringify({
        type: "mode",
        mode: "free",
        action: buildActionPayload(index, tick),
      })
    );
  } catch {
    fillPanePipeline(index);
    return;
  }
  clearFreeRunFallback(index);
  state.freeRunFallbackTimers[index] = window.setTimeout(() => {
    state.freeRunFallbackTimers[index] = null;
    if (state.running && !state.freeRun[index]) fillPanePipeline(index);
  }, FREE_RUN_NEGOTIATION_TIMEOUT_MS);
}

function primeComparison() {
  if (!state.running || !state.streamsOpen.every(Boolean)) return;
  startRequestInputPump();

  if (isSequential()) {
    if (state.primed[LEAD_PANE]) return;
    state.primed[LEAD_PANE] = true;
    state.sequentialPhase = "armed";
    setPanePhase(LEAD_PANE, "waiting");
    setPanePhase(FOLLOW_PANE, "waiting");
    setStatus("Click the optimized video to start generating.");
    syncControls();
    return;
  }

  for (let index = 0; index < MODELS.length; index += 1) {
    if (state.primed[index]) continue;
    state.primed[index] = true;
    fillPanePipeline(index);
  }
}

function isSequential() {
  return state.playback === PLAYBACK.SEQUENTIAL;
}

function setPanePrompt(index, text) {
  const node = el(`pane${index}Prompt`);
  if (node) node.textContent = text || "";
}

function clearLeadTimer() {
  if (state.leadTimer !== null) window.clearTimeout(state.leadTimer);
  state.leadTimer = null;
}

function clearRunCapTimer() {
  if (state.runCapTimer !== null) window.clearTimeout(state.runCapTimer);
  state.runCapTimer = null;
}

let countdownTicker = null;
let runCountdownStartedAt = 0;

function runSecondsRemaining() {
  if (!runCountdownStartedAt) return null;
  const elapsed = (performance.now() - runCountdownStartedAt) / 1000;
  return Math.max(0, MAX_RUN_SECONDS - elapsed);
}

function renderRunCountdown() {
  if (!state.running || queueState.ending || isSequential()) return;
  showQueue("Your turn ends in", {
    state: "playing",
    data: { countdown: formatCountdown(runSecondsRemaining()) },
  });
}

function startCountdownTicker() {
  if (countdownTicker !== null) return;
  countdownTicker = window.setInterval(renderRunCountdown, 250);
  renderRunCountdown();
}

function stopCountdownTicker() {
  if (countdownTicker !== null) window.clearInterval(countdownTicker);
  countdownTicker = null;
  runCountdownStartedAt = 0;
}

// Drains every recorded action up to `elapsedMs`. Key state is last-wins, but
// camera deltas must SUM — they're per-send deltas, so dropping the skipped
// ones would lose the visitor's view rotation.
function replayActionFor(elapsedMs) {
  const events = state.recording.events;
  let keys = null;
  let dx = 0;
  let dy = 0;
  let consumed = false;
  while (
    state.replay.index < events.length &&
    events[state.replay.index].t <= elapsedMs
  ) {
    const event = events[state.replay.index];
    keys = event.keys;
    dx += event.camera.dx;
    dy += event.camera.dy;
    state.replay.index += 1;
    consumed = true;
  }
  return consumed ? { keys, camera: { dx, dy } } : null;
}

function applyPlaybackMode() {
  document.documentElement.dataset.playback = state.playback;
}

function beginReplay() {
  if (!isSequential() || state.sequentialPhase !== "lead") return;
  // Stop the lead countdown before flipping phase; the swap to the replay
  // label happens once, below, after sequentialPhase changes.
  if (state.leadCountdownTimer) {
    window.clearInterval(state.leadCountdownTimer);
    state.leadCountdownTimer = null;
  }
  clearLeadTimer();
  state.sequentialPhase = "replay";
  state.recording.active = false;
  state.replay = { index: 0, startedAt: performance.now() };

  // Hand the keyboard back before the recording takes over.
  if (document.pointerLockElement && document.exitPointerLock)
    document.exitPointerLock();
  resetInput();

  // Freeze the lead pane's picture. There's no protocol message to halt a
  // free-run stream without closing the session, and the session has to stay
  // open for quality scoring — so this is a presentation freeze only. The
  // worker keeps generating.
  state.paused[LEAD_PANE] = true;
  state.stats[LEAD_PANE].pauseElapsedMs = state.stats[LEAD_PANE].elapsedMs;
  state.renderVersion[LEAD_PANE] += 1;
  resetPresentation(LEAD_PANE);
  setPanePhase(LEAD_PANE, "paused");

  state.primed[FOLLOW_PANE] = true;
  setPanePhase(FOLLOW_PANE, "initializing");
  negotiateFreeRun(FOLLOW_PANE);
  setStatus("Replaying your inputs on the base model.");
  syncControls();
  renderSequentialTurnBar();
}

function renderSequentialTurnBar() {
  if (!isSequential()) return;
  if (state.sequentialPhase === "lead") {
    const elapsed = performance.now() - state.leadStartedAt;
    const remaining = Math.max(
      0,
      Math.ceil((SEQUENTIAL_LEAD_SECONDS * 1000 - elapsed) / 1000)
    );
    showQueue("Your turn ends in", {
      state: "playing",
      data: { countdown: formatCountdown(remaining) },
    });
  } else if (state.sequentialPhase === "replay") {
    showQueue("Replaying on the base model", {
      state: "playing",
      data: { countdown: "" },
    });
  }
}

function beginLeadPhase() {
  if (!isSequential() || state.sequentialPhase !== "armed") return;
  state.sequentialPhase = "lead";
  state.recording = { active: true, startedAt: performance.now(), events: [] };
  setPanePrompt(LEAD_PANE, "");
  setPanePhase(LEAD_PANE, "initializing");
  negotiateFreeRun(LEAD_PANE);
  setStatus("Generating on the optimized model.");
  syncControls();
}

function finishReplay() {
  if (state.sequentialPhase !== "replay") return;
  state.sequentialPhase = "done";
  setPanePrompt(FOLLOW_PANE, "");
  setPanePrompt(LEAD_PANE, "");
  void stop();
}

function fillPanePipeline(index) {
  if (state.freeRun[index]) return;
  while (
    state.running &&
    state.streamsOpen[index] &&
    state.inFlight[index] < PIPELINE_DEPTH
  ) {
    if (!sendPaneAction(index)) break;
  }
}

function updatePaneHud(index) {
  const stats = state.stats[index];
  el(`pane${index}Fps`).textContent = Number.isFinite(stats.emaFps)
    ? stats.emaFps.toFixed(1)
    : "--";
  el(`pane${index}Ms`).textContent = Number.isFinite(stats.emaMs)
    ? `${stats.emaMs.toFixed(1)} ms`
    : "--";
  el(`pane${index}Frames`).textContent = String(stats.generatedFrames);
}

function updateStats(index, meta) {
  const stats = state.stats[index];
  const now = performance.now();
  if (stats.firstFrameAt === null) {
    stats.firstFrameAt = now;
    stats.ttffMs =
      stats.requestStartedAt === null ? null : now - stats.requestStartedAt;
  }

  const arrivalFps =
    stats.lastFrameAt === null
      ? null
      : 1000 / Math.max(1, now - stats.lastFrameAt);
  const serverFps = finiteNumber(meta?.fps_instant);
  // Pipelined responses can arrive in browser-side bursts. Prefer the worker's
  // measured frame rate and only fall back to arrival cadence when it is absent.
  const instantFps = serverFps ?? arrivalFps;
  if (instantFps !== null)
    stats.emaFps =
      stats.emaFps === null
        ? instantFps
        : stats.emaFps * 0.85 + instantFps * 0.15;

  const totalMs = finiteNumber(meta?.total_ms ?? meta?.step_ms);
  const sampleMs = finiteNumber(meta?.sample_ms);
  const decodeMs = finiteNumber(meta?.decode_ms);
  const encodeMs = finiteNumber(meta?.encode_ms);
  if (totalMs !== null) {
    stats.emaMs =
      stats.emaMs === null ? totalMs : stats.emaMs * 0.85 + totalMs * 0.15;
    pushSample(stats.latencies, totalMs);
  }
  pushSample(stats.sampleTimes, sampleMs);
  pushSample(stats.decodeTimes, decodeMs);
  pushSample(stats.encodeTimes, encodeMs);

  const memoryReservedMb = finiteNumber(meta?.memory_reserved_mb);
  if (memoryReservedMb !== null) {
    stats.memoryReservedMb =
      stats.memoryReservedMb === null
        ? memoryReservedMb
        : Math.max(stats.memoryReservedMb, memoryReservedMb);
  }
  stats.activeStreams =
    finiteNumber(meta?.active_streams) ?? stats.activeStreams;
  stats.frames += 1;
  const generatedFrame = finiteNumber(meta?.frame_index);
  stats.generatedFrames =
    generatedFrame === null
      ? stats.frames
      : Math.max(stats.frames, generatedFrame);
  stats.lastFrameAt = now;
  stats.elapsedMs = Math.max(0, now - stats.firstFrameAt);
  stats.history.push({
    timeS: stats.elapsedMs / 1000,
    throughput: stats.emaFps,
    frameMs: totalMs,
    sampleMs,
    decodeMs,
    encodeMs,
    memoryMb: stats.memoryReservedMb,
  });
  if (stats.history.length > MAX_METRIC_SAMPLES) stats.history.shift();
  updatePaneHud(index);
  scheduleMetricRender();
}

async function drawFrame(index, blob, version) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (state.renderVersion[index] !== version) return;
    contexts[index].drawImage(
      bitmap,
      0,
      0,
      canvases[index].width,
      canvases[index].height
    );
  } finally {
    bitmap.close();
  }
}

function clearPresentationTimer(index) {
  const timer = state.presentationTimers[index];
  if (timer !== null) window.clearTimeout(timer);
  state.presentationTimers[index] = null;
}

function resetPresentation(index) {
  clearPresentationTimer(index);
  state.presentationQueues[index] = [];
  state.presentationBusy[index] = false;
  state.presentationPrimed[index] = false;
  state.nextPresentationAt[index] = null;
}

function presentationPeriodMs(index) {
  const nativeFps = state.stats[index]?.emaFps;
  const estimatedFps =
    Number.isFinite(nativeFps) && nativeFps > 0 ? nativeFps : 60;
  return 1000 / estimatedFps;
}

function schedulePresentation(index, delayMs = 0) {
  if (
    state.paused[index] ||
    state.presentationBusy[index] ||
    state.presentationTimers[index] !== null
  )
    return;
  const version = state.renderVersion[index];
  state.presentationTimers[index] = window.setTimeout(() => {
    state.presentationTimers[index] = null;
    void presentNextFrame(index, version);
  }, Math.max(0, delayMs));
}

async function presentNextFrame(index, version) {
  if (state.renderVersion[index] !== version || state.paused[index]) return;
  const queue = state.presentationQueues[index];
  if (!state.presentationPrimed[index]) {
    if (queue.length < PRESENTATION_PREROLL_FRAMES[index]) return;
    state.presentationPrimed[index] = true;
    state.nextPresentationAt[index] = performance.now();
  }

  const nextFrame = queue.shift();
  if (nextFrame) {
    state.presentationBusy[index] = true;
    try {
      await drawFrame(index, nextFrame, version);
      if (state.renderVersion[index] !== version) return;
      if (state.panePhase[index] !== "live") setPanePhase(index, "live");
      onFirstFrame();
    } catch (error) {
      showPaneError(
        index,
        `Could not render a live frame: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      void closePane(index);
      return;
    } finally {
      state.presentationBusy[index] = false;
    }
  }

  if (state.renderVersion[index] !== version || state.paused[index]) return;
  const now = performance.now();
  const previousDeadline = state.nextPresentationAt[index] ?? now;
  const periodMs = presentationPeriodMs(index);
  let nextDeadline = previousDeadline + periodMs;
  if (nextDeadline <= now) {
    const missedTicks = Math.floor((now - nextDeadline) / periodMs) + 1;
    nextDeadline += missedTicks * periodMs;
  }
  state.nextPresentationAt[index] = nextDeadline;
  schedulePresentation(index, nextDeadline - now);
}

function queueFrameForRender(index, blob) {
  const queue = state.presentationQueues[index];
  queue.push(blob);
  while (queue.length > MAX_PRESENTATION_QUEUE_FRAMES) queue.shift();
  if (state.paused[index]) return;
  if (
    state.presentationPrimed[index] ||
    queue.length >= PRESENTATION_PREROLL_FRAMES[index]
  )
    schedulePresentation(index);
}

async function presentImmediateFrame(index, blob, version) {
  try {
    await drawFrame(index, blob, version);
    if (state.renderVersion[index] !== version) return;
    if (state.panePhase[index] !== "live") setPanePhase(index, "live");
    onFirstFrame();
  } catch (error) {
    showPaneError(
      index,
      `Could not render a live frame: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    void closePane(index);
    return;
  }
  fillPanePipeline(index);
}

function handleFrame(index, blob) {
  if (state.expectedClose[index]) return;
  const meta = state.lastMeta[index];
  state.lastMeta[index] = null;
  state.inFlight[index] = Math.max(0, state.inFlight[index] - 1);
  updateStats(index, meta);

  if (
    index === 1 &&
    state.stats[1].generatedFrames >= MAX_DISPLAY_FRAMES &&
    state.running &&
    !state.stopping
  ) {
    void stop({ reason: "frame-cap" });
    return;
  }

  if (state.paused[index]) {
    state.pendingFrames[index] = blob;
    if (!state.freeRun[index]) fillPanePipeline(index);
  } else if (!isSequential()) {
    void presentImmediateFrame(index, blob, state.renderVersion[index]);
  } else {
    queueFrameForRender(index, blob);
    if (!state.freeRun[index]) fillPanePipeline(index);
  }
}

function handleSocketMessage(index, event) {
  if (typeof event.data !== "string") {
    handleFrame(index, event.data);
    return;
  }

  let meta;
  try {
    meta = JSON.parse(event.data);
  } catch {
    showPaneError(index, "The worker returned an invalid status message.");
    void closePane(index);
    return;
  }

  if (meta.type === "error") {
    showPaneError(
      index,
      meta.detail || "The worker could not generate the next frame."
    );
    void closePane(index);
    return;
  }
  if (meta.type === "mode") {
    if (meta.mode === "free") {
      state.freeRun[index] = true;
      state.inFlight[index] = 0;
      clearFreeRunFallback(index);
      ensureInputPump();
      sendFreeRunInput(index);
    }
    return;
  }
  if (meta.type === "closed") {
    const ws = state.ws[index];
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    return;
  }
  state.lastMeta[index] = meta;
}

async function createSession(model) {
  const headers = { "content-type": "application/json" };
  if (queueState.cid) headers["x-queue-cid"] = queueState.cid;
  const response = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      scene: state.scene,
      max_frames: 100000,
      streaming: true,
      seed: 7,
    }),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok || !payload.session_id) {
    throw new Error(
      payload.detail ||
        payload.error ||
        text ||
        `${MODEL_META[model].short} session failed (${response.status})`
    );
  }
  return payload.session_id;
}

function openStream(index) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `${WS_BASE}/sessions/${state.sessions[index]}/stream`
    );
    let opened = false;
    let settled = false;
    state.expectedClose[index] = false;
    state.ws[index] = ws;
    ws.binaryType = "blob";

    ws.onopen = () => {
      opened = true;
      settled = true;
      state.streamsOpen[index] = true;
      resolve();
    };
    ws.onmessage = (event) => handleSocketMessage(index, event);
    ws.onerror = () => {
      if (!opened && !settled) {
        settled = true;
        reject(
          new Error(
            `${MODEL_META[MODELS[index]].short} stream could not connect.`
          )
        );
      } else if (!state.expectedClose[index]) {
        showPaneError(index, "The live stream encountered a network error.");
      }
    };
    ws.onclose = () => {
      state.streamsOpen[index] = false;
      state.primed[index] = false;
      state.freeRun[index] = false;
      clearFreeRunFallback(index);
      if (!state.freeRun.some(Boolean)) stopInputPump();
      state.inFlight[index] = 0;
      if (!opened && !settled) {
        settled = true;
        reject(
          new Error(
            `${
              MODEL_META[MODELS[index]].short
            } stream closed before it was ready.`
          )
        );
        return;
      }
      if (
        !state.expectedClose[index] &&
        !state.intentionalStop &&
        (state.running || state.starting)
      ) {
        showPaneError(
          index,
          "The worker disconnected. The other stream can continue independently."
        );
      }
    };
  });
}

async function closePane(index) {
  const sessionId = state.sessions[index];
  const ws = state.ws[index];
  const streamWasOpen = state.streamsOpen[index];
  state.renderVersion[index] += 1;
  resetPresentation(index);
  state.pendingFrames[index] = null;
  state.expectedClose[index] = true;
  state.primed[index] = false;
  state.freeRun[index] = false;
  clearFreeRunFallback(index);
  if (!state.freeRun.some(Boolean)) stopInputPump();
  state.inFlight[index] = 0;
  if (!ws) {
    await deleteSession(sessionId);
    state.sessions[index] = null;
    return;
  }

  await new Promise((resolve) => {
    let finished = false;
    let timeoutId = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      resolve();
    };
    ws.addEventListener("close", finish, { once: true });
    try {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "close" }));
      else if (ws.readyState === WebSocket.CONNECTING) ws.close();
      else if (ws.readyState !== WebSocket.CLOSING) finish();
    } catch {
      finish();
    }
    timeoutId = window.setTimeout(() => {
      try {
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        )
          ws.close();
      } catch {
        // The close event may have won the race with this timeout.
      }
      finish();
    }, 1200);
  });

  if (!streamWasOpen) await deleteSession(sessionId);

  state.ws[index] = null;
  state.sessions[index] = null;
  state.streamsOpen[index] = false;
}

async function deleteSession(sessionId) {
  if (!sessionId) return;
  try {
    // Keep the router's `bN:` prefix as a literal path segment delimiter.
    // Encoding the colon makes Starlette fall through to the backend-0 proxy.
    const routedId = encodeURIComponent(sessionId).replace(/%3A/gi, ":");
    await fetch(`${API_BASE}/sessions/${routedId}`, { method: "DELETE" });
  } catch {
    // A failed stream handshake may leave nothing reachable to delete.
  }
}

async function closeAllPanes() {
  await Promise.all([closePane(0), closePane(1)]);
}

function resetRunState() {
  stopInputPump();
  stopRequestInputPump();
  resetQualityForRun();
  for (let index = 0; index < MODELS.length; index += 1) {
    clearFreeRunFallback(index);
    state.renderVersion[index] += 1;
    resetPresentation(index);
  }
  state.nextTick = [0, 0];
  state.stats = [makeStats(), makeStats()];
  state.lastMeta = [null, null];
  state.paused = [false, false];
  state.pendingFrames = [null, null];
  state.primed = [false, false];
  state.freeRun = [false, false];
  state.inFlight = [0, 0];
  clearRunCapTimer();
  stopCountdownTicker();
  clearLeadTimer();
  state.sequentialPhase = "idle";
  if (state.leadCountdownTimer) {
    window.clearInterval(state.leadCountdownTimer);
    state.leadCountdownTimer = null;
  }
  state.leadStartedAt = 0;
  state.recording = { active: false, startedAt: 0, events: [] };
  state.replay = { index: 0, startedAt: 0 };
  if (isSequential()) {
    setPanePrompt(LEAD_PANE, "Click to play.");
    setPanePrompt(FOLLOW_PANE, "Finish demo to reveal.");
  } else {
    // start() is now triggered by the click, so the prompt has done its job.
    setPanePrompt(0, "");
    setPanePrompt(1, "");
  }
  resetInput();
  for (let index = 0; index < 2; index += 1) {
    updatePaneHud(index);
    el(`pane${index}Timer`).textContent = "00:00.0";
    el(`pane${index}Timer`).dateTime = "PT0S";
    if (PAUSE_ICON) el(`pane${index}PauseIcon`).src = PAUSE_ICON;
    el(`pane${index}Pause`).setAttribute(
      "aria-label",
      `Pause ${MODEL_META[MODELS[index]].short.toLowerCase()} video display`
    );
    el(`pane${index}Pause`).title = "Pause display";
    setPanePhase(index, "initializing");
  }
  renderLiveMetrics();
  renderReportQuality();
}

function shortSessionId(sessionId) {
  if (!sessionId) return "pending";
  const realId = String(sessionId).split(":").pop();
  return realId.slice(0, 8);
}

function updateRunLabel() {
  if (!state.run.startedAt) {
    el("runLabel").textContent = "No run yet";
    return;
  }
  const timestamp = new Date(state.run.startedAt).toLocaleString();
  el("runLabel").textContent = `Run ${shortSessionId(
    state.sessions[0]
  )} / ${shortSessionId(state.sessions[1])} | ${timestamp}`;
}

async function start() {
  if (state.starting || state.running || state.stopping || !state.scenesReady)
    return;
  if (!state.quality.initialized) await initQuality();
  state.starting = true;
  state.cancelStart = false;
  state.intentionalStop = false;
  beginRun();
  resetRunState();
  const requestStartedAt = performance.now();
  for (const stats of state.stats) stats.requestStartedAt = requestStartedAt;
  setPickerEnabled(false);
  setStatus("Creating both GPU sessions...");
  syncControls();
  updateRunLabel();

  let currentPane = 0;
  let setupResults = null;
  try {
    setupResults = await Promise.allSettled(
      MODELS.map(async (model, index) => {
        if (state.cancelStart) throw new Error("Start cancelled.");
        state.sessions[index] = await createSession(model);
        if (state.cancelStart) throw new Error("Start cancelled.");
        await openStream(index);
        if (state.cancelStart) throw new Error("Start cancelled.");
        updateRunLabel();
      })
    );
    const failedPane = setupResults.findIndex(
      (result) => result.status === "rejected"
    );
    if (failedPane !== -1) {
      currentPane = failedPane;
      throw setupResults[failedPane].reason;
    }
    if (state.cancelStart) throw new Error("Start cancelled.");

    resetInput();
    state.starting = false;
    state.running = true;
    state.run.phase = "initializing";
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    canvases[0].focus({ preventScroll: true });
    syncControls();
    setStatus("Generating at each model's measured speed.");
    primeComparison();
  } catch (error) {
    state.starting = false;
    state.running = false;
    // The click claimed the pointer optimistically. Give it back rather than
    // trapping the cursor on an error screen.
    if (document.pointerLockElement && document.exitPointerLock)
      document.exitPointerLock();
    if (state.quality.phase === "waiting") {
      setQualityPhase("unavailable", "No paired run was available to score.");
    }
    state.intentionalStop = true;
    await closeAllPanes();
    state.intentionalStop = false;
    if (state.cancelStart) {
      for (let index = 0; index < MODELS.length; index += 1)
        setPanePhase(index, "stopped");
      setPickerEnabled(true);
      syncControls();
      return;
    }
    finishRun("start-error", "error");
    // Both sessions are requested in parallel, so a router-level failure
    // rejects both. Surface every rejection — marking the others "stopped"
    // made a total outage look like one pane misbehaving.
    const failures = Array.isArray(setupResults) ? setupResults : [];
    let shown = 0;
    for (let index = 0; index < MODELS.length; index += 1) {
      const result = failures[index];
      if (result && result.status === "rejected") {
        const reason = result.reason;
        showPaneError(
          index,
          reason instanceof Error ? reason.message : String(reason)
        );
        shown += 1;
      } else if (result) {
        setPanePhase(index, "stopped");
      }
    }
    // Nothing in setupResults means the throw happened before or outside the
    // allSettled — fall back to the old single-pane behaviour.
    if (!shown) {
      const failedPane = Math.min(currentPane, MODELS.length - 1);
      for (let index = 0; index < MODELS.length; index += 1) {
        if (index !== failedPane) setPanePhase(index, "stopped");
      }
      showPaneError(
        failedPane,
        error instanceof Error ? error.message : String(error)
      );
    }
    setPickerEnabled(true);
    syncControls();
  }
}

async function stop({ fromQueue = false, reason = null } = {}) {
  if (
    state.stopping ||
    (!state.running && !state.starting && !state.ws.some(Boolean))
  )
    return;
  const wasRunning = state.running;
  const qualitySessions = [...state.sessions];
  clearQualityPoll();
  state.quality.requestVersion += 1;
  state.quality.jobId = null;
  state.quality.jobMode = null;
  state.stopping = true;
  state.cancelStart = true;
  state.intentionalStop = true;
  state.running = false;
  state.starting = false;
  clearRunCapTimer();
  stopCountdownTicker();
  // Kill the sequential lead timers if we're stopping mid-lead, or the pending
  // beginReplay fires after the run is already gone and the countdown interval
  // keeps writing to the queue bar.
  clearLeadTimer();
  if (state.leadCountdownTimer) {
    window.clearInterval(state.leadCountdownTimer);
    state.leadCountdownTimer = null;
  }
  stopInputPump();
  stopRequestInputPump();
  resetInput();
  for (let index = 0; index < MODELS.length; index += 1) {
    state.expectedClose[index] = true;
    state.renderVersion[index] += 1;
    resetPresentation(index);
    state.pendingFrames[index] = null;
    setPanePrompt(index, "");
    setPanePhase(index, "stopped");
  }
  if (document.pointerLockElement && document.exitPointerLock)
    document.exitPointerLock();
  setStatus(
    state.quality.enabled && wasRunning
      ? "Saving both clips for report scoring..."
      : "Stopping both sessions..."
  );
  syncControls();
  // A run with no frames has nothing to export; submitting one only produces a
  // job that fails and leaves the "did not complete" copy on screen.
  if (wasRunning && hasRunData()) await submitQualityRun(qualitySessions);
  // Scoring runs in the background and the visitor can watch the panel fill in,
  // so drop the spinner rather than implying the run is still wrapping up.
  if (fromQueue && state.quality.jobId) {
    showQueue("Scoring this run. Results appear below.", { state: "info" });
  }
  await closeAllPanes();
  if (!fromQueue) releaseQueue();
  finishRun(reason || (fromQueue ? "queue-evicted" : "stopped"));
  upsertRecentRun();
  setPickerEnabled(true);
  state.cancelStart = false;
  state.intentionalStop = false;
  state.stopping = false;
  setStatus(
    state.quality.enabled && wasRunning
      ? "Generation complete. Quality scoring continues below."
      : "Results ready below."
  );
  if (wasRunning && !fromQueue) {
    showQueue(
      state.quality.jobId
        ? "Generation stopped. Quality scoring continues below."
        : "Generation stopped. Results are ready below.",
      { state: "complete" }
    );
  }
  syncControls();
  renderReportQuality();
  scheduleMetricRender();
}

async function retryPane(index) {
  const retryButton = el(`pane${index}Retry`);
  retryButton.disabled = true;
  try {
    if (state.running || state.starting || state.ws.some(Boolean)) {
      setStatus("Restarting both panes...");
      await stop();
    }
    await start();
  } finally {
    retryButton.disabled = false;
  }
}

function togglePause(index) {
  if (state.panePhase[index] !== "live" && state.panePhase[index] !== "paused")
    return;
  const button = el(`pane${index}Pause`);
  const icon = el(`pane${index}PauseIcon`);
  if (!state.paused[index]) {
    state.paused[index] = true;
    state.stats[index].pauseElapsedMs = state.stats[index].elapsedMs;
    state.renderVersion[index] += 1;
    resetPresentation(index);
    setPanePhase(index, "paused");
    if (PLAY_ICON) icon.src = PLAY_ICON;
    button.setAttribute(
      "aria-label",
      `Resume ${MODEL_META[MODELS[index]].short.toLowerCase()} video display`
    );
    button.title = "Resume live display";
    return;
  }

  state.paused[index] = false;
  setPanePhase(index, "initializing");
  if (PAUSE_ICON) icon.src = PAUSE_ICON;
  button.setAttribute(
    "aria-label",
    `Pause ${MODEL_META[MODELS[index]].short.toLowerCase()} video display`
  );
  button.title = "Pause display";
  const pending = state.pendingFrames[index];
  state.pendingFrames[index] = null;
  if (pending && !isSequential()) {
    void presentImmediateFrame(index, pending, state.renderVersion[index]);
  } else if (pending) {
    queueFrameForRender(index, pending);
  }
}

function formatTimer(milliseconds) {
  const safeMs = Math.max(0, milliseconds || 0);
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const tenths = Math.floor((safeMs % 1000) / 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}.${tenths}`;
}

function formatGeneratedDuration(milliseconds) {
  const safeMs = Math.max(0, milliseconds || 0);
  const totalSeconds = Math.round(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function renderTimers() {
  const now = performance.now();
  for (let index = 0; index < 2; index += 1) {
    const stats = state.stats[index];
    let elapsed = stats.elapsedMs;
    if (state.paused[index]) {
      elapsed = stats.pauseElapsedMs;
    } else if (
      state.panePhase[index] === "live" &&
      stats.lastFrameAt !== null
    ) {
      elapsed += Math.min(400, Math.max(0, now - stats.lastFrameAt));
    }
    const timer = el(`pane${index}Timer`);
    timer.textContent = formatTimer(elapsed);
    timer.dateTime = `PT${(elapsed / 1000).toFixed(1)}S`;
  }
}

// Paint the seed frame preview from the tile's own (Webflow-hosted) image, so
// this doesn't depend on the /scenes endpoint resolving on the page origin.
function previewScene(tile) {
  if (state.running) return;
  const markReady = () => {
    for (let index = 0; index < contexts.length; index += 1) {
      if (state.panePhase[index] !== "ready") setPanePhase(index, "ready");
    }
  };
  const source = tile?.querySelector("img");
  if (!source) {
    markReady();
    return;
  }
  const draw = () => {
    for (let index = 0; index < contexts.length; index += 1) {
      try {
        contexts[index].drawImage(
          source,
          0,
          0,
          canvases[index].width,
          canvases[index].height
        );
      } catch {
        // A cross-origin preview can taint the canvas; the tile art is cosmetic
        // and live frames arrive as same-origin blobs, so ignore draw failures.
      }
      if (state.panePhase[index] !== "ready") setPanePhase(index, "ready");
    }
  };
  if (source.complete && source.naturalWidth) draw();
  else source.addEventListener("load", draw, { once: true });
}

// The four world tiles are authored in Webflow (real AVIF art + srcset), so wire
// the existing buttons instead of rebuilding them. Seeds still key off data-scene.
function bindSceneTiles() {
  const tiles = el("sceneTiles");
  if (!tiles) return;
  const tileButtons = [...tiles.querySelectorAll(".scene-tile")];
  if (!tileButtons.length) return;
  const labelFor = (tile) =>
    tbcPublicText(
      (
        tile.querySelector("span")?.textContent ||
        tile.dataset.scene ||
        "Scene"
      ).trim(),
      "TBC scene"
    );
  const selected =
    tileButtons.find((tile) => tile.classList.contains("selected")) ||
    tileButtons[0];
  state.scene = selected.dataset.scene;
  state.sceneLabel = labelFor(selected);
  for (const tile of tileButtons) {
    tile.setAttribute("aria-pressed", String(tile === selected));
    tile.addEventListener("click", () => {
      if (state.running || state.starting) return;
      const label = labelFor(tile);
      state.scene = tile.dataset.scene;
      state.sceneLabel = label;
      window.tbcTrack("demo_scene_selected", { scene: label });
      for (const other of tileButtons) {
        const isSelected = other === tile;
        other.classList.toggle("selected", isSelected);
        other.setAttribute("aria-pressed", String(isSelected));
      }
      const message = el("sceneMessage");
      if (message) message.textContent = `Starting from ${label}.`;
      previewScene(tile);
    });
  }
  const message = el("sceneMessage");
  if (message) message.textContent = `Starting from ${state.sceneLabel}.`;
}

// Tiles are pre-bound from the DOM; this only reads runtime-config for the
// preview-only notice and gates readiness on the backend responding.
async function setupScenes() {
  if (state.scenesLoading) return;
  state.scenesLoading = true;
  try {
    const response = await fetch(`${API_BASE}/runtime-config`, {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`runtime config failed (${response.status})`);
    const config = await response.json();
    // Backend wins over the Webflow-embedded default when it supplies one.
    const playback = String(config.playback || "").toLowerCase();
    if (
      playback === PLAYBACK.SEQUENTIAL ||
      playback === PLAYBACK.SIMULTANEOUS
    ) {
      state.playback = playback;
      applyPlaybackMode();
    }
    const previewNotice = el("previewNotice");
    if (previewNotice) {
      previewNotice.hidden = config.preview_only !== true;
      if (
        config.preview_only === true &&
        typeof config.preview_notice === "string"
      ) {
        const previewText = el("previewNoticeText");
        if (previewText)
          previewText.textContent = tbcPublicText(config.preview_notice);
      }
    }
    state.scenesReady = true;
    previewScene(el("sceneTiles")?.querySelector(".scene-tile.selected"));
    setStatus("Ready to generate.");
    syncControls();
  } catch (error) {
    state.scenesReady = false;
    const message = el("sceneMessage");
    if (message) {
      message.textContent = tbcPublicText(
        error instanceof Error ? error.message : String(error),
        "TBC starting scenes are unavailable."
      );
    }
    setStatus("Starting scenes are unavailable.");
    syncControls();
  } finally {
    state.scenesLoading = false;
  }
}

function qualityMetric(result, role, key) {
  return finiteNumber(result?.panes?.[role]?.metrics?.[key]);
}

function renderReportQualityRing(result) {
  const summary = el("qualityRingSummary");
  const ring = el("qualityOutcomeRing");
  const status = el("qualityOverviewStatus");
  const displayedRole = result.panes?.optimized ? "optimized" : "base";
  const displayedLabel =
    displayedRole === "optimized" ? "TBC optimized" : "Base";

  const namespace = "http://www.w3.org/2000/svg";
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const segmentSpan = circumference / QUALITY_DIMENSIONS.length;
  const gap = 5;
  const dimensionScores = QUALITY_DIMENSIONS.map((definition) => ({
    ...definition,
    score: qualityMetric(result, displayedRole, definition.key),
    base: qualityMetric(result, "base", definition.key),
    optimized: qualityMetric(result, "optimized", definition.key),
  })).filter((dimension) => Number.isFinite(dimension.score));
  ring.replaceChildren();

  const track = document.createElementNS(namespace, "circle");
  track.setAttribute("class", "quality-ring-track");
  track.setAttribute("cx", "100");
  track.setAttribute("cy", "100");
  track.setAttribute("r", String(radius));
  ring.append(track);

  dimensionScores.forEach((dimension, index) => {
    const score = clamp(dimension.score, 0, 1);
    const fillLength = score * (segmentSpan - gap);
    const segment = document.createElementNS(namespace, "circle");
    segment.setAttribute("class", "quality-ring-segment");
    segment.setAttribute("cx", "100");
    segment.setAttribute("cy", "100");
    segment.setAttribute("r", String(radius));
    segment.setAttribute("transform", `rotate(${-90 + index * 90} 100 100)`);
    segment.setAttribute(
      "stroke-dasharray",
      `${fillLength} ${circumference - fillLength}`
    );
    segment.style.stroke = QUALITY_COLORS[index % QUALITY_COLORS.length];

    const title = document.createElementNS(namespace, "title");
    title.textContent = `${dimension.label}: ${formatQualityScore(
      dimension.score
    )} for the ${displayedLabel} report window.`;
    segment.append(title);
    ring.append(segment);
  });

  const bars = el("qualityCompositeBars");
  const legend = el("qualityRingLegend");
  bars.replaceChildren();
  legend.replaceChildren();
  dimensionScores.forEach((dimension, index) => {
    const color = QUALITY_COLORS[index % QUALITY_COLORS.length];
    const row = document.createElement("div");
    row.className = "quality-composite-row";
    const heading = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = dimension.label;
    const value = document.createElement("strong");
    value.textContent =
      Number.isFinite(dimension.base) && Number.isFinite(dimension.optimized)
        ? `Base ${formatQualityScore(
            dimension.base
          )} | TBC ${formatQualityScore(dimension.optimized)}`
        : `${displayedLabel} ${formatQualityScore(dimension.score)}`;
    heading.append(label, value);
    const bar = document.createElement("div");
    const fill = document.createElement("i");
    fill.style.width = `${clamp(dimension.score * 100, 0, 100)}%`;
    fill.style.background = color;
    bar.append(fill);
    row.append(heading, bar);
    bars.append(row);

    const key = document.createElement("span");
    const dot = document.createElement("i");
    dot.style.background = color;
    key.append(dot, document.createTextNode(dimension.label));
    legend.append(key);
  });

  const displayedScore = qualityMetric(
    result,
    displayedRole,
    "selected_vbench_mean"
  );
  const windowStart = finiteNumber(result.window?.start_frame);
  const windowEnd = finiteNumber(result.window?.end_frame);
  const windowLabel =
    windowStart !== null && windowEnd !== null
      ? `Frames ${windowStart}-${windowEnd}`
      : "The latest scored frame window";
  el("qualityRingValue").textContent = formatQualityScore(displayedScore);
  const valueWrap = el("qualityRingValue")?.closest(".demo_quality_ring_value");
  if (valueWrap) valueWrap.hidden = false;
  el("qualityRingHeadline").textContent = "Post-run quality scored";
  el(
    "qualityRingDetail"
  ).textContent = `${windowLabel} at 20 fps, using the report-selected VBench dimensions.`;
  el("qualityMeasurementBadge").textContent = "Final";
  ring.setAttribute(
    "aria-label",
    `${displayedLabel} selected VBench mean ${formatQualityScore(
      displayedScore
    )}. ${dimensionScores
      .map(
        (dimension) =>
          `${dimension.label} ${formatQualityScore(dimension.score)}`
      )
      .join("; ")}.`
  );
  summary.hidden = false;
  status.hidden = true;
}

function renderReportQualityFacts(result) {
  const baseDispersion = qualityMetric(result, "base", "dispersion");
  const optimizedDispersion = qualityMetric(result, "optimized", "dispersion");
  el("qualityDispersionSummary").textContent =
    Number.isFinite(baseDispersion) || Number.isFinite(optimizedDispersion)
      ? `Base ${formatDispersion(baseDispersion)} / TBC ${formatDispersion(
          optimizedDispersion
        )}`
      : "--";

  const fvd = result?.cohort_metrics?.fvd;
  let fvdCopy = "Awaiting matched runs";
  if (fvd?.status === "complete") {
    fvdCopy = `Base ${formatDispersion(fvd.base)} / TBC ${formatDispersion(
      fvd.optimized
    )} (N=${fvd.n_generated})`;
  } else if (fvd?.status === "collecting") {
    fvdCopy = `${fvd.eligible_runs || 0}/${
      fvd.minimum_runs || 5
    } matched runs collected`;
  } else if (fvd?.message) {
    fvdCopy = fvd.message;
  }
  el("qualityFvdSummary").textContent = fvdCopy;
}

function renderDefaultRing() {
  const svg = el("qualityOutcomeRing");
  if (!svg) return;
  const NS = "http://www.w3.org/2000/svg";
  const track = document.createElementNS(NS, "circle");
  track.setAttribute("class", "quality-ring-track");
  track.setAttribute("cx", "100");
  track.setAttribute("cy", "100");
  track.setAttribute("r", "78");
  svg.replaceChildren(track);
  svg.setAttribute("aria-label", "Quality scoring pending.");
  const value = el("qualityRingValue")?.closest(".demo_quality_ring_value");
  if (value) value.hidden = true;
}

function renderReportQuality() {
  const result = state.quality.result;
  const hasResult = result?.outcome === "complete";
  const summary = el("qualityRingSummary");
  const status = el("qualityOverviewStatus");
  updateLivePanelProvenance();

  if (!hasResult) {
    summary.hidden = false;
    status.hidden = false;
    renderDefaultRing();
    status.textContent =
      state.quality.phase === "error"
        ? "TBC quality scoring did not complete for this run. Run again to retry."
        : state.quality.message;
    el("qualityDispersionSummary").textContent = "--";
    el("qualityFvdSummary").textContent = "Awaiting completed run";
    renderQualityMetric();
    return;
  }

  renderReportQualityRing(result);
  renderReportQualityFacts(result);
  renderQualityMetric();
}

async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE}/healthz`, { cache: "no-store" });
    if (!response.ok)
      throw new Error(`health check failed (${response.status})`);
    const health = await response.json();
    const healthy = finiteNumber(health.healthy_backends);
    const total = finiteNumber(health.total_backends);
    if (health.ok && healthy !== null && total !== null && healthy < total) {
      setSystemStatus(
        "degraded",
        "Status: Degraded",
        `${healthy} of ${total} workers ready`
      );
    } else if (health.ok) {
      setSystemStatus(
        "ready",
        "Status: Ready",
        total === null ? "Live router ready" : `${total} workers ready`
      );
    } else {
      setSystemStatus(
        "unavailable",
        "Status: Warming",
        "No workers are ready yet"
      );
    }
    if (health.ok && !state.scenesReady && !state.running && !state.starting) {
      void setupScenes();
    }
    if (
      !state.stopping &&
      !state.quality.jobId &&
      !state.quality.result &&
      state.quality.phase !== "error"
    ) {
      void initQuality();
    }
  } catch (error) {
    setSystemStatus(
      "unavailable",
      "Status: Unavailable",
      tbcPublicText(
        error instanceof Error ? error.message : String(error),
        "The TBC router health check did not complete."
      )
    );
  }
}

const queueNode = (name) =>
  document.querySelector(`#queueBar [data-queue-el="${name}"]`);

function showQueue(
  message,
  { actionLabel = "", onAction = null, state = "info", data = null } = {}
) {
  const bar = el("queueBar");
  if (!bar) return;
  bar.hidden = false;
  bar.dataset.queueState = state;

  const messageNode = queueNode("message");
  if (messageNode) messageNode.textContent = message;

  if (data) {
    const set = (name, value) => {
      const node = queueNode(name);
      if (node && value !== null && value !== undefined)
        node.textContent = value;
    };
    set("position", data.position);
    set("wait", data.est_wait === undefined ? null : `${data.est_wait}s`);
    set("slots", data.slots);
    set("countdown", data.countdown);
  }

  const action = queueNode("action");
  if (action) {
    if (actionLabel) action.textContent = actionLabel;
    // onclick, not addEventListener — repeat calls would stack handlers
    action.onclick = actionLabel ? onAction : null;
  }
}

function hideQueue() {
  const bar = el("queueBar");
  if (!bar) return;
  bar.hidden = true;
  bar.dataset.queueState = "idle";
}

function onFirstFrame() {
  if (state.runCapTimer === null && state.running) {
    runCountdownStartedAt = performance.now();
    state.runCapTimer = window.setTimeout(() => {
      state.runCapTimer = null;
      if (state.running && !state.stopping) void stop({ reason: "time-cap" });
    }, MAX_RUN_SECONDS * 1000);
  }
  // Start the interactive budget at first frame, not at negotiation, so a slow
  // TTFF doesn't eat the visitor's turn.
  if (
    isSequential() &&
    state.sequentialPhase === "lead" &&
    state.leadTimer === null
  ) {
    state.leadStartedAt = performance.now();
    state.leadTimer = window.setTimeout(
      beginReplay,
      SEQUENTIAL_LEAD_SECONDS * 1000
    );
    state.leadCountdownTimer = window.setInterval(renderSequentialTurnBar, 250);
    renderSequentialTurnBar();
  }
  if (!queueState.enabled || !queueState.admitted || queueState.readySent)
    return;
  queueState.readySent = true;
  queueState.remainingSeconds = queueState.playSeconds;
  try {
    if (queueState.ws) queueState.ws.send(JSON.stringify({ type: "ready" }));
  } catch {
    return;
  }
  hideQueue();
  startCountdownTicker();
  syncControls();
}

function releaseQueue() {
  stopCountdownTicker();
  queueState.requested = false;
  queueState.admitted = false;
  queueState.readySent = false;
  queueState.ending = false;
  queueState.remainingSeconds = null;
  queueState.cid = null;
  const socket = queueState.ws;
  queueState.ws = null;
  try {
    if (socket) socket.close();
  } catch {
    // The queue server may already have released the slot.
  }
  hideQueue();
}

async function handleStopRequest() {
  if (state.stopping) return;
  // First Stop ends the interactive phase and hands over to replay; only the
  // second actually ends the run.
  if (isSequential() && state.sequentialPhase === "lead") {
    beginReplay();
    return;
  }
  if (
    queueState.requested &&
    !state.starting &&
    !state.running &&
    !state.ws.some(Boolean)
  ) {
    releaseQueue();
    setPickerEnabled(true);
    setStatus("Queue request canceled. Ready to generate.");
    syncControls();
    return;
  }
  await stop();
}

function connectQueue() {
  queueState.cid = null;
  queueState.reconnecting = false;
  const ws = new WebSocket(`${WS_BASE}/queue/ws`);
  queueState.ws = ws;
  ws.onmessage = (event) => {
    try {
      void onQueueMessage(JSON.parse(event.data));
    } catch {
      showQueue("The play queue returned an invalid update", {
        state: "error",
        actionLabel: "Reconnect",
        onAction: connectQueue,
      });
    }
  };
  ws.onclose = () => {
    if (queueState.ws !== ws) return;
    if (
      queueState.enabled &&
      queueState.requested &&
      !state.running &&
      !queueState.reconnecting
    ) {
      showQueue("Queue disconnected", {
        state: "error",
        actionLabel: "Reconnect",
        onAction: connectQueue,
      });
    }
  };
}

function requestGeneration() {
  if (
    state.starting ||
    state.running ||
    state.stopping ||
    queueState.requested ||
    !state.scenesReady ||
    !queueState.initialized
  )
    return;
  window.tbcTrack("demo_play_clicked", { scene: state.sceneLabel });
  if (!queueState.enabled) {
    // No queue: nothing to wait for. Reuse the same event so the screen
    // transition has one owner, and let the canvas click create the sessions.
    document.dispatchEvent(
      new CustomEvent("tbc:queue-admitted", { detail: {} })
    );
    restoreIdlePrompts();
    return;
  }
  queueState.requested = true;
  queueState.admitted = false;
  queueState.readySent = false;
  queueState.ending = false;
  queueState.remainingSeconds = null;
  setStatus("Joining the generation queue.");
  showQueue("Joining the generation queue…", { state: "joining" });
  syncControls();
  connectQueue();
}

async function onQueueMessage(message) {
  if (message.type === "disabled") {
    queueState.enabled = false;
    const shouldStart = queueState.requested;
    queueState.requested = false;
    hideQueue();
    syncControls();
    if (shouldStart) await start();
    return;
  }
  if (message.type === "joined") {
    queueState.cid = message.cid;
    showQueue("Joined the play queue", { state: "joined" });
    return;
  }
  if (message.type === "waiting") {
    setStatus("Waiting for an available play slot");
    setPickerEnabled(true);
    showQueue("You're in line", {
      state: "waiting",
      data: {
        position: message.position,
        est_wait: message.est_wait,
        slots: message.slots,
      },
    });
    return;
  }
  if (message.type === "admitted") {
    queueState.playSeconds = message.play_seconds || queueState.playSeconds;
    queueState.remainingSeconds = queueState.playSeconds;
    queueState.admitted = true;
    queueState.readySent = false;
    queueState.ending = false;
    document.dispatchEvent(
      new CustomEvent("tbc:queue-admitted", {
        detail: { playSeconds: queueState.playSeconds },
      })
    );
    // Sessions are created by the canvas click, not here — so no GPU is held
    // while the visitor reads the prompt.
    restoreIdlePrompts();
    showQueue("Your turn. Click either video to start.", { state: "armed" });
    syncControls();
    return;
  }
  if (message.type === "playing") {
    const remaining = finiteNumber(message.remaining);
    if (remaining !== null) queueState.remainingSeconds = remaining;
    if (
      queueState.readySent &&
      remaining !== null &&
      remaining <= QUEUE_STOP_RESERVE_SECONDS &&
      state.running &&
      !queueState.ending
    ) {
      queueState.ending = true;
      showQueue("Finishing this run and submitting report scoring…", {
        state: "wrapping",
      });
      await stop({ fromQueue: true });
      return;
    }
    // Sequential drives the bar locally from phase; the server countdown tracks
    // the whole play budget, not the lead phase, so its text would be wrong.
    if (isSequential()) return;
    return;
  }
  if (message.type === "evicted") {
    queueState.admitted = false;
    queueState.requested = false;
    queueState.readySent = false;
    queueState.ending = false;
    queueState.remainingSeconds = null;
    await stop({ fromQueue: true });
    const queueSocket = queueState.ws;
    queueState.ws = null;
    try {
      if (queueSocket) queueSocket.close();
    } catch {
      // The queue server may already have closed the slot.
    }
    showQueue("Run complete. Results are ready below.", { state: "complete" });
    setStatus("Results ready below.");
    setPickerEnabled(true);
    syncControls();
  }
}

async function initQueue() {
  try {
    const response = await fetch(`${API_BASE}/queue/config`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("queue config unavailable");
    const config = await response.json();
    queueState.enabled = Boolean(config.enabled);
    window.TBC_QUEUE_ENABLED = queueState.enabled;
    queueState.playSeconds = config.play_seconds || queueState.playSeconds;
  } catch {
    queueState.enabled = false;
  }
  queueState.initialized = true;
  syncControls();
  if (queueState.enabled) {
    hideQueue();
    setStatus("Ready to generate.");
  }
}

el("startBtn")?.addEventListener("click", requestGeneration);
el("stopBtn")?.addEventListener("click", () => void handleStopRequest());
el("pane0Pause")?.addEventListener("click", () => togglePause(0));
el("pane1Pause")?.addEventListener("click", () => togglePause(1));
el("pane0Retry")?.addEventListener("click", () => void retryPane(0));
el("pane1Retry")?.addEventListener("click", () => void retryPane(1));

window.addEventListener("beforeunload", () => {
  state.intentionalStop = true;
  clearQualityPoll();
  for (const ws of state.ws) {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    } catch {
      // The page is already unloading.
    }
  }
  try {
    if (queueState.ws) queueState.ws.close();
  } catch {
    // The page is already unloading.
  }
});

// Capture the real Webflow control icons up front so pause/resume can swap
// between them without reaching for /static assets that 404 on this origin.
PAUSE_ICON = el("pane1PauseIcon")?.src || el("pane0PauseIcon")?.src || "";
PLAY_ICON = el("startBtn")?.querySelector("img")?.src || "";

// Prompt copy is authored in Webflow. Capture it before the first run blanks
// the nodes, so resetRunState() can put the exact markup back. innerHTML rather
// than textContent so a Shift+Enter <br> survives the round trip.
const IDLE_PROMPTS = [
  el("pane0Prompt")?.innerHTML || "",
  el("pane1Prompt")?.innerHTML || "",
];

function restoreIdlePrompts() {
  const pane0 = el("pane0Prompt");
  const pane1 = el("pane1Prompt");
  if (pane0) pane0.innerHTML = IDLE_PROMPTS[0];
  if (pane1) pane1.innerHTML = IDLE_PROMPTS[1];
}

window.TBC_RESET_DEMO = async function () {
  if (state.running || state.starting || state.ws.some(Boolean)) {
    await stop();
  }
  clearRunCapTimer();
  stopCountdownTicker();
  releaseQueue();
  state.cancelStart = false;
  state.intentionalStop = false;
  setPickerEnabled(true);
  restoreIdlePrompts();
  syncControls();
};

setupModelPicker();
setupVisualizations();
setupMetricCards();
applyPlaybackMode();
renderRecentRuns();
bindSceneTiles();
for (let index = 0; index < MODELS.length; index += 1) {
  const modelNode = el(`pane${index}Model`);
  if (modelNode) modelNode.textContent = MODEL_META[MODELS[index]].label;
  setPanePhase(index, "ready");
}
syncControls();
renderReportQuality();
void setupScenes();
void checkHealth();
void initQueue();
void initCost();
void initQuality();
window.setInterval(renderTimers, 100);
window.setInterval(() => void checkHealth(), 15000);