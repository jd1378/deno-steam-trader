import { EResult } from "./enums/EResult.ts";

export type SteamErrorOptions = {
  eresult: EResult;
  cause?: string;
  body?: unknown;
};

export class SteamError extends Error {
  eresult?: EResult;
  cause?: string;
  body?: unknown;

  constructor(m: string, options?: SteamErrorOptions) {
    super(m);
    // Set the prototype explicitly.
    Object.setPrototypeOf(this, SteamError.prototype);

    this.eresult = options?.eresult;
    this.cause = options?.cause;
    this.body = options?.body;
  }
}

// deno-lint-ignore no-explicit-any
export function throwIfHasError(body: any) {
  if (!body) {
    throw new Error("Malformed JSON response");
  }

  if (body && body.strError) {
    const error = new SteamError(body.strError);

    const match = body.strError.match(/\((\d+)\)$/);

    if (match) {
      error.eresult = parseInt(match[1], 10);
    }

    if (
      body.strError.match(
        /You cannot trade with .* because they have a trade ban./,
      )
    ) {
      error.cause = "TradeBan";
    }

    if (body.strError.match(/You have logged in from a new device/)) {
      error.cause = "NewDevice";
    }

    if (
      body.strError.match(
        /is not available to trade\. More information will be shown to/,
      )
    ) {
      error.cause = "TargetCannotTrade";
    }

    if (body.strError.match(/sent too many trade offers/)) {
      error.cause = "OfferLimitExceeded";
      error.eresult = EResult.LimitExceeded;
    }

    if (body.strError.match(/unable to contact the game's item server/)) {
      error.cause = "ItemServerUnavailable";
      error.eresult = EResult.ServiceUnavailable;
    }

    throw error;
  }
}
