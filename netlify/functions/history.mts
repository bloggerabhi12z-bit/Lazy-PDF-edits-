import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import { operations } from "../../db/schema.js";

const operationSchema = z.object({
  filename: z.string().trim().min(1).max(240),
  mime: z.string().trim().min(1).max(120),
  size: z.number().int().nonnegative().max(500 * 1024 * 1024),
  tool: z.string().trim().min(1).max(80),
});

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});

export default async (request: Request) => {
  if (request.method !== "GET") {
    try { verifyRequestOrigin(request); } catch { return json({ error: "Request origin rejected." }, 403); }
  }
  const user = await getUser();
  if (!user) return json({ error: "Authentication required." }, 401);

  try {
    if (request.method === "GET") {
      const rows = await db.select().from(operations).where(eq(operations.userId, user.id)).orderBy(desc(operations.createdAt)).limit(50);
      return json({ data: rows });
    }

    if (request.method === "POST") {
      const [usage] = await db.select({ total: count() }).from(operations).where(eq(operations.userId, user.id));
      if ((usage?.total ?? 0) >= 200) return json({ error: "History limit reached. Clear older history and retry." }, 429);
      const parsed = operationSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: "Invalid operation metadata." }, 400);
      const [created] = await db.insert(operations).values({ id: crypto.randomUUID(), userId: user.id, ...parsed.data }).returning();
      return json({ data: created }, 201);
    }

    if (request.method === "PATCH") {
      const body = z.object({ id: z.string().uuid(), favorite: z.boolean() }).safeParse(await request.json());
      if (!body.success) return json({ error: "Invalid favorite update." }, 400);
      const [updated] = await db.update(operations).set({ favorite: body.data.favorite }).where(and(eq(operations.id, body.data.id), eq(operations.userId, user.id))).returning();
      return updated ? json({ data: updated }) : json({ error: "Operation not found." }, 404);
    }

    if (request.method === "DELETE") {
      await db.delete(operations).where(eq(operations.userId, user.id));
      return new Response(null, { status: 204 });
    }

    return json({ error: "Method not allowed." }, 405);
  } catch {
    return json({ error: "History is temporarily unavailable." }, 500);
  }
};
