/** Name of the `performance.measure` entry every reveal leaves behind. */
export const REVEAL_MEASURE_NAME = 'payload-live-preview-inspector:reveal'

export type RevealOutcome = 'aborted' | 'ancestor' | 'exact' | 'not-found'

/** What a finished reveal reports in its measure's `detail`. */
export type RevealMeasureDetail = {
  /** Longest gap between two animation frames in each phase, in milliseconds - what an editor sees as a stutter. */
  longestFrames: Record<string, number>
  outcome: RevealOutcome
  path: string
  /** Milliseconds spent in each phase, in the order they ran. */
  phases: Record<string, number>
}

/**
 * Times one reveal, phase by phase.
 *
 * Every reveal ends as a `performance.measure` entry named
 * `REVEAL_MEASURE_NAME`, so it shows up in the Performance panel's timings
 * track and can be read back with `performance.getEntriesByName()` - which is
 * how the e2e suite holds reveals to a time budget. In development it is also
 * logged, because "it feels slow" is only actionable once it says *where*.
 *
 * It also watches the frames while the reveal runs: a reveal can be quick
 * and still stutter, when the admin renders something heavy in the middle
 * of a scroll. The longest frame per phase says which step did it.
 */
export const createRevealTimer = (path: string) => {
  const startedAt = performance.now()
  let phaseStartedAt = startedAt
  const phases: Record<string, number> = {}
  const longestFrames: Record<string, number> = {}

  let longestFrame = 0
  let lastFrameAt = startedAt
  let frame = requestAnimationFrame(function watch(now) {
    longestFrame = Math.max(longestFrame, now - lastFrameAt)
    lastFrameAt = now
    frame = requestAnimationFrame(watch)
  })

  return {
    end: (outcome: RevealOutcome): void => {
      cancelAnimationFrame(frame)
      const detail: RevealMeasureDetail = { longestFrames, outcome, path, phases }

      try {
        performance.measure(REVEAL_MEASURE_NAME, { detail, start: startedAt })
      } catch {
        // User Timing Level 3 unavailable - the log below still applies.
      }

      if (process.env.NODE_ENV !== 'production') {
        const total = Math.round(performance.now() - startedAt)
        const breakdown = Object.entries(phases)
          .map(([name, ms]) => `${name} ${ms}${longestFrames[name] > 50 ? ` (frame ${longestFrames[name]}!)` : ''}`)
          .join(' / ')
        // eslint-disable-next-line no-console -- intentional dev-only diagnostic
        console.debug(`[payload-live-preview-inspector] reveal "${path}" ${outcome} in ${total}ms (${breakdown})`)
      }
    },
    phase: (name: string): void => {
      const now = performance.now()
      phases[name] = Math.round(now - phaseStartedAt)
      // The gap still open counts too: a frame blocked right now ends in this phase.
      longestFrames[name] = Math.round(Math.max(longestFrame, now - lastFrameAt))
      longestFrame = 0
      phaseStartedAt = now
    },
  }
}
