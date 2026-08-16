import { Request, Response } from "express";
import { z } from "zod";
import nodemailer from "nodemailer";
import { prisma } from "../config/prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { logAdminAction } from "../services/audit.service";
import { uploadDocument as uploadToStorage, deleteDocument as deleteFromStorage } from "../services/storage.service";

// ==========================================
// 1. FEEDBACK / TESTIMONIALS CMS
// ==========================================

export const listFeedbackCMS = asyncHandler(async (req, res) => {
  const { search, isFeatured, isPublished, page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where: any = {};
  if (search) {
    where.OR = [
      { name: { contains: String(search), mode: "insensitive" } },
      { message: { contains: String(search), mode: "insensitive" } },
      { location: { contains: String(search), mode: "insensitive" } }
    ];
  }
  if (isFeatured !== undefined) where.isFeatured = isFeatured === "true";
  if (isPublished !== undefined) where.isPublished = isPublished === "true";

  const [items, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: [
        { isFeatured: "desc" },
        { order: "asc" },
        { createdAt: "desc" }
      ],
      skip,
      take: Number(limit)
    }),
    prisma.feedback.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      items,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    }
  });
});

export const createFeedbackCMS = asyncHandler(async (req, res) => {
  const { name, rating, message, location, isFeatured, isPublished, isHidden, order, avatarUrl } = req.body;

  const item = await prisma.feedback.create({
    data: {
      name,
      rating: Number(rating) || 5,
      message,
      location: location || null,
      source: "admin",
      approved: true,
      isFeatured: Boolean(isFeatured),
      isPublished: isPublished !== undefined ? Boolean(isPublished) : true,
      isHidden: Boolean(isHidden),
      order: Number(order) || 0,
      avatarUrl: avatarUrl || null
    }
  });

  await logAdminAction(req.user!.id, "CREATE_FEEDBACK", "Feedback", item.id, req.body);
  res.status(201).json({ success: true, data: item });
});

export const updateFeedbackCMS = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, rating, message, location, isFeatured, isPublished, isHidden, order, avatarUrl } = req.body;

  const updated = await prisma.feedback.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(rating !== undefined ? { rating: Number(rating) } : {}),
      ...(message !== undefined ? { message } : {}),
      ...(location !== undefined ? { location: location || null } : {}),
      ...(isFeatured !== undefined ? { isFeatured: Boolean(isFeatured) } : {}),
      ...(isPublished !== undefined ? { isPublished: Boolean(isPublished) } : {}),
      ...(isHidden !== undefined ? { isHidden: Boolean(isHidden) } : {}),
      ...(order !== undefined ? { order: Number(order) } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl: avatarUrl || null } : {})
    }
  });

  await logAdminAction(req.user!.id, "UPDATE_FEEDBACK", "Feedback", id, req.body);
  res.json({ success: true, data: updated });
});

export const bulkUpdateFeedbackCMS = asyncHandler(async (req, res) => {
  const { ids, action } = req.body; // action: 'publish' | 'hide' | 'feature' | 'unfeature' | 'delete'

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new HttpError(400, "IDs array is required");
  }

  if (action === "delete") {
    await prisma.feedback.deleteMany({ where: { id: { in: ids } } });
  } else if (action === "publish") {
    await prisma.feedback.updateMany({ where: { id: { in: ids } }, data: { isPublished: true, isHidden: false } });
  } else if (action === "hide") {
    await prisma.feedback.updateMany({ where: { id: { in: ids } }, data: { isHidden: true, isPublished: false } });
  } else if (action === "feature") {
    await prisma.feedback.updateMany({ where: { id: { in: ids } }, data: { isFeatured: true } });
  } else if (action === "unfeature") {
    await prisma.feedback.updateMany({ where: { id: { in: ids } }, data: { isFeatured: false } });
  } else {
    throw new HttpError(400, "Invalid bulk action");
  }

  await logAdminAction(req.user!.id, `BULK_FEEDBACK_${action.toUpperCase()}`, "Feedback", undefined, { ids, action });
  res.json({ success: true, message: `Bulk action '${action}' completed successfully` });
});

export const deleteFeedbackCMS = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.feedback.delete({ where: { id } });
  await logAdminAction(req.user!.id, "DELETE_FEEDBACK", "Feedback", id);
  res.json({ success: true, message: "Feedback removed" });
});

// ==========================================
// 2. ANNOUNCEMENTS CMS
// ==========================================

