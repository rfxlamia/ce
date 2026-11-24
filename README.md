# Continuous Evidence

Automated verification that produces inspectable **runtime evidence** for
software changes — when existing checks do not already provide sufficient
evidence, and without duplicating them.

Read [`SPEC.md`](./SPEC.md) for the full v0 specification.

## Status

`v0.1` — specification frozen for the MVP; implementation spike in progress
(Milestone 1: *Prove the Concept*).

## Repository layout

```
ce/
├── SPEC.md              # Continuous Evidence SPEC v0.1
├── packages/ce/         # CE core + CLI (TypeScript, Node.js)
└── examples/demo-app/   # Minimal web app used as the spike's verification target
```

The monorepo uses plain npm workspaces — no build orchestration framework.
The demo app is deliberately independent of CE to keep verification
non-invasive (SPEC.md §4.5).

## Development

```bash
npm install
npm run build        # build all workspaces
npm run typecheck    # typecheck all workspaces
```

Run the demo app:

```bash
npm run dev --workspace @ce/demo-app   # serves http://localhost:5173
```

Run the CE CLI (stub for now):

```bash
npm run build --workspace continuous-evidence
npx ce --version
```

## License

[MIT](./LICENSE)
