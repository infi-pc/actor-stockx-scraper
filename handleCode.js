
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
exports.handleCode = handleCode;
