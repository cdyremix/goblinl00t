import { Router, type IRouter } from "express";
import { GetBotStatusResponse, RestartBotResponse } from "@workspace/api-zod";
import { getBotState, restartBot } from "../bot/bot-service";

const router: IRouter = Router();

router.get("/bot/status", (_req, res) => {
  const state = getBotState();
  const data = GetBotStatusResponse.parse({
    connected: state.connected,
    channel: state.channel,
    channels: state.channels,
    username: state.username,
    uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000) : null,
    lastMessageAt: state.lastMessageAt?.toISOString() ?? null,
  });
  res.json(data);
});

router.post("/bot/restart", async (req, res) => {
  const state = await restartBot();
  const data = RestartBotResponse.parse({
    connected: state.connected,
    channel: state.channel,
    channels: state.channels,
    username: state.username,
    uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000) : null,
    lastMessageAt: state.lastMessageAt?.toISOString() ?? null,
  });
  res.json(data);
});

export default router;
