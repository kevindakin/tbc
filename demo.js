const shell = document.getElementById("experience");
let isTransitioning = false;

const SCREEN_ORDER = ["intro", "select", "run"];

function screenView(name) {
  return document.querySelector(`[data-screen-view="${name}"]`);
}

function remeasure() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Native scroll first: Lenis ignores scrollTo while stopped, which is
      // exactly the case when the tutorial is open over the run screen.
      window.scrollTo(0, 0);
      if (window.lenis) {
        // Resize before scrolling — the select screen is taller than the run
        // screen now, so Lenis needs the new document height first.
        window.lenis.resize();
        window.lenis.scrollTo(0, { immediate: true, force: true });
      }
    });
  });
}

// The header swap (h1 <-> model name, and the description) is handled purely in
// CSS off #experience[data-screen]. Nothing to do here.

function goToScreen(name) {
  if (!shell || isTransitioning || shell.dataset.screen === name) return;

  const fromName = shell.dataset.screen;
  const current = screenView(fromName);
  const next = screenView(name);
  if (!next) return;

  const forward = SCREEN_ORDER.indexOf(name) > SCREEN_ORDER.indexOf(fromName);

  // Accessibility: swap instantly, skip the tweens.
  if (prefersReducedMotion) {
    shell.dataset.screen = name;
    remeasure();
    // setGradientPlaying(name !== "run");
    return;
  }

  isTransitioning = true;

  const items = next.querySelectorAll('[data-transition="blur-up"]');

  const tl = gsap.timeline({
    defaults: { overwrite: "auto" },
    onComplete: () => {
      isTransitioning = false;
      // setGradientPlaying(name !== "run");
    },
  });

  // 1. Blur the current screen out.
  if (current) {
    tl.to(current, {
      autoAlpha: 0,
      y: "-4rem",
      filter: "blur(3px)",
      duration: durationBase,
      ease: easeIn,
    });
  }

  // 2. Prime incoming elements while the screen is still display:none.
  //    Container becomes visible; the children carry the actual reveal.
  tl.set(next, { autoAlpha: 1 });
  if (items.length) {
    tl.set(items, { autoAlpha: 0, y: "4rem", filter: "blur(3px)" });
  }

  // 3. Flip the attribute (CSS swaps which screen is display:flex, and which
  //    header variant shows), reset scroll/Lenis, and clear the outgoing
  //    screen's inline styles.
  tl.add(() => {
    shell.dataset.screen = name;
    remeasure();
    if (current) gsap.set(current, { clearProps: "all" });
  });

  tl.addLabel("reveal");

  // 4. Incoming elements blur up. Forward = staggered; back = 0 stagger.
  if (items.length) {
    tl.to(
      items,
      {
        autoAlpha: 1,
        y: "0rem",
        filter: "blur(0px)",
        duration: durationBase,
        ease: easeOut,
        stagger: forward ? 0.1 : 0,
      },
      "reveal"
    );
  }

  return tl;
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-screen-go]");
  if (!trigger) return;
  goToScreen(trigger.dataset.screenGo);
});

function loader() {
  const first = screenView(shell?.dataset.screen);
  if (!first) return;

  remeasure();

  const logo = document.querySelector('[data-demo-load="logo"]');
  const heading = document.querySelector('[data-demo-load="heading"]');
  const button = document.querySelector('[data-demo-load="blur-up"]');
  const nav = document.querySelector('[data-demo-load="nav"]');
  const bg = document.querySelector('[data-demo-load="fade-in"]');
  const targets = [logo, heading, button, nav, bg].filter(Boolean);

  if (prefersReducedMotion) {
    gsap.set(targets, { autoAlpha: 1, clearProps: "filter,transform" });
    return;
  }

  document.fonts.ready.then(() => {
    let split = null;
    let words = null;

    if (heading && typeof SplitText !== "undefined") {
      heading.setAttribute("aria-label", heading.textContent);
      split = new SplitText(heading, { type: "words" });
      split.words.forEach((w) => w.setAttribute("aria-hidden", "true"));
      words = split.words;
      gsap.set(heading, { autoAlpha: 1 });
    }

    const tl = gsap.timeline({
      defaults: {
        ease: easeOut,
        duration: 1.4,
      },
    });

    // 1. Canvas fade in
    if (bg) {
      tl.fromTo(bg, { autoAlpha: 0 }, { autoAlpha: 1, duration: 3 }, 0.2);
    }

    // 2. Logo — blur + scale in
    if (logo) {
      tl.fromTo(
        logo,
        { autoAlpha: 0, scale: 1.1, filter: "blur(12px)" },
        { autoAlpha: 1, scale: 1, filter: "blur(0px)" },
        0
      );
    }

    // 3. Heading — words rise + blur in, staggered
    if (words) {
      tl.fromTo(
        words,
        { y: "1.5rem", autoAlpha: 0, filter: "blur(3px)" },
        {
          y: "0rem",
          autoAlpha: 1,
          filter: "blur(0px)",
          stagger: 0.03,
        },
        0.3
      );
    }

    // 4. Button — up + blur in
    if (button) {
      tl.fromTo(
        button,
        { autoAlpha: 0, y: "1.5rem", filter: "blur(3px)" },
        {
          autoAlpha: 1,
          y: "0rem",
          filter: "blur(0px)",
        },
        0.7
      );
    }

    // 5. Top bar — subtle drop + fade
    if (nav) {
      tl.fromTo(
        nav,
        { autoAlpha: 0, y: "-1rem" },
        { autoAlpha: 1, y: "0rem" },
        0.5
      );
    }
  });
}

