// What a triaged card set says back, as one sentence per verdict.
//
// raffy, 2026-09-06: "Allow users to check yes, no, or maybe across several
// options simultaneously rather than forcing them to decide on items one by
// one."
//
// Plain JS so it can be tested directly. The exact wording matters twice over:
// it is what the agent reads, and it is what sits in the traveller's own
// transcript forever.

export function triageMessage(names, marks) {
  const pick = (how) => (names || []).filter((n) => marks[n] === how);
  const andList = (a) => (a.length === 1
    ? a[0]
    : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const yes = pick('yes');
  const maybe = pick('maybe');
  const no = pick('no');
  const parts = [];
  if (yes.length) parts.push(`Yes to ${andList(yes)}.`);
  if (maybe.length) parts.push(`Maybe ${andList(maybe)}.`);
  if (no.length) parts.push(`Not ${andList(no)}.`);
  return parts.join(' ');
}

