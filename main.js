const Apify = require('apify');
const { utils: { log } } = Apify;

Apify.main(async () => {
  const { startUrls, codes } = await Apify.getInput();

  const requestList = await Apify.openRequestList('start-urls', startUrls);
  const requestQueue = await Apify.openRequestQueue();
  const codesMapKVStore = await Apify.openKeyValueStore('STOCKX-CODES-MAP');

  // load cachedUrl LUT code -> url
  for (const code of codes) { // `CT8013-170`
    const cachedUrl = await codesMapKVStore.getValue(code);
    if (cachedUrl) {
      log.info(`Code ${code} already exists in the store, reusing with url ${cachedUrl}`);
      await requestQueue.addRequest({
        url: cachedUrl,
        userData: { type: 'DETAIL' },
      });
    } else {
      log.info(`Code ${code} not found in the store, adding`);
      await requestQueue.addRequest({
        url: `https://stockx.com/search?s=${code}`,
        userData: { type: 'CODE', code },
      });
    }
  }

  // const proxyConfiguration = await Apify.createProxyConfiguration();

  const crawler = new Apify.PuppeteerCrawler({
    requestList,
    requestQueue,
    // proxyConfiguration, // TODO: Enable on platform
    launchContext: {
      useChrome: true,
      stealth: true,
    },
    handlePageFunction: async (context) => {
      const { url, userData: { type } } = context.request;
      log.info('Page opened.', { type, url });
      switch (type) {
        case 'LIST': // https://stockx.com/nike // TODO
          return handleList(context);
        case 'CODE':
          return handleCode(context, requestQueue, codesMapKVStore);
        case 'DETAIL': // https://stockx.com/nike-dunk-low-retro-white-black-2021
          return handleDetail(context);
        default: // https://stockx.com/ // TODO
          return handleStart(context);
      }
    },
  });

  log.info('Starting the crawl.');
  await crawler.run();
  log.info('Crawl finished.');
});

async function handleStart({ request, page }) {
  // TODO: Next iteration
}

async function handleList({ request, page }) {
  // TODO: Next iteration
}

async function handleCode({ request, page }, requestQueue, codesMapKVStore) {
  // BEWARE: We rely on the first result being the correct one

  // Variant A: From JSON-LD
  // const jsonLD = await page.$eval('script[type="application/ld+json"]', (ldElem) => ldElem.textContent);
  // const jsonLDParsed = JSON.parse(jsonLD);
  // const { url } = jsonLDParsed.itemListElement[0].item;

  // Variant B: From DOM
  const url = await page.$eval('[data-testid="product-tile"] > a', aEl => aEl.href)

  const { code } = request.userData; // passed from main
  await requestQueue.addRequest({ url, userData: { type: 'DETAIL' } });
  await codesMapKVStore.setValue(code, url);
}

async function handleDetail({ request, page }) {
  try {
    const data = await page.$$eval('script[type="application/ld+json"]', (scriptEls) => {
      const productJsonLdEl = scriptEls.find(x => {
        const parsed = JSON.parse(x.textContent);
        return parsed['@type'] === "Product"
      });
      const productJsonLdText = productJsonLdEl.textContent;
      return JSON.parse(productJsonLdText);
    });
    await Apify.pushData({
      '#success': true,
      url: request.url,
      data, // TODO: Remove internal @ props
    });
  } catch (err) {
    await Apify.pushData({
      '#success': false,
      url: request.url,
      error: err.message, // TODO: maybe stringify
    });
  }
}
