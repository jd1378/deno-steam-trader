// deno-lint-ignore-file camelcase
import { SteamApi } from "./steam_api/mod.ts";
import { OfferItem } from "./steam_api/requests/IEconService.ts";
import { GetAssetClassInfo } from "./steam_api/requests/ISteamEconomy.ts";
import { LFU } from "../deps.ts";

export const itemDescriptionLFU = new LFU({
  capacity: 1500,
  stdTTL: 3 * 60 * 1000, // 2 minutes
});

function getCacheKey(item: OfferItem) {
  return `${item.appid}_${item.classid}_${item.instanceid || "0"}`;
}

export function getDescriptionKey(item: OfferItem) {
  let key = `${item.classid}`;
  if (item.instanceid && item.instanceid != "0") {
    key += "_" + item.instanceid;
  }
  return key;
}

export type EconItemDescription = {
  type: string;
  value?: string;
  color?: string;
  app_data?: string;
};

export type EconItemAction = {
  link?: string;
  name?: string;
};

export type SteamEconItemTag = {
  /** always present */
  internal_name: string;
  /** always present */
  category: string;
  name?: string;
  localized_tag_name?: string;
  category_name?: string;
  localized_category_name?: string;
  color?: string;
};

export type SteamEconItem = {
  /** same as asset id */
  id?: string | number;
  assetid?: string | number;
  classid?: string;
  currencyid?: string | number;
  name?: string;
  market_name?: string;
  market_hash_name?: string;
  appid?: string | number;
  icon_url?: string;
  icon_url_large?: string;
  contextid: string | number;
  instanceid?: string;
  currency?: string | number;
  is_currency?: string | number;
  amount?: number | string;
  fraudwarnings?: Array<string>;
  tradable?: boolean;
  marketable?: boolean;
  commodity?: boolean;
  tags?: Array<SteamEconItemTag>;
  market_tradable_restriction?: string | number;
  market_marketable_restriction?: string | number;
  type?: string;
  background_color?: string;
  descriptions?: Array<EconItemDescription>;
  owner_descriptions?: Array<EconItemDescription>;
  owner_actions?: Array<EconItemAction>;
  actions?: Array<EconItemAction>;
  cache_expiration?: string;
};

export type EconItemTag = {
  /** may use localized_tag_name of item */
  name: string;
  /** always present */
  internal_name: string;
  /** always present */
  category: string;
  /** may use localized_category_name of item */
  category_name: string;
  /** can be an empty string */
  color: string;
};

export type RequiredItemProps = Required<
  Pick<EconItem, "appid" | "contextid" | "assetid">
>;

const tradeBanRegex = /(?:Tradable After|Cooldown Until:)\s*(.*)$/;

/**
 * In order to uniquely identify an item, You need It's App ID, It's context ID, and It's Asset ID.
 * 
 * Asset IDs are not unique globally. Only guaranteed to be unique inside of a given AppID+ContextID combination. 
 */
export class EconItem {
  appid: number;
  /** not available if `is_currency` is true */
  assetid?: string;
  /** A classid "owns" an instanceid. 
   * classid is all you need to get a general overview of an item.
   * instanceid is for getting the finer details.
   */
  classid?: string;
  /**
   * Only usable when classid is available.
   * instanceid allows you to get finer details such as how many kills are on a strange/StatTrak weapon, or custom names/descriptions.
   */
  instanceid?: string;
  /** this name can be localized. it usually does not contain details such as CS:GO skin wear. */
  name?: string;
  /** this name which is shown when item is up for sale. may contain detail such as wear. */
  market_name?: string;
  /** this name is the one used in url of market item's page.
   * it may contain appid in the beginning.
   * hash names should be unique inside one appid (and context id), but not necessarilly globally.
   */
  market_hash_name?: string;
  /** Value for unstackable items is always 1. Stacked items always have the same asset ID. */
  amount: number;
  currencyid?: string | number;
  is_currency = false;
  icon_url?: string;
  icon_url_large?: string;
  /** defaults to empty string if unavailable */
  background_color?: string;
  contextid?: string;
  fraudwarnings: Array<string>;
  descriptions?: Array<EconItemDescription>;
  /** true if the item can be traded, false if not. */
  tradable?: boolean;
  /** true if the item can be listed on the Steam Community Market, false if not. */
  marketable?: boolean;
  /** true if, on the Steam Community Market, this item will use buy orders. false if not. */
  commodity?: boolean;
  /** An array of objects containing the item's inventory tags. */
  tags?: Array<EconItemTag>;
  /** How many days for which the item will be untradable after being sold on the market. */
  market_tradable_restriction?: number;
  /** How many days for which the item will be unmarketable after being sold on the market. */
  market_marketable_restriction?: number;
  /** The "type" that's shown under the game name to the right of the game icon. */
  type?: string;
  /** RFC 3339 UTC formatted time of when the item can no longer be used.
   *  Any Market listings will not be purchasable after this time and will be automatically canceled. */
  item_expiration?: string;
  /** RFC 3339 UTC formatted time that Steam's cache of the response should be invalidated.
   * This will be useful, for example, if the item becomes tradable at a later time. */
  cache_expiration?: string;
  market_fee_app?: number;
  actions?: Array<EconItemAction>;

