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

document.addEventListener("DOMContentLoaded", function () {
  lenisScroll();
  externalLinks();
});