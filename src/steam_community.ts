import { TradeManager } from "./trade_manager.ts";
import {
  Cookie,
  CookieJar,
  CookieOptions,
  generateAuthCode,
  getKeySize,
  randomBytes,
  RSA,
  RSAKey,
  SteamID,
} from "../deps.ts";
import { EResult } from "./enums/EResult.ts";
import { EconItem } from "./econ_item.ts";
import { SteamError } from "./steam_error.ts";
import { fastConcatMU } from "./utils.ts";
import { getFetchAndCookieJar } from "./steam_community_fetch.ts";
import { ConfirmationService } from "./confirmation_service.ts";

export type SteamCommunityOptions = {
  manager: TradeManager;
  languageName: string;
  username?: string;
  password?: string;
  /** the shared secret string or a function that returns a code generated by a totp generator */
  sharedSecret?: string | ((username: string) => string | Promise<string>);
  /** the identity secret string or a function that returns a confirmation code generated by a totp generator */
  identitySecret?:
    | string
    | ((
      username: string,
      options: { /** Unix timestamp */ time: number; tag: string },
    ) => string | Promise<string>);
  /** a function that will be called by the library when it needs to save */
  saveCookies?: (
    cookieJar: CookieJar,
    username: string,
  ) => void | Promise<void>;
  /** a function that will be called by the library when it needs to load cookies. probably this will only be called once */
  loadCookies?:
    | ((username: string) => Promise<Array<CookieOptions> | undefined>)
    | ((username: string) => Array<CookieOptions> | undefined);
};

export type LoginOptions = {
  /** if not set, must be used in SteamCommunity constructor options */
  username?: string;
  /** if not set, must be used in SteamCommunity constructor options */
  password?: string;
  /**
   * automatically generates totp from sharedSecret
   */
  sharedSecret?: SteamCommunityOptions["sharedSecret"];
  loginFriendlyName?: string;
  /** Provide this next time you are loggin in if you received "CAPTCHA" error. */
  captcha?: string;
  /**
   * provide this if you don't use sharedSecret. you will receive "SteamGuardMobile" error if twoFactorCode is wrong or not provided.
   */
  twoFactorCode?: string;
  /**
   * provide this next time you are logging in if you received "SteamGuard" error
   */
  emailauth?: string;
  /**
   *  only required if logging in with a Steam Guard authorization
   */
  steamguard?: string;
  /** defaults to "true" */
  rememberLogin?: "true" | "false";
};

export type LoginAttemptData = {
  // deno-lint-ignore camelcase
  captcha_gid?: string;
  captchaurl?: string;
  emaildomain?: string;
  steamguard?: string;
};

// DoctorMcKay/node-steamcommunity was at 3.42.0 at the time of writing this.
export class SteamCommunity {
  languageName: string;
  cookieJar: CookieJar;
  private manager: TradeManager;
  public fetch;
  private lastLoginAttempt: LoginAttemptData;
  steamID: SteamID | undefined;
  username: string | undefined;
  password: string | undefined;
  private sharedSecret: SteamCommunityOptions["sharedSecret"] | undefined;
  private loadedCookies: boolean;
  private loggingIn: boolean;
  private loadCookies;
  private saveCookies;
  confirmationService: ConfirmationService;

  constructor(options: SteamCommunityOptions) {
    if (typeof options !== "object") {
      throw new Error("SteamCommunity options must be an object");
    }
    this.manager = options.manager;
    this.languageName = options.languageName;
    this.username = options.username;
    this.password = options.password;
    this.sharedSecret = options.sharedSecret;
    this.confirmationService = new ConfirmationService(
      this,
      options.identitySecret,
    );
    this.lastLoginAttempt = {};
    this.loadedCookies = false;
    this.loggingIn = false;

    if (options?.saveCookies && options?.loadCookies) {
      this.saveCookies = options.saveCookies;
      this.loadCookies = options.loadCookies;
    }

    const { cookieJar, fetch } = getFetchAndCookieJar(this);
    this.cookieJar = cookieJar;
    this.fetch = fetch;
  }

  setLoginDefaults(
    options: Pick<LoginOptions, "username" | "password" | "sharedSecret">,
  ) {
    if (!options) return;
    this.username = options.username || this.username;
    this.password = options.password || this.password;
    this.sharedSecret = options.sharedSecret || this.sharedSecret;
  }

  async trySaveCookies() {
    if (this.saveCookies && this.username) {
      try {
        await this.saveCookies(this.cookieJar, this.username);
      } catch (err) {
        this.manager.emit("debug", "Failed to save cookies: " + err);
      }
    }
  }

