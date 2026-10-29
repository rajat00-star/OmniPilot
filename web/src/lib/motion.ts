import type { Transition, Variants } from "motion/react";

/**
 * The motion system. One set of curves and durations for the whole interface; the CSS tokens
 * (--ease-out, --dur-*) mirror these. Transforms and opacity only, so nothing triggers layout.
 * Reduced motion is handled globally by <MotionConfig reducedMotion="user">.
 */
export const ease = {
  out: [0.16, 1, 0.3, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
};

export const dur = { fast: 0.18, base: 0.32, slow: 0.6, cinematic: 0.9 };

export const enter: Transition = { duration: dur.slow, ease: ease.out };

/** Children reveal in sequence; used for the first-load entrance and each mission section. */
export const sequence = (stagger = 0.07, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

export const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: enter },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: dur.slow, ease: ease.out } },
};

/** Views leave quickly and enter slowly, so the next state is never kept waiting. */
export const view: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: dur.slow, ease: ease.out, staggerChildren: 0.06, delayChildren: 0.05 } },
  exit: { opacity: 0, y: -14, transition: { duration: 0.24, ease: ease.exit } },
};

export const press = { scale: 0.97 };
