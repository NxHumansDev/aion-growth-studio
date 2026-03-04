export interface ApiKeyValidation {
  valid: boolean;
  source?: 'platform' | 'public' | 'dev';
}

/**
 * Validates API access for audit endpoints.
 *
 * Priority:
 * 1. Dev mode: STUDIO_API_KEY not set → everything passes (source: 'dev')
 * 2. x-api-key header matches STUDIO_API_KEY → Platform access (source: 'platform')
 * 3. body.email present and valid → public audit flow (source: 'public')
 * 4. Otherwise → rejected (valid: false)
 */
export function validateApiKey(request: Request, body?: Record<string, any>): ApiKeyValidation {
  const envKey = process.env.STUDIO_API_KEY;

  // Dev mode: key not configured → open access
  if (!envKey) {
    return { valid: true, source: 'dev' };
  }

  const headerKey = request.headers.get('x-api-key');
  if (headerKey && headerKey === envKey) {
    return { valid: true, source: 'platform' };
  }

  // Public flow: email present
  if (body?.email && typeof body.email === 'string' && body.email.includes('@')) {
    return { valid: true, source: 'public' };
  }

  return { valid: false };
}

/**
 * Maps Studio's internal camelCase results to the flat snake_case format
 * that Platform's studio-mapper.ts expects.
 */
export function mapResultsForPlatform(raw: Record<string, any>): Record<string, any> {
  return {
    score: {
      total: raw.score?.total,
      breakdown: {
        technical: raw.score?.breakdown?.technical,
        seo_visibility: raw.score?.breakdown?.seoVisibility,
        content: raw.score?.breakdown?.content,
        social_reputation: raw.score?.breakdown?.socialReputation,
        conversion: raw.score?.breakdown?.conversion,
        measurement: raw.score?.breakdown?.measurement,
      },
    },
    seo: {
      domain_rank: raw.seo?.domainRank,
      keywords_top3: raw.seo?.keywordsTop3,
      keywords_top10: raw.seo?.keywordsTop10,
      keywords_top30: raw.seo?.keywordsTop30,
      organic_traffic: raw.seo?.organicTrafficEstimate,
      referring_domains: raw.seo?.referringDomains,
      backlinks_total: raw.seo?.backlinksTotal,
    },
    traffic: {
      visits: raw.traffic?.visits,
      // Studio stores bounce_rate as 0–100; Platform expects 0–1
      bounce_rate: raw.traffic?.bounceRate != null ? raw.traffic.bounceRate / 100 : undefined,
      pages_per_visit: raw.traffic?.pagesPerVisit,
    },
    conversion: {
      score: raw.conversion?.funnelScore,
      has_contact_form: raw.conversion?.hasContactForm,
      has_cta: raw.conversion?.hasCTA,
      has_lead_magnet: raw.conversion?.hasLeadMagnet,
      has_chat_widget: raw.conversion?.hasChatWidget,
    },
    content: {
      clarity: raw.content?.clarity,
      // word_count and technical flags live in the crawl module
      word_count: raw.crawl?.wordCount,
      schema_org: raw.crawl?.hasSchemaMarkup,
      sitemap: raw.crawl?.hasSitemap,
      canonical: raw.crawl?.hasCanonical,
    },
    techstack: {
      maturityScore: raw.techstack?.maturityScore,
    },
    crawl: raw.crawl,
    ssl: {
      valid: raw.ssl?.valid,
    },
    pagespeed: {
      mobile: {
        performance: raw.pagespeed?.mobile?.performance,
        lcp: raw.pagespeed?.mobile?.lcp,
        cls: raw.pagespeed?.mobile?.cls,
        fcp: raw.pagespeed?.mobile?.fcp,
      },
      desktop: {
        performance: raw.pagespeed?.desktop?.performance,
      },
    },
    geo: {
      overallScore: raw.geo?.overallScore,
      brandScore: raw.geo?.brandScore,
      sectorScore: raw.geo?.sectorScore,
    },
    instagram: {
      found: raw.instagram?.found,
      followers: raw.instagram?.followers,
      engagementRate: raw.instagram?.engagementRate,
    },
    linkedin: {
      found: raw.linkedin?.found,
      followers: raw.linkedin?.followers,
      employees: raw.linkedin?.employees,
    },
    gbp: {
      found: raw.gbp?.found,
      rating: raw.gbp?.rating,
      reviewCount: raw.gbp?.reviewCount,
    },
  };
}
