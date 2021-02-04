// deno-lint-ignore-file camelcase

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
}

export type GetTradeOffersOptions = {
  /**	Request the list of sent offers. */
  get_sent_offers: boolean;
  /** Request the list of received offers. */
  get_received_offers: boolean;
  /** If set, the item display data for the items included in the returned trade offers will also be returned. If one or more descriptions can't be retrieved, then your request will fail. */
  get_descriptions: boolean;
  language: boolean;
  /** Indicates we should only return offers which are still active, or offers that have changed in state since the time_historical_cutoff */
  active_only: boolean;
  /** Indicates we should only return offers which are not active. */
  historical_only: boolean;
  /** When active_only is set, offers updated since this time will also be returned */
  time_historical_cutoff: string;
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