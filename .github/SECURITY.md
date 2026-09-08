# Security Policy

Thanks for taking the time to look into the security of this CRM.

## Reporting a vulnerability

**Do not open a public GitHub issue for security bugs.** Public issues are
indexed by search engines and seen by every fork long before the upstream fix
lands.

Instead, please report privately through
[GitHub Security Advisories](https://github.com/leonardocabralb/CB-CRM/security/advisories/new),
which keeps the report, the fix, and the disclosure in one place and visible
only to the maintainers until a patch ships.

If you run your own installation of this CRM, replace the link above with your
own repository's advisory page — reports about YOUR deployment belong with
whoever operates it.

Include, if you can:

- A description of the issue and the impact.
- Reproduction steps or a proof-of-concept.
- The commit or release you're testing against.
- Whether you'd like credit in the eventual disclosure (we default to
  crediting by the name or handle you give us, unless you prefer anonymous).

## What to expect

- **Acknowledgement** within 72 hours.
- **Initial assessment** (severity, affected versions, whether a workaround
  exists) within one week.
- **Fix + coordinated disclosure** on a timeline proportional to severity.
  Critical issues ship a patch as soon as one's ready; medium issues bundle
  with the next release.

## Scope

In scope:
- Anything in this repository, including webhook and auth flows, token
  encryption, RLS policies, and the built-in cron endpoints.
- Default configurations shipped in `docs/` — e.g. if the setup guide leaves
  an unsafe default.

Out of scope:
- Vulnerabilities in Supabase, Next.js, Node.js, or other upstream
  dependencies — please report those to their maintainers. We'll happily
  bump versions on request.
- Issues that require a pre-compromised deployment (e.g. a leaked
  service-role key) unless they widen the blast radius beyond the initial
  compromise.
- Social engineering, physical attacks, or third-party services added to an
  installation after deploy.

## Safe harbor

Research conducted under this policy is authorized. We won't pursue legal
action against anyone who:

- Makes a good-faith effort to avoid data destruction, privacy violations,
  or service disruption.
- Gives us reasonable time to respond before any public disclosure.
- Doesn't exploit the issue beyond what's necessary to demonstrate it.

Thanks for helping keep this template (and its forks) safe.
