import { GetTradeOffers } from "./SteamApi/requests/IEconService.ts";
import { EOfferFilter } from "./enums/EOfferFilter.ts";
import type { TradeManager } from "./trade_manager.ts";
import { SteamApi } from "./SteamApi/mod.ts";
import { Deferred } from "./deferred.ts";
import { isNonTerminalState, TradeOffer } from "./trade_offer.ts";
import { ETradeOfferState } from "./enums/ETradeOfferState.ts";
import { EConfirmationMethod } from "./enums/EConfirmationMethod.ts";
import { fastConcat, hasNoName } from "./utils.ts";

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
  /** per offer custom cancelTimes in format of Record<offerid, number> (milliseconds) */
  cancelTimes: Record<string, number>;
  /** per offer custom pendingCancelTimes in format of Record<offerid, number> (milliseconds) */
  pendingCancelTimes: Record<string, number>;
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
  pollData: PollData;
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

    this.pollData = {
      sent: {},
      received: {},
      timestamps: {},
      offersSince: 0,
      cancelTimes: {},
      pendingCancelTimes: {},
    };
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

  private deleteOldProps(offerid: string) {
    delete this.pollData.sent[offerid];
    delete this.pollData.received[offerid];
    delete this.pollData.cancelTimes[offerid];
    delete this.pollData.pendingCancelTimes[offerid];
    delete this.pollData.timestamps[offerid];
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

      // don't poll if we don't have SteamID of this account.
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
          // merge current data before replacing
          Object.assign(loadedData.received, this.pollData.received);
          Object.assign(loadedData.sent, this.pollData.sent);
          Object.assign(loadedData.timestamps, this.pollData.timestamps);
          this.pollData = loadedData;
        }
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
        let hasGlitchedOffer = false;

        apiresp.sentOffers.forEach((offer) => {
          if (!offer.id) {
            this.manager.emit(
              "debug",
              "Warning: an offer id in sent offers of response is not set. skipping.",
              offer,
            );
            return;
          }

          if (!this.pollData.sent[offer.id]) {
            // We sent this offer, but we have no record of it!
            // maybe someone made an offer outside the bot
            // or maybe the newly sent offer has not finished yet
            // either the case, only emit the `unknownOfferSent` event if currently there's no pending send offer requests
            if (!this.manager.pendingSendOffersCount) {
              if (offer.fromRealTimeTrade) {
                // This is a real-time trade offer.
                if (
                  offer.state === ETradeOfferState.CreatedNeedsConfirmation ||
                  (offer.state === ETradeOfferState.Active &&
                    offer.confirmationMethod != EConfirmationMethod.None)
                ) {
                  // we need to confirm this
                  this.manager.emit("realTimeTradeConfirmationRequired", offer);
                } else if (offer.state === ETradeOfferState.Accepted) {
                  // both parties confirmed, trade complete
                  this.manager.emit("realTimeTradeCompleted", offer);
                }
              }

              this.manager.emit("unknownOfferSent", offer);
              if (isNonTerminalState(offer)) {
                this.pollData.sent[offer.id] = offer.state;
                this.pollData.timestamps[offer.id] = offer.updated!.getTime() /
                  1000;
              } else {
                this.deleteOldProps(offer.id);
              }
            }
          } else if (offer.state !== this.pollData.sent[offer.id]) {
            if (!offer.isGlitched()) {
              // We sent this offer, and it has now changed state
              if (
                offer.fromRealTimeTrade &&
                offer.state == ETradeOfferState.Accepted
              ) {
                this.manager.emit("realTimeTradeCompleted", offer);
              }

              this.manager.emit(
                "sentOfferChanged",
                offer,
                this.pollData.sent[offer.id],
              );
              if (isNonTerminalState(offer)) {
                this.pollData.sent[offer.id] = offer.state;
                this.pollData.timestamps[offer.id] = offer.updated!.getTime() /
                  1000;
              } else {
                this.deleteOldProps(offer.id);
              }
            } else {
              hasGlitchedOffer = true;
              let countWithoutName = 0;
              if (this.manager.getDescriptions) {
                countWithoutName = offer.itemsToGive.filter(hasNoName).length +
                  offer.itemsToReceive.filter(hasNoName).length;
              }
              this.manager.emit(
                "debug",
                "Not emitting sentOfferChanged for " + offer.id +
                  " right now because it's glitched (" +
                  offer.itemsToGive.length + " to give, " +
                  offer.itemsToReceive.length + " to receive," +
                  countWithoutName + " without name",
              );
            }
          }

          if (offer.state === ETradeOfferState.Active) {
            // The offer is still Active, and we sent it. See if it's time to cancel it automatically.
            const cancelTime = this.pollData.cancelTimes[offer.id] ||
              this.manager.cancelTime;

            if (
              cancelTime &&
              (Date.now() - offer.updated!.getTime() >= cancelTime)
            ) {
              const offerid = offer.id;
              offer.cancel().then(() => {
                this.deleteOldProps(offerid);
                this.manager.emit("sentOfferCanceled", offer, "cancelTime");
              }).catch((err) =>
                this.manager.emit(
                  "debug",
                  "Can't auto-cancel offer #" + offerid + ": " + err.message,
                )
              );
            }
          }

          if (
            offer.state == ETradeOfferState.CreatedNeedsConfirmation &&
            this.manager.pendingCancelTime
          ) {
            // The offer needs to be confirmed to be sent. Let's see if the maximum time has elapsed before we cancel it.
            const pendingCancelTime =
              this.pollData.pendingCancelTimes[offer.id] ||
              this.manager.pendingCancelTime;

            if (
              pendingCancelTime &&
              (Date.now() - offer.created!.getTime() >= pendingCancelTime)
            ) {
              const offerid = offer.id;
              offer.cancel().then(() => {
                this.deleteOldProps(offerid);
                this.manager.emit(
                  "sentPendingOfferCanceled",
                  offer,
                  "pendingCancelTime",
                );
              }).catch((err) =>
                this.manager.emit(
                  "debug",
                  "Can't auto-cancel pending-confirmation offer #" + offer.id +
                    ": " + err.message,
                )
              );
            }
          }
        });

        if (this.manager.cancelOfferCount) {
          // TODO make sure works fine
          const sentActive: Array<[string, number]> = apiresp.sentOffers.filter(
            (offer) => offer.state === ETradeOfferState.Active,
          ).map((offer) => [offer.id!, offer.state]);
          const polledSentActive = Object.entries(this.pollData.sent).filter((
            [_, state],
          ) => state === ETradeOfferState.Active);
          fastConcat(sentActive, polledSentActive);

          if (sentActive.length >= this.manager.cancelOfferCount) {
            const cancelThisMany = sentActive.length -
              this.manager.cancelOfferCount;
            sentActive.sort((a, b) => {
              // if a is older (meaning number is smaller)
              // it will move to start of array
              // because smaller minus bigger is always smaller than 0
              return this.pollData.timestamps[a[0]] -
                this.pollData.timestamps[b[0]];
            });
            for (let i = 0; i < cancelThisMany; i++) {
              if (sentActive[i] && sentActive[i][0]) {
                const offerid = sentActive[i][0];
                if (
                  this.manager.cancelOfferCountMinAge &&
                  Date.now() - this.pollData.timestamps[offerid] <
                    this.manager.cancelOfferCountMinAge
                ) {
                  continue;
                }

                TradeOffer.fromOfferId(this.manager, offerid).then(
                  (tradeOffer) => {
                    tradeOffer.cancel().then(() => {
                      this.deleteOldProps(offerid);
                      this.manager.emit(
                        "sentOfferCanceled",
                        tradeOffer,
                        "cancelOfferCount",
                      );
                    }).catch((err) => {
                      this.manager.emit(
                        "debug",
                        "Can't auto-cancel offer #" + tradeOffer.id + ": " +
                          err.message,
                      );
                    });
                  },
                );
              }
            }
          }
        }

        apiresp.receivedOffers.forEach((offer) => {
          if (!offer.id) {
            this.manager.emit(
              "debug",
              "Warning: an offer id in received offers of response is not set. skipping.",
              offer,
            );
            return;
          }

          if (offer.isGlitched()) {
            hasGlitchedOffer = true;
            return;
          }

          if (offer.fromRealTimeTrade) {
            // This is a real-time trade offer
            if (
              !this.pollData.received[offer.id] &&
              (offer.state === ETradeOfferState.CreatedNeedsConfirmation ||
                (offer.state === ETradeOfferState.Active &&
                  offer.confirmationMethod !== EConfirmationMethod.None))
            ) {
              this.manager.emit("realTimeTradeConfirmationRequired", offer);
            } else if (
              offer.state == ETradeOfferState.Accepted &&
              (!this.pollData.received[offer.id] ||
                (this.pollData.received[offer.id] !== offer.state))
            ) {
              this.manager.emit("realTimeTradeCompleted", offer);
            }
          }

          if (
            !this.pollData.received[offer.id] &&
            offer.state === ETradeOfferState.Active
          ) {
            this.manager.emit("newOffer", offer);
          } else if (
            this.pollData.received[offer.id] &&
            offer.state !== this.pollData.received[offer.id]
          ) {
            this.manager.emit(
              "receivedOfferChanged",
              offer,
              this.pollData.received[offer.id],
            );
          }

          if (isNonTerminalState(offer)) {
            this.pollData.received[offer.id] = offer.state;
            this.pollData.timestamps[offer.id] = offer.updated!.getTime() /
              1000;
          } else {
            this.deleteOldProps(offer.id);
          }
        });

        // TODO make sure works fine
        // move historical cutoff based on oldest non-terminal offer
        // because we have handled terminal ones already and not gonna do anything with them anymore
        if (!hasGlitchedOffer) {
          if (
            apiresp.oldestNonTerminal &&
            apiresp.oldestNonTerminal < apiresp.requestedAt
          ) {
            this.pollData.offersSince = apiresp.oldestNonTerminal;
          } else {
            this.pollData.offersSince = apiresp.requestedAt;
          }
        }

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
        new Date(Date.now() - 31536000000).getTime() / 1000,
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
    // set request time to 30 minutes prior to now.
    // UNIX timestamp
    const requestedAt = Math.floor((Date.now() / 1000) - 1800);
    const apiresp = await this.steamApi.fetch(
      new GetTradeOffers(getTraderOffersOptions),
    );

    let oldestNonTerminalTimestamp = Infinity;

    const sentPromises = apiresp?.response?.trade_offers_sent?.map((offer) => {
      if (
        offer.time_updated < oldestNonTerminalTimestamp &&
        isNonTerminalState(offer)
      ) {
        oldestNonTerminalTimestamp = offer.time_updated;
      }
      return TradeOffer.from(this.manager, offer);
    });
    let sentOffers: Array<TradeOffer> = [];

    const receivedPromises = apiresp?.response?.trade_offers_received?.map(
      (offer) => {
        if (
          offer.time_updated < oldestNonTerminalTimestamp &&
          isNonTerminalState(offer)
        ) {
          oldestNonTerminalTimestamp = offer.time_updated;
        }
        return TradeOffer.from(this.manager, offer);
      },
    );
    let receivedOffers: Array<TradeOffer> = [];

    if (sentPromises?.length) {
      sentOffers = await Promise.all(sentPromises);
    }
    if (receivedPromises?.length) {
      receivedOffers = await Promise.all(receivedPromises);
    }

    const result = {
      sentOffers,
      receivedOffers,
      /** UNIX Timestamp */
      oldestNonTerminal: Number.isFinite(oldestNonTerminalTimestamp)
        ? oldestNonTerminalTimestamp
        : undefined,
      /** UNIX Timestamp */
      requestedAt,
    };

    return result;
  }
}
