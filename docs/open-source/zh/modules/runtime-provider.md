# Runtime And Provider

## Purpose

Runtime 和 provider code 决定模型请求如何配置、哪些能力可用、请求如何传输。

## Owns

- Provider profiles。
- Model capability 和 request capability。
- Direct provider calls、relay routing、native HTTP transport choices。
- Request assembly inputs that belong to runtime/provider configuration。

## Does Not Own

- UI persistence。
- Official server defaults。
- Chat message mutation。
- Collection storage。

## Main Entrypoints

- `src/engines/provider-runtime/`
- `src/engines/request/`
- `src/engines/chat-api/`
- Provider settings UI。

## Important Boundaries

- Provider adapter 只把已经组装好的 Polaris context 翻译成供应商协议，不应该额外发明产品语义。
- 当前时间、工具能力、memory lanes 等是否进入 provider，应该由 request assembly 和 prompt/template 决定，而不是 adapter 偷加。
- Relay 是可选 transport，由 deployer-owned backend 或 same-origin API route 提供。
- 流式 tool-call 的 provider index 保留为来源证据；本地 accumulator 始终维护连续列表，并先按 tool-call id、再按 provider index 合并碎片。

## Failure States

- Provider profile 不完整或 credential 不可用。
- Model capability 与请求需要的能力不匹配。
- Relay/native/direct transport 选择失败。
- Request assembly 与 provider adapter 对同一能力理解不一致。
