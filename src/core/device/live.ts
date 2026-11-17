// Sends one value at a time. A push while a send is in flight waits, and only the newest waiting value is sent next.

export class Latest<T> {
  private readonly send: (v: T) => Promise<void>;
  private readonly onError: (e: unknown) => void;
  private busy = false;
  private waiting: { v: T } | null = null;

  constructor(send: (v: T) => Promise<void>, onError: (e: unknown) => void) {
    this.send = send;
    this.onError = onError;
  }

  push(v: T): void {
    if (this.busy) {
      this.waiting = { v };
      return;
    }
    this.go(v);
  }

  private go(v: T): void {
    this.busy = true;
    this.send(v).then(
      () => this.done(),
      (e) => {
        this.onError(e);
        this.done();
      },
    );
  }

  private done(): void {
    this.busy = false;
    const next = this.waiting;
    this.waiting = null;
    if (next) this.go(next.v);
  }
}
