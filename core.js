// GLOBAL VARIABLES
const durationBase = 0.8;
const durationSlow = 1.2;
const durationFast = 0.4;
const easeBase = "power4.inOut";
const easeOut = "power4.out";
const easeIn = "power3.in";

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

function lenisScroll() {
  window.lenis = new Lenis({
    lerp: 0.08,
  });

  lenis.on("scroll", ScrollTrigger.update);

  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
  });
  gsap.ticker.lagSmoothing(0);
}

function loader() {
  const logo = document.querySelector('[data-load="logo"]');
  const heading = document.querySelector('[data-load="heading"]');
  const button = document.querySelector('[data-load="blur-up"]');
  const nav = document.querySelector('[data-load="nav"]');
  const bg = document.querySelector('[data-load="fade-in"]');

  const HOME_HEADING_OUT = 1.2;
  const HOME_CARD_IN = 2;

  const homeWrap = document.querySelector('[data-load="home-wrap"]');
  const card = homeWrap
    ? homeWrap.querySelector('[data-load="home-card"]')
    : null;
  const isHome = Boolean(homeWrap && card);

  const targets = [logo, heading, button, nav, bg].filter(Boolean);
  if (!targets.length && !isHome) return;

  if (prefersReducedMotion) {
    gsap.set(targets, { autoAlpha: 1, clearProps: "filter,transform" });
    if (isHome) {
      gsap.set(card, { autoAlpha: 1, filter: "blur(0px)", y: "0rem" });
      if (heading) gsap.set(heading, { autoAlpha: 0 });
    }
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
      onComplete: () => {
        if (isHome && heading) gsap.set(heading, { autoAlpha: 0 });
      },
    });

    // 1. Background fade in
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
        { y: "4rem", autoAlpha: 0, filter: "blur(3px)" },
        {
          y: "0rem",
          autoAlpha: 1,
          filter: "blur(0px)",
          stagger: 0.04,
        },
        0.3
      );
    }

    // 4. Button — up + blur in
    if (button) {
      tl.fromTo(
        button,
        { autoAlpha: 0, y: "4rem", filter: "blur(3px)" },
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
        { autoAlpha: 0, y: "-4rem" },
        { autoAlpha: 1, y: "0rem" },
        0.5
      );
    }

    // 6. Home only — heading exits, card takes its place
    if (isHome) {
      if (words) {
        tl.to(
          words,
          {
            y: "-4rem",
            autoAlpha: 0,
            filter: "blur(3px)",
            stagger: 0.03,
            duration: 0.7,
            ease: "power2.in",
          },
          HOME_HEADING_OUT
        );
      }

      tl.to(
        card,
        {
          autoAlpha: 1,
          filter: "blur(0px)",
          y: "0rem",
          onStart: () => window.dispatchEvent(new Event("hero-card-in")),
        },
        HOME_CARD_IN
      );
    }
  });
}

function navScroll() {
  const nav = document.querySelector('[data-menu="nav"]');
  if (!nav) return;

  const THRESHOLD = 1;

  if (nav.dataset.scriptInitialized) return;
  nav.dataset.scriptInitialized = "true";

  let scrolled = null;
  let frame = null;

  const update = () => {
    frame = null;
    const next = window.scrollY > THRESHOLD;
    if (next === scrolled) return;
    scrolled = next;
    nav.classList.toggle("is-scrolled", next);
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(update);
  };

  update();
  window.addEventListener("scroll", schedule, { passive: true });
}

function externalLinks() {
  const links = document.querySelectorAll('[data-link="external"]');

  if (!links.length) {
    return;
  }

  links.forEach((link) => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });
}

function headingSplit() {
  const headings = gsap.utils.toArray('[data-scroll="heading"] h2');
  if (!headings.length) return;

  if (prefersReducedMotion) {
    gsap.set(headings, { autoAlpha: 1, clearProps: "filter,transform" });
    return;
  }

  document.fonts.ready.then(() => {
    headings.forEach((heading) => {
      if (typeof SplitText === "undefined") {
        gsap.set(heading, { autoAlpha: 1 });
        return;
      }

      heading.setAttribute("aria-label", heading.textContent);
      const split = new SplitText(heading, { type: "words" });
      split.words.forEach((w) => w.setAttribute("aria-hidden", "true"));

      gsap.set(heading, { autoAlpha: 1 });
      gsap.set(split.words, {
        autoAlpha: 0,
        y: "4rem",
        filter: "blur(3px)",
      });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: heading,
          start: "top 85%",
          once: true,
        },
        defaults: { ease: easeOut, duration: 1.2 },
      });

      tl.to(split.words, {
        autoAlpha: 1,
        y: "0rem",
        filter: "blur(0px)",
        stagger: 0.04,
      });
    });

    ScrollTrigger.refresh();
  });
}

