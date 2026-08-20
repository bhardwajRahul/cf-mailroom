import { Hono } from "hono";
import { api } from "./api";
import { receiveEmail } from "./email/receive";

const app = new Hono<{ Bindings: Env }>();
app.route("/api", api);

export default {
  fetch: app.fetch,
  email: receiveEmail,
} satisfies ExportedHandler<Env>;
