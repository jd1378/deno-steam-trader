/**
 * I could not think of a better approach to this at the time of writing this, because:
 * 1. I had a time limit
 * 2. Interfaces have some bug which makes using it unfeasable: https://github.com/microsoft/TypeScript/issues/22815
 */
export abstract class ServiceRequest {
  /** name of service interface
   * @example "ISteamEconomy"
   */
  abstract iface: string;
  /** HTTP Method */
  abstract method: Methods;
  /** name of function in service interface
   * @example "GetAssetClassInfo"
   */
  abstract functionName: string;
  /** an object to use as "GET" parameters */
  getParams?: Record<string, string | number | boolean | undefined>;
  /** the form data to send. optional.
   * Only will be sent if the http `method` used supports sending body.
   */
  body?: FormData;
  /** version of service function. it is used in url directly after function name.
   * @example "v1"
   */
  abstract version: string;

  /** a method that if defined, will be called with JSON-parsed result of the request. can be async. */
  postProcess?(response: unknown): unknown | Promise<unknown>;
}

export enum Methods {
  "GET" = "GET",
  "POST" = "POST",
  "DELETE" = "DELETE",
  "PATCH" = "PATCH",
  "PUT" = "PUT",
}
