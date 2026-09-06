// Reading one page we chose, instead of whatever a search surfaced.
//
// raffy's Kuching screenshot, 2026-09-06: a hotel card reading "blogs quote
// RM100-220/night". That is what a desk that can only SEARCH produces. Given
// the hotel's own URL it can now read that page instead.
//
// The network is faked: firecrawl.dev and openrouter.ai are both blocked from
// this sandbox, so what is checked here is everything that is ours — when a
// page is fetched, when it is refused, that the page reaches the WORKER and
// never the chat model, and that a dead page still gets an answer.

import assert from 'node:assert';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

process.env.FIRECRAWL_API_KEY = 'fc-test';
process.env.OPENROUTER_API_KEY = 'sk-or-test';

const { fetchable, scrape, firecrawlReady } = await import('../lib/firecrawl.js');

console.log('\nWhat it will and will not fetch');
t('a real https page, yes', () => assert.equal(fetchable('https://www.marriott.com/kchsi'), true));
t('plain http, no — a scraper is not a reason to drop TLS', () =>
  assert.equal(fetchable('http://example.com'), false));
t('our own deployment, no: never hand an internal URL to a third party', () =>
  assert.equal(fetchable('https://trip-builder-two.vercel.app/api/state'), false));
t('localhost and private ranges, no', () => {
  assert.equal(fetchable('https://localhost/x'), false);
  assert.equal(fetchable('https://192.168.1.4/x'), false);
  assert.equal(fetchable('https://10.0.0.9/x'), false);
});
t('nonsense, no', () => {
  assert.equal(fetchable('not a url'), false);
  assert.equal(fetchable(''), false);
  assert.equal(fetchable(null), false);
});

console.log('\nScraping');

let seen = [];
const real = global.fetch;
const page = (md) => ({
  ok: true, status: 200, headers: new Headers(),
  text: async () => JSON.stringify({ data: { markdown: md } }),
  json: async () => ({ data: { markdown: md } }),
});
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  seen.push({ u, body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers || {} });
  // Long enough to clear the 80-character floor that keeps a cookie banner
  // from being mistaken for a page. A real hotel page is thousands.
  if (u.startsWith('https://api.firecrawl.dev')) {
    return page('# Sheraton Kuching\n\nOn the waterfront in the old town.\n\n'
      + 'Deluxe room, RM480 per night, breakfast for two included. Free cancellation '
      + 'until seven days before arrival. Check-in from 3pm, check-out by noon.');
  }
  if (u.startsWith('https://openrouter.ai')) {
    return {
      ok: true, status: 200, headers: new Headers(),
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'RM480 a night with breakfast, from the hotel\'s own page.' } }],
        usage: { prompt_tokens: 900, completion_tokens: 40, cost: 0.0004 },
        model: 'deepseek/deepseek-chat-v3-0324',
      }),
    };
  }
  return real(url, opts);
};

{
  seen = [];
  const md = await scrape('https://www.marriott.com/kchsi');
  t('the page comes back as markdown', () => assert.ok(md.includes('RM480'), md.slice(0, 60)));
  t('and it is asked for as markdown, main content only', () => {
    const b = seen[0].body;
    assert.deepEqual(b.formats, ['markdown']);
    assert.equal(b.onlyMainContent, true);
    assert.equal(seen[0].headers.authorization, 'Bearer fc-test');
  });
}

{
  seen = [];
  const md = await scrape('https://trip-builder-two.vercel.app/api/state');
  t('a refused URL is never even requested', () => {
    assert.equal(md, '');
    assert.equal(seen.length, 0);
  });
}

console.log('\nThe desk, given a page');

const { research } = await import('../lib/research.js');

{
  seen = [];
  const out = await research([
    { q: 'What does a deluxe room cost?', about: 'Sheraton rate', url: 'https://www.marriott.com/kchsi' },
  ]);
  const fc = seen.filter((s) => s.u.includes('firecrawl'));
  const or = seen.filter((s) => s.u.includes('openrouter'));

  t('the page is fetched once', () => assert.equal(fc.length, 1));
  t('and the worker is asked once', () => assert.equal(or.length, 1));

  t('the page is given to the WORKER, which is the whole discipline', () => {
    const msg = or[0].body.messages.map((m) => m.content).join('\n');
    assert.ok(msg.includes('RM480'), 'the worker must see the page');
    assert.ok(msg.includes('--- PAGE ---'));
  });

  t('and no web search is paid for when the page was handed to us', () => {
    // OpenRouter charges about $0.007 for the search plugin. A page we were
    // given needs none, and that fee is most of what a round costs.
    assert.ok(!or[0].body.plugins, 'no web plugin');
    assert.ok(!/:online/.test(or[0].body.model || ''), or[0].body.model);
  });

  t('the answer comes back, short, for the chat model', () => {
    assert.ok(out.text.includes('RM480'), out.text.slice(0, 80));
    assert.ok(out.text.length < 2000, String(out.text.length));
  });
}

{
  // A page that will not load must not lose the question.
  seen = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    seen.push({ u, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.startsWith('https://api.firecrawl.dev')) return { ok: false, status: 502, text: async () => 'bad gateway', json: async () => ({}) };
    if (u.startsWith('https://openrouter.ai')) {
      return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({
        choices: [{ message: { content: 'About RM400-500 a night, from a booking site.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.008 },
      }) };
    }
    return real(url, opts);
  };
  const out = await research([{ q: 'What does a deluxe room cost?', url: 'https://www.marriott.com/kchsi' }]);
  const or = seen.filter((s) => s.u.includes('openrouter'));
  t('a dead page falls back to searching rather than failing', () => {
    assert.equal(or.length, 1);
    assert.ok(or[0].body.plugins || /:online/.test(or[0].body.model || ''), 'must search instead');
    assert.ok(out.text.includes('RM400'), out.text.slice(0, 80));
  });
}

console.log('\nWithout a key');
{
  delete process.env.FIRECRAWL_API_KEY;
  t('it simply is not there, and nothing breaks', () => {
    assert.equal(firecrawlReady(), false);
  });
}

global.fetch = real;
console.log('\n' + n + ' passed\n');
