import { Router } from "express";
import {
  createFeedback,
  createFeedbackSchema,
  getPublicContent,
  getPublicAnnouncements,
  getPublicDuaGuidelines,
  getPublicGalleryItems,
  listPublicDocuments,
  listPublicFeedback
} from "../controllers/content.controller";
import { validate } from "../middleware/validate";

import { getActiveMarqueeMessages } from "../controllers/content.marquee";
import { getPublicWinners } from "../controllers/admin.draws";
import { submitPublicContactForm } from "../controllers/admin.cms.controller";

export const contentRoutes = Router();

contentRoutes.get("/public", getPublicContent);
contentRoutes.get("/documents", listPublicDocuments);
contentRoutes.get("/feedback", listPublicFeedback);
contentRoutes.post("/feedback", validate(createFeedbackSchema), createFeedback);
contentRoutes.get("/marquee", getActiveMarqueeMessages);
contentRoutes.get("/winners", getPublicWinners);

// CMS Public Endpoints
contentRoutes.get("/announcements", getPublicAnnouncements);
contentRoutes.get("/dua-guidelines", getPublicDuaGuidelines);
contentRoutes.get("/gallery-items", getPublicGalleryItems);
contentRoutes.post("/contact/support", submitPublicContactForm);

// Public Org Settings (for PDF generators on public website)
import { getOrgSettings } from "../services/orgSettings.service";
contentRoutes.get("/org-settings", async (_req, res, next) => {
  try {
    const settings = await getOrgSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    next(err);
  }
});

