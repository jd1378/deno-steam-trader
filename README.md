# deno-steam-trader

This is a steam trading library built for deno. I have followed [DoctorMcKay/node-steam-tradeoffer-manager](https://github.com/DoctorMcKay/node-steam-tradeoffer-manager)'s library in a lot of features/functions in my library. However I have changed and improved some parts of it to my liking. This library is not tested and not used by myself **yet** (I use the DoctorMcKay's myself right now).

Currently only polling is supported (no steam-user like functionality).

The aim of this project was to improve security of the bot using deno's permission system.

Currently I don't have enough time to support this project due to personal life issues (I wont be available since ~ 20 FEB 2021 till around 2022). But I will try to merge pull requests if any is made after the end of march.

## Usage

by using the exported `createTradeManager` function you can easily get it up and running through ts types I guess. I will add more docs as soon as I have the time.

## Warning

This module doesn't have any tests And is in early stages, meaning there is possibly a lot of bugs, use at your own discretion.

Till stable v1.0.0 release, patch versions may contain a new feature or a fix, minor versions will indicate a breaking change.

## Example Usage

```ts
import { createTradeManager, ETradeOfferState, TradeOffer } from "./mod.ts";

const tradeManager = await createTradeManager({
  language: "en",
  communityOptions: {
    username: "your_steam_username",
    password: "your_steam_password",
    sharedSecret: "your shared secret", // or a function that will return the generated code as a string,
    identitySecret: "your identity secret" // or a function that will return the generated key needed for requests,
  },
  // use `getDescriptions: true` if you want item information like market_hash_name to be available when loading offers (does not affect getUserInventoryContents)
  // But know that if getting the descriptions fail, it will fail the whatever operation that needs retrieving offers.
  // it is `false` by default because it does extra requests unnecessarily for some use cases.
}, console.log);

tradeManager.on("unknownOfferSent", (offer: TradeOffer) => {
  console.log("unknownOfferSent: ", offer.id);
});

tradeManager.on("sentOfferChanged", (offer: TradeOffer) => {
  console.log("sentOfferChanged: ", offer.id);
});

tradeManager.on("receivedOfferChanged", (offer: TradeOffer) => {
  console.log("receivedOfferChanged: ", offer.id);
});

tradeManager.on("newOffer", (offer: TradeOffer) => {
  console.log(
    "newOffer: ",
    offer.id,
    offer.isGiftToMe() ? "(is gift)" : "(is taking items)",
  );
  if (offer.isGiftToMe()) {
    offer.accept(true);
    console.log("accepted gift offer");
  } else {
    offer.decline();
    console.log("declined non-gift offer");
  }
});


// example for making an offer

// Item data like market_hash_name should be always available, whether `tradeManager.getDescriptions` is true or not.
const data = await tradeManager.steamCommunity.getUserInventoryContents({
  appID: 440, // TF2
  contextID: "2",
  userID: tradeManager.steamID!, // our own steam id
  tradableOnly: false,
});

for (const item of data.inventory) {
  if (item?.market_hash_name?.includes("Vintage Flare Gun")) { // find an item named Vintage Flare Gun
    const off1 = tradeManager.createOffer(
      "https://steamcommunity.com/tradeoffer/new/?partner=xxxxxxxx&token=xxxxxxxx", // your target user trade url
    ); // throws on invalid SteamID

    off1.addMyItem(item);
    await off1.send(); // throws on failure

    // check the state of offer after sending it, if it needs confirmation, you can confirm it easily:
    if (off1.state === ETradeOfferState.CreatedNeedsConfirmation) { 
      console.log("created offer, needs confirmation");
      await off1.confirm(); // throws on failure
      console.log("confirmed offer");
    }
    break;
  }
}


// also you can confirm an offer id, if you have one:
await tradeManager.steamCommunity.confirmationService.allowOffer('yourofferid'); // throws on failure
```
