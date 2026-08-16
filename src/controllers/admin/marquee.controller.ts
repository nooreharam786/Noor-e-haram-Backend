import { z } from "zod";
import { asyncHandler, HttpError } from "../../utils/http";
import { prisma } from "../../config/prisma";
import { logAdminAction } from "../../services/audit.service";

export const marqueeSchema = z.object({
  body: z.object({
    content: z.string().trim().min(3),
    isActive: z.boolean().optional().default(true),
    order: z.coerce.number().int().optional().default(0),
    linkUrl: z.string().url().optional().or(z.literal(""))
  })
});

export const listMarqueeMessages = asyncHandler(async (_req, res) => {
  const items = await prisma.marqueeMessage.findMany({
    orderBy: { order: "asc" }
  });
  res.json({ success: true, data: items });
});

export const createMarqueeMessage = asyncHandler(async (req, res) => {
  const item = await prisma.marqueeMessage.create({
    data: {
      content: req.body.content,
      isActive: req.body.isActive,
      order: req.body.order,
      linkUrl: req.body.linkUrl || null
    }
  });

  await logAdminAction(req.user!.id, "CREATE_MARQUEE", "MarqueeMessage", item.id, req.body);
  res.status(201).json({ success: true, data: item });
});

export const updateMarqueeMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const item = await prisma.marqueeMessage.update({
    where: { id },
    data: {
      content: req.body.content,
      isActive: req.body.isActive,
      order: req.body.order,
      linkUrl: req.body.linkUrl || null
    }
  });

  await logAdminAction(req.user!.id, "UPDATE_MARQUEE", "MarqueeMessage", id, req.body);
  res.json({ success: true, data: item });
});

export const deleteMarqueeMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.marqueeMessage.delete({ where: { id } });
  await logAdminAction(req.user!.id, "DELETE_MARQUEE", "MarqueeMessage", id);
  res.json({ success: true, message: "Marquee deleted" });
});
