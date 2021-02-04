import { ServiceRequest } from "./requests/ServiceRequest.ts";
import { wrapFetchWithHeaders } from "../../deps.ts";
import { DEFAULT_USERAGENT } from "../fetch_utils.ts";

type ServiceResponse<T extends ServiceRequest> = T["responseStructure"];

export class SteamApi {
  apikey: string;
  wrappedFetch;

  static baseURL = "https://api.steampowered.com";

  constructor(apikey: string) {
    this.apikey = apikey;
    this.wrappedFetch = wrapFetchWithHeaders({ userAgent: DEFAULT_USERAGENT });
  }

  setApiKey(key: string) {
    this.apikey = key;
  }

  /**
   * fetch a ServiceRequest object
   * @param serviceRequest - see src/SteamApis/ folder for available requests
   */
  async fetch<T extends ServiceRequest>(
    serviceRequest: T,
  ): Promise<ServiceResponse<T>> {
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

    let result = await this.wrappedFetch(fetchURL, {
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
