import { TradeManager } from "./trade_manager.ts";
import { SteamError, throwIfHasError } from "./steam_error.ts";
import { SteamApi } from "./SteamApi/mod.ts";
import {
  CancelTradeOffer,
  DeclineTradeOffer,
  GetTradeOffer,
  Offer,
} from "./SteamApi/requests/IEconService.ts";
import { EconItem, FromOfferItemOptions } from "./EconItem.ts";
import { SteamID } from "../deps.ts";
import { EConfirmationMethod } from "./enums/EConfirmationMethod.ts";
import { ETradeOfferState } from "./enums/ETradeOfferState.ts";
import { ServiceRequest } from "./SteamApi/requests/ServiceRequest.ts";

export class TradeOffer {
  manager: TradeManager;
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
  countering?: string;
  /** the token used to create an offer. usually available in user's trade url */
  private _token: string | undefined;

  public get token() {
    return this._token;
  }

  constructor(
    manager: TradeManager,
    partner: string | SteamID,
    token?: string,
  ) {
    this.manager = manager;

    if (typeof partner === "string") {
      this.partner = new SteamID(partner);
    } else {
      this.partner = partner;
    }

    this._token = token;

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

  containsItem(item: EconItem) {
    function containPredicate(_item: EconItem) {
      return _item.appid === item.appid && _item.assetid === item.assetid &&
        _item.contextid === item.contextid;
    }
    return this.itemsToGive.some(containPredicate) ||
      this.itemsToReceive.some(containPredicate);
  }

  setMessage(msg: string) {
    if (this.id) {
      throw new Error("Cannot set message in an already-sent offer");
    }

    this.message = msg.toString().substring(0, 128);
  }

  setToken(token: string) {
    if (this.id) {
      throw new Error("Cannot set token in an already-sent offer");
    }

    this._token = token;
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

  /** do not use this method to update an offer. it is used internally. */
  private async _update(data: Offer) {
    this.id = data.tradeofferid.toString();
    this.message = data.message;
    this.state = data.trade_offer_state;
    const fromOfferItemOptions: FromOfferItemOptions = {
      getDescriptions: this.manager.getDescriptions,
      language: this.manager.languageName,
      steamApi: this.manager.steamApi,
    };

    this.itemsToGive = await EconItem.fromList(
      data.items_to_give || [],
      fromOfferItemOptions,
    );
    this.itemsToReceive = await EconItem.fromList(
      data.items_to_receive || [],
      fromOfferItemOptions,
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

  static async from(
    manager: TradeManager,
    data: Offer,
  ) {
    const offer = new TradeOffer(
      manager,
      new SteamID("[U:1:" + data.accountid_other + "]"),
    );
    await offer._update(data);
  }

  async send(): Promise<ETradeOfferState> {
    if (this.id) {
      throw new Error("This offer has already been sent");
    }

    if (this.itemsToGive.length + this.itemsToReceive.length == 0) {
      throw new Error("Cannot send an empty trade offer");
    }

    // TODO make sure trade offer add item requires these 4 params.
    function itemMapper(item: EconItem) {
      return {
        "appid": item.appid,
        "contextid": item.contextid,
        "amount": item.amount || 1,
        "assetid": item.assetid,
      };
    }

    const offerdata = {
      "newversion": true,
      "version": this.itemsToGive.length + this.itemsToReceive.length + 1,
      "me": {
        "assets": this.itemsToGive.map(itemMapper),
        "currency": [], // TODO unknown
        "ready": false,
      },
      "them": {
        "assets": this.itemsToReceive.map(itemMapper),
        "currency": [],
        "ready": false,
      },
    };

    const offerCreateParams: Record<string, string> = {};

    if (this.token) {
      offerCreateParams.trade_offer_access_token = this.token;
    }
    let response;
    try {
      this.manager.pendingSendOffersCount++;

      response = await this.manager.steamCommunity.fetch(
        "https://steamcommunity.com/tradeoffer/new/send",
        {
          headers: {
            "referer": `https://steamcommunity.com/tradeoffer/${(this.id ||
              "new")}/?partner=${this.partner.accountid}` +
              (this.token ? "&token=" + this.token : ""),
          },
          form: {
            "sessionid": this.manager.steamCommunity.getSessionID(),
            "serverid": "1",
            "partner": this.partner.toString(),
            "tradeoffermessage": this.message || "",
            "json_tradeoffer": JSON.stringify(offerdata),
            "captcha": "",
            "trade_offer_create_params": JSON.stringify(offerCreateParams),
            "tradeofferid_countered": this.countering ? this.countering : "",
          },
        },
      );
    } finally {
      this.manager.pendingSendOffersCount--;
    }

    const body = await response.json();

    if (response.status !== 200) {
      if (response.status == 401) {
        // this.steamCommunity.login();
        throw new Error("Not Logged In");
      }

      throw new Error("HTTP error " + response.status);
    }

    throwIfHasError(body);

    if (body && body.tradeofferid) {
      this.id = body.tradeofferid as string;
      this.state = ETradeOfferState.Active;
      this.created = new Date();
      this.updated = new Date();
      this.expires = new Date(Date.now() + 1209600000); // 2 weeks

      // poll data will be saved on next poll if saving method is defined and polling is started
      this.manager.dataPoller.pollData.sent[this.id] = this.state;
    }

    if (body && body.needs_email_confirmation) {
      this.state = ETradeOfferState.CreatedNeedsConfirmation;
      this.confirmationMethod = EConfirmationMethod.Email;
    }

    if (body && body.needs_mobile_confirmation) {
      this.state = ETradeOfferState.CreatedNeedsConfirmation;
      this.confirmationMethod = EConfirmationMethod.MobileApp;
    }

    if (body && this.state == ETradeOfferState.CreatedNeedsConfirmation) {
      return ETradeOfferState.CreatedNeedsConfirmation;
    } else if (body && body.tradeofferid) {
      return ETradeOfferState.Active;
    } else {
      throw new Error("Unknown response");
    }
  }

  async decline() {
    if (!this.id) {
      throw new Error("Cannot cancel or decline an unsent offer");
    }

    if (
      this.state !== ETradeOfferState.Active &&
      this.state !== ETradeOfferState.CreatedNeedsConfirmation
    ) {
      throw new Error(
        `Offer #${this.id} is not active, so it may not be cancelled or declined`,
      );
    }

    let serviceRequest: ServiceRequest;
    if (this.isOurOffer) {
      serviceRequest = new CancelTradeOffer(this.id);
    } else {
      serviceRequest = new DeclineTradeOffer(this.id);
    }
    await this.manager.steamApi.fetch(serviceRequest);

    this.state = this.isOurOffer
      ? ETradeOfferState.Canceled
      : ETradeOfferState.Declined;
    this.updated = new Date();
    this.manager.dataPoller.doPoll();
  }

  /** alias for decline() */
  cancel() {
    return this.decline();
  }

  async accept(
    skipStateUpdate = false,
  ): Promise<"accepted" | "pending" | "escrow" | string> {
    if (!this.id) {
      throw new Error("Cannot accept an unsent offer");
    }

    if (this.state !== ETradeOfferState.Active) {
      throw new Error(
        `Offer #${this.id} is not active, so it may not be accepted`,
      );
    }

    if (this.isOurOffer) {
      throw new Error(`Cannot accept our own offer #${this.id}`);
    }

    const response = await this.manager.steamCommunity.fetch(
      `https://steamcommunity.com/tradeoffer/${this.id}/accept`,
      {
        headers: {
          "Referer": `https://steamcommunity.com/tradeoffer/${this.id}/`,
        },
        form: {
          "sessionid": this.manager.steamCommunity.getSessionID(),
          "serverid": "1",
          "tradeofferid": this.id,
          "partner": this.partner.toString(),
          "captcha": "",
        },
      },
    );

    const body = await response.json();

    if (response.status !== 200) {
      if (response.status == 403) {
        // TODO
        // SESSION EXPIRED:
        // this.manager.steamCommunity.login();
        throw new Error("Not Logged In");
      } else {
        throw new SteamError("HTTP error " + response.status, {
          eresult: body?.eresult || -1,
          body: body,
        });
      }
    }

    throwIfHasError(body);

    this.manager.dataPoller.doPoll();

    if (body.tradeid) {
      this.tradeID = body.tradeid;
    }

    if (body?.needs_email_confirmation) {
      this.confirmationMethod = EConfirmationMethod.Email;
    }

    if (body?.needs_mobile_confirmation) {
      this.confirmationMethod = EConfirmationMethod.MobileApp;
    }

    if (!skipStateUpdate) {
      await this.update();

      if (
        this.confirmationMethod !== undefined &&
        this.confirmationMethod !== EConfirmationMethod.None
      ) {
        return "pending";
        // deno-lint-ignore ban-ts-comment
        //@ts-ignore
      } else if (this.state === ETradeOfferState.InEscrow) {
        return "escrow";
        // deno-lint-ignore ban-ts-comment
        //@ts-ignore
      } else if (this.state === ETradeOfferState.Accepted) {
        return "accepted";
      } else {
        return "unknown state " + this.state;
      }
    }

    if (body?.needs_email_confirmation || body?.needs_mobile_confirmation) {
      return "pending";
    } else {
      return "accepted";
    }
  }

  async update() {
    if (!this.id) throw new Error("Cannot update an unsent offer");
    try {
      const body = await this.manager.steamApi.fetch(
        new GetTradeOffer(this.id),
      );
      // the check is done inside the Service Request.
      this._update(body!.response!.offer!);
    } catch (err) {
      throw new Error("Cannot load new trade data: " + err.message);
    }
  }
}
