module.exports = async (page) => {
  await page.setJavaScriptEnabled(false);
  await page.setDefaultNavigationTimeout(30000);
};