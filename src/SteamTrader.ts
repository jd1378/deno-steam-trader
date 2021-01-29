import { EventEmitter, getLanguageInfo } from "../deps.ts";

export type SteamTraderOptions = {
  /** default: 'localhost' */
  domain?: string;
  /** default: 'en' */
  language?: string;
};

export class SteamTrader extends EventEmitter {
  language: string;
  languageName: string;
  domain: string;
  private pollTimer: number | undefined;

  constructor(options: SteamTraderOptions) {
    super();

    const { domain = "localhost", language = "en" } = options;
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
  }

  parentalUnlock(familyViewPin: string) {
    // TODO
  }

  shutdown() {
    clearTimeout(this.pollTimer);
    // TODO
  }
}
