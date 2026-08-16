import { Router } from "express";
import { apply, applySchema, markPaid, myApplication, getMyDraws, downloadTicket, states, updateMyApplication, updateApplicationById, updateMyApplicationSchema } from "../controllers/application.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";

export const applicationRoutes = Router();

applicationRoutes.get("/states", states);
applicationRoutes.use(authenticate);
applicationRoutes.post("/", validate(applySchema), apply);
applicationRoutes.get("/me", myApplication);
applicationRoutes.put("/me", validate(updateMyApplicationSchema), updateMyApplication);
applicationRoutes.get("/my-draws", getMyDraws);
applicationRoutes.put("/:id", validate(updateMyApplicationSchema), updateApplicationById);
applicationRoutes.get("/:id/ticket/pdf", downloadTicket);
applicationRoutes.patch("/me/payment", markPaid);
