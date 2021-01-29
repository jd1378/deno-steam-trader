import { Methods, ServiceRequest } from "./ServiceRequest.ts";

abstract class ISteamEconomyRequest extends ServiceRequest {
  constructor() {
    super();
    this.iface = "ISteamEconomy";
  }

  iface: string;
}

export type GetAssetClassInfoOptions = {
  appid: string | number;
  language?: string;
  description?: string;
  // class_count: number; // handled by class
  /** an array of objects that have `classid` prop. can have `instanceid` prop for finer details */
  classList: Array<{ classid: string; instanceid?: string }>;

  /** if true, will bypass fixing malformed arrays in the response */
  skipFix?: boolean;
};

export class GetAssetClassInfo extends ISteamEconomyRequest {
  method = Methods.GET;
  functionName = "GetAssetClassInfo";
  version = "v1";

  skipFix = false;

  constructor(options: GetAssetClassInfoOptions) {
    super();
    // undefined values are removed by SteamApi class before sending request.
    const params = {
      appid: options.appid,
      language: options.language,
      description: options.description,
      // deno-lint-ignore camelcase
      class_count: options.classList.length,
    };
    this.getParams = {
      ...params,
      ...options.classList.map((val, index) => {
        const param = {
          ["classid" + index]: val.classid,
        };
        if (val.instanceid !== undefined) {
          param["instanceid" + index] = val.instanceid;
        }
        return param;
      }).reduce((accumulator, current) => {
        return Object.assign(accumulator, current);
      }, {}),
    };
  }

  /**
   * fixes the malformed array. simply object with index numbers to array conversion.
   * @param obj - the object containing the prop (array) that needs to be fixed
   * @param key - the key of prop to access on obj
   */
  // deno-lint-ignore no-explicit-any
  fixArray(obj: Record<string, any>, key: string) {
    if (obj[key] && (obj[key] as Record<string, unknown>)["0"]) {
      const arr = [];
      for (let i = 0; i < Object.keys(obj[key]).length; i++) {
        arr.push(obj[key][i]);
      }
      obj[key] = arr;
    }
  }

  // deno-lint-ignore no-explicit-any
  postProcess(response: { result: Record<string, any> }) {
    if (this.skipFix) {
      return response;
    }
    if (!response.result) {
      throw new Error("Malformed Response");
    }

    const result = response.result;

    for (const descKey of Object.keys(result)) {
      this.fixArray(result[descKey], "fraudwarnings");
      this.fixArray(result[descKey], "descriptions");
      this.fixArray(result[descKey], "owner_descriptions");
      this.fixArray(result[descKey], "actions");
      this.fixArray(result[descKey], "owner_actions");
      this.fixArray(result[descKey], "market_actions");
      this.fixArray(result[descKey], "tags");
    }

    return result;
  }
}
