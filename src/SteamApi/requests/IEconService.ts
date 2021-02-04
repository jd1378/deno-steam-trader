// deno-lint-ignore-file camelcase
import { SteamEconItem } from "./../../EconItem.ts";

import { Methods, ServiceRequest } from "./ServiceRequest.ts";

abstract class IEconServiceRequest extends ServiceRequest {
  constructor() {
    super();
    this.iface = "IEconService";
  }

  iface: string;
}

/** Cancel a trade offer we sent */
export class CancelTradeOffer extends IEconServiceRequest {
  method = Methods.POST;
  functionName = "CancelTradeOffer";
  version = "v1";

  constructor(tradeofferid: string) {
    super();
    const formData = new FormData();
    formData.append("tradeofferid", tradeofferid);
    this.body = formData;
  }
}

export type OfferItem = {
  "appid": number | string;
  "contextid": string;
  "assetid": string;
  "classid": string;
  "instanceid": string;
  "amount": string;
  "missing": boolean;
  "est_usd": string;
};

export type Offer = {
  "tradeofferid": string;
  "accountid_other": string | number;
  "message": string;
  /** unix timestamp (seconds) */
  "expiration_time": number;
  "trade_offer_state": number;
  "items_to_give": Array<OfferItem>;
  "items_to_receive": Array<OfferItem>;
  "is_our_offer": boolean;
  /** unix timestamp (seconds) */
  "time_created": number;
  /** unix timestamp (seconds) */
  "time_updated": number;
  "from_real_time_trade": boolean;
  "escrow_end_date": number;
  "confirmation_method": number;
  "tradeid": string | undefined;
};

/** Decline a trade offer someone sent to us */
export class DeclineTradeOffer extends IEconServiceRequest {
  method = Methods.POST;
  functionName = "DeclineTradeOffer";
  version = "v1";

  constructor(tradeofferid: string) {
    super();
    const formData = new FormData();
    formData.append("tradeofferid", tradeofferid);
    this.body = formData;
  }
}

/** Gets a specific trade offer */
export class GetTradeOffer extends IEconServiceRequest {
  method = Methods.GET;
  functionName = "GetTradeOffer";
  version = "v1";

  constructor(
    tradeofferid: string,
    options?: { language: string; get_descriptions: boolean },
  ) {
    super();
    this.getParams = {
      tradeofferid,
      ...options,
    };
  }

  responseStructure?: {
    response: {
      offer: Offer;
      /** only if get_descriptions is true */
      descriptions?: Array<Omit<SteamEconItem, "id" | "assetid" | "amount">>;
    };
  };
}

export type GetTradeOffersOptions = {
  /**	Request the list of sent offers. */
  get_sent_offers: boolean;
  /** Request the list of received offers. */
  get_received_offers: boolean;
  /** If set, the item display data for the items included in the returned trade offers will also be returned. If one or more descriptions can't be retrieved, then your request will fail. */
  get_descriptions: boolean;
  language: string;
  /** Indicates we should only return offers which are still active, or offers that have changed in state since the time_historical_cutoff */
  active_only: boolean;
  /** Indicates we should only return offers which are not active. */
  historical_only: boolean;
  /** When active_only is set, offers updated since this time will also be returned */
  time_historical_cutoff: string | number;
};

/** Get a list of sent or received trade offers */
export class GetTradeOffers extends IEconServiceRequest {
  method = Methods.GET;
  functionName = "GetTradeOffers";
  version = "v1";

  constructor(
    options: GetTradeOffersOptions,
  ) {
    super();
    this.getParams = {
      ...options,
    };
  }

  responseStructure?: {
    response: {
      trade_offers_sent?: Array<Offer>;
      trade_offers_received?: Array<Offer>;
      /** only if get_descriptions is true */
      descriptions?: Array<Omit<SteamEconItem, "id" | "assetid" | "amount">>;
    };
  };
}

/** Get counts of pending and new trade offers */
export class GetTradeOffersSummary extends IEconServiceRequest {
  method = Methods.GET;
  functionName = "GetTradeOffersSummary";
  version = "v1";

  constructor(
    /** The time the user last visited. If not passed, will use the time the user last visited the trade offer page. */
    time_last_visit?: string,
  ) {
    super();
    if (time_last_visit) {
      this.getParams = {
        time_last_visit,
      };
    }
  }
}

export type GetTradeHistoryOptions = {
  language?: string;
  get_descriptions?: boolean;
  include_failed?: boolean;
  /** If set, the total number of trades the account has participated in will be included in the response */
  include_total?: boolean;
  /** The user wants the previous page of results, so return the previous max_trades trades before the start time and ID */
  navigating_back?: boolean;
  /** uint64, but as string. The tradeid shown on the previous page of results, or the ID of the first trade if navigating back. */
  start_after_tradeid?: string;
  /**	The time of the last trade shown on the previous page of results, or the time of the first trade if navigating back */
  start_after_time: string;
  /** The number of trades to return information for */
  max_trades: number;
};

/** Gets a history of trades */
export class GetTradeHistory extends IEconServiceRequest {
  method = Methods.GET;
  functionName = "GetTradeHistory";
  version = "v1";

  constructor(
    options: GetTradeHistoryOptions,
  ) {
    super();
    this.getParams = {
      ...options,
    };
  }
}

/**
 * Returns the estimated hold duration and end date that a trade with a user would have
 * @example
 * response: 
 * {"response":{"my_escrow":{"escrow_end_duration_seconds":0},"their_escrow":{"escrow_end_duration_seconds":0},"both_escrow":{"escrow_end_duration_seconds":0}}}
 */
export class GetTradeHoldDurations extends IEconServiceRequest {
  method = Methods.GET;
  functionName = "GetTradeHoldDurations";
  version = "v1";

  constructor(
    /** User you are trading with */
    steamid_target: string,
    options?: {
      /**	A special token that allows for trade offers from non-friends. */
      trade_offer_access_token: string;
    },
  ) {
    super();
    this.getParams = {
      steamid_target,
      ...options,
    };
  }
}

/** Gets status for a specific trade */
export class GetTradeStatus extends IEconServiceRequest {
  method = Methods.GET;
  functionName = "GetTradeStatus";
  version = "v1";

  constructor(
    tradeid: string,
    options: {
      get_descriptions?: boolean;
      language?: string;
    },
  ) {
    super();
    this.getParams = {
      tradeid,
      ...options,
    };
  }
}
