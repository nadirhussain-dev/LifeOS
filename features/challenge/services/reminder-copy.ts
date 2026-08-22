/**
 * What the evening reminder actually says, and why it is not always the same
 * sentence.
 *
 * ## The problem this solves
 *
 * The at-risk nudge fires at 20:00 on every unfinished day of a run that can
 * last a year. Under the old copy it produced the identical string three
 * hundred times — "Journal and Water not logged" — and a notification somebody
 * has read three hundred times is not a notification, it is a shape in the
 * shade. The first one is read, the tenth is dismissed from the lock screen,
 * and the fiftieth is the one that gets the whole category switched off, which
 * costs the 22:00 last call as well.
 *
 * ## What varies, and what does not
 *
 * **The facts never vary.** Which modules are outstanding, and what missing
 * them costs, are stated every time and stated exactly — that is the part
 * somebody can act on in fifteen seconds, and it is the reason this reminder
 * outperforms a generic "your streak is at risk". Only the *framing* rotates.
 *
 * Rotation is keyed off the local day rather than a random number, so:
 *
 *   * the message is stable within a day — a resync at 18:00 and another at
 *     19:40 rebuild the same notification rather than two different ones, which
 *     matters because this is cancelled and rescheduled on every write;
 *   * it is testable, with no clock and no seed to inject.
 *
 * ## The one branch that is not framing
 *
 * A rung within a few days is a different *fact*, not a different phrasing, and
 * it outranks everything else here. "Two days to Ember" is the most motivating
 * true sentence available on those two days, and it is invisible the rest of
 * the time — which is exactly what stops it wearing out.
 */

/** How close a rung has to be before it becomes the headline. */
export const RUNG_HORIZON_DAYS = 3;

/** How many phrasings each rotating bucket has. Keys are `…0` … `…N-1`. */
export const VARIANTS = 4;

export type ReminderInput = {
  /** Modules still outstanding today, already translated and joined. */
  modules: string;
  /**
   * What missing today costs in days, or null when no honest number exists —
   * a held shield, or a ladder the server has not sent. `costOfMissToday`
   * already returns null rather than zero for exactly this reason.
   */
  cost: number | null;
  shields: number;
  qualifiedDays: number;
  /** Days until the next rung, and its name. Null when there is no rung ahead. */
  daysToRung: number | null;
  rungName: string | null;
  /** The local day, `YYYY-MM-DD`. The rotation's only input. */
  localDay: string;
};

export type ReminderCopy = {
  /** i18n key for the title. */
  titleKey: string;
  /** i18n key for the body. */
  bodyKey: string;
  /** Interpolation values for whichever key was chosen. */
  values: Record<string, string | number>;
};

/**
 * A stable index in `[0, VARIANTS)` derived from the date.
 *
 * A digit sum rather than a hash: the input is a date string, the output needs
 * only to change from one day to the next and be the same for everybody's
 * Tuesday, and a real hash here would be a dependency and a paragraph
 * explaining why it was worth one.
 */
export function variantFor(localDay: string, variants = VARIANTS): number {
  let sum = 0;
  for (const character of localDay) {
    const digit = character.charCodeAt(0) - 48;
    if (digit >= 0 && digit <= 9) sum += digit;
  }
  return sum % variants;
}

/**
 * Picks the reminder to send.
 *
 * Ordered most-specific first. Each branch answers a different question, and
 * the order is the order somebody would want them answered:
 *
 *   1. A rung is nearly here. The only branch that offers a reason to act
 *      rather than a consequence of not acting.
 *   2. Missing tonight costs days. Concrete, and the strongest of the three
 *      loss framings — it is the only one carrying a number.
 *   3. A shield will absorb it. Honest about the fact that tonight is not
 *      fatal, because a warning somebody knows is overstated is a warning they
 *      stop reading.
 *   4. Nothing else true to say. Names the work and rotates the framing.
 */
export function reminderCopyFor(input: ReminderInput): ReminderCopy {
  const variant = variantFor(input.localDay);
  const titleKey = `challenge.nudgeTitle.${variant}`;

  if (input.daysToRung !== null && input.daysToRung > 0 && input.daysToRung <= RUNG_HORIZON_DAYS) {
    /*
     * The name is optional, and its absence changes the sentence rather than
     * cancelling it. A cold start that has the thresholds but has never opened
     * the ladder still knows a rung is two days away, and that is most of the
     * value; naming it is the rest. Interpolating an empty name would produce
     * "2 days to " — the failure this branch exists to avoid.
     */
    return input.rungName
      ? {
          titleKey,
          bodyKey: 'challenge.reminderNearRung',
          values: { count: input.daysToRung, name: input.rungName, modules: input.modules },
        }
      : {
          titleKey,
          bodyKey: 'challenge.reminderNearRungPlain',
          values: { count: input.daysToRung, modules: input.modules },
        };
  }

  if (input.cost !== null) {
    return {
      titleKey,
      bodyKey: 'challenge.reminderCost',
      values: {
        modules: input.modules,
        count: input.cost,
        from: input.qualifiedDays,
        to: input.qualifiedDays - input.cost,
      },
    };
  }

  if (input.shields > 0) {
    return { titleKey, bodyKey: 'challenge.reminderShielded', values: { modules: input.modules } };
  }

  return {
    titleKey,
    bodyKey: `challenge.nudgeBody.${variant}`,
    values: { modules: input.modules, count: input.qualifiedDays },
  };
}
