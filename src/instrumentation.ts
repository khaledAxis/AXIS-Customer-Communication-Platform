import type { Instrumentation } from "next";

/** Safe operational signal: never serialize an error, request, URL, headers, or actor. */
export const onRequestError: Instrumentation.onRequestError = (_error, _request, context) => {
  const type = ["render", "route", "action", "proxy"].includes(context.routeType)
    ? context.routeType : "unknown";
  console.error(JSON.stringify({
    event: "request_failed",
    routeType: type,
    at: new Date().toISOString(),
  }));
};

