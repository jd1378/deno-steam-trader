import { EResult } from "./enums/EResult.ts";

export type SteamErrorOptions = {
  eresult: EResult;
  cause: string;
};

export class SteamError extends Error {
  eresult?: EResult;
  cause?: string;

  constructor(m: string, options?: SteamErrorOptions) {
    super(m);
    // Set the prototype explicitly.
    Object.setPrototypeOf(this, SteamError.prototype);

    this.eresult = options?.eresult;
    this.cause = options?.cause;
  }
}
