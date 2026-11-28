# continuous-evidence

Continuous Evidence (CE) is automated verification that produces inspectable **runtime evidence** for software changes, when existing checks do not already provide sufficient evidence, and without duplicating them.

Requires Node.js 22.12 or newer.

## Quick start

Install CE in your project, then run the setup command:

```bash
npm i -D continuous-evidence
npx ce init
```

Or run the setup once without installing it first:

```bash
npx continuous-evidence init
```

> **Warning:** `npx ce` without the package installed resolves the unrelated npm package named `ce`, not this tool. Install `continuous-evidence` first, or use `npx continuous-evidence <command>`.

## Documentation

- [Repository README](https://github.com/rfxlamia/ce#readme)
- [SPEC.md](https://github.com/rfxlamia/ce/blob/main/SPEC.md): the v0 specification