function blurUp() {
  const items = gsap.utils.toArray('[data-scroll="blur-up"]');
  if (!items.length) return;

  if (prefersReducedMotion) {
    gsap.set(items, { autoAlpha: 1, clearProps: "filter,transform" });
    return;
  }

  gsap.set(items, { y: "4rem" });

  items.forEach((item) => {
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: item,
        start: "top 80%",
        once: true,
      },
      defaults: { ease: easeOut, duration: 1.2 },
      onComplete: () =>
        gsap.set(item, { clearProps: "filter,transform,willChange" }),
    });

    tl.to(item, { autoAlpha: 1, y: "0rem", filter: "blur(0px)" });
  });
}

function blurRight() {
  const items = gsap.utils.toArray('[data-scroll="blur-right"]');
  if (!items.length) return;

  if (prefersReducedMotion) {
    gsap.set(items, { autoAlpha: 1, clearProps: "filter,transform" });
    return;
  }

  gsap.set(items, { x: "-4rem" });

  items.forEach((item) => {
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: item,
        start: "top 80%",
        once: true,
      },
      defaults: { ease: easeOut, duration: 1.2 },
      onComplete: () =>
        gsap.set(item, { clearProps: "filter,transform,willChange" }),
    });

    tl.to(item, { autoAlpha: 1, x: "0rem", filter: "blur(0px)" });
  });
}

function blurLeft() {
  const items = gsap.utils.toArray('[data-scroll="blur-left"]');
  if (!items.length) return;

  if (prefersReducedMotion) {
    gsap.set(items, { autoAlpha: 1, clearProps: "filter,transform" });
    return;
  }

  gsap.set(items, { x: "4rem" });

  items.forEach((item) => {
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: item,
        start: "top 80%",
        once: true,
      },
      defaults: { ease: easeOut, duration: 1.2 },
      onComplete: () =>
        gsap.set(item, { clearProps: "filter,transform,willChange" }),
    });

    tl.to(item, { autoAlpha: 1, x: "0rem", filter: "blur(0px)" });
  });
}

function scrollIsoProcess() {
  const scope = document.querySelector(".process_iso_vertical");
  if (!scope) return;
  if (prefersReducedMotion) return;

  const paintings = gsap.utils.toArray(":scope > [data-iso-wrap]", scope);
  const arrows = gsap.utils.toArray(":scope > .process_iso_arrow", scope);
  const stack = scope.querySelector(".process_iso_stack");
  const layers = stack ? gsap.utils.toArray("[data-iso-wrap]", stack) : [];

  const sequence = [
    paintings[0],
    arrows[0],
    ...layers,
    arrows[1],
    paintings[1],
  ].filter(Boolean);

  const stagger = 0.15;

  gsap.set(sequence, { autoAlpha: 0, y: "6rem" });

  arrows.forEach((arrow) => {
    const paths = arrow.querySelectorAll("path");
    const len = paths[0].getTotalLength();
    gsap.set(paths[0], { strokeDasharray: len, strokeDashoffset: len });
    gsap.set(paths[1], { autoAlpha: 0, y: -10 });
  });

  function drawArrow(tl, arrow) {
    const at = sequence.indexOf(arrow) * stagger;
    const paths = arrow.querySelectorAll("path");
    tl.to(paths[0], { strokeDashoffset: 0, duration: 0.9 }, at + 0.15);
    tl.to(paths[1], { autoAlpha: 1, y: 0, duration: 0.5 }, at + 0.65);
  }

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: scope,
      start: "top 70%",
      once: true,
    },
    defaults: { ease: "power2.out", duration: 1.2 },
  });

  tl.to(sequence, { autoAlpha: 1, y: "0rem", stagger }, 0);

  arrows.forEach((arrow) => drawArrow(tl, arrow));
}

function trackAnim() {
  const tracks = document.querySelectorAll(".process_iso_track");
  if (!tracks.length) return;

  gsap.fromTo(
    tracks,
    { xPercent: 0 },
    { xPercent: -50, duration: 25, ease: "none", repeat: -1 }
  );
}

function buttonHover() {
  const buttons = document.querySelectorAll('[data-button="wrap"]');
  if (!buttons.length) return;

  buttons.forEach((btn) => {
    const line = btn.querySelector('[data-button="line"]');

    let playing = false;

    btn.addEventListener("mouseenter", () => {
      if (playing) return;
      playing = true;

      const tl = gsap.timeline({
        onComplete: () => {
          playing = false;
        },
      });

      if (line) {
        tl.set(line, { transformOrigin: "right center" }, 0)
          .to(line, { scaleX: 0, duration: 0.3, ease: "power2.in" }, 0)
          .set(line, { transformOrigin: "left center" }, 0.3)
          .to(line, { scaleX: 1, duration: 0.4, ease: "power2.out" }, 0.3);
      }
    });
  });
}

