export const PUBLISHING_LIMITS = {
  anonymous: {
    defaultTtlSeconds: 60 * 60 * 24,
    maxTtlSeconds: 60 * 60 * 24,
    maxFiles: 100,
    maxFileBytes: 10 * 1024 * 1024,
    maxTotalBytes: 50 * 1024 * 1024,
    publishRateLimit: {
      maxPublishes: 10,
      windowSeconds: 60 * 60,
    },
  },
  free: {
    maxFiles: 1_000,
    maxFileBytes: 25 * 1024 * 1024,
    maxTotalBytes: 1 * 1024 * 1024 * 1024,
    maxSites: 3,
    maxCustomDomains: 1,
    publishRateLimit: {
      maxPublishes: 60,
      windowSeconds: 60 * 60,
    },
  },
  paid: {
    pro: {
      maxFiles: 5_000,
      maxFileBytes: 100 * 1024 * 1024,
      maxTotalBytes: 25 * 1024 * 1024 * 1024,
      maxSites: 25,
      maxCustomDomains: 10,
      publishRateLimit: {
        maxPublishes: 600,
        windowSeconds: 60 * 60,
      },
    },
    team: {
      maxFiles: 20_000,
      maxFileBytes: 250 * 1024 * 1024,
      maxTotalBytes: 250 * 1024 * 1024 * 1024,
      maxSites: 250,
      maxCustomDomains: 100,
      publishRateLimit: {
        maxPublishes: 3_000,
        windowSeconds: 60 * 60,
      },
    },
  },
  abuseFallback: {
    ttlSeconds: 60 * 60,
    perIpPublishRateLimit: {
      maxPublishes: 3,
      windowSeconds: 60 * 60,
    },
    perAsnPublishRateLimit: {
      maxPublishes: 30,
      windowSeconds: 60 * 60,
    },
  },
  uploadPlan: {
    expiresInSeconds: 15 * 60,
  },
} as const;

export type PublishingLimits = typeof PUBLISHING_LIMITS;