export const listAnnouncementsCMS = asyncHandler(async (_req, res) => {
  const announcements = await prisma.announcement.findMany({
    orderBy: [
      { priority: "desc" },
      { createdAt: "desc" }
    ]
  });

  res.json({ success: true, data: announcements });
});

export const createAnnouncementCMS = asyncHandler(async (req, res) => {
  const { title, description, priority, publishDate, expiryDate, status, locations, linkUrl, badge } = req.body;

  const item = await prisma.announcement.create({
    data: {
      title,
      description,
      priority: Number(priority) || 0,
      publishDate: publishDate ? new Date(publishDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      status: status || "published",
      locations: locations || "homepage,marquee",
      linkUrl: linkUrl || null,
      badge: badge || null
    }
  });

  await logAdminAction(req.user!.id, "CREATE_ANNOUNCEMENT", "Announcement", item.id, req.body);
  res.status(201).json({ success: true, data: item });
});

export const updateAnnouncementCMS = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, description, priority, publishDate, expiryDate, status, locations, linkUrl, badge } = req.body;

  const updated = await prisma.announcement.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(priority !== undefined ? { priority: Number(priority) } : {}),
      ...(publishDate !== undefined ? { publishDate: publishDate ? new Date(publishDate) : null } : {}),
      ...(expiryDate !== undefined ? { expiryDate: expiryDate ? new Date(expiryDate) : null } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(locations !== undefined ? { locations } : {}),
      ...(linkUrl !== undefined ? { linkUrl: linkUrl || null } : {}),
      ...(badge !== undefined ? { badge: badge || null } : {})
    }
  });

  await logAdminAction(req.user!.id, "UPDATE_ANNOUNCEMENT", "Announcement", id, req.body);
  res.json({ success: true, data: updated });
});

export const deleteAnnouncementCMS = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.announcement.delete({ where: { id } });
  await logAdminAction(req.user!.id, "DELETE_ANNOUNCEMENT", "Announcement", id);
  res.json({ success: true, message: "Announcement deleted" });
});

// ==========================================
// 3. DUA GUIDELINES CMS
// ==========================================

export const listDuaGuidelinesCMS = asyncHandler(async (_req, res) => {
  const documents = await prisma.publicDocument.findMany({
    orderBy: [
      { order: "asc" },
      { createdAt: "desc" }
    ]
  });

  res.json({ success: true, data: documents });
});

export const createDuaGuidelineCMS = asyncHandler(async (req, res) => {
  const { title, description, shortDescription, thumbnailUrl, images, kind, order, isPublished } = req.body;
  const file = req.file;

  if (!title || !file) {
    throw new HttpError(400, "Title and PDF document file are required");
  }

  // First create the DB record to get the document ID
  const item = await prisma.publicDocument.create({
    data: {
      title,
      description: description || null,
      shortDescription: shortDescription || null,
      filename: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      thumbnailUrl: thumbnailUrl || null,
      images: typeof images === "string" ? images : JSON.stringify(images || []),
      kind: kind || "dua",
      order: Number(order) || 0,
      isPublished: isPublished !== undefined ? Boolean(isPublished) : true
    }
  });

  // Upload to Supabase Storage
  try {
    const { storagePath, storageUrl } = await uploadToStorage(
      file.buffer,
      item.id,
      file.originalname,
      file.mimetype
    );

    // Update DB record with storage path and URL
    await prisma.publicDocument.update({
      where: { id: item.id },
      data: { storagePath, storageUrl }
    });

    await logAdminAction(req.user!.id, "CREATE_DUA_GUIDELINE", "PublicDocument", item.id, { title, kind });
    res.status(201).json({ success: true, data: { id: item.id, title: item.title } });
  } catch (uploadErr) {
    // If storage upload fails, clean up the DB record
    await prisma.publicDocument.delete({ where: { id: item.id } }).catch(() => {});
    throw uploadErr;
  }
});

export const updateDuaGuidelineCMS = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, description, shortDescription, thumbnailUrl, images, kind, order, isPublished } = req.body;

  const updated = await prisma.publicDocument.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(shortDescription !== undefined ? { shortDescription: shortDescription || null } : {}),
      ...(thumbnailUrl !== undefined ? { thumbnailUrl: thumbnailUrl || null } : {}),
      ...(images !== undefined ? { images: typeof images === "string" ? images : JSON.stringify(images) } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(order !== undefined ? { order: Number(order) } : {}),
      ...(isPublished !== undefined ? { isPublished: Boolean(isPublished) } : {})
    }
  });

  await logAdminAction(req.user!.id, "UPDATE_DUA_GUIDELINE", "PublicDocument", id, req.body);
  res.json({ success: true, data: updated });
});

