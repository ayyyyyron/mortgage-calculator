const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const file = 'mortgage-rate.json';
const endpoint = 'https://connect.secure.wellsfargo.com/xapi/product-service-research/homelending-tools/v1/rates/purchase';

async function refresh() {
  const response = await fetch(endpoint, {
    headers: {
      'X-WF-REQUEST-DATE': new Date().toISOString(),
      'X-CORRELATION-ID': randomUUID(),
      'X-REQUEST-ID': randomUUID(),
      'X-WF-CLIENT-ID': 'WU',
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('Wells Fargo returned HTTP ' + response.status);
  const { meta, data } = await response.json();
  if (meta?.success !== true || data?.loan_purpose !== 'Purchase') {
    throw new Error('Expected a successful purchase-rate response');
  }
  const products = data.product_list.filter(product =>
    product.loan_term === '30 years' && product.loan_type === 'CONVENTIONAL' &&
    product.product_type === 'FIXED');
  const rate = products[0]?.interest_rate;
  if (products.length !== 1 || !Number.isFinite(rate) || rate <= 0 || rate >= 25) {
    throw new Error('Expected one valid conventional 30-year fixed interest rate');
  }
  const match = data.time_stamp_message.match(/\bas of (\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!match) throw new Error('Missing the publication date');
  const [, month, day, year] = match;
  const asOf = year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
  const date = new Date(asOf);
  const age = Date.now() - date.getTime();
  if (!Number.isFinite(age) || date.toISOString().slice(0, 10) !== asOf ||
      age < -86400000 || age > 10 * 86400000) {
    throw new Error('Publication date is invalid or outside the expected window');
  }
  if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).asOf > asOf) {
    throw new Error('Wells Fargo returned an older quote');
  }
  fs.writeFileSync(file, JSON.stringify({ rate, asOf }, null, 2) + '\n');
  console.log('Verified ' + rate + '% as of ' + asOf);
}
refresh().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
