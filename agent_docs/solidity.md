# Solidity Coding Standards

Applies to `packages/contracts/`.

## Imports

- Named only — `import {Contract} from "./contract.sol"`
- Never `import "./contract.sol"`

## Naming

- Private/internal state vars and functions: prefix with `_`
- Event names: past tense (`Claimed`, `NullifierConsumed`)
- Function params: prefix with `_`
- Return values: suffix with `_`
- Mappings: use named parameters

## Errors

- Custom errors over require strings
- No natspec on errors
- Place at end of implementation file, not in interface

## Natspec

- Use `///` style
- External/public: `@notice`
- Internal/private: `@dev`
- All files (except tests): `/// @custom:security-contact security@taiko.xyz`
- License: MIT

## Foundry Config

- Solc `0.8.33`, optimizer 200 runs, `via_ir = true`, EVM target `shanghai`
- Remappings defined in `packages/contracts/foundry.toml`
