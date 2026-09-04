ARG NEON_BUILD_TOOLS_IMAGE
ARG NEON_RUNTIME_IMAGE
FROM ${NEON_BUILD_TOOLS_IMAGE} AS build
WORKDIR /home/nonroot/neon
COPY --chown=nonroot:nonroot . .
RUN cargo build --locked --release --package proxy --bin proxy --features testing

FROM ${NEON_RUNTIME_IMAGE}
ARG NEON_REF
LABEL org.opencontainers.image.revision="${NEON_REF}"
COPY --from=build /home/nonroot/neon/target/release/proxy /usr/local/bin/proxy
