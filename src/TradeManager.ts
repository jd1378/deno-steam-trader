import { EventEmitter, getLanguageInfo } from "../deps.ts";

export type TradeManagerOptions = {
  /** default: 'localhost' */
  domain?: string;
  /** default: 'en' */
  language?: string;
};

export class TradeManager extends EventEmitter {
  language: string;
  languageName: string;
  domain: string;
  private pollTimer: number | undefined;

  constructor(options: TradeManagerOptions) {
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

  shutdown() {
    clearTimeout(this.pollTimer);
    // TODO
  }
}
