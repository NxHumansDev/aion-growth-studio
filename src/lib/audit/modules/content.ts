import type { ContentResult, CrawlResult } from '../types';

const API_KEY = import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

export async function runContent(url: string, crawl: CrawlResult): Promise<ContentResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'ANTHROPIC_API_KEY not configured' };
  }

  const prompt = `Analyze the content quality of this website based on its metadata.

URL: ${url}
Title: ${crawl.title || 'N/A'}
Meta description: ${crawl.description || 'N/A'}
H1 headings: ${(crawl.h1s || []).join(' | ') || 'N/A'}
Approx word count: ${crawl.wordCount || 0}
Images: ${crawl.imageCount || 0} (${crawl.imagesWithAlt || 0} with alt text)

Rate the content quality. Respond with ONLY a valid JSON object:
{
  "clarity": 70,
  "valueProposition": "one-sentence main value proposition",
  "audienceMatch": "who the content targets",
  "cta": "main call-to-action detected or 'None identified'",
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1", "weakness 2"]
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const text: string = data?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const parsed = JSON.parse(match[0]);
    // Ensure strengths/weaknesses are max 2 items to keep results concise
    return {
      ...parsed,
      strengths: (parsed.strengths || []).slice(0, 2),
      weaknesses: (parsed.weaknesses || []).slice(0, 2),
    };
  } catch (err: any) {
    return {
      clarity: 50,
      valueProposition: 'Could not analyze',
      audienceMatch: 'Unknown',
      cta: 'Unknown',
      strengths: [],
      weaknesses: [],
      error: err.message?.slice(0, 100),
    };
  }
}
