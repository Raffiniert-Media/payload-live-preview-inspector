import type { ScrollOffset, ScrollTarget } from './pathResolution.js'

export type Camera = {
  /**
   * Heads for `target` from wherever the page is - bending the motion under
   * way instead of stopping it and starting another.
   */
  aim: (target: ScrollTarget) => void
  /** Resolves once the page rests on the current aim, or can't get any closer. */
  arrived: () => Promise<void>
  /**
   * Stops following the aim - the motion under way runs out, nothing new is
   * set. For when the aim no longer says where the reveal is going: a
   * header the page could only partly reach while it was too short, and
   * would chase as the page grows below it, a detour before the field.
   */
  hold: () => void
  /** Whether anything has been aimed at yet. */
  readonly moved: boolean
  /** Resolves once the current aim is at most `px` away (or the page rests). */
  near: (px: number) => Promise<void>
}

/** Frames the page has to hold still on its aim to count as arrived. */
const ARRIVED_FRAMES = 3
/** Frames without any motion, short of the aim, after which the page counts as stuck. */
const STUCK_FRAMES = 8
/**
 * How long an aim is followed after it was given - past arriving, too: the
 * target can still move (a deeper element mounting, content above it
 * rendering), and the page follows instead of waiting to be told again.
 */
const AIM_TIMEOUT_MS = 2500
/** How far the aim has to move before the browser is given the new position. */
const RETARGET_THRESHOLD_PX = 2

/** Input that means the editor is scrolling for themselves. */
const USER_SCROLL_EVENTS = ['keydown', 'touchstart', 'wheel'] as const

let activeCamera: AbortController | undefined

/**
 * One continuous motion through a whole reveal, however many stops it has
 * on the way.
 *
 * The page is moved by the browser's own smooth scrolling, not frame by
 * frame from script. Measured in Chrome, that animation runs off the main
 * thread: through a 300 ms block of the main thread, a smooth scroll went on
 * and covered 1562 px, where a script-driven scroll stands still - and a
 * reveal blocks the main thread all the time, every row it opens renders
 * fields, every rich-text editor starts up. That was the stutter on large,
 * nested pages.
 *
 * A new aim is given to the browser while the page is still moving, and the
 * browser carries the speed over into it (178 → 153 → 124 px per frame, no
 * stop). So the reveal can head for a row's header, open it on arrival and
 * go on to the field as one motion - instead of arriving, halting,
 * starting again.
 *
 * Where the target moves (content above it rendering, a deeper element
 * mounting), the aim follows it frame by frame. The editor's own wheel,
 * touch or key input ends it on the spot.
 */
export const createCamera = ({
  behavior,
  offset,
  signal,
}: {
  behavior: ScrollBehavior
  offset: ScrollOffset
  signal: AbortSignal
}): Camera => {
  // One camera at a time: the previous reveal's stops following its aim.
  activeCamera?.abort()
  const own = new AbortController()
  activeCamera = own
  signal.addEventListener('abort', () => own.abort(), { once: true })

  const instant =
    behavior === 'instant' || window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let target: ScrollTarget | undefined
  let aimedAt = 0
  let issued: number | undefined
  let moved = false
  let frame = 0
  let stillFrames = 0
  let atRest = false
  let holding = false
  let lastY = window.scrollY
  let waiters: { px: number; resolve: () => void }[] = []

  const settleAll = () => {
    for (const waiter of waiters) {
      waiter.resolve()
    }
    waiters = []
  }

  const stop = () => {
    cancelAnimationFrame(frame)
    frame = 0
    target = undefined
    settleAll()
  }

  const letGo = () => own.abort()
  for (const type of USER_SCROLL_EVENTS) {
    window.addEventListener(type, letGo, { passive: true })
  }
  own.signal.addEventListener(
    'abort',
    () => {
      for (const type of USER_SCROLL_EVENTS) {
        window.removeEventListener(type, letGo)
      }
      stop()
    },
    { once: true },
  )

  const desiredTop = (): number | undefined => {
    const el = target && (typeof target === 'function' ? target() : target)
    if (!el) {
      return undefined
    }
    const top = window.scrollY + el.getBoundingClientRect().top - (typeof offset === 'function' ? offset() : offset)
    const max = document.documentElement.scrollHeight - window.innerHeight
    return Math.max(0, Math.min(max, top))
  }

  const tick = () => {
    frame = 0
    if (holding) {
      // Only watching the motion run out.
      const y = window.scrollY
      stillFrames = Math.abs(y - lastY) < 0.5 ? stillFrames + 1 : 0
      lastY = y
      atRest = stillFrames >= ARRIVED_FRAMES
      if (atRest) {
        settleAll()
        return
      }
      frame = requestAnimationFrame(tick)
      return
    }
    const desired = desiredTop()
    if (desired === undefined || own.signal.aborted) {
      stop()
      return
    }

    if (issued === undefined || Math.abs(desired - issued) >= RETARGET_THRESHOLD_PX) {
      window.scrollTo({ behavior: instant ? 'instant' : 'smooth', top: desired })
      issued = desired
    }

    const y = window.scrollY
    stillFrames = Math.abs(y - lastY) < 0.5 ? stillFrames + 1 : 0
    lastY = y
    const remaining = Math.abs(desired - y)

    // Resting: on the aim, or as close as the page lets it get.
    atRest = (remaining < 1 && stillFrames >= ARRIVED_FRAMES) || stillFrames >= STUCK_FRAMES
    waiters = waiters.filter((waiter) => {
      if (atRest || remaining <= waiter.px) {
        waiter.resolve()
        return false
      }
      return true
    })

    if (performance.now() - aimedAt > AIM_TIMEOUT_MS) {
      settleAll()
      return
    }
    frame = requestAnimationFrame(tick)
  }

  const follow = () => {
    if (!frame && !own.signal.aborted) {
      frame = requestAnimationFrame(tick)
    }
  }

  return {
    aim: (next) => {
      if (own.signal.aborted) {
        return
      }
      target = next
      holding = false
      aimedAt = performance.now()
      stillFrames = 0
      atRest = false
      moved = true
      // Checked on the next frame, not now: the aim is often an element
      // that has only just been asked to render.
      follow()
    },
    arrived: () =>
      frame && !atRest ? new Promise((resolve) => waiters.push({ px: -1, resolve })) : Promise.resolve(),
    hold: () => {
      holding = true
      atRest = false
      stillFrames = 0
      follow()
    },
    get moved() {
      return moved
    },
    near: (px) => (frame && !atRest ? new Promise((resolve) => waiters.push({ px, resolve })) : Promise.resolve()),
  }
}
