import { SteamError } from "./../steam_error.ts";
import { EResult } from "./../enums/EResult.ts";
import { ServiceRequest } from "./requests/ServiceRequest.ts";
import { wrapFetchWithHeaders } from "../../deps.ts";
import { DEFAULT_USERAGENT } from "../fetch_utils.ts";

export type ServiceResponse<T extends ServiceRequest> = T["responseStructure"];

export class SteamApi {
  apikey?: string;
  private wrappedFetch;

  static baseURL = "https://api.steampowered.com";

  constructor(apikey?: string) {
    if (apikey) {
      this.apikey = apikey;
    }
    this.wrappedFetch = wrapFetchWithHeaders({ userAgent: DEFAULT_USERAGENT });
  }

  setApiKey(key: string) {
    this.apikey = key;
  }

  hasApiKey() {
    return !!this.apikey;
  }

  /**
   * fetch a ServiceRequest object
   * @param serviceRequest - see src/SteamApis/ folder for available requests
   */
  async fetch<T extends ServiceRequest>(
    serviceRequest: T,
  ): Promise<ServiceResponse<T>> {
    if (!this.apikey) {
      throw new Error("api key not set");
    }
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

    const response = await this.wrappedFetch(fetchURL, {
      method: serviceRequest.method,
      // no body when sending "GET" requests
      body: serviceRequest.method === "GET" ? undefined : serviceRequest.body,
    });

    let body = await response.json(); // all steam apis respond with json by default (?)

    if (response.status !== 200) {
      throw new SteamError("HTTP error " + response.status, {
        body,
        eresult: body?.eresult || -1,
      });
    }

    let eresult = parseInt(response.headers.get("x-eresult") || "-1", 10);
    if (
      eresult === EResult.Fail && body &&
      (Object.keys(body).length > 1 ||
        (body.response && Object.keys(body.response).length > 0))
    ) {
      // Steam has been known to send fake Fail (2) responses when it actually worked, because of course it has
      // If we get a 2 but body is there and either body has more than one key or body.response exists and it has content,
      // ignore the 2
      eresult = 1;
    }

    if (eresult !== -1 && eresult !== 1) {
      throw new SteamError("steam error", { eresult, body });
    }

    if (!body || typeof body !== "object") {
      throw new Error("Invalid API response");
    }

    if (typeof serviceRequest.postProcess === "function") {
      const processedResult = await serviceRequest.postProcess(body);
      if (processedResult !== undefined) {
        body = processedResult;
      }
    }

    return body;
  }
}
