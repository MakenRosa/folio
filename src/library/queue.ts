// A queue that does one job at a time, in the background, and steps aside when asked. It knows
// nothing about PDFs: `work` does the job for an id. Pure scheduling, so it can be tested alone.
//
// - An id is taken once per session, whatever happens to it: a job that fails is not tried again.
// - `pause()` stops what is running and holds the rest. The job that was cut short goes back to
//   the front of the line and is not counted as a failure.
// - `resume()` starts again after a short delay, so that leaving and entering a screen in quick
//   succession does not start work that is stopped a moment later.
export type QueueWork = (id: string, signal: AbortSignal) => Promise<void>;

export class WorkQueue {
  private waiting: string[] = [];
  private seen = new Set<string>();
  private control: AbortController | null = null;
  private running = false;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private work: QueueWork;
  private delay: number;

  constructor(work: QueueWork, delay = 300) {
    this.work = work;
    this.delay = delay;
  }

  // Adds ids that were not taken before. Work starts at once, unless the queue is paused.
  add(ids: Iterable<string>) {
    for (const id of ids) {
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      this.waiting.push(id);
    }
    this.start();
  }

  pause() {
    this.paused = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.control?.abort();
  }

  resume() {
    this.paused = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.start();
    }, this.delay);
  }

  private start() {
    if (this.running || this.paused || this.timer !== undefined || !this.waiting.length) return;
    void this.run();
  }

  private async run() {
    this.running = true;
    try {
      while (!this.paused && this.waiting.length) {
        const id = this.waiting.shift()!;
        const control = (this.control = new AbortController());
        try {
          await this.work(id, control.signal);
        } catch {
          // Cut short by a pause: its turn comes again. Anything else is given up, in silence.
          if (control.signal.aborted) this.waiting.unshift(id);
        }
        this.control = null;
      }
    } finally {
      this.running = false;
    }
  }
}
