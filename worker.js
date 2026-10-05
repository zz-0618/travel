const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const SITE_NAME = '一葉知途';
const DEFAULT_DESCRIPTION = '一葉知途分享韓國自由行攻略，包含濟州島及釜山的美食、交通、住宿與旅遊心得。';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/sitemap.xml') {
      return generateSitemap(request, env);
    }

    if (url.pathname === '/robots.txt') {
      return generateRobots(request);
    }

    // 靜態資源完全交給 ASSETS，不做 HTMLRewriter。
    // 這可避免 CSS、字型、圖片被文章路由或 SPA fallback 誤判。
    if (
      url.pathname.startsWith('/css/') ||
      url.pathname.startsWith('/fonts/') ||
      url.pathname === '/favicon.png' ||
      hasFileExtension(url.pathname)
    ) {
      return env.ASSETS.fetch(request);
    }

    // 首頁與後台直接回傳靜態資源。
    if (
      url.pathname === '/' ||
      url.pathname === '/index.html' ||
      url.pathname === '/admin' ||
      url.pathname === '/admin/'
    ) {
      return env.ASSETS.fetch(request);
    }

    // 重要：乾淨網址先查文章，再交給 ASSETS。
    // 不能先因 ASSETS 回傳 SPA 的 index.html 就直接 return，否則搜尋引擎只會看到首頁 SEO。
    const pathParts = decodeURIComponent(url.pathname)
      .split('/')
      .filter(Boolean);
    const slug = pathParts.at(-1) || '';

    if (slug) {
      const article = await findPublishedArticleBySlug(env, slug);
      if (article) {
        return renderArticleHtml(request, env, article);
      }
    }

    // 非文章路徑（例如分類頁）仍交給前端 SPA 處理。
    return env.ASSETS.fetch(
      new Request(new URL('/', request.url), request),
    );
  },
};

function hasFileExtension(pathname) {
  return /\/[^/]+\.[A-Za-z0-9]{1,10}$/.test(pathname);
}

