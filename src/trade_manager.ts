import { DataPoller } from "./data_poller.ts";
import { SteamApi } from "./SteamApi/mod.ts";
import { LoginOptions, SteamCommunity } from "./steam_community.ts";
import { EventEmitter, getLanguageInfo } from "../deps.ts";

export type TradeManagerOptions = {
  /** default: 'localhost' */
  domain?: string;
  /** default: 'en' */
  language?: string;
  username?: string;
  password?: string;
  sharedSecret?: string;
  apikey?: string;
  pollInterval?: number;
};

export class TradeManager extends EventEmitter {
  language: string;
  languageName: string;
  domain: string;
  steamCommunity: SteamCommunity;
  steamApi: SteamApi;
  dataPoller: DataPoller;

  constructor(options: TradeManagerOptions) {
    super();

    const {
      domain = "localhost",
      language = "en",
      username,
      password,
      sharedSecret,
      apikey,
      pollInterval,
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
      username,
      password,
      sharedSecret,
    });
    this.steamApi = new SteamApi(apikey);
    this.dataPoller = new DataPoller({
      interval: pollInterval,
      steamApi: this.steamApi,
      manager: this,
    });
    
  }

  /**
   * Logins to steam community, get apikey if not set already and set it for steam api use. may throw errors.
   * 
   * Only after this function is finished successfully you may start using trade manager
   */
  async setup(options: LoginOptions) {
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
