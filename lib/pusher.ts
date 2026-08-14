import PusherServer from "pusher";

// Instancia de Pusher Server para emitir eventos desde la API privada de Admin
export const pusherServer = new PusherServer({
  appId: process.env.PUSHER_APP_ID || "demo-app-id",
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || "demo-key",
  secret: process.env.PUSHER_SECRET || "demo-secret",
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "us2",
  useTLS: true,
});
