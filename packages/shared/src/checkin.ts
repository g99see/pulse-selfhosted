// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod';

/** Шкала 1–5: настроение, энергия, стресс (ТЗ §3.3). */
export const MoodSchema = z.number().int().min(1).max(5);

export const CheckInInputSchema = z.object({
  mood: MoodSchema,
  energy: MoodSchema.optional(),
  stress: MoodSchema.optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).default([]),
  note: z.string().max(2000).optional(),
});

export type CheckInInput = z.infer<typeof CheckInInputSchema>;
export type CheckInInputValues = z.input<typeof CheckInInputSchema>;
