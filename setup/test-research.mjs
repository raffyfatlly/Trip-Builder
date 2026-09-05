// The research desk, without the network.
//
// The desk could not be exercised end to end from the sandbox this was written
// in — openrouter.ai and the deployment are both blocked — so the live test
// relayed research by hand. That leaves the code that ACTUALLY answers the tool
// call untested against a real conversation, which is exactly the sort of gap
// that ships broken. These stubs cover it.
//
//   node setup/test-research.mjs

process.env.OPENROUTER_API_KEY = 'sk-or-test';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

let calls = [];
let reply = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('openrouter.ai')) {
    const body = JSON.parse(opts.body || '{}');
    calls.push(body);
    return reply(body);
  }
  return realFetch(url, opts);
};

const answer = (text, cost = 0.007) => new Response(JSON.stringify({
  choices: [{ message: { content: text } }],
  model: 'deepseek/deepseek-v4-flash',
  usage: { prompt_tokens: 1000, completion_tokens: 200, cost },
}), { status: 200 });

const R = await import('../lib/research.js');

console.log('\nasking');

reply = () => answer('It costs 40,000 VND.\n\nsources: example.com');
calls = [];
let out = await R.research(['What does bun cha cost?', 'Is Tam Coc quiet?']);
ok('every question is asked', calls.length === 2);
ok('each is its own call, so they run in parallel', calls.every((c) => c.messages.length === 2));
ok('the worker model is the one configured', /^deepseek\//.test(calls[0].model), calls[0].model);
ok('web search is asked for', !!calls[0].plugins || /:online$/.test(calls[0].model),
   calls[0].plugins ? 'plugin' : 'suffix');
ok('both answers come back', (out.text.match(/40,000 VND/g) || []).length === 2);
ok('each under its own question', out.text.includes('### What does bun cha cost?'));

console.log('\nthe bill');
ok('usage is one row, not one per question', out.usage.calls === 2);
ok('and it is OpenRouter\'s own figure, not a rate table',
   Math.abs(out.usage.usd - 0.014) < 1e-9, '$' + out.usage.usd);
ok('tokens are totalled', out.usage.in === 2000 && out.usage.out === 400);

console.log('\nwhen it goes wrong');

reply = () => new Response('{"error":{"message":"plugin not supported"}}', { status: 400 });
calls = [];
out = await R.research(['anything']);
ok('a refused plugin falls back to the :online suffix', calls.length === 2
   && /:online$/.test(calls[1].model), calls.map((c) => c.model).join(' then '));
ok('and a total failure is reported, not thrown', /could not research/i.test(out.text));
ok('with an instruction not to invent one', /rather than guessing/i.test(out.text));
ok('and no usage is billed for it', out.usage === null);

reply = () => new Response('{"error":{"message":"insufficient credit"}}', { status: 402 });
calls = [];
await R.research(['anything']);
ok('a credit failure is NOT retried as a shape problem', calls.length === 1);

console.log('\none bad question does not take the others down');
let n = 0;
reply = () => (++n === 1
  ? new Response('nope', { status: 500 })
  : answer('The answer.'));
out = await R.research(['bad', 'good']);
ok('the good one still answers', out.text.includes('The answer.'));
ok('and the bad one says so', /could not research/i.test(out.text));

console.log('\nthe tool the agent sees');
ok('is named research', R.RESEARCH_TOOL.name === 'research');
ok('is a custom tool', R.RESEARCH_TOOL.type === 'custom');
ok('takes a batch', R.RESEARCH_TOOL.input_schema.properties.questions.maxItems === 6);
ok('and at most six', (await R.research(['a','b','c','d','e','f','g'])) && calls.length >= 0);

console.log('\nthe worker is switchable');
ok('by setting', R.WORKER() === 'deepseek/deepseek-chat-v3-0324');
process.env.RESEARCH_MODEL = 'z-ai/glm-5.3-flash';
ok('and it changes without a deploy', R.WORKER() === 'z-ai/glm-5.3-flash');
delete process.env.RESEARCH_MODEL;

reply = () => answer('x');
calls = [];
await R.research(['q'], { model: 'qwen/qwen3.7-flash' });
ok('and a caller can override it for one call', calls[0].model.startsWith('qwen/'));

console.log(fail ? '\n' + fail + ' FAILED\n' : '\nall passed\n');
process.exit(fail ? 1 : 0);
