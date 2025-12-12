// 辅助函数
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url) {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.href;
  } catch {
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return '';
  }
}

function normalizeSortOrder(val) {
  const num = Number(val);
  return Number.isFinite(num) ? num : 9999;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const catalog = url.searchParams.get('catalog');

  // 1. 从数据库获取站点数据
  let sites = [];
  try {
    const { results } = await env.NAV_DB.prepare(
      `SELECT s.*,c.catelog FROM sites s
                 INNER JOIN category c ON s.catelog_id = c.id
                 ORDER BY s.sort_order ASC, s.create_time DESC `
    ).all();
    sites = results;
  } catch (e) {
    return new Response(`Failed to fetch data: ${e.message}`, { status: 500 });
  }

  // 2. 处理分类逻辑
  const totalSites = sites.length;
  const categoryMinSort = new Map();
  const categorySet = new Set();

  sites.forEach((site) => {
    const categoryName = (site.catelog || '').trim() || '未分类';
    categorySet.add(categoryName);
    const rawSort = Number(site.sort_order);
    const normalized = Number.isFinite(rawSort) ? rawSort : 9999;
    if (!categoryMinSort.has(categoryName) || normalized < categoryMinSort.get(categoryName)) {
      categoryMinSort.set(categoryName, normalized);
    }
  });

  const categoryOrderMap = new Map();
  try {
    const { results: orderRows } = await env.NAV_DB.prepare(
      'SELECT catelog, sort_order FROM category'
    ).all();
    orderRows.forEach(row => {
      categoryOrderMap.set(row.catelog, normalizeSortOrder(row.sort_order));
    });
  } catch (error) {
    if (!/no such table/i.test(error.message || '')) {
      return new Response(`Failed to fetch category orders: ${error.message}`, { status: 500 });
    }
  }

  const catalogsWithMeta = Array.from(categorySet).map((name) => {
    const fallbackSort = categoryMinSort.has(name) ? normalizeSortOrder(categoryMinSort.get(name)) : 9999;
    const order = categoryOrderMap.has(name) ? categoryOrderMap.get(name) : fallbackSort;
    return { name, order, fallback: fallbackSort };
  });

  catalogsWithMeta.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.fallback !== b.fallback) return a.fallback - b.fallback;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base' });
  });

  const catalogs = catalogsWithMeta.map(item => item.name);

  // 3. 筛选当前分类的站点
  const requestedCatalog = (catalog || '').trim();
  const catalogExists = Boolean(requestedCatalog && catalogs.includes(requestedCatalog));
  const currentCatalog = catalogExists ? requestedCatalog : catalogs[0];
  const currentSites = catalogExists
    ? sites.filter((s) => {
        const catValue = (s.catelog || '').trim() || '未分类';
        return catValue === currentCatalog;
      })
    : sites;

  // 4. 生成动态内容
  const catalogLinkMarkup = catalogs.map((cat) => {
    const safeCat = escapeHTML(cat);
    const encodedCat = encodeURIComponent(cat);
    const isActive = catalogExists && cat === currentCatalog;
    const linkClass = isActive ? 'bg-secondary-100 text-primary-700' : 'hover:bg-gray-100';
    const iconClass = isActive ? 'text-primary-600' : 'text-gray-400';
    return `
      <a href="?catalog=${encodedCat}" class="flex items-center px-3 py-2 rounded-lg ${linkClass} w-full">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 ${iconClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        ${safeCat}
      </a>
    `;
  }).join('');

  const sitesGridMarkup = currentSites.map((site) => {
    const rawName = site.name || '未命名';
    const rawCatalog = site.catelog || '未分类';
    const rawDesc = site.desc || '暂无描述';
    const normalizedUrl = sanitizeUrl(site.url);
    const hrefValue = escapeHTML(normalizedUrl || '#');
    const displayUrlText = normalizedUrl || site.url || '';
    const safeDisplayUrl = displayUrlText ? escapeHTML(displayUrlText) : '未提供链接';
    const dataUrlAttr = escapeHTML(normalizedUrl || '');
    const logoUrl = sanitizeUrl(site.logo);
    const cardInitial = escapeHTML((rawName.trim().charAt(0) || '站').toUpperCase());
    const safeName = escapeHTML(rawName);
    const safeCatalog = escapeHTML(rawCatalog);
    const safeDesc = escapeHTML(rawDesc);
    const safeDataName = escapeHTML(site.name || '');
    const safeDataCatalog = escapeHTML(site.catelog || '');
    const hasValidUrl = Boolean(normalizedUrl);

    return `
      <div class="site-card group bg-white border border-primary-100/60 rounded-xl shadow-sm overflow-hidden" data-id="${site.id}" data-name="${safeDataName}" data-url="${dataUrlAttr}" data-catalog="${safeDataCatalog}">
        <div class="p-5">
          <a href="${hrefValue}" ${hasValidUrl ? 'target="_blank" rel="noopener noreferrer"' : ''} class="block">
            <div class="flex items-start">
              <div class="site-icon flex-shrink-0 mr-4 transition-all duration-300">
                ${
                  logoUrl
                    ? `<img src="${escapeHTML(logoUrl)}" alt="${safeName}" class="w-10 h-10 rounded-lg object-cover bg-gray-100">`
                    : `<div class="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white font-semibold text-lg shadow-inner">${cardInitial}</div>`
                }
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="site-title text-base font-medium text-gray-900 truncate transition-all duration-300 origin-left" title="${safeName}">${safeName}</h3>
                <span class="inline-flex items-center px-2 py-0.5 mt-1 rounded-full text-xs font-medium bg-secondary-100 text-primary-700">
                  ${safeCatalog}
                </span>
              </div>
            </div>
            <p class="mt-2 text-sm text-gray-600 leading-relaxed line-clamp-2" title="${safeDesc}">${safeDesc}</p>
          </a>
          <div class="mt-3 flex items-center justify-between">
            <span class="text-xs text-primary-600 truncate max-w-[140px]" title="${safeDisplayUrl}">${safeDisplayUrl}</span>
            <button class="copy-btn relative flex items-center px-2 py-1 ${hasValidUrl ? 'bg-accent-100 text-accent-700 hover:bg-accent-200' : 'bg-gray-200 text-gray-400 cursor-not-allowed'} rounded-full text-xs font-medium transition-colors" data-url="${dataUrlAttr}" ${hasValidUrl ? '' : 'disabled'}>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              复制
              <span class="copy-success hidden absolute -top-8 right-0 bg-accent-500 text-white text-xs px-2 py-1 rounded shadow-md">已复制!</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const datalistOptions = catalogs.map((cat) => `<option value="${escapeHTML(cat)}">`).join('');
  const headingPlainText = catalogExists
    ? `${currentCatalog} · ${currentSites.length} 个网站`
    : `全部收藏 · ${sites.length} 个网站`;
  const headingText = escapeHTML(headingPlainText);
  const headingDefaultAttr = escapeHTML(headingPlainText);
  const headingActiveAttr = catalogExists ? escapeHTML(currentCatalog) : '';
  const submissionEnabled = String(env.ENABLE_PUBLIC_SUBMISSION) === 'true';
  const submissionClass = submissionEnabled ? '' : 'hidden';

  const siteName = env.SITE_NAME || '灰色轨迹';
  const siteDescription = env.SITE_DESCRIPTION || '一个优雅、快速、易于部署的书签（网址）收藏与分享平台，完全基于 Cloudflare 全家桶构建';
  const footerText = env.FOOTER_TEXT || '曾梦想仗剑走天涯';

  // 5. 读取 HTML 模板并替换占位符
  const templateResponse = await env.ASSETS.fetch(new URL('/index.html', request.url));
  let html = await templateResponse.text();

  html = html
    .replace(/{{SITE_NAME}}/g, escapeHTML(siteName))
    .replace('{{SITE_DESCRIPTION}}', escapeHTML(siteDescription))
    .replace('{{FOOTER_TEXT}}', escapeHTML(footerText))
    .replace('{{CATALOG_EXISTS}}', catalogExists ? 'true' : 'false')
    .replace('{{CATALOG_LINKS}}', catalogLinkMarkup)
    .replace('{{SUBMISSION_CLASS}}', submissionClass)
    .replace('{{DATALIST_OPTIONS}}', datalistOptions)
    .replace('{{TOTAL_SITES}}', totalSites)
    .replace('{{CATALOG_COUNT}}', catalogs.length)
    .replace('{{HEADING_TEXT}}', headingText)
    .replace('{{HEADING_DEFAULT}}', headingDefaultAttr)
    .replace('{{HEADING_ACTIVE}}', headingActiveAttr)
    .replace('{{SITES_GRID}}', sitesGridMarkup)
    .replace('{{CURRENT_YEAR}}', new Date().getFullYear());

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
