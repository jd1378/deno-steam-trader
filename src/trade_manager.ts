import { SteamError } from "./steam_error.ts";
import { EconItem } from "./EconItem.ts";
import { DataPoller, DataPollerOptions, PollData } from "./data_poller.ts";
import { SteamApi } from "./SteamApi/mod.ts";
import {
  LoginOptions,
  SteamCommunity,
  SteamCommunityOptions,
} from "./steam_community.ts";
import { EventEmitter, getLanguageInfo } from "../deps.ts";
import { Storage } from "./storage.ts";
import { SteamUser } from "./steam_user.ts";
import { SteamID } from "https://deno.land/x/steamid@v1.1.1/mod.ts";
import { TradeOffer } from "./trade_offer.ts";
import { EResult } from "./enums/EResult.ts";
import { ETradeOfferState } from "./enums/ETradeOfferState.ts";
import { EConfirmationMethod } from "./enums/EConfirmationMethod.ts";

export type TradeManagerOptions = {
  /** default: 'localhost' */
  domain?: string;
  /** default: 'en' */
  language?: string;
  /** If `true`, all EconItems will have descriptions before passed around.
   *  
   *  Setting this to `false` (default) decreases api calls when you don't care about the items' descriptions. 
   */
  getDescriptions?: boolean;
  communityOptions?: Omit<SteamCommunityOptions, "languageName">;
  pollingOptions?: Omit<DataPollerOptions, "manager">;
  /** not implemented. do **NOT** use. */
  useProtobuf?: boolean;
};

export class TradeManager extends EventEmitter {
  language: string;
  languageName: string;
  domain: string;
  steamCommunity: SteamCommunity;
  steamApi: SteamApi;
  dataPoller: DataPoller;
  private steamUser: SteamUser | undefined;
  private getDescriptions: boolean;

  constructor(options: TradeManagerOptions) {
    super();

    const {
      domain = "localhost",
      language = "en",
      communityOptions,
      pollingOptions,
      useProtobuf,
      getDescriptions = false,
    } = options;

    this.domain = domain;
    this.getDescriptions = getDescriptions;
    this.language = language;
    this.languageName = "";

    if (language) {
      if (language == "szh") {
        this.language = "zh";
        this.languageName = "schinese";
      } else if (this.language == "tzh") {
        this.language = "zh";
        this.languageName = "tchinese";
      } else {
        const lang = getLanguageInfo(this.language);
        if (!lang || !lang.name) {
          this.language = "";
        } else {
          this.languageName = lang.name.toLowerCase();
        }
      }
    }

    this.steamCommunity = new SteamCommunity({
      languageName: this.languageName,
      ...communityOptions,
    });
    this.steamApi = new SteamApi();
    this.dataPoller = new DataPoller({
      manager: this,
      ...pollingOptions,
    });

    if (useProtobuf) {
      // TODO
      this.steamUser = new SteamUser();
      this.steamUser.on("tradeOffers", () => {
        this.dataPoller.doPoll();
      });
      this.steamUser.on("newItems", () => {
        this.dataPoller.doPoll();
      });
    }
  }

  /**
   * Logins to steam community, get apikey if not set already and set it for steam api use. may throw errors.
   * 
   * Only after this function is finished successfully you may start using trade manager
   */
  async setup(options?: LoginOptions) {
    await this.steamCommunity.login(options);
    const apikey = await this.steamCommunity.getWebApiKey(this.domain);
    if (!apikey) throw new Error("apikey invalid");
    this.steamApi.setApiKey(apikey);
    this.dataPoller.start();
  }

  async shutdown() {
    // TODO
    await this.dataPoller.stop();
  }

  /**
   * 
   * @param partner - Either a trade url or a string that can be parsed to a steam id
   * @param token - The trade token. optional.
   */
  createOffer(partner: string | SteamID, token?: string) {
    let partnerSteamID;
    let tokenStr = token;
    if (typeof partner === "string" && /^https?:\/\//.test(partner)) {
      try {
        const url = new URL(partner);
        const partnerParam = url.searchParams.get("partner");
        const tokenParam = url.searchParams.get("token");
        if (!partnerParam) {
          throw new Error("Invalid trade URL");
        }
        partnerSteamID = SteamID.fromIndividualAccountID(partnerParam);
        tokenStr = tokenParam || tokenStr;
      } catch (err) {
        throw err;
      }
    }

    if (!partnerSteamID) {
      throw new Error("Invalid partner ID");
    }

    const offer = new TradeOffer(partner, token);
    offer.isOurOffer = true;
    offer.fromRealTimeTrade = false;
    return offer;
  }

