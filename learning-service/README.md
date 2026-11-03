# Learning service prototype

This Node.js 24 service implements the first Moodle LTI 1.3 resource-link slice.
See the editor's
[`moodle-integration.md`](../scratch-editor/docs/fischertechnik/moodle-integration.md)
for exact Windows and Moodle setup.

Local development:

```sh
podman compose up -d
npm ci
cp .env.example .env
# Fill the Moodle-generated LTI values in .env.
npm run build
npm start
```

Checks:

```sh
npm run lint
npm run build
npm test
```

MongoDB stores security and application metadata in the named Podman volume.
SB3 artifacts are written under `data/`, which is intentionally ignored by Git.
Back up both for persistence. The service is a single-instance prototype; see
the integration document for the object-storage and transaction migration path.
