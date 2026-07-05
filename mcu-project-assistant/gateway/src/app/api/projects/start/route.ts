import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/database";
import { publishToQueue } from "@/lib/rabbitmq";
import { checkDailyQuota, consumeDailyQuota } from "@/lib/daily-quota";
import { resolveModelConfig } from "@/lib/model-router";
import type { Membership } from "@/lib/models";
import { QUEUES } from "@/lib/rabbitmq";

export async function POST(req: NextRequest) {
  try {
    const { userId, description, experienceLevel } = await req.json();

    const membershipResult = await db.query(
      `SELECT tier FROM memberships WHERE user_id = $1`,
      [userId]
    );
    const tier: string = membershipResult.rows[0]?.tier || "free";

    const hasQuota = await checkDailyQuota(userId, tier as Membership);
    if (!hasQuota) {
      return NextResponse.json(
        { error: "Daily quota exceeded", quotaType: "daily" },
        { status: 429 }
      );
    }
    if (tier !== "hasKey") {
      await consumeDailyQuota(userId);
    }

    const keyResult = await db.query(
      `SELECT key_value_encrypted, key_type FROM api_keys
       WHERE user_id = $1 AND is_active = true`,
      [userId]
    );

    const aiKey = keyResult.rows.find((r: { key_type: string }) => r.key_type === "ai");
    const modelConfig = resolveModelConfig(tier, aiKey?.key_value_encrypted);

    const designDraftId = uuidv4();
    await db.query(
      `INSERT INTO design_drafts (id, user_id, raw_description, experience_level, membership_tier, status)
       VALUES ($1, $2, $3, $4, $5, 'analyzing')`,
      [designDraftId, userId, description, experienceLevel, tier]
    );

    await publishToQueue(QUEUES.REQUIREMENT_INPUT, {
      designDraftId,
      userId,
      description,
      modelConfig,
      membership: tier,
      experienceLevel,
    });

    return NextResponse.json({ designDraftId });
  } catch {
    return NextResponse.json({ error: "Failed to start project" }, { status: 500 });
  }
}
