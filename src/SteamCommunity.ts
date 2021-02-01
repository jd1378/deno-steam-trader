import { Cookie, CookieJar, randomBytes, SteamID, wrapFetch } from "../deps.ts";

export type SteamCommunityOptions = {
  languageName: string;
};

export class SteamCommunity {
  languageName: string;
  private cookieJar: CookieJar;
  private fetch: (
    input: string | Request | URL,
    init?: RequestInit | undefined,
  ) => Promise<Response>;

  constructor(options: SteamCommunityOptions) {
    this.languageName = options.languageName;
    // TODO: save and load cookies
    this.cookieJar = new CookieJar();
    this.fetch = wrapFetch({ cookieJar: this.cookieJar });
  }

  async getWebApiKey(domain: string, secondCall = false): Promise<string> {
    const body = await this.fetch(
      "https://steamcommunity.com/dev/apikey?l=english",
      {
        redirect: "error",
      },
    ).then((res) => res.text());

    if (body.match(/<h2>Access Denied<\/h2>/)) {
      throw new Error("Access Denied");
    }

    if (
      body.match(
        /You must have a validated email address to create a Steam Web API key./,
      )
    ) {
      throw new Error(
        "You must have a validated email address to create a Steam Web API key.",
      );
    }

    const match = body.match(/<p>Key: ([0-9A-F]+)<\/p>/);
    if (match) {
      // We already have an API key registered
      return match[1];
    } else if (!secondCall) {
      // We need to register a new API key
      const reqBody = new FormData();
      reqBody.append("domain", domain);
      reqBody.append("agreeToTerms", "agreed");
      reqBody.append("sessionid", this.getSessionID());
      reqBody.append("Submit", "Register");
      await this.fetch(
        "https://steamcommunity.com/dev/registerkey?l=english",
        {
          method: "POST",
          body: reqBody,
        },
      );
      return (await this.getWebApiKey(domain, true));
    } else {
      throw new Error("Failed to get a api key");
    }
  }

  private setCookie(cookie: Cookie) {
    this.cookieJar.setCookie(cookie.clone(), "steamcommunity.com");
    this.cookieJar.setCookie(cookie.clone(), "store.steampowered.com");
    this.cookieJar.setCookie(cookie.clone(), "help.steampowered.com");
  }

  getSessionID(): string {
    const sessionIdCookie = this.cookieJar.getCookie({
      domain: "steamcommunity.com",
      name: "sessionid",
    });
    if (sessionIdCookie?.value) {
      return decodeURIComponent(sessionIdCookie.value);
    } else {
      const sessionID = this.generateSessionID();
      this.setCookie(
        new Cookie({
          name: "sessionid",
          value: sessionID,
        }),
      );
      return sessionID;
    }
  }

  generateSessionID() {
    return randomBytes(12).toString("hex");
  }

  getUserInventoryContents(options: {
    userID: SteamID | string;
    appID: number;
    contextID: string;
    tradableOnly?: boolean;
  }) {
    let { userID, appID, contextID, tradableOnly = false } = options;
    if (
      userID === undefined || appID === undefined || contextID === undefined
    ) {
      throw new Error("insufficient options given");
    }

    if (typeof userID === "string") {
      userID = new SteamID(userID);
    }

    const pos1 = 1;
    // TODO
  }
}
