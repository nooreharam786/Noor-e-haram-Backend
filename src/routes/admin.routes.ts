import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { galleryUpload, pdfUpload } from "../middleware/upload";
import { validate } from "../middleware/validate";

// Main Admin Controller
import {
  createFeedback,
  createFeedbackSchema,
  deleteDocument,
  deleteFeedback,
  listDocuments,
  listFeedback,
  listApplicants,
  listApplicantsSchema,
  listPrintApplicants,
  listUsers,
  listUsersSchema,
  printApplicantsSchema,
  removeGalleryImage,
  removeGalleryImageSchema,
  stats,
  uploadDocument,
  uploadDocumentSchema,
  uploadGalleryImages
} from "../controllers/admin.controller";

import {
  getSettings,
  updateSettings,
  updateSettingsSchema
} from "../controllers/admin.settings";

// Draw controllers
import {
  listDraws,
  createNewDraw,
  updateDrawStatus,
  executeDraw,
  deleteDraw,
  drawSchema,
  runDrawSchema,
  getDrawHistory
} from "../controllers/admin/draw.controller";

// Security controllers
import {
  changePassword,
  invalidateSessions,
  changePasswordSchema
} from "../controllers/admin/security.controller";

// Payment management controllers
import {
  listPayments,
  listPaymentsSchema,
  markPaymentSuccessful,
  exportPaymentsCsv,
  downloadAdminReceipt
} from "../controllers/admin/payment.controller";

// Donations management controllers
import {
  listAdminDonations,
  listDonationsSchema,
  exportDonationsCsv
} from "../controllers/admin/donations.controller";

// Additional Draw Controllers
import {
  setActiveDraw,
  updateApplicationControl,
  updateApplicantStatus,
  declareWinners,
  bulkMarkNotSelected,
  createBackupForDraw,
  listDrawBackups,
  getDrawBackupDetail,
  updateApplicantStatusSchema,
  declareWinnersSchema,
  updateDrawControlSchema,
  updateApplicationLimit,
  updateApplicationLimitSchema
} from "../controllers/admin.draws";

// Marquee Controllers
import {
  listAllMarqueeMessages,
  createMarqueeMessage,
  updateMarqueeMessage,
  deleteMarqueeMessage,
  createMarqueeSchema
} from "../controllers/content.marquee";

// CMS Controllers
import {
  listFeedbackCMS,
  createFeedbackCMS,
  updateFeedbackCMS,
  bulkUpdateFeedbackCMS,
  deleteFeedbackCMS,
  listAnnouncementsCMS,
  createAnnouncementCMS,
  updateAnnouncementCMS,
  deleteAnnouncementCMS,
  listDuaGuidelinesCMS,
  createDuaGuidelineCMS,
  updateDuaGuidelineCMS,
  deleteDuaGuidelineCMS,
  listGalleryCMS,
  createGalleryItemCMS,
  updateGalleryItemCMS,
  deleteGalleryItemCMS,
  getContactSettingsCMS,
  updateContactSettingsCMS,
  listContactMessagesCMS,
  getAdminCMSDashboardStats
} from "../controllers/admin.cms.controller";

// Organization Settings Controller
import {
  getAdminOrgSettings,
  updateAdminOrgSettings,
  uploadOrgSettingAsset
} from "../controllers/admin.orgSettings.controller";

// Clean Database Controller
import { cleanDatabaseHandler, factoryResetSchema } from "../controllers/admin/clean.controller";

export const adminRoutes = Router();

// Apply auth middleware for all admin routes
adminRoutes.use(authenticate, requireAdmin);

// Dashboard & Stats
adminRoutes.get("/stats", stats);
adminRoutes.get("/users", validate(listUsersSchema), listUsers);

// Applicants
adminRoutes.get("/applicants", validate(listApplicantsSchema), listApplicants);
adminRoutes.get("/print/applicants", validate(printApplicantsSchema), listPrintApplicants);

// Draw Management
adminRoutes.get("/draws", listDraws);
adminRoutes.post("/draws", validate(drawSchema), createNewDraw);
adminRoutes.patch("/draws/:id/status", updateDrawStatus);
adminRoutes.post("/draws/:id/activate", setActiveDraw);
adminRoutes.patch("/draws/:id/control", validate(updateDrawControlSchema), updateApplicationControl);
adminRoutes.patch("/draws/:id/application-limit", validate(updateApplicationLimitSchema), updateApplicationLimit);
adminRoutes.post("/draws/winners", validate(declareWinnersSchema), declareWinners);
adminRoutes.post("/draws/:id/bulk-mark-not-selected", bulkMarkNotSelected);
adminRoutes.post("/draws/:id/backup", createBackupForDraw);
adminRoutes.get("/draws/backups", listDrawBackups);
adminRoutes.get("/draws/backups/:id", getDrawBackupDetail);
adminRoutes.patch("/applicants/status", validate(updateApplicantStatusSchema), updateApplicantStatus);
adminRoutes.post("/draws/run", validate(runDrawSchema), executeDraw);
adminRoutes.delete("/draws/:id", deleteDraw);
adminRoutes.get("/draw/history", getDrawHistory);

