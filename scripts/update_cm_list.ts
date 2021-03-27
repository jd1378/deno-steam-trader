import { resolve } from "../deps.ts";

fetch(
  "https://api.steampowered.com/ISteamDirectory/GetCMList/v1/?format=json&cellid=0",
)
  .then((resp) => resp.json())
  .then((json) => {
    if (!json.response || json.response.result != 1) {
      throw new Error("Cannot get CM list");
    }

    const servers = {
      "tcp_servers": json.response.serverlist,
      "websocket_servers": json.response.serverlist_websockets,
      "time": Date.now(),
    };

    console.log(
      "Got list of " + servers.tcp_servers.length + " TCP CMs and " +
        servers.websocket_servers.length + " WebSocket CMs from WebAPI",
    );
    Deno.writeTextFileSync(
      resolve(Deno.cwd(), "../resources/servers.json"),
      JSON.stringify(servers, null, "\t"),
    );
  })
  .catch((err) => console.log("cannot update cm list. reason: " + err.message));
