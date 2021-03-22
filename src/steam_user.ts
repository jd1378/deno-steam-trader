import { Evt } from "../deps.ts";

export class SteamUser {
  evt = new Evt<
    | ["tradeOffers", null]
    | ["newItems", null]
  >();
}
