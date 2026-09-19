export { RoomDO } from "./room";

const WS_ROUTE = /^\/api\/rooms\/([^/]+)\/ws$/;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(WS_ROUTE);

    if (match) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 400 });
      }
      const roomCode = match[1];
      const id = env.ROOM.idFromName(roomCode);
      const stub = env.ROOM.get(id);
      return stub.fetch(request);
    }

    // Everything else (the SPA shell, its assets, and deep links like
    // /play/:code) falls through to the static assets binding. No matching
    // asset resolves to the SPA shell via not_found_handling in wrangler.jsonc.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