export const deleteDuaGuidelineCMS = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Fetch the document to get the storage path before deletion
  const doc = await prisma.publicDocument.findUnique({
    where: { id },
    select: { storagePath: true }
  });

  // Delete from Supabase Storage (idempotent, won't throw)
  if (doc?.storagePath) {
    await deleteFromStorage(doc.storagePath);
  }

  await prisma.publicDocument.delete({ where: { id } });
  await logAdminAction(req.user!.id, "DELETE_DUA_GUIDELINE", "PublicDocument", id);
  res.json({ success: true, message: "Document removed" });
});

// ==========================================
// 4. GALLERY CMS
// ==========================================

export const listGalleryCMS = asyncHandler(async (_req, res) => {
  const items = await prisma.galleryItem.findMany({
    orderBy: [
      { order: "asc" },
      { createdAt: "desc" }
    ]
  });

  res.json({ success: true, data: items });
});

export const createGalleryItemCMS = asyncHandler(async (req, res) => {
  const { imageUrl, caption, altText, description, category, order, isVisible } = req.body;

  if (!imageUrl) {
    throw new HttpError(400, "imageUrl is required");
  }

  const item = await prisma.galleryItem.create({
    data: {
      imageUrl,
      caption: caption || null,
      altText: altText || null,
      description: description || null,
      category: category || "general",
      order: Number(order) || 0,
      isVisible: isVisible !== undefined ? Boolean(isVisible) : true
    }
  });

  await logAdminAction(req.user!.id, "CREATE_GALLERY_ITEM", "GalleryItem", item.id, req.body);
  res.status(201).json({ success: true, data: item });
});

export const updateGalleryItemCMS = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { imageUrl, caption, altText, description, category, order, isVisible } = req.body;

  const updated = await prisma.galleryItem.update({
    where: { id },
    data: {
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      ...(caption !== undefined ? { caption: caption || null } : {}),
      ...(altText !== undefined ? { altText: altText || null } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(order !== undefined ? { order: Number(order) } : {}),
      ...(isVisible !== undefined ? { isVisible: Boolean(isVisible) } : {})
    }
  });

  await logAdminAction(req.user!.id, "UPDATE_GALLERY_ITEM", "GalleryItem", id, req.body);
  res.json({ success: true, data: updated });
});

export const deleteGalleryItemCMS = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.galleryItem.delete({ where: { id } });
  await logAdminAction(req.user!.id, "DELETE_GALLERY_ITEM", "GalleryItem", id);
  res.json({ success: true, message: "Gallery item removed" });
});

// ==========================================
// 5. CONTACT, SETTINGS & SMTP CMS
// ==========================================

export const getContactSettingsCMS = asyncHandler(async (_req, res) => {
  const settings = await prisma.setting.findMany();
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  res.json({
    success: true,
    data: {
      contactSupportEmail: map.CONTACT_SUPPORT_EMAIL || "Nooreharamcharityfoundation@gmail.com",
      contactGeneralEmail: map.CONTACT_GENERAL_EMAIL || "info@nooreharam.in",
      contactPhone: map.CONTACT_PHONE || "9213408880",
      contactAltPhone: map.CONTACT_ALT_PHONE || "9213408881",
      contactAddress: map.CONTACT_ADDRESS || "Bharuch, Gujarat 393120",
      workingHours: map.WORKING_HOURS || "Mon - Sat: 9:00 AM - 6:00 PM",
      googleMapsUrl: map.GOOGLE_MAPS_URL || "",
      socialFacebookUrl: map.SOCIAL_FACEBOOK_URL || "",
      socialInstagramUrl: map.SOCIAL_INSTAGRAM_URL || "",
      socialYoutubeUrl: map.SOCIAL_YOUTUBE_URL || "",
      socialWhatsappUrl: map.SOCIAL_WHATSAPP_URL || "",
      smtpHost: map.SMTP_HOST || "",
      smtpPort: map.SMTP_PORT || "587",
      smtpUser: map.SMTP_USER || "",
      smtpPass: map.SMTP_PASS || "",
      smtpSecure: map.SMTP_SECURE || "false",
      smtpFrom: map.SMTP_FROM || "Noor E Haram Charity Foundation <Nooreharamcharityfoundation@gmail.com>"
    }
  });
});

