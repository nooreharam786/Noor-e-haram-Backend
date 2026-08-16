import { z } from "zod";
import { prisma } from "../config/prisma";
import { asyncHandler, HttpError } from "../utils/http";

export const createMarqueeSchema = z.object({
  body: z.object({
    content: z.string().trim().min(3).max(500),
    isActive: z.boolean().optional().default(true),
    linkUrl: z.string().trim().max(500).optional().nullable(),
    eventDate: z.string().optional().nullable(),
    lastDate: z.string().optional().nullable(),
    statusBadge: z.string().trim().max(100).optional().nullable(),
    priority: z.coerce.number().int().optional().default(0),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable()
  })
});

export const getActiveMarqueeMessages = asyncHandler(async (_req, res) => {
  const now = new Date();

  const [marqueeMessages, announcements] = await Promise.all([
    prisma.marqueeMessage.findMany({
      where: {
        isActive: true,
        OR: [
          { startDate: null, endDate: null },
          { startDate: { lte: now }, endDate: { gte: now } },
          { startDate: { lte: now }, endDate: null },
          { startDate: null, endDate: { gte: now } }
        ]
      },
      orderBy: [
        { priority: "desc" },
        { order: "asc" },
        { createdAt: "desc" }
      ]
    }),
    prisma.announcement.findMany({
      where: {
        status: "published",
        OR: [
          { locations: { contains: "marquee", mode: "insensitive" } },
          { locations: { contains: "homepage", mode: "insensitive" } }
        ],
        AND: [
          {
            OR: [
              { publishDate: null, expiryDate: null },
              { publishDate: { lte: now }, expiryDate: { gte: now } },
              { publishDate: { lte: now }, expiryDate: null },
              { publishDate: null, expiryDate: { gte: now } }
            ]
          }
        ]
      },
      orderBy: [
        { priority: "desc" },
        { createdAt: "desc" }
      ]
    })
  ]);

  const mappedAnnouncements = announcements.map((a) => ({
    id: `announcement-${a.id}`,
    content: a.description && a.description !== a.title ? `${a.title} — ${a.description}` : a.title,
    isActive: true,
    linkUrl: a.linkUrl || null,
    statusBadge: a.badge || "Announcement",
    priority: a.priority ?? 0,
    createdAt: a.createdAt
  }));

  const combined = [...marqueeMessages, ...mappedAnnouncements].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
  );

  res.json({ success: true, data: combined });
});

export const listAllMarqueeMessages = asyncHandler(async (_req, res) => {
  const messages = await prisma.marqueeMessage.findMany({
    orderBy: [
      { priority: "desc" },
      { order: "asc" },
      { createdAt: "desc" }
    ]
  });

  res.json({ success: true, data: messages });
});

export const createMarqueeMessage = asyncHandler(async (req, res) => {
  const { content, isActive, linkUrl, eventDate, lastDate, statusBadge, priority, startDate, endDate } = req.body;

  const message = await prisma.marqueeMessage.create({
    data: {
      content,
      isActive: isActive ?? true,
      linkUrl: linkUrl || null,
      eventDate: eventDate ? new Date(eventDate) : null,
      lastDate: lastDate ? new Date(lastDate) : null,
      statusBadge: statusBadge || null,
      priority: priority ?? 0,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null
    }
  });

  res.status(201).json({ success: true, data: message });
});

export const updateMarqueeMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { content, isActive, linkUrl, eventDate, lastDate, statusBadge, priority, startDate, endDate } = req.body;

  const updated = await prisma.marqueeMessage.update({
    where: { id },
    data: {
      ...(content !== undefined ? { content } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(linkUrl !== undefined ? { linkUrl: linkUrl || null } : {}),
      ...(eventDate !== undefined ? { eventDate: eventDate ? new Date(eventDate) : null } : {}),
      ...(lastDate !== undefined ? { lastDate: lastDate ? new Date(lastDate) : null } : {}),
      ...(statusBadge !== undefined ? { statusBadge: statusBadge || null } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
      ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {})
    }
  });

  res.json({ success: true, data: updated });
});

export const deleteMarqueeMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;

  await prisma.marqueeMessage.delete({ where: { id } });

  res.json({ success: true, message: "Marquee message deleted" });
});
