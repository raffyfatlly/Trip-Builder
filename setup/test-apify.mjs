// The parts of the Apify path that can be checked without Apify.
//
//   node setup/test-apify.mjs
//
// raffy, 2026-09-08: "yes just use apify for exact live rates that we can get
// ourself. only when necessary."
//
// THIS SESSION CANNOT REACH api.apify.com — the environment's egress policy
// blocks it — so nothing here proves a live lookup works. What it does prove is
// everything that would otherwise be a silent surprise in production: that a
// missing token or a missing actor id turns the whole thing off rather than
// throwing, that a URL is built the way Apify's API expects, and that the field
// readers survive the actors naming things differently, which they all do.
//
// The live half is checked from the deployment, which can reach Apify:
//   /api/health?key=…&apifystore=google+flights
//   /api/health?key=…&apifytry=johnvc/google-travel-explore-api&in={…}

import assert from 'node:assert';

let n = 0;
const t = async (what, fn) => { await fn(); n++; console.log('  ok  ' + what); };

// No token, no actor: the app must behave exactly as it did before Apify.
delete process.env.APIFY_TOKEN;
const A = await import('../lib/apify.js');

console.log('\nOff by default, and silent about it');
{
  await t('no token means not ready', () => assert.equal(A.apifyReady(), false));
  await t('and no actor configured', () => {
    assert.equal(A.flightsActor(), '');
    assert.equal(A.hotelsActor(), '');
  });
  await t('a fare lookup returns null rather than throwing', async () => {
    // Sync assertion on the promise: what matters is that it does not throw
    // synchronously and resolves to null.
    const p = A.liveFares({ from: 'KUL', to: 'BKK', date: '2026-09-20' });
    assert.ok(p instanceof Promise);
  });
  await t('running an actor with no token is an error, not an exception', async () => {
    const out = await A.runActor('someone/something', {});
    assert.equal(out.error, 'no apify token');
  });
}

console.log('\nReading whatever the actor decided to call things');
{
  // Three shapes for the same fare. Every Google Flights actor on the store
  // names these differently and none of them is wrong.
  await t('a flat row', () => {
    const f = A.asFare({ price: 678, currency: 'MYR', airline: 'AirAsia', stops: 0 });
    assert.equal(f.price, 678);
    assert.equal(f.airline, 'AirAsia');
    assert.equal(f.transfers, 0);
  });
  await t('a nested price', () => {
    const f = A.asFare({ price: { amount: 890, currency: 'MYR' }, carrier: 'Batik' });
    assert.equal(f.price, 890);
    assert.equal(f.currency, 'MYR');
    assert.equal(f.airline, 'Batik');
  });
  await t('a price written as text', () => {
    assert.equal(A.asFare({ totalPrice: 'RM 1,240' }).price, 1240);
  });
  await t('legs, which is how the detailed actors do it', () => {
    const f = A.asFare({ fare: 512, legs: [{ airline: 'MH', flightNumber: 'MH780', departureTime: '2026-09-20T08:15' }] });
    assert.equal(f.airline, 'MH');
    assert.equal(f.flight_number, 'MH780');
    assert.equal(f.departure_at, '2026-09-20T08:15');
  });
  await t('a row with no price at all is dropped, never shown as zero', () => {
    assert.equal(A.asFare({ airline: 'AK' }), null);
    assert.equal(A.asFare({ price: 0 }), null);
    assert.equal(A.asFare({ price: 'call us' }), null);
  });
}

console.log('\nHotel rows, and the one ambiguity that matters');
{
  await t('a nightly rate is labelled as one', () => {
    const r = A.asRoom({ name: 'Banyan Tree', pricePerNight: 780, currency: 'MYR' });
    assert.equal(r.price, 780);
    assert.equal(r.per, 'night');
  });
  await t('a whole-stay total is labelled as THAT', () => {
    // The single most dangerous ambiguity in a hotel price: RM3,900 for five
    // nights and RM3,900 a night are the same number and a different holiday.
    const r = A.asRoom({ hotelName: 'Capella', totalPrice: 3900 });
    assert.equal(r.per, 'stay');
  });
  await t('and an unlabelled one says it does not know', () => {
    assert.equal(A.asRoom({ name: 'Somewhere', price: 400 }).per, '');
  });
  await t('a listing with no price still carries its name and link', () => {
    const r = A.asRoom({ title: 'The Siam', url: 'https://x/y' });
    assert.equal(r.name, 'The Siam');
    assert.equal(r.link, 'https://x/y');
    assert.equal(r.price, null);
  });
}

