import { Router, type IRouter } from "express";
import circuitsRouter from "./circuits";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(circuitsRouter);

export default router;
