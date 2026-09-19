import { useState } from "react";
import { createRoot } from "react-dom/client";

const TEST_ROOM_CODE = "TEST";

function App() {
  const [reply, setReply] = useState("(no reply yet)");

  function ping() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${location.host}/api/rooms/${TEST_ROOM_CODE}/ws`);
    ws.addEventListener("open", () => ws.send("ping"));
    ws.addEventListener("message", (event) => setReply(String(event.data)));
    ws.addEventListener("error", () => setReply("(websocket error)"));
  }

  return (
    <>
      <h1>Connect GEM</h1>
      <button onClick={ping}>Ping room {TEST_ROOM_CODE}</button>
      <p>{reply}</p>
    </>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("missing #root element");
createRoot(container).render(<App />);
