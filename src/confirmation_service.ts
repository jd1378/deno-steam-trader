import { Deferred } from "./deferred.ts";
import { ConfirmationObject } from "./confirmation_object.ts";
import type {
  SteamCommunity,
  SteamCommunityOptions,
} from "./steam_community.ts";
import {
  DOMParser,
  ExtendedRequestInit,
  generateConfirmationKey,
  getDeviceID,
  getLocalUnixTime,
} from "../deps.ts";
import type { Element } from "../deps.ts";

export type RequestOptions = {
  /** relative path after `mobileconf/` */
  url: string;
  /** The unix timestamp with which the following key was generated */
  time: number;
  /**
   * The confirmation key that was generated using the preceding time and the tag "allow" (if accepting) or "cancel" (if not accepting)
   */
  key: string;
  /** the tag string */
  tag: string;
  /** parameters to send in body */
  params?: Record<string, string | Array<string>>;
};

export type ConfirmOperation = "allow" | "cancel";

export class ConfirmationService {
  community: SteamCommunity;
  private lastConfirmationList: ConfirmationObject[] = [];
  private identitySecret;
  private retrieveConfirmationsDeffer?: Deferred<void>;
  private localOffset = 0;

  constructor(
    community: SteamCommunity,
    identitySecret: SteamCommunityOptions["identitySecret"],
  ) {
    this.community = community;
    this.identitySecret = identitySecret;
  }

  private request(options: RequestOptions) {
    if (!this.community.steamID) {
      throw new Error(
        "Must be logged in before trying to do anything with confirmations",
      );
    }

    if (this.localOffset > 500) {
      this.localOffset = 0;
    }

    let { url, key, time, tag, params } = options;

    params = params || {};
    params.p = getDeviceID(this.community.steamID);
    params.a = this.community.steamID.getSteamID64();
    params.k = key;
    params.t = time.toString();
    params.m = "android";
    params.tag = tag;

    const req: ExtendedRequestInit = {
      method: url === "multiajaxop" ? "POST" : "GET",
    };

    if (req.method == "GET") {
      req.qs = params as Record<string, string>; // handle by doConfirmationOperation
    } else {
      req.form = params;
    }

    return this.community.fetch(
      "https://steamcommunity.com/mobileconf/" + url,
      req,
    );
  }

  /** @param time - unix timestamp */
  private async getKey(time: number, tag: string) {
    if (typeof this.identitySecret === "function") {
      if (!this.community.username) {
        throw new Error(
          "community username not defined. aborting confirmation key generation",
        );
      }
      return await this.identitySecret(this.community.username, { time, tag });
    } else if (this.identitySecret) {
      return generateConfirmationKey(this.identitySecret, {
        time,
        tag,
      });
    } else {
      throw new Error(
        "identitySecret option not provided but tried to use confirmations",
      );
    }
  }

