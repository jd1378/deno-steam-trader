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

export type TradeManagerOptions = {
  /** default: 'localhost' */
  domain?: string;
  /** default: 'en' */
  language?: string;
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

  constructor(options: TradeManagerOptions) {
    super();

    const {
      domain = "localhost",
      language = "en",
      communityOptions,
      pollingOptions,
      useProtobuf,
    } = options;

    this.domain = domain;
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
}

/** 
 * Use this helper function to create TradeManager and use some defaults. you must provide username, password and sharedSecret when using this.
 * otherwise you have to construct a trade manager object and call `manager.setup()` function yourself to start using it.
 * 
 * using this function automatically saves/loads poll data to/from the disk.
 * also encrypts your cookies to disk using your machine guid (relogin needed when changing systems).
 */
export async function createTradeManager(options: TradeManagerOptions) {
  const { communityOptions, pollingOptions, domain, language } = options || {};
  const tradeManager = new TradeManager({
    domain,
    language,
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
  });
  await tradeManager.setup();
  return tradeManager;
}