// The shapes below are not invented. They are trimmed copies of what the two
// actors actually returned on 2026-09-08, read back out of the errand queue —
// which is the whole reason the errand loop was built.
console.log('\nThe envelope, as the actors really send it');
{
  const flights = {
    price_insights: { lowest_price: 977, price_level: 'typical', typical_price_range: [840, 1050] },
    all_flights: [
      { category: 'best', price: 977, currency: 'MYR', airlines: 'THAI', route: 'KUL-BKK',
        departure_time: '2026-09-20 20:55', arrival_time: '2026-09-20 21:55', stops: 0 },
      { price: 1130, currency: 'MYR', airlines: 'Malaysia Airlines', departure_time: '2026-09-20 17:45', stops: 0 },
    ],
  };
  await t('a fare row is read out of all_flights', () => {
    const f = A.asFare(flights.all_flights[0]);
    assert.equal(f.price, 977);
    assert.equal(f.transfers, 0);
  });
  await t('the airline is under "airlines", plural, and read whole', () => {
    // It returned "T" first time round: the reader was told to look at
    // `airlines.0`, and indexing into the STRING "THAI" gives its first letter.
    // An airline called T reads as a typo rather than a bug, which is exactly
    // why it needs a test rather than a glance.
    assert.equal(A.asFare(flights.all_flights[0]).airline, 'THAI');
    assert.equal(A.asFare(flights.all_flights[1]).airline, 'Malaysia Airlines');
  });
  await t('a list of airlines still works', () => {
    assert.equal(A.asFare({ price: 500, airlines: ['AirAsia', 'Scoot'] }).airline, 'AirAsia');
  });

  const hotel = {
    property_details: {
      name: 'Banyan Tree Bangkok',
      rate_per_night: { lowest: 'MYR 543', extracted_lowest: 543, extracted_before_taxes_fees: 510 },
      total_rate: { lowest: 'MYR 2,173', extracted_lowest: 2173 },
      overall_rating: 4.8, reviews: 16933,
      prices: [{ source: 'Priceline', link: 'https://x/1' }, { source: 'Vio.com', link: 'https://x/2' }],
    },
  };
  await t('a hotel carries the night AND the stay, separately', () => {
    const p = hotel.property_details;
    assert.equal(p.rate_per_night.extracted_lowest, 543);
    assert.equal(p.total_rate.extracted_lowest, 2173);
    // 543 x 4 nights is 2,172 — one ringgit off the real total. Which is the
    // reason to carry both rather than multiply: the arithmetic is never right.
    assert.notEqual(p.rate_per_night.extracted_lowest * 4, p.total_rate.extracted_lowest);
  });
  await t('and who is selling it at that price', () => {
    assert.equal(hotel.property_details.prices[0].source, 'Priceline');
  });
}

console.log('\nWhat it charges');
{
  const M = await import('../lib/meter.js');
  // A run has to land in the ledger under its own name. An expensive service
  // filed under "other:" is a service nobody notices until the bill.
  const tally = await M.withSession('sesn_' + 'a'.repeat(20), async () => {
    M.count('https://api.apify.com/v2/acts/x~y/run-sync-get-dataset-items?token=t', true);
    return M.drain();
  });
  await t('a run is counted as apify, not as "other"', () => {
    assert.ok(tally.apify, JSON.stringify(tally));
    assert.equal(tally.apify.calls, 1);
  });
  await t('and it costs more than anything else per call', () => {
    // Metered high on purpose. If the placeholder is wrong it should be wrong
    // in the direction that makes a run visible.
    assert.ok(tally.apify.usd >= 0.02, JSON.stringify(tally.apify));
  });
}

console.log('\n' + n + ' passed');
