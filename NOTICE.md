# Provenance and attribution

Codex HUD is based on and derived from **codex-usage-monitor by harveyxiacn**:
[Original repository](https://github.com/harveyxiacn/codex-usage-monitor).

Upstream reference commit: `dc14906821a30266d473c129460602a6c22efccc`.

The upstream work established the local Codex JSONL usage-monitoring approach and parsing of session metadata, turn context and token-count snapshots. Its original MIT license, including **Copyright (c) 2026 harveyxiacn**, is preserved in [LICENSE](LICENSE) and distributed with this project.

Later modifications in this independent repository include:

- Interactive session browsing, project filtering, official rename-index display and session selection locks.
- A live terminal HUD, responsive Unicode-aware formatting and terminal lifecycle restoration.
- Account-global subscription snapshot selection and explicit expiration/unknown states.
- Incremental local telemetry reading and usage subset validation.
- An opt-in SQLite accounting recorder with event identity, ordered metadata, deduplication, checkpoints and crash/rewrite recovery.
- Read-only historical workload statistics with cumulative-delta accounting, half-open time ranges and explicit completeness handling.
- Synthetic tests, packaging and documentation for these extensions.

These are later additions and modifications, not a claim that the entire project or its underlying approach was written from scratch. Upstream copyright and permission terms continue to apply. No private session logs, authentication files or user databases are included.

The packaged frontend includes third-party libraries. Their bundled dependency versions, license texts and copyright notices are generated during the production build in [dist/gui/THIRD-PARTY-NOTICES.md](dist/gui/THIRD-PARTY-NOTICES.md). The upstream Codex HUD license above remains unchanged.

## Additional frontend notices

The build-generated notices include the JavaScript dependency licenses. The following cover Tailwind CSS 4.3.3 and the Victory vendor wrapper 37.3.6; the latter package omits its root license text from its npm archive. Its D3 dependency notices are included in the generated file.

### Tailwind CSS 4.3.3

MIT License

Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Victory vendor 37.3.6

Source: https://github.com/FormidableLabs/victory/blob/v37.3.6/LICENSE.txt

The MIT License (MIT)

Copyright (c) 2015-2020 Formidable Labs.
Copyright (c) 2016-2020 Alexey Svetliakov <https://github.com/asvetliakov>,
snerks <https://github.com/snerks>, Krzysztof Cebula <https://github.com
Havret>, Vitaliy Polyanskiy <https://github.com/alreadyExisted>, James Lismore
<https://github.com/jlismore>, Stack Builders <https://github.com
stackbuilders>, Esteban Ibarra <https://github.com/ibarrae>, Dominic Lee
<https://github.com/dominictwlee>, Dave Vedder <https://github.com
veddermatic>, Alec Flett <https://github.com/alecf> and potentially other
DefinitelyTyped contributors.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