  constructor(item: SteamEconItem) {
    if (
      !!(item.is_currency || item.currency) ||
      typeof item.currencyid !== "undefined"
    ) {
      this.is_currency = true;
    }

    if (this.is_currency) {
      this.currencyid = item.id = (item.id || item.currencyid);
    } else {
      this.assetid = ((item.id || item.assetid) as string).toString();
    }

    this.market_tradable_restriction =
      (item.market_tradable_restriction
        ? parseInt(item.market_tradable_restriction as string, 10)
        : 0);
    this.market_marketable_restriction =
      (item.market_marketable_restriction
        ? parseInt(item.market_marketable_restriction as string, 10)
        : 0);

    this.name = item.name;
    this.market_name = item.market_name;
    this.market_hash_name = item.market_hash_name;
    this.type = item.type;

    this.classid = item.classid;
    this.instanceid = (item.instanceid || 0).toString();

    this.appid = item.appid ? parseInt(item.appid as string, 10) : 0;

    this.amount = item.amount ? parseInt(item.amount as string, 10) : 1;
    this.contextid = item.contextid.toString();

    this.icon_url = item.icon_url;
    this.icon_url_large = item.icon_url_large;
    this.background_color = item.background_color || "";

    this.fraudwarnings = item.fraudwarnings || [];
    this.tradable = !!item.tradable;
    this.marketable = !!item.marketable;
    this.commodity = !!item.commodity;

    this.tags = [];
    if (item.tags?.length) {
      this.tags = item.tags.map((tag) => {
        return {
          internal_name: tag.internal_name,
          name: tag.localized_tag_name || tag.name,
          category: tag.category,
          color: tag.color || "",
          category_name: tag.localized_category_name || tag.category_name,
        } as EconItemTag;
      });
    }

    this.descriptions = item.descriptions || [];
    if (item.owner_descriptions) {
      this.descriptions.push(...item.owner_descriptions);
    }

    this.actions = item.actions?.length ? item.actions : [];

    // Restore market_fee_app, if applicable
    {
      let match;
      if (
        this.appid === 753 && this.contextid === "6" && this.market_hash_name &&
        (match = this.market_hash_name.match(/^(\d+)\-/))
      ) {
        this.market_fee_app = parseInt(match[1], 10);
      }
    }

    // get cache_expiration if available
    if (item.cache_expiration) {
      this.cache_expiration = item.cache_expiration;
    } else if (this.descriptions.length) {
      let match;
      for (const desc of this.descriptions) {
        if (desc.value && (match = desc.value.match(tradeBanRegex))) {
          this.cache_expiration = new Date(match[1]).toISOString();
          break;
        }
      }
    }
  }

  /** Returns item image url. */
  getImageURL() {
    return `https://steamcommunity-a.akamaihd.net/economy/image/${this.icon_url}/`;
  }

  /** Returns large version of item image url, fallbacks to normal image if unavailable */
  getLargeImageURL() {
    if (!this.icon_url_large) {
      return this.getImageURL();
    }

    return `https://steamcommunity-a.akamaihd.net/economy/image/${this.icon_url_large}/`;
  }

