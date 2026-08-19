import { z } from 'zod';

export const habitFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Name your habit').max(80),
    emoji: z.string().trim().max(4).nullable(),
    categoryId: z.string().nullable(),
    type: z.enum(['boolean', 'count', 'duration', 'distance', 'time', 'negative']),
    unit: z.string().trim().max(20).nullable(),
    targetValue: z.number().positive().nullable(),
    scheduleType: z.enum(['daily', 'weekly', 'monthly', 'custom_days', 'every_x_days', 'flexible']),
    scheduleDays: z.array(z.number().int().min(0).max(6)).nullable(),
    scheduleIntervalDays: z.number().int().min(2).max(365).nullable(),
    reminderTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable(),
    reminderAdaptive: z.boolean(),
    goalId: z.string().nullable(),
  })
  .superRefine((values, ctx) => {
    if (values.scheduleType === 'custom_days' && (values.scheduleDays?.length ?? 0) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pick at least one day',
        path: ['scheduleDays'],
      });
    }
    if (values.scheduleType === 'every_x_days' && !values.scheduleIntervalDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Set how many days to wait between repeats',
        path: ['scheduleIntervalDays'],
      });
    }
    if (
      (values.type === 'count' || values.type === 'duration' || values.type === 'distance') &&
      !values.unit
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Give this habit a unit (e.g. glasses, minutes, km)',
        path: ['unit'],
      });
    }
  });

export type HabitFormValues = z.infer<typeof habitFormSchema>;

export const habitFormDefaults: HabitFormValues = {
  name: '',
  emoji: null,
  categoryId: null,
  type: 'boolean',
  unit: null,
  targetValue: null,
  scheduleType: 'daily',
  scheduleDays: null,
  scheduleIntervalDays: null,
  reminderTime: null,
  reminderAdaptive: false,
  goalId: null,
};
