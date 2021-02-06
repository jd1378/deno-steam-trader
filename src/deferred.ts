export default class Deferred<T> implements Promise<T> {
  // deno-lint-ignore ban-types
  private _resolveSelf!: Function;
  // deno-lint-ignore ban-types
  private _rejectSelf!: Function;

  private fate: "resolved" | "unresolved";

  private state: "pending" | "fulfilled" | "rejected";

  private promise: Promise<T>;

  constructor() {
    this.state = "pending";
    this.fate = "unresolved";
    this.promise = new Promise((resolve, reject) => {
      this._resolveSelf = resolve;
      this._rejectSelf = reject;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  finally(_onfinally?: (() => void) | null): Promise<T> {
    throw new Error("Method not implemented.");
  }

  public then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      // deno-lint-ignore no-explicit-any
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected);
  }

  public catch<TResult = never>(
    onrejected?:
      // deno-lint-ignore no-explicit-any
      | ((reason: any) => TResult | PromiseLike<TResult>)
      | undefined
      | null,
  ): Promise<T | TResult> {
    return this.promise.then(onrejected);
  }

  public resolve(val?: T): void {
    this.fate = "resolved";
    this.state = "fulfilled";
    this._resolveSelf(val);
  }

  // deno-lint-ignore no-explicit-any
  public reject(reason?: any): void {
    this.fate = "resolved";
    this.state = "rejected";
    this._rejectSelf(reason);
  }

  isResolved() {
    return this.fate === "resolved";
  }

  isPending() {
    return this.state === "pending";
  }

  isFulfilled() {
    return this.state === "fulfilled";
  }

  isRejected() {
    return this.state === "rejected";
  }

  [Symbol.toStringTag]: "Promise";
}
