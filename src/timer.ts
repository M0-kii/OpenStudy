export class StudyTimer {
  private remaining: number;
  private deadline: number | null = null;

  constructor(minutes: number) {
    this.remaining = minutes * 60_000;
  }

  resume(now: number): void {
    if (this.deadline === null && this.remaining > 0) {
      this.deadline = now + this.remaining;
    }
  }

  pause(now: number): void {
    this.remaining = this.milliseconds(now);
    this.deadline = null;
  }

  milliseconds(now: number): number {
    return this.deadline === null ? this.remaining : Math.max(0, this.deadline - now);
  }
}

export function clockLabel(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
