import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db, withTransaction } from "@/lib/database";
import { publishToQueue } from "@/lib/rabbitmq";
import { checkDailyQuota, consumeDailyQuota } from "@/lib/daily-quota";
import { checkPlatformAccess, getAllowedPlatforms } from "@/lib/platform-permissions";
import { resolveModelConfig } from "@/lib/model-router";
import { resolveDecryptedApiKey } from "@/lib/api-key-resolver";
import type { Membership, Platform } from "@/lib/models";
import { QUEUES } from "@/lib/rabbitmq";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { userId, description, experienceLevel, platform: rawPlatform } = await req.json();
    const platform: Platform = rawPlatform || "arduino";

    const membershipResult = await db.query(
      `SELECT tier FROM memberships WHERE user_id = $1`,
      [userId]
    );
    const tier: Membership = (membershipResult.rows[0]?.tier) || "free";

    if (!checkPlatformAccess(tier, platform)) {
      return NextResponse.json(
        {
          error: "Platform not allowed",
          allowedPlatforms: getAllowedPlatforms(tier),
        },
        { status: 403 }
      );
    }

    const hasQuota = await checkDailyQuota(userId, tier);
    if (!hasQuota) {
      return NextResponse.json(
        { error: "Daily quota exceeded", quotaType: "daily" },
        { status: 429 }
      );
    }

    const designDraftId = uuidv4();
    const decryptedKey = await resolveDecryptedApiKey(userId);
    const modelConfig = resolveModelConfig(tier, decryptedKey);

    await withTransaction(async (client) => {
      if (tier !== "hasKey") {
        await client.query(
          `UPDATE memberships SET daily_quota_remaining = daily_quota_remaining - 1 WHERE user_id = $1`,
          [userId]
        );
      }

      await client.query(
        `INSERT INTO design_drafts (id, user_id, raw_description, experience_level, membership_tier, status, model_config, platform)
         VALUES ($1, $2, $3, $4, $5, 'analyzing', $6, $7)`,
        [designDraftId, userId, description, experienceLevel, tier, JSON.stringify(modelConfig), platform]
      );
    });

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