  /**
   * Returns a specific tag from the item, or null if it doesn't exist
   * @param category - string value of tag's `category` property 
   */
  getTag(category: string) {
    if (!this.tags) {
      return null;
    }

    for (const tag of this.tags) {
      if (tag.category === category) {
        return tag;
      }
    }

    return null;
  }

  /** throws error if getting descriptions and api is unavailable */
  static async from(offerItem: OfferItem, options?: FromOfferItemOptions) {
    let cachedData = itemDescriptionLFU.get(getCacheKey(offerItem));
    if (
      !cachedData && options?.getDescriptions && options.steamApi &&
      options.language
    ) {
      const data = await options.steamApi.fetch(
        new GetAssetClassInfo({
          appid: offerItem.appid,
          language: options.language,
          classList: [{
            classid: offerItem.classid,
            instanceid: offerItem.instanceid,
          }],
        }),
      );
      const descKey = getDescriptionKey(offerItem);
      if (data && data[descKey]) {
        itemDescriptionLFU.set(getCacheKey(offerItem), data[descKey]);
        cachedData = data[descKey];
      }
    }

    return new EconItem({ ...cachedData, ...offerItem });
  }

  /** throws error if getting descriptions and api is unavailable or response is malformed */
  static async fromList(
    offerItemList: Array<OfferItem>,
    options?: FromOfferItemOptions,
  ): Promise<EconItem[]> {
    const items: EconItem[] = [];
    const shouldGetDescriptions =
      !!(options?.getDescriptions && options.steamApi && options.language);

    const appidGroupedOfferItems: Record<string, Array<OfferItem>> = {};
    for (const offerItem of offerItemList) {
      const cachedData = itemDescriptionLFU.get(getCacheKey(offerItem));
      if (!cachedData && shouldGetDescriptions) {
        if (!appidGroupedOfferItems[offerItem.appid]) {
          appidGroupedOfferItems[offerItem.appid] = [] as OfferItem[];
        }
        appidGroupedOfferItems[offerItem.appid].push(offerItem);
      } else {
        items.push(new EconItem({ ...cachedData, ...offerItem }));
      }
    }

    if (options && shouldGetDescriptions) {
      for (const appid of Object.keys(appidGroupedOfferItems)) {
        const data = await options.steamApi.fetch(
          new GetAssetClassInfo({
            appid: appid,
            language: options.language,
            classList: appidGroupedOfferItems[appid].map((offerItem) => ({
              classid: offerItem.classid,
              instanceid: offerItem.instanceid,
            })),
          }),
        );
        if (!data) throw new Error("malformed response");
        if (data) {
          appidGroupedOfferItems[appid].forEach((offerItem) => {
            const descKey = getDescriptionKey(offerItem);
            if (data[descKey]) {
              itemDescriptionLFU.set(getCacheKey(offerItem), data[descKey]);
              items.push(new EconItem({ ...data[descKey], ...offerItem }));
            } else {
              throw new Error("one of items descriptions was not found");
            }
          });
        }
      }
    }

    return items;
  }

  static fromAssetsWithDescriptions(
    assets: Array<OfferItem>,
    descriptions: Array<SteamEconItem>,
  ): EconItem[] {
    const items: EconItem[] = [];

    for (const asset of assets) {
      for (const desc of descriptions) {
        if (
          desc.classid === asset.classid && desc.instanceid === asset.instanceid
        ) {
          items.push(new EconItem({ ...desc, ...asset }));
          break; // jump out of description loop
        }
      }
    }

    return items;
  }

  static equals(
    a: EconItem | RequiredItemProps,
    b: EconItem | RequiredItemProps,
  ) {
    return (
      a.appid == b.appid &&
      a.contextid == b.contextid &&
      a.assetid == b.assetid
    );
  }

  equals(item: EconItem | RequiredItemProps) {
    return EconItem.equals(this, item);
  }
}

export type FromOfferItemOptions = {
  getDescriptions: boolean;
  steamApi: SteamApi;
  language: string;
};