export const updateContactSettingsCMS = asyncHandler(async (req, res) => {
  const updates: Record<string, string> = req.body;

  const promises = Object.entries(updates).map(([key, value]) => {
    const dbKey = key.replace(/([A-Z])/g, "_$1").toUpperCase();
    return prisma.setting.upsert({
      where: { key: dbKey },
      update: { value: String(value ?? "") },
      create: { key: dbKey, value: String(value ?? "") }
    });
  });

  await Promise.all(promises);
  await logAdminAction(req.user!.id, "UPDATE_CONTACT_SETTINGS", "Setting", undefined, req.body);
  res.json({ success: true, message: "Contact & SMTP settings updated live!" });
});

// Support Contact Form submission (Public)
export const submitPublicContactForm = asyncHandler(async (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  if (!name || !email || !message) {
    throw new HttpError(400, "Name, email, and message are required");
  }

  // Save to database
  const contactMsg = await prisma.contactMessage.create({
    data: {
      name,
      email,
      phone: phone || null,
      subject: subject || "Website Support Inquiry",
      message,
      status: "unread"
    }
  });

  // Attempt SMTP dispatch if configured
  try {
    const settings = await prisma.setting.findMany();
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    if (map.SMTP_HOST && map.SMTP_USER && map.SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: map.SMTP_HOST,
        port: Number(map.SMTP_PORT) || 587,
        secure: map.SMTP_SECURE === "true",
        auth: {
          user: map.SMTP_USER,
          pass: map.SMTP_PASS
        }
      });

      const recipient = map.CONTACT_SUPPORT_EMAIL || "Nooreharamcharityfoundation@gmail.com";

      await transporter.sendMail({
        from: map.SMTP_FROM || map.SMTP_USER,
        to: recipient,
        subject: `[Noor E Haram Inquiry] ${subject || "Support Request"} from ${name}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #111;">
            <h2 style="color: #0B4633;">New Website Contact Inquiry</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone || "N/A"}</p>
            <p><strong>Subject:</strong> ${subject || "N/A"}</p>
            <hr />
            <p><strong>Message:</strong></p>
            <p style="background: #f9f9f9; padding: 12px; border-radius: 6px;">${message}</p>
          </div>
        `
      });
    }
  } catch (err) {
    console.error("SMTP Email Dispatch Error (logged cleanly):", err);
  }

  res.status(201).json({
    success: true,
    message: "Thank you for contacting Noor E Haram Charity Foundation. Our team will get back to you shortly.",
    data: { id: contactMsg.id }
  });
});

// List submitted contact messages for admin
export const listContactMessagesCMS = asyncHandler(async (_req, res) => {
  const messages = await prisma.contactMessage.findMany({
    orderBy: { createdAt: "desc" }
  });
  res.json({ success: true, data: messages });
});

// ==========================================
// 6. ENHANCED DASHBOARD ANALYTICS
// ==========================================

export const getAdminCMSDashboardStats = asyncHandler(async (_req, res) => {
  const [
    totalUsers,
    totalApplicants,
    paidApplicants,
    totalDonations,
    activeDraws,
    pendingFeedback,
    unreadMessages,
    recentAuditLogs
  ] = await Promise.all([
    prisma.user.count(),
    prisma.application.count(),
    prisma.application.count({ where: { paymentStatus: "paid" } }),
    prisma.donation.aggregate({ _sum: { amount: true }, _count: true }),
    prisma.draw.count({ where: { status: "active" } }),
    prisma.feedback.count({ where: { isPublished: false } }),
    prisma.contactMessage.count({ where: { status: "unread" } }),
    prisma.auditLog.findMany({ take: 10, orderBy: { createdAt: "desc" } })
  ]);

  res.json({
    success: true,
    data: {
      totalUsers,
      totalApplicants,
      paidApplicants,
      totalDonationsAmount: totalDonations._sum.amount || 0,
      totalDonationsCount: totalDonations._count || 0,
      activeDraws,
      pendingReviews: pendingFeedback + unreadMessages,
      visitorsEstimate: Math.max(totalUsers * 4 + 150, 240),
      recentActivity: recentAuditLogs
    }
  });
});
