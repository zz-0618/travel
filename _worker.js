export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 動態 Sitemap
    if (url.pathname === "/sitemap.xml") {
      return await generateSitemap(env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function generateSitemap(env) {

  const site =
    "https://travel.zztravel.workers.dev";

  // categories
  const categoriesRes =
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/categories?select=*`,
      {
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization:
            `Bearer ${env.SUPABASE_ANON_KEY}`
        }
      }
    );

  const categories =
    await categoriesRes.json();

  // articles
  const articlesRes =
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/articles?select=*`,
      {
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization:
            `Bearer ${env.SUPABASE_ANON_KEY}`
        }
      }
    );

  const articles =
    await articlesRes.json();

  const categoryMap =
    new Map(
      categories.map(c => [
        c.name,
        c
      ])
    );

  function slug(v) {

    return String(v || "")
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .replace(/-+/g, "-");
  }

  function articlePath(article) {

    const parts = [];

    const parent =
      categoryMap.get(
        article.category
      );

    if (parent?.slug) {
      parts.push(
        slug(parent.slug)
      );
    }

    if (
      article.subcategory
    ) {

      const child =
        categoryMap.get(
          article.subcategory
        );

      if (child?.slug) {
        parts.push(
          slug(child.slug)
        );
      }
    }

    parts.push(
      slug(article.slug)
    );

    return (
      site +
      "/" +
      parts.join("/")
    );
  }

  let xml =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

  // 首頁

  xml += `
<url>
  <loc>${site}/</loc>
  <changefreq>daily</changefreq>
  <priority>1.0</priority>
</url>
`;

  // 所有文章

  for (const article of articles) {

    xml += `
<url>
  <loc>${articlePath(article)}</loc>
  <lastmod>${new Date(
    article.updated_at ||
    article.created_at
  ).toISOString()}</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.9</priority>
</url>
`;
  }

  xml += `
</urlset>
`;

  return new Response(xml, {
    headers: {
      "Content-Type":
        "application/xml; charset=UTF-8",
      "Cache-Control":
        "public, max-age=3600"
    }
  });
}
