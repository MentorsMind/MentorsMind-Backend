module.exports = async (page) => {
  await page.evaluate(() => document.fonts?.ready);
};