const Apify = require("apify");
const fs = require("fs/promises");
const playwright = require("playwright");
const {
  utils: { log },
} = Apify;

console.log("Starting module");

Apify.main(async () => {
  console.log("Starting main");
  const { slugs = [], codes = [], requestAll } = (await Apify.getInput()) ?? {
    slugs: [], // ["air-jordan-max-aura-black"],
    codes: [], // ["AT8240-103", "VN0A4U39ZPM", "FW8978"],
    requestAll: "year=2021&market.lowestAsk=gte-600" // ""
  };

  console.log(`slugs: ${slugs}`);
  console.log(`codes: ${codes}`);
  console.log(`requestAll: ${requestAll}`);

  console.log("Opening request list");
  const requestList = await Apify.openRequestList(
    "slugs",
    slugs.map((slug) => {
      return { url: makeDetailUrl(slug), userData: { type: "DETAIL" } };
    })
  );

  console.log("Opening request queue");
  const requestQueue = await Apify.openRequestQueue();

  console.log("Opening KV Store");
  const codesMapKVStore = await Apify.openKeyValueStore(
    "STOCKX-CODES-TO-SLUG-MAP"
  );

  if (requestAll) {
    console.log("Adding request all");
    await requestQueue.addRequest({
      url: `https://stockx.com/api/browse?browseVerticals=sneakers&currency=EUR&${requestAll}`,
      userData: { type: "GET_ALL" },
    }, {
      forefront: true,
    });
  }

  console.log("Adding codes");
  // load cachedUrl LUT code -> url
  for (const code of codes) {
    const cachedSlug = await codesMapKVStore.getValue(code);
    if (cachedSlug) {
      log.info(
        `Code ${code} already exists in the store, reusing with url ${cachedSlug}`
      );

      await requestQueue.addRequest({
        url: makeDetailUrl(cachedSlug),
        userData: { type: "DETAIL" },
      });
    } else {
      log.info(`Code ${code} not found in the store, adding`);
      const url =
        "https://xw7sbct9v6-1.algolianet.com/1/indexes/products/query?x-algolia-agent=Algolia%20for%20vanilla%20JavaScript%203.32.1&x-algolia-application-id=XW7SBCT9V6&x-algolia-api-key=6b5e76b49705eb9f51a06d3c82f7acee&x-xcode=" +
        code;
      const headers = {
        // 'user-agent': userAgent,
        "sec-fetch-dest": "none",
        accept: "*/*",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "cors",
        "accept-language": "en-US",
        // Just for cachebusting apify, Apify can't take body in request, so i have to put the unique code somewhere
        // "X-code": code,
      };

      const body = JSON.stringify({
        params: `query=${code}&facets=*&filters=&hitsPerPage=10`,
      });
      const method = "POST";
      await requestQueue.addRequest({
        url,
        method,
        headers,
        payload: body,
        userData: { type: "CODE", code },
      });
      log.info(`Code ${code} not found in the store, added to queue`);
    }
  }

  console.log("Setup proxy");
  const proxyConfiguration = await Apify.createProxyConfiguration({
    groups: ["RESIDENTIAL"],
  });

  console.log("Starting crawler");
  const crawler = new Apify.BasicCrawler({
    maxRequestRetries: 3, //
    maxConcurrency: 5, // or 1 to make debugging easier
    requestList,
    requestQueue,

    // proxyConfiguration, // TODO: Enable on platform
    handleRequestFunction: async (context) => {
      const { request, session } = context;
      const {
        url,
        headers,
        method,
        payload,
        userData: { type },
      } = request;

      log.info(`Processing ${method || "GET"} ${context.request.url}`);

      const finalRequest = { url: request.url };
      if (headers) {
        finalRequest.headers = headers;
      }
      if (payload) {
        finalRequest.payload = payload;
      }
      if (method) {
        finalRequest.method = method;
      }

      const response = await Apify.utils.requestAsBrowser({
        ...finalRequest,
        proxyUrl: proxyConfiguration.newUrl(),
      });

      switch (response.statusCode) {
        case 404:
          log.error("404 » skipping", { url });
          return;
        case 403:
          log.error("403 (blocked) » retiring session and aborting", { url });
          session.retire();
          throw "403"; // Not throwing error, no need for call-stack
        case 200:
          log.info("200 (ok) » continuing", { url });
          break;
        default:
          log.error("Unhandled status » retiring session and aborting", {
            url,
            status: response.statusCode,
          });
          session.retire();
          throw (
            "Unhandled status: " +
            response.statusCode +
            ": " +
            String(response.body)
          ); // Not throwing error, no need for call-stack
      }

      log.info("Handling request", { url, type: type || "no type" });

      switch (type) {
        case "LIST": // https://stockx.com/nike // TODO
          return;
        case "CODE":
          const { hits } = JSON.parse(response.body);
          const mathing = hits.filter(({ style_id }) => {
            return style_id === request.userData.code;
          });
          if (mathing.length >= 1) {
            await requestQueue.addRequest({
              url: makeDetailUrl(mathing[0].url),
              userData: { type: "DETAIL", code: mathing[0].style_id },
            });
            log.info("Adding to queue", { url: makeDetailUrl(mathing[0].url) });
            await codesMapKVStore.setValue(mathing[0].style_id, mathing[0].url);
          } else {
            log.error(`Code ${request.userData.code} not found, skipping`);

            const availableCodes = hits
              .map(({ style_id }) => style_id)
              .join(", ");

            log.error(`Available codes: ${availableCodes}`);

            await Apify.pushData({
              "#missingCode": true,
              pid: request.userData.code,
              error: `PID not found. Available codes: ${availableCodes}`,
            });
          }
          return;
        case "DETAIL":
          const parsedDetail = JSON.parse(response.body);
          const id = parsedDetail.Product.id;
          const sales = await Apify.utils.requestAsBrowser({
            url: `https://stockx.com/api/products/${id}/activity?limit=100&page=1&sort=createdAt&order=DESC&state=480&currency=EUR&country=CZ`,
            proxyUrl: proxyConfiguration.newUrl(),
          });

          await Apify.pushData({
            "#success": true,
            pid: parsedDetail.Product.styleId,
            url: request.url,
            sales:
              sales.statusCode == 200
                ? JSON.parse(sales.body)
                : String(sales.body),
            data: parsedDetail,
          });
          return;
        case "GET_ALL": 
          const parsedAll = JSON.parse(response.body);
          for (const shoe of parsedAll.Products) {
            await requestQueue.addRequest({
              url: makeDetailUrl(shoe.urlKey),
              userData: { type: "DETAIL", code: shoe.styleId },
            });
          }
          // if (parsedAll.Pagination.nextPage) {
          //   await requestQueue.addRequest({
          //     url: `https://stockx.com/api/browse?browseVerticals=sneakers&currency=EUR&${requestAll}&page=${page + 1}`,
          //     userData: { type: "GET_ALL", page: page + 1 },
          //   });
          // }
          return;
        default:
          throw "Unhandled type: " + type;
      }
    },
  });

  log.info("Starting the crawl.");
  await crawler.run();
  log.info("Crawl finished.");
});

function makeDetailUrl(slug) {
  return `https://stockx.com/api/products/${slug}?includes=market&currency=EUR&country=CZ`;
}
