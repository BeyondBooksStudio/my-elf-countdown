import type { Handler, HandlerResponse } from "@netlify/functions";
import serverless from "serverless-http";
import { createApp } from "../../server/_core/app";

const invokeApi = serverless(createApp());
const functionPrefix = "/.netlify/functions/api";

/** Support original API rewrites and direct function URLs without a listener. */
export const handler: Handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  let path = event.path;
  if (path === functionPrefix) {
    path = "/api";
  } else if (path.startsWith(`${functionPrefix}/`)) {
    path = `/api${path.slice(functionPrefix.length)}`;
  }

  return await invokeApi(
    { ...event, path, requestPath: path },
    context
  ) as HandlerResponse;
};
