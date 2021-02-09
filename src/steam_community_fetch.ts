import {
  CookieJar,
  wrapFetchWithCookieJar,
  wrapFetchWithHeaders,
} from "../deps.ts";
import { DEFAULT_USERAGENT } from "./fetch_utils.ts";
import type { SteamCommunity } from "./steam_community.ts";

export function getFetchAndCookieJar(community: SteamCommunity) {
  const cookieJar = new CookieJar();
  const wrappedWithCookiesFetch = wrapFetchWithCookieJar({
    cookieJar,
  });

  const wrappedWithHeaders = wrapFetchWithHeaders({
    fetch: wrappedWithCookiesFetch,
    userAgent: DEFAULT_USERAGENT,
    validator: async function communityResponseValidator(response: Response) {
      const responseText = await response.clone().text(); // allow for subsequent reads
      checkHTTPError(community, response, responseText);
      checkCommunityError(community, responseText);
      checkTradeError(responseText);
    },
  });

  return {
    fetch: wrappedWithHeaders,
    cookieJar,
  };
}

function checkHTTPError(
  community: SteamCommunity,
  response: Response,
  responseText: string | undefined,
) {
  let err;

  if (
    response.status >= 300 && response.status <= 399 &&
    (response.headers.get("location") || "").indexOf("/login") !== -1
  ) {
    err = new Error("Not Logged In");
    community._notifySessionExpired(err);
    throw err;
  }

  if (
    response.status === 403 && responseText &&
    responseText.match(
      /<div id="parental_notice_instructions">Enter your PIN below to exit Family View.<\/div>/,
    )
  ) {
    err = new Error("Family View Restricted");
    community._notifyFamilyViewRestricted(err);
    throw err;
  }

  if (response.status >= 400) {
    err = new Error("HTTP error " + response.status);
    throw err;
  }
}

function checkCommunityError(
  community: SteamCommunity,
  responseText: string | undefined,
) {
  if (
    typeof responseText === "string" && /<h1>Sorry!<\/h1>/.test(responseText)
  ) {
    const match = responseText.match(/<h3>(.+)<\/h3>/);
    throw new Error(match ? match[1] : "Unknown error occurred");
  }

  if (
    typeof responseText === "string" &&
    responseText.match(/g_steamID = false;/) &&
    responseText.match(/<h1>Sign In<\/h1>/)
  ) {
    const err = new Error("Not Logged In");
    community._notifySessionExpired(err);
    throw err;
  }
}

function checkTradeError(
  responseText: string | undefined,
) {
  if (typeof responseText === "string") {
    const match = responseText.match(
      /<div id="error_msg">\s*([^<]+)\s*<\/div>/,
    );
    if (match) {
      throw new Error(match[1].trim());
    }
  }
}
