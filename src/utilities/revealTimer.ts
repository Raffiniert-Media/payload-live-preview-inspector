/** Name of the `performance.measure` entry every reveal leaves behind. */
export const REVEAL_MEASURE_NAME = 'payload-live-preview-inspector:reveal'

export type RevealOutcome = 'aborted' | 'ancestor' | 'exact' | 'not-found'

/** What a finished reveal reports in its measure's `detail`. */
export type RevealMeasureDetail = {
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
 */
export const createRevealTimer = (path: string) => {
  const startedAt = performance.now()
  let phaseStartedAt = startedAt
  const phases: Record<string, number> = {}

  return {
    end: (outcome: RevealOutcome): void => {
      const detail: RevealMeasureDetail = { outcome, path, phases }

      try {
        performance.measure(REVEAL_MEASURE_NAME, { detail, start: startedAt })
      } catch {
        // User Timing Level 3 unavailable - the log below still applies.
      }

      if (process.env.NODE_ENV !== 'production') {
        const total = Math.round(performance.now() - startedAt)
        const breakdown = Object.entries(phases)
          .map(([name, ms]) => `${name} ${ms}`)
          .join(' / ')
        // eslint-disable-next-line no-console -- intentional dev-only diagnostic
        console.debug(`[payload-live-preview-inspector] reveal "${path}" ${outcome} in ${total}ms (${breakdown})`)
      }
    },
    phase: (name: string): void => {
      const now = performance.now()
      phases[name] = Math.round(now - phaseStartedAt)
      phaseStartedAt = now
    },
  }
}