  async tryLoadCookies() {
    if (this.loadedCookies) return;
    if (this.loadCookies && this.username) {
      try {
        const arrayOfCookieOptions = await this.loadCookies(
          this.username,
        );
        if (arrayOfCookieOptions?.length) {
          this.cookieJar.replaceCookies(arrayOfCookieOptions);
          this.manager.emit("debug", "cookie jar loaded from disk.");
          let steamID64 = this.cookieJar.getCookie({
            name: "steamLoginSecure",
          })?.value;
          let steamID64Match;

          if (steamID64) {
            steamID64 = decodeURIComponent(steamID64);
            steamID64Match = steamID64.match(
              /(\d+)/,
            );
          }

          if (steamID64Match) {
            this.steamID = new SteamID(steamID64Match[1]);
            this.manager.emit(
              "debug",
              "restored steamid from cookies",
              this.steamID.toString(),
            );
          } else {
            this.manager.emit("debug", "Cannot get steamid from cookies");
          }
        }
      } catch {
        this.manager.emit("debug", "no saved cookies found.");
      } finally {
        this.loadedCookies = true;
      }
    }
  }

  /**
   * @param domain - your domain name
   */
  async getWebApiKey(domain: string): Promise<string> {
    let secondCall = false;
    const sendRequest = async (): Promise<string> => {
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
        ).then((r) => r.text());
        secondCall = true;
        return await sendRequest();
      } else {
        throw new Error("Failed to get a api key");
      }
    };
    return await sendRequest();
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
      this.setCookie(sessionIdCookie);
      return sessionIdCookie.value;
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

  /**
   * totalInventoryCount may not be equal to sum of currency and inventory lengths if inventory changes mid request.
   */
  async getUserInventoryContents(options: {
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
    const currency: EconItem[] = [];
    const inventory: EconItem[] = [];
    let totalInventoryCount = 0;
    let inv;
    do {
      inv = await this.fetchUserInventoryPage({
        userID,
        appID,
        contextID,
        startAssetId: inv ? inv.lastAssetId : undefined,
      });
      fastConcatMU(currency, inv.currency);
      fastConcatMU(inventory, inv.inventory);
      totalInventoryCount = inv.totalInventoryCount; // may change while retrieving
    } while (inv.moreItems);

    return {
      currency,
      inventory,
      totalInventoryCount,
    };
  }

  private async fetchUserInventoryPage(
    options: {
      userID: SteamID;
      appID: number;
      contextID: string;
      startAssetId?: string;
      tradableOnly?: boolean;
    },
  ): Promise<{
    currency: EconItem[];
    inventory: EconItem[];
    totalInventoryCount: number;
    moreItems: boolean;
    lastAssetId: undefined | string;
  }> {
    const { appID, userID, contextID, startAssetId, tradableOnly = false } =
      options;
    const resp = await this.fetch(
      `https://steamcommunity.com/inventory/${userID.getSteamID64()}/${appID}/${contextID}`,
      {
        headers: {
          "Referer":
            `https://steamcommunity.com/profiles/${userID.getSteamID64()}/inventory`,
        },
        redirect: "manual",
        qs: {
          "l": this.languageName,
          "count": "5000", // Max items per 'page'
          "start_assetid": startAssetId?.toString(),
        },
      },
    );
    const body = await resp.json();

    if (resp.status !== 200) {
      if (resp.status === 403 && resp.body === null) {
        if (userID.toString() === this.steamID?.toString()) {
          this._notifySessionExpired(new Error("Not Logged In"));
        }
        throw new Error(
          "Profile for id " + this.steamID?.toString() + " is private.",
        );
      }

      if (resp.status === 500 && body && body.error) {
        let message = body.error;
        let eresult = -1;
        const match = body.error.match(/^(.+) \((\d+)\)$/);
        if (match) {
          message = match[1];
          eresult = match[2];
        }
        throw new SteamError(message, { eresult });
      }

      throw new Error("unknown http error: " + resp.status);
    }

    const currency: EconItem[] = [];
    const inventory: EconItem[] = [];

    if (body && body.success && body.total_inventory_count === 0) {
      // Empty inventory
      return {
        currency,
        inventory,
        totalInventoryCount: 0,
        moreItems: false,
        lastAssetId: undefined,
      };
    }

    if (!body || !body.success || !body.assets || !body.descriptions) {
      if (body) {
        // Dunno if the error/Error property even exists on this new endpoint
        throw new Error(body.error || body.Error || "Malformed response");
      } else {
        throw new Error("Malformed response");
      }
    }

    const items = EconItem.fromAssetsWithDescriptions(
      body.assets,
      body.descriptions,
    );

    items.forEach((item) => {
      if (tradableOnly && !item.tradable) {
        return;
      }
      if (item.is_currency) {
        currency.push(item);
      } else {
        inventory.push(item);
      }
    });

    return {
      currency,
      inventory,
      totalInventoryCount: body.total_inventory_count as number || 0,
      moreItems: !!body.more_items,
      lastAssetId: body.last_assetid as string,
    };
  }

  /**
   * Only automatic totp generation with sharedSecret is supported. Make sure your system time is in sync with world.
   * 
   * after successful login these cookies should be set at least:
   * `sessionid`,
   * `steamLoginSecure`,
   * `steamMachineAuth`
   */
  async login(options?: LoginOptions) {
    if (this.loggingIn) return;
    this.loggingIn = true;
    try {
      await this.tryLoadCookies();

      const { isLoggedIn } = await this.getLoginStatus();
      if (isLoggedIn) return;

      if (options) {
        this.setLoginDefaults(options);
      } else {
        options = {};
      }

      if (!this.password || !this.username) {
        throw new Error(
          "username and password are not provided",
        );
      }

      if (options.steamguard) {
        const parts = options.steamguard.split("||");
        this.setCookie(
          new Cookie({
            name: "steamMachineAuth" + parts[0],
            value: encodeURIComponent(parts[1]),
          }),
        );
      }

      let rsa;
      let rsatimestamp;

      { // fetch RSA needed
        const headersForRsaKeyRequest = new Headers();
        headersForRsaKeyRequest.append(
          "Referer",
          "https://steamcommunity.com/login",
        );
        const rsaRequestBody = new FormData();
        rsaRequestBody.append("username", this.username);
        rsaRequestBody.append("donotcache", Date.now().toString());

        const body = await this.fetch(
          "https://steamcommunity.com/login/getrsakey/",
          {
            method: "POST",
            body: rsaRequestBody,
            headers: headersForRsaKeyRequest,
            redirect: "manual",
          },
        ).then((r) => r.json());

        if (!body.publickey_mod || !body.publickey_exp) {
          throw new Error("Invalid RSA key received");
        }

        const n = BigInt("0x" + body.publickey_mod);
        const e = BigInt("0x" + body.publickey_exp);

        const rsakey = new RSAKey({
          n,
          e,
          length: getKeySize(n),
        });

        rsa = new RSA(rsakey);
        rsatimestamp = body.timestamp;
      }

      const loginRequestHeaders = new Headers();

      let twoFactorCode = "";
      if (options.twoFactorCode) {
        twoFactorCode = options.twoFactorCode;
      } else if (this.sharedSecret) {
        if (typeof this.sharedSecret === "string") {
          twoFactorCode = generateAuthCode(this.sharedSecret);
        } else {
          twoFactorCode = await this.sharedSecret(this.username);
        }
      }

      const data = new URLSearchParams({
        username: this.username,
        password: (await rsa.encrypt(this.password, { padding: "pkcs1" }))
          .base64(),
        // rsa
        rsatimestamp,
        // two factor (totp)
        "twofactorcode": twoFactorCode,
        // captcha
        captcha_text: options.captcha || "",
        captchagid: this.lastLoginAttempt.captcha_gid || "-1",
        // email
        emailauth: options.emailauth || "",
        emailsteamid: "",
        // other
        loginfriendlyname: options.loginFriendlyName || "",
        remember_login: options.rememberLogin || "true",
        donotcache: Date.now().toString(),
      });

      const resp: {
        success: boolean;
        emailauth_needed: boolean;
        requires_twofactor: boolean;
        captcha_needed: boolean;
        message?: string;
        emaildomain?: string;
        captcha_gid?: string;
      } = await this.fetch("https://steamcommunity.com/login/dologin/", {
        method: "POST",
        headers: loginRequestHeaders,
        body: data,
        redirect: "manual",
      }).then((r) => r.json());

      if (!resp.success && resp.emailauth_needed) {
        // code was sent to email
        this.lastLoginAttempt.emaildomain = resp.emaildomain;
        const error = new Error("SteamGuard");
        Object.assign(error, { emaildomain: resp.emaildomain });
        throw error;
      } else if (!resp.success && resp.requires_twofactor) {
        // code generated by steamtotp or mobile app is missing
        throw new Error("SteamGuardMobile");
      } else if (
        !resp.success && resp.captcha_needed &&
        resp.message?.match(/Please verify your humanity/)
      ) {
        this.lastLoginAttempt.captchaurl =
          "https://steamcommunity.com/login/rendercaptcha/?gid=" +
          (resp.captcha_gid || "");
        this.lastLoginAttempt.captcha_gid = resp.captcha_gid;
        const error = new Error("CAPTCHA");
        Object.assign(error, { captchaurl: this.lastLoginAttempt.captchaurl });
      } else if (!resp.success) {
        throw new Error(resp.message || "Unknown error");
      } else {
        this.getSessionID();
        await this.trySaveCookies();
        const steamLoginCV = this.cookieJar.getCookie({
          name: "steamLoginSecure",
        })
          ?.value;
        if (steamLoginCV) {
          this.steamID = new SteamID(
            decodeURIComponent(steamLoginCV).split("||")[0],
          );
          this.manager.emit(
            "debug",
            "login successful for " + this.username,
            this.steamID.toString(),
          );
        } else {
          throw new Error("Cannot get steamid from cookies");
        }

        // get steamguard cookie
        const steamGuardCV = this.cookieJar.getCookie({
          name: "steamMachineAuth" + this.steamID.toString(),
        })?.value;
        if (steamGuardCV) {
          this.lastLoginAttempt.steamguard = this.steamID.toString() + "||" +
            decodeURIComponent(steamGuardCV);
        }
      }
    } finally {
      this.loggingIn = false;
    }
  }

  async getLoginStatus(): Promise<{
    isLoggedIn: boolean;
    isFamilyLockActive: boolean | undefined;
    error?: Error;
  }> {
    await this.tryLoadCookies();
    try {
      const response = await this.fetch("https://steamcommunity.com/my", {
        redirect: "manual",
      });
      await response.text(); // close request, bug in deno for now

      if (response.type === "opaqueredirect" || response.status === 0) {
        throw new Error("Login check broken due to deno api change"); // PANIC here.
      }

      if (response.status !== 302 && response.status !== 403) {
        throw new Error("Http error " + response.status);
      } else if (response.status === 403) {
        // logged in and family lock active
        return {
          isFamilyLockActive: true,
          isLoggedIn: true,
        };
      } else if (response.status === 302) {
        const loggedIn = !!response.headers.get("location")?.match(
          /steamcommunity\.com(\/(id|profiles)\/[^\/]+)\/?/,
        );
        return {
          isFamilyLockActive: false,
          isLoggedIn: loggedIn,
        };
      }

      return {
        isFamilyLockActive: undefined,
        isLoggedIn: false,
      };
    } catch (error) {
      return {
        isFamilyLockActive: undefined,
        isLoggedIn: false,
        error,
      };
    }
  }

  async parentalUnlock(pin: string): Promise<boolean> {
    const body = await this.fetch(
      "https://steamcommunity.com/parental/ajaxunlock",
      {
        method: "POST",
        form: {
          pin,
          sessionid: this.getSessionID(),
        },
      },
    ).then((r) => r.json());

    if (!body || !("success" in body)) {
      throw new Error("Invalid response");
    }

    if (!body.success) {
      if (body.eresult === undefined) {
        throw new Error("Unknown Error");
      }

      switch (body.eresult) {
        case EResult.AccessDenied:
          throw new Error("Incorrect PIN");
        case EResult.LimitExceeded:
          throw new Error("Too many invalid PIN attempts");

        default:
          throw new Error(`Error: ${EResult[body.eresult]} (${body.eresult})`);
      }
    }

    return true;
  }

  async getClientLogonToken() {
    const resp = await this.fetch(
      "https://steamcommunity.com/chat/clientjstoken",
    );
    if (resp.status !== 200) {
      throw new Error("HTTP error: " + resp.status);
    }
    const body: {
      logged_in: boolean;
      steamid?: string;
      account_name?: string;
      token?: string;
    } = await resp.json();
    if (!body.logged_in) {
      const err = new Error("Not Logged In");
      this._notifySessionExpired(err);
      throw err;
    }

    if (!body.steamid || !body.account_name || !body.token) {
      throw new Error("Malformed response");
    }

    return {
      "steamID": new SteamID(body.steamid),
      "accountName": body.account_name,
      "webLogonToken": body.token,
    };
  }

  _notifySessionExpired(err: Error) {
    this.manager.emit("sessionExpired", err);
  }

  _notifyFamilyViewRestricted(err: Error) {
    this.manager.emit("familyViewRestricted", err);
  }
}
