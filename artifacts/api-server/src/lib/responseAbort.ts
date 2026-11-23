import type { Response } from "express";

export function createResponseAbortController(
  response: Pick<Response, "once" | "writableEnded">,
): AbortController {
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  return controller;
}
