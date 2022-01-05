const Apify = require("apify");
const fs = require("fs/promises");
const playwright = require("playwright");
const {
  utils: { log },
} = Apify;

Apify.main(async () => {
  const { startUrls = [], codes = [] } = (await Apify.getInput()) ?? {
    startUrls: [
      // "https://stockx.com/futura-2000-fl-006-figure",
      "https://stockx.com/air-jordan-max-aura-black",
    ],
    codes: [
      // 'AT8240-103',
      // 'VN0A4U39ZPM',
      // 'FW8978'
    ],
  };

  const requestList = await Apify.openRequestList("start-urls", startUrls);
  const requestQueue = await Apify.openRequestQueue();
  const codesMapKVStore = await Apify.openKeyValueStore("STOCKX-CODES-MAP");

  // load cachedUrl LUT code -> url
  for (const code of codes) {
    // `CT8013-170`
    const cachedUrl = await codesMapKVStore.getValue(code);
    if (cachedUrl) {
      log.info(
        `Code ${code} already exists in the store, reusing with url ${cachedUrl}`
      );
      await requestQueue.addRequest({
        url: cachedUrl,
        userData: { type: "DETAIL" },
      });
    } else {
      log.info(`Code ${code} not found in the store, adding`);
      await requestQueue.addRequest({
        url: `https://stockx.com/search?s=${code}`,
        userData: { type: "CODE", code },
      });
    }
  }

  const proxyConfiguration = await Apify.createProxyConfiguration({
    groups: ["RESIDENTIAL"],
  });

  // Tried Puppeteer at first, but
  // `stealth: true` is not working https://discord.com/channels/801163717915574323/801163920299393034/903107007148601346
  // so I've tried `stealthOptions.hideWebDriver = true`, but also did not work
  // so I've tried PlaywrightCrawler as recommended https://discord.com/channels/801163717915574323/801163920299393034/903114071086342185
  const crawler = new Apify.PlaywrightCrawler({
    maxRequestRetries: 5, //
    maxConcurrency: 1, // to make debugging easier
    requestList,
    requestQueue,
    persistCookiesPerSession: false,
    proxyConfiguration, // TODO: Enable on platform
    launchContext: {
      useChrome: true, // full Google Chrome rather than the bundled Chromium
      // launcher: require("playwright").firefox,
    },
    navigationTimeoutSecs: 3 * 60,
    preNavigationHooks: [
      async (crawlingContext, gotoOptions) => {
        await crawlingContext.browserController.setCookies(
          crawlingContext.page,
          [
            {
              name: "stockx_selected_currency",
              value: "EUR",
              domain: "stockx.com",
              path: "/",
            },
          ]
        );
      },
    ],
    handlePageFunction: async (context) => {
      const { request, response, page, session } = context;
      const {
        url,
        userData: { type },
      } = request;
      log.info("Page opened.", { type, url });

      // Handle blocking
      switch (response.status()) {
        case 404:
          log.info("404 » skipping", { url });
          return;
        case 403: // FIXME: This is already handled by the PlaywrightCrawler
          log.info("403 (blocked) » retiring session and aborting", { url });
          session.retire();
          throw "403"; // Not throwing error, no need for call-stack
        case 200:
          const captcha = await page.$("[class*='captcha']");
          if (captcha) {
            log.info(
              "200 (ok), but captcha detected » retiring session and aborting",
              { url }
            );
            throw "captcha"; // Not throwing error, no need for call-stack
          } else {
            log.info("200 (ok) » continuing", { url });
          }
          break;
        default:
          log.info("Unhandled status » retiring session and aborting", {
            url,
            status: response.status(),
          });
          session.retire();
          throw "Unhandled status"; // Not throwing error, no need for call-stack
      }

      // Process
      switch (type) {
        case "LIST": // https://stockx.com/nike // TODO
          return handleList(context);
        case "CODE":
          return handleCode(context, requestQueue, codesMapKVStore);
        case "DETAIL": // https://stockx.com/nike-dunk-low-retro-white-black-2021
          return handleDetail(context);
        default:
          // https://stockx.com/ // TODO
          return handleStart(context);
      }
    },
  });

  log.info("Starting the crawl.");
  await crawler.run();
  log.info("Crawl finished.");
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
  const url = await page.$eval(
    '[data-testid="product-tile"] > a',
    (aEl) => aEl.href
  );

  const { code } = request.userData; // passed from main
  await requestQueue.addRequest({ url, userData: { type: "DETAIL" } });
  await codesMapKVStore.setValue(code, url);
}

async function handleDetail({ request, page }) {
  try {
    const pid = await page.$$eval("head title", (els) => {
      if (els.length > 1) {
        console.error("too many titles");
      }
      if (els.length === 0) {
        throw new Error("no title");
      }
      const foundTitle = els[0];
      const foundPid = foundTitle.textContent.match(/[^ ]+$/)[0];

      return foundPid;
    });
    log.info("found pid: " + pid);
    const image = await page.$$eval('meta[property="image"]', (els) => {
      if (els.length === 0) {
        return null;
      }
      const foundImage = els[0];

      return foundImage.content;
    });
    log.info("found image: " + image);
    const data = await page.$$eval(
      'script[type="application/ld+json"]',
      (scriptEls) => {
        const productJsonLdEl = scriptEls.find((x) => {
          const parsed = JSON.parse(x.textContent);
          return parsed["@type"] === "Product";
        });
        const productJsonLdText = productJsonLdEl.textContent;
        return JSON.parse(productJsonLdText);
      }
    );
    log.info("found found data, pushing");

    const sales = null;

    try {
      try {
        await page.click(`[aria-label="close"]`, { timeout: 5000 });
      } catch (err) {
        log.info("Modal to click not found: ", String(err));
      }

      await page.click("text=View Sales");
      await page.waitForSelector('[data-component="ViewMarketActivity"]');

      sales = await page.$$eval(
        '[data-component="ViewMarketActivity"] tbody',
        (tbody) => {
          const data = [];
          for (const x of tbody.children) {
            const date = x.children[0].innerText;
            const time = x.children[1].innerText;
            const size = x.children[2].innerText;
            const price = x.children[3].innerText;
            data.push({
              date,
              time,
              size,
              price,
            });
          }
          return data;
        }
      );
    } catch (err) {
      console.error(err);
      log.info("View sales error: ", String(err));
    }

    console.log("SALES: ", sales);

    const dataToWrite = {
      "#success": true,
      url: request.url,
      data, // TODO: Remove internal @ props
      sales,
      pid,
      image,
    };

    await fs.writeFile("./data.json", JSON.stringify(dataToWrite));

    await Apify.pushData(dataToWrite);
  } catch (err) {
    await Apify.pushData({
      "#success": false,
      url: request.url,
      error: err.message, // TODO: maybe stringify
    });
  }
}
