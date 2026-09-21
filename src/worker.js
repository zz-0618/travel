const SUPABASE_URL = "https://rpzqioezweftrjtrneos.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__8VdnjBQYgeFtPdArs4lww_4RJxrDye";

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character]);
}

function plainText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceMeta(html, attribute, name, value) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(
    `<meta\\s+${attribute}=["']${escapedName}["'][^>]*>`,
    "i",
  );
  const tag = `<meta ${attribute}="${name}" content="${escapeHtml(value)}">`;
  return expression.test(html)
    ? html.replace(expression, tag)
    : html.replace("</head>", `${tag}\n</head>`);
}

async function getArticle(slug) {
  const endpoint = `${SUPABASE_URL}/rest/v1/articles?select=id,title,excerpt,content,cover_image_url,slug&slug=eq.${encodeURIComponent(slug)}&limit=1`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0] || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const assetResponse = await env.ASSETS.fetch(request);

    if (
      request.method !== "GET" ||
      !assetResponse.headers.get("content-type")?.includes("text/html") ||
      url.pathname === "/" ||
      url.pathname === "/index.html" ||
      url.pathname === "/admin.html"
    ) {
      return assetResponse;
    }

    const slug = decodeURIComponent(
      url.pathname.split("/").filter(Boolean).at(-1) || "",
    );
    if (!slug) return assetResponse;

    try {
      const article = await getArticle(slug);
      if (!article) return assetResponse;

      const title = article.title || "一葉知途";
      const description = String(
        article.excerpt || plainText(article.content),
      ).slice(0, 160);
      const image = article.cover_image_url || "";
      const canonical = url.href;

      let html = await assetResponse.text();
      html = html.replace(
        /<title>[\s\S]*?<\/title>/i,
        `<title>${escapeHtml(title)}｜一葉知途</title>`,
      );
      html = replaceMeta(html, "property", "og:type", "article");
      html = replaceMeta(html, "property", "og:title", title);
      html = replaceMeta(html, "property", "og:description", description);
      html = replaceMeta(html, "property", "og:image", image);
      html = replaceMeta(html, "property", "og:image:secure_url", image);
      html = replaceMeta(html, "property", "og:image:alt", `${title}文章封面`);
      html = replaceMeta(html, "property", "og:url", canonical);
      html = replaceMeta(html, "name", "twitter:card", "summary_large_image");
      html = replaceMeta(html, "name", "twitter:title", title);
      html = replaceMeta(html, "name", "twitter:description", description);
      html = replaceMeta(html, "name", "twitter:image", image);

      if (!/<link\s+rel=["']canonical["']/i.test(html)) {
        html = html.replace(
          "</head>",
          `<link rel="canonical" href="${escapeHtml(canonical)}">\n</head>`,
        );
      }

      const headers = new Headers(assetResponse.headers);
      headers.set("content-type", "text/html; charset=UTF-8");
      headers.delete("content-length");
      return new Response(html, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    } catch (error) {
      console.error("Open Graph generation failed", error);
      return assetResponse;
    }
  },
};