// Marquee Management
adminRoutes.get("/marquee", listAllMarqueeMessages);
adminRoutes.post("/marquee", validate(createMarqueeSchema), createMarqueeMessage);
adminRoutes.patch("/marquee/:id", updateMarqueeMessage);
adminRoutes.delete("/marquee/:id", deleteMarqueeMessage);

// Security
adminRoutes.post("/security/password", validate(changePasswordSchema), changePassword);
adminRoutes.post("/security/invalidate-sessions", invalidateSessions);

// Settings
adminRoutes.get("/settings", getSettings);
adminRoutes.patch("/settings", validate(updateSettingsSchema), updateSettings);
adminRoutes.put("/settings", validate(updateSettingsSchema), updateSettings);

// Organization Settings Routes
adminRoutes.get("/org-settings", getAdminOrgSettings);
adminRoutes.put("/org-settings", updateAdminOrgSettings);
adminRoutes.post("/org-settings/upload", galleryUpload.single("image"), uploadOrgSettingAsset);

// Gallery & Content
adminRoutes.post("/gallery/upload", galleryUpload.array("images", 8), uploadGalleryImages);
adminRoutes.delete("/gallery/image", validate(removeGalleryImageSchema), removeGalleryImage);
adminRoutes.get("/feedback", listFeedback);
adminRoutes.post("/feedback", validate(createFeedbackSchema), createFeedback);
adminRoutes.delete("/feedback/:id", deleteFeedback);
adminRoutes.get("/documents", listDocuments);
adminRoutes.post("/documents", pdfUpload.single("document"), validate(uploadDocumentSchema), uploadDocument);
adminRoutes.delete("/documents/:id", deleteDocument);

// Payments Management
adminRoutes.get("/payments", validate(listPaymentsSchema), listPayments);
adminRoutes.post("/payments/:id/mark-paid", markPaymentSuccessful);
adminRoutes.get("/payments/export-csv", exportPaymentsCsv);
adminRoutes.get("/payments/:id/receipt", downloadAdminReceipt);

// Donations Management
adminRoutes.get("/donations", validate(listDonationsSchema), listAdminDonations);
adminRoutes.get("/donations/export-csv", exportDonationsCsv);

// CMS Management
adminRoutes.get("/cms/stats", getAdminCMSDashboardStats);

// Feedback / Testimonials CMS
adminRoutes.get("/cms/feedback", listFeedbackCMS);
adminRoutes.post("/cms/feedback", createFeedbackCMS);
adminRoutes.patch("/cms/feedback/:id", updateFeedbackCMS);
adminRoutes.post("/cms/feedback/bulk", bulkUpdateFeedbackCMS);
adminRoutes.delete("/cms/feedback/:id", deleteFeedbackCMS);

// Announcements CMS
adminRoutes.get("/cms/announcements", listAnnouncementsCMS);
adminRoutes.post("/cms/announcements", createAnnouncementCMS);
adminRoutes.patch("/cms/announcements/:id", updateAnnouncementCMS);
adminRoutes.delete("/cms/announcements/:id", deleteAnnouncementCMS);

// Dua Guidelines CMS
adminRoutes.get("/cms/dua-guidelines", listDuaGuidelinesCMS);
adminRoutes.post("/cms/dua-guidelines", pdfUpload.single("document"), createDuaGuidelineCMS);
adminRoutes.patch("/cms/dua-guidelines/:id", updateDuaGuidelineCMS);
adminRoutes.delete("/cms/dua-guidelines/:id", deleteDuaGuidelineCMS);

// Gallery CMS
adminRoutes.get("/cms/gallery", listGalleryCMS);
adminRoutes.post("/cms/gallery", createGalleryItemCMS);
adminRoutes.patch("/cms/gallery/:id", updateGalleryItemCMS);
adminRoutes.delete("/cms/gallery/:id", deleteGalleryItemCMS);

// Contact & SMTP Settings CMS
adminRoutes.get("/cms/contact-settings", getContactSettingsCMS);
adminRoutes.patch("/cms/contact-settings", updateContactSettingsCMS);
adminRoutes.get("/cms/contact-messages", listContactMessagesCMS);

// Database Cleanup Endpoint
adminRoutes.post("/system/factory-reset", validate(factoryResetSchema), cleanDatabaseHandler);
adminRoutes.post("/clean-database", validate(factoryResetSchema), cleanDatabaseHandler);
