import { GetTradeOffers } from "./SteamApi/requests/IEconService.ts";
import { EOfferFilter } from "./enums/EOfferFilter.ts";
import type { TradeManager } from "./trade_manager.ts";
import { SteamApi } from "./SteamApi/mod.ts";
import { Deferred } from "./deferred.ts";

const miminumPollInterval = 1000;

export type DataPollerOptions = {
  /** 
   * Time in milliseconds. steam api will be polled every x milliseconds set by this interval. defaults to 30 seconds.
   * 
   * If you set this to a negative number, you have to call `doPoll()` yourself.
   */
  interval?: number;
  manager: TradeManager;
  /** will be used to save and load poll data. **both** save and load functions must be defined **together**. */
  savePollData?: (pollData: PollData, steamid?: string) => Promise<void> | void;
  /** will be used to save and load poll data. **both** save and load functions must be defined **together**. */
  loadPollData?:
    | ((steamid?: string) => Promise<PollData | undefined>)
    | ((steamid?: string) => PollData | undefined);
};

export type PollData = {
  /** STANDARD unix time. This is the latest updated offer time stamp of last poll. */
  offersSince: number;
  /** status of sent offers in format of Record<offerid, ETradeOfferState> */
  sent: Record<string, number>;
  /** status of received offers in format of Record<offerid, ETradeOfferState> */
  received: Record<string, number>;
  /** timestamps of offer.created in format of Record<offerid, timestamp> */
  timestamps: Record<string, number>;
};

export class DataPoller {
  private manager: TradeManager;
  private steamApi: SteamApi;
  private pollTimer: number | undefined;
  private polling = false;
  /** timestamp in milliseconds. same type as Date.now() */
  private lastPoll: number;
  private stopped = false;
  // deno-lint-ignore no-explicit-any
  private defferedPoll: Deferred<any> | undefined;
  private savePollData;
  private loadPollData;
  private loadedPollData = false;
  pollData: PollData | undefined;
  interval: number;

  constructor(options: DataPollerOptions) {
    if (!options) throw new Error("DataPollerOptions cannot be empty");

    const { interval, manager, loadPollData, savePollData } = options;
    this.manager = manager;
    this.steamApi = manager.steamApi;
    this.interval = interval || 30 * 1000;
    this.lastPoll = 0;
    if (loadPollData && savePollData) {
      this.loadPollData = loadPollData;
      this.savePollData = savePollData;
    }
  }

  start() {
    this.stopped = false;
    if (this.polling || this.defferedPoll?.isPending() || this.interval < 0) {
      return;
    }
    clearTimeout(this.pollTimer);
    this.doPoll();
  }

  async stop() {
    clearTimeout(this.pollTimer);
    this.stopped = true;
    if (this.defferedPoll) {
      try {
        await this.defferedPoll;
      } catch {
        // no need to handle
      }
    }
  }

  async doPoll(doFullUpdate?: boolean) {
    if (this.polling) return;
    this.polling = true;
    this.defferedPoll = new Deferred();

    const timeSinceLastPoll = Date.now() - this.lastPoll;
    const doingPollTooFast = timeSinceLastPoll < miminumPollInterval;
    try {
      // don't poll when key is not set
      if (!this.steamApi.hasApiKey()) {
        return;
      }

      // don't poll if we are not logged in to steam community
      if (!this.manager.steamCommunity.steamID) {
        return;
      }

      // checkAndLoadPollData
      if (!this.loadedPollData && this.loadPollData) {
        let loadedData;
        try {
          loadedData = await this.loadPollData(
            this.manager.steamCommunity.steamID.toString(),
          );
        } catch (err) {
          this.manager.emit(
            "debug",
            "loading poll data failed. error: " + err.message,
          );
        } finally {
          this.loadedPollData = true;
        }
        if (loadedData) {
          this.pollData = loadedData;
        }
      }

      if (!this.pollData) {
        this.pollData = {
          sent: {},
          received: {},
          timestamps: {},
          offersSince: 0,
        };
      }
      // end of checkAndLoadPollData

      // never allow faster than 1 second
      if (doingPollTooFast) {
        // handled by finally block
        return;
      }

      try {
        let offersSince = 0;
        let fullUpdate = false || doFullUpdate;

        if (this.pollData.offersSince) {
          // It looks like sometimes Steam can be dumb and backdate a modified offer. We need to handle this.
          // Let's add a 30-minute buffer.
          offersSince = this.pollData.offersSince - 1800;
        } else {
          fullUpdate = true;
          // Get offers up to 6 months ago
          offersSince = Math.floor(
            new Date(Date.now() - 15552000000).getTime() / 1000,
          );
        }

        const getOffersOptions = {
          filter: fullUpdate ? EOfferFilter.All : EOfferFilter.ActiveOnly,
          historicalCutoff: offersSince,
        };
        const apiresp = await this.getOffers(getOffersOptions);

        // at the end
        this.manager.emit("pollSuccess");
        if (this.savePollData) {
          try {
            if (!this.manager.steamCommunity.steamID) {
              throw new Error("steam community steamid is not set");
            }
            await this.savePollData(
              this.pollData,
              this.manager.steamCommunity.steamID.toString(),
            );
          } catch (err) {
            this.manager.emit(
              "debug",
              "saving poll data load failed. error: " + err.message,
            );
          }
        }
      } catch (err) {
        this.manager.emit(
          "debug",
          "poll request failed at: " + new Date().toUTCString() +
            "\n Reason: " + err.message,
        );
        this.manager.emit("pollFailure", err);
      } finally {
        this.lastPoll = Date.now();
      }
    } finally {
      // repeat
      if (!this.stopped) {
        if (this.interval >= 0) {
          let delay = this.interval;
          if (doingPollTooFast) {
            delay = miminumPollInterval - timeSinceLastPoll;
          }
          setTimeout(this.doPoll.bind(this), delay);
        }
      }
      this.polling = false;
      this.defferedPoll.resolve();
    }
  }

  async getOffers(
    options: {
      filter?: EOfferFilter;
      /** Standard Unix timestamp */
      historicalCutoff?: number;
    },
  ) {
    const {
      filter = EOfferFilter.All,
      historicalCutoff = Math.floor(
        new Date(Date.now() + 31536000000).getTime() / 1000,
      ),
    } = options || {};

    if (!EOfferFilter[filter]) {
      throw new Error(
        'Unexpected value "' + filter +
          '" for "filter" parameter. Expected a value from the EOfferFilter enum.',
      );
    }

    if (typeof historicalCutoff !== "number") {
      throw new Error(
        'Unexpected value "' + historicalCutoff +
          '" for "historicalCutoff" parameter. Expected a number.',
      );
    }

    const getTraderOffersOptions = {
      "get_sent_offers": true,
      "get_received_offers": true,
      "get_descriptions": false,
      "language": this.manager.languageName,
      "active_only": filter === EOfferFilter.ActiveOnly,
      "historical_only": filter === EOfferFilter.HistoricalOnly,
      "time_historical_cutoff": historicalCutoff,
    };

    const apiresp = await this.steamApi.fetch(
      new GetTradeOffers(getTraderOffersOptions),
    );

    return apiresp;
  }
}
