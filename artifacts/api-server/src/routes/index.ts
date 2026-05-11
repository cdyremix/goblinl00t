import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import giveawayRouter from "./giveaway";
import lootRouter from "./loot";
import statsRouter from "./stats";
import commandsRouter from "./commands";
import usersRouter from "./users";
import authRouter from "./auth";
import settingsRouter from "./settings";
import steamRouter from "./steam";
import tradeFulfillmentsRouter from "./trade-fulfillments";
import pointsRouter from "./points";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(giveawayRouter);
router.use(lootRouter);
router.use(statsRouter);
router.use(commandsRouter);
router.use(usersRouter);
router.use(authRouter);
router.use(settingsRouter);
router.use(steamRouter);
router.use(tradeFulfillmentsRouter);
router.use(pointsRouter);

export default router;
