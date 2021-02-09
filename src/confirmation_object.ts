import type { EConfirmationType } from "./enums/EConfirmationType.ts";

export type ConfirmationObjectOptions = Omit<ConfirmationObject, "">;

export class ConfirmationObject {
  /** The ID of this confirmation. This is not the same as a trade offer ID. */
  id: string;
  /** What type of thing this confirmation wants to confirm. */
  type: EConfirmationType;
  /** The ID of the thing that created this confirmation (trade offer ID for a trade, market listing ID for a market listing). */
  creator: string;
  /** The key for this confirmation. This is required when confirming or canceling the confirmation.
   *  This is not the same as the TOTP confirmation key. */
  key: string;
  /** The title of this confirmation. */
  title?: string;
  /** A textual description of what you will receive from this confirmation, if this is a trade.
   *  If this is a market listing, then this is a string containing the list price and
   *  then the amount you will receive parenthetically. For example: $115.00 ($100.00) */
  receiving?: string;
  /** A textual description of when this confirmation was created. */
  time: string;
  /** The URL to your trading partner's avatar, if this is a trade.
   *  The URL to the image of the item, if this is a market listing. Otherwise, an empty string. */
  icon?: string;

  constructor(options: ConfirmationObjectOptions) {
    this.id = options.id;
    this.type = options.type;
    this.creator = options.creator;
    this.key = options.key;
    this.title = options.title;
    this.receiving = options.receiving;
    this.time = options.time;
    this.icon = options.icon;
  }
}
