# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest `main` | ✅ |
| older releases | ❌ |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please **do not open a public issue**.

Instead, report it via [GitHub Security Advisories](https://github.com/OpenInsightHQ/arp/security/advisories/new) or email the maintainers directly.

Please include:

- Type of issue (e.g. authentication bypass, injection, data exposure)
- Affected component (API server / client / packages / deployment)
- Step-by-step reproduction or proof of concept
- Potential impact

We will acknowledge reports within 72 hours and keep you informed about remediation progress.

## Scope Notes

- Vulnerabilities in third-party dependencies should be reported upstream, but feel free to notify us as well so we can update pinned versions.
- Self-hosted misconfiguration (exposed ports, unchanged default secrets) is generally out of scope unless it stems from project defaults.
