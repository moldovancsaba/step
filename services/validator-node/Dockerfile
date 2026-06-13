# STEP validator node — multi-stage Rust build.
# Build from the REPO ROOT so the cargo workspace + path crates resolve:
#   docker build -f services/validator-node/Dockerfile -t step/validator-node .
#
# NOT build-verified in this environment (no Docker daemon); authored for the
# pilot host. The same binary is what scripts/dev/up.mjs runs and the E2E suite
# proves end-to-end.
FROM rust:1-slim-bookworm AS build
WORKDIR /build
# Only the crates the validator needs (mesh-engine ← validation-rules ← node).
COPY Cargo.toml Cargo.lock ./
COPY packages/mesh-engine packages/mesh-engine
COPY packages/validation-rules packages/validation-rules
COPY services/validator-node services/validator-node
# Trim the workspace member list to what we copied so cargo doesn't look for
# the contracts/web crates that aren't in this build context.
RUN sed -i 's#"services/validator-node",#"services/validator-node",#' Cargo.toml \
 && cargo build --release -p step-validator-node

FROM debian:bookworm-slim
RUN useradd -m -u 10001 step
WORKDIR /app
COPY --from=build /build/target/release/step-validator-node /usr/local/bin/step-validator-node
COPY config/protocol-params.alpha.json /app/config/protocol-params.alpha.json
ENV STEP_PROTOCOL_PARAMS=/app/config/protocol-params.alpha.json \
    VALIDATOR_PORT=9100
USER step
EXPOSE 9100
# Required env at run: STEP_CHAIN_ID, VERIFIER_CONTRACT_ADDRESS,
# VALIDATOR_PRIVATE_KEY, GATEWAY_NONCE_SECRET. Pilot nodes MUST set
# VALIDATOR_ALLOW_DEV_CLAIMS=false (ADR-015).
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD ["/bin/sh","-c","exec 3<>/dev/tcp/127.0.0.1/${VALIDATOR_PORT}; printf 'GET /healthz HTTP/1.0\\r\\n\\r\\n' >&3; grep -q ok <&3"]
ENTRYPOINT ["step-validator-node"]
