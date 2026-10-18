/** @type {import("puppeteer").Configuration} */
module.exports = {
  // Skip downloading Chrome (~150 MB) during Vercel or CI builds where E2E does not run
  skipDownload: Boolean(process.env.VERCEL || process.env.CI),
};
