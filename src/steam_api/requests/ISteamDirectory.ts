// deno-lint-ignore-file camelcase

import { Methods, ServiceRequest } from "./ServiceRequest.ts";

abstract class ISteamDirectoryRequest extends ServiceRequest {
  constructor() {
    super();
    this.iface = "ISteamDirectory";
  }

  iface: string;
}

export type GetCMListResult = {
  tcp_servers: Array<string>;
  websocket_servers: Array<string>;
  auto_pct_websocket: number;
  requested_at: number;
  result: number;
  message: string;
};

export class GetCMList extends ISteamDirectoryRequest {
  method = Methods.GET;
  functionName = "GetCMList";
  version = "v1";

  constructor(options: {
    /** Client's Steam cell ID. Use 0 when not logged in. after login, use the provided cellid by steam. */
    cellid: number | string;
    /** Max number of servers to return */
    maxcount?: number;
  }) {
    super();
    this.getParams = {
      ...options,
    };
  }

  // deno-lint-ignore no-explicit-any
  postProcess(res: { response: Record<string, any> }): GetCMListResult {
    if (!res?.response || !res?.response?.result) {
      throw new Error("Cannot get CM list");
    }

    res.response.requested_at = Date.now();

    return res.response as GetCMListResult;
  }
}

export type GetCSListResult = {
  serverlist: Array<string>;
  requested_at: number;
  result: number;
  message: string;
};

export class GetCSList extends ISteamDirectoryRequest {
  method = Methods.GET;
  functionName = "GetCSList";
  version = "v1";

  constructor(options: {
    /** Client's Steam cell ID */
    cellid: number | string;
    /** Max number of servers to return */
    maxcount?: number;
  }) {
    super();
    this.getParams = {
      ...options,
    };
  }

  // deno-lint-ignore no-explicit-any
  postProcess(res: { response: Record<string, any> }): GetCSListResult {
    if (!res?.response || !res?.response?.result) {
      throw new Error("Cannot get CS list");
    }

    res.response.requested_at = Date.now();

    return res.response as GetCSListResult;
  }
}
