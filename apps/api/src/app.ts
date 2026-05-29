import { Hono } from "hono";
import { auth } from "./routes/auth";
import { eventsRoute } from "./routes/events";

export const app = new Hono();
app.route("/auth", auth);
app.route("/events", eventsRoute);