  private async getConfirmations(timeForKey?: number) {
    if (this.retrieveConfirmationsDeffer) {
      await this.retrieveConfirmationsDeffer;
    }
    this.retrieveConfirmationsDeffer = new Deferred();
    try {
      const time = timeForKey || (getLocalUnixTime() + this.localOffset++);
      const key = await this.getKey(time, "conf");
      const resp = await this.request({
        url: "conf",
        key,
        time,
        tag: "conf",
      });
      const body = await resp.text();
      if (body.includes("Invalid protocol: steammobile:")) {
        const err = new Error("Not Logged In");
        this.community._notifySessionExpired(err);
        throw err;
      }

      if (!resp.ok) {
        throw new Error("error when getting confirmations from steam");
      }

      const dom = new DOMParser().parseFromString(body, "text/html");
      if (!dom) {
        throw new Error("cannot parse dom for confirmations");
      }

      { // check for empty list
        const empty = dom.querySelector("#mobileconf_empty");
        if (empty) {
          if (empty.classList.has("mobileconf_done")) {
            // An error occurred
            throw new Error(
              empty.querySelector("div:nth-of-type(2)")?.textContent,
            );
          } else {
            this.lastConfirmationList = [];
            return;
          }
        }
      }

      // We have something to confirm
      const confirmations = dom.querySelector("#mobileconf_list");
      if (!confirmations) {
        throw new Error("Malformed response");
      }

      const newList: ConfirmationObject[] = [];
      confirmations.querySelectorAll(".mobileconf_list_entry").forEach(
        (entryNode) => {
          const entryElement = entryNode as Element;
          const img = entryElement.querySelector(
            ".mobileconf_list_entry_icon img",
          );
          const id = entryElement.getAttribute("data-confid");
          const creator = entryElement.getAttribute("data-creator");
          const key = entryElement.getAttribute("data-key");
          const title = entryElement.querySelector(
            ".mobileconf_list_entry_description>div:nth-of-type(1)",
          )?.textContent.trim();
          const receiving = entryElement.querySelector(
            ".mobileconf_list_entry_description>div:nth-of-type(2)",
          )?.textContent.trim();
          const time = entryElement.querySelector(
            ".mobileconf_list_entry_description>div:nth-of-type(3)",
          )?.textContent.trim();
          let type: number | string | null = entryElement.getAttribute(
            "data-type",
          );
          if (!id || !type || !creator || !key || !time) {
            throw Error("one of required props of confirm object not found");
          }
          type = parseInt(type, 10);
          newList.push(
            new ConfirmationObject({
              id,
              type,
              creator,
              key,
              title,
              receiving,
              time,
              icon: img?.getAttribute("src") || undefined,
            }),
          );
        },
      );
      this.lastConfirmationList = newList;
      return;
    } finally {
      this.retrieveConfirmationsDeffer.resolve();
      this.retrieveConfirmationsDeffer = undefined;
    }
  }

  private async findOrGetConfirmation(
    offerid: string,
    _sr = false,
  ): Promise<ConfirmationObject | undefined> {
    const found = this.lastConfirmationList.find((cobj) =>
      cobj.creator === offerid
    );
    if (!found || !this.lastConfirmationList.length) {
      if (_sr) {
        if (!found) {
          throw new Error("requested offerid is not in confirmation list");
        }
      } else {
        await this.getConfirmations();
        return this.findOrGetConfirmation(offerid, true);
      }
    }

    return found;
  }

  private async doConfirmationOperation(
    options: {
      confIds: Array<string> | string;
      confKeys: Array<string> | string;
      operation: ConfirmOperation;
    },
  ) {
    let { confIds, confKeys, operation } = options;
    const multiOperation = Array.isArray(confIds) && Array.isArray(confKeys) &&
      confIds.length > 1 && confKeys.length > 1;
    if (!multiOperation && Array.isArray(confIds) && Array.isArray(confKeys)) {
      confIds = confIds[0];
      confKeys = confKeys[0];
    }
    const time = getLocalUnixTime() + this.localOffset++;
    const operationKey = await this.getKey(time, operation);

    const resp = await this.request({
      url: multiOperation ? "multiajaxop" : "ajaxop",
      time: time,
      key: operationKey,
      tag: operation,
      params: {
        op: operation,
        cid: confIds,
        ck: confKeys,
      },
    }).then((r) => r.json());

    if (resp?.success) {
      return;
    }

    if (resp?.message) {
      throw new Error(resp.message);
    }

    throw new Error("doing confirmation failed for unknown reasons");
  }

  private async respondToOffer(offerid: string, operation: ConfirmOperation) {
    if (operation !== "allow" && operation !== "cancel") {
      throw new Error("Invalid confirm operation");
    }
    const cobj = await this.findOrGetConfirmation(offerid);
    if (!cobj) {
      throw new Error("Cannot find confirmation object with this offerid");
    }

    await this.doConfirmationOperation({
      confIds: cobj.id,
      confKeys: cobj.key,
      operation: operation,
    });
  }

  allowOffer(offerid: string) {
    return this.respondToOffer(offerid, "allow");
  }

  cancelOffer(offerid: string) {
    return this.respondToOffer(offerid, "cancel");
  }

  async cancelAllConfirmations() {
    await this.getConfirmations();
    if (this.lastConfirmationList.length) {
      await this.doConfirmationOperation({
        confIds: this.lastConfirmationList.map((cobj) => cobj.id),
        confKeys: this.lastConfirmationList.map((cobj) => cobj.key),
        operation: "cancel",
      });
    }
  }
}
