import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/database";
import { publishToQueue } from "@/lib/rabbitmq";
import { checkDailyQuota, consumeDailyQuota } from "@/lib/daily-quota";
import { checkPlatformAccess, getAllowedPlatforms } from "@/lib/platform-permissions";
import { resolveModelConfig } from "@/lib/model-router";
import { resolveDecryptedApiKey } from "@/lib/api-key-resolver";
import type { Membership, Platform } from "@/lib/models";
import { QUEUES } from "@/lib/rabbitmq";

export async function POST(req: NextRequest) {
  try {
    const { userId, description, experienceLevel, platform: rawPlatform } = await req.json();
    const platform: Platform = rawPlatform || "arduino";

    const membershipResult = await db.query(
      `SELECT tier FROM memberships WHERE user_id = $1`,
      [userId]
    );
    const tier: string = membershipResult.rows[0]?.tier || "free";

    if (!checkPlatformAccess(tier as Membership, platform)) {
      return NextResponse.json(
        {
          error: "Platform not allowed",
          allowedPlatforms: getAllowedPlatforms(tier as Membership),
        },
        { status: 403 }
      );
    }

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

    const decryptedKey = await resolveDecryptedApiKey(userId);
    const modelConfig = resolveModelConfig(tier, decryptedKey);

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