  async sendTradeOffer(offer: TradeOffer): Promise<ETradeOfferState> {
    if (offer.id) {
      throw new Error("This offer has already been sent");
    }

    if (offer.itemsToGive.length + offer.itemsToReceive.length == 0) {
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
      "version": offer.itemsToGive.length + offer.itemsToReceive.length + 1,
      "me": {
        "assets": offer.itemsToGive.map(itemMapper),
        "currency": [], // TODO unknown
        "ready": false,
      },
      "them": {
        "assets": offer.itemsToReceive.map(itemMapper),
        "currency": [],
        "ready": false,
      },
    };

    const offerCreateParams: Record<string, string> = {};

    if (offer.token) {
      offerCreateParams.trade_offer_access_token = offer.token;
    }

    const response = await this.steamCommunity.fetch(
      "https://steamcommunity.com/tradeoffer/new/send",
      {
        headers: {
          "referer": `https://steamcommunity.com/tradeoffer/${(offer.id ||
            "new")}/?partner=${offer.partner.accountid}` +
            (offer.token ? "&token=" + offer.token : ""),
        },
        form: {
          "sessionid": this.steamCommunity.getSessionID(),
          "serverid": "1",
          "partner": offer.partner.toString(),
          "tradeoffermessage": offer.message || "",
          "json_tradeoffer": JSON.stringify(offerdata),
          "captcha": "",
          "trade_offer_create_params": JSON.stringify(offerCreateParams),
          "tradeofferid_countered": offer.countering ? offer.countering : "",
        },
      },
    );

    const body = await response.json();

    if (response.status !== 200) {
      if (response.status == 401) {
        // this.steamCommunity.login();
        throw new Error("Not Logged In");
      }

      throw new Error("HTTP error " + response.status);
    }

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

    if (body && body.tradeofferid) {
      offer.id = body.tradeofferid as string;
      offer.state = ETradeOfferState.Active;
      offer.created = new Date();
      offer.updated = new Date();
      offer.expires = new Date(Date.now() + 1209600000); // 2 weeks

      // poll data will be saved on next poll if saving method is defined and polling is started
      this.dataPoller.pollData.sent[offer.id] = offer.state;
    }

    if (body && body.needs_email_confirmation) {
      offer.state = ETradeOfferState.CreatedNeedsConfirmation;
      offer.confirmationMethod = EConfirmationMethod.Email;
    }

    if (body && body.needs_mobile_confirmation) {
      offer.state = ETradeOfferState.CreatedNeedsConfirmation;
      offer.confirmationMethod = EConfirmationMethod.MobileApp;
    }

    if (body && offer.state == ETradeOfferState.CreatedNeedsConfirmation) {
      return ETradeOfferState.CreatedNeedsConfirmation;
    } else if (body && body.tradeofferid) {
      return ETradeOfferState.Active;
    } else {
      throw new Error("Unknown response");
    }
  }
}

/** 
 * Use this helper function to create TradeManager and use some defaults. you must provide username, password and sharedSecret when using this.
 * otherwise you have to construct a trade manager object and call `manager.setup()` function yourself to start using it.
 * 
 * using this function automatically saves/loads poll data to/from the disk.
 * also encrypts your cookies to disk using your machine guid (relogin needed when changing systems).
 */
export async function createTradeManager(options: TradeManagerOptions) {
  const {
    communityOptions,
    pollingOptions,
    ...otherOptions
  } = options || {};
  const tradeManager = new TradeManager({
    communityOptions,
    pollingOptions: {
      ...pollingOptions,
      loadPollData: (steamid64) => {
        return Storage.loadData(`poll_data_${steamid64}.json`) as Promise<
          PollData
        >;
      },
      savePollData: async (data, steamid64) => {
        await Storage.saveData(`poll_data_${steamid64}.json`, data);
      },
    },
    ...otherOptions,
  });
  await tradeManager.setup();
  return tradeManager;
}
