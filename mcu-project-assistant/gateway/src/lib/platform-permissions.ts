import type { Membership, Platform } from "./models";

const ALLOWED_PLATFORMS: Record<Membership, Platform[]> = {
  free: ["arduino"],
  hasKey: ["arduino"],
  subscription: ["arduino", "esp32", "stm32"],
  "pay-as-you-go": ["arduino", "esp32", "stm32"],
};

export function checkPlatformAccess(tier: Membership, platform: Platform): boolean {
  return ALLOWED_PLATFORMS[tier].includes(platform);
}

export function getAllowedPlatforms(tier: Membership): Platform[] {
  return [...ALLOWED_PLATFORMS[tier]];
}
