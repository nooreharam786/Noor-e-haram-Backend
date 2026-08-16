import { ApplicationStatus, PaymentStatus, Role } from "@prisma/client";
import type { Request } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { paginationSchema } from "../utils/validation";
import { runLuckyDraw } from "../services/draw.service";
import { galleryImageUrl, joinGalleryUrls, publicDocumentUrl, requestOrigin, splitGalleryUrls } from "../utils/gallery";
import { uploadDocument as uploadToStorage, deleteDocument as deleteFromStorage } from "../services/storage.service";

const sortableUsers = new Set(["name", "email", "role", "createdAt"]);
const sortableApplicants = new Set(["createdAt", "status", "paymentStatus"]);
const galleryKey = "GALLERY_IMAGE_URLS";
const settingsKeys = {
  resultsYoutubeUrl: "RESULTS_YOUTUBE_URL",
  galleryImageUrls: "GALLERY_IMAGE_URLS",
  termsDocumentUrl: "TERMS_DOCUMENT_URL",
  umrahPackagePrice: "UMRAH_PACKAGE_PRICE",
  socialFacebookUrl: "SOCIAL_FACEBOOK_URL",
  socialInstagramUrl: "SOCIAL_INSTAGRAM_URL",
  socialYoutubeUrl: "SOCIAL_YOUTUBE_URL",
  socialWhatsappUrl: "SOCIAL_WHATSAPP_URL",
  contactAddress: "CONTACT_ADDRESS",
  contactPhone: "CONTACT_PHONE",
  contactEmail: "CONTACT_EMAIL",
  razorpayPublicKey: "RAZORPAY_PUBLIC_KEY",
  paymentMode: "PAYMENT_MODE",
  defaultDrawAmount: "DEFAULT_DRAW_AMOUNT"
} as const;

export const listUsersSchema = z.object({
  query: paginationSchema.extend({
    sortBy: z.string().default("createdAt")
  })
});

export const listApplicantsSchema = z.object({
  query: paginationSchema.extend({
    sortBy: z.string().default("createdAt"),
    status: z.nativeEnum(ApplicationStatus).optional(),
    paymentStatus: z.nativeEnum(PaymentStatus).optional()
  })
});

export const printApplicantsSchema = z.object({
  query: paginationSchema.extend({
    // drawId is REQUIRED — printing without a specific draw is not allowed
    drawId: z.string().min(1, "drawId is required for printing chits"),
    status: z.nativeEnum(ApplicationStatus).optional(),
    paymentStatus: z.nativeEnum(PaymentStatus).optional(),
    registrationNoFrom: z.string().trim().min(1).max(80).optional(),
    registrationNoTo: z.string().trim().min(1).max(80).optional(),
    registrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    all: z.enum(["true", "false"]).optional()
  })
});



const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());
const optionalEmail = z.preprocess((value) => (value === "" ? undefined : value), z.string().trim().email().optional());

export const updateSettingsSchema = z.object({
  body: z.object({
    resultsYoutubeUrl: optionalUrl,
    galleryImageUrls: z.string().trim().max(5000).optional(),
    termsDocumentUrl: z.string().trim().max(1000).optional(),
    umrahPackagePrice: z.coerce.number().int().nonnegative().max(10000000).optional(),
    socialFacebookUrl: optionalUrl,
    socialInstagramUrl: optionalUrl,
    socialYoutubeUrl: optionalUrl,
    socialWhatsappUrl: z.string().trim().max(500).optional(),
    contactAddress: z.string().trim().max(1000).optional(),
    contactPhone: z.string().trim().max(80).optional(),
    contactEmail: optionalEmail,
    adminName: z.string().trim().min(2).optional(),
    adminEmail: z.string().trim().email().toLowerCase().optional(),
    razorpayPublicKey: z.string().trim().max(200).optional(),
    paymentMode: z.enum(["test", "live"]).optional(),
    defaultDrawAmount: z.coerce.number().int().positive().max(100000).optional()
  })
});

