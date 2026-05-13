import { Router, type IRouter } from "express";
import { GetBotStatusResponse, RestartBotResponse } from "@workspace/api-zod";
import { getBotState, restartBot, partChannel, joinChannel } from "../bot/bot-service";
import { requireStreamerChannel } from "../lib/auth-helpers";

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

/**
 * POST /bot/part-channel — soft-disconnect the bot from the caller's Twitch
 * channel. Twitch OAuth link is preserved; the streamer can rejoin at any time.
 * Uses requireStreamerChannel so the caller must have a linked Twitch account.
 */
router.post("/bot/part-channel", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  await partChannel(ctx.channel);
  const state = getBotState();
  res.json({
    connected: state.connected,
    channel: state.channel,
    channels: state.channels,
    username: state.username,
    uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000) : null,
    lastMessageAt: state.lastMessageAt?.toISOString() ?? null,
  });
});

/**
 * POST /bot/join-channel — re-add the bot to the caller's Twitch channel after
 * a soft disconnect. No-ops gracefully if already joined.
 */
router.post("/bot/join-channel", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  await joinChannel(ctx.channel);
  const state = getBotState();
  res.json({
    connected: state.connected,
    channel: state.channel,
    channels: state.channels,
    username: state.username,
    uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000) : null,
    lastMessageAt: state.lastMessageAt?.toISOString() ?? null,
  });
});

export default router;
