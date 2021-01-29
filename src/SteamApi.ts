import { ServiceRequest } from "./SteamApis/ServiceRequest.ts";

export class SteamApi {
  apikey: string;

  static baseURL = "https://api.steampowered.com";

  constructor(apikey: string) {
    this.apikey = apikey;
  }

  /**
   * fetch a ServiceRequest object
   * @param serviceRequest - see src/SteamApis/ folder for available requests
   */
  async fetch(serviceRequest: ServiceRequest) {
    // replace booleans in getParams with 1 and 0
    // remove undefined values in getParams
    if (serviceRequest.getParams) {
      for (const key of Object.keys(serviceRequest.getParams)) {
        if (typeof serviceRequest.getParams[key] === "boolean") {
          serviceRequest.getParams[key] = serviceRequest.getParams[key] ? 1 : 0;
        } else if (serviceRequest.getParams[key] === undefined) {
          delete serviceRequest.getParams[key];
        }
      }
    }

    let fetchURL =
      `${SteamApi.baseURL}/${serviceRequest.iface}/${serviceRequest.functionName}/${serviceRequest.version}/?`;

    if (serviceRequest.method === "GET") {
      fetchURL += new URLSearchParams({
        key: this.apikey,
        ...serviceRequest.getParams,
      }).toString();
    } else if (
      serviceRequest.body && typeof serviceRequest.body.set === "function"
    ) {
      serviceRequest.body.set("key", this.apikey);
    }

    let result = await fetch(fetchURL, {
      method: serviceRequest.method,
      // no body when sending "GET" requests
      body: serviceRequest.method === "GET" ? undefined : serviceRequest.body,
    }).then((r) => r.json()); // all steam apis respond with json by default (?)

    if (typeof serviceRequest.postProcess === "function") {
      result = await serviceRequest.postProcess(result);
    }

    return result;
  }
}