function mobileMenu() {
  const nav = document.querySelector('[data-menu="nav"]');
  if (!nav) return;

  const menu = nav.querySelector(".nav_content");
  const overlay = nav.querySelector(".nav_overlay");
  const button = nav.querySelector('[data-menu="hamburger"]');
  const buttonInner = button.querySelector(".nav_hamburger_inner");
  const links = menu.querySelectorAll('[data-menu="item"]');
  const lineTop = buttonInner.children[0];
  const lineBottom = buttonInner.children[1];

  const BREAKPOINT = "(max-width: 991px)";

  button.setAttribute("type", "button");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", "Open menu");
  if (!menu.id) menu.id = "nav-menu";
  button.setAttribute("aria-controls", menu.id);

  const lockScroll = () => {
    if (window.lenis) window.lenis.stop();
    document.documentElement.classList.add("u-no-scroll");
  };
  const unlockScroll = () => {
    if (window.lenis) window.lenis.start();
    document.documentElement.classList.remove("u-no-scroll");
  };

  const mm = gsap.matchMedia();

  mm.add(
    { isMobile: BREAKPOINT, isReduced: "(prefers-reduced-motion: reduce)" },
    (ctx) => {
      const { isMobile, isReduced } = ctx.conditions;
      if (!isMobile) return;

      const shift =
        (lineBottom.getBoundingClientRect().top -
          lineTop.getBoundingClientRect().top) /
          2 || 6;

      let isOpen = false;
      let lastFocused = null;

      gsap.set(menu, { autoAlpha: 1, x: "100%" });
      gsap.set(overlay, { autoAlpha: 0, pointerEvents: "none" });
      gsap.set(links, { x: "4rem", autoAlpha: 0, filter: "blur(3px)" });

      const tl = gsap.timeline({
        paused: true,
        defaults: { duration: 0.4, easeOut },
        onReverseComplete: () => {
          gsap.set(menu, { display: "none" });
          nav.classList.remove("is-open");
        },
      });

      tl.to(menu, { autoAlpha: 1, x: "0%" }, 0)
        .to(overlay, { autoAlpha: 1 }, 0)
        .to(lineTop, { y: shift, rotate: -45 }, 0)
        .to(lineBottom, { y: -shift, rotate: 45 }, 0)
        .to(
          links,
          {
            x: "0rem",
            autoAlpha: 1,
            filter: "blur(0px)",
            stagger: 0.1,
          },
          0.1
        );

      function open() {
        if (isOpen) return;
        isOpen = true;
        lastFocused = document.activeElement;
        gsap.set(menu, { display: "flex" });
        gsap.set(overlay, { pointerEvents: "auto" });
        nav.classList.add("is-open");
        button.setAttribute("aria-expanded", "true");
        button.setAttribute("aria-label", "Close menu");
        lockScroll();
        tl.timeScale(1).play();
      }

      function close() {
        if (!isOpen) return;
        isOpen = false;
        gsap.set(overlay, { pointerEvents: "none" });
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-label", "Open menu");
        unlockScroll();
        tl.timeScale(1.75).reverse();
        if (lastFocused) lastFocused.focus();
      }

      const onButtonClick = () => (isOpen ? close() : open());
      const onOverlayClick = () => close();

      const onKeydown = (e) => {
        if (!isOpen) return;

        if (e.key === "Escape") {
          e.preventDefault();
          close();
          return;
        }

        if (e.key !== "Tab") return;

        const focusable = [
          button,
          ...menu.querySelectorAll(
            'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
          ),
        ].filter((el) => el.offsetParent !== null);

        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };

      button.addEventListener("click", onButtonClick);
      overlay.addEventListener("click", onOverlayClick);
      document.addEventListener("keydown", onKeydown);

      return () => {
        button.removeEventListener("click", onButtonClick);
        overlay.removeEventListener("click", onOverlayClick);
        document.removeEventListener("keydown", onKeydown);
        nav.classList.remove("is-open");
        button.setAttribute("aria-expanded", "false");
        unlockScroll();
      };
    }
  );

  return () => mm.revert();
}

document.addEventListener("DOMContentLoaded", function () {
  lenisScroll();
  navScroll();
  externalLinks();
  loader();
  headingSplit();
  blurUp();
  blurRight();
  blurLeft();
  scrollIsoProcess();
  trackAnim();

  gsap.matchMedia().add("(width > 991px)", () => {
    buttonHover();
  });

  gsap.matchMedia().add("(max-width: 991px)", () => {
    mobileMenu();
  });
});