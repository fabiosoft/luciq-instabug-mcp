/**
 * Vercel function entrypoint. The vercel.json rewrite sends every request to
 * /api, and Hono dispatches internally to the right route.
 */
import { handle } from "hono/vercel";
import { app } from "../src/app.js";

export const config = {
  runtime: "nodejs",
};

export default handle(app);