function iconHover() {
  const btn = document.querySelector(".demo_top_icon_btn");
  if (!btn) return;

  const outer = btn.querySelector("#iconOuter");
  const inner = btn.querySelector("#iconInner");
  if (!outer || !inner) return;

  gsap.set([outer, inner], { transformOrigin: "50% 50%" });

  const tl = gsap.timeline({
    defaults: { duration: 1.5, ease: "expo.inOut" },
    paused: true,
  });

  tl.fromTo(outer, { rotation: 0 }, { rotation: 90 }, 0).fromTo(
    inner,
    { rotation: 0 },
    { rotation: -90 },
    0
  );

  btn.addEventListener("mouseenter", () => tl.restart());
}

function introButton() {
  const btn = document.querySelector(".demo_intro_btn");
  if (!btn) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const glow = document.createElement("span");
  glow.className = "demo_btn_glow";
  btn.prepend(glow);
  gsap.set(glow, { xPercent: -50, yPercent: -50 });

  const moveX = gsap.quickTo(glow, "x", { duration: 0.4, ease: "power3" });
  const moveY = gsap.quickTo(glow, "y", { duration: 0.4, ease: "power3" });

  btn.addEventListener("mouseenter", (e) => {
    const r = btn.getBoundingClientRect();
    gsap.set(glow, { x: e.clientX - r.left, y: e.clientY - r.top });
    gsap.to(glow, {
      opacity: 1,
      duration: 0.6,
      ease: "power4.out",
      overwrite: "auto",
    });
  });

  btn.addEventListener("mousemove", (e) => {
    const r = btn.getBoundingClientRect();
    moveX(e.clientX - r.left);
    moveY(e.clientY - r.top);
  });

  btn.addEventListener("mouseleave", () => {
    gsap.to(glow, {
      opacity: 0,
      duration: 0.6,
      ease: "power4.out",
      overwrite: "auto",
    });
  });
}

function sceneTileIndicator() {
  var container = document.getElementById("sceneTiles");
  if (!container || !window.gsap) return;

  var wrap = container.closest(".demo_select_tiles_wrap") || container;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DURATION = reduce ? 0 : durationBase;
  var EASE = "power4.out";

  // adopt the Webflow-authored span, or build one
  var indicator = wrap.querySelector(".scene-tile-indicator");
  if (!indicator) {
    indicator = document.createElement("span");
    indicator.className = "scene-tile-indicator";
    wrap.appendChild(indicator);
  }
  indicator.setAttribute("aria-hidden", "true");
  wrap.classList.add("has-indicator");

  var hovered = null;
  var placed = false;

  function selectedTile() {
    return (
      container.querySelector(".scene-tile.selected") ||
      container.querySelector(".scene-tile")
    );
  }

  function target() {
    return hovered && !hovered.disabled ? hovered : selectedTile();
  }

  function rectFor(tile) {
    var img = tile && tile.querySelector("img");
    if (!img) return null;
    var a = img.getBoundingClientRect();
    if (!a.width) return null; // screen hidden, or image not laid out yet
    var b = wrap.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, width: a.width };
  }

  // height is never set here — CSS aspect-ratio derives it from width
  function apply(tile, animate) {
    var r = rectFor(tile);
    if (!r) return;
    if (animate && placed) {
      gsap.to(indicator, {
        x: r.x,
        y: r.y,
        duration: DURATION,
        ease: EASE,
        overwrite: true,
      });
    } else {
      gsap.set(indicator, { x: r.x, y: r.y, width: r.width, opacity: 1 });
      placed = true;
    }
  }

  function slide() {
    apply(target(), true);
  } // hover, focus, selection change
  function snap() {
    apply(target(), false);
  } // resize, reveal, first placement

  // hover — delegated, so it survives tiles being rebuilt
  container.addEventListener("pointerover", function (e) {
    var tile = e.target.closest(".scene-tile");
    if (!tile || tile === hovered || tile.disabled) return;
    hovered = tile;
    slide();
  });

  container.addEventListener("pointerleave", function () {
    hovered = null;
    slide();
  });

  // keyboard parity
  container.addEventListener("focusin", function (e) {
    var tile = e.target.closest(".scene-tile");
    if (tile && !tile.disabled && tile.matches(":focus-visible")) {
      hovered = tile;
      slide();
    }
  });

  container.addEventListener("focusout", function () {
    if (!container.matches(":hover")) {
      hovered = null;
      slide();
    }
  });

  // track selection without touching pair.js's click handler
  new MutationObserver(function () {
    if (hovered && !container.contains(hovered)) hovered = null;
    slide();
  }).observe(container, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-pressed", "disabled"],
  });

  // fires on viewport resize and on the screen being revealed (0 → real size)
  if ("ResizeObserver" in window) {
    new ResizeObserver(snap).observe(wrap);
  } else {
    window.addEventListener("resize", snap);
  }
  window.addEventListener("load", snap);

  // manual hook, in case you need to re-pin after a screen transition
  window.sceneTileIndicator = { refresh: snap };

  snap();
}

document.addEventListener("DOMContentLoaded", function () {
  loader();
  iconHover();
  introButton();
  sceneTileIndicator();
});