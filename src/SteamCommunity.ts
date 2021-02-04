import {
  Cookie,
  CookieJar,
  EventEmitter,
  generateAuthCode,
  getKeySize,
  randomBytes,
  RSA,
  RSAKey,
  SteamID,
  wrapFetchWithCookieJar,
  wrapFetchWithHeaders,
} from "../deps.ts";
import { DEFAULT_USERAGENT } from "./fetch_utils.ts";
import { EResult } from "./enums/EResult.ts";

export type SteamCommunityOptions = {
  languageName: string;
  username?: string;
  password?: string;
  sharedSecret?: string;
  debug?: boolean;
};

export type LoginOptions = {
  /** if not set, must be used in SteamCommunity constructor options */
  username?: string;
  /** if not set, must be used in SteamCommunity constructor options */
  password?: string;
  /**
   * automatically generates totp from sharedSecret
   */
  sharedSecret?: string;
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
export class SteamCommunity extends EventEmitter {
  languageName: string;
  private cookieJar: CookieJar;
  private fetch;
  private lastLoginAttempt: LoginAttemptData;
  steamID: SteamID | undefined;
  private username: string | undefined;
  private password: string | undefined;
  private sharedSecret: string | undefined;
  private loadedCookies: boolean;
  private loggingIn: boolean;

  constructor(options: SteamCommunityOptions) {
    if (typeof options !== "object") {
      throw new Error("SteamCommunity options must be an object");
    }
    super();

    this.languageName = options.languageName;
    this.username = options.username;
    this.password = options.password;
    this.sharedSecret = options.sharedSecret;
    this.lastLoginAttempt = {};
    this.loadedCookies = false;
    this.loggingIn = false;

    this.cookieJar = new CookieJar();
    const wrappedWithCookiesFetch = wrapFetchWithCookieJar({
      cookieJar: this.cookieJar,
    });
    this.fetch = wrapFetchWithHeaders({
      fetchFn: wrappedWithCookiesFetch,
      userAgent: DEFAULT_USERAGENT,
    });
  }

  // TODO: save and load cookies properly
  async saveCookies() {
    try {
      await Deno.writeTextFile("cjar.json", JSON.stringify(this.cookieJar));
    } catch (err) {
      this.emit("debug", "Failed to save cookies: " + err);
    }
  }

  async loadCookies() {
    if (this.loadedCookies) return;
    try {
      const cjardata = await Deno.readTextFile("cjar.json");
      if (cjardata) {
        this.cookieJar.replaceCookies(JSON.parse(cjardata));
        this.emit("debug", "cookie jar loaded from disk.");
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
          this.emit("debug", "restored steamid from cookies");
        } else {
          this.emit("debug", "Cannot get steamid from cookies");
        }
      }
    } catch {
      this.emit("debug", "no saved cookies found.");
    } finally {
      this.loadedCookies = true;
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
        );
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

  /**
   * Only automatic totp generation with sharedSecret is supported. Make sure your system time is in sync with world.
   * 
   * after successful login these cookies should be set at least:
   * `sessionid`,
   * `steamLoginSecure`,
   * `steamMachineAuth`
   * @param options 
   */
  async login(options?: LoginOptions) {
    if (this.loggingIn) return;
    this.loggingIn = true;
    try {
      // TODO correctly load cookies conditionally
      await this.loadCookies();

      const { isLoggedIn } = await this.getLoginStatus();
      if (isLoggedIn) return;
      // END OF TODO

      if (options) {
        this.username = options.username || this.username;
        this.password = options.password || this.password;
        this.sharedSecret = options.sharedSecret || this.sharedSecret;
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
        twoFactorCode = generateAuthCode(this.sharedSecret);
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
        await this.saveCookies();
        const steamLoginCV = this.cookieJar.getCookie({
          name: "steamLoginSecure",
        })
          ?.value;
        if (steamLoginCV) {
          this.steamID = new SteamID(
            decodeURIComponent(steamLoginCV).split("||")[0],
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

  /**
   * Returns login status and if family lock is active in an array of two.
   * throws error if call was unsuccesful
   * 
   * [true, ....] if you're currently logged in, false otherwise
   * 
   * [...., true] if you're currently in family view, [..., false] otherwise. 
   * If true, you'll need to call parentalUnlock with the correct PIN before you can do anything. 
   */
  async getLoginStatus(): Promise<{
    isLoggedIn: boolean;
    isFamilyLockActive: boolean | undefined;
    error?: Error;
  }> {
    await this.loadCookies();
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
      throw new Error("Not Logged In");
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
}
