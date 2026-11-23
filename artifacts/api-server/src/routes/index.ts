import { Router, type IRouter } from "express";
import circuitsRouter from "./circuits";
import healthRouter from "./health";
import aiUsageRouter from "./aiUsage";
import tutorRouter from "./tutor";
import circuitBuilderRouter from "./circuitBuilder";
import circuitBuilderHistoryRouter from "./circuitBuilderHistory";
import circuitBuilderMemoriesRouter from "./circuitBuilderMemories";
import kicadSymbolsRouter from "./kicadSymbols";

const router: IRouter = Router();

router.use(healthRouter);
router.use(circuitsRouter);
router.use(tutorRouter);
router.use(circuitBuilderRouter);
router.use(circuitBuilderHistoryRouter);
router.use(circuitBuilderMemoriesRouter);
router.use(kicadSymbolsRouter);
router.use(aiUsageRouter);

export default router;
