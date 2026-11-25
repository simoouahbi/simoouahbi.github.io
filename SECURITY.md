# Security policy

## Scope and ownership

This repository is a public portfolio template maintained by
[@simoouahbi](https://github.com/simoouahbi) and is part of the ECO-SYS
ecosystem. It has no account sign-in or private visitor data by default.
Features added by a downstream deployment must define and enforce their own
server-side access controls.

The repository and deployment are controlled by the account linked above.
Grant access only to owner-approved maintainers and use the least privilege
needed. A hidden route, client-side check, or unlisted file is not access
control.

## Secrets and user data

Do not commit credentials, OAuth secrets, database URLs, private visitor data,
or production configuration. Store secrets only in the environment of the
service that needs them or in ignored local environment files. Never expose
server secrets in frontend variables, browser storage, or logs.

## Vulnerability reporting

Do not publish details of an unpatched issue in a public issue, pull request,
or discussion. Use GitHub private vulnerability reporting for this repository
when available. Otherwise, contact
[@simoouahbi](https://github.com/simoouahbi) privately.

Include the affected URL or file, impact, and a minimal reproduction. Remove
credentials and personal data from reports.