export const createFeedbackSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    rating: z.coerce.number().int().min(1).max(5),
    message: z.string().trim().min(5).max(1000),
    location: z.string().trim().max(120).optional(),
    approved: z.boolean().optional()
  })
});

export const uploadDocumentSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(500).optional(),
    kind: z.string().trim().min(2).max(40).default("dua")
  })
});

export const removeGalleryImageSchema = z.object({
  body: z.object({
    imageUrl: z.string().url()
  })
});

export const stats = asyncHandler(async (_req, res) => {
  const [totalUsers, totalApplicants, paidApplications, selectedApplications, lastDraw] = await Promise.all([
    prisma.user.count(),
    prisma.application.count(),
    prisma.application.count({
      where: { paymentStatus: PaymentStatus.paid }
    }),
    prisma.application.count({
      where: { status: ApplicationStatus.selected }
    }),
    prisma.drawResult.findFirst({ orderBy: { createdAt: "desc" } })
  ]);
  const paidUsers = paidApplications;
  const selectedUsers = selectedApplications;

  res.json({ success: true, data: { totalUsers, totalApplicants, paidUsers, selectedUsers, lastDraw } });
});

export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, search, sortOrder } = req.query as any;
  const sortBy = sortableUsers.has(req.query.sortBy as string) ? (req.query.sortBy as string) : "createdAt";
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } }
        ]
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.user.count({ where })
  ]);

  res.json({ success: true, data: { items, meta: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

export const listApplicants = asyncHandler(async (req, res) => {
  const { page, limit, search, status, paymentStatus, sortOrder, drawId } = req.query as any;
  const sortBy = sortableApplicants.has(req.query.sortBy as string) ? (req.query.sortBy as string) : "createdAt";
  const where = {
    ...(drawId ? { drawId } : {}),
    ...(status ? { status } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(search
      ? {
          OR: [
            { registrationNo: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search, mode: "insensitive" as const } },
            {
              user: {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { email: { contains: search, mode: "insensitive" as const } }
                ]
              }
            }
          ]
        }
      : {})
  };

  const [items, total] = await Promise.all([
    prisma.application.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
        draw: { select: { id: true, name: true, drawIndex: true } }
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.application.count({ where })
  ]);

  res.json({ success: true, data: { items, meta: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

export const listPrintApplicants = asyncHandler(async (req, res) => {
  const { page, limit, all, drawId, ...queryArgs } = req.query as any;

  // Strict enforcement: drawId MUST be specified — never print across all draws
  if (!drawId || typeof drawId !== "string" || drawId.trim() === "") {
    throw new HttpError(400, "A specific drawId is required to print chits. Printing across all draws is not permitted.");
  }

  // Verify the draw exists
  const draw = await prisma.draw.findUnique({ where: { id: drawId }, select: { id: true, name: true, status: true } });
  if (!draw) {
    throw new HttpError(404, `Draw not found. Please select a valid draw to print chits from.`);
  }

  // Strict enforcement: Chit printing only includes applicants with successful (paid) payment status
  const where = {
    drawId,
    paymentStatus: PaymentStatus.paid,
    ...(queryArgs.status ? { status: queryArgs.status } : {}),
    ...(queryArgs.registrationNoFrom || queryArgs.registrationNoTo
      ? {
          registrationNo: {
            ...(queryArgs.registrationNoFrom ? { gte: queryArgs.registrationNoFrom } : {}),
            ...(queryArgs.registrationNoTo ? { lte: queryArgs.registrationNoTo } : {})
          }
        }
      : {})
  };

  const total = await prisma.application.count({ where });

  if (all === "true" && total > 10000) {
    throw new HttpError(422, "Refine the filters before selecting more than 10,000 registrations");
  }

  const items = await prisma.application.findMany({
    where,
    select: {
      id: true,
      registrationNo: true,
      applicantName: true,
      phone: true,
      status: true,
      paymentStatus: true,
      createdAt: true,
      address: true,
      city: true,
      stateCode: true,
      stateName: true,
      entryFee: true,
      drawId: true,
      user: { select: { name: true, email: true } },
      draw: { select: { id: true, name: true, drawIndex: true } }
    },
    orderBy: { createdAt: "desc" },
    ...(all === "true" ? {} : { skip: (page - 1) * limit, take: limit })
  });

  res.json({
    success: true,
    data: {
      items,
      meta: {
        page: all === "true" ? 1 : page,
        limit: all === "true" ? items.length : limit,
        total,
        pages: all === "true" ? 1 : Math.ceil(total / limit)
      }
    }
  });
});

export const getSettings = asyncHandler(async (req, res) => {
  const [settings, admin] = await Promise.all([
    prisma.setting.findMany({ where: { key: { in: Object.values(settingsKeys) } } }),
    prisma.user.findFirst({ where: { role: Role.admin }, select: { id: true, name: true, email: true } })
  ]);
  const values = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
  res.json({
    success: true,
    data: {
      resultsYoutubeUrl: values.RESULTS_YOUTUBE_URL,
      galleryImageUrls: joinGalleryUrls(values.GALLERY_IMAGE_URLS),
      termsDocumentUrl: values.TERMS_DOCUMENT_URL,
      umrahPackagePrice: Number(values.UMRAH_PACKAGE_PRICE ?? 0),
      socialFacebookUrl: values.SOCIAL_FACEBOOK_URL,
      socialInstagramUrl: values.SOCIAL_INSTAGRAM_URL,
      socialYoutubeUrl: values.SOCIAL_YOUTUBE_URL,
      socialWhatsappUrl: values.SOCIAL_WHATSAPP_URL,
      contactAddress: values.CONTACT_ADDRESS,
      contactPhone: values.CONTACT_PHONE,
      contactEmail: values.CONTACT_EMAIL,
      razorpayPublicKey: values.RAZORPAY_PUBLIC_KEY,
      paymentMode: values.PAYMENT_MODE ?? "test",
      defaultDrawAmount: Number(values.DEFAULT_DRAW_AMOUNT ?? 1499),
      admin
    }
  });
});



export const updateSettings = asyncHandler(async (req, res) => {
  const operations = [];

  for (const [bodyKey, settingKey] of Object.entries(settingsKeys)) {
    if (req.body[bodyKey] === undefined) continue;
    const value = bodyKey === "galleryImageUrls" ? joinGalleryUrls(req.body[bodyKey]) : String(req.body[bodyKey] ?? "");
    operations.push(
      prisma.setting.upsert({
        where: { key: settingKey },
        update: { value },
        create: { key: settingKey, value }
      })
    );
  }

  if (req.body.adminName || req.body.adminEmail) {
    operations.push(
      prisma.user.update({
        where: { id: req.user!.id },
        data: {
          ...(req.body.adminName ? { name: req.body.adminName } : {}),
          ...(req.body.adminEmail ? { email: req.body.adminEmail } : {})
        }
      })
    );
  }

  await prisma.$transaction(operations);
  res.json({ success: true, message: "Settings updated" });
});

async function uploadedFileUrls(req: Request) {
  const files = (req.files ?? []) as Express.Multer.File[];

  const images = await Promise.all(
    files.map((file) =>
      prisma.galleryItem.create({
        data: {
          imageUrl: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
          caption: file.originalname,
          category: "General",
          isVisible: true
        },
        select: { id: true, imageUrl: true }
      })
    )
  );

  return images.map((image: { id: string; imageUrl: string }) => image.imageUrl);
}

async function removeStoredUpload(imageUrl: string, req: Request) {
  const id = new URL(imageUrl).pathname.split("/").pop();
  if (!id) return;

  await prisma.galleryItem.delete({ where: { id } }).catch(() => undefined);
}

export const uploadGalleryImages = asyncHandler(async (req, res) => {
  const nextUrls = await uploadedFileUrls(req);
  if (nextUrls.length === 0) {
    throw new HttpError(422, "Please choose at least one image to upload");
  }

  const existing = await prisma.setting.findUnique({ where: { key: galleryKey } });
  const currentValue = joinGalleryUrls(existing?.value);
  const value = [currentValue, ...nextUrls].filter(Boolean).join("\n");

  await prisma.setting.upsert({
    where: { key: galleryKey },
    update: { value },
    create: { key: galleryKey, value }
  });

  res.status(201).json({ success: true, data: { imageUrls: nextUrls, galleryImageUrls: value } });
});

export const removeGalleryImage = asyncHandler(async (req, res) => {
  const existing = await prisma.setting.findUnique({ where: { key: galleryKey } });
  const nextUrls = splitGalleryUrls(existing?.value).filter((url) => url !== req.body.imageUrl);
  const value = nextUrls.join("\n");

  await prisma.setting.upsert({
    where: { key: galleryKey },
    update: { value },
    create: { key: galleryKey, value }
  });
  await removeStoredUpload(req.body.imageUrl, req);

  res.json({ success: true, data: { galleryImageUrls: value } });
});

export const listFeedback = asyncHandler(async (_req, res) => {
  const items = await prisma.feedback.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ success: true, data: items });
});

export const createFeedback = asyncHandler(async (req, res) => {
  const feedback = await prisma.feedback.create({
    data: {
      name: req.body.name,
      rating: req.body.rating,
      message: req.body.message,
      location: req.body.location,
      approved: req.body.approved ?? true,
      source: "admin"
    }
  });
  res.status(201).json({ success: true, data: feedback });
});

export const deleteFeedback = asyncHandler(async (req, res) => {
  const feedback = await prisma.feedback.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!feedback) {
    throw new HttpError(404, "Feedback not found");
  }

  await prisma.feedback.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: "Feedback deleted" });
});

export const listDocuments = asyncHandler(async (req, res) => {
  const documents = await prisma.publicDocument.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, description: true, filename: true, kind: true, createdAt: true }
  });
  res.json({ success: true, data: documents.map((document) => ({ ...document, url: publicDocumentUrl(req, document.id) })) });
});

