// functions/sitemap.xml.js

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "你的SUPABASE_URL",
  "你的ANON_KEY"
);

function slug(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/-+/g, "-");
}

export async function onRequestGet() {

  const { data: categories } =
    await supabase
      .from("categories")
      .select("*");

  const { data: articles } =
    await supabase
      .from("articles")
      .select("*");

  const categoryByName =
    (name) =>
      categories.find(
        c => c.name === name
      );

  const articlePath =
    (a) => {

      const parts = [];

      const parent =
        categoryByName(
          a.category
        );

      if (parent)
        parts.push(
          slug(parent.slug)
        );

      if (a.subcategory) {

        const child =
          categoryByName(
            a.subcategory
          );

        if (child)
          parts.push(
            slug(child.slug)
          );
      }

      parts.push(
        slug(a.slug)
      );

      return (
        "https://travel.zztravel.workers.dev/" +
        parts.join("/")
      );
    };

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

  xml += `
  <url>
    <loc>
      https://travel.zztravel.workers.dev/
    </loc>
  </url>
`;

  articles.forEach(article => {

    xml += `
    <url>
      <loc>
        ${articlePath(article)}
      </loc>
      <lastmod>
        ${new Date(
          article.updated_at ||
          article.created_at
        )
        .toISOString()}
      </lastmod>
    </url>
`;
  });

  xml += `
</urlset>
`;

  return new Response(xml, {
    headers: {
      "content-type":
       "application/xml"
    }
  });
}
