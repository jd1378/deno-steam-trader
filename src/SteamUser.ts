import { EventEmitter, SteamID } from "../deps.ts";

class SteamUser extends EventEmitter {
  steamID: SteamID | undefined;
}
