const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // sitemap
    if (url.pathname === '/sitemap.xml') {
      return generateSitemap(request, env);
    }

    // robots
    if (url.pathname === '/robots.txt') {
      return generateRobots(request);
    }

    // 先嘗試取得實體資源
    const response = await env.ASSETS.fetch(request);

    // 找得到檔案直接回傳
    if (response.status !== 404) {
      return response;
    }

    // 有副檔名表示圖片、css、js 等資源
    // 保持真正 404
    if (url.pathname.includes('.')) {
      return response;
    }

    // SPA Routing Fallback
    // 所有文章路徑都回到首頁讓前端 router 處理
    return env.ASSETS.fetch(
      new Request(new URL('/', request.url))
    );
  },
};


async function generateSitemap(request, env) {
  try {
    requireEnv(env, ['SUPABASE_URL', 'SUPABASE_ANON_KEY']);

    const [articles, categories, settings] = await Promise.all([
      supabaseSelect(env, 'articles', 'id,category,subcategory,slug,created_at,updated_at'),
      supabaseSelect(env, 'categories', 'id,name,slug,parent_id'),
      supabaseSelect(env, 'settings', 'key,value'),
    ]);

    const siteOrigin = new URL(request.url).origin;
    const categoryMap = new Map(categories.map((item) => [item.name, item]));
    const settingsMap = new Map(settings.map((item) => [item.key, item.value]));
    const urls = new Map();

    addUrl(urls, siteOrigin + '/', null);

    for (const category of categories) {
      const path = buildCategoryPath(category, categories);
      if (path !== '/') addUrl(urls, siteOrigin + path, null);
    }

    for (const article of articles) {
      const status = settingsMap.get(`article_status_${article.id}`);
      if (status === 'draft') continue;

      const path = buildArticlePath(article, categoryMap);
      if (!path) continue;

      addUrl(
        urls,
        siteOrigin + path,
        article.updated_at || article.created_at || null,
      );
    }

    const body = [
      XML_HEADER,
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...Array.from(urls.values()).map(({ loc, lastmod }) => {
        const fields = [`<loc>${escapeXml(loc)}</loc>`];
        if (lastmod) fields.push(`<lastmod>${escapeXml(toW3cDate(lastmod))}</lastmod>`);
        return `  <url>${fields.join('')}</url>`;
      }),
      '</urlset>',
      '',
    ].join('\n');

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=UTF-8',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Sitemap generation failed:', error);
    return new Response('Sitemap generation failed', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        'Cache-Control': 'no-store',
      },
    });
  }
}

function generateRobots(request) {
  const origin = new URL(request.url).origin;
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin.html',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function supabaseSelect(env, table, select) {
  const baseUrl = env.SUPABASE_URL.replace(/\/$/, '');
  const endpoint = new URL(`${baseUrl}/rest/v1/${table}`);
  endpoint.searchParams.set('select', select);

  const response = await fetch(endpoint, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Supabase ${table} query failed: ${response.status} ${await response.text()}`,
    );
  }

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`Supabase ${table} response is not an array`);
  return data;
}

function buildArticlePath(article, categoryMap) {
  const parts = [];
  const parent = categoryMap.get(article.category);
  if (parent?.slug) parts.push(normalizeSlug(parent.slug));

  if (article.subcategory) {
    const child = categoryMap.get(article.subcategory);
    if (child?.slug) parts.push(normalizeSlug(child.slug));
  }

  const articleSlug = normalizeSlug(article.slug);
  if (!articleSlug) return '';
  parts.push(articleSlug);

  const clean = parts.filter(Boolean).map(encodeURIComponent);
  return clean.length ? `/${clean.join('/')}` : '';
}

function buildCategoryPath(category, categories) {
  const parts = [];

  if (category.parent_id) {
    const parent = categories.find(
      (item) => String(item.id) === String(category.parent_id),
    );
    if (parent?.slug) parts.push(normalizeSlug(parent.slug));
  }

  if (category.slug) parts.push(normalizeSlug(category.slug));
  const clean = parts.filter(Boolean).map(encodeURIComponent);
  return clean.length ? `/${clean.join('/')}` : '/';
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/-+/g, '-');
}

function addUrl(map, loc, lastmod) {
  map.set(loc, { loc, lastmod });
}

function toW3cDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function requireEnv(env, names) {
  for (const name of names) {
    if (!env[name]) throw new Error(`Missing Worker environment variable: ${name}`);
  }
}