async function generateSitemap(request, env) {
  try {
    requireEnv(env, ['SUPABASE_URL', 'SUPABASE_ANON_KEY']);

    const [articles, categories, settings] = await Promise.all([
      supabaseSelect(
        env,
        'articles',
        'id,category,subcategory,slug,created_at,updated_at',
      ),
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
        if (lastmod) {
          fields.push(`<lastmod>${escapeXml(toW3cDate(lastmod))}</lastmod>`);
        }
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
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_ANON_KEY']);

  const baseUrl = env.SUPABASE_URL.replace(/\/$/, '');
  const endpoint = new URL(`${baseUrl}/rest/v1/${table}`);
  endpoint.searchParams.set('select', select);

  const response = await fetch(endpoint, {
    headers: supabaseHeaders(env),
  });

  if (!response.ok) {
    throw new Error(
      `Supabase ${table} query failed: ${response.status} ${await response.text()}`,
    );
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Supabase ${table} response is not an array`);
  }

  return data;
}

async function findPublishedArticleBySlug(env, slug) {
  try {
    requireEnv(env, ['SUPABASE_URL', 'SUPABASE_ANON_KEY']);

    const baseUrl = env.SUPABASE_URL.replace(/\/$/, '');
    const endpoint = new URL(`${baseUrl}/rest/v1/articles`);
    endpoint.searchParams.set('slug', `eq.${slug}`);
    endpoint.searchParams.set('select', '*');
    endpoint.searchParams.set('limit', '1');

    const response = await fetch(endpoint, {
      headers: supabaseHeaders(env),
    });

    if (!response.ok) {
      console.error('Article query failed:', response.status, await response.text());
      return null;
    }

    const rows = await response.json();
    const article = Array.isArray(rows) ? rows[0] : null;
    if (!article) return null;

    const status = await getSettingValue(env, `article_status_${article.id}`);
    return status === 'draft' ? null : article;
  } catch (error) {
    console.error('Article lookup failed:', error);
    return null;
  }
}

async function getSettingValue(env, key) {
  const baseUrl = env.SUPABASE_URL.replace(/\/$/, '');
  const endpoint = new URL(`${baseUrl}/rest/v1/settings`);
  endpoint.searchParams.set('key', `eq.${key}`);
  endpoint.searchParams.set('select', 'value');
  endpoint.searchParams.set('limit', '1');

  const response = await fetch(endpoint, {
    headers: supabaseHeaders(env),
  });

  if (!response.ok) return null;

  const rows = await response.json();
  return Array.isArray(rows) ? rows[0]?.value ?? null : null;
}

function supabaseHeaders(env) {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
  };
}

async function renderArticleHtml(request, env, article) {
  const indexResponse = await env.ASSETS.fetch(
    new Request(new URL('/', request.url), request),
  );

  if (!indexResponse.ok) return indexResponse;

  const articleUrl = new URL(request.url).href;
  const title = `${normalizeText(article.title) || SITE_NAME}｜${SITE_NAME}`;
  const description = buildDescription(article);
  const image = absoluteUrl(article.cover_image_url, new URL(request.url).origin);
  const structuredData = buildArticleStructuredData({
    article,
    articleUrl,
    description,
    image,
  });

  const rewriter = new HTMLRewriter()
    .on('title', new TextContentHandler(title))
    .on('meta[name="description"]', new MetaContentHandler(description))
    .on('meta[name="robots"]', new MetaContentHandler('index,follow,max-image-preview:large'))
    .on('meta[property="og:type"]', new MetaContentHandler('article'))
    .on('meta[property="og:title"]', new MetaContentHandler(title))
    .on('meta[property="og:description"]', new MetaContentHandler(description))
    .on('meta[property="og:url"]', new MetaContentHandler(articleUrl))
    .on('meta[property="og:image"]', new MetaContentHandler(image))
    .on('meta[name="twitter:card"]', new MetaContentHandler('summary_large_image'))
    .on('meta[name="twitter:title"]', new MetaContentHandler(title))
    .on('meta[name="twitter:description"]', new MetaContentHandler(description))
    .on('meta[name="twitter:image"]', new MetaContentHandler(image))
    .on('link[rel="canonical"]', new AttributeHandler('href', articleUrl))
    .on('#structured-data', new JsonLdHandler(structuredData));

  const response = rewriter.transform(indexResponse);
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/html; charset=UTF-8');
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.set('X-Robots-Tag', 'index, follow, max-image-preview:large');
  headers.set('Vary', 'Accept-Encoding');

  return new Response(response.body, {
    status: 200,
    headers,
  });
}

class TextContentHandler {
  constructor(value) {
    this.value = value;
  }

  element(element) {
    element.setInnerContent(this.value);
  }
}

class MetaContentHandler {
  constructor(value) {
    this.value = value || '';
  }

  element(element) {
    element.setAttribute('content', this.value);
  }
}

class AttributeHandler {
  constructor(name, value) {
    this.name = name;
    this.value = value;
  }

  element(element) {
    element.setAttribute(this.name, this.value);
  }
}

class JsonLdHandler {
  constructor(value) {
    this.value = value;
  }

  element(element) {
    element.setInnerContent(JSON.stringify(this.value));
  }
}

function buildDescription(article) {
  const excerpt = normalizeText(article.excerpt);
  if (excerpt) return excerpt.slice(0, 160);

  const plainContent = stripHtml(article.content);
  return (plainContent || DEFAULT_DESCRIPTION).slice(0, 160);
}

function buildArticleStructuredData({ article, articleUrl, description, image }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: normalizeText(article.title),
    description,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': articleUrl,
    },
    author: {
      '@type': 'Person',
      name: SITE_NAME,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
    },
    articleSection: normalizeText(article.subcategory || article.category),
    inLanguage: 'zh-TW',
  };

  if (image) data.image = [image];
  if (article.created_at) data.datePublished = article.created_at;
  if (article.updated_at || article.created_at) {
    data.dateModified = article.updated_at || article.created_at;
  }

  return data;
}

function absoluteUrl(value, origin) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    return new URL(raw, origin).href;
  } catch {
    return '';
  }
}

function stripHtml(value) {
  return normalizeText(
    String(value || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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
    if (!env[name]) {
      throw new Error(`Missing Worker environment variable: ${name}`);
    }
  }
}
