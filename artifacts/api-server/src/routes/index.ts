import { Router, type IRouter } from "express";
import circuitsRouter from "./circuits";
import healthRouter from "./health";
import aiUsageRouter from "./aiUsage";
import tutorRouter from "./tutor";

const router: IRouter = Router();

router.use(healthRouter);
router.use(circuitsRouter);
router.use(tutorRouter);
router.use(aiUsageRouter);

export default router;
