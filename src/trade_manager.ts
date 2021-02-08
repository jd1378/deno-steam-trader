import { CryptStorage } from "./crypt_storage.ts";
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
import type { CookieOptions } from "../deps.ts";

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
  /** The time, in milliseconds, that a sent offer can remain Active until it's automatically canceled by the manager.
   *  This feature is disabled if omitted.
   * 
   * Note that this check is performed on polling, so it will only work as expected if timed polling is enabled.
   * Also note that because polling is on a timer,
   * offers will be canceled between `cancelTime` and `cancelTime + pollInterval` milliseconds after being created,
   * assuming Steam is up.
   */
  cancelTime?: number;
  /** Optional. The time, in milliseconds, that a sent offer can remain CreatedNeedsConfirmation until 
   *    it's automatically canceled by the manager.
   *  This feature is disabled if omitted. All documentation for cancelTime applies. */
  pendingCancelTime?: number;
  /** Optional. Once we have this many outgoing Active offers, the oldest will be automatically canceled. */
  cancelOfferCount?: number;
  /** Optional. If you're using cancelOfferCount, then offers must be at least this many milliseconds old in order to qualify for automatic cancellation. */
  cancelOfferCountMinAge?: number;
};

export class TradeManager extends EventEmitter {
  language: string;
  languageName: string;
  domain: string;
  steamCommunity: SteamCommunity;
  steamApi: SteamApi;
  dataPoller: DataPoller;
  private steamUser: SteamUser | undefined;
  getDescriptions: boolean;
  pendingSendOffersCount: number;
  cancelTime: number | undefined;
  pendingCancelTime: number | undefined;
  cancelOfferCount: number | undefined;
  cancelOfferCountMinAge: number | undefined;

  constructor(options: TradeManagerOptions) {
    super();

    const {
      domain = "localhost",
      language = "en",
      communityOptions,
      pollingOptions,
      useProtobuf,
      getDescriptions = false,
      cancelTime,
      pendingCancelTime,
      cancelOfferCount,
      cancelOfferCountMinAge,
    } = options;

    this.domain = domain;
    this.getDescriptions = getDescriptions;
    this.language = language;
    this.languageName = "";
    this.pendingSendOffersCount = 0;
    this.cancelTime = cancelTime;
    this.pendingCancelTime = pendingCancelTime;
    this.cancelOfferCount = cancelOfferCount;
    this.cancelOfferCountMinAge = cancelOfferCountMinAge;

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

    const offer = new TradeOffer(this, partner, token);
    offer.isOurOffer = true;
    offer.fromRealTimeTrade = false;
    return offer;
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
    communityOptions: {
      ...communityOptions,
      loadCookies: (steamid64) => {
        return CryptStorage.loadData(
          `comm_cookies_${steamid64}.bin`,
        ) as Promise<
          Array<
            CookieOptions
          >
        >;
      },
      saveCookies: async (data, steamid64) => {
        await Storage.saveData(`comm_cookies_${steamid64}.bin`, data);
      },
    },
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
