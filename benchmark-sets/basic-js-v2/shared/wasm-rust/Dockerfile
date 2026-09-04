ARG RUST_IMAGE
ARG BUSYBOX_IMAGE
FROM ${RUST_IMAGE} AS build
RUN rustup target add wasm32-wasip2
WORKDIR /src
COPY benchmark-sets/basic-js-v2/shared/wasm-rust/Cargo.toml benchmark-sets/basic-js-v2/shared/wasm-rust/Cargo.lock ./
COPY benchmark-sets/basic-js-v2/shared/wasm-rust/src ./src
RUN cargo build --locked --target wasm32-wasip2 --release

FROM ${BUSYBOX_IMAGE}
COPY --from=build /src/target/wasm32-wasip2/release/baas_bench_trailbase.wasm /component.wasm
COPY benchmark-sets/basic-js-v2/shared/trailbase/U1785764800__create_bb_basic_js_v2_guestbook.sql /migration.sql