export const uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new HttpError(422, "Please choose a PDF to upload");
  }

  // First create the DB record to get the document ID
  const document = await prisma.publicDocument.create({
    data: {
      title: req.body.title,
      description: req.body.description,
      kind: req.body.kind ?? "dua",
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      size: req.file.size
    },
    select: { id: true, title: true, description: true, filename: true, kind: true, createdAt: true }
  });

  // Upload to Supabase Storage
  try {
    const { storagePath, storageUrl } = await uploadToStorage(
      req.file.buffer,
      document.id,
      req.file.originalname,
      req.file.mimetype
    );

    // Update DB record with storage path and URL
    await prisma.publicDocument.update({
      where: { id: document.id },
      data: { storagePath, storageUrl }
    });

    res.status(201).json({
      success: true,
      data: { ...document, url: storageUrl }
    });
  } catch (uploadErr) {
    // If storage upload fails, clean up the DB record
    await prisma.publicDocument.delete({ where: { id: document.id } }).catch(() => {});
    throw uploadErr;
  }
});

export const deleteDocument = asyncHandler(async (req, res) => {
  // Fetch the document to get the storage path before deletion
  const doc = await prisma.publicDocument.findUnique({
    where: { id: req.params.id },
    select: { storagePath: true }
  });

  // Delete from Supabase Storage (idempotent, won't throw)
  if (doc?.storagePath) {
    await deleteFromStorage(doc.storagePath);
  }

  await prisma.publicDocument.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: "Document deleted" });
});
