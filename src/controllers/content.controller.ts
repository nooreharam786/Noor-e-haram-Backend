import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/http";
import { publicDocumentUrl, splitGalleryUrls } from "../utils/gallery";
import { z } from "zod";
import { logError } from "../utils/logger";

const publicSettingKeys = [
  "RESULTS_YOUTUBE_URL",
  "GALLERY_IMAGE_URLS",
  "TERMS_DOCUMENT_URL",
  "UMRAH_PACKAGE_PRICE",
  "SOCIAL_FACEBOOK_URL",
  "SOCIAL_INSTAGRAM_URL",
  "SOCIAL_YOUTUBE_URL",
  "SOCIAL_WHATSAPP_URL",
  "CONTACT_ADDRESS",
  "CONTACT_PHONE",
  "CONTACT_PHONE_2",
  "CONTACT_EMAIL",
  "CONTACT_SECONDARY_EMAIL",
  "GOOGLE_MAPS_URL",
  "OFFICIAL_SEAL_URL",
  "WEBSITE_URL"
];

export const createFeedbackSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    rating: z.coerce.number().int().min(1).max(5),
    message: z.string().trim().min(5).max(1000),
    location: z.string().trim().max(120).optional()
  })
});

export const getPublicContent = asyncHandler(async (_req, res) => {
  const [settings, activeDraw] = await Promise.all([
    prisma.setting.findMany({
      where: {
        key: {
          in: publicSettingKeys
        }
      }
    }),
    prisma.draw.findFirst({
      where: { status: "active" },
      select: { id: true, name: true, drawIndex: true, status: true, appControlStatus: true, maxApplicationsPerUser: true, bannerMessage: true, startDate: true, endDate: true }
    })
  ]);

  const values = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));

  const defaultPhones = "+91 92134 08880 / +91 98258 61572";
  const defaultAddress = "AT. & PO. Umalla (Dumala), Vaghpura, Near Masjid, Main Road, Ta. Jhagadia, Dist. Bharuch - 393120, Gujarat, India";

  res.json({
    success: true,
    data: {
      resultsYoutubeUrl: values.RESULTS_YOUTUBE_URL ?? "",
      galleryImageUrls: splitGalleryUrls(values.GALLERY_IMAGE_URLS),
      termsDocumentUrl: values.TERMS_DOCUMENT_URL ?? "",
      umrahPackagePrice: Number(values.UMRAH_PACKAGE_PRICE ?? 0),
      googleMapsUrl: values.GOOGLE_MAPS_URL ?? "",
      convenienceFeePercent: 0, // Fee completely removed per Requirement 2
      umrahProbabilityPercent: 1.01, // Requirement 7
      officialSealUrl: values.OFFICIAL_SEAL_URL ?? "",
      activeDraw,
      socials: {
        facebook: values.SOCIAL_FACEBOOK_URL ?? "",
        instagram: values.SOCIAL_INSTAGRAM_URL ?? "",
        youtube: values.SOCIAL_YOUTUBE_URL ?? "",
        whatsapp: values.SOCIAL_WHATSAPP_URL ?? ""
      },
      contact: {
        address: values.CONTACT_ADDRESS || defaultAddress,
        phone: values.CONTACT_PHONE || defaultPhones,
        phone2: values.CONTACT_PHONE_2 || "+91 98258 61573",
        email: values.CONTACT_EMAIL || "support@nooreharam.in",
        secondaryEmail: values.CONTACT_SECONDARY_EMAIL || "Nooreharamcharityfoundation@gmail.com",
        website: values.WEBSITE_URL || "www.nooreharam.in"
      }
    }
  });
});

export const listPublicDocuments = asyncHandler(async (req, res) => {
  const documents = await prisma.publicDocument.findMany({
    where: { kind: (req.query.kind as string) || "dua" },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, description: true, filename: true, kind: true, storageUrl: true, createdAt: true }
  });

  res.json({
    success: true,
    data: documents.map((document) => ({
      ...document,
      url: document.storageUrl || publicDocumentUrl(req, document.id)
    }))
  });
});

export const listPublicFeedback = asyncHandler(async (_req, res) => {
  const feedback = await prisma.feedback.findMany({
    where: { approved: true, isPublished: true, isHidden: false },
    orderBy: [
      { isFeatured: "desc" },
      { order: "asc" },
      { createdAt: "desc" }
    ],
    take: 12,
    select: { id: true, name: true, rating: true, message: true, location: true, isFeatured: true, avatarUrl: true, createdAt: true }
  });
  res.json({ success: true, data: feedback });
});

export const createFeedback = asyncHandler(async (req, res) => {
  const feedback = await prisma.feedback.create({
    data: {
      name: req.body.name,
      rating: req.body.rating,
      message: req.body.message,
      location: req.body.location,
      source: "public",
      approved: true,
      isPublished: true,
      isHidden: false
    }
  });

  res.status(201).json({ success: true, data: feedback });
});

export const getPublicAnnouncements = asyncHandler(async (req, res) => {
  const { location } = req.query;
  const now = new Date();

  const announcements = await prisma.announcement.findMany({
    where: {
      status: "published",
      OR: [
        { publishDate: null, expiryDate: null },
        { publishDate: { lte: now }, expiryDate: { gte: now } },
        { publishDate: { lte: now }, expiryDate: null },
        { publishDate: null, expiryDate: { gte: now } }
      ],
      ...(location ? { locations: { contains: String(location), mode: "insensitive" } } : {})
    },
    orderBy: [
      { priority: "desc" },
      { createdAt: "desc" }
    ]
  });

  res.json({ success: true, data: announcements });
});

export const getPublicDuaGuidelines = asyncHandler(async (req, res) => {
  try {
    const documents = await prisma.publicDocument.findMany({
    where: { isPublished: true, kind: "dua" },
    select: {
      id: true,
      title: true,
      description: true,
      shortDescription: true,
      filename: true,
      contentType: true,
      size: true,
      thumbnailUrl: true,
      storageUrl: true,
      kind: true,
      order: true,
      createdAt: true,
      updatedAt: true
    },
    orderBy: [
      { order: "asc" },
      { createdAt: "desc" }
    ]
  });

    res.json({ success: true, data: documents.map((doc) => ({ ...doc, url: doc.storageUrl || publicDocumentUrl(req, doc.id) })) });
  } catch (error) {
    logError("DUA_GUIDELINES_LIST", error);
    res.json({ success: true, data: [] });
  }
});

export const getPublicGalleryItems = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const categoryStr = category ? String(category).trim() : undefined;

  const items = await prisma.galleryItem.findMany({
    where: {
      isVisible: true,
      ...(categoryStr ? { category: { equals: categoryStr, mode: "insensitive" } } : {})
    },
    orderBy: [
      { order: "asc" },
      { createdAt: "desc" }
    ]
  });

  res.json({ success: true, data: items });
});
