# Third-party notices

Forge depends on third-party software. Each dependency remains governed by its own license; the Forge source license does not replace those terms.

Key direct dependencies include:

| Component | Role | License declared by package metadata |
| --- | --- | --- |
| Hono | Cloudflare Worker HTTP framework | MIT |
| React and React DOM | Web and generated-application UI | MIT |
| React Router | Web routing | MIT |
| Vite | Web and generated-application build tool | MIT |
| Tailwind CSS | Styling and build tooling | MIT |
| pi coding agent | Agent SDK | MIT |
| Lucide React | Generated-application icons | ISC |
| Motion | Generated-application animation | MIT |

The exact dependency graph and versions are recorded in:

- `package-lock.json`
- `web/package-lock.json`
- `agent/package-lock.json`
- `agent/template/package-lock.json`

Cloud Run images also contain Node.js, Debian packages, and transitive npm dependencies. Distributors should generate an SBOM and preserve all license and notice files from the exact image they distribute.

The Google sign-in mark is a Google trademark and is not licensed by Forge. Deployers must follow the applicable provider branding requirements.
