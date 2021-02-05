import { SteamApi } from "./SteamApi/mod.ts";
import { Offer } from "./SteamApi/requests/IEconService.ts";
import { EconItem } from "./EconItem.ts";
import { SteamID } from "../deps.ts";
import { EConfirmationMethod } from "./enums/EConfirmationMethod.ts";
import { ETradeOfferState } from "./enums/ETradeOfferState.ts";

export class TradeOffer {
  /** The other party in this offer, as a SteamID object */
  readonly partner: SteamID;
  /** The trade offer's unique numeric ID, represented as a string */
  id: string | undefined;
  /** A message, possibly empty, included with the trade offer by its sender */
  message: string | undefined;
  /** A value from the ETradeOfferState enum */
  state: ETradeOfferState;
  /**
   * An array of items to be given from your account should this offer be accepted
   * If this offer has not yet been sent or was just sent, object in this array will not contain classid or instanceid properties, as it would had you loaded a sent offer
   */
  itemsToGive: Array<EconItem>;
  /**
   * An array of items to be given from the other account and received by yours should this offer be accepted
   * If this offer has not yet been sent or was just sent, object in this array will not contain classid or instanceid properties, as it would had you loaded a sent offer
   */
  itemsToReceive: Array<EconItem>;
  /** `true` if this offer was sent by you, `false` if you received it */
  isOurOffer: boolean | undefined;
  /** A Date object representing when the trade offer was sent */
  created: Date | undefined;
  /** A Date object representing when the trade offer was last updated (equal to created if never updated) */
  updated: Date | undefined;
  /** A Date object representing when the trade offer will expire if not acted on */
  expires: Date | undefined;
  /** A numeric trade ID, represented as a string, if the offer was accepted. null otherwise. This value won't be very useful to you. */
  tradeID: string | undefined;
  /** `true` if this trade offer was created automatically from a real-time trade that was committed, `false` if it was explicitly sent as a trade offer */
  fromRealTimeTrade: boolean | undefined;
  /** If this offer needs to be confirmed by you, this is a value from EConfirmationMethod */
  confirmationMethod: EConfirmationMethod;
  escrowEndsAt: Date | undefined;
  /** the token used to create an offer. usually available in user's trade url */
  private token: string | undefined;

  constructor(partner: string | SteamID, token?: string) {
    if (typeof partner === "string") {
      this.partner = new SteamID(partner);
    } else {
      this.partner = partner;
    }

    this.token = token;

    if (
      !this.partner.isValid || !this.partner.isValid() ||
      this.partner.type != SteamID.Type.INDIVIDUAL
    ) {
      throw new Error("Invalid input SteamID " + this.partner);
    }

    this.state = ETradeOfferState.Invalid;
    this.itemsToGive = [];
    this.itemsToReceive = [];
    this.isOurOffer = undefined;
    this.escrowEndsAt = undefined;
    this.confirmationMethod = EConfirmationMethod.None;
  }

  getState() {
    return ETradeOfferState[this.state];
  }

  getConfirmationMethod() {
    return EConfirmationMethod[this.confirmationMethod];
  }

  isGlitched() {
    if (!this.id) {
      // not sent yet
      return false;
    }

    if (this.itemsToGive.length + this.itemsToReceive.length == 0) {
      return true;
    }

    // Is any item missing its name?
    // TODO: Since getting the description is going to be optional, this check should be invalid.
    // if (this.manager._language && this.itemsToGive.concat(this.itemsToReceive).some(item => !item.name)) {
    //   return true;
    // }

    return false;
  }

  async update(data: Offer, options?: UpdateOptions) {
    const {
      getDescriptions = false,
      steamApi = undefined,
      language = undefined,
    } = options ? options : {};
    this.id = data.tradeofferid.toString();
    this.message = data.message;
    this.state = data.trade_offer_state;
    this.itemsToGive = await EconItem.fromList(
      data.items_to_give || [],
      getDescriptions && steamApi && language ? options : undefined,
    );
    this.itemsToReceive = await EconItem.fromList(
      data.items_to_receive || [],
      getDescriptions && steamApi && language ? options : undefined,
    );

    this.isOurOffer = data.is_our_offer;
    this.created = new Date(data.time_created * 1000);
    this.updated = new Date(data.time_updated * 1000);
    this.expires = new Date(data.expiration_time * 1000);
    this.tradeID = data.tradeid?.toString() || undefined;
    this.fromRealTimeTrade = data.from_real_time_trade;
    this.confirmationMethod = data.confirmation_method ||
      EConfirmationMethod.None;
    this.escrowEndsAt = data.escrow_end_date
      ? new Date(data.escrow_end_date * 1000)
      : undefined;
  }

  static async from(data: Offer, options?: UpdateOptions) {
    const offer = new TradeOffer(
      new SteamID("[U:1:" + data.accountid_other + "]"),
    );
    await offer.update(data, options);
  }
}

type UpdateOptions = {
  getDescriptions: boolean;
  steamApi: SteamApi;
  language: string;
};
