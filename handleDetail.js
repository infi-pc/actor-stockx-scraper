const Apify = require("apify");


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
        await page.click(`[aria-label="Close"]`, { timeout: 5000 });
      } catch (err) {
        log.info("Modal to click not found: " + String(err));
      }
      try {
        await page.click(`[aria-label="close"]`, { timeout: 5000 });
      } catch (err) {
        log.info("Modal to click not found: " + String(err));
      }



      await page.click("text=View Sales");
      await page.waitForSelector('[data-component="ViewMarketActivity"] tbody');

      sales = await page.$$eval(
        '[data-component="ViewMarketActivity"] tbody',
        (tbody) => {
          const data = [];
          console.log({ tbody });
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
      log.info("View sales error: " + String(err));
    }

    const dataToWrite = {
      "#success": true,
      url: request.url,
      data,
      sales,
      pid,
      image,
    };

    // await fs.writeFile("./data.json", JSON.stringify(dataToWrite));
    await Apify.pushData(dataToWrite);
  } catch (err) {
    await Apify.pushData({
      "#success": false,
      url: request.url,
      error: err.message, // TODO: maybe stringify
    });
  }
}
exports.handleDetail = handleDetail;
