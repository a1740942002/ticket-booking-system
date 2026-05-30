import { Hono } from "hono";
import { auth } from "./routes/auth";
import { eventsRoute } from "./routes/events";
import { ordersRoute } from "./routes/orders";
import { seatsRoute } from "./routes/seats";

export const app = new Hono();
app.route("/auth", auth);
app.route("/events", eventsRoute);
app.route("/orders", ordersRoute);
app.route("/seats", seatsRoute);
