// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Счётчики процесса для /api/admin/metrics: число ошибок с момента запуска и
 * время последнего тика планировщика. Синглтон модуля, а не Nest-провайдер:
 * фильтр ошибок и планировщик пишут в него без внедрения зависимостей.
 */
class RuntimeStats {
  readonly startedAt = new Date();
  private errors = 0;
  private lastSchedulerRun: Date | null = null;

  recordError(): void {
    this.errors += 1;
  }

  markSchedulerRun(at: Date = new Date()): void {
    this.lastSchedulerRun = at;
  }

  snapshot(): { startedAt: string; errorsSinceStart: number; lastSchedulerRunAt: string | null } {
    return {
      startedAt: this.startedAt.toISOString(),
      errorsSinceStart: this.errors,
      lastSchedulerRunAt: this.lastSchedulerRun?.toISOString() ?? null,
    };
  }
}

export const runtimeStats = new RuntimeStats();
