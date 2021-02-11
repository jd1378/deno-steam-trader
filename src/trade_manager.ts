import { CryptStorage } from "./crypt_storage.ts";
import { DataPoller, DataPollerOptions, PollData } from "./data_poller.ts";
import { SteamApi } from "./steam_api/mod.ts";
import {
  LoginOptions,
  SteamCommunity,
  SteamCommunityOptions,
} from "./steam_community.ts";
import { EventEmitter, getLanguageInfo, SteamID } from "../deps.ts";
import type { CookieOptions } from "../deps.ts";
import { Storage } from "./storage.ts";
import { SteamUser } from "./steam_user.ts";
import { TradeOffer } from "./trade_offer.ts";

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
  communityOptions?: Omit<SteamCommunityOptions, "languageName" | "manager">;
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
      manager: this,
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

  /** returns steamCommunity instance's steamID. undefined unitl successful login */
  get steamID() {
    return this.steamCommunity.steamID;
  }

  get confirmationService() {
    return this.steamCommunity.confirmationService;
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

    const offer = new TradeOffer(this, partnerSteamID, tokenStr);
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
 * so it needs following permissions:
 * 
 * on windows (not sure if syntax is correct): --allow-env --allow-run --allow-read=%cd%\\storage --allow-write=%cd%\\storage --allow-net=api.steampowered.com,steamcommunity.com
 * 
 * on linux: --allow-read=/var/lib/dbus/machine-id,/etc/machine-id,$PWD/storage --allow-write=$PWD/storage --allow-net=api.steampowered.com,steamcommunity.com
 * 
 * @param debug - a function to add as event handler of 'debug' early.
 * currently the only way to debug setup phase through this function.
 */
export async function createTradeManager(
  options: TradeManagerOptions,
  debug?: (...args: unknown[]) => void | Promise<void>,
) {
  const {
    communityOptions,
    pollingOptions,
    ...otherOptions
  } = options || {};
  const tradeManager = new TradeManager({
    communityOptions: {
      loadCookies: (username) => {
        return CryptStorage.loadData(
          `comm_cookies_${username}.bin`,
        ) as Promise<
          Array<
            CookieOptions
          >
        >;
      },
      // our cookie jar supports json serialization directly
      saveCookies: async (data, username) => {
        await CryptStorage.saveData(`comm_cookies_${username}.bin`, data);
      },
      ...communityOptions,
    },
    pollingOptions: {
      loadPollData: (username) => {
        return Storage.loadData(`poll_data_${username}.json`) as Promise<
          PollData
        >;
      },
      savePollData: async (data, username) => {
        await Storage.saveData(`poll_data_${username}.json`, data);
      },
      ...pollingOptions,
    },
    ...otherOptions,
  });
  if (debug) {
    tradeManager.on("debug", debug);
  }
  await tradeManager.setup();
  return tradeManager;
}
