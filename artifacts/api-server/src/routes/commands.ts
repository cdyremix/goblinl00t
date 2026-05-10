import { Router, type IRouter } from "express";
import { ToggleCommandParams } from "@workspace/api-zod";
import { getCommandConfig, toggleCommandEnabled } from "../bot/bot-service";

const router: IRouter = Router();

router.get("/commands", (_req, res) => {
  res.json(getCommandConfig());
});

router.post("/commands/:name/toggle", (req, res) => {
  const { name } = ToggleCommandParams.parse({ name: req.params["name"] });
  try {
    const enabled = toggleCommandEnabled(name);
    const config = getCommandConfig().find((c) => c.name === name);
    res.json(config ?? { name, description: "", enabled, cooldownSeconds: 10 });
  } catch (err) {
    res.status(404).json({ error: "Command not found" });
  }
});

export default router;
