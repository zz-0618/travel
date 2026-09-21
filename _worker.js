export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await env.ASSETS.fetch(request);
    if (request.method !== "GET" || !response.headers.get("content-type")?.includes("text/html") || url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/admin.html") return response;
    const slug = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "");
    if (!slug) return response;
    const api = "https://rpzqioezweftrjtrneos.supabase.co/rest/v1/articles?select=title,excerpt,content,cover_image_url,slug&slug=eq." + encodeURIComponent(slug) + "&limit=1";
    const articleResponse = await fetch(api, { headers: { apikey: "sb_publishable__8VdnjBQYgeFtPdArs4lww_4RJxrDye", Authorization: "Bearer sb_publishable__8VdnjBQYgeFtPdArs4lww_4RJxrDye" } });
    if (!articleResponse.ok) return response;
    const article = (await articleResponse.json())[0];
    if (!article) return response;
    const strip = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const escape = value => String(value || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    const title = escape(article.title);
    const description = escape((article.excerpt || strip(article.content)).slice(0, 160));
    const image = escape(article.cover_image_url || "");
    const canonical = escape(url.href);
    let html = await response.text();
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}｜一葉知途</title>`);
    const replaceMeta = (property, value) => { const re = new RegExp(`<meta\s+property=["']${property}["']\s+content=["'][^"']*["']\s*\/?\s*>`, "i"); const tag = `<meta property="${property}" content="${value}">`; html = re.test(html) ? html.replace(re, tag) : html.replace("</head>", tag + "\n</head>"); };
    replaceMeta("og:type", "article"); replaceMeta("og:title", title); replaceMeta("og:description", description); replaceMeta("og:image", image); replaceMeta("og:image:secure_url", image); replaceMeta("og:image:alt", title + "文章封面"); replaceMeta("og:url", canonical);
    html = html.replace("</head>", `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${image}"><link rel="canonical" href="${canonical}">\n</head>`);
    return new Response(html, { status: response.status, headers: response.headers });
  }
};
