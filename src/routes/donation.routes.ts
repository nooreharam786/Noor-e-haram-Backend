import { Router } from "express";
import { createDonation, createDonationSchema, getMyDonations, verifyDonation, verifyDonationSchema } from "../controllers/donation.controller";
import { authenticate, optionalAuthenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";

export const donationRoutes = Router();

donationRoutes.post("/", optionalAuthenticate, validate(createDonationSchema), createDonation);
donationRoutes.post("/verify", validate(verifyDonationSchema), verifyDonation);
donationRoutes.get("/me", authenticate, getMyDonations);

