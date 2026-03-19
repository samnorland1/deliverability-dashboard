import { NextRequest, NextResponse } from "next/server";

// Priority order for logo sources scraped from HTML
const META_SELECTORS = [
  // High-res brand images
  /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  // Apple touch icons (high-res)
  /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i,
  /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*apple-touch-icon[^"']*["']/i,
  // Large favicons
  /<link[^>]+sizes=["']192x192["'][^>]+href=["']([^"']+)["']/i,
  /<link[^>]+href=["']([^"']+)["'][^>]+sizes=["']192x192["']/i,
  /<link[^>]+sizes=["']180x180["'][^>]+href=["']([^"']+)["']/i,
  /<link[^>]+href=["']([^"']+)["'][^>]+sizes=["']180x180["']/i,
];

function resolveUrl(href: string, base: string): string {
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return `https://${new URL(base).host}${href}`;
  return `${base}/${href}`;
}

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) return NextResponse.json({ error: "Missing domain" }, { status: 400 });

  const baseUrl = `https://${domain}`;

  try {
    const res = await fetch(baseUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; bot)" },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) throw new Error(`${res.status}`);

    const html = await res.text();

    for (const pattern of META_SELECTORS) {
      const match = html.match(pattern);
      if (match?.[1]) {
        const url = resolveUrl(match[1], baseUrl);
        // Skip placeholder/default og images that are just generic site images
        if (url.includes("placeholder") || url.includes("default")) continue;
        return NextResponse.json({ url });
      }
    }
  } catch {
    // Fall through to clearbit
  }

  // Final fallback: clearbit
  return NextResponse.json({ url: `https://logo.clearbit.com/${domain}?size=200` });
}
