// The card a crawler shows when a trip link is pasted somewhere.
//
// raffy, 2026-09-16: "why don't we make [the invite link] work the same
// too??" — the read-only /t/<token> link and the "plan together" /?s=
// invite link are genuinely different URLs (see components/Invite.js on why
// an invite cannot be a forwardable token), so each page's own
// getServerSideProps has to build its own `og` object. But the tags
// themselves — what a crawler actually reads — are the same shape either
// way, so they live in one place rather than two copies that quietly drift.
//
// Shared rather than looked up here: a card that read the session itself
// would cost an Anthropic call per preview, and a link in a group chat is
// fetched by everyone who sees it.
export default function SocialMeta({ og }) {
  if (!og) return null;
  return (
    <>
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Trip Builder" />
      <meta property="og:title" content={og.title} />
      <meta property="og:description" content={og.description} />
      <meta property="og:url" content={og.url} />
      <meta property="og:image" content={og.image} />
      <meta property="og:image:secure_url" content={og.image} />
      <meta property="og:image:type" content="image/jpeg" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={og.title + ' — ' + og.description} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={og.title} />
      <meta name="twitter:description" content={og.description} />
      <meta name="twitter:image" content={og.image} />
    </>
  );
}
